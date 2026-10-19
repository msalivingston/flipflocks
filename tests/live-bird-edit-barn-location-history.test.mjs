import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [editForm, orderDetail, migration] = await Promise.all([
  readFile(
    new URL("../app/dashboard/inventory/add-v2/live-birds/page.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../app/dashboard/orders/[orderId]/order-detail.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL(
      "../supabase/migrations/20261016110000_live_bird_barn_location_order_operations.sql",
      import.meta.url,
    ),
    "utf8",
  ),
]);

test("Live Birds Edit loads, validates, saves, and reloads barn and feather fields", () => {
  assert.match(editForm, /barnLocation: row\.barn_location \?\? ""/);
  assert.match(editForm, /featherCondition: row\.feather_condition \?\? ""/);
  assert.match(editForm, /Barn Location for \$\{label\} must be 200 characters/);
  assert.match(editForm, /Choose a valid Feather Condition value/);
  assert.match(editForm, /p_barn_location: offering\.barnLocation\.trim\(\) \|\| null/);
  assert.match(editForm, /p_feather_condition: offering\.featherCondition \|\| null/);
  assert.match(editForm, /p_update_advanced_attributes: true/);
  assert.match(editForm, /refreshEditListingState/);
  assert.match(editForm, /barn location changed/);
  assert.match(editForm, /feather condition changed/);
});

test("barn moves update only active, unpicked reservation quantities", () => {
  assert.match(migration, /add column barn_location text/);
  assert.match(migration, /new\.barn_location/);
  assert.match(migration, /orders\.order_status in \('pending', 'open'\)/);
  assert.match(
    migration,
    /order_items\.quantity > order_items\.fulfilled_quantity \+ order_items\.canceled_quantity/,
  );
  assert.match(migration, /set barn_location = v_updated_item\.barn_location/);
  assert.doesNotMatch(
    migration,
    /set\s+(?:unit_price_snapshot|quantity|line_subtotal|total_amount)\s*=/,
  );
});

test("new orders snapshot barn and feather fields, while order detail reads the saved reservation location", () => {
  assert.match(migration, /new\.feather_condition_snapshot/);
  assert.match(migration, /new\.barn_location/);
  assert.match(orderDetail, /custom_inventory_label_snapshot, barn_location, breeding_history_snapshot/);
  assert.doesNotMatch(orderDetail, /from\("seller_inventory_management"\)/);
});
