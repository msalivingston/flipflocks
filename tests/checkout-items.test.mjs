import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { normalizeCheckoutItems } from "../supabase/functions/_shared/checkout-items.ts";

const adult = "f1000000-0000-4000-8000-000000000231";
const chick = "f1000000-0000-4000-8000-000000000230";

test("supported current, legacy, and matching identifiers have one canonical representation", () => {
  const expected = [{ item_type: "listing_inventory", item_id: adult, quantity: 10 }];
  for (const item of [
    { item_type: "listing_inventory", item_id: adult, quantity: 10 },
    { inventory_item_id: adult, quantity: 10 },
    { item_type: "listing_inventory", item_id: adult.toUpperCase(), inventory_item_id: adult, quantity: 10 },
    { item_type: "listing_inventory", item_id: null, inventory_item_id: adult, quantity: 10 },
  ]) assert.deepEqual(normalizeCheckoutItems([item]), expected);
});

test("conflicting inventory IDs or types are rejected, including the ten-bird bypass", () => {
  for (const item of [
    { item_type: "listing_inventory", item_id: adult, inventory_item_id: chick, quantity: 1 },
    { item_type: "listing_inventory", item_id: chick, inventory_item_id: adult, quantity: 1 },
    { item_type: "equipment_inventory", item_id: adult, inventory_item_id: adult, quantity: 10 },
    { item_type: "listing_inventory", item_id: adult, inventory_item_type: "hatching_egg_inventory", quantity: 10 },
  ]) assert.throws(() => normalizeCheckoutItems([item]), /Conflicting or ambiguous inventory identifiers/);
});

test("normalization preserves mixed listing quantities and rejects invalid quantities", () => {
  const items = [{ item_type: "listing_inventory", item_id: adult, quantity: 6 },
    { item_type: "listing_inventory", item_id: chick, quantity: 4 }];
  assert.deepEqual(normalizeCheckoutItems(items), items);
  for (const quantity of [0, -1, 1.5, "10", null, 2147483648, NaN]) {
    assert.throws(() => normalizeCheckoutItems([{ ...items[0], quantity }]), /positive integer/);
  }
});

test("card checkout uses the same normalized items for summary and reservation", () => {
  const source = readFileSync(new URL("../supabase/functions/stripe-connect-checkout/index.ts", import.meta.url), "utf8");
  const normalized = source.indexOf("start.items = normalizeCheckoutItems(start.items)");
  assert.ok(normalized > 0 && normalized < source.indexOf('service.rpc("get_public_checkout_summary"'));
  assert.equal(source.match(/p_items: start\.items/g)?.length, 3); // summary, coupon preview, reservation
  assert.equal(source.match(/normalizeCheckoutItems\(start\.items\)/g)?.length, 1);
});
