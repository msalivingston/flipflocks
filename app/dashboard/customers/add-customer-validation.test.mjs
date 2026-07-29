import assert from "node:assert/strict";
import test from "node:test";
import {
  findPossibleDuplicate,
  formatPhoneNumber,
  validateAddCustomer,
} from "./add-customer-validation.ts";

const blankValues = {
  firstName: "",
  lastName: "",
  businessName: "",
  phone: "",
  email: "",
  street: "",
  city: "",
  state: "",
  postalCode: "",
  notes: "",
};

test("first and last name are required", () => {
  assert.deepEqual(validateAddCustomer(blankValues), {
    firstName: "Enter the customer’s first name.",
    lastName: "Enter the customer’s last name.",
  });
  assert.deepEqual(
    validateAddCustomer({
      ...blankValues,
      firstName: "Sam",
      lastName: "Miller",
    }),
    {},
  );
});

test("optional phone and email validate only when entered", () => {
  assert.deepEqual(
    validateAddCustomer({
      ...blankValues,
      firstName: "Sam",
      lastName: "Miller",
      phone: "555",
      email: "not-an-email",
    }),
    {
      phone: "Enter a 10-digit phone number.",
      email: "Enter a valid email address.",
    },
  );
});

test("phone formatting is supported", () => {
  assert.equal(formatPhoneNumber("9707658099"), "(970) 765-8099");
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
