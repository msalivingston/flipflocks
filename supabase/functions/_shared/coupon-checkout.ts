type CheckoutPaymentState = { status: string | null; payment_status: string; amount_total: number | null };
export function isCompletedCouponCheckout(session: CheckoutPaymentState) {
  return session.status === "complete" && (session.payment_status === "paid" ||
    (session.payment_status === "no_payment_required" && session.amount_total === 0));
}

// A line's cent total may not divide evenly by its quantity. Preserve both the
// quantity and exact total by splitting into at most two adjacent unit prices.
export function splitDiscountedLine(totalCents: number, quantity: number) {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0 || !Number.isSafeInteger(quantity) || quantity < 1) throw new Error("Invalid discounted line.");
  const unit = Math.floor(totalCents / quantity), remainder = totalCents % quantity;
  return [
    ...(quantity > remainder ? [{ unit_amount: unit, quantity: quantity - remainder }] : []),
    ...(remainder ? [{ unit_amount: unit + 1, quantity: remainder }] : []),
  ];
}
