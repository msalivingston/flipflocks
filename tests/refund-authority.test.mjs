import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const migrationPath = path.join(
  repositoryRoot,
  "supabase/migrations/20260730210000_secure_refund_authority.sql",
);
const batchDPath = path.join(
  repositoryRoot,
  "supabase/migrations/20260730200000_unified_order_inventory_reconciliation.sql",
);
const orderPredicatesPath = path.join(
  repositoryRoot,
  "app/dashboard/orders/order-action-predicates.ts",
);
const concurrencyTestPath = path.join(
  repositoryRoot,
  "supabase/tests/refund_authority_concurrency_test.sql",
);

async function walkFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walkFiles(target)));
    else files.push(target);
  }

  return files;
}

test("Batch E is append-only and follows the inventory batch", async () => {
  const migration = await readFile(migrationPath, "utf8");

  assert.ok(path.basename(batchDPath) < path.basename(migrationPath));
  assert.match(migration, /^-- Phase 1 Security Batch E:/);
  assert.match(migration, /begin;[\s\S]*commit;/);
  assert.doesNotMatch(migration, /drop table public\.order_refunds/i);
});

test("the generic refund surface and every overload are neutralized", async () => {
  const migration = await readFile(migrationPath, "utf8");

  assert.match(
    migration,
    /p\.proname in \([\s\S]*'seller_record_refund'[\s\S]*'seller_record_offline_refund'[\s\S]*'record_stripe_refund_result'/,
  );
  assert.match(
    migration,
    /revoke all on function %s from public, anon, authenticated, service_role/,
  );
  assert.doesNotMatch(
    migration,
    /grant execute on function public\.seller_record_refund/,
  );
});

test("the seller action accepts only business-level offline inputs", async () => {
  const migration = await readFile(migrationPath, "utf8");
  const offline = migration.slice(
    migration.indexOf(
      "create or replace function public.seller_record_offline_refund(",
    ),
    migration.indexOf(
      "comment on function public.seller_record_offline_refund(",
    ),
  );

  assert.match(
    offline,
    /p_order_id uuid,[\s\S]*p_idempotency_key text,[\s\S]*p_refund_amount numeric,[\s\S]*p_offline_method text,[\s\S]*p_reason text[\s\S]*p_note text/,
  );
  for (const forbiddenParameter of [
    "p_store_id",
    "p_seller_id",
    "p_refund_status",
    "p_provider_refund_id",
    "p_provider_status",
    "p_provider_event_id",
    "p_metadata",
    "p_currency",
    "p_stripe_account",
    "p_stripe_livemode",
  ]) {
    assert.doesNotMatch(offline, new RegExp(`${forbiddenParameter}\\s`));
  }
  assert.match(
    offline,
    /'offline_cash',[\s\S]*'offline_check',[\s\S]*'offline_other'/,
  );
  assert.doesNotMatch(
    offline.slice(0, offline.indexOf("select orders.*")),
    /'stripe'/,
  );
});

test("offline ownership, currency, state, and provider fields are derived", async () => {
  const migration = await readFile(migrationPath, "utf8");
  const offline = migration.slice(
    migration.indexOf(
      "create or replace function public.seller_record_offline_refund(",
    ),
    migration.indexOf(
      "comment on function public.seller_record_offline_refund(",
    ),
  );

  assert.match(offline, /v_actor_user_id uuid := auth\.uid\(\)/);
  assert.match(
    offline,
    /public\.owns_store\(v_order\.store_id\)[\s\S]*public\.is_admin\(\)/,
  );
  assert.match(
    offline,
    /v_order\.payment_provider <> 'offline'[\s\S]*v_order\.payment_method <> 'pay_at_pickup'/,
  );
  assert.match(offline, /v_order\.currency_code/);
  assert.match(
    offline,
    /v_offline_method,[\s\S]*'succeeded',[\s\S]*v_order\.currency_code,[\s\S]*null,[\s\S]*null,[\s\S]*null/,
  );
});

test("amount ceilings and payment state use locked trusted successful rows", async () => {
  const migration = await readFile(migrationPath, "utf8");
  const offline = migration.slice(
    migration.indexOf(
      "create or replace function public.seller_record_offline_refund(",
    ),
    migration.indexOf(
      "comment on function public.seller_record_offline_refund(",
    ),
  );

  assert.match(offline, /where orders\.id = p_order_id[\s\S]*for update/);
  assert.match(
    offline,
    /from public\.order_refunds[\s\S]*order by order_refunds\.id[\s\S]*for update/,
  );
  assert.match(
    offline,
    /refund_status in \('pending', 'succeeded'\)/,
  );
  assert.match(offline, /refund_status = 'succeeded'/);
  assert.match(
    offline,
    /v_reserved_refund_total \+ v_refund_amount > v_paid_amount/,
  );
  assert.match(
    offline,
    /v_succeeded_refund_total = v_paid_amount[\s\S]*'refunded'[\s\S]*'partially_refunded'/,
  );
});

test("idempotency is bound to actor, order, method, amount, currency, and reason", async () => {
  const migration = await readFile(migrationPath, "utf8");
  const offline = migration.slice(
    migration.indexOf(
      "create or replace function public.seller_record_offline_refund(",
    ),
    migration.indexOf(
      "comment on function public.seller_record_offline_refund(",
    ),
  );

  for (const field of [
    "actor_user_id",
    "order_id",
    "refund_amount",
    "refund_method",
    "currency_code",
    "reason",
    "note",
  ]) {
    assert.match(offline, new RegExp(`'${field}'`));
  }
  assert.match(offline, /digest\([\s\S]*'sha256'/);
  assert.match(
    offline,
    /v_refund\.request_hash <> v_request_hash[\s\S]*already used with different refund details/,
  );
});

test("provider reconciliation is service-only and deliberately disabled", async () => {
  const migration = await readFile(migrationPath, "utf8");
  const provider = migration.slice(
    migration.indexOf(
      "create or replace function public.record_stripe_refund_result(",
    ),
    migration.indexOf(
      "comment on function public.record_stripe_refund_result(",
    ),
  );

  assert.match(provider, /auth\.role\(\)[\s\S]*<> 'service_role'/);
  assert.match(provider, /Stripe refund reconciliation is disabled/);
  assert.doesNotMatch(provider, /update public\.order_refunds/);
  assert.doesNotMatch(provider, /update public\.orders/);
  assert.match(
    migration,
    /grant execute on function public\.record_stripe_refund_result\([\s\S]*\) to service_role/,
  );
});

test("new writes have explicit offline and provider consistency rules", async () => {
  const migration = await readFile(migrationPath, "utf8");

  assert.match(migration, /alter column refund_status drop default/);
  assert.match(
    migration,
    /order_refunds_offline_authority_check[\s\S]*not valid/,
  );
  assert.match(
    migration,
    /order_refunds_stripe_binding_check[\s\S]*not valid/,
  );
  assert.match(
    migration,
    /stripe_checkout_session_id[\s\S]*stripe_payment_intent_id[\s\S]*stripe_account_id[\s\S]*stripe_livemode/,
  );
  assert.doesNotMatch(
    migration,
    /update public\.order_refunds\s+set\s+refund_method\s*=/i,
  );
});

test("active application and Edge code do not call refund authority primitives", async () => {
  const roots = [
    path.join(repositoryRoot, "app"),
    path.join(repositoryRoot, "supabase/functions"),
  ];
  const activeFiles = (
    await Promise.all(roots.map((root) => walkFiles(root)))
  ).flat();
  const matches = [];

  for (const file of activeFiles) {
    if (!/\.(?:ts|tsx|js|jsx|mjs)$/.test(file)) continue;
    const source = await readFile(file, "utf8");
    if (
      /seller_record_refund|record_stripe_refund_result|seller_record_offline_refund/.test(
        source,
      )
    ) {
      matches.push(path.relative(repositoryRoot, file));
    }
  }

  assert.deepEqual(matches, []);
});

test("Batch D paid-Stripe edit protection remains intact", async () => {
  const [batchD, predicates] = await Promise.all([
    readFile(batchDPath, "utf8"),
    readFile(orderPredicatesPath, "utf8"),
  ]);

  assert.match(
    batchD,
    /v_order\.payment_method = 'stripe_checkout'[\s\S]*v_order\.payment_status <> 'unpaid'[\s\S]*Paid online orders cannot be edited\./,
  );
  assert.match(
    predicates,
    /order\.payment_method === "stripe_checkout"[\s\S]*order\.payment_status !== "unpaid"/,
  );
});

test("Batch E introduces no Stripe request, checkout, webhook, or Edge implementation", async () => {
  const migration = await readFile(migrationPath, "utf8");

  assert.doesNotMatch(
    migration,
    /create (?:or replace )?function public\.(?:request|create|submit)_stripe_refund/i,
  );
  assert.doesNotMatch(migration, /http_request|net\.http|pg_net/i);
  assert.doesNotMatch(migration, /stripe\.com/i);
});

test("disposable-local SQL covers refund ceilings, idempotency, and provider races", async () => {
  const concurrency = await readFile(concurrencyTestPath, "utf8");

  assert.match(concurrency, /dblink_send_query/g);
  assert.match(
    concurrency,
    /two different refunds competing for the remaining amount produce one success/,
  );
  assert.match(
    concurrency,
    /identical concurrent retries create one refund row/,
  );
  assert.match(
    concurrency,
    /concurrent provider-result calls both fail closed/,
  );
  assert.match(concurrency, /pg_advisory_xact_lock_shared/);
});
