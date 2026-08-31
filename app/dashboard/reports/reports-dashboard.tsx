"use client";

import Image from "next/image";
import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSellerContext } from "../_components/seller-context";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  SellerCard,
} from "../_components/seller-ui";
import {
  formatCurrency,
  formatOrderLifecycle,
  formatPaymentMethod,
} from "../orders/order-formatters";

type ReportTab = "sales" | "items" | "customers";
type DateRange =
  | "last_7_days"
  | "last_30_days"
  | "last_90_days"
  | "this_year"
  | "all_time"
  | "custom";
type AmountFilter = "any" | "over_25" | "over_50" | "over_100" | "custom";
type ItemTypeFilter =
  | "all"
  | "Live Birds"
  | "Hatching Eggs"
  | "Poultry Products"
  | "Equipment & Supplies"
  | "Custom / Other";

type SellerReportOrderRow = {
  order_id: string;
  order_number: string;
  order_status: string | null;
  payment_method: string | null;
  ready_for_pickup_at: string | null;
  created_at: string;
  customer_id: string | null;
  buyer_first_name_snapshot: string | null;
  buyer_last_name_snapshot: string | null;
  buyer_email_snapshot: string | null;
  buyer_phone_snapshot: string | null;
  buyer_notes: string | null;
  pickup_note: string | null;
  total_amount: number | null;
  item_count: number | null;
  total_item_quantity: number | null;
  item_summary: string;
};

type DateSettings = {
  customEnd: string;
  customStart: string;
  range: DateRange;
};

type ItemSummaryRow = {
  breed: string;
  item: string;
  itemType: Exclude<ItemTypeFilter, "all">;
  orders: number;
  quantity: number;
  revenue: number;
  rowKey: string;
  species: string;
};

type CustomerSummaryRow = {
  businessName: string;
  createdAt: string;
  customerEmail: string;
  customerId: string;
  customerFirstName: string;
  customerLastName: string;
  customerName: string;
  customerPhone: string;
  internalNotes: string;
  importedOrderCount: number;
  importedOrderTotal: number;
  importedSource: string;
  itemsBought: number;
  lastOrder: string | null;
  lastOrderTotal: number;
  latestOrderAt: string | null;
  lifetimeOrderTotal: number;
  mailingAddressLine1: string;
  mailingAddressLine2: string;
  mailingCity: string;
  mailingCountry: string;
  mailingPostalCode: string;
  mailingState: string;
  openOrders: number;
  orders: number;
  nativeOrders: number;
  nativeSpent: number;
  totalOrders: number;
  totalSpent: number;
  updatedAt: string;
};

type ReportResponse<Row> = {
  has_any_data: boolean;
  options: { breeds?: string[]; species?: string[] };
  rows: Row[];
  summary: Record<string, string | number | boolean>;
  total_count: number;
};

type ReportState = {
  hasAnyData: boolean;
  options: { breeds: string[]; species: string[] };
  rows: Array<SellerReportOrderRow | ItemSummaryRow | CustomerSummaryRow>;
  summary: Record<string, string | number | boolean>;
  tab: ReportTab | null;
  totalCount: number;
};

const tabs: { label: string; value: ReportTab }[] = [
  { label: "Sales", value: "sales" },
  { label: "Items", value: "items" },
  { label: "Customers", value: "customers" },
];

const dateRangeOptions: { label: string; value: DateRange }[] = [
  { label: "Last 7 days", value: "last_7_days" },
  { label: "Last 30 days", value: "last_30_days" },
  { label: "Last 90 days", value: "last_90_days" },
  { label: "This year", value: "this_year" },
  { label: "All time", value: "all_time" },
  { label: "Custom", value: "custom" },
];

const amountOptions: { label: string; value: AmountFilter }[] = [
  { label: "Any amount", value: "any" },
  { label: "Over $25", value: "over_25" },
  { label: "Over $50", value: "over_50" },
  { label: "Over $100", value: "over_100" },
  { label: "Custom amount", value: "custom" },
];

const itemTypeOptions: { label: string; value: ItemTypeFilter }[] = [
  { label: "All types", value: "all" },
  { label: "Live Birds", value: "Live Birds" },
  { label: "Hatching Eggs", value: "Hatching Eggs" },
  { label: "Poultry Products", value: "Poultry Products" },
  { label: "Equipment & Supplies", value: "Equipment & Supplies" },
  { label: "Custom / Other", value: "Custom / Other" },
];

const dash = "\u2014";
const reportPageSize = 50;
const exportPageSize = 500;

function getOptionLabel(
  options: Array<{ label: string; value: string }>,
  value: string,
) {
  return options.find((option) => option.value === value)?.label ?? value;
}

