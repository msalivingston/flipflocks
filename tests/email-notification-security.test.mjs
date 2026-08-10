import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const queueMigration = read(
  "supabase/migrations/20260730170000_secure_email_queue_and_delivery.sql",
);
const sellerOwnerMigration = read(
  "supabase/migrations/20260814100000_seller_new_order_owner_email.sql",
);
const actionMigration = read(
  "supabase/migrations/20260730171000_secure_seller_order_email_actions.sql",
);
const worker = read("supabase/functions/postmark-email-worker/index.ts");
const kickIndex = read("supabase/functions/manual-order-email-kick/index.ts");
const kickHandler = read("supabase/functions/manual-order-email-kick/handler.ts");

function read(relativePath) {
  return readFileSync(resolve(root, relativePath), "utf8");
}

function applicationSources(relativeDirectory) {
  const directory = resolve(root, relativeDirectory);
  const sources = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      sources.push(...applicationSources(path.slice(root.length + 1)));
      continue;
    }

    if ([".ts", ".tsx", ".js", ".mjs"].includes(extname(entry.name))) {
      sources.push({
        path: path.slice(root.length + 1).replaceAll("\\", "/"),
        source: readFileSync(path, "utf8"),
      });
    }
  }

  return sources;
}

function whitespaceFree(value) {
  return value.replace(/\s+/g, "").toLowerCase();
}

test("every generic queue and raw worker overload is service-role-only", () => {
  const compact = whitespaceFree(queueMigration);
  const rawSignatures = [
    "enqueue_email_notification(uuid,uuid,text,text,text,text,jsonb,text)",
    "enqueue_email_notification(uuid,uuid,text,text,text,text,jsonb)",
    "claim_email_notifications_internal(uuid,boolean,integer,integer,interval)",
    "claim_email_notifications(integer,integer,interval)",
    "claim_phase_1_postmark_email_notifications(integer,integer,interval)",
    "claim_phase_1_postmark_email_notifications_for_order(uuid,integer,integer,interval)",
    "begin_email_notification_dispatch(uuid,uuid)",
    "mark_email_notification_sent(uuid,uuid)",
    "mark_email_notification_sent(uuid,uuid,text)",
    "mark_email_notification_failed(uuid,uuid,text,interval,integer)",
    "mark_email_notification_delivery_unknown(uuid,uuid,text,text)",
    "retry_email_notification(uuid,timestamptz,boolean)",
    "suppress_email_notification(uuid,text,integer)",
  ];

  for (const signature of rawSignatures) {
    assert.ok(
      compact.includes(
        `revokeallonfunctionpublic.${signature}frompublic,anon,authenticated,service_role;`,
      ),
      `missing all-role revocation for ${signature}`,
    );
    assert.ok(
      compact.includes(
        `grantexecuteonfunctionpublic.${signature}toservice_role;`,
      ),
      `missing service-role grant for ${signature}`,
    );
  }
});

