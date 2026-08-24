import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "../supabase/migrations/20260823140000_restore_canceled_order_as_new.sql",
  import.meta.url,
);
const detailPath = new URL(
  "../app/dashboard/orders/[orderId]/order-detail.tsx",
  import.meta.url,
);
const newOrderPath = new URL(
  "../app/dashboard/orders/new/new-manual-order.tsx",
  import.meta.url,
);
const newOrderPagePath = new URL(
  "../app/dashboard/orders/new/page.tsx",
  import.meta.url,
);
const predicatePath = new URL(
  "../app/dashboard/orders/order-action-predicates.ts",
  import.meta.url,
);

const [migration, detail, newOrder, newOrderPage, predicates] = await Promise.all(
  [migrationPath, detailPath, newOrderPath, newOrderPagePath, predicatePath].map(
    (path) => readFile(path, "utf8"),
  ),
);

test("Restore Order appears for canceled orders", () => {
  assert.match(predicates, /canOfferRestoreOrder[\s\S]*return isCanceledOrder/);
  assert.match(detail, /showRestoreAction = canOfferRestoreOrder/);
  assert.match(detail, /label="Restore Order"/);
});

test("restore eligibility is loaded only when the canceled action is offered", () => {
  assert.match(
    detail,
    /if \(!seller \|\| !order \|\| !showRestoreAction\)[\s\S]*return;/,
  );
  assert.match(detail, /seller_get_order_restore_draft/);
});

test("short inventory makes Restore unavailable", () => {
  assert.match(
    migration,
    /coalesce\(status\.quantity_available, 0\) < status\.required_quantity/,
  );
  assert.match(migration, /else 'insufficient_inventory'/);
});

test("a missing exact source makes Restore unavailable", () => {
  assert.match(migration, /inventory\.id is not null/);
  assert.match(migration, /equipment\.id is not null/);
  assert.match(migration, /product\.id is not null/);
  assert.match(migration, /eggs\.id is not null/);
  assert.match(migration, /then 'source_unavailable'/);
});

test("wrong-store orders and sources are rejected", () => {
  assert.match(migration, /owns_store\(v_source_order\.store_id\)/);
  assert.match(migration, /inventory\.store_id = v_source_order\.store_id/);
  assert.match(migration, /equipment\.store_id = v_source_order\.store_id/);
  assert.match(migration, /product\.store_id = v_source_order\.store_id/);
  assert.match(migration, /eggs\.store_id = v_source_order\.store_id/);
});

test("custom lines do not participate in inventory requirements", () => {
  const requirements = migration.slice(
    migration.indexOf("with required_sources as"),
    migration.indexOf("v_reasons := v_reasons || v_inventory_reasons"),
  );
  assert.doesNotMatch(requirements, /custom_item_name_snapshot/);
  assert.match(migration, /'item_type', 'custom'/);
});

test("duplicate exact UUID quantities are combined", () => {
  assert.match(migration, /sum\(order_item\.quantity\)::integer as required_quantity/g);
  assert.match(migration, /group by order_item\.inventory_item_id/);
  assert.match(migration, /group by order_item\.equipment_inventory_item_id/);
});

test("confirmation copy is correct", () => {
  assert.match(
    detail,
    /A new order will be created from this canceled order\. The original[\s\S]*order will remain canceled\./,
  );
  assert.match(detail, />\s*Cancel\s*</);
  assert.match(detail, />\s*Continue\s*</);
});

test("Continue opens the normal New Order route", () => {
  assert.match(detail, /dashboard\/orders\/new\?restore_from=/);
  assert.match(newOrderPage, /restore_from/);
  assert.match(newOrderPage, /<NewManualOrder restoreFromOrderId=/);
});

test("prefill loads the current customer", () => {
  assert.match(migration, /from public\.customers as customer/);
  assert.match(newOrder, /setSelectedCustomer\(draft\.customer/);
});

test("prefill loads exact inventory identity, quantity, and saved price", () => {
  assert.match(newOrder, /inventoryItemId: draftItem\.source_id/);
  assert.match(newOrder, /inventoryItemType: draftItem\.item_type/);
  assert.match(newOrder, /quantity: String\(draftItem\.quantity\)/);
  assert.match(newOrder, /formatMoneyInput\(draftItem\.unit_price\)/);
});

test("prefill loads custom lines", () => {
  assert.match(newOrder, /draftItem\.item_type === "custom"/);
  assert.match(newOrder, /customItemName: draftItem\.item_name/);
});

test("prefill loads buyer and pickup notes", () => {
  assert.match(newOrder, /setBuyerNotes\(draft\.buyer_notes/);
  assert.match(newOrder, /setPickupNote\([\s\S]*draft\.pickup_note/);
});

test("an active exact pickup option is reused", () => {
  assert.match(migration, /pickup\.id = v_source_order\.pickup_option_id/);
  assert.match(migration, /pickup\.is_active = true/);
  assert.match(newOrder, /setPickupOptionId\([\s\S]*draft\.pickup_option_id/);
});

test("an invalid pickup option is left unset", () => {
  assert.match(newOrder, /draft\.pickup_option_id \?\? ""/);
  assert.match(migration, /into v_pickup_option_id[\s\S]*pickup\.is_active = true/);
});

test("every restored draft submits through the normal manual-order RPC", () => {
  assert.match(newOrder, /const result = await supabase\.rpc\("seller_create_manual_order"/);
  assert.doesNotMatch(newOrder, /seller_restore_canceled_order/);
  assert.doesNotMatch(newOrder, /seller_create_order_from_canceled_draft/);
  assert.doesNotMatch(newOrder, /getRestoreItemsSignature|isUnchangedRestoreDraft/);
});

test("normal New Order behavior remains unchanged", () => {
  assert.match(newOrder, /restoreFromOrderId\s*\?[\s\S]*seller_get_order_restore_draft/);
  assert.match(newOrder, /: Promise\.resolve\(\{ data: null, error: null \}\)/);
  assert.doesNotMatch(migration, /restored_from_order_id/);
  assert.doesNotMatch(migration, /create function public\.seller_.*create/);
});
