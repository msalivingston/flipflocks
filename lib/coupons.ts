export type CouponScope = "order" | "products" | "breeds" | "categories";
export type CouponTarget = string | { item_type: string; item_id: string };
export type SellerCoupon = {
  id: string; code: string; discount_type: "fixed" | "percent";
  discount_value: number; scope: CouponScope; targets: CouponTarget[];
  minimum_purchase: number; expires_on: string | null;
  once_per_customer: boolean; is_active: boolean;
};
export const couponCategories = [
  { value: "listing_inventory", label: "Live birds" },
  { value: "hatching_egg_inventory", label: "Hatching eggs" },
  { value: "processed_poultry_inventory", label: "Poultry Products" },
  { value: "equipment_inventory", label: "Equipment & Supplies" },
];
export function normalizeCouponCode(code: string) { return code.trim().toUpperCase(); }
export function normalizeCouponEmail(email: string) { return email.trim().toLowerCase(); }
// Preview only. The database recalculates and validates final discounts.
export function couponThenManualDiscount(gross: number, eligible: number, type: "fixed" | "percent", value: number, manualType: "fixed" | "percent", manualValue: number) {
  const cents = (amount: number) => Math.round(Math.max(amount, 0) * 100);
  const grossCents = cents(gross), eligibleCents = Math.min(grossCents, cents(eligible));
  const coupon = Math.min(eligibleCents, type === "percent" ? Math.round(eligibleCents * Math.min(Math.max(value, 0), 100) / 100) : cents(value));
  const remaining = grossCents - coupon;
  const manual = Math.min(remaining, manualType === "percent" ? Math.round(remaining * Math.min(Math.max(manualValue, 0), 100) / 100) : cents(manualValue));
  return { coupon: coupon / 100, manual: manual / 100, subtotal: (remaining - manual) / 100 };
}
