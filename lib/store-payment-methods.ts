export type StorefrontPaymentMethod = "pay_at_pickup" | "stripe_checkout";

export type BuyerPaymentAvailability = {
  availableMethods: StorefrontPaymentMethod[];
  checkoutBlocked: boolean;
  defaultMethod: StorefrontPaymentMethod;
  unavailableMessage: string | null;
};

export function resolveBuyerPaymentAvailability({
  cardPaymentsEnabled,
  cardPaymentsReady,
  payAtPickupEnabled,
}: {
  cardPaymentsEnabled: boolean;
  cardPaymentsReady: boolean;
  payAtPickupEnabled: boolean;
}): BuyerPaymentAvailability {
  const availableMethods: StorefrontPaymentMethod[] = [];

  if (cardPaymentsEnabled && cardPaymentsReady) {
    availableMethods.push("stripe_checkout");
  }

  if (payAtPickupEnabled) {
    availableMethods.push("pay_at_pickup");
  }

  const checkoutBlocked = availableMethods.length === 0;

  return {
    availableMethods,
    checkoutBlocked,
    defaultMethod:
      !payAtPickupEnabled && cardPaymentsEnabled
        ? "stripe_checkout"
        : "pay_at_pickup",
    unavailableMessage: checkoutBlocked
      ? cardPaymentsEnabled
        ? "Online payment is temporarily unavailable. This store does not offer Pay at Pickup, so checkout cannot be completed right now."
        : "This store does not currently have a payment method available."
      : null,
  };
}
