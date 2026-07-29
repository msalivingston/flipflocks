import assert from "node:assert/strict";
import test from "node:test";
import {
  findPossibleDuplicate,
  formatPhoneNumber,
  splitCustomerName,
  validateAddCustomer,
} from "./add-customer-validation.ts";

const blankValues = {
  name: "",
  phone: "",
  email: "",
  street: "",
  city: "",
  state: "",
  postalCode: "",
  notes: "",
};

test("only name is required", () => {
  assert.deepEqual(validateAddCustomer(blankValues), {
    name: "Enter the customer’s name.",
  });
  assert.deepEqual(validateAddCustomer({ ...blankValues, name: "Sam" }), {});
});

test("optional phone and email validate only when entered", () => {
  assert.deepEqual(
    validateAddCustomer({
      ...blankValues,
      name: "Sam",
      phone: "555",
      email: "not-an-email",
    }),
    {
      phone: "Enter a 10-digit phone number.",
      email: "Enter a valid email address.",
    },
  );
});

test("phone formatting and single-word names are supported", () => {
  assert.equal(formatPhoneNumber("9707658099"), "(970) 765-8099");
  assert.deepEqual(splitCustomerName("Prince"), {
    firstName: "Prince",
    lastName: null,
  });
});

test("duplicate matching normalizes email and phone", () => {
  const customer = {
    id: "customer-1",
    email: "sam@example.com",
    phone: "(970) 765-8099",
  };
  assert.equal(
    findPossibleDuplicate([customer], {
      email: " SAM@example.com ",
      phone: "",
    }),
    customer,
  );
  assert.equal(
    findPossibleDuplicate([customer], {
      email: "",
      phone: "970-765-8099",
    }),
    customer,
  );
});