export function ReportsDashboard() {
  const { seller } = useSellerContext();
  const [activeTab, setActiveTab] = useState<ReportTab>("sales");
  const [dateSettings, setDateSettings] = useState<DateSettings>({
    customEnd: "",
    customStart: "",
    range: "last_30_days",
  });
  const [salesAmountFilter, setSalesAmountFilter] =
    useState<AmountFilter>("any");
  const [salesCustomAmount, setSalesCustomAmount] = useState("");
  const [itemTypeFilter, setItemTypeFilter] = useState<ItemTypeFilter>("all");
  const [speciesFilter, setSpeciesFilter] = useState("all");
  const [breedFilter, setBreedFilter] = useState("all");
  const [itemSearch, setItemSearch] = useState("");
  const [customerSpendFilter, setCustomerSpendFilter] =
    useState<AmountFilter>("any");
  const [customerCustomSpend, setCustomerCustomSpend] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const deferredItemSearch = useDeferredValue(itemSearch);
  const deferredCustomerSearch = useDeferredValue(customerSearch);
  const [pages, setPages] = useState<Record<ReportTab, number>>({
    customers: 0,
    items: 0,
    sales: 0,
  });
  const [report, setReport] = useState<ReportState>({
    hasAnyData: false,
    options: { breeds: [], species: [] },
    rows: [],
    summary: {},
    tab: null,
    totalCount: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const page = pages[activeTab];
  const dateRangeLabel = getDateRangeLabel(dateSettings);
  const queryParameters = useMemo(
    () =>
      buildReportRpcParameters({
        amountOver:
          activeTab === "sales"
            ? getAmountThreshold(salesAmountFilter, salesCustomAmount)
            : activeTab === "customers"
              ? getAmountThreshold(customerSpendFilter, customerCustomSpend)
              : null,
        breed: breedFilter,
        dateSettings,
        includeImported:
          activeTab === "customers" && dateSettings.range === "all_time",
        itemType: itemTypeFilter,
        limit: reportPageSize,
        offset: page * reportPageSize,
        report: activeTab,
        search:
          activeTab === "items"
            ? deferredItemSearch
            : activeTab === "customers"
              ? deferredCustomerSearch
              : "",
        species: speciesFilter,
        storeId: seller?.store_id ?? null,
      }),
    [
      activeTab,
      breedFilter,
      customerCustomSpend,
      customerSpendFilter,
      dateSettings,
      deferredCustomerSearch,
      deferredItemSearch,
      itemTypeFilter,
      page,
      salesAmountFilter,
      salesCustomAmount,
      seller?.store_id,
      speciesFilter,
    ],
  );

  useEffect(() => {
    let isMounted = true;

    async function loadReports() {
      if (!seller || !queryParameters) return;

      setIsLoading(true);
      setError(null);

      const result = await supabase.rpc(
        "seller_get_report_page",
        queryParameters,
      );

      if (!isMounted) return;

      if (result.error) {
        setError(result.error.message);
        setIsLoading(false);
        return;
      }

      setReport(normalizeReportResponse(activeTab, result.data));
      setIsLoading(false);
    }

    void loadReports();

    return () => {
      isMounted = false;
    };
  }, [activeTab, queryParameters, seller]);

  function resetPage(tab: ReportTab = activeTab) {
    setPages((current) => ({ ...current, [tab]: 0 }));
  }

  async function exportCurrentReport() {
    if (!queryParameters || isExporting) return;

    setIsExporting(true);
    setError(null);

    try {
      const csvParts: string[] = ["\uFEFF"];
      let offset = 0;
      let totalCount = 0;
      let isFirstPage = true;

      do {
        const result = await supabase.rpc("seller_get_report_page", {
          ...queryParameters,
          p_limit: exportPageSize,
          p_offset: offset,
        });

        if (result.error) throw result.error;

        const pageResult = normalizeReportResponse(activeTab, result.data);
        totalCount = pageResult.totalCount;
        const pageRows =
          activeTab === "sales"
            ? buildSalesCsvRows(pageResult.rows as SellerReportOrderRow[])
            : activeTab === "items"
              ? buildItemsCsvRows(
                  pageResult.rows as ItemSummaryRow[],
                  dateRangeLabel,
                )
              : buildCustomersCsvRows(
                  pageResult.rows as CustomerSummaryRow[],
                  dateRangeLabel,
                );
        const rowsToAppend = isFirstPage ? pageRows : pageRows.slice(1);

        const pageCsv = rowsToAppend
            .map((row) => row.map((value) => escapeCsvCell(value)).join(","))
            .join("\r\n");

        if (pageCsv) csvParts.push(isFirstPage ? pageCsv : `\r\n${pageCsv}`);
        offset += pageResult.rows.length;
        isFirstPage = false;
      } while (offset < totalCount);

      downloadCsvParts({
        filename: `flockfront-${activeTab}-${formatFileDate(new Date())}.csv`,
        parts: csvParts,
      });
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "The report export could not be created.",
      );
    } finally {
      setIsExporting(false);
    }
  }

  if (isLoading || report.tab !== activeTab) {
    return <LoadingState label="Loading reports" />;
  }

  if (error) {
    return (
      <ErrorState
        title="Reports could not load"
        message="Please refresh the page and try again."
      />
    );
  }

  if (!report.hasAnyData) {
    return (
      <EmptyState
        title="No report data yet"
        description="Once orders come in, this page will show sales totals, items sold, and customer activity."
        action={
          <Link className="seller-secondary-button" href="/dashboard/inventory">
            Add inventory
          </Link>
        }
      />
    );
  }

  return (
    <div className="grid gap-0">
      <TabNav activeTab={activeTab} onChange={setActiveTab} />
      <div className="rounded-b-xl rounded-tr-xl border-0 bg-transparent pt-4 shadow-none lg:border lg:border-stone-200 lg:bg-white lg:p-5 lg:shadow-sm">
        {activeTab === "sales" ? (
          <SalesTab
            amountFilter={salesAmountFilter}
            customAmount={salesCustomAmount}
            dateSettings={dateSettings}
            isExporting={isExporting}
            onExport={exportCurrentReport}
            page={page}
            report={report}
            setAmountFilter={(value) => {
              resetPage("sales");
              setSalesAmountFilter(value);
            }}
            setCustomAmount={setSalesCustomAmount}
            setDateSettings={setDateSettings}
            setPage={(nextPage) =>
              setPages((current) => ({ ...current, sales: nextPage }))
            }
          />
        ) : null}

        {activeTab === "items" ? (
          <ItemsTab
            breedFilter={breedFilter}
            dateSettings={dateSettings}
            isExporting={isExporting}
            itemRows={normalizeItemRows(report.rows)}
            itemSearch={itemSearch}
            itemTypeFilter={itemTypeFilter}
            onExport={exportCurrentReport}
            options={report.options}
            page={page}
            report={report}
            setBreedFilter={setBreedFilter}
            setDateSettings={setDateSettings}
            setItemSearch={setItemSearch}
            setItemTypeFilter={setItemTypeFilter}
            setSpeciesFilter={setSpeciesFilter}
            setPage={(nextPage) =>
              setPages((current) => ({ ...current, items: nextPage }))
            }
            speciesFilter={speciesFilter}
          />
        ) : null}

        {activeTab === "customers" ? (
          <CustomersTab
            customerRows={report.rows as CustomerSummaryRow[]}
            customSpend={customerCustomSpend}
            dateSettings={dateSettings}
            isExporting={isExporting}
            onExport={exportCurrentReport}
            page={page}
            report={report}
            search={customerSearch}
            setCustomSpend={setCustomerCustomSpend}
            setDateSettings={setDateSettings}
            setSearch={setCustomerSearch}
            setSpendFilter={setCustomerSpendFilter}
            setPage={(nextPage) =>
              setPages((current) => ({ ...current, customers: nextPage }))
            }
            spendFilter={customerSpendFilter}
          />
        ) : null}
      </div>
    </div>
  );
}

function TabNav({
  activeTab,
  onChange,
}: {
  activeTab: ReportTab;
  onChange: (tab: ReportTab) => void;
}) {
  return (
    <div
      aria-label="Report sections"
      className="grid grid-cols-3 gap-1 rounded-xl bg-stone-100 p-1 lg:flex lg:overflow-x-auto lg:rounded-none lg:border-b lg:border-stone-200 lg:bg-transparent lg:p-0 lg:pl-px lg:[scrollbar-width:none] lg:[&::-webkit-scrollbar]:hidden"
      role="tablist"
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.value;

        return (
          <button
            aria-selected={isActive}
            className={`relative min-h-11 min-w-0 rounded-lg border px-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-inset focus:ring-emerald-700 lg:mb-[-1px] lg:shrink-0 lg:rounded-b-none lg:rounded-t-lg lg:px-4 ${
              isActive
                ? "border-stone-200 bg-white text-stone-950 shadow-sm lg:border-b-white lg:shadow-[0_-1px_0_rgba(0,0,0,0.02)]"
                : "border-transparent bg-transparent text-stone-600 hover:bg-white hover:text-stone-950 lg:bg-stone-100/70"
            }`}
            key={tab.value}
            onClick={() => onChange(tab.value)}
            role="tab"
            type="button"
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function SalesTab({
  amountFilter,
  customAmount,
  dateSettings,
  isExporting,
  onExport,
  page,
  report,
  setAmountFilter,
  setCustomAmount,
  setDateSettings,
  setPage,
}: {
  amountFilter: AmountFilter;
  customAmount: string;
  dateSettings: DateSettings;
  isExporting: boolean;
  onExport: () => void;
  page: number;
  report: ReportState;
  setAmountFilter: (value: AmountFilter) => void;
  setCustomAmount: (value: string) => void;
  setDateSettings: (value: DateSettings) => void;
  setPage: (value: number) => void;
}) {
  const orders = report.rows as SellerReportOrderRow[];
  const threshold = getAmountThreshold(amountFilter, customAmount);

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 lg:hidden">
        <SellerCard className="p-3.5">
          <DateRangeControl
            dateSettings={dateSettings}
            onChange={(value) => {
              setPage(0);
              setDateSettings(value);
            }}
          />
          <MobileFilterPanel
            activeCount={amountFilter === "any" ? 0 : 1}
          >
            <AmountControl
              customValue={customAmount}
              label="Order amount"
              onCustomChange={(value) => {
                setPage(0);
                setCustomAmount(value);
              }}
              onFilterChange={setAmountFilter}
              value={amountFilter}
            />
          </MobileFilterPanel>
          <ActiveFilterChips
            chips={[
              getDateRangeLabel(dateSettings),
              amountFilter === "any"
                ? null
                : getOptionLabel(amountOptions, amountFilter),
            ]}
          />
        </SellerCard>
        <ExportButton
          disabled={isExporting}
          label={isExporting ? "Exporting…" : "Export CSV"}
          onClick={onExport}
        />
      </div>

      <SellerCard className="hidden p-4 lg:block">
        <div className="grid gap-3 lg:grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)_auto] lg:items-end">
          <DateRangeControl
            dateSettings={dateSettings}
            onChange={(value) => {
              setPage(0);
              setDateSettings(value);
            }}
          />
          <AmountControl
            customValue={customAmount}
            label="Order amount"
            onCustomChange={(value) => {
              setPage(0);
              setCustomAmount(value);
            }}
            onFilterChange={setAmountFilter}
            value={amountFilter}
          />
          <ExportButton
            disabled={isExporting}
            label={isExporting ? "Exporting…" : "Export CSV"}
            onClick={onExport}
          />
        </div>
      </SellerCard>

      <SummaryGrid>
        <SummaryCard
          glyph="/glyphs/feed-sack.png"
          label="Total sales"
          value={formatCurrency(getSummaryNumber(report, "total_sales"))}
        />
        <SummaryCard
          glyph="/glyphs/shopping-bag.png"
          label="Number of sales"
          value={`${getSummaryNumber(report, "order_count")}`}
        />
        <SummaryCard
          glyph="/glyphs/reports.png"
          label={getSalesOverLabel(threshold)}
          value={`${getSummaryNumber(report, "sales_over_amount")}`}
        />
        <SummaryCard
          glyph="/glyphs/egg.png"
          label="Average sale"
          value={formatCurrency(getSummaryNumber(report, "average_order_value"))}
        />
      </SummaryGrid>

      <ReportTableCard
        description="Orders that match your filters."
        title="Sales detail"
      >
        {orders.length > 0 ? (
          <>
            <SalesTable orders={orders} />
            <ReportPagination
              page={page}
              pageSize={reportPageSize}
              setPage={setPage}
              totalCount={report.totalCount}
            />
          </>
        ) : (
          <TabEmptyState
            action={<ResetSalesFilters onReset={() => setAmountFilter("any")} />}
            description="Try a wider date range or lower the order amount filter."
            title="No sales match these filters"
          />
        )}
      </ReportTableCard>
    </div>
  );
}

function ItemsTab({
  breedFilter,
  dateSettings,
  isExporting,
  itemRows,
  itemSearch,
  itemTypeFilter,
  onExport,
  options,
  page,
  report,
  setBreedFilter,
  setDateSettings,
  setItemSearch,
  setItemTypeFilter,
  setPage,
  setSpeciesFilter,
  speciesFilter,
}: {
  breedFilter: string;
  dateSettings: DateSettings;
  isExporting: boolean;
  itemRows: ItemSummaryRow[];
  itemSearch: string;
  itemTypeFilter: ItemTypeFilter;
  onExport: () => void;
  options: { breeds: string[]; species: string[] };
  page: number;
  report: ReportState;
  setBreedFilter: (value: string) => void;
  setDateSettings: (value: DateSettings) => void;
  setItemSearch: (value: string) => void;
  setItemTypeFilter: (value: ItemTypeFilter) => void;
  setPage: (value: number) => void;
  setSpeciesFilter: (value: string) => void;
  speciesFilter: string;
}) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 lg:hidden">
        <SellerCard className="p-3.5">
          <DateRangeControl
            dateSettings={dateSettings}
            onChange={(value) => {
              setPage(0);
              setDateSettings(value);
            }}
          />
          <MobileFilterPanel
            activeCount={[
              itemTypeFilter !== "all",
              speciesFilter !== "all",
              breedFilter !== "all",
              Boolean(itemSearch.trim()),
            ].filter(Boolean).length}
          >
            <div className="grid gap-3">
              <FilterSelect
                label="Item type"
                onChange={(value) => {
                  setPage(0);
                  setItemTypeFilter(value as ItemTypeFilter);
                  setSpeciesFilter("all");
                  setBreedFilter("all");
                }}
                options={itemTypeOptions}
                value={itemTypeFilter}
              />
              <FilterSelect
                label="Species"
                onChange={(value) => {
                  setPage(0);
                  setSpeciesFilter(value);
                  setBreedFilter("all");
                }}
                options={[
                  { label: "All species", value: "all" },
                  ...options.species.map((species) => ({
                    label: species,
                    value: species,
                  })),
                ]}
                value={speciesFilter}
              />
              <FilterSelect
                label="Breed"
                onChange={(value) => {
                  setPage(0);
                  setBreedFilter(value);
                }}
                options={[
                  { label: "All breeds", value: "all" },
                  ...options.breeds.map((breed) => ({
                    label: breed,
                    value: breed,
                  })),
                ]}
                value={breedFilter}
              />
              <SearchControl
                label="Search item"
                onChange={(value) => {
                  setPage(0);
                  setItemSearch(value);
                }}
                placeholder="Search items"
                value={itemSearch}
              />
            </div>
          </MobileFilterPanel>
          <ActiveFilterChips
            chips={[
              getDateRangeLabel(dateSettings),
              itemTypeFilter === "all" ? null : itemTypeFilter,
              speciesFilter === "all" ? null : speciesFilter,
              breedFilter === "all" ? null : breedFilter,
              itemSearch.trim() ? `Search: ${itemSearch.trim()}` : null,
            ]}
          />
        </SellerCard>
        <ExportButton
          disabled={isExporting}
          label={isExporting ? "Exporting…" : "Export CSV"}
          onClick={onExport}
        />
      </div>

      <SellerCard className="hidden p-4 lg:block">
        <div className="grid gap-3 lg:grid-cols-[repeat(4,minmax(8.5rem,1fr))] xl:grid-cols-[minmax(8.5rem,1fr)_minmax(7.75rem,0.85fr)_minmax(7.75rem,0.85fr)_minmax(7.75rem,0.85fr)_minmax(12rem,1.25fr)_auto] xl:items-end">
          <DateRangeControl
            dateSettings={dateSettings}
            onChange={(value) => {
              setPage(0);
              setDateSettings(value);
            }}
          />
          <FilterSelect
            label="Item type"
            onChange={(value) => {
              setPage(0);
              setItemTypeFilter(value as ItemTypeFilter);
              setSpeciesFilter("all");
              setBreedFilter("all");
            }}
            options={itemTypeOptions}
            value={itemTypeFilter}
          />
          <FilterSelect
            label="Species"
            onChange={(value) => {
              setPage(0);
              setSpeciesFilter(value);
              setBreedFilter("all");
            }}
            options={[
              { label: "All species", value: "all" },
              ...options.species.map((species) => ({
                label: species,
                value: species,
              })),
            ]}
            value={speciesFilter}
          />
          <FilterSelect
            label="Breed"
            onChange={(value) => {
              setPage(0);
              setBreedFilter(value);
            }}
            options={[
              { label: "All breeds", value: "all" },
              ...options.breeds.map((breed) => ({
                label: breed,
                value: breed,
              })),
            ]}
            value={breedFilter}
          />
          <SearchControl
            label="Search item"
            onChange={(value) => {
              setPage(0);
              setItemSearch(value);
            }}
            placeholder="Search item"
            value={itemSearch}
          />
          <ExportButton
            disabled={isExporting}
            label={isExporting ? "Exporting…" : "Export CSV"}
            onClick={onExport}
          />
        </div>
      </SellerCard>

      <SummaryGrid>
        <SummaryCard
          glyph="/glyphs/feed-sack.png"
          label="Item revenue"
          value={formatCurrency(getSummaryNumber(report, "item_revenue"))}
        />
        <SummaryCard
          glyph="/glyphs/egg-carton.png"
          label="Qty sold"
          value={`${getSummaryNumber(report, "quantity_sold")}`}
        />
        <SummaryCard
          glyph="/glyphs/clipboard.png"
          label="Unique items sold"
          value={`${getSummaryNumber(report, "unique_items")}`}
        />
        <SummaryCard
          glyph="/glyphs/checkmark.png"
          label="Top item"
          value={getSummaryString(report, "top_item")}
          wrapValue
        />
      </SummaryGrid>

      <ReportTableCard
        description="Items that sold in this period."
        title="Items sold"
      >
        {itemRows.length > 0 ? (
          <>
            <ItemsTable rows={itemRows} />
            <ReportPagination
              page={page}
              pageSize={reportPageSize}
              setPage={setPage}
              totalCount={report.totalCount}
            />
          </>
        ) : (
          <TabEmptyState
            action={
              <button
                className="seller-secondary-button"
                type="button"
                onClick={() => {
                  setPage(0);
                  setItemTypeFilter("all");
                  setSpeciesFilter("all");
                  setBreedFilter("all");
                  setItemSearch("");
                }}
              >
                Reset filters
              </button>
            }
            description="Try changing the item type, species, breed, or search term."
            title="No items match these filters"
          />
        )}
      </ReportTableCard>
    </div>
  );
}

function CustomersTab({
  customerRows,
  customSpend,
  dateSettings,
  isExporting,
  onExport,
  page,
  report,
  search,
  setCustomSpend,
  setDateSettings,
  setSearch,
  setSpendFilter,
  setPage,
  spendFilter,
}: {
  customerRows: CustomerSummaryRow[];
  customSpend: string;
  dateSettings: DateSettings;
  isExporting: boolean;
  onExport: () => void;
  page: number;
  report: ReportState;
  search: string;
  setCustomSpend: (value: string) => void;
  setDateSettings: (value: DateSettings) => void;
  setSearch: (value: string) => void;
  setSpendFilter: (value: AmountFilter) => void;
  setPage: (value: number) => void;
  spendFilter: AmountFilter;
}) {
  const includesImported = dateSettings.range === "all_time";

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 lg:hidden">
        <SellerCard className="p-3.5">
          <DateRangeControl
            dateSettings={dateSettings}
            onChange={(value) => {
              setPage(0);
              setDateSettings(value);
            }}
          />
          <MobileFilterPanel
            activeCount={[
              spendFilter !== "any",
              Boolean(search.trim()),
            ].filter(Boolean).length}
          >
            <div className="grid gap-3">
              <AmountControl
                customValue={customSpend}
                label="Minimum spend"
                onCustomChange={(value) => {
                  setPage(0);
                  setCustomSpend(value);
                }}
                onFilterChange={(value) => {
                  setPage(0);
                  setSpendFilter(value);
                }}
                value={spendFilter}
              />
              <SearchControl
                label="Search customer"
                onChange={(value) => {
                  setPage(0);
                  setSearch(value);
                }}
                placeholder="Search customers"
                value={search}
              />
            </div>
          </MobileFilterPanel>
          <ActiveFilterChips
            chips={[
              getDateRangeLabel(dateSettings),
              spendFilter === "any"
                ? null
                : getOptionLabel(amountOptions, spendFilter),
              search.trim() ? `Search: ${search.trim()}` : null,
            ]}
          />
        </SellerCard>
        <ExportButton
          disabled={isExporting}
          label={isExporting ? "Exporting…" : "Export CSV"}
          onClick={onExport}
        />
      </div>

      <SellerCard className="hidden p-4 lg:block">
        <div className="grid gap-3 lg:grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)_minmax(14rem,1.35fr)_auto] lg:items-end">
          <DateRangeControl
            dateSettings={dateSettings}
            onChange={(value) => {
              setPage(0);
              setDateSettings(value);
            }}
          />
          <AmountControl
            customValue={customSpend}
            label="Minimum spend"
            onCustomChange={(value) => {
              setPage(0);
              setCustomSpend(value);
            }}
            onFilterChange={(value) => {
              setPage(0);
              setSpendFilter(value);
            }}
            value={spendFilter}
          />
          <SearchControl
            label="Search customer"
            onChange={(value) => {
              setPage(0);
              setSearch(value);
            }}
            placeholder="Search customer"
            value={search}
          />
          <ExportButton
            disabled={isExporting}
            label={isExporting ? "Exporting…" : "Export CSV"}
            onClick={onExport}
          />
        </div>
      </SellerCard>

      {includesImported ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          All-time customer counts and spend are known lifetime values. They
          include imported history where available; dated ranges use only
          FlockFront orders with reliable order dates.
        </p>
      ) : null}

      <SummaryGrid>
        <SummaryCard
          glyph="/glyphs/customers.png"
          label="Total customers"
          value={`${getSummaryNumber(report, "total_customers")}`}
        />
        <SummaryCard
          glyph="/glyphs/reports.png"
          label={includesImported ? "Repeat known customers" : "Repeat customers"}
          value={`${getSummaryNumber(report, "repeat_customers")}`}
        />
        <SummaryCard
          glyph="/glyphs/checkmark.png"
          label="Top customer"
          subvalue={`${formatCurrency(getSummaryNumber(report, "top_customer_spent"))} spent`}
          value={getSummaryString(report, "top_customer_name")}
          wrapValue
        />
        <SummaryCard
          glyph="/glyphs/feed-sack.png"
          label={includesImported ? "Average known spend" : "Average spend"}
          value={formatCurrency(getSummaryNumber(report, "average_spend"))}
        />
      </SummaryGrid>

      <ReportTableCard
        description="Summary of customer purchases in this period."
        title="Customers"
      >
        {customerRows.length > 0 ? (
          <>
            <CustomersTable
              includesImported={includesImported}
              rows={customerRows}
            />
            <ReportPagination
              page={page}
              pageSize={reportPageSize}
              setPage={setPage}
              totalCount={report.totalCount}
            />
          </>
        ) : (
          <TabEmptyState
            action={
              <button
                className="seller-secondary-button"
                type="button"
                onClick={() => {
                  setPage(0);
                  setSpendFilter("any");
                  setSearch("");
                }}
              >
                Reset filters
              </button>
            }
            description="Try a wider date range or lower the minimum spend filter."
            title="No customers match these filters"
          />
        )}
      </ReportTableCard>
    </div>
  );
}

