import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const detailPath = new URL(
  "../app/dashboard/orders/[orderId]/order-detail.tsx",
  import.meta.url,
);
const predicatesPath = new URL(
  "../app/dashboard/orders/order-action-predicates.ts",
  import.meta.url,
);

test("eligible cancellation exposes an interactive default-off restoration choice", async () => {
  const source = await readFile(detailPath, "utf8");

  assert.match(
    source,
    /const \[restoreInventoryOnCancel, setRestoreInventoryOnCancel\] =\s*useState\(false\)/,
  );
  assert.match(source, /checked=\{restoreInventoryOnCancel\}/);
  assert.match(
    source,
    /Choose whether eligible inventory should\s+be restored\./,
  );
  assert.match(
    source,
    /onRestoreInventoryChange\(event\.target\.checked\)/,
  );
  assert.doesNotMatch(
    source,
    /checked=\{restoreInventoryOnCancel\}[\s\S]{0,160}readOnly/,
  );
});

test("the selected restoration value reaches the existing cancellation RPC", async () => {
  const source = await readFile(detailPath, "utf8");

  assert.match(
    source,
    /\.rpc\("cancel_order", \{[\s\S]*?p_restore_inventory: restoreInventoryOnCancel,/,
  );
  assert.doesNotMatch(source, /p_restore_inventory: true,/);
  assert.doesNotMatch(source, /p_restore_inventory: false,/);
});

test("reason and email controls remain part of the cancellation dialog", async () => {
  const source = await readFile(detailPath, "utf8");

  assert.match(source, /Reason for cancellation/);
  assert.match(source, /Email cancellation notice to customer/);
  assert.match(source, /p_canceled_reason: trimmedReason \|\| null/);
  assert.match(
    source,
    /p_send_buyer_notification: shouldEmailCancellation/,
  );
});

test("paid online orders still have no usable cancellation action", async () => {
  const source = await readFile(predicatesPath, "utf8");

  assert.match(
    source,
    /order\.payment_method === "stripe_checkout" &&\s*order\.payment_status === "unpaid"/,
  );
  assert.doesNotMatch(
    source,
    /order\.payment_method === "stripe_checkout" &&\s*order\.payment_status === "paid"/,
  );
});
