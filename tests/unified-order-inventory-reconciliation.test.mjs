import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "../supabase/migrations/20260730200000_unified_order_inventory_reconciliation.sql",
  import.meta.url,
);
const manualOrderPath = new URL(
  "../app/dashboard/orders/new/new-manual-order.tsx",
  import.meta.url,
);
const editSavePath = new URL(
  "../app/dashboard/orders/_lib/order-edit-save.ts",
  import.meta.url,
);
const editorPath = new URL(
  "../app/dashboard/orders/_components/order-items-editor.tsx",
  import.meta.url,
);
const editOrderPath = new URL(
  "../app/dashboard/orders/[orderId]/edit/edit-order.tsx",
  import.meta.url,
);
const checkoutHandlerPath = new URL(
  "../supabase/functions/pay-at-pickup-order/handler.ts",
  import.meta.url,
);
const orderPredicatesPath = new URL(
  "../app/dashboard/orders/order-action-predicates.ts",
  import.meta.url,
);

test("the debit ledger is nullable-first and does not guess source-backed history", async () => {
  const source = await readFile(migrationPath, "utf8");

  assert.match(
    source,
    /add column if not exists inventory_debited_quantity integer;/,
  );
  assert.match(
    source,
    /where order_item_source = 'custom'[\s\S]*inventory_debited_quantity is null;/,
  );
  assert.doesNotMatch(
    source,
    /update public\.order_items[\s\S]{0,240}set inventory_debited_quantity = quantity[\s\S]{0,240}where order_item_source <> 'custom'/,
  );
  assert.match(
    source,
    /order_items_inventory_debited_quantity_range_check[\s\S]*not valid/,
  );
  assert.match(
    source,
    /order_items_restored_not_over_debited_check[\s\S]*not valid/,
  );
});

