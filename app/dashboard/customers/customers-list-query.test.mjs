import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CUSTOMERS_PER_PAGE,
  buildCustomerSearchFilter,
  getCustomerPageRange,
  getCustomerSortOrders,
  getCustomerTotalPages,
  getLastValidCustomerPage,
} from "./customers-list-query.ts";

test("six-row ranges navigate beyond the former 200-customer cap", () => {
  assert.equal(CUSTOMERS_PER_PAGE, 6);
  assert.deepEqual(getCustomerPageRange(1), { from: 0, to: 5 });
  assert.deepEqual(getCustomerPageRange(34), { from: 198, to: 203 });
  assert.deepEqual(getCustomerPageRange(214), { from: 1278, to: 1283 });
  assert.equal(getCustomerTotalPages(1281), 214);
});

test("an out-of-range page moves to the last valid page", () => {
  assert.equal(getLastValidCustomerPage(214, 1200), 200);
  assert.equal(getLastValidCustomerPage(3, 0), 1);
});

test("server search covers every directly supported identity field", () => {
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
  assert.match(filter, /customer-1201@example\.test/);
  assert.equal(buildCustomerSearchFilter("   "), null);
});

test("each sort has a global server-side primary order and stable id tie-breaker", () => {
  const expectations = new Map([
    ["last-order-newest", ["latest_order_created_at", false]],
    ["last-order-oldest", ["latest_order_created_at", true]],
    ["name-az", ["first_name", true]],
    ["name-za", ["first_name", false]],
    ["most-orders", ["order_count", false]],
    ["highest-lifetime-value", ["lifetime_order_total", false]],
  ]);

  for (const [sort, [column, ascending]] of expectations) {
    const orders = getCustomerSortOrders(sort);
    assert.equal(orders[0].column, column);
    assert.equal(orders[0].ascending, ascending);
    assert.deepEqual(orders.at(-1), {
      column: "customer_id",
      ascending: true,
    });
  }
});

test("the customer component applies count, store scope, range, and criteria resets", async () => {
  const source = await readFile(
    new URL("./customers-list.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /\{ count: "exact" \}/);
  assert.match(source, /\.eq\("store_id", seller\.store_id\)/);
  assert.match(source, /customerQuery = customerQuery\.or\(searchFilter\)/);
  assert.match(source, /\.range\(from, to\)/);
  assert.doesNotMatch(source, /\.limit\(200\)/);
  assert.equal(source.match(/setPage\(1\)/g)?.length, 2);
  assert.match(source, /\[debouncedQuery, page, seller, sort\]/);
});

test("customer search debounces raw input before querying and guards stale results", async () => {
  const source = await readFile(
    new URL("./customers-list.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /CUSTOMER_SEARCH_DEBOUNCE_MS = 350/);
  assert.match(
    source,
    /setTimeout\(\(\) => \{[\s\S]*setPage\(1\);[\s\S]*setDebouncedQuery\(query\);[\s\S]*CUSTOMER_SEARCH_DEBOUNCE_MS/,
  );
  assert.match(source, /buildCustomerSearchFilter\(debouncedQuery\)/);
  assert.doesNotMatch(source, /buildCustomerSearchFilter\(query\)/);
  assert.match(source, /latestQueryRef\.current !== debouncedQuery/);
  assert.match(source, /onChange=\{\(event\) => handleQueryChange\(event\.target\.value\)\}/);
});
