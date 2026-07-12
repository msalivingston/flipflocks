"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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
  formatInventoryLabel,
  formatOrderLifecycle,
  formatPaymentMethod,
  getOrderLifecycleState,
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
  | "Equipment";

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
};

type SellerReportItemRow = {
  order_id: string;
  order_item_id: string;
  inventory_item_id: string | null;
  equipment_inventory_item_id: string | null;
  processed_poultry_inventory_item_id: string | null;
  species_name_snapshot: string | null;
  breed_display_name_snapshot: string | null;
  inventory_type_snapshot: string | null;
  custom_inventory_label_snapshot: string | null;
  batch_type_snapshot: string | null;
  product_type_snapshot: string | null;
  item_name_snapshot: string | null;
  item_category_snapshot: string | null;
  custom_item_name_snapshot: string | null;
  unit_price_snapshot: number | null;
  quantity: number | null;
  line_subtotal: number | null;
};

type SellerReportCustomerRow = {
  customer_id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  business_name: string | null;
};

type ReportData = {
  customers: SellerReportCustomerRow[];
  items: SellerReportItemRow[];
  orders: SellerReportOrderRow[];
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
  orderIds: Set<string>;
  orders: number;
  quantity: number;
  revenue: number;
  species: string;
};

type CustomerSummaryRow = {
  customerEmail: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  itemsBought: number;
  lastOrder: string;
  orders: number;
  totalSpent: number;
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
  { label: "Equipment", value: "Equipment" },
];

const dash = "\u2014";

