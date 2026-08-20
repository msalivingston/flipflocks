export const CUSTOMERS_PER_PAGE = 6;

export type CustomerSortOption =
  | "last-order-newest"
  | "last-order-oldest"
  | "name-az"
  | "name-za"
  | "most-orders"
  | "highest-lifetime-value";

export type CustomerSortOrder = {
  column: string;
  ascending: boolean;
  nullsFirst?: boolean;
};

const CUSTOMER_SEARCH_FIELDS = [
  "first_name",
  "last_name",
  "business_name",
  "email",
  "phone",
] as const;

export function getCustomerPageRange(page: number) {
  const from = (Math.max(1, page) - 1) * CUSTOMERS_PER_PAGE;
  return { from, to: from + CUSTOMERS_PER_PAGE - 1 };
}

export function getCustomerTotalPages(totalCustomers: number) {
  return Math.max(1, Math.ceil(totalCustomers / CUSTOMERS_PER_PAGE));
}

export function getLastValidCustomerPage(
  requestedPage: number,
  totalCustomers: number,
) {
  return Math.min(Math.max(1, requestedPage), getCustomerTotalPages(totalCustomers));
}

export function buildCustomerSearchFilter(search: string) {
  const normalizedSearch = search.trim();
  if (!normalizedSearch) return null;

  const quotedPattern = `"*${escapePostgrestQuotedValue(normalizedSearch)}*"`;
  return CUSTOMER_SEARCH_FIELDS.map(
    (field) => `${field}.ilike.${quotedPattern}`,
  ).join(",");
}

export function getCustomerSortOrders(
  sort: CustomerSortOption,
): CustomerSortOrder[] {
  const identityAscending = sort !== "name-za";
  const identityOrders: CustomerSortOrder[] = [
    { column: "first_name", ascending: identityAscending, nullsFirst: false },
    { column: "last_name", ascending: identityAscending, nullsFirst: false },
    { column: "business_name", ascending: identityAscending, nullsFirst: false },
    { column: "email", ascending: identityAscending, nullsFirst: false },
    { column: "phone", ascending: identityAscending, nullsFirst: false },
  ];

  if (sort === "name-az" || sort === "name-za") {
    return [...identityOrders, { column: "customer_id", ascending: true }];
  }

  const primaryOrder: CustomerSortOrder =
    sort === "most-orders"
      ? { column: "order_count", ascending: false, nullsFirst: false }
      : sort === "highest-lifetime-value"
        ? {
            column: "lifetime_order_total",
            ascending: false,
            nullsFirst: false,
          }
        : {
            column: "latest_order_created_at",
            ascending: sort === "last-order-oldest",
            nullsFirst: false,
          };

  return [
    primaryOrder,
    ...identityOrders,
    { column: "customer_id", ascending: true },
  ];
}

function escapePostgrestQuotedValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
