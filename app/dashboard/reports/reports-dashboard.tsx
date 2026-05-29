"use client";

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
  formatDateTime,
  formatInventoryLabel,
  formatOrderLifecycle,
  getOrderLifecycleState,
  type OrderLifecycleState,
} from "../orders/order-formatters";

type DateRange = "last_30_days" | "last_90_days" | "year_to_date" | "all_time";
type SortDirection = "asc" | "desc";
type ItemSortColumn =
  | "name"
  | "quantity"
  | "revenue"
  | "orderCount"
  | "averageSellingPrice";
type CustomerSortColumn = "name" | "orderCount" | "revenue" | "mostRecent";

type SellerReportOrderRow = {
  order_id: string;
  order_number: string;
  order_status: string | null;
  payment_method: string | null;
  payment_status: string | null;
  ready_for_pickup_at: string | null;
  created_at: string;
  customer_id: string | null;
  buyer_first_name_snapshot: string | null;
  buyer_last_name_snapshot: string | null;
  buyer_email_snapshot: string | null;
  total_amount: number | null;
  item_count: number | null;
  total_item_quantity: number | null;
};

type SellerReportItemRow = {
  order_id: string;
  breed_display_name_snapshot: string;
  inventory_type_snapshot: string | null;
  custom_inventory_label_snapshot: string | null;
  unit_price_snapshot: number | null;
  quantity: number | null;
  line_subtotal: number | null;
};

type SellerReportCustomerRow = {
  customer_id: string;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
};

type ReportData = {
  orders: SellerReportOrderRow[];
  items: SellerReportItemRow[];
  customers: SellerReportCustomerRow[];
};

type SalesExportRow = {
  breedItem: string;
  customerEmail: string;
  customerName: string;
  lineTotal: number | null;
  orderDate: string;
  orderNumber: string;
  orderStatus: string;
  paymentStatus: string;
  pickupStatus: string;
  quantity: number | null;
  storeName: string;
  unitPrice: number | null;
};

const salesCsvColumns: {
  header: string;
  value: (row: SalesExportRow) => string;
}[] = [
  { header: "Order Number", value: (row) => row.orderNumber },
  { header: "Order Date", value: (row) => formatCsvDate(row.orderDate) },
  { header: "Customer Name", value: (row) => row.customerName },
  { header: "Customer Email", value: (row) => row.customerEmail },
  { header: "Breed / Item", value: (row) => row.breedItem },
  { header: "Quantity", value: (row) => formatCsvInteger(row.quantity) },
  { header: "Unit Price", value: (row) => formatCsvNumber(row.unitPrice) },
  { header: "Line Total", value: (row) => formatCsvNumber(row.lineTotal) },
  { header: "Order Status", value: (row) => row.orderStatus },
  { header: "Payment Status", value: (row) => row.paymentStatus },
  { header: "Pickup Status", value: (row) => row.pickupStatus },
  { header: "Store Name", value: (row) => row.storeName },
];

const dateRanges: { label: string; value: DateRange }[] = [
  { label: "Last 30 days", value: "last_30_days" },
  { label: "Last 90 days", value: "last_90_days" },
  { label: "Year to date", value: "year_to_date" },
  { label: "All time", value: "all_time" },
];

const statusOrder: { label: string; value: OrderLifecycleState }[] = [
  { label: "Needs attention / open", value: "needs_attention" },
  { label: "Ready for pickup", value: "ready_for_pickup" },
  { label: "Completed", value: "completed" },
  { label: "Canceled", value: "canceled" },
];