export function ReportsDashboard() {
  const { seller } = useSellerContext();
  const [activeTab, setActiveTab] = useState<ReportTab>("sales");
  const [data, setData] = useState<ReportData>({
    customers: [],
    items: [],
    orders: [],
  });
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
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadReports() {
      if (!seller) return;

      setIsLoading(true);
      setError(null);

      const [ordersResult, itemsResult, customersResult] = await Promise.all([
        supabase
          .from("seller_order_management")
          .select(
            "order_id, order_number, order_status, payment_method, ready_for_pickup_at, created_at, customer_id, buyer_first_name_snapshot, buyer_last_name_snapshot, buyer_email_snapshot, buyer_phone_snapshot, buyer_notes, pickup_note, total_amount, item_count, total_item_quantity",
          )
          .eq("store_id", seller.store_id)
          .order("created_at", { ascending: false })
          .limit(1000)
          .returns<SellerReportOrderRow[]>(),
        supabase
          .from("seller_order_item_detail")
          .select(
            "order_id, order_item_id, inventory_item_id, equipment_inventory_item_id, processed_poultry_inventory_item_id, species_name_snapshot, breed_display_name_snapshot, inventory_type_snapshot, custom_inventory_label_snapshot, batch_type_snapshot, product_type_snapshot, item_name_snapshot, item_category_snapshot, custom_item_name_snapshot, unit_price_snapshot, quantity, line_subtotal",
          )
          .eq("store_id", seller.store_id)
          .order("created_at", { ascending: false })
          .limit(2000)
          .returns<SellerReportItemRow[]>(),
        supabase
          .from("seller_customer_summary")
          .select(
            "customer_id, email, first_name, last_name, phone, business_name",
          )
          .eq("store_id", seller.store_id)
          .limit(1000)
          .returns<SellerReportCustomerRow[]>(),
      ]);

      if (!isMounted) return;

      const firstError =
        ordersResult.error ?? itemsResult.error ?? customersResult.error;

      if (firstError) {
        setError(firstError.message);
        setIsLoading(false);
        return;
      }

      setData({
        customers: customersResult.data ?? [],
        items: itemsResult.data ?? [],
        orders: ordersResult.data ?? [],
      });
      setIsLoading(false);
    }

    void loadReports();

    return () => {
      isMounted = false;
    };
  }, [seller]);

  const itemSummaryByOrder = useMemo(
    () => buildOrderItemSummaryMap(data.items),
    [data.items],
  );
  const customerLookup = useMemo(
    () =>
      new Map(data.customers.map((customer) => [customer.customer_id, customer])),
    [data.customers],
  );
  const dateRangeLabel = getDateRangeLabel(dateSettings);

  const salesReport = useMemo(() => {
    const dateOrders = data.orders
      .filter(isSaleOrder)
      .filter((order) => isOrderInDateRange(order, dateSettings));
    const threshold = getAmountThreshold(salesAmountFilter, salesCustomAmount);
    const filteredOrders =
      threshold === null
        ? dateOrders
        : dateOrders.filter((order) => (order.total_amount ?? 0) > threshold);
    const totalSales = dateOrders.reduce(
      (total, order) => total + (order.total_amount ?? 0),
      0,
    );
    const salesOverAmount =
      threshold === null
        ? dateOrders.length
        : dateOrders.filter((order) => (order.total_amount ?? 0) > threshold)
            .length;

    return {
      averageSale: dateOrders.length > 0 ? totalSales / dateOrders.length : 0,
      filteredOrders,
      salesOverAmount,
      threshold,
      totalSales,
      totalSalesCount: dateOrders.length,
    };
  }, [data.orders, dateSettings, salesAmountFilter, salesCustomAmount]);

  const itemBaseRows = useMemo(() => {
    const saleOrderIds = new Set(
      data.orders
        .filter(isSaleOrder)
        .filter((order) => isOrderInDateRange(order, dateSettings))
        .map((order) => order.order_id),
    );

    return buildItemSummaries(
      data.items.filter((item) => saleOrderIds.has(item.order_id)),
    );
  }, [data.items, data.orders, dateSettings]);

  const itemOptions = useMemo(() => {
    const byTypeAndSearch = itemBaseRows.filter((item) => {
      const matchesType =
        itemTypeFilter === "all" || item.itemType === itemTypeFilter;
      const matchesSearch = matchesSearchTerm(
        [item.item, item.itemType, item.species, item.breed],
        itemSearch,
      );

      return matchesType && matchesSearch;
    });
    const bySpecies = byTypeAndSearch.filter(
      (item) => speciesFilter === "all" || item.species === speciesFilter,
    );

    return {
      breeds: getDistinctOptions(bySpecies.map((item) => item.breed)),
      species: getDistinctOptions(byTypeAndSearch.map((item) => item.species)),
    };
  }, [itemBaseRows, itemSearch, itemTypeFilter, speciesFilter]);

  const filteredItemRows = useMemo(
    () =>
      itemBaseRows.filter((item) => {
        const matchesType =
          itemTypeFilter === "all" || item.itemType === itemTypeFilter;
        const matchesSpecies =
          speciesFilter === "all" || item.species === speciesFilter;
        const matchesBreed = breedFilter === "all" || item.breed === breedFilter;
        const matchesSearch = matchesSearchTerm(
          [item.item, item.itemType, item.species, item.breed],
          itemSearch,
        );

        return matchesType && matchesSpecies && matchesBreed && matchesSearch;
      }),
    [breedFilter, itemBaseRows, itemSearch, itemTypeFilter, speciesFilter],
  );

  const customerBaseRows = useMemo(() => {
    const saleOrders = data.orders
      .filter(isSaleOrder)
      .filter((order) => isOrderInDateRange(order, dateSettings));

    return buildCustomerSummaries(saleOrders, customerLookup);
  }, [customerLookup, data.orders, dateSettings]);

  const filteredCustomerRows = useMemo(() => {
    const threshold = getAmountThreshold(
      customerSpendFilter,
      customerCustomSpend,
    );

    return customerBaseRows.filter((customer) => {
      const matchesSpend =
        threshold === null || customer.totalSpent > threshold;
      const matchesSearch = matchesSearchTerm(
        [customer.customerName, customer.customerEmail, customer.customerPhone],
        customerSearch,
      );

      return matchesSpend && matchesSearch;
    });
  }, [
    customerBaseRows,
    customerCustomSpend,
    customerSearch,
    customerSpendFilter,
  ]);

  if (isLoading) {
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

  if (data.orders.length === 0) {
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
      <div className="rounded-b-xl rounded-tr-xl border border-stone-200 bg-white p-4 shadow-sm sm:p-5">
        {activeTab === "sales" ? (
          <SalesTab
            amountFilter={salesAmountFilter}
            customAmount={salesCustomAmount}
            dateSettings={dateSettings}
            itemSummaryByOrder={itemSummaryByOrder}
            report={salesReport}
            setAmountFilter={setSalesAmountFilter}
            setCustomAmount={setSalesCustomAmount}
            setDateSettings={setDateSettings}
          />
        ) : null}

        {activeTab === "items" ? (
          <ItemsTab
            breedFilter={breedFilter}
            dateRangeLabel={dateRangeLabel}
            dateSettings={dateSettings}
            itemRows={filteredItemRows}
            itemSearch={itemSearch}
            itemTypeFilter={itemTypeFilter}
            options={itemOptions}
            setBreedFilter={setBreedFilter}
            setDateSettings={setDateSettings}
            setItemSearch={setItemSearch}
            setItemTypeFilter={setItemTypeFilter}
            setSpeciesFilter={setSpeciesFilter}
            speciesFilter={speciesFilter}
          />
        ) : null}

        {activeTab === "customers" ? (
          <CustomersTab
            customerRows={filteredCustomerRows}
            customSpend={customerCustomSpend}
            dateRangeLabel={dateRangeLabel}
            dateSettings={dateSettings}
            search={customerSearch}
            setCustomSpend={setCustomerCustomSpend}
            setDateSettings={setDateSettings}
            setSearch={setCustomerSearch}
            setSpendFilter={setCustomerSpendFilter}
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
      className="flex gap-1 overflow-x-auto border-b border-stone-200 pl-px [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="tablist"
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.value;

        return (
          <button
            aria-selected={isActive}
            className={`relative mb-[-1px] min-h-11 shrink-0 rounded-t-lg border px-4 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-inset focus:ring-emerald-700 ${
              isActive
                ? "border-stone-200 border-b-white bg-white text-stone-950 shadow-[0_-1px_0_rgba(0,0,0,0.02)]"
                : "border-transparent bg-stone-100/70 text-stone-600 hover:bg-white hover:text-stone-950"
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
  itemSummaryByOrder,
  report,
  setAmountFilter,
  setCustomAmount,
  setDateSettings,
}: {
  amountFilter: AmountFilter;
  customAmount: string;
  dateSettings: DateSettings;
  itemSummaryByOrder: Map<string, string>;
  report: {
    averageSale: number;
    filteredOrders: SellerReportOrderRow[];
    salesOverAmount: number;
    threshold: number | null;
    totalSales: number;
    totalSalesCount: number;
  };
  setAmountFilter: (value: AmountFilter) => void;
  setCustomAmount: (value: string) => void;
  setDateSettings: (value: DateSettings) => void;
}) {
  return (
    <div className="grid gap-4">
      <SellerCard className="p-3.5 sm:p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)_auto] lg:items-end">
          <DateRangeControl
            dateSettings={dateSettings}
            onChange={setDateSettings}
          />
          <AmountControl
            customValue={customAmount}
            label="Order amount"
            onCustomChange={setCustomAmount}
            onFilterChange={setAmountFilter}
            value={amountFilter}
          />
          <ExportButton
            label="Export CSV"
            onClick={() =>
              downloadCsv({
                filename: `flockfront-sales-${formatFileDate(new Date())}.csv`,
                rows: buildSalesCsvRows(
                  report.filteredOrders,
                  itemSummaryByOrder,
                ),
              })
            }
          />
        </div>
      </SellerCard>

      <SummaryGrid>
        <SummaryCard
          glyph="/glyphs/feed-sack.png"
          label="Total sales"
          value={formatCurrency(report.totalSales)}
        />
        <SummaryCard
          glyph="/glyphs/shopping-bag.png"
          label="Number of sales"
          value={`${report.totalSalesCount}`}
        />
        <SummaryCard
          glyph="/glyphs/reports.png"
          label={getSalesOverLabel(report.threshold)}
          value={`${report.salesOverAmount}`}
        />
        <SummaryCard
          glyph="/glyphs/egg.png"
          label="Average sale"
          value={formatCurrency(report.averageSale)}
        />
      </SummaryGrid>

      <ReportTableCard
        description="Orders that match your filters."
        title="Sales detail"
      >
        {report.filteredOrders.length > 0 ? (
          <SalesTable orders={report.filteredOrders} />
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
  dateRangeLabel,
  dateSettings,
  itemRows,
  itemSearch,
  itemTypeFilter,
  options,
  setBreedFilter,
  setDateSettings,
  setItemSearch,
  setItemTypeFilter,
  setSpeciesFilter,
  speciesFilter,
}: {
  breedFilter: string;
  dateRangeLabel: string;
  dateSettings: DateSettings;
  itemRows: ItemSummaryRow[];
  itemSearch: string;
  itemTypeFilter: ItemTypeFilter;
  options: { breeds: string[]; species: string[] };
  setBreedFilter: (value: string) => void;
  setDateSettings: (value: DateSettings) => void;
  setItemSearch: (value: string) => void;
  setItemTypeFilter: (value: ItemTypeFilter) => void;
  setSpeciesFilter: (value: string) => void;
  speciesFilter: string;
}) {
  const totalRevenue = sumBy(itemRows, (item) => item.revenue);
  const quantitySold = sumBy(itemRows, (item) => item.quantity);
  const topItem = itemRows[0]?.item ?? dash;

  return (
    <div className="grid gap-4">
      <SellerCard className="p-3.5 sm:p-4">
        <div className="grid gap-3 lg:grid-cols-[repeat(4,minmax(8.5rem,1fr))] xl:grid-cols-[minmax(8.5rem,1fr)_minmax(7.75rem,0.85fr)_minmax(7.75rem,0.85fr)_minmax(7.75rem,0.85fr)_minmax(12rem,1.25fr)_auto] xl:items-end">
          <DateRangeControl
            dateSettings={dateSettings}
            onChange={setDateSettings}
          />
          <FilterSelect
            label="Item type"
            onChange={(value) => {
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
            onChange={setBreedFilter}
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
            onChange={setItemSearch}
            placeholder="Search item"
            value={itemSearch}
          />
          <ExportButton
            label="Export CSV"
            onClick={() =>
              downloadCsv({
                filename: `flockfront-items-${formatFileDate(new Date())}.csv`,
                rows: buildItemsCsvRows(itemRows, dateRangeLabel),
              })
            }
          />
        </div>
      </SellerCard>

      <SummaryGrid>
        <SummaryCard
          glyph="/glyphs/feed-sack.png"
          label="Item revenue"
          value={formatCurrency(totalRevenue)}
        />
        <SummaryCard
          glyph="/glyphs/egg-carton.png"
          label="Qty sold"
          value={`${quantitySold}`}
        />
        <SummaryCard
          glyph="/glyphs/clipboard.png"
          label="Unique items sold"
          value={`${itemRows.length}`}
        />
        <SummaryCard
          glyph="/glyphs/checkmark.png"
          label="Top item"
          value={topItem}
        />
      </SummaryGrid>

      <ReportTableCard
        description="Items that sold in this period."
        title="Items sold"
      >
        {itemRows.length > 0 ? (
          <ItemsTable rows={itemRows} />
        ) : (
          <TabEmptyState
            action={
              <button
                className="seller-secondary-button"
                type="button"
                onClick={() => {
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
  dateRangeLabel,
  dateSettings,
  search,
  setCustomSpend,
  setDateSettings,
  setSearch,
  setSpendFilter,
  spendFilter,
}: {
  customerRows: CustomerSummaryRow[];
  customSpend: string;
  dateRangeLabel: string;
  dateSettings: DateSettings;
  search: string;
  setCustomSpend: (value: string) => void;
  setDateSettings: (value: DateSettings) => void;
  setSearch: (value: string) => void;
  setSpendFilter: (value: AmountFilter) => void;
  spendFilter: AmountFilter;
}) {
  const topCustomer = customerRows[0];
  const totalSpent = sumBy(customerRows, (customer) => customer.totalSpent);
  const averageSpend =
    customerRows.length > 0 ? totalSpent / customerRows.length : 0;

  return (
    <div className="grid gap-4">
      <SellerCard className="p-3.5 sm:p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)_minmax(14rem,1.35fr)_auto] lg:items-end">
          <DateRangeControl
            dateSettings={dateSettings}
            onChange={setDateSettings}
          />
          <AmountControl
            customValue={customSpend}
            label="Minimum spend"
            onCustomChange={setCustomSpend}
            onFilterChange={setSpendFilter}
            value={spendFilter}
          />
          <SearchControl
            label="Search customer"
            onChange={setSearch}
            placeholder="Search customer"
            value={search}
          />
          <ExportButton
            label="Export CSV"
            onClick={() =>
              downloadCsv({
                filename: `flockfront-customers-${formatFileDate(new Date())}.csv`,
                rows: buildCustomersCsvRows(customerRows, dateRangeLabel),
              })
            }
          />
        </div>
      </SellerCard>

      <SummaryGrid>
        <SummaryCard
          glyph="/glyphs/customers.png"
          label="Total customers"
          value={`${customerRows.length}`}
        />
        <SummaryCard
          glyph="/glyphs/reports.png"
          label="Repeat customers"
          value={`${customerRows.filter((customer) => customer.orders > 1).length}`}
        />
        <SummaryCard
          glyph="/glyphs/checkmark.png"
          label="Top customer"
          subvalue={
            topCustomer ? `${formatCurrency(topCustomer.totalSpent)} spent` : ""
          }
          value={topCustomer?.customerName ?? dash}
        />
        <SummaryCard
          glyph="/glyphs/feed-sack.png"
          label="Average spend"
          value={formatCurrency(averageSpend)}
        />
      </SummaryGrid>

      <ReportTableCard
        description="Summary of customer purchases in this period."
        title="Customers"
      >
        {customerRows.length > 0 ? (
          <CustomersTable rows={customerRows} />
        ) : (
          <TabEmptyState
            action={
              <button
                className="seller-secondary-button"
                type="button"
                onClick={() => {
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
            className="min-h-10 rounded-md border border-stone-300 bg-white px-2.5 text-sm font-medium text-stone-950 shadow-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
            type="date"
            value={dateSettings.customStart}
            onChange={(event) =>
              onChange({ ...dateSettings, customStart: event.target.value })
            }
          />
          <input
            aria-label="End date"
            className="min-h-10 rounded-md border border-stone-300 bg-white px-2.5 text-sm font-medium text-stone-950 shadow-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
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
          className="min-h-10 rounded-md border border-stone-300 bg-white px-2.5 text-sm font-medium text-stone-950 shadow-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
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
    <label className="grid min-w-0 gap-1 text-sm font-semibold text-stone-950">
      {label}
      <select
        className="min-h-10 w-full min-w-0 rounded-md border border-stone-300 bg-white px-2.5 text-sm font-medium text-stone-950 shadow-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
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
    <label className="grid min-w-0 gap-1 text-sm font-semibold text-stone-950">
      {label}
      <input
        className="min-h-10 w-full min-w-0 rounded-md border border-stone-300 bg-white px-2.5 text-sm font-medium text-stone-950 shadow-sm placeholder:text-stone-500 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
        placeholder={placeholder}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function ExportButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="seller-secondary-button min-h-10 justify-center border-emerald-700 px-3 text-sm text-emerald-800 hover:bg-emerald-50 lg:self-end"
      type="button"
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function SummaryGrid({ children }: { children: React.ReactNode }) {
  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {children}
    </section>
  );
}

function SummaryCard({
  glyph,
  label,
  subvalue,
  value,
}: {
  glyph: string;
  label: string;
  subvalue?: string;
  value: string;
}) {
  return (
    <SellerCard className="min-h-[5.75rem] p-4">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-100">
          <Image src={glyph} alt="" width={20} height={20} />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-stone-600">{label}</p>
          <p
            className="mt-0.5 truncate text-xl font-semibold text-stone-950"
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
        <p className="mt-0.5 text-sm leading-5 text-stone-600">
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
      <div className="hidden md:block">
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
      <div className="divide-y divide-stone-200 md:hidden">
        {orders.map((order) => (
          <MobileRow
            href={`/dashboard/orders/${order.order_id}`}
            key={order.order_id}
            rows={[
              ["Date", formatShortDate(order.created_at)],
              ["Customer", formatCustomerName(order)],
              ["Items", `${order.total_item_quantity ?? 0}`],
              ["Total", formatCurrency(order.total_amount)],
              ["Status", formatOrderLifecycle(order)],
            ]}
            title={formatOrderNumber(order.order_number)}
          />
        ))}
      </div>
    </>
  );
}

function ItemsTable({ rows }: { rows: ItemSummaryRow[] }) {
  return (
    <>
      <div className="hidden md:block">
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
              <tr className="align-top" key={`${item.item}-${item.itemType}`}>
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
      <div className="divide-y divide-stone-200 md:hidden">
        {rows.map((item) => (
          <MobileRow
            key={`${item.item}-${item.itemType}`}
            rows={[
              ["Item type", item.itemType],
              ["Species", item.species],
              ["Breed", item.breed],
              ["Qty sold", `${item.quantity}`],
              ["Orders", `${item.orders}`],
              ["Revenue", formatCurrency(item.revenue)],
            ]}
            title={item.item}
          />
        ))}
      </div>
    </>
  );
}

function CustomersTable({ rows }: { rows: CustomerSummaryRow[] }) {
  return (
    <>
      <div className="hidden md:block">
        <table className="w-full text-left text-sm">
          <thead className="border-y border-stone-200 bg-stone-50 text-xs font-semibold uppercase tracking-[0.04em] text-stone-500">
            <tr>
              <TableHeader>Customer</TableHeader>
              <TableHeader align="right">Orders</TableHeader>
              <TableHeader align="right">Items bought</TableHeader>
              <TableHeader align="right">Total spent</TableHeader>
              <TableHeader>Last order</TableHeader>
              <TableHeader align="right">View</TableHeader>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-200">
            {rows.map((customer) => (
              <tr className="align-top" key={customer.customerId}>
                <TableCell strong>{customer.customerName}</TableCell>
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
      <div className="divide-y divide-stone-200 md:hidden">
        {rows.map((customer) => (
          <MobileRow
            href={`/dashboard/customers/${customer.customerId}`}
            key={customer.customerId}
            rows={[
              ["Orders", `${customer.orders}`],
              ["Items bought", `${customer.itemsBought}`],
              ["Total spent", formatCurrency(customer.totalSpent)],
              ["Last order", formatShortDate(customer.lastOrder)],
            ]}
            title={customer.customerName}
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
    <Link className="text-sm font-semibold text-emerald-800 hover:text-emerald-950" href={href}>
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

function MobileRow({
  href,
  rows,
  title,
}: {
  href?: string;
  rows: [string, string][];
  title: string;
}) {
  return (
    <div className="grid gap-2.5 px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-stone-950">{title}</h3>
        {href ? <TableLink href={href} /> : null}
      </div>
      <dl className="grid gap-1.5">
        {rows.map(([label, value]) => (
          <div className="flex items-center justify-between gap-4" key={label}>
            <dt className="text-xs font-medium text-stone-500">{label}</dt>
            <dd className="text-right text-sm font-semibold text-stone-950">
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function buildItemSummaries(items: SellerReportItemRow[]) {
  const summaries = new Map<string, ItemSummaryRow>();

  for (const item of items) {
    const itemType = getBroadItemType(item);
    const name = getItemName(item, itemType);
    const species = itemType === "Equipment" ? dash : item.species_name_snapshot || dash;
    const breed =
      itemType === "Live Birds" || itemType === "Hatching Eggs"
        ? item.breed_display_name_snapshot || dash
        : dash;
    const key = [name, itemType, species, breed].join("|");
    const quantity = item.quantity ?? 0;
    const revenue = item.line_subtotal ?? 0;
    const existing = summaries.get(key);

    if (existing) {
      existing.quantity += quantity;
      existing.revenue += revenue;
      existing.orderIds.add(item.order_id);
      existing.orders = existing.orderIds.size;
      continue;
    }

    summaries.set(key, {
      breed,
      item: name,
      itemType,
      orderIds: new Set([item.order_id]),
      orders: 1,
      quantity,
      revenue,
      species,
    });
  }

  return Array.from(summaries.values()).sort((first, second) => {
    if (second.revenue !== first.revenue) return second.revenue - first.revenue;
    return second.quantity - first.quantity;
  });
}

function buildCustomerSummaries(
  orders: SellerReportOrderRow[],
  customers: Map<string, SellerReportCustomerRow>,
) {
  const summaries = new Map<string, CustomerSummaryRow>();

  for (const order of orders) {
    const customerId = order.customer_id ?? `order-${order.order_id}`;
    const customer = order.customer_id ? customers.get(order.customer_id) : null;
    const existing = summaries.get(customerId);

    if (existing) {
      existing.orders += 1;
      existing.itemsBought += order.total_item_quantity ?? 0;
      existing.totalSpent += order.total_amount ?? 0;
      if (new Date(order.created_at) > new Date(existing.lastOrder)) {
        existing.lastOrder = order.created_at;
      }
      continue;
    }

    summaries.set(customerId, {
      customerEmail: customer?.email ?? order.buyer_email_snapshot ?? "",
      customerId,
      customerName: customer ? formatCustomerName(customer) : formatCustomerName(order),
      customerPhone: customer?.phone ?? order.buyer_phone_snapshot ?? "",
      itemsBought: order.total_item_quantity ?? 0,
      lastOrder: order.created_at,
      orders: 1,
      totalSpent: order.total_amount ?? 0,
    });
  }

  return Array.from(summaries.values()).sort((first, second) => {
    if (second.totalSpent !== first.totalSpent) {
      return second.totalSpent - first.totalSpent;
    }

    return second.orders - first.orders;
  });
}

function buildOrderItemSummaryMap(items: SellerReportItemRow[]) {
  const summaries = new Map<string, string[]>();

  for (const item of items) {
    const itemType = getBroadItemType(item);
    const name = getItemName(item, itemType);
    const quantity = item.quantity ?? 0;
    const label = quantity > 0 ? `${quantity} ${name}` : name;
    const existing = summaries.get(item.order_id);

    if (existing) {
      existing.push(label);
      continue;
    }

    summaries.set(item.order_id, [label]);
  }

  return new Map(
    Array.from(summaries.entries()).map(([orderId, labels]) => [
      orderId,
      labels.join("; "),
    ]),
  );
}

function buildSalesCsvRows(
  orders: SellerReportOrderRow[],
  itemSummaryByOrder: Map<string, string>,
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
        itemSummaryByOrder.get(order.order_id) ?? "",
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
  return [
    [
      "Customer Name",
      "Customer Email",
      "Customer Phone",
      "Orders",
      "Items Bought",
      "Total Spent",
      "Last Order",
      "Date Range",
    ],
    ...rows.map((row) => [
      row.customerName,
      row.customerEmail,
      row.customerPhone,
      `${row.orders}`,
      `${row.itemsBought}`,
      formatCsvNumber(row.totalSpent),
      formatShortDate(row.lastOrder),
      dateRangeLabel,
    ]),
  ];
}

function downloadCsv({ filename, rows }: { filename: string; rows: string[][] }) {
  const csv = rows
    .map((row) => row.map((value) => escapeCsvCell(value)).join(","))
    .join("\r\n");
  const blob = new Blob([`\uFEFF${csv}`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function escapeCsvCell(value: string) {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }

  return value;
}

function isSaleOrder(order: SellerReportOrderRow) {
  return getOrderLifecycleState(order) !== "canceled";
}

function isOrderInDateRange(order: SellerReportOrderRow, settings: DateSettings) {
  const { end, start } = getDateBounds(settings);
  const date = new Date(order.created_at);

  if (start && date < start) return false;
  if (end && date > end) return false;

  return true;
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

function getBroadItemType(
  item: SellerReportItemRow,
): Exclude<ItemTypeFilter, "all"> {
  const raw = [
    item.inventory_type_snapshot,
    item.batch_type_snapshot,
    item.product_type_snapshot,
    item.item_category_snapshot,
    item.item_name_snapshot,
    item.custom_item_name_snapshot,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (item.equipment_inventory_item_id || raw.includes("equipment")) {
    return "Equipment";
  }

  if (
    item.processed_poultry_inventory_item_id ||
    raw.includes("processed") ||
    raw.includes("product")
  ) {
    return "Poultry Products";
  }

  if (raw.includes("hatching") || raw.includes("egg")) {
    return "Hatching Eggs";
  }

  return "Live Birds";
}

function getItemName(
  item: SellerReportItemRow,
  itemType: Exclude<ItemTypeFilter, "all">,
) {
  if (item.custom_item_name_snapshot) return item.custom_item_name_snapshot;
  if (item.item_name_snapshot) return item.item_name_snapshot;

  if (itemType === "Equipment") {
    return item.custom_inventory_label_snapshot || "Equipment";
  }

  const breed = item.breed_display_name_snapshot || "Item";
  const label = formatInventoryLabel({
    custom_inventory_label: item.custom_inventory_label_snapshot,
    inventory_type: item.inventory_type_snapshot,
  });

  return label === "Not set" ? breed : `${breed} ${label}`;
}

function getDistinctOptions(values: string[]) {
  return Array.from(new Set(values.filter((value) => value && value !== dash))).sort(
    (first, second) => first.localeCompare(second),
  );
}

function matchesSearchTerm(values: string[], search: string) {
  const trimmed = search.trim().toLowerCase();
  if (!trimmed) return true;

  return values.some((value) => value.toLowerCase().includes(trimmed));
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

function formatOrderNumber(value: string) {
  return value.startsWith("#") ? value : `#${value}`;
}

function formatCsvNumber(value: number | null) {
  return value === null ? "" : value.toFixed(2);
}

function formatFileDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function sumBy<TValue>(values: TValue[], getValue: (value: TValue) => number) {
  return values.reduce((total, value) => total + getValue(value), 0);
}