function MobileFilterPanel({
  activeCount,
  children,
}: {
  activeCount: number;
  children: React.ReactNode;
}) {
  return (
    <details className="group mt-3 rounded-lg border border-stone-200 bg-stone-50 lg:hidden">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-3 text-base font-bold text-stone-950 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-emerald-700 [&::-webkit-details-marker]:hidden">
        <span>
          Filters
          {activeCount > 0 ? (
            <span className="ml-2 inline-flex min-w-6 items-center justify-center rounded-full bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-900">
              {activeCount}
            </span>
          ) : null}
        </span>
        <span
          aria-hidden="true"
          className="text-lg text-stone-500 transition group-open:rotate-180"
        >
          &#8964;
        </span>
      </summary>
      <div className="border-t border-stone-200 p-3">{children}</div>
    </details>
  );
}

function ActiveFilterChips({ chips }: { chips: Array<string | null> }) {
  const visibleChips = chips.filter((chip): chip is string => Boolean(chip));

  return (
    <div
      aria-label="Active report filters"
      className="mt-3 flex flex-wrap gap-2 lg:hidden"
    >
      {visibleChips.map((chip) => (
        <span
          className="inline-flex min-h-8 items-center rounded-full bg-emerald-50 px-3 text-xs font-bold text-emerald-900 ring-1 ring-emerald-100"
          key={chip}
        >
          {chip}
        </span>
      ))}
    </div>
  );
}

