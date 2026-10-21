export type CustomerContactRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  email: string | null;
  phone: string | null;
  delivery_address_line1: string | null;
  delivery_address_line2: string | null;
  delivery_city: string | null;
  delivery_state: string | null;
  delivery_postal_code: string | null;
  delivery_country: string | null;
  internal_notes: string | null;
  created_at: string;
  updated_at: string;
  imported_order_count: number;
  imported_order_total_cents: number;
  imported_source: string | null;
};

const CONTACT_BATCH_SIZE = 200;

export async function fetchAllCustomerContacts<T>(
  fetchPage: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    const { data, error } = await fetchPage(rows.length, rows.length + CONTACT_BATCH_SIZE - 1);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < CONTACT_BATCH_SIZE) return rows;
  }
}

export type CustomerSummaryRow = {
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

export function mergeCustomerRoster(
  contacts: CustomerContactRow[],
  lifetimeRows: CustomerSummaryRow[],
  periodRows: CustomerSummaryRow[],
): CustomerSummaryRow[] {
  const lifetimeById = new Map(lifetimeRows.map((row) => [row.customerId, row]));
  const periodById = new Map(periodRows.map((row) => [row.customerId, row]));
  const rows = contacts.map((contact) => {
    const lifetime = lifetimeById.get(contact.id);
    const period = periodById.get(contact.id);
    const importedOrderCount = Number(contact.imported_order_count ?? 0);
    const importedOrderTotal = Number(contact.imported_order_total_cents ?? 0) / 100;
    const totalOrders = lifetime?.totalOrders ?? importedOrderCount;
    const lifetimeOrderTotal = lifetime?.lifetimeOrderTotal ?? importedOrderTotal;
    return {
      businessName: contact.business_name ?? "",
      createdAt: contact.created_at,
      customerEmail: contact.email ?? "",
      customerFirstName: contact.first_name ?? "",
      customerId: contact.id,
      customerLastName: contact.last_name ?? "",
      customerName: contact.business_name ||
        [contact.first_name, contact.last_name].filter(Boolean).join(" ") || "Customer",
      customerPhone: contact.phone ?? "",
      internalNotes: contact.internal_notes ?? "",
      importedOrderCount,
      importedOrderTotal,
      importedSource: contact.imported_source ?? "",
      itemsBought: period?.itemsBought ?? 0,
      lastOrder: period?.lastOrder ?? null,
      lastOrderTotal: lifetime?.lastOrderTotal ?? 0,
      latestOrderAt: lifetime?.latestOrderAt ?? null,
      lifetimeOrderTotal,
      mailingAddressLine1: contact.delivery_address_line1 ?? "",
      mailingAddressLine2: contact.delivery_address_line2 ?? "",
      mailingCity: contact.delivery_city ?? "",
      mailingCountry: contact.delivery_country ?? "",
      mailingPostalCode: contact.delivery_postal_code ?? "",
      mailingState: contact.delivery_state ?? "",
      openOrders: lifetime?.openOrders ?? 0,
      orders: period?.orders ?? 0,
      nativeOrders: lifetime?.nativeOrders ?? 0,
      nativeSpent: lifetime?.nativeSpent ?? 0,
      totalOrders,
      totalSpent: period?.totalSpent ?? 0,
      updatedAt: contact.updated_at,
    };
  });

  // Preserve anonymous order buyers, which have no registered customer row.
  for (const row of periodRows) {
    if (row.customerId.startsWith("order-")) rows.push(row);
  }
  return rows;
}

export function filterCustomerRoster(
  rows: CustomerSummaryRow[],
  search: string,
  amountOver: number | null,
): CustomerSummaryRow[] {
  const needle = search.trim().toLocaleLowerCase();
  return rows.filter((row) =>
    (amountOver === null || row.totalSpent > amountOver) &&
    (!needle || [row.customerName, row.businessName, row.customerFirstName,
      row.customerLastName, row.customerEmail, row.customerPhone]
      .some((value) => value.toLocaleLowerCase().includes(needle))),
  ).sort((left, right) =>
    right.totalSpent - left.totalSpent ||
    right.orders - left.orders ||
    left.customerName.localeCompare(right.customerName) ||
    left.customerId.localeCompare(right.customerId),
  );
}

export function getCustomerRosterSummary(rows: CustomerSummaryRow[]) {
  const totalSpent = rows.reduce((sum, row) => sum + row.totalSpent, 0);
  return {
    total_customers: rows.length,
    repeat_customers: rows.filter((row) => row.orders > 1).length,
    total_spent: totalSpent,
    average_spend: rows.length ? totalSpent / rows.length : 0,
    top_customer_name: rows[0]?.customerName ?? "—",
    top_customer_spent: rows[0]?.totalSpent ?? 0,
  };
}

export function paginateCustomerRoster<T>(rows: T[], page: number, pageSize: number): T[] {
  return rows.slice(page * pageSize, (page + 1) * pageSize);
}
