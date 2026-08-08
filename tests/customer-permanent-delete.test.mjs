import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const detailPath = new URL(
  "../app/dashboard/customers/[customerId]/customer-detail.tsx",
  import.meta.url,
);
const listPath = new URL(
  "../app/dashboard/customers/customers-list.tsx",
  import.meta.url,
);
const pagePath = new URL(
  "../app/dashboard/customers/page.tsx",
  import.meta.url,
);
const contractPath = new URL(
  "../app/dashboard/customers/customer-delete.ts",
  import.meta.url,
);
const migrationPath = new URL(
  "../supabase/migrations/20260807150000_permanent_delete_zero_order_customer.sql",
  import.meta.url,
);

test("customer detail only offers permanent deletion for zero-order customers", async () => {
  const source = await readFile(detailPath, "utf8");

  assert.match(source, /const canDelete = orderCount === 0/);
  assert.match(source, /\{canDelete \? \(/);
  assert.match(source, /Delete customer/);
  assert.match(source, /CUSTOMER_ORDER_HISTORY_MESSAGE/);
  assert.doesNotMatch(source, /\.from\("orders"\).*delete/s);
});

test("customer deletion uses the authoritative customer-id-only RPC", async () => {
  const source = await readFile(detailPath, "utf8");

  assert.match(source, /\.rpc\("seller_delete_customer", \{/);
  assert.match(source, /p_customer_id: customerId/);
  assert.doesNotMatch(source, /seller_delete_customer[\s\S]*?p_store_id/);
  assert.doesNotMatch(source, /seller_delete_customer[\s\S]*?order_count/);
});

test("permanent deletion has an explicit accessible confirmation", async () => {
  const source = await readFile(detailPath, "utf8");

  assert.match(source, /Delete this customer permanently\?/);
  assert.match(source, /cannot be undone/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /role="dialog"/);
  assert.match(source, />\s*Cancel\s*</);
  assert.match(source, /isDeleting \? "Deleting\.\.\." : "Delete customer"/);
});

test("successful and stale-state outcomes refresh the correct customer UI", async () => {
  const detailSource = await readFile(detailPath, "utf8");
  const listSource = await readFile(listPath, "utf8");
  const pageSource = await readFile(pagePath, "utf8");

  assert.match(detailSource, /router\.push\("\/dashboard\/customers\?deleted=1"\)/);
  assert.match(detailSource, /router\.refresh\(\)/);
  assert.match(detailSource, /isCustomerOrderHistoryDeleteError\(error\.message\)/);
  assert.match(detailSource, /onOrderHistoryDetected\(\)/);
  assert.match(detailSource, /setRefreshKey\(\(current\) => current \+ 1\)/);
  assert.match(pageSource, /showDeletedSuccess=\{deleted === "1"\}/);
  assert.match(listSource, /Customer deleted successfully\./);
  assert.match(listSource, /role="status"/);
  assert.match(listSource, /aria-live="polite"/);
});

test("shared client contract maps the stable order-history error", async () => {
  const source = await readFile(contractPath, "utf8");

  assert.match(source, /CUSTOMER_HAS_ORDER_HISTORY/);
  assert.match(source, /Customers with order history cannot be deleted\./);
  assert.match(source, /message\?\.includes\(CUSTOMER_HAS_ORDER_HISTORY_ERROR\)/);
});

test("delete RPC locks, authorizes, checks every order, and preserves restrictive ACLs", async () => {
  const source = await readFile(migrationPath, "utf8");

  assert.match(source, /auth\.uid\(\) is null/);
  assert.match(source, /public\.owns_store\(customers\.store_id\)/);
  assert.match(source, /for update/);
  assert.match(source, /from public\.orders\s+where orders\.customer_id = v_customer_id/);
  assert.match(source, /CUSTOMER_HAS_ORDER_HISTORY/);
  assert.match(source, /security definer/);
  assert.match(source, /set search_path = public/);
  assert.match(source, /revoke all on function public\.seller_delete_customer\(uuid\) from anon/);
  assert.match(source, /grant execute on function public\.seller_delete_customer\(uuid\) to authenticated/);
  assert.doesNotMatch(source, /delete from public\.orders/);
  assert.doesNotMatch(source, /on delete cascade/);
});