function DateRangeControl({
  dateSettings,
  onChange,
}: {
  dateSettings: DateSettings;
  onChange: (value: DateSettings) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <FilterSelect
        label="Date range"
        onChange={(value) =>
          onChange({ ...dateSettings, range: value as DateRange })
        }
        options={dateRangeOptions}
        value={dateSettings.range}
      />
      {dateSettings.range === "custom" ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            aria-label="Start date"
            className="min-h-12 rounded-lg border border-stone-300 bg-white px-3 text-base font-medium text-stone-950 shadow-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 lg:min-h-10 lg:rounded-md lg:px-2.5 lg:text-sm"
            type="date"
            value={dateSettings.customStart}
            onChange={(event) =>
              onChange({ ...dateSettings, customStart: event.target.value })
            }
          />
          <input
            aria-label="End date"
            className="min-h-12 rounded-lg border border-stone-300 bg-white px-3 text-base font-medium text-stone-950 shadow-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 lg:min-h-10 lg:rounded-md lg:px-2.5 lg:text-sm"
            type="date"
            value={dateSettings.customEnd}
            onChange={(event) =>
              onChange({ ...dateSettings, customEnd: event.target.value })
            }
          />
        </div>
      ) : null}
    </div>
  );
}

function AmountControl({
  customValue,
  label,
  onCustomChange,
  onFilterChange,
  value,
}: {
  customValue: string;
  label: string;
  onCustomChange: (value: string) => void;
  onFilterChange: (value: AmountFilter) => void;
  value: AmountFilter;
}) {
  return (
    <div className="grid gap-1.5">
      <FilterSelect
        label={label}
        onChange={(nextValue) => onFilterChange(nextValue as AmountFilter)}
        options={amountOptions}
        value={value}
      />
      {value === "custom" ? (
        <input
          aria-label={`${label} custom amount`}
          className="min-h-12 rounded-lg border border-stone-300 bg-white px-3 text-base font-medium text-stone-950 shadow-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 lg:min-h-10 lg:rounded-md lg:px-2.5 lg:text-sm"
          min="0"
          placeholder="Enter amount"
          type="number"
          value={customValue}
          onChange={(event) => onCustomChange(event.target.value)}
        />
      ) : null}
    </div>
  );
}

