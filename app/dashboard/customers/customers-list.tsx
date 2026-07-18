"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowUpDown, ChevronDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSellerContext } from "../_components/seller-context";
import { EmptyState, ErrorState, LoadingState } from "../_components/seller-ui";
import { formatCurrency } from "../orders/order-formatters";

const CUSTOMERS_PER_PAGE = 6;

type CustomerSortOption =
  | "last-order-newest"
  | "last-order-oldest"
  | "name-az"
  | "name-za"
  | "most-orders"
  | "highest-lifetime-value";

const customerSortOptions: { label: string; value: CustomerSortOption }[] = [
  { label: "Last order: Newest", value: "last-order-newest" },
  { label: "Last order: Oldest", value: "last-order-oldest" },
  { label: "Customer name: A–Z", value: "name-az" },
  { label: "Customer name: Z–A", value: "name-za" },
  { label: "Most orders", value: "most-orders" },
  { label: "Highest lifetime value", value: "highest-lifetime-value" },
];

const avatarTones = [
  "bg-emerald-100 text-emerald-900",
  "bg-violet-100 text-violet-900",
  "bg-amber-100 text-amber-900",
  "bg-rose-100 text-rose-900",
  "bg-sky-100 text-sky-900",
  "bg-teal-100 text-teal-900",
];

type SellerCustomerSummaryRow = {
  customer_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  business_name: string | null;
  order_count: number | null;
  lifetime_order_total: number | null;
  latest_order_created_at: string | null;
  latest_order_total: number | null;
};

type SellerCustomerSummaryBaseRow = Omit<
  SellerCustomerSummaryRow,
  "latest_order_total"
>;

type SellerOrderTotalRow = {
  customer_id: string | null;
  total_amount: number | null;
  created_at: string;
};

/**
 * Read-only seller customer list built from the existing customer summary
 * projection. It keeps customer management focused on lookup, not CRM tools.
 */
