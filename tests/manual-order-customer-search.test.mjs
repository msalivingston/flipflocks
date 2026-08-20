import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("manual order customer picker searches the full store-scoped customer view", async () => {
  const source = await readFile(
    new URL("../app/dashboard/orders/new/new-manual-order.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /buildCustomerSearchFilter/);
  assert.match(source, /CUSTOMER_SEARCH_DEBOUNCE_MS = 275/);
  assert.match(source, /normalizedQuery\.length < 2/);
  assert.match(source, /\.from\("seller_customer_summary"\)/);
  assert.match(source, /const storeId = seller\?\.store_id/);
  assert.match(source, /\.eq\("store_id", storeId\)/);
  assert.match(source, /\.or\(searchFilter\)/);
  assert.match(source, /\.limit\(CUSTOMER_SEARCH_RESULT_LIMIT\)/);
  assert.doesNotMatch(source, /\.limit\(200\)/);
  assert.doesNotMatch(source, /function filterCustomers/);
});

test("manual order keeps its selected customer apart from transient search results", async () => {
  const source = await readFile(
    new URL("../app/dashboard/orders/new/new-manual-order.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /const \[selectedCustomer, setSelectedCustomer\]/);
  assert.match(source, /setSelectedCustomer\(customer\);/);
  assert.match(source, /updateCustomerQuery\(""\);/);
  assert.match(source, /clearSelectedCustomer=\{\(\) => setSelectedCustomer\(undefined\)\}/);
  assert.match(
    source,
    /p_customer_id:\s*customerMode === "existing" \? selectedCustomer\?\.customer_id \?\? null : null/,
  );
});
