import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { couponThenManualDiscount, normalizeCouponCode, normalizeCouponEmail } from "../lib/coupons.ts";
import { splitDiscountedLine, isCompletedCouponCheckout } from "../supabase/functions/_shared/coupon-checkout.ts";

test("shared codes and customer emails normalize without changing provider aliases", () => {
  assert.equal(normalizeCouponCode(" survey10 "), "SURVEY10");
  assert.equal(normalizeCouponEmail(" Buyer+reward@Example.COM "), "buyer+reward@example.com");
});
test("coupon applies first, followed by manual percentage discount", () => {
  assert.deepEqual(couponThenManualDiscount(60,60,"fixed",10,"percent",10), {coupon:10,manual:5,subtotal:45});
  assert.deepEqual(couponThenManualDiscount(100,40,"percent",25,"fixed",20), {coupon:10,manual:20,subtotal:70});
});
test("discounts are capped to eligible merchandise and the remaining order", () => {
  assert.deepEqual(couponThenManualDiscount(15,5,"fixed",10,"fixed",99), {coupon:5,manual:10,subtotal:0});
  assert.deepEqual(couponThenManualDiscount(10,10,"percent",100,"percent",100), {coupon:10,manual:0,subtotal:0});
});
test("Stripe unit splitting retains quantities and every cent", () => {
  for (const [amount,quantity] of [[5000,3],[0,3],[1,3],[999,7],[1000,1]]) {
    const lines=splitDiscountedLine(amount,quantity);
    assert.equal(lines.reduce((n,l)=>n+l.quantity,0),quantity);
    assert.equal(lines.reduce((n,l)=>n+l.quantity*l.unit_amount,0),amount);
    assert.ok(lines.length<=2);
  }
  assert.throws(()=>splitDiscountedLine(-1,1));
  assert.throws(()=>splitDiscountedLine(1,0));
});
test("completed free sessions need no PaymentIntent, positive sessions still need payment", () => {
  assert.equal(isCompletedCouponCheckout({status:"complete",payment_status:"no_payment_required",amount_total:0}),true);
  assert.equal(isCompletedCouponCheckout({status:"complete",payment_status:"no_payment_required",amount_total:1}),false);
  assert.equal(isCompletedCouponCheckout({status:"open",payment_status:"paid",amount_total:100}),false);
  assert.equal(isCompletedCouponCheckout({status:"complete",payment_status:"paid",amount_total:100}),true);
});
test("Coupons follows Payment Methods and is not plan-gated or in sidebar navigation", () => {
  const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");
  const setup=read("app/dashboard/store-admin/store-admin.tsx");
  assert.match(setup,/id: "payment-methods", label: "Payment Methods"[^]*?id: "coupons", label: "Coupons"/);
  assert.match(setup,/activeTab === "coupons" \? <DynamicCouponsTab/);
  const tab=read("app/dashboard/store-admin/coupons-tab.tsx");
  assert.doesNotMatch(tab,/getPlanCapabilities|PlanUpgrade|usage_limit|batch.generate/);
  assert.match(tab,/seller_save_coupon/);
});