export function CustomersList() {
  const { seller } = useSellerContext();
  const [customers, setCustomers] = useState<SellerCustomerSummaryRow[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<CustomerSortOption>("last-order-newest");
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadCustomers() {
      if (!seller) return;

      setIsLoading(true);
      setError(null);

      const result = await supabase
        .from("seller_customer_summary")
        .select(
          "customer_id, email, first_name, last_name, phone, business_name, order_count, lifetime_order_total, latest_order_created_at, created_at",
        )
        .eq("store_id", seller.store_id)
        .order("latest_order_created_at", {
          ascending: false,
          nullsFirst: false,
        })
        .order("created_at", { ascending: false })
        .limit(200)
        .returns<SellerCustomerSummaryBaseRow[]>();

      if (!isMounted) return;

      if (result.error) {
        console.error("seller_customer_summary query failed", result.error);
        setError(result.error.message);
        setIsLoading(false);
        return;
      }

      const customerRows = result.data ?? [];
      const latestOrderTotals = await loadLatestOrderTotals(
        seller.store_id,
        customerRows.map((customer) => customer.customer_id),
      );

      if (!isMounted) return;

      setCustomers(
        customerRows.map((customer) => ({
          ...customer,
          latest_order_total: latestOrderTotals.get(customer.customer_id) ?? null,
        })),
      );
      setIsLoading(false);
    }

    void loadCustomers();

    return () => {
      isMounted = false;
    };
  }, [seller]);

  const visibleCustomers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    const matchedCustomers = normalizedQuery
      ? customers.filter((customer) =>
          [
            formatCustomerName(customer),
            customer.business_name,
            customer.email,
            customer.phone,
          ]
            .filter(Boolean)
            .some((value) => value?.toLowerCase().includes(normalizedQuery)),
        )
      : customers;

    return [...matchedCustomers].sort((left, right) =>
      compareCustomers(left, right, sort),
    );
  }, [customers, query, sort]);

  const totalPages = Math.max(
    1,
    Math.ceil(visibleCustomers.length / CUSTOMERS_PER_PAGE),
  );
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * CUSTOMERS_PER_PAGE;
  const pageCustomers = visibleCustomers.slice(
    pageStart,
    pageStart + CUSTOMERS_PER_PAGE,
  );

  if (isLoading) {
    return <LoadingState label="Loading customers" />;
  }

  if (error) {
    return (
      <ErrorState
        title="Customers could not load"
        message="Please refresh the page and try again."
      />
    );
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(20rem,1fr)_minmax(15rem,18rem)_auto] lg:items-end">
        <label className="grid min-w-0 gap-1.5 text-base font-bold text-stone-700 sm:text-sm">
          <span className="inline-flex items-center gap-1.5">
            <Image
              aria-hidden="true"
              className="size-3.5 opacity-75"
              src="/glyphs/looking-glass.png"
              alt=""
              width={16}
              height={16}
            />
            Search
          </span>
          <input
            className="min-h-12 w-full rounded-lg border border-stone-300 bg-white px-4 py-3 text-base font-medium text-stone-950 shadow-sm outline-none transition placeholder:text-stone-500 focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20 sm:min-h-10 sm:text-sm"
            placeholder="Search by name, email, phone, or farm name..."
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
          />
        </label>

        <label className="grid min-w-0 gap-1.5 text-base font-bold text-stone-700 sm:text-sm">
          <span className="inline-flex items-center gap-1.5">
            <ArrowUpDown
              aria-hidden="true"
              className="size-3.5 text-emerald-800"
              strokeWidth={2.25}
            />
            Sort by
          </span>
          <span className="relative">
            <select
              className="min-h-12 w-full appearance-none rounded-lg border border-stone-300 bg-white px-4 py-3 pr-9 text-base font-semibold text-stone-950 shadow-sm outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20 sm:min-h-10 sm:text-sm"
              value={sort}
              onChange={(event) => {
                setSort(event.target.value as CustomerSortOption);
                setPage(1);
              }}
            >
              {customerSortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute right-4 top-1/2 flex size-4 -translate-y-1/2 items-center justify-center text-stone-500"
            >
              <ChevronDown aria-hidden="true" className="size-4" strokeWidth={2} />
            </span>
          </span>
        </label>

        <Link
          className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-lg bg-emerald-800 px-4 text-base font-bold text-white shadow-sm transition hover:bg-emerald-900 sm:text-sm lg:self-end"
          href="/dashboard/orders/new"
        >
          <span aria-hidden="true" className="text-xl leading-none">
            +
          </span>
          Add customer
        </Link>
      </div>

      <p className="text-sm font-medium text-stone-600">
        Total customers:{" "}
        <span className="font-bold text-emerald-800">{customers.length}</span>
      </p>

      {visibleCustomers.length > 0 ? (
        <>
          <div className="min-w-0 overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
            <div className="max-md:overflow-x-auto">
              <table className="w-full max-w-full table-fixed text-left max-md:min-w-[680px]">
                <colgroup>
                  <col style={{ width: "46%" }} />
                  <col style={{ width: "9%" }} />
                  <col style={{ width: "15%" }} />
                  <col style={{ width: "15%" }} />
                  <col style={{ width: "15%" }} />
                </colgroup>
                <thead className="border-b border-stone-200 text-xs font-bold text-stone-500">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-3">Customer</th>
                    <th className="whitespace-nowrap px-2 py-3">Orders</th>
                    <th className="whitespace-nowrap px-2 py-3">
                      Last order
                    </th>
                    <th className="whitespace-nowrap px-2 py-3">
                      Last purchase
                    </th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200">
                  {pageCustomers.map((customer, index) => (
                    <CustomerRow
                      customer={customer}
                      index={pageStart + index}
                      key={customer.customer_id}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <Pagination
            currentPage={currentPage}
            pageStart={pageStart}
            totalCustomers={visibleCustomers.length}
            totalPages={totalPages}
            onPageChange={setPage}
          />
        </>
      ) : (
        <EmptyState
          title={
            customers.length > 0
              ? "No customers match that search"
              : "No customers yet"
          }
          description={
            customers.length > 0
              ? "Try a different name, email, phone number, or farm name."
              : "Customers will appear after storefront or seller-created orders are placed."
          }
        />
      )}
    </div>
  );
}

function CustomerRow({
  customer,
  index,
}: {
  customer: SellerCustomerSummaryRow;
  index: number;
}) {
  const customerName = formatCustomerName(customer);

  return (
    <tr className="align-middle">
      <td className="px-4 py-5">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={`flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${avatarTones[index % avatarTones.length]}`}
          >
            {formatCustomerInitials(customer)}
          </span>
          <div className="min-w-0 flex-1">
            <Link
              className="block truncate font-bold text-stone-950 transition hover:text-emerald-800"
              href={`/dashboard/customers/${customer.customer_id}`}
            >
              {customerName}
            </Link>
            {customer.business_name ? (
              <p className="mt-1 truncate text-sm font-medium text-stone-700">
                {customer.business_name}
              </p>
            ) : null}
            <ContactLine email={customer.email} phone={customer.phone} />
            <p className="mt-1 truncate text-sm font-medium text-stone-500">
              {customer.order_count ?? 0}{" "}
              {(customer.order_count ?? 0) === 1 ? "order" : "orders"}{" "}
              <span aria-hidden="true">&middot;</span>{" "}
              {formatCurrency(customer.lifetime_order_total)} lifetime
            </p>
          </div>
        </div>
      </td>
      <td className="whitespace-nowrap px-2 py-5 text-sm font-semibold text-stone-950">
        {customer.order_count ?? 0}
      </td>
      <td className="px-2 py-5 text-sm font-semibold text-stone-950">
        <LastOrderDate value={customer.latest_order_created_at} />
      </td>
      <td className="whitespace-nowrap px-2 py-5 text-sm font-semibold text-stone-950">
        <LastPurchaseAmount amount={customer.latest_order_total} />
      </td>
      <td className="px-4 py-5 text-right">
        <Link
          className="inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-md border border-emerald-800 bg-emerald-800 px-3 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-800/25 md:min-h-9"
          href={`/dashboard/customers/${customer.customer_id}`}
        >
          View
        </Link>
      </td>
    </tr>
  );
}

function ContactLine({
  email,
  phone,
}: {
  email: string;
  phone: string | null;
}) {
  return (
    <div className="mt-1 grid min-w-0 gap-0.5 text-sm leading-5 text-stone-600">
      <span className="block max-w-[220px] truncate whitespace-nowrap lg:max-w-[260px] 2xl:max-w-[300px]">
        {email}
      </span>
      {phone ? (
        <span className="whitespace-nowrap text-stone-500">{phone}</span>
      ) : null}
    </div>
  );
}

function LastOrderDate({ value }: { value: string | null }) {
  if (!value) return <span className="whitespace-nowrap">Not set</span>;

  return (
    <span className="grid gap-0.5">
      <span className="whitespace-nowrap">{formatDate(value)}</span>
      <span className="whitespace-nowrap text-sm font-medium text-stone-500 md:text-xs">
        {formatRelativeDate(value)}
      </span>
    </span>
  );
}

function LastPurchaseAmount({ amount }: { amount: number | null }) {
  if (amount == null) {
    return <span className="text-stone-400">&mdash;</span>;
  }

  return formatCurrency(amount);
}

function Pagination({
  currentPage,
  pageStart,
  totalCustomers,
  totalPages,
  onPageChange,
}: {
  currentPage: number;
  pageStart: number;
  totalCustomers: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  const showingStart = totalCustomers === 0 ? 0 : pageStart + 1;
  const showingEnd = Math.min(pageStart + CUSTOMERS_PER_PAGE, totalCustomers);
  const pages = getPaginationPages(currentPage, totalPages);

  return (
    <div className="flex flex-col gap-3 text-sm text-stone-600 sm:flex-row sm:items-center sm:justify-between">
      <p>
        Showing {showingStart}-{showingEnd} of {totalCustomers} customers
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="inline-flex min-h-12 items-center justify-center rounded-md border border-stone-200 bg-white px-3 text-base font-semibold text-stone-700 shadow-sm transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-45 sm:min-h-10 sm:text-sm"
          type="button"
          disabled={currentPage === 1}
          onClick={() => onPageChange(currentPage - 1)}
        >
          Previous
        </button>
        {pages.map((paginationItem, index) =>
          paginationItem === "ellipsis" ? (
            <span
              className="inline-flex min-h-12 min-w-12 items-center justify-center text-base font-bold text-stone-500 sm:min-h-10 sm:min-w-10 sm:text-sm"
              key={`ellipsis-${index}`}
            >
              ...
            </span>
          ) : (
            <button
              className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border px-3 font-semibold shadow-sm transition sm:min-h-10 sm:min-w-10 ${
                paginationItem === currentPage
                  ? "border-emerald-800 bg-emerald-800 text-white"
                  : "border-stone-200 bg-white text-stone-950 hover:bg-stone-50"
              }`}
              key={paginationItem}
              type="button"
              onClick={() => onPageChange(paginationItem)}
            >
              {paginationItem}
            </button>
          ),
        )}
        <button
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-stone-200 bg-white px-3 font-semibold text-stone-700 shadow-sm transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-45 sm:min-h-10"
          type="button"
          disabled={currentPage === totalPages}
          onClick={() => onPageChange(currentPage + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

function getPaginationPages(currentPage: number, totalPages: number) {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages: (number | "ellipsis")[] = [1];
  const middleStart = Math.max(2, currentPage - 1);
  const middleEnd = Math.min(totalPages - 1, currentPage + 1);

  if (middleStart > 2) pages.push("ellipsis");

  for (let pageNumber = middleStart; pageNumber <= middleEnd; pageNumber += 1) {
    pages.push(pageNumber);
  }

  if (middleEnd < totalPages - 1) pages.push("ellipsis");

  pages.push(totalPages);

  return pages;
}

function compareCustomers(
  left: SellerCustomerSummaryRow,
  right: SellerCustomerSummaryRow,
  sort: CustomerSortOption,
) {
  const nameComparison = compareCustomerNames(left, right);

  if (sort === "name-az") return nameComparison;
  if (sort === "name-za") return -nameComparison;

  if (sort === "most-orders") {
    return (
      (right.order_count ?? 0) - (left.order_count ?? 0) ||
      nameComparison
    );
  }

  if (sort === "highest-lifetime-value") {
    return (
      (right.lifetime_order_total ?? 0) - (left.lifetime_order_total ?? 0) ||
      nameComparison
    );
  }

  const dateComparison = compareLastOrderDates(left, right);

  return sort === "last-order-oldest" ? dateComparison : -dateComparison;
}

function compareLastOrderDates(
  left: SellerCustomerSummaryRow,
  right: SellerCustomerSummaryRow,
) {
  const leftTime = getOrderTime(left.latest_order_created_at);
  const rightTime = getOrderTime(right.latest_order_created_at);

  if (leftTime == null && rightTime == null) {
    return compareCustomerNames(left, right);
  }

  if (leftTime == null) return 1;
  if (rightTime == null) return -1;

  return leftTime - rightTime || compareCustomerNames(left, right);
}

function compareCustomerNames(
  left: SellerCustomerSummaryRow,
  right: SellerCustomerSummaryRow,
) {
  return formatCustomerName(left).localeCompare(formatCustomerName(right), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function getOrderTime(value: string | null) {
  if (!value) return null;

  const time = new Date(value).getTime();

  return Number.isNaN(time) ? null : time;
}

function formatCustomerName(customer: {
  first_name: string | null;
  last_name: string | null;
}) {
  return (
    [customer.first_name, customer.last_name].filter(Boolean).join(" ") ||
    "Customer"
  );
}

function formatCustomerInitials(customer: SellerCustomerSummaryRow) {
  const initials = [customer.first_name, customer.last_name]
    .filter(Boolean)
    .map((value) => value?.trim().charAt(0))
    .join("");

  if (initials) return initials.slice(0, 2).toUpperCase();

  return customer.email.slice(0, 2).toUpperCase();
}

function formatDate(value: string | null) {
  if (!value) return "Not set";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatRelativeDate(value: string) {
  const date = new Date(value);
  const now = new Date();
  const millisecondsPerDay = 1000 * 60 * 60 * 24;
  const daysAgo = Math.max(
    0,
    Math.floor((startOfDay(now).getTime() - startOfDay(date).getTime()) / millisecondsPerDay),
  );

  if (daysAgo === 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  if (daysAgo < 7) return `${daysAgo} days ago`;

  const weeksAgo = Math.floor(daysAgo / 7);

  if (weeksAgo < 8) {
    return `${weeksAgo} week${weeksAgo === 1 ? "" : "s"} ago`;
  }

  const monthsAgo = Math.floor(daysAgo / 30);

  return `${monthsAgo} month${monthsAgo === 1 ? "" : "s"} ago`;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

async function loadLatestOrderTotals(storeId: string, customerIds: string[]) {
  const uniqueCustomerIds = [...new Set(customerIds)].filter(Boolean);
  const totals = new Map<string, number | null>();

  if (uniqueCustomerIds.length === 0) return totals;

  const result = await supabase
    .from("seller_order_management")
    .select("customer_id, total_amount, created_at")
    .eq("store_id", storeId)
    .in("customer_id", uniqueCustomerIds)
    .order("created_at", { ascending: false })
    .limit(1000)
    .returns<SellerOrderTotalRow[]>();

  if (result.error) {
    console.error(
      "seller_order_management latest total query failed",
      result.error,
    );
    return totals;
  }

  for (const order of result.data ?? []) {
    if (!order.customer_id || totals.has(order.customer_id)) continue;

    totals.set(order.customer_id, order.total_amount);
  }

  return totals;
}
