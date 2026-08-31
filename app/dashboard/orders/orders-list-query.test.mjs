import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ORDERS_PER_PAGE,
  buildOrderListRpcParams,
  getLastValidOrderPage,
  getOrderPageOffset,
  getOrderPaginationPages,
  getOrderTotalPages,
  getSelectedOrderRecords,
} from "./orders-list-query.ts";

test("50-order pages reach orders beyond the former 100-order cap", () => {
  assert.equal(ORDERS_PER_PAGE, 50);
  assert.equal(getOrderPageOffset(1), 0);
  assert.equal(getOrderPageOffset(2), 50);
  assert.equal(getOrderPageOffset(3), 100);
  assert.equal(getOrderTotalPages(151), 4);
  assert.equal(getLastValidOrderPage(7, 151), 4);
  assert.deepEqual(getOrderPaginationPages(3, 8), [1, 2, 3, 4, "ellipsis", 8]);
});

test("the RPC receives every criterion before pagination", () => {
  assert.deepEqual(
    buildOrderListRpcParams({
      archiveView: "active",
      filter: "ready_for_pickup",
      page: 3,
      pickupOptionId: "pickup-option-id",
      search: "  ORD-0001  ",
      sort: "oldest",
      storeId: "seller-store-id",
    }),
    {
      p_archive_view: "active",
      p_limit: 50,
      p_offset: 100,
      p_pickup_option_id: "pickup-option-id",
      p_search: "ORD-0001",
      p_sort: "oldest",
      p_status_filter: "ready_for_pickup",
      p_store_id: "seller-store-id",
    },
  );
});

test("archived pages cannot accidentally retain an active lifecycle filter", () => {
  const params = buildOrderListRpcParams({
    archiveView: "archived",
    filter: "completed",
    page: 1,
    pickupOptionId: null,
    search: "",
    sort: "newest",
    storeId: "seller-store-id",
  });

  assert.equal(params.p_status_filter, "all");
  assert.equal(params.p_search, null);
});

test("pickup summaries can retain explicitly selected orders from more than one page", () => {
  const snapshots = Object.fromEntries(
    Array.from({ length: 125 }, (_, index) => {
      const orderNumber = index + 1;
      return [`order-${orderNumber}`, { orderNumber }];
    }),
  );
  const selectedIds = new Set(Object.keys(snapshots));
  const currentPage = Object.values(snapshots).slice(100);

  assert.equal(currentPage.length, 25);
  assert.equal(getSelectedOrderRecords(selectedIds, snapshots).length, 125);
  assert.equal(
    getSelectedOrderRecords(selectedIds, snapshots).at(-1)?.orderNumber,
    125,
  );
});

test("Orders uses the bounded RPC, resets pages for criteria, and retains selected snapshots across pages", async () => {
  const source = await readFile(
    new URL("./orders-list.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /rpc\(\s*"seller_get_order_list_page"/);
  assert.match(source, /rpc\("seller_get_orders_for_print"/);
  assert.doesNotMatch(source, /\.limit\(100\)/);
  assert.doesNotMatch(source, /seller_dashboard_attention_orders/);
  assert.doesNotMatch(source, /\.from\("seller_order_item_detail"\)/);
  assert.match(source, /setPage\(1\)/);
  assert.match(source, /\[\s*archiveView,[\s\S]*debouncedSearchQuery,[\s\S]*filter,[\s\S]*page,[\s\S]*pickupOptionFilter,[\s\S]*sort/);
  assert.match(source, /selectedOrderSnapshots/);
  assert.match(source, /selectedOrderItems/);
  assert.match(source, /items: selectedOrderItems\[order\.order_id\]/);
  assert.match(source, /function updatePage[\s\S]*setPage\(nextPage\)/);
  assert.doesNotMatch(source, /function updatePage[\s\S]{0,180}clearSelection/);
});

test("the database page contract owns full-history search, filtering, sorting, and counts", async () => {
  const migration = await readFile(
    new URL(
      "../../../supabase/migrations/20260830120000_paginate_seller_orders.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(migration, /not public\.owns_store\(p_store_id\)/);
  assert.match(migration, /orders\.store_id = p_store_id/);
  assert.match(migration, /orders\.order_number/);
  assert.match(migration, /order_items\.breed_display_name_snapshot/);
  assert.match(migration, /order_items\.custom_item_name_snapshot/);
  assert.match(migration, /order_items\.item_name_snapshot/);
  assert.match(migration, /p_pickup_option_id is null/);
  assert.match(migration, /v_status_filter = 'ready_for_pickup'/);
  assert.match(migration, /row_number\(\) over/);
  assert.match(migration, /'total_count', \(select count\(\*\) from base_orders\)/);
  assert.match(migration, /'ready_for_pickup', lifecycle_counts\.ready_for_pickup_count/);
});
