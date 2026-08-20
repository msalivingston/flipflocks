import assert from "node:assert/strict";
import test from "node:test";
import {
  customerDuplicateMatchLabel,
  formatPhoneNumber,
  normalizeEmail,
  normalizePhone,
  revealCustomerDuplicateWarning,
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
      phone:
        "Enter a 10-digit US/Canada phone number or begin an international number with +.",
      email: "Enter a valid email address.",
    },
  );
});

test("phone formatting is supported", () => {
  assert.equal(formatPhoneNumber("9707658099"), "970-765-8099");
});

test("customer phone validation accepts international intent and rejects overflow", () => {
  const base = { ...blankValues, firstName: "Sam", lastName: "Miller" };
  assert.deepEqual(validateAddCustomer({ ...base, phone: "+44 20 7946 0958" }), {});
  assert.deepEqual(validateAddCustomer({ ...base, phone: "97076580990" }), {
    phone:
      "Enter a 10-digit US/Canada phone number or begin an international number with +.",
  });
});

test("duplicate lookup inputs normalize email and phone consistently", () => {
  assert.equal(normalizeEmail(" SAM@example.com "), "sam@example.com");
  assert.equal(normalizePhone("+1 (970) 765-8099"), "9707658099");
});

test("duplicate warning labels identify the matching fields", () => {
  assert.equal(
    customerDuplicateMatchLabel({
      email_matches: true,
      phone_matches: false,
    }),
    "Email match",
  );
  assert.equal(
    customerDuplicateMatchLabel({
      email_matches: false,
      phone_matches: true,
    }),
    "Phone match",
  );
  assert.equal(
    customerDuplicateMatchLabel({
      email_matches: true,
      phone_matches: true,
    }),
    "Email and phone match",
  );
});

test("duplicate results reveal and focus the warning without scrolling the page", () => {
  const calls = [];
  const warning = {
    scrollIntoView(options) {
      calls.push(["scrollIntoView", options]);
    },
    focus(options) {
      calls.push(["focus", options]);
    },
  };

  revealCustomerDuplicateWarning(warning);

  assert.deepEqual(calls, [
    ["scrollIntoView", { behavior: "smooth", block: "nearest" }],
    ["focus", { preventScroll: true }],
  ]);
});
