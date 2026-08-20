import assert from "node:assert/strict";
import test from "node:test";
import {
  formatCustomerDisplayInitials,
  formatCustomerDisplayName,
} from "./customer-display.ts";

test("customer display names use the intended trimmed fallback order", () => {
  assert.equal(
    formatCustomerDisplayName({
      first_name: "  Ada ",
      last_name: " Lovelace ",
      business_name: "Ignored Farm",
      email: "ada@example.test",
    }),
    "Ada Lovelace",
  );
  assert.equal(formatCustomerDisplayName({ last_name: "  Solo  " }), "Solo");
  assert.equal(
    formatCustomerDisplayName({ business_name: "  Whiting Farms  " }),
    "Whiting Farms",
  );
  assert.equal(
    formatCustomerDisplayName({ email: "  hello@example.test " }),
    "hello@example.test",
  );
  assert.equal(
    formatCustomerDisplayName({ phone: " +1 970 555 0100 " }),
    "+1 970 555 0100",
  );
  assert.equal(formatCustomerDisplayName({}), "Customer");
});

test("customer display initials use a safe fallback", () => {
  assert.equal(
    formatCustomerDisplayInitials({ first_name: "Ada", last_name: "Lovelace" }),
    "AL",
  );
  assert.equal(
    formatCustomerDisplayInitials({ business_name: "Whiting Farms" }),
    "WH",
  );
  assert.equal(formatCustomerDisplayInitials({}), "CU");
});