test("the generic enqueue primitive derives canonical identity and content", () => {
  assert.match(
    queueMigration,
    /select orders\.\*[\s\S]*where orders\.id = p_order_id/,
  );
  assert.match(queueMigration, /v_order\.store_id <> p_store_id/);
  assert.match(
    queueMigration,
    /v_order\.buyer_email_snapshot[\s\S]*v_store\.order_notification_email[\s\S]*v_store\.communication_email[\s\S]*v_store\.public_email/,
  );
  assert.match(
    queueMigration,
    /coalesce\(\s*nullif\(trim\(v_store\.order_notification_email\), ''\),\s*nullif\(trim\(v_store\.communication_email\), ''\),\s*nullif\(trim\(v_store\.public_email\), ''\)/,
  );
  assert.match(queueMigration, /v_subject_snapshot := case v_notification_type/);
  assert.match(queueMigration, /v_payload := jsonb_build_object/);
  assert.doesNotMatch(
    queueMigration.slice(
      queueMigration.indexOf("v_recipient_email := case"),
      queueMigration.indexOf("v_subject_snapshot := case"),
    ),
    /p_recipient_email/,
  );
  assert.doesNotMatch(
    queueMigration.slice(
      queueMigration.indexOf("v_subject_snapshot := case"),
      queueMigration.indexOf("v_dedupe_key :="),
    ),
    /p_subject_snapshot|p_payload/,
  );
});

test("seller New Order recipient is the authenticated owner account", () => {
  const recipientBlock = sellerOwnerMigration.slice(
    sellerOwnerMigration.indexOf("v_recipient_email := case"),
    sellerOwnerMigration.indexOf("if v_recipient_email is null"),
  );
  assert.match(recipientBlock,
    /v_notification_type = 'seller_new_order'[\s\S]*from auth\.users as users[\s\S]*users\.id = v_store\.owner_user_id/);
  assert.doesNotMatch(
    recipientBlock.match(/when v_notification_type = 'seller_new_order'[\s\S]*?\n\s*else/)?.[0] ?? "",
    /order_notification_email|communication_email|public_email/,
  );
  assert.match(sellerOwnerMigration,
    /notification_type = 'seller_new_order'[\s\S]*owners\.email/);
});

test("seller actions use auth identity, server events, locks, and server IDs", () => {
  assert.match(actionMigration, /auth\.uid\(\) is null/);
  assert.match(actionMigration, /public\.owns_store\(orders\.store_id\)/);
  assert.match(actionMigration, /public\.is_admin\(\)/);
  assert.match(actionMigration, /from public\.stores[\s\S]*for update/);
  assert.match(actionMigration, /from public\.orders[\s\S]*for update/);
  assert.match(
    actionMigration,
    /events\.event_type = 'order_edited'[\s\S]*order by events\.created_at desc/,
  );
  assert.match(actionMigration, /'event:' \|\| v_order_event\.id::text/);
  assert.match(actionMigration, /'request:' \|\| v_action_id::text/);
  assert.match(
    actionMigration,
    /from public\.seller_resend_order_confirmation\(p_order_id\)/,
  );
  assert.match(
    actionMigration,
    /from public\.seller_enqueue_updated_order_email\(p_order_id\)/,
  );
});

test("active application callers use one-argument seller actions and order-scoped kicks", () => {
  const orderDetail = read(
    "app/dashboard/orders/[orderId]/order-detail.tsx",
  );
  const editOrder = read(
    "app/dashboard/orders/[orderId]/edit/edit-order.tsx",
  );
  const manualOrder = read("app/dashboard/orders/new/new-manual-order.tsx");
  const checkout = read("supabase/functions/pay-at-pickup-order/handler.ts");

  for (const source of [orderDetail, editOrder]) {
    assert.doesNotMatch(source, /p_email_action_id/);
  }
  assert.match(
    orderDetail,
    /seller_resend_order_confirmation"[\s\S]*p_order_id: order\.order_id/,
  );
  assert.match(
    editOrder,
    /seller_enqueue_updated_order_email"[\s\S]*p_order_id: orderId/,
  );
  assert.match(
    manualOrder,
    /manual-order-email-kick"[\s\S]*order_id: orderId/,
  );
  assert.match(
    checkout,
    /body: JSON\.stringify\(\{[\s\S]*order_id: orderId/,
  );
  assert.match(
    orderDetail,
    /manual-order-email-kick"[\s\S]*order_id: orderId/,
  );

  const activeSources = [
    ...applicationSources("app"),
    ...applicationSources("supabase/functions"),
  ];

  for (const { path, source } of activeSources) {
    assert.doesNotMatch(
      source,
      /p_email_action_id/,
      `${path} still passes the obsolete browser email action identifier`,
    );
    assert.doesNotMatch(
      source,
      /\.rpc\(\s*["']enqueue_email_notification["']/,
      `${path} directly calls the generic email queue primitive`,
    );
  }
});

test("seller worker kicks authenticate, authorize one order, and never request a global batch", () => {
  assert.match(kickHandler, /dependencies\.authenticate\(authorization\)/);
  assert.match(
    kickHandler,
    /dependencies\.authorizeOrderKick\([\s\S]*authorization,[\s\S]*orderId/,
  );
  assert.match(kickIndex, /seller_request_order_email_processing/);
  assert.match(
    kickIndex,
    /body: JSON\.stringify\(\{[\s\S]*order_id: orderId/,
  );
  assert.doesNotMatch(kickIndex, /source:\s*"manual-order"/);
  assert.match(kickIndex, /x-flockfront-worker-secret/);
});

test("worker dispatch is persisted before provider send and ambiguity is terminal", () => {
  const beginIndex = worker.indexOf("await beginNotificationDispatch");
  const sendIndex = worker.indexOf("await sendPostmarkEmail");

  assert.ok(beginIndex > 0);
  assert.ok(beginIndex < sendIndex);
  assert.match(worker, /mark_email_notification_delivery_unknown/);
  assert.match(worker, /Postmark accepted the message, but sent-state finalization failed/);
  assert.match(worker, /claim_phase_1_postmark_email_notifications_for_order/);
  assert.match(worker, /dispatch_attempt_id: dispatchAttemptId/);
  assert.match(worker, /notification_id: notification\.notification_id/);
  assert.match(worker, /to: canonicalRecipient/);
  assert.doesNotMatch(
    worker.slice(
      worker.indexOf("async function readJsonBody"),
      worker.indexOf("async function fetchEmailContext"),
    ),
    /content-length/,
  );
  assert.match(
    queueMigration,
    /notification_status = 'delivery_unknown'[\s\S]*next_attempt_at = 'infinity'/,
  );
  assert.doesNotMatch(
    queueMigration.slice(
      queueMigration.indexOf("with claimable as"),
      queueMigration.indexOf("create or replace function public.claim_email_notifications("),
    ),
    /notification_status\s*=\s*'delivery_unknown'/,
  );
});

test("legacy questionable rows are quarantined without exposing recipients", () => {
  assert.match(queueMigration, /legacy queue row failed canonical authorization checks/);
  assert.match(queueMigration, /excessive legacy action-suffix variation requires review/);
  assert.match(queueMigration, /Legacy queue row quarantined during dispatch/);
  assert.match(
    queueMigration,
    /where notifications\.notification_status in \('pending', 'failed', 'processing'\)[\s\S]*notifications\.notification_status = 'processing'[\s\S]*then 'delivery_unknown'/,
  );
  assert.doesNotMatch(
    queueMigration.slice(
      queueMigration.indexOf("with questionable as"),
      queueMigration.indexOf("revoke all on function public.can_process_email_notifications"),
    ),
    /raise notice|recipient_email\s*\|\||p_recipient_email/,
  );
});

test("valid order-created, manual-order, edit, cancellation, and resend workflows remain wired", () => {
  const checkoutMigration = read(
    "supabase/migrations/20260730140000_conservative_order_customer_identity.sql",
  );
  const cancellationMigration = read(
    "supabase/migrations/20260730100000_enforce_order_cancellation_payment_eligibility.sql",
  );

  assert.match(checkoutMigration, /create_pay_at_pickup_order_v2[\s\S]*enqueue_email_notification/);
  assert.match(checkoutMigration, /create_manual_order[\s\S]*enqueue_email_notification/);
  assert.match(cancellationMigration, /cancel_order[\s\S]*buyer_order_canceled/);
  assert.match(cancellationMigration, /seller_order_canceled_copy/);
  assert.match(actionMigration, /seller_resend_order_confirmation\(\s*p_order_id uuid\s*\)/);
  assert.match(actionMigration, /seller_enqueue_updated_order_email\(\s*p_order_id uuid\s*\)/);
});

test("UI copy distinguishes queueing from provider delivery", () => {
  const uiSources = [
    read("app/dashboard/orders/new/new-manual-order.tsx"),
    read("app/dashboard/orders/orders-list.tsx"),
    read("app/dashboard/orders/[orderId]/edit/edit-order.tsx"),
    read("app/dashboard/orders/[orderId]/order-detail.tsx"),
  ].join("\n");

  assert.match(uiSources, /queued for delivery/);
  assert.doesNotMatch(
    uiSources,
    /confirmation email sent|customer emailed|confirmation resent/,
  );
});
