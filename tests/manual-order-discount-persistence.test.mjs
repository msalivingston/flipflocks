import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { couponThenManualDiscount } from "../lib/coupons.ts";

function loadModule(path, dependencies = {}) {
  const filename = new URL(path, import.meta.url);
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename.pathname,
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)(
    (name) => dependencies[name] ?? {}, module, module.exports,
  );
  return module.exports;
}

const calculations = loadModule("../app/dashboard/orders/_lib/order-form-calculations.ts");
const { buildEditOrderPayload } = loadModule(
  "../app/dashboard/orders/_lib/order-edit-save.ts",
  {
    "./order-form-calculations": calculations,
    "./order-form-inventory": { getManualOrderPayloadItemType: (line) => line.inventoryItemType },
  },
);

function payload(quantity, unitPrice, manualType = "fixed", manualValue = 10, couponCode = "") {
  return buildEditOrderPayload({
    couponCode,
    manualDiscountType: manualType,
    manualDiscountValue: manualValue,
    buyerNotes: "",
    customer: { customerId: null, email: "buyer@example.test", firstName: "Buyer", lastName: "Test", phone: null },
    deliveryAddress: { line1: "", line2: "", city: "", state: "", postalCode: "", country: "US" },
    deliveryFee: 0,
    deliveryOption: undefined,
    deliveryOptionId: "",
    discountAmount: 10,
    fulfillmentMethod: "pickup",
    inventory: [],
    lines: [{ type: "custom", id: "line-1", orderItemId: "saved-line-1", customItemName: "Feed", customItemDescription: "", inventoryItemId: "", inventoryItemType: "", quantity: String(quantity), search: "", unitPrice: String(unitPrice) }],
    orderId: "order-1",
    originalLines: [],
    pickupNote: "",
    pickupOptionId: "",
    savedDeliveryOptionId: "",
    taxAmount: 2.5,
  });
}

test("fixed-dollar manual discount persists apart from original prices and tax", () => {
  const result = payload(2, 20);
  assert.equal(result.p_items[0].unit_price, 20);
  assert.equal(result.p_items[0].quantity, 2);
  assert.equal(result.p_manual_discount_type, "fixed");
  assert.equal(result.p_manual_discount_value, 10);
  assert.equal(result.p_coupon_code, "");
  assert.equal(result.p_tax_fee_amount, 2.5);
});

test("percentage, coupon, and combined discounts retain distinct intents", () => {
  const percent = payload(2, 20, "percent", 25);
  assert.equal(percent.p_manual_discount_type, "percent");
  assert.equal(percent.p_manual_discount_value, 25);
  const coupon = payload(2, 20, "fixed", 0, "SAVE10");
  assert.equal(coupon.p_coupon_code, "SAVE10");
  assert.equal(coupon.p_manual_discount_value, 0);
  const combined = payload(2, 20, "percent", 25, "SAVE10");
  assert.equal(combined.p_items[0].unit_price, 20);
  assert.deepEqual(couponThenManualDiscount(40, 40, "fixed", 10, "percent", 25), {
    coupon: 10, manual: 7.5, subtotal: 22.5,
  });
});

test("repeated quantity and price edits retain original selling prices and fixed discount", () => {
  const first = payload(3, 20);
  const second = payload(3, 25);
  assert.equal(first.p_items[0].unit_price, 20);
  assert.equal(second.p_items[0].unit_price, 25);
  assert.equal(first.p_manual_discount_value, 10);
  assert.equal(second.p_manual_discount_value, 10);
  assert.equal(first.p_tax_fee_amount, second.p_tax_fee_amount);
});

test("new manual orders send original prices and both discount inputs", () => {
  const source = readFileSync(new URL("../app/dashboard/orders/new/new-manual-order.tsx", import.meta.url), "utf8");
  assert.match(source, /p_coupon_code: couponCode\.trim\(\)/);
  assert.match(source, /p_manual_discount_value: Number\(discountValue \|\| 0\)/);
  assert.match(source, /unit_price: Number\(line\.unitPrice\)/);
  assert.doesNotMatch(source, /distributeDiscount|discountedUnitPrice/);
});