export function ReportsDashboard() {
  const { seller } = useSellerContext();
  const [data, setData] = useState<ReportData>({
    customers: [],
    items: [],
    orders: [],
  });
  const [dateRange, setDateRange] = useState<DateRange>("last_30_days");
  const [itemSort, setItemSort] = useState<{
    column: ItemSortColumn;
    direction: SortDirection;
  }>({ column: "revenue", direction: "desc" });
  const [customerSort, setCustomerSort] = useState<{
    column: CustomerSortColumn;
    direction: SortDirection;
  }>({ column: "revenue", direction: "desc" });
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
            "order_id, order_number, order_status, payment_method, payment_status, ready_for_pickup_at, created_at, customer_id, buyer_first_name_snapshot, buyer_last_name_snapshot, buyer_email_snapshot, total_amount, item_count, total_item_quantity",
          )
          .eq("store_id", seller.store_id)
          .order("created_at", { ascending: false })
          .limit(1000)
          .returns<SellerReportOrderRow[]>(),
        supabase
          .from("seller_order_item_detail")
          .select(
            "order_id, breed_display_name_snapshot, inventory_type_snapshot, custom_inventory_label_snapshot, unit_price_snapshot, quantity, line_subtotal",
          )
          .eq("store_id", seller.store_id)
          .order("created_at", { ascending: false })
          .limit(2000)
          .returns<SellerReportItemRow[]>(),
        supabase
          .from("seller_customer_summary")
          .select(
            "customer_id, first_name, last_name, business_name",
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

  const report = useMemo(
    () => buildReport(data, dateRange),
    [data, dateRange],
  );
  const sortedItemRows = useMemo(
    () => sortItemRows(report.salesByItem, itemSort),
    [itemSort, report.salesByItem],
  );
  const sortedCustomerRows = useMemo(
    () => sortCustomerRows(report.customerRankings, customerSort),
    [customerSort, report.customerRankings],
  );

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

  return (
    <div className="grid gap-6">
      <div className="flex flex-col gap-3 border-b border-stone-200 pb-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-stone-950">
            Reporting period
          </h2>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            Sales totals exclude canceled orders.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          <DateRangeFilters value={dateRange} onChange={setDateRange} />
          <button
            className="seller-secondary-button w-full sm:w-auto"
            type="button"
            onClick={() =>
              downloadSalesCsv({
                dateRange,
                rows: report.salesExportRows,
                storeName: seller?.store_name ?? "Store",
              })
            }
          >
            Export Sales CSV
          </button>
          <p className="text-xs font-medium text-stone-500">
            Exports the selected reporting period.
          </p>
        </div>
      </div>

      <SellerCard className="overflow-hidden">
        <PrimaryReportHeader
          title="Sales by breed / item"
          description="What sold, how much sold, and what revenue each item produced."
        />
        {sortedItemRows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-[760px] w-full text-left text-sm">
              <thead className="border-b border-stone-200 bg-stone-50 text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">
                <tr>
                  <TableHeader className="w-[34%]">
                    <SortHeader
                      activeColumn={itemSort.column}
                      column="name"
                      direction={itemSort.direction}
                      label="Breed / item"
                      onSort={setItemSort}
                    />
                  </TableHeader>
                  <TableHeader align="right">
                    <SortHeader
                      activeColumn={itemSort.column}
                      column="quantity"
                      direction={itemSort.direction}
                      label="Quantity sold"
                      onSort={setItemSort}
                    />
                  </TableHeader>
                  <TableHeader align="right">
                    <SortHeader
                      activeColumn={itemSort.column}
                      column="revenue"
                      direction={itemSort.direction}
                      label="Revenue"
                      onSort={setItemSort}
                    />
                  </TableHeader>
                  <TableHeader align="right">
                    <SortHeader
                      activeColumn={itemSort.column}
                      column="orderCount"
                      direction={itemSort.direction}
                      label="Order count"
                      onSort={setItemSort}
                    />
                  </TableHeader>
                  <TableHeader align="right">
                    <SortHeader
                      activeColumn={itemSort.column}
                      column="averageSellingPrice"
                      direction={itemSort.direction}
                      label="Avg. selling price"
                      onSort={setItemSort}
                    />
                  </TableHeader>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {sortedItemRows.map((item) => (
                  <SalesByItemTableRow item={item} key={item.name} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-5">
            <EmptyState
              title="No item sales in this period"
              description="Sold item totals appear after non-canceled orders are placed."
            />
          </div>
        )}
      </SellerCard>

      <SellerCard className="overflow-hidden">
        <PrimaryReportHeader
          title="Customer ranking"
          description="Customers ranked by revenue in the selected period."
        />
        {sortedCustomerRows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-[680px] w-full text-left text-sm">
              <thead className="border-b border-stone-200 bg-stone-50 text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">
                <tr>
                  <TableHeader className="w-[34%]">
                    <SortHeader
                      activeColumn={customerSort.column}
                      column="name"
                      direction={customerSort.direction}
                      label="Customer"
                      onSort={setCustomerSort}
                    />
                  </TableHeader>
                  <TableHeader align="right">
                    <SortHeader
                      activeColumn={customerSort.column}
                      column="orderCount"
                      direction={customerSort.direction}
                      label="Orders"
                      onSort={setCustomerSort}
                    />
                  </TableHeader>
                  <TableHeader align="right">
                    <SortHeader
                      activeColumn={customerSort.column}
                      column="revenue"
                      direction={customerSort.direction}
                      label="Revenue"
                      onSort={setCustomerSort}
                    />
                  </TableHeader>
                  <TableHeader align="right">
                    <SortHeader
                      activeColumn={customerSort.column}
                      column="mostRecent"
                      direction={customerSort.direction}
                      label="Most recent order"
                      onSort={setCustomerSort}
                    />
                  </TableHeader>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {sortedCustomerRows.map((customer) => (
                  <CustomerRankingTableRow
                    customer={customer}
                    key={customer.customerId}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-5">
            <EmptyState
              title="No customer activity yet"
              description="Customer rankings appear after orders are placed in this period."
            />
          </div>
        )}
      </SellerCard>

      <section className="grid gap-3 border-y border-stone-200 py-4 sm:grid-cols-2 xl:grid-cols-4">
        <CompactMetric
          label="Revenue"
          value={formatCurrency(report.sales.totalRevenue)}
        />
        <CompactMetric label="Orders" value={`${report.sales.totalOrders}`} />
        <CompactMetric
          label="Items sold"
          value={`${report.sales.totalItemsSold}`}
        />
        <CompactMetric
          label="Average order"
          value={formatCurrency(report.sales.averageOrderValue)}
        />
      </section>

      <SellerCard className="overflow-hidden">
        <SectionTitleFrame
          title="Recent orders"
          description="Quick access to recent activity."
        />
        {report.recentOrders.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-[680px] w-full text-left text-sm">
              <thead className="border-b border-stone-200 bg-stone-50 text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">
                <tr>
                  <TableHeader>Order number</TableHeader>
                  <TableHeader>Customer</TableHeader>
                  <TableHeader>Date</TableHeader>
                  <TableHeader>Status</TableHeader>
                  <TableHeader align="right">Total</TableHeader>
                  <TableHeader align="right">Link</TableHeader>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {report.recentOrders.map((order) => (
                  <RecentOrderTableRow key={order.order_id} order={order} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-5">
            <EmptyState
              title="No recent orders"
              description="Switch to a wider date range to review older orders."
            />
          </div>
        )}
      </SellerCard>

      <section className="rounded-lg border border-stone-200 bg-white p-4">
        <SectionTitle
          title="Order status"
          description="Simple counts for the selected period."
        />
        {report.filteredOrders.length > 0 ? (
          <dl className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {statusOrder.map((status) => (
              <StatusRow
                key={status.value}
                label={status.label}
                value={report.statusCounts[status.value]}
              />
            ))}
          </dl>
        ) : (
          <div className="mt-4">
            <EmptyState
              title="No orders in this period"
              description="Switch to a wider date range to review older order activity."
            />
          </div>
        )}
      </section>
    </div>
  );
}

function DateRangeFilters({
  onChange,
  value,
}: {
  onChange: (value: DateRange) => void;
  value: DateRange;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {dateRanges.map((range) => {
        const isActive = value === range.value;

        return (
          <button
            aria-pressed={isActive}
            className={`min-h-10 shrink-0 rounded-full border px-3 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-emerald-700/30 ${
              isActive
                ? "border-emerald-800 bg-emerald-800 text-white"
                : "border-stone-300 bg-white text-stone-700 hover:border-emerald-700 hover:text-emerald-800"
            }`}
            key={range.value}
            type="button"
            onClick={() => onChange(range.value)}
          >
            {range.label}
          </button>
        );
      })}
    </div>
  );
}

function CompactMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-stone-200 bg-white px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold text-stone-950">{value}</p>
    </div>
  );
}

function SectionTitle({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <div>
      <h2 className="text-base font-semibold text-stone-950">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-stone-600">{description}</p>
    </div>
  );
}

function SectionTitleFrame({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <div className="border-b border-stone-200 px-5 py-4">
      <SectionTitle description={description} title={title} />
    </div>
  );
}

function PrimaryReportHeader({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <div className="border-b border-stone-200 px-5 py-5">
      <h2 className="text-xl font-semibold text-stone-950">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-stone-600">{description}</p>
    </div>
  );
}

function StatusRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md bg-stone-50 px-3 py-2.5">
      <dt className="text-sm font-semibold text-stone-700">{label}</dt>
      <dd className="text-base font-semibold text-stone-950">{value}</dd>
    </div>
  );
}

function TableHeader({
  align = "left",
  children,
  className = "",
}: {
  align?: "left" | "right";
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`px-4 py-3 ${align === "right" ? "text-right" : "text-left"} ${className}`}
      scope="col"
    >
      {children}
    </th>
  );
}

function SortHeader<TColumn extends string>({
  activeColumn,
  column,
  direction,
  label,
  onSort,
}: {
  activeColumn: TColumn;
  column: TColumn;
  direction: SortDirection;
  label: string;
  onSort: (value: { column: TColumn; direction: SortDirection }) => void;
}) {
  const isActive = activeColumn === column;
  const nextDirection: SortDirection =
    isActive && direction === "desc" ? "asc" : "desc";

  return (
    <button
      className="inline-flex items-center gap-1 font-semibold uppercase tracking-[0.08em] text-stone-500 hover:text-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-700/30"
      type="button"
      onClick={() => onSort({ column, direction: nextDirection })}
    >
      {label}
      <span aria-hidden="true" className="text-[0.625rem]">
        {isActive ? (direction === "desc" ? "v" : "^") : ""}
      </span>
    </button>
  );
}

function SalesByItemTableRow({
  item,
}: {
  item: ReturnType<typeof buildReport>["salesByItem"][number];
}) {
  return (
    <tr className="align-top">
      <td className="px-4 py-3 font-semibold text-stone-950">{item.name}</td>
      <td className="px-4 py-3 text-right font-semibold text-stone-950">
        {item.quantity}
      </td>
      <td className="px-4 py-3 text-right font-semibold text-stone-950">
        {formatCurrency(item.revenue)}
      </td>
      <td className="px-4 py-3 text-right text-stone-700">
        {item.orderCount}
      </td>
      <td className="px-4 py-3 text-right text-stone-700">
        {formatCurrency(item.averageSellingPrice)}
      </td>
    </tr>
  );
}

function CustomerRankingTableRow({
  customer,
}: {
  customer: ReturnType<typeof buildReport>["customerRankings"][number];
}) {
  return (
    <tr className="align-top">
      <td className="px-4 py-3">
        <Link
          className="font-semibold text-stone-950 hover:text-emerald-800"
          href={`/dashboard/customers/${customer.customerId}`}
        >
          {customer.name}
        </Link>
        {customer.businessName ? (
          <p className="mt-1 text-xs font-semibold text-stone-500">
            {customer.businessName}
          </p>
        ) : null}
      </td>
      <td className="px-4 py-3 text-right font-semibold text-stone-950">
        {customer.orderCount}
      </td>
      <td className="px-4 py-3 text-right font-semibold text-stone-950">
        {formatCurrency(customer.revenue)}
      </td>
      <td className="px-4 py-3 text-right text-stone-700">
        {formatDateTime(customer.mostRecentOrderDate)}
      </td>
    </tr>
  );
}

function RecentOrderTableRow({ order }: { order: SellerReportOrderRow }) {
  return (
    <tr className="align-top">
      <td className="px-4 py-3 font-semibold text-stone-950">
        {order.order_number}
      </td>
      <td className="px-4 py-3 text-stone-700">{formatCustomerName(order)}</td>
      <td className="px-4 py-3 text-stone-700">
        {formatDateTime(order.created_at)}
      </td>
      <td className="px-4 py-3">
        <span className="inline-flex rounded-full bg-stone-100 px-2.5 py-1 text-xs font-semibold text-stone-700">
          {formatOrderLifecycle(order)}
        </span>
      </td>
      <td className="px-4 py-3 text-right font-semibold text-stone-950">
        {formatCurrency(order.total_amount)}
      </td>
      <td className="px-4 py-3 text-right">
        <Link
          className="font-semibold text-emerald-800 hover:text-emerald-900"
          href={`/dashboard/orders/${order.order_id}`}
        >
          View order
        </Link>
      </td>
    </tr>
  );
}

function buildReport(data: ReportData, dateRange: DateRange) {
  const startDate = getRangeStartDate(dateRange);
  const filteredOrders = data.orders.filter((order) =>
    isInDateRange(order.created_at, startDate),
  );
  const soldOrders = filteredOrders.filter(
    (order) => getOrderLifecycleState(order) !== "canceled",
  );
  const soldOrderIds = new Set(soldOrders.map((order) => order.order_id));
  const soldItems = data.items.filter((item) => soldOrderIds.has(item.order_id));
  const totalRevenue = soldOrders.reduce(
    (total, order) => total + (order.total_amount ?? 0),
    0,
  );
  const totalItemsSold = soldOrders.reduce(
    (total, order) => total + (order.total_item_quantity ?? 0),
    0,
  );

  return {
    filteredOrders,
    recentOrders: filteredOrders.slice(0, 8),
    sales: {
      averageOrderValue:
        soldOrders.length > 0 ? totalRevenue / soldOrders.length : 0,
      totalItemsSold,
      totalOrders: filteredOrders.length,
      totalRevenue,
    },
    statusCounts: getStatusCounts(filteredOrders),
    customerRankings: getCustomerRankings(soldOrders, data.customers),
    salesExportRows: getSalesExportRows(soldItems, soldOrders),
    salesByItem: getSalesByItem(soldItems),
  };
}

function getStatusCounts(orders: SellerReportOrderRow[]) {
  const counts: Record<OrderLifecycleState, number> = {
    canceled: 0,
    completed: 0,
    needs_attention: 0,
    ready_for_pickup: 0,
  };

  for (const order of orders) {
    counts[getOrderLifecycleState(order)] += 1;
  }

  return counts;
}

function getCustomerRankings(
  orders: SellerReportOrderRow[],
  customers: SellerReportCustomerRow[],
) {
  const customerLookup = new Map(
    customers.map((customer) => [customer.customer_id, customer]),
  );
  const summaries = new Map<
    string,
    {
      businessName: string | null;
      customerId: string;
      mostRecentOrderDate: string;
      name: string;
      orderCount: number;
      revenue: number;
    }
  >();

  for (const order of orders) {
    if (!order.customer_id) continue;

    const existing = summaries.get(order.customer_id);
    const customer = customerLookup.get(order.customer_id);

    if (existing) {
      existing.orderCount += 1;
      existing.revenue += order.total_amount ?? 0;
      if (new Date(order.created_at) > new Date(existing.mostRecentOrderDate)) {
        existing.mostRecentOrderDate = order.created_at;
      }
      continue;
    }

    summaries.set(order.customer_id, {
      businessName: customer?.business_name ?? null,
      customerId: order.customer_id,
      mostRecentOrderDate: order.created_at,
      name: customer ? formatCustomerName(customer) : formatCustomerName(order),
      orderCount: 1,
      revenue: order.total_amount ?? 0,
    });
  }

  return Array.from(summaries.values())
    .sort((first, second) => {
      if (second.revenue !== first.revenue) {
        return second.revenue - first.revenue;
      }

      return second.orderCount - first.orderCount;
    })
    .slice(0, 50);
}

function getSalesByItem(items: SellerReportItemRow[]) {
  const summaries = new Map<
    string,
    {
      averageSellingPrice: number;
      name: string;
      orderCount: number;
      orderIds: Set<string>;
      quantity: number;
      revenue: number;
    }
  >();

  for (const item of items) {
    const name = formatItemName(item);
    const existing = summaries.get(name);

    if (existing) {
      existing.quantity += item.quantity ?? 0;
      existing.revenue += item.line_subtotal ?? 0;
      existing.orderIds.add(item.order_id);
      existing.orderCount = existing.orderIds.size;
      existing.averageSellingPrice =
        existing.quantity > 0 ? existing.revenue / existing.quantity : 0;
      continue;
    }

    const orderIds = new Set([item.order_id]);
    const quantity = item.quantity ?? 0;
    const revenue = item.line_subtotal ?? 0;

    summaries.set(name, {
      averageSellingPrice: quantity > 0 ? revenue / quantity : 0,
      name,
      orderCount: orderIds.size,
      orderIds,
      quantity,
      revenue,
    });
  }

  return Array.from(summaries.values())
    .sort((first, second) => {
      if (second.revenue !== first.revenue) return second.revenue - first.revenue;

      return second.quantity - first.quantity;
    })
    .slice(0, 50)
    .map((item) => ({
      averageSellingPrice: item.averageSellingPrice,
      name: item.name,
      orderCount: item.orderCount,
      quantity: item.quantity,
      revenue: item.revenue,
    }));
}

function getSalesExportRows(
  items: SellerReportItemRow[],
  orders: SellerReportOrderRow[],
) {
  const orderLookup = new Map(orders.map((order) => [order.order_id, order]));

  return items
    .map((item) => {
      const order = orderLookup.get(item.order_id);

      if (!order) return null;

      const quantity = item.quantity ?? null;
      const lineTotal = item.line_subtotal ?? null;

      return {
        breedItem: formatItemName(item),
        customerEmail: order.buyer_email_snapshot ?? "",
        customerName: formatCustomerName(order),
        lineTotal,
        orderDate: order.created_at,
        orderNumber: order.order_number,
        orderStatus: formatCsvLabel(order.order_status),
        paymentStatus: formatCsvLabel(order.payment_status),
        pickupStatus: formatOrderLifecycle(order),
        quantity,
        storeName: "",
        unitPrice: getCsvUnitPrice({
          lineTotal,
          quantity,
          unitPrice: item.unit_price_snapshot,
        }),
      };
    })
    .filter((row): row is Omit<SalesExportRow, "storeName"> & {
      storeName: "";
    } => row !== null)
    .sort(
      (first, second) =>
        new Date(second.orderDate).getTime() - new Date(first.orderDate).getTime(),
    );
}

function sortItemRows(
  rows: ReturnType<typeof buildReport>["salesByItem"],
  sort: { column: ItemSortColumn; direction: SortDirection },
) {
  return [...rows].sort((first, second) => {
    const direction = sort.direction === "asc" ? 1 : -1;

    if (sort.column === "name") {
      return direction * first.name.localeCompare(second.name);
    }

    return direction * (first[sort.column] - second[sort.column]);
  });
}

function sortCustomerRows(
  rows: ReturnType<typeof buildReport>["customerRankings"],
  sort: { column: CustomerSortColumn; direction: SortDirection },
) {
  return [...rows].sort((first, second) => {
    const direction = sort.direction === "asc" ? 1 : -1;

    if (sort.column === "name") {
      return direction * first.name.localeCompare(second.name);
    }

    if (sort.column === "mostRecent") {
      return (
        direction *
        (new Date(first.mostRecentOrderDate).getTime() -
          new Date(second.mostRecentOrderDate).getTime())
      );
    }

    const valueKey = sort.column === "revenue" ? "revenue" : "orderCount";

    return direction * (first[valueKey] - second[valueKey]);
  });
}

function getRangeStartDate(dateRange: DateRange) {
  const now = new Date();

  if (dateRange === "all_time") return null;
  if (dateRange === "year_to_date") return new Date(now.getFullYear(), 0, 1);

  const days = dateRange === "last_90_days" ? 90 : 30;
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - days);

  return startDate;
}