function FilterSelect({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: { label: string; value: string }[];
  value: string;
}) {
  return (
    <label className="grid min-w-0 gap-1.5 text-base font-bold text-stone-950 lg:gap-1 lg:text-sm lg:font-semibold">
      {label}
      <select
        className="min-h-12 w-full min-w-0 rounded-lg border border-stone-300 bg-white px-3 text-base font-medium text-stone-950 shadow-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 lg:min-h-10 lg:rounded-md lg:px-2.5 lg:text-sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SearchControl({
  label,
  onChange,
  placeholder,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <label className="grid min-w-0 gap-1.5 text-base font-bold text-stone-950 lg:gap-1 lg:text-sm lg:font-semibold">
      {label}
      <input
        className="min-h-12 w-full min-w-0 rounded-lg border border-stone-300 bg-white px-3 text-base font-medium text-stone-950 shadow-sm placeholder:text-stone-500 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 lg:min-h-10 lg:rounded-md lg:px-2.5 lg:text-sm"
        placeholder={placeholder}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function ExportButton({
  disabled = false,
  label,
  onClick,
}: {
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="seller-secondary-button min-h-12 w-full justify-center rounded-lg border-emerald-700 px-3 text-base text-emerald-800 hover:bg-emerald-50 disabled:cursor-wait disabled:opacity-60 lg:min-h-10 lg:w-auto lg:self-end lg:rounded-full lg:text-sm"
      disabled={disabled}
      type="button"
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function ReportPagination({
  page,
  pageSize,
  setPage,
  totalCount,
}: {
  page: number;
  pageSize: number;
  setPage: (value: number) => void;
  totalCount: number;
}) {
  if (totalCount <= pageSize) return null;

  const start = page * pageSize + 1;
  const end = Math.min((page + 1) * pageSize, totalCount);

  return (
    <div className="flex items-center justify-between gap-3 border-t border-stone-200 px-4 py-3 text-sm text-stone-600 sm:px-5">
      <span>
        {start}–{end} of {totalCount}
      </span>
      <div className="flex gap-2">
        <button
          className="seller-secondary-button min-h-10"
          disabled={page === 0}
          onClick={() => setPage(Math.max(page - 1, 0))}
          type="button"
        >
          Previous
        </button>
        <button
          className="seller-secondary-button min-h-10"
          disabled={end >= totalCount}
          onClick={() => setPage(page + 1)}
          type="button"
        >
          Next
        </button>
      </div>
    </div>
  );
}

function SummaryGrid({ children }: { children: React.ReactNode }) {
  return (
    <section className="grid grid-cols-2 gap-2 lg:gap-3 xl:grid-cols-4">
      {children}
    </section>
  );
}

function SummaryCard({
  glyph,
  label,
  subvalue,
  value,
  wrapValue = false,
}: {
  glyph: string;
  label: string;
  subvalue?: string;
  value: string;
  wrapValue?: boolean;
}) {
  return (
    <SellerCard className="h-full min-h-[5.25rem] p-3 lg:min-h-[5.75rem] lg:p-4">
      <div className="flex items-center gap-2.5 lg:gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 lg:size-10">
          <Image src={glyph} alt="" width={19} height={19} />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-stone-600">{label}</p>
          <p
            className={`mt-0.5 text-lg font-bold text-stone-950 lg:text-xl lg:font-semibold ${
              wrapValue
                ? "line-clamp-2 break-words leading-5 lg:block lg:truncate lg:leading-normal"
                : "truncate"
            }`}
            title={value}
          >
            {value}
          </p>
          {subvalue ? (
            <p
              className="mt-0.5 truncate text-xs font-medium text-stone-600"
              title={subvalue}
            >
              {subvalue}
            </p>
          ) : null}
        </div>
      </div>
    </SellerCard>
  );
}

function ReportTableCard({
  children,
  description,
  title,
}: {
  children: React.ReactNode;
  description: string;
  title: string;
}) {
  return (
    <SellerCard className="overflow-hidden">
      <div className="px-4 py-3.5 sm:px-5">
        <h2 className="text-lg font-semibold text-stone-950">{title}</h2>
        <p className="mt-0.5 hidden text-sm leading-5 text-stone-600 lg:block">
          {description}
        </p>
      </div>
      {children}
    </SellerCard>
  );
}

function TabEmptyState({
  action,
  description,
  title,
}: {
  action: React.ReactNode;
  description: string;
  title: string;
}) {
  return (
    <div className="px-4 pb-4 sm:px-5">
      <EmptyState title={title} description={description} action={action} />
    </div>
  );
}

function ResetSalesFilters({ onReset }: { onReset: () => void }) {
  return (
    <button className="seller-secondary-button" type="button" onClick={onReset}>
      Reset filters
    </button>
  );
}

function SalesTable({ orders }: { orders: SellerReportOrderRow[] }) {
  return (
    <>
      <div className="hidden lg:block">
        <table className="w-full text-left text-sm">
          <thead className="border-y border-stone-200 bg-stone-50 text-xs font-semibold uppercase tracking-[0.04em] text-stone-500">
            <tr>
              <TableHeader>Date</TableHeader>
              <TableHeader>Order</TableHeader>
              <TableHeader>Customer</TableHeader>
              <TableHeader>Items</TableHeader>
              <TableHeader align="right">Total</TableHeader>
              <TableHeader>Status</TableHeader>
              <TableHeader align="right">View</TableHeader>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-200">
            {orders.map((order) => (
              <tr className="align-top" key={order.order_id}>
                <TableCell>{formatShortDate(order.created_at)}</TableCell>
                <TableCell>{formatOrderNumber(order.order_number)}</TableCell>
                <TableCell>{formatCustomerName(order)}</TableCell>
                <TableCell>{order.total_item_quantity ?? 0}</TableCell>
                <TableCell align="right">
                  {formatCurrency(order.total_amount)}
                </TableCell>
                <TableCell>
                  <StatusPill label={formatOrderLifecycle(order)} />
                </TableCell>
                <TableCell align="right">
                  <TableLink href={`/dashboard/orders/${order.order_id}`} />
                </TableCell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-2.5 bg-stone-50/70 p-3 lg:hidden">
        {orders.map((order) => (
          <MobileSalesRow
            href={`/dashboard/orders/${order.order_id}`}
            key={order.order_id}
            order={order}
          />
        ))}
      </div>
    </>
  );
}

function ItemsTable({ rows }: { rows: ItemSummaryRow[] }) {
  return (
    <>
      <div className="hidden lg:block">
        <table className="w-full text-left text-sm">
          <thead className="border-y border-stone-200 bg-stone-50 text-xs font-semibold uppercase tracking-[0.04em] text-stone-500">
            <tr>
              <TableHeader>Item</TableHeader>
              <TableHeader>Item type</TableHeader>
              <TableHeader>Species</TableHeader>
              <TableHeader>Breed</TableHeader>
              <TableHeader align="right">Qty sold</TableHeader>
              <TableHeader align="right">Orders</TableHeader>
              <TableHeader align="right">Revenue</TableHeader>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-200">
            {rows.map((item) => (
              <tr className="align-top" key={item.rowKey}>
                <TableCell strong>{item.item}</TableCell>
                <TableCell>{item.itemType}</TableCell>
                <TableCell>{item.species}</TableCell>
                <TableCell>{item.breed}</TableCell>
                <TableCell align="right">{item.quantity}</TableCell>
                <TableCell align="right">{item.orders}</TableCell>
                <TableCell align="right">
                  {formatCurrency(item.revenue)}
                </TableCell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-2.5 bg-stone-50/70 p-3 lg:hidden">
        {rows.map((item) => (
          <MobileItemRow
            item={item}
            key={item.rowKey}
          />
        ))}
      </div>
    </>
  );
}

function CustomersTable({
  includesImported,
  rows,
}: {
  includesImported: boolean;
  rows: CustomerSummaryRow[];
}) {
  return (
    <>
      <div className="hidden lg:block">
        <table className="w-full text-left text-sm">
          <thead className="border-y border-stone-200 bg-stone-50 text-xs font-semibold uppercase tracking-[0.04em] text-stone-500">
            <tr>
              <TableHeader>Customer</TableHeader>
              <TableHeader align="right">
                {includesImported ? "Known orders" : "Orders"}
              </TableHeader>
              <TableHeader align="right">
                {includesImported ? "FlockFront items" : "Items bought"}
              </TableHeader>
              <TableHeader align="right">
                {includesImported ? "Known spend" : "Total spent"}
              </TableHeader>
              <TableHeader>Last order</TableHeader>
              <TableHeader align="right">View</TableHeader>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-200">
            {rows.map((customer) => (
              <tr className="align-top" key={customer.customerId}>
                <TableCell strong>
                  {customer.customerName}
                  {includesImported && customer.importedOrderCount > 0 ? (
                    <span className="mt-0.5 block text-xs font-medium text-amber-800">
                      Includes imported history
                    </span>
                  ) : null}
                </TableCell>
                <TableCell align="right">{customer.orders}</TableCell>
                <TableCell align="right">{customer.itemsBought}</TableCell>
                <TableCell align="right">
                  {formatCurrency(customer.totalSpent)}
                </TableCell>
                <TableCell>{formatShortDate(customer.lastOrder)}</TableCell>
                <TableCell align="right">
                  <TableLink href={`/dashboard/customers/${customer.customerId}`} />
                </TableCell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-2.5 bg-stone-50/70 p-3 lg:hidden">
        {rows.map((customer) => (
          <MobileCustomerRow
            customer={customer}
            href={`/dashboard/customers/${customer.customerId}`}
            includesImported={includesImported}
            key={customer.customerId}
          />
        ))}
      </div>
    </>
  );
}

function TableHeader({
  align = "left",
  children,
}: {
  align?: "left" | "right";
  children: React.ReactNode;
}) {
  return (
    <th className={`px-4 py-2.5 ${align === "right" ? "text-right" : "text-left"}`}>
      {children}
    </th>
  );
}

function TableCell({
  align = "left",
  children,
  strong = false,
}: {
  align?: "left" | "right";
  children: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <td
      className={`px-4 py-2.5 ${align === "right" ? "text-right" : "text-left"} ${
        strong ? "font-semibold text-stone-950" : "text-stone-700"
      }`}
    >
      {children}
    </td>
  );
}

function TableLink({ href }: { href: string }) {
  return (
    <Link
      className="inline-flex min-h-9 items-center justify-center whitespace-nowrap rounded-md border border-emerald-800 bg-emerald-800 px-3 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-800/25"
      href={href}
    >
      View
    </Link>
  );
}

function StatusPill({ label }: { label: string }) {
  return (
    <span className="inline-flex rounded-md bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-700">
      {label}
    </span>
  );
}

function MobileSalesRow({
  href,
  order,
}: {
  href: string;
  order: SellerReportOrderRow;
}) {
  return (
    <Link
      aria-label={`View ${formatOrderNumber(order.order_number)}`}
      className="block min-h-11 rounded-xl border border-stone-200 bg-white p-3.5 shadow-sm transition hover:border-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-700/25"
      href={href}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-bold text-stone-950">
            {formatOrderNumber(order.order_number)}
          </h3>
          <p className="mt-0.5 truncate text-sm text-stone-600">
            {formatCustomerName(order)}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-base font-bold text-stone-950">
            {formatCurrency(order.total_amount)}
          </p>
          <StatusPill label={formatOrderLifecycle(order)} />
        </div>
      </div>
      <p className="mt-2 text-sm font-medium text-stone-600">
        {formatShortDate(order.created_at)} · {order.total_item_quantity ?? 0}{" "}
        {(order.total_item_quantity ?? 0) === 1 ? "item" : "items"}
      </p>
    </Link>
  );
}

function MobileItemRow({ item }: { item: ItemSummaryRow }) {
  const metadata = [item.itemType, item.species, item.breed].filter(
    (value, index, values) => value !== dash && values.indexOf(value) === index,
  );

  return (
    <article className="min-h-11 rounded-xl border border-stone-200 bg-white p-3.5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-bold leading-5 text-stone-950">
            {item.item}
          </h3>
          <p className="mt-1 text-sm text-stone-600">{metadata.join(" · ")}</p>
        </div>
        <p className="shrink-0 text-base font-bold text-stone-950">
          {formatCurrency(item.revenue)}
        </p>
      </div>
      <p className="mt-2 text-sm font-medium text-stone-600">
        {item.quantity} sold · {item.orders}{" "}
        {item.orders === 1 ? "order" : "orders"}
      </p>
    </article>
  );
}

function MobileCustomerRow({
  customer,
  href,
  includesImported,
}: {
  customer: CustomerSummaryRow;
  href: string;
  includesImported: boolean;
}) {
  return (
    <Link
      aria-label={`View ${customer.customerName}`}
      className="block min-h-11 rounded-xl border border-stone-200 bg-white p-3.5 shadow-sm transition hover:border-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-700/25"
      href={href}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 text-base font-bold leading-5 text-stone-950">
          {customer.customerName}
        </h3>
        <p className="shrink-0 text-base font-bold text-stone-950">
          {formatCurrency(customer.totalSpent)}
        </p>
      </div>
      <p className="mt-1.5 text-sm text-stone-600">
        {customer.orders} {customer.orders === 1 ? "order" : "orders"} ·{" "}
        {customer.itemsBought} {customer.itemsBought === 1 ? "item" : "items"}
      </p>
      <p className="mt-1 text-sm font-medium text-stone-600">
        Last order {formatShortDate(customer.lastOrder)}
      </p>
      {includesImported && customer.importedOrderCount > 0 ? (
        <p className="mt-1 text-xs font-semibold text-amber-800">
          Includes {customer.importedOrderCount} imported historical{" "}
          {customer.importedOrderCount === 1 ? "order" : "orders"}
        </p>
      ) : null}
    </Link>
  );
}

function buildSalesCsvRows(
  orders: SellerReportOrderRow[],
) {
  return [
    [
      "Date",
      "Order Number",
      "Customer Name",
      "Customer Email",
      "Customer Phone",
      "Order Status",
      "Item Summary",
      "Items Count",
      "Order Total",
      "Payment Method",
      "Notes",
    ],
    ...orders.map((order) => {
      return [
        formatShortDate(order.created_at),
        order.order_number,
        formatCustomerName(order),
        order.buyer_email_snapshot ?? "",
        order.buyer_phone_snapshot ?? "",
        formatOrderLifecycle(order),
        order.item_summary ?? "",
        `${order.total_item_quantity ?? order.item_count ?? 0}`,
        formatCsvNumber(order.total_amount),
        formatPaymentMethod(order.payment_method),
        [order.buyer_notes, order.pickup_note].filter(Boolean).join(" "),
      ];
    }),
  ];
}

function buildItemsCsvRows(rows: ItemSummaryRow[], dateRangeLabel: string) {
  return [
    [
      "Item",
      "Item Type",
      "Species",
      "Breed",
      "Qty Sold",
      "Orders",
      "Revenue",
      "Date Range",
    ],
    ...rows.map((row) => [
      row.item,
      row.itemType,
      row.species,
      row.breed,
      `${row.quantity}`,
      `${row.orders}`,
      formatCsvNumber(row.revenue),
      dateRangeLabel,
    ]),
  ];
}

function buildCustomersCsvRows(
  rows: CustomerSummaryRow[],
  dateRangeLabel: string,
) {
  const isAllTime = dateRangeLabel === "All time";

  return [
    [
      "Customer ID",
      "First Name",
      "Last Name",
      "Farm or Business Name",
      "Email",
      "Phone",
      "Mailing Address Line 1",
      "Mailing Address Line 2",
      "Mailing City",
      "Mailing State",
      "Mailing ZIP Code",
      "Mailing Country",
      "Private Notes",
      "Customer Created Date",
      "Last Updated Date",
      isAllTime ? "Known Lifetime Orders" : "Orders in Date Range",
      isAllTime ? "FlockFront Items Purchased" : "Items Purchased in Date Range",
      isAllTime ? "Known Lifetime Spend" : "Total Spent in Date Range",
      "Total Orders",
      "Working/Open Orders",
      "Lifetime Total",
      "Imported Historical Orders",
      "Imported Historical Total",
      "Imported Source",
      "Last Order",
      "Last Order Total",
      "Date Range",
    ],
    ...rows.map((row) => [
      row.customerId,
      row.customerFirstName,
      row.customerLastName,
      row.businessName,
      row.customerEmail,
      row.customerPhone,
      row.mailingAddressLine1,
      row.mailingAddressLine2,
      row.mailingCity,
      row.mailingState,
      row.mailingPostalCode,
      row.mailingCountry,
      row.internalNotes,
      formatCsvDateTime(row.createdAt),
      formatCsvDateTime(row.updatedAt),
      `${row.orders}`,
      `${row.itemsBought}`,
      formatCsvNumber(row.totalSpent),
      `${row.totalOrders}`,
      `${row.openOrders}`,
      formatCsvNumber(row.lifetimeOrderTotal),
      `${row.importedOrderCount}`,
      formatCsvNumber(row.importedOrderTotal),
      row.importedSource,
      formatCsvDateTime(row.latestOrderAt),
      formatCsvNumber(row.lastOrderTotal),
      dateRangeLabel,
    ]),
  ];
}

function escapeCsvCell(value: string) {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }

  return value;
}

function getDateBounds(settings: DateSettings) {
  const now = new Date();
  const end = new Date(now);

  if (settings.range === "all_time") return { end: null, start: null };

  if (settings.range === "custom") {
    return {
      end: settings.customEnd ? endOfDay(settings.customEnd) : null,
      start: settings.customStart ? startOfDay(settings.customStart) : null,
    };
  }

  if (settings.range === "this_year") {
    return { end, start: new Date(now.getFullYear(), 0, 1) };
  }

  const days =
    settings.range === "last_7_days"
      ? 7
      : settings.range === "last_90_days"
        ? 90
        : 30;
  const start = new Date(now);
  start.setDate(start.getDate() - days);

  return { end, start };
}

function downloadCsvParts({
  filename,
  parts,
}: {
  filename: string;
  parts: string[];
}) {
  const blob = new Blob(parts, { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildReportRpcParameters({
  amountOver,
  breed,
  dateSettings,
  includeImported,
  itemType,
  limit,
  offset,
  report,
  search,
  species,
  storeId,
}: {
  amountOver: number | null;
  breed: string;
  dateSettings: DateSettings;
  includeImported: boolean;
  itemType: ItemTypeFilter;
  limit: number;
  offset: number;
  report: ReportTab;
  search: string;
  species: string;
  storeId: string | null;
}) {
  if (!storeId) return null;

  const { end, start } = getDateBounds(dateSettings);

  return {
    p_amount_over: amountOver,
    p_breed: breed,
    p_end_at: end?.toISOString() ?? null,
    p_include_imported: includeImported,
    p_item_type: itemType,
    p_limit: limit,
    p_offset: offset,
    p_report: report,
    p_search: search,
    p_species: species,
    p_start_at: start?.toISOString() ?? null,
    p_store_id: storeId,
  };
}

function normalizeReportResponse(tab: ReportTab, value: unknown): ReportState {
  const response = (value ?? {}) as ReportResponse<Record<string, unknown>>;
  const rawRows = Array.isArray(response.rows) ? response.rows : [];
  const rows =
    tab === "sales"
      ? rawRows.map(normalizeSalesRow)
      : tab === "items"
        ? rawRows.map(normalizeItemRow)
        : rawRows.map(normalizeCustomerRow);

  return {
    hasAnyData: Boolean(response.has_any_data),
    options: {
      breeds: response.options?.breeds ?? [],
      species: response.options?.species ?? [],
    },
    rows,
    summary: response.summary ?? {},
    tab,
    totalCount: Number(response.total_count ?? 0),
  };
}

function normalizeSalesRow(
  row: Record<string, unknown>,
): SellerReportOrderRow {
  return {
    buyer_email_snapshot: nullableString(row.buyer_email_snapshot),
    buyer_first_name_snapshot: nullableString(row.buyer_first_name_snapshot),
    buyer_last_name_snapshot: nullableString(row.buyer_last_name_snapshot),
    buyer_notes: nullableString(row.buyer_notes),
    buyer_phone_snapshot: nullableString(row.buyer_phone_snapshot),
    created_at: String(row.created_at ?? ""),
    customer_id: nullableString(row.customer_id),
    item_count: nullableNumber(row.item_count),
    item_summary: String(row.item_summary ?? ""),
    order_id: String(row.order_id ?? ""),
    order_number: String(row.order_number ?? dash),
    order_status: nullableString(row.order_status),
    payment_method: nullableString(row.payment_method),
    pickup_note: nullableString(row.pickup_note),
    ready_for_pickup_at: nullableString(row.ready_for_pickup_at),
    total_amount: nullableNumber(row.total_amount),
    total_item_quantity: nullableNumber(row.total_item_quantity),
  };
}

function normalizeItemRow(row: Record<string, unknown>): ItemSummaryRow {
  const breed = String(row.breed ?? dash);
  const item = String(row.item ?? "Item");
  const itemType = String(
    row.item_type ?? row.itemType ?? "Custom / Other",
  ) as Exclude<ItemTypeFilter, "all">;
  const species = String(row.species ?? dash);

  return {
    breed,
    item,
    itemType,
    orders: Number(row.orders ?? 0),
    quantity: Number(row.quantity ?? 0),
    revenue: Number(row.revenue ?? 0),
    rowKey: JSON.stringify([item, itemType, species, breed]),
    species,
  };
}

function normalizeItemRows(rows: ReportState["rows"]) {
  return rows.map((row) =>
    normalizeItemRow(row as unknown as Record<string, unknown>),
  );
}

function normalizeCustomerRow(
  row: Record<string, unknown>,
): CustomerSummaryRow {
  return {
    businessName: String(row.business_name ?? ""),
    createdAt: String(row.created_at ?? ""),
    customerEmail: String(row.customer_email ?? ""),
    customerFirstName: String(row.customer_first_name ?? ""),
    customerId: String(row.customer_id ?? ""),
    customerLastName: String(row.customer_last_name ?? ""),
    customerName: String(row.customer_name ?? "Customer"),
    customerPhone: String(row.customer_phone ?? ""),
    importedOrderCount: Number(row.imported_order_count ?? 0),
    importedOrderTotal: Number(row.imported_order_total ?? 0),
    importedSource: String(row.imported_source ?? ""),
    internalNotes: String(row.internal_notes ?? ""),
    itemsBought: Number(row.items_bought ?? 0),
    lastOrder: row.last_order ? String(row.last_order) : null,
    lastOrderTotal: Number(row.last_order_total ?? 0),
    latestOrderAt: row.latest_order_at ? String(row.latest_order_at) : null,
    lifetimeOrderTotal: Number(row.lifetime_order_total ?? 0),
    mailingAddressLine1: String(row.mailing_address_line1 ?? ""),
    mailingAddressLine2: String(row.mailing_address_line2 ?? ""),
    mailingCity: String(row.mailing_city ?? ""),
    mailingCountry: String(row.mailing_country ?? ""),
    mailingPostalCode: String(row.mailing_postal_code ?? ""),
    mailingState: String(row.mailing_state ?? ""),
    nativeOrders: Number(row.native_orders ?? 0),
    nativeSpent: Number(row.native_spent ?? 0),
    openOrders: Number(row.open_orders ?? 0),
    orders: Number(row.orders ?? 0),
    totalOrders: Number(row.total_orders ?? 0),
    totalSpent: Number(row.total_spent ?? 0),
    updatedAt: String(row.updated_at ?? ""),
  };
}

function nullableNumber(value: unknown) {
  return value === null || value === undefined ? null : Number(value);
}

function nullableString(value: unknown) {
  return value === null || value === undefined ? null : String(value);
}

function getSummaryNumber(report: ReportState, key: string) {
  return Number(report.summary[key] ?? 0);
}

function getSummaryString(report: ReportState, key: string) {
  return String(report.summary[key] ?? dash);
}

function startOfDay(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function endOfDay(value: string) {
  const date = new Date(`${value}T23:59:59`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getAmountThreshold(filter: AmountFilter, customAmount: string) {
  if (filter === "any") return null;
  if (filter === "over_25") return 25;
  if (filter === "over_50") return 50;
  if (filter === "over_100") return 100;

  const value = Number(customAmount);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function getSalesOverLabel(threshold: number | null) {
  return threshold === null ? "Sales count" : `Sales over $${threshold}`;
}

function getDateRangeLabel(settings: DateSettings) {
  if (settings.range !== "custom") {
    return (
      dateRangeOptions.find((option) => option.value === settings.range)
        ?.label ?? "Selected dates"
    );
  }

  if (settings.customStart && settings.customEnd) {
    return `${settings.customStart} to ${settings.customEnd}`;
  }

  return "Custom";
}

function formatCustomerName(customer: {
  buyer_first_name_snapshot?: string | null;
  buyer_last_name_snapshot?: string | null;
  business_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}) {
  return (
    customer.business_name ||
    [
      customer.first_name ?? customer.buyer_first_name_snapshot,
      customer.last_name ?? customer.buyer_last_name_snapshot,
    ]
      .filter(Boolean)
      .join(" ") ||
    "Customer"
  );
}

function formatShortDate(value: string | null) {
  if (!value) return dash;

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatCsvDateTime(value: string | null) {
  if (!value) return "";

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatOrderNumber(value: string) {
  return value.startsWith("#") ? value : `#${value}`;
}

function formatCsvNumber(value: number | null) {
  return value === null ? "" : value.toFixed(2);
}

function formatFileDate(value: Date) {
  return value.toISOString().slice(0, 10);
}
