import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  getCancellationEmailQueueState,
} from "../app/dashboard/orders/[orderId]/cancellation-email-result.ts";

const detailPath = new URL(
  "../app/dashboard/orders/[orderId]/order-detail.tsx",
  import.meta.url,
);

test("buyer queued without seller copy is successful and remains kickable", () => {
  assert.deepEqual(
    getCancellationEmailQueueState({
      buyer_notification_queued: true,
      seller_copy_queued: false,
    }),
    { buyerEmailQueued: true, anyEmailQueued: true },
  );
});

test("both queued remains successful and kickable", () => {
  assert.deepEqual(
    getCancellationEmailQueueState({
      buyer_notification_queued: true,
      seller_copy_queued: true,
    }),
    { buyerEmailQueued: true, anyEmailQueued: true },
  );
});

test("neither queued remains a buyer-email failure and does not kick", () => {
  for (const result of [
    null,
    {},
    { buyer_notification_queued: false, seller_copy_queued: false },
  ]) {
    assert.deepEqual(getCancellationEmailQueueState(result), {
      buyerEmailQueued: false,
      anyEmailQueued: false,
    });
  }
});

test("seller copy alone can start processing but is not buyer-email success", () => {
  assert.deepEqual(
    getCancellationEmailQueueState({
      buyer_notification_queued: false,
      seller_copy_queued: true,
    }),
    { buyerEmailQueued: false, anyEmailQueued: true },
  );
});

test("dashboard uses buyer state for messaging and either row for the worker kick", async () => {
  const source = await readFile(detailPath, "utf8");

  assert.match(source,
    /const \{ buyerEmailQueued, anyEmailQueued \} =\s*getCancellationEmailQueueState\(cancelResult\)/);
  assert.match(source,
    /const emailProcessingStarted = anyEmailQueued\s*\? await kickPostmarkEmailWorker\(order\.order_id\)/);
  assert.match(source,
    /shouldEmailCancellation && buyerEmailQueued && emailProcessingStarted/);
  assert.match(source, /shouldEmailCancellation && !buyerEmailQueued/);
  assert.match(source, /else if \(anyEmailQueued && !emailProcessingStarted\)/);
  assert.doesNotMatch(source,
    /buyer_notification_queued\s*&&\s*cancelResult\?\.seller_copy_queued/);
});

test("order cancellation RPC and inventory behavior remain unchanged", async () => {
  const source = await readFile(detailPath, "utf8");

  assert.match(source,
    /\.rpc\("cancel_order", \{[\s\S]*?p_order_id: order\.order_id/);
  assert.match(source,
    /p_restore_inventory: restoreInventoryOnCancel/);
  assert.match(source,
    /p_send_buyer_notification: shouldEmailCancellation/);
});
