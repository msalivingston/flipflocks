import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { validateCheckout } from "./checkout-validation.ts";

const completeForm = {
  buyerEmail: "buyer@example.com",
  buyerFirstName: "Buyer",
  buyerLastName: "Example",
  buyerPhone: "555-555-0100",
  addressLine1: "1 Main Street",
  city: "Denver",
  state: "CO",
  postalCode: "80202",
  pickupOptionId: "",
  fulfillmentMethod: "pickup",
  deliveryOptionId: "",
};

for (const fulfillmentMethod of ["pickup", "delivery"]) {
  test(`${fulfillmentMethod} accepts complete contact and address data`, () => {
    const form = {
      ...completeForm,
      fulfillmentMethod,
      deliveryOptionId: fulfillmentMethod === "delivery" ? "delivery-1" : "",
    };

    assert.equal(
      validateCheckout({
        form,
        requirePickupOption: false,
        scope: "all",
      }),
      null,
    );
  });

  for (const field of ["addressLine1", "city", "state", "postalCode"]) {
    test(`${fulfillmentMethod} rejects a missing ${field}`, () => {
      const form = {
        ...completeForm,
        fulfillmentMethod,
        deliveryOptionId: fulfillmentMethod === "delivery" ? "delivery-1" : "",
        [field]: " ",
      };

      assert.deepEqual(
        validateCheckout({
          form,
          requirePickupOption: false,
          scope: "all",
        }),
        {
          field,
          message:
            fulfillmentMethod === "delivery"
              ? "Please complete your delivery address."
              : "Please complete your pickup contact address.",
          step: "fulfillment",
        },
      );
    });
  }
}

for (const field of [
  "buyerFirstName",
  "buyerLastName",
  "buyerEmail",
  "buyerPhone",
]) {
  test(`checkout rejects a missing ${field} before fulfillment`, () => {
    assert.deepEqual(
      validateCheckout({
        form: { ...completeForm, [field]: "" },
        requirePickupOption: false,
        scope: "all",
      }),
      {
        field,
        message: "Please complete your contact information.",
        step: "contact",
      },
    );
  });
}

test("fulfillment scope applies the same address contract without rechecking contact", () => {
  assert.equal(
    validateCheckout({
      form: { ...completeForm, buyerEmail: "" },
      requirePickupOption: false,
      scope: "fulfillment",
    }),
    null,
  );
  assert.equal(
    validateCheckout({
      form: { ...completeForm, addressLine1: "" },
      requirePickupOption: false,
      scope: "contact",
    }),
    null,
  );
});

test("fulfillment options are validated before the shared address fields", () => {
  assert.deepEqual(
    validateCheckout({
      form: { ...completeForm, pickupOptionId: "", addressLine1: "" },
      requirePickupOption: true,
      scope: "fulfillment",
    }),
    {
      field: "pickupOptionId",
      message: "Please choose a pickup option.",
      step: "fulfillment",
    },
  );

  assert.deepEqual(
    validateCheckout({
      form: {
        ...completeForm,
        fulfillmentMethod: "delivery",
        deliveryOptionId: "",
        addressLine1: "",
      },
      requirePickupOption: false,
      scope: "fulfillment",
    }),
    {
      field: "deliveryOptionId",
      message: "Please choose a delivery option.",
      step: "fulfillment",
    },
  );
});

test("mobile pickup renders contact-address fields and all checkout paths share validation", () => {
  const source = readFileSync(
    resolve(import.meta.dirname, "checkout-page.tsx"),
    "utf8",
  );
  const mobileFulfillment = source.slice(
    source.indexOf('title="Pickup or delivery"'),
    source.indexOf('title="Review your order"'),
  );

  assert.match(mobileFulfillment, /"Pickup contact address"/);
  assert.match(
    mobileFulfillment,
    /Pickup will follow the\s+seller&apos;s pickup details\./,
  );
  assert.doesNotMatch(mobileFulfillment, /Pickup delivery address/);
  for (const field of ["addressLine1", "city", "state", "postalCode"]) {
    assert.match(mobileFulfillment, new RegExp(`name="${field}"`));
  }

  assert.match(
    source,
    /handleContactContinue\(\)[\s\S]*validateCheckoutPath\("contact"\)/,
  );
  assert.match(
    source,
    /handleFulfillmentContinue\(\)[\s\S]*validateCheckoutPath\("fulfillment"\)/,
  );
  assert.match(
    source,
    /handleReviewSubmit\(\)[\s\S]*validateCheckoutPath\("all"\)[\s\S]*void submitOrder\(\)/,
  );
  assert.match(
    source,
    /handleSubmit\(event: FormEvent<HTMLFormElement>\)[\s\S]*handleReviewSubmit\(\)/,
  );
});
