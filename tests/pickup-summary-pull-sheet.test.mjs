import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createPickupSummaryReportData,
  formatPullSheetAge,
} from "../app/dashboard/orders/pickup-summary-report-data.ts";

const root = new URL("../", import.meta.url);

function line(overrides = {}) {
  return {
    ageDays: 84,
    barnLocation: "Breeder 2",
    breederStatus: "Breeder",
    breedOrVariety: "Andalusian - Black",
    customerEmail: null,
    customerName: "Buyer",
    customerPhone: null,
    featherCondition: "Rough",
    id: crypto.randomUUID(),
    lineValue: 0,
    orderId: crypto.randomUUID(),
    orderNumber: "1",
    quantity: 1,
    readyDate: null,
    sex: "Female",
    ...overrides,
  };
}

function report(lines) {
  return createPickupSummaryReportData({
    defaultSelectionRule: "test",
    exportFormat: "pdf",
    includedBirdTotalPerCustomer: [],
    includedOrderLines: lines,
    includedOrders: [],
    overallBirdTotal: lines.reduce((total, item) => total + item.quantity, 0),
    overallPickupValue: 0,
    reports: ["pull_sheet"],
  });
}

test("Pull Sheet separates feather condition and uses compact age labels", () => {
  const data = report([line({ ageDays: 84 })]);

  assert.deepEqual(data.pullSheetRows[0], {
    age: "12 wk",
    barnLocation: "Breeder 2",
    breederStatus: "Breeder",
    breedOrVariety: "Andalusian - Black",
    featherCondition: "Rough",
    quantity: 1,
    sex: "Female",
  });
  assert.equal(formatPullSheetAge(364), "12 mo");
});

test("Pull Sheet uses breeding history status and groups only identical displayed rows", () => {
  const data = report([
    line({ quantity: 2 }),
    line({ quantity: 3 }),
    line({ featherCondition: "Good", quantity: 4 }),
    line({ breederStatus: "Not bred", quantity: 5 }),
  ]);

  assert.equal(data.pullSheetRows.length, 3);
  assert.equal(
    data.pullSheetRows.find((item) =>
      item.featherCondition === "Rough" && item.breederStatus === "Breeder"
    )?.quantity,
    5,
  );
  assert.ok(data.pullSheetRows.some((item) => item.featherCondition === "Good"));
  assert.ok(data.pullSheetRows.some((item) => item.breederStatus === "Not bred"));
  assert.equal(data.pullSheetTotalBirds, 14);
});

test("Pull Sheet loads breeder status from the immutable Live Bird order snapshot", async () => {
  const [source, migration] = await Promise.all([
    readFile(new URL("app/dashboard/orders/orders-list.tsx", root), "utf8"),
    readFile(
      new URL(
        "supabase/migrations/20260830120000_paginate_seller_orders.sql",
        root,
      ),
      "utf8",
    ),
  ]);

  assert.match(migration, /'age_at_sale_days_snapshot', order_items\.age_at_sale_days_snapshot/);
  assert.match(migration, /'breeding_history_snapshot', order_items\.breeding_history_snapshot/);
  assert.match(migration, /'feather_condition_snapshot', order_items\.feather_condition_snapshot/);
  assert.match(source, /breederStatus: formatPickupSummaryBreederStatus\(/);
  assert.match(source, /value === "never_bred"\) return "Not bred"/);
  assert.match(source, /value === "breeder"\) return "Breeder"/);
});

