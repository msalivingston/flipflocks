import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const modalPath = new URL(
  "../app/dashboard/customers/add-customer-modal.tsx",
  import.meta.url,
);

test("Add Customer uses the store-wide advisory duplicate RPC", async () => {
  const source = await readFile(modalPath, "utf8");

  assert.match(source, /\.rpc\("seller_find_possible_customer_duplicates"/);
  assert.match(source, /p_store_id: seller\.store_id/);
  assert.match(source, /p_exclude_customer_id: customer\?\.customer_id \?\? null/);
  assert.doesNotMatch(source, /\.limit\(500\)/);
  assert.doesNotMatch(source, /\.from\("customers"\)[\s\S]*?findPossibleDuplicate/);
});

test("duplicate results warn without replacing the requested customer creation", async () => {
  const source = await readFile(modalPath, "utf8");

  assert.match(source, /duplicates\.map\(\(duplicate\)/);
  assert.match(source, /customerDuplicateMatchLabel\(duplicate\)/);
  assert.match(source, /Create Anyway/);
  assert.match(source, /saveCustomer\(true\)/);
  assert.match(source, /\.from\("customers"\)[\s\S]*?\.insert\(/);
  assert.doesNotMatch(
    source,
    /We could not check for an existing customer/,
  );
});
