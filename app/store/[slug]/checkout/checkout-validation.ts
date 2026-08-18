export type CheckoutFulfillmentMethod = "pickup" | "delivery";
export type CheckoutPaymentMethod = "pay_at_pickup" | "stripe_checkout";

export type CheckoutValidationValues = {
  buyerEmail: string;
  buyerFirstName: string;
  buyerLastName: string;
  buyerPhone: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  pickupOptionId: string;
  fulfillmentMethod: CheckoutFulfillmentMethod;
  deliveryOptionId: string;
};

export type CheckoutValidationScope = "contact" | "fulfillment" | "all";

export type CheckoutValidationIssue = {
  field: keyof CheckoutValidationValues;
  message: string;
  step: "contact" | "fulfillment";
};

const requiredContactFields: Array<keyof CheckoutValidationValues> = [
  "buyerFirstName",
  "buyerLastName",
  "buyerEmail",
  "buyerPhone",
];

const requiredAddressFields: Array<keyof CheckoutValidationValues> = [
  "addressLine1",
  "city",
  "state",
  "postalCode",
];

const requiredPayAtPickupAddressFields: Array<keyof CheckoutValidationValues> = [
  "city",
  "postalCode",
];

export function validateCheckout({
  form,
  paymentMethod,
  requirePickupOption,
  scope,
}: {
  form: CheckoutValidationValues;
  paymentMethod: CheckoutPaymentMethod;
  requirePickupOption: boolean;
  scope: CheckoutValidationScope;
}): CheckoutValidationIssue | null {
  if (scope === "contact" || scope === "all") {
    const missingContactField = requiredContactFields.find(
      (field) => !form[field].trim(),
    );

    if (missingContactField) {
      return {
        field: missingContactField,
        message: "Please complete your contact information.",
        step: "contact",
      };
    }
  }

  if (scope === "fulfillment" || scope === "all") {
    if (
      form.fulfillmentMethod === "pickup" &&
      requirePickupOption &&
      !form.pickupOptionId.trim()
    ) {
      return {
        field: "pickupOptionId",
        message: "Please choose a pickup option.",
        step: "fulfillment",
      };
    }

    if (
      form.fulfillmentMethod === "delivery" &&
      !form.deliveryOptionId.trim()
    ) {
      return {
        field: "deliveryOptionId",
        message: "Please choose a delivery option.",
        step: "fulfillment",
      };
    }

    const addressFields =
      paymentMethod === "pay_at_pickup"
        ? requiredPayAtPickupAddressFields
        : requiredAddressFields;
    const missingAddressField = addressFields.find(
      (field) => !form[field].trim(),
    );

    if (missingAddressField) {
      return {
        field: missingAddressField,
        message:
          paymentMethod === "pay_at_pickup"
            ? "Please enter your city and ZIP Code."
            : "Please complete your billing address.",
        step: "fulfillment",
      };
    }
  }

  return null;
}