function isInDateRange(value: string, startDate: Date | null) {
  if (!startDate) return true;

  return new Date(value) >= startDate;
}

function formatCustomerName(customer: {
  buyer_first_name_snapshot?: string | null;
  buyer_last_name_snapshot?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}) {
  return (
    [
      customer.first_name ?? customer.buyer_first_name_snapshot,
      customer.last_name ?? customer.buyer_last_name_snapshot,
    ]
      .filter(Boolean)
      .join(" ") || "Customer"
  );
}

function formatItemName(item: SellerReportItemRow) {
  const inventoryLabel = formatInventoryLabel({
    custom_inventory_label: item.custom_inventory_label_snapshot,
    inventory_type: item.inventory_type_snapshot,
  });

  return `${item.breed_display_name_snapshot} - ${inventoryLabel}`;
}

function downloadSalesCsv({
  dateRange,
  rows,
  storeName,
}: {
  dateRange: DateRange;
  rows: ReturnType<typeof buildReport>["salesExportRows"];
  storeName: string;
}) {
  const csvRows: SalesExportRow[] = rows.map((row) => ({
    ...row,
    storeName,
  }));
  const csv = buildSalesCsv(csvRows);
  const blob = new Blob([`\uFEFF${csv}`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `flipflocks-sales-${dateRange}-${formatFileDate(new Date())}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildSalesCsv(rows: SalesExportRow[]) {
  const headers = salesCsvColumns.map((column) => column.header);
  const body = rows.map((row) =>
    salesCsvColumns.map((column) => column.value(row)),
  );

  return [headers, ...body]
    .map((row) => row.map((value) => escapeCsvCell(String(value))).join(","))
    .join("\r\n");
}

function escapeCsvCell(value: string) {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }

  return value;
}

function formatCsvDate(value: string) {
  return new Date(value).toISOString();
}

function formatCsvLabel(value: string | null) {
  return value ? value.replaceAll("_", " ") : "";
}

function formatCsvInteger(value: number | null) {
  return value === null ? "" : `${value}`;
}

function formatCsvNumber(value: number | null) {
  if (value === null) return "";

  return value.toFixed(2);
}

function formatFileDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function getCsvUnitPrice({
  lineTotal,
  quantity,
  unitPrice,
}: {
  lineTotal: number | null;
  quantity: number | null;
  unitPrice: number | null;
}) {
  if (unitPrice !== null && unitPrice > 0) return unitPrice;
  if (lineTotal !== null && lineTotal > 0 && quantity !== null && quantity > 0) {
    return lineTotal / quantity;
  }
  if (unitPrice !== null) return unitPrice;

  return null;
}
