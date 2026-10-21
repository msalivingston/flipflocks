import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  fetchAllCustomerContacts,
  filterCustomerRoster,
  getCustomerRosterSummary,
  mergeCustomerRoster,
  paginateCustomerRoster,
} from "./customer-roster.ts";

test("customer report retains all registered contacts and searches beyond the activity subset", async () => {
  const contacts = Array.from({ length: 1330 }, (_, index) => ({
    id: `${index + 1}`,
    first_name: `Customer ${index + 1}`,
    last_name: null,
    business_name: null,
    email: `customer-${index + 1}@example.test`,
    phone: null,
    delivery_address_line1: null,
    delivery_address_line2: null,
    delivery_city: null,
    delivery_state: null,
    delivery_postal_code: null,
    delivery_country: null,
    internal_notes: null,
    created_at: "2026-08-20T12:00:00Z",
    updated_at: "2026-08-20T12:00:00Z",
    imported_order_count: 0,
    imported_order_total_cents: 0,
    imported_source: "whiting_farms",
  }));
  const activity = contacts.slice(0, 451).map((contact) => ({
    customerId: contact.id,
    customerName: contact.first_name,
    orders: 1,
    totalSpent: 10,
    totalOrders: 1,
    lifetimeOrderTotal: 10,
  }));
  const calls = [];
  const fetched = await fetchAllCustomerContacts(async (from, to) => {
    calls.push([from, to]);
    return { data: contacts.slice(from, to + 1), error: null };
  });
  assert.deepEqual(calls.at(-1), [1200, 1399]);
  const roster = mergeCustomerRoster(fetched, activity, activity);
  assert.equal(roster.length, 1330);
  assert.equal(roster[1329].orders, 0);
  assert.equal(filterCustomerRoster(roster, "customer-1329@example.test", null).length, 1);
  assert.equal(getCustomerRosterSummary(filterCustomerRoster(roster, "", null)).total_customers, 1330);
  assert.equal(filterCustomerRoster(roster, "", 0).length, 451);
  assert.equal(paginateCustomerRoster(roster, 26, 50).length, 30);
  assert.equal(paginateCustomerRoster(roster, 27, 50).length, 0);
});

test("report export uses the same complete filtered roster as the displayed customer report", async () => {
  const source = await readFile(new URL("./reports-dashboard.tsx", import.meta.url), "utf8");
  assert.match(source, /buildCustomerRosterReport\(filteredCustomerRoster, page, customerRoster\?\.length \?\? 0\)/);
  assert.match(source, /buildCustomersCsvRows\(filteredCustomerRoster, dateRangeLabel\)/);
  assert.match(source, /mergeCustomerRoster\(contacts, lifetimeRows, periodRows\)/);
  assert.match(source, /hasAnyData: totalRosterCount > 0/);
  assert.match(source, /rows: paginateCustomerRoster\(rows, page, reportPageSize\)/);
});

test("dated purchase metrics stay separate from lifetime values", () => {
  const contact = {
    id: "one", first_name: "One", last_name: "Buyer", business_name: null,
    email: "one@example.test", phone: null,
    delivery_address_line1: null, delivery_address_line2: null,
    delivery_city: null, delivery_state: null, delivery_postal_code: null,
    delivery_country: null, internal_notes: null,
    created_at: "2026-08-20T12:00:00Z", updated_at: "2026-08-20T12:00:00Z",
    imported_order_count: 2, imported_order_total_cents: 2000,
    imported_source: "whiting_farms",
  };
  const lifetime = {
    customerId: "one", customerName: "One Buyer", orders: 5, totalSpent: 50,
    totalOrders: 5, lifetimeOrderTotal: 50, nativeOrders: 3, nativeSpent: 30,
    openOrders: 1, latestOrderAt: "2026-09-01T12:00:00Z", lastOrderTotal: 10,
  };
  const period = {
    customerId: "one", customerName: "One Buyer", orders: 1, totalSpent: 10,
    itemsBought: 2, lastOrder: "2026-09-01T12:00:00Z",
  };
  const [row] = mergeCustomerRoster([contact], [lifetime], [period]);
  assert.equal(row.orders, 1);
  assert.equal(row.totalSpent, 10);
  assert.equal(row.totalOrders, 5);
  assert.equal(row.lifetimeOrderTotal, 50);
  assert.equal(row.importedOrderCount, 2);
  assert.equal(row.importedOrderTotal, 20);
  assert.equal(row.itemsBought, 2);
  assert.equal(getCustomerRosterSummary([row]).average_spend, 10);
  assert.equal(filterCustomerRoster([row], "one@example.test", 9).length, 1);
  assert.equal(filterCustomerRoster([row], "one@example.test", 10).length, 0);
});