test("seller-selected report date is used only for the generated document", async () => {
  const [ordersSource, downloadsSource] = await Promise.all([
    readFile(new URL("app/dashboard/orders/orders-list.tsx", root), "utf8"),
    readFile(
      new URL("app/dashboard/orders/pickup-summary-report-downloads.ts", root),
      "utf8",
    ),
  ]);

  assert.match(ordersSource, /const \[reportDate, setReportDate\]/);
  assert.match(ordersSource, /type="date"/);
  assert.match(ordersSource, /downloadPickupSummaryReports\(payload, generatedAt\)/);
  assert.match(downloadsSource, /generatedAt\?: Date/);
  assert.match(
    downloadsSource,
    /createPickupSummaryReportData\([\s\S]*?\{ \.\.\.payload, reports: \[report\] \},[\s\S]*?generatedAt/,
  );
  assert.match(downloadsSource, /label: "Feather\\nCondition", width: 85/);
  assert.match(downloadsSource, /label: "Barn\\nLocation",[\s\S]*?width: 105/);
  assert.match(downloadsSource, /label: "Breed", width: 210/);
  assert.match(downloadsSource, /label: "Age", width: 60/);
  assert.match(downloadsSource, /label: "Qty",[\s\S]*?width: 55/);
  assert.match(downloadsSource, /function fitPdfText/);
  assert.match(downloadsSource, /trimEnd\(\)\}\.{3}/);
});

test("Pull Sheet emphasizes quantity and barn location for barn visibility", async () => {
  const source = await readFile(
    new URL("app/dashboard/orders/pickup-summary-report-downloads.ts", root),
    "utf8",
  );

  assert.match(
    source,
    /\{[^}]*bodyBold: true,[^}]*bodyFontSize: 15,[^}]*label: "Qty"[^}]*\}/,
  );
  assert.match(
    source,
    /\{[^}]*bodyBold: true,[^}]*bodyFontSize: 15,[^}]*label: "Barn\\nLocation"[^}]*\}/,
  );
  assert.match(source, /numberCell\(row\.quantity, 9\)/);
  assert.match(source, /numberCell\(reportData\.pullSheetTotalBirds, 9\)/);
  assert.match(source, /stringCell\(row\.barnLocation, 8\)/);
  assert.match(source, /<b\/><name val="Arial"\/><family val="2"\/><sz val="14"\/>/);

  assert.match(source, /const fontWeight = bold \|\| column\.bodyBold/);
  assert.match(
    source,
    /bold && lines\.length > 1 \? 10 : \(column\.bodyFontSize \?\? 12\)/,
  );
});

test("Pull Sheet PDF uses half-inch top and bottom margins", async () => {
  const source = await readFile(
    new URL("app/dashboard/orders/pickup-summary-report-downloads.ts", root),
    "utf8",
  );

  assert.match(
    source,
    /const pullSheetPdfPage = \{[\s\S]*?verticalMargin: 36,[\s\S]*?\}/,
  );
  assert.match(source, /layout: pullSheetPdfPage/);
  assert.match(source, /layout\.height - layout\.verticalMargin/);
  assert.match(source, /layout\.verticalMargin \+ rowHeight/);
});

test("each selected report downloads with its selected-date report name", async () => {
  const source = await readFile(
    new URL("app/dashboard/orders/pickup-summary-report-downloads.ts", root),
    "utf8",
  );

  assert.match(source, /for \(const report of payload\.reports\)/);
  assert.match(source, /\{ \.\.\.payload, reports: \[report\] \}/);
  assert.match(source, /`\$\{fileDate\} Pull Sheet\.\$\{extension\}`/);
  assert.match(source, /`\$\{fileDate\} Order Summary\.\$\{extension\}`/);
});

test("Pull Sheet sorts naturally by barn location and then breed name", () => {
  const data = report([
    line({ barnLocation: "Brooder 5", breedOrVariety: "Australorp" }),
    line({ barnLocation: "Breeder 3", breedOrVariety: "Zebra" }),
    line({ barnLocation: "Breeder 2", breedOrVariety: "Wyandotte" }),
    line({ barnLocation: "Breeder 2", breedOrVariety: "Andalusian" }),
    line({ barnLocation: "Breeder 1", breedOrVariety: "Leghorn" }),
  ]);

  assert.deepEqual(
    data.pullSheetRows.map((item) => `${item.barnLocation}: ${item.breedOrVariety}`),
    [
      "Breeder 1: Leghorn",
      "Breeder 2: Andalusian",
      "Breeder 2: Wyandotte",
      "Breeder 3: Zebra",
      "Brooder 5: Australorp",
    ],
  );
  assert.equal(data.pullSheetTotalBirds, 5);
});