test("the private reconciler uses exact arithmetic and the canonical lock order", async () => {
  const source = await readFile(migrationPath, "utf8");
  const reconciler = source.slice(
    source.indexOf("create or replace function public.reconcile_order_inventory"),
    source.indexOf("create or replace function public.record_order_inventory_reconciliation"),
  );

  assert.match(
    reconciler,
    /when 'listing_inventory' then 1[\s\S]*when 'equipment_inventory' then 2[\s\S]*when 'processed_poultry_inventory' then 3[\s\S]*when 'hatching_egg_inventory' then 4/,
  );
  assert.match(
    reconciler,
    /if v_before_quantity < v_source\.quantity_delta then[\s\S]*raise exception 'Insufficient inventory quantity available\.'/,
  );
  assert.match(
    reconciler,
    /v_after_quantity := v_before_quantity - v_source\.quantity_delta;/,
  );
  assert.match(
    reconciler,
    /v_visibility_status = 'archived'[\s\S]*v_archived_at is not null/,
  );
  assert.doesNotMatch(reconciler, /greatest\s*\(\s*v_before_quantity\s*-/);
  assert.match(
    reconciler,
    /revoke all on function public\.reconcile_order_inventory\(uuid, text, jsonb\)[\s\S]*from public, anon, authenticated, service_role/,
  );
});

test("new checkout and manual orders classify complete debits atomically", async () => {
  const source = await readFile(migrationPath, "utf8");

  assert.match(
    source,
    /rename to create_pay_at_pickup_order_v2_batch_d_internal/,
  );
  assert.match(
    source,
    /rename to seller_create_manual_order_batch_d_internal/,
  );
  assert.match(
    source,
    /case when oi\.order_item_source = 'custom' then 0 else oi\.quantity end/g,
  );
  assert.match(
    source,
    /item_with_ordinality\.item - 'allow_inventory_override'/,
  );
  assert.match(
    source,
    /'public_checkout_created'/,
  );
  assert.match(
    source,
    /'manual_order_created'/,
  );
});

test("edit deltas come from persisted lines and browser choices are neutralized", async () => {
  const source = await readFile(migrationPath, "utf8");
  const editWrapper = source.slice(
    source.indexOf("create function public.seller_edit_order("),
    source.indexOf("alter function public.cancel_order("),
  );

  assert.match(
    editWrapper,
    /requested\.quantity - existing\.quantity/,
  );
  assert.match(
    editWrapper,
    /-existing\.inventory_debited_quantity/,
  );
  assert.match(
    editWrapper,
    /item_with_ordinality\.item - 'change_inventory'/,
  );
  assert.match(
    editWrapper,
    /jsonb_build_object\('change_inventory', false\)/,
  );
  assert.match(
    editWrapper,
    /Order inventory requires operational reconciliation before editing\./,
  );
  assert.doesNotMatch(editWrapper, /greatest\s*\([^)]*quantity_delta/);
});

test("cancellation restores only debited, unfulfilled, unrestored quantity", async () => {
  const source = await readFile(migrationPath, "utf8");
  const cancellation = source.slice(
    source.indexOf("create function public.cancel_order("),
    source.indexOf("alter function public.reinstate_order("),
  );

  assert.match(
    cancellation,
    /oi\.inventory_debited_quantity\s*-\s*oi\.fulfilled_quantity\s*-\s*oi\.restored_quantity/,
  );
  assert.match(
    cancellation,
    /'quantity_delta', -change\.restorable_quantity/,
  );
  assert.match(
    cancellation,
    /set restored_quantity = oi\.restored_quantity \+ change\.restorable_quantity/,
  );
  assert.match(
    cancellation,
    /cancel_order_batch_d_internal\([\s\S]*false,[\s\S]*p_send_buyer_notification/,
  );
});

test("reinstatement covers every source, consumes restored quantities, and resets after success", async () => {
  const source = await readFile(migrationPath, "utf8");
  const reinstatement = source.slice(
    source.indexOf("create function public.reinstate_order("),
    source.indexOf("-- The unversioned checkout RPC"),
  );

  for (const itemType of [
    "listing_inventory",
    "equipment_inventory",
    "processed_poultry_inventory",
    "hatching_egg_inventory",
  ]) {
    assert.match(reinstatement, new RegExp(itemType));
  }
  assert.match(
    reinstatement,
    /'quantity_delta', change\.restored_quantity/,
  );
  assert.match(
    reinstatement,
    /set restored_quantity = 0[\s\S]*change\.restored_quantity > 0/,
  );
  assert.match(
    reinstatement,
    /visibility_status <> 'archived'/,
  );
  assert.match(
    reinstatement,
    /archived_at is null/,
  );
  assert.match(
    reinstatement,
    /One or more inventory items cannot be reinstated\./,
  );
});

test("historical and unversioned unsafe overloads remain uncallable", async () => {
  const source = await readFile(migrationPath, "utf8");

  assert.match(
    source,
    /p\.proname in \([\s\S]*'seller_create_manual_order'[\s\S]*'seller_edit_order'[\s\S]*'cancel_order'[\s\S]*'reinstate_order'[\s\S]*'create_pay_at_pickup_order'/,
  );
  assert.match(
    source,
    /revoke all on function %s from public, anon, authenticated, service_role/,
  );
  assert.match(
    source,
    /grant execute on function public\.create_pay_at_pickup_order_v2[\s\S]*to service_role/,
  );
});

test("order UIs no longer submit inventory-authority flags or expose opt-outs", async () => {
  const [manual, editSave, editor, editOrder] = await Promise.all([
    readFile(manualOrderPath, "utf8"),
    readFile(editSavePath, "utf8"),
    readFile(editorPath, "utf8"),
    readFile(editOrderPath, "utf8"),
  ]);

  assert.doesNotMatch(manual, /allow_inventory_override/);
  assert.doesNotMatch(editSave, /change_inventory/);
  assert.doesNotMatch(editSave, /allowInventoryOversell:\s*true/);
  assert.doesNotMatch(editor, /allowInventoryOversell/);
  assert.doesNotMatch(editor, /InventoryAdjustmentCheckbox/);
  assert.doesNotMatch(editOrder, /inventoryAdjustmentChoices/);
  assert.match(
    editor,
    /Quantity exceeds available inventory and cannot be saved\./,
  );
});

test("the checkout Edge handler remains on the secured V2 creation path", async () => {
  const source = await readFile(checkoutHandlerPath, "utf8");

  assert.match(
    source,
    /const orderRpcName = "create_pay_at_pickup_order_v2";/,
  );
  assert.doesNotMatch(source, /uses_order_v2/);
  assert.doesNotMatch(
    source,
    /orderRpcName[\s\S]{0,120}\? "create_pay_at_pickup_order_v2"/,
  );
});

test("paid Stripe-backed orders are blocked from the edit surface and RPC", async () => {
  const [migration, predicates] = await Promise.all([
    readFile(migrationPath, "utf8"),
    readFile(orderPredicatesPath, "utf8"),
  ]);

  assert.match(
    migration,
    /v_order\.payment_method = 'stripe_checkout'[\s\S]*v_order\.payment_status <> 'unpaid'[\s\S]*Paid online orders cannot be edited\./,
  );
  assert.match(
    predicates,
    /order\.payment_method === "stripe_checkout"[\s\S]*order\.payment_status !== "unpaid"/,
  );
});
