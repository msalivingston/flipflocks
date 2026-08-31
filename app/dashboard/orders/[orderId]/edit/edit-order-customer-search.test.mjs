import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ORDER_CUSTOMER_SEARCH_DEBOUNCE_MS,
  ORDER_CUSTOMER_SEARCH_RESULT_LIMIT,
  buildCustomerSearchFilter,
} from "../../../customers/customers-list-query.ts";

const editOrderSourceUrl = new URL("./edit-order.tsx", import.meta.url);
const newManualOrderSourceUrl = new URL(
  "../../new/new-manual-order.tsx",
  import.meta.url,
);

test("Edit Order uses the New Manual Order customer search contract", async () => {
  const [editSource, newSource] = await Promise.all([
    readFile(editOrderSourceUrl, "utf8"),
    readFile(newManualOrderSourceUrl, "utf8"),
  ]);

  assert.equal(ORDER_CUSTOMER_SEARCH_DEBOUNCE_MS, 275);
  assert.equal(ORDER_CUSTOMER_SEARCH_RESULT_LIMIT, 8);

  for (const source of [editSource, newSource]) {
    assert.match(source, /buildCustomerSearchFilter\(normalizedQuery\)/);
    assert.match(source, /ORDER_CUSTOMER_SEARCH_DEBOUNCE_MS/);
    assert.match(source, /\.limit\(ORDER_CUSTOMER_SEARCH_RESULT_LIMIT\)/);
    assert.match(source, /\.from\("seller_customer_summary"\)/);
    assert.match(source, /\.eq\("store_id", storeId\)/);
    assert.match(source, /\.or\(searchFilter\)/);
  }

  assert.doesNotMatch(editSource, /\.limit\(200\)/);
  assert.doesNotMatch(editSource, /filterCustomers\(/);
});

test("customer search includes every supported identity field", () => {
  const filter = buildCustomerSearchFilter("customer-1201@example.test");

  for (const field of [
    "first_name",
    "last_name",
    "business_name",
    "email",
    "phone",
  ]) {
    assert.match(filter, new RegExp(`${field}\\.ilike`));
  }
});

test("Edit Order loads and retains the assigned customer independently", async () => {
  const source = await readFile(editOrderSourceUrl, "utf8");

  assert.match(
    source,
    /\.eq\("store_id", seller\.store_id\)[\s\S]*\.eq\("customer_id", order\.customer_id\)[\s\S]*\.maybeSingle<CustomerRow>\(\)/,
  );
  assert.match(source, /setSelectedCustomer\(currentCustomer\)/);
  assert.match(source, /setSelectedCustomer\(customer\)/);
  assert.match(source, /setSelectedCustomerId\(customer\.customer_id\)/);
});

test("changing or clearing a query resets stale search state", async () => {
  const source = await readFile(editOrderSourceUrl, "utf8");

  assert.match(
    source,
    /function updateCustomerQuery[\s\S]*setCustomerQuery\(nextQuery\)[\s\S]*setCustomerSearchResults\(\[\]\)[\s\S]*setCustomerSearchError\(null\)[\s\S]*setIsCustomerSearchLoading\(nextQuery\.trim\(\)\.length >= 2\)/,
  );
  assert.match(source, /window\.clearTimeout\(timeoutId\)/);
});
