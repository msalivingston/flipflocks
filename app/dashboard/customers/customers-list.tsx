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
import { formatCurrency, formatDateTime } from "../orders/order-formatters";

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
};

/**
 * Read-only seller customer list built from the existing customer summary
 * projection. It keeps customer management focused on lookup, not CRM tools.
 */
export function CustomersList() {
  const { seller } = useSellerContext();
  const [customers, setCustomers] = useState<SellerCustomerSummaryRow[]>([]);
  const [query, setQuery] = useState("");
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
          "customer_id, email, first_name, last_name, phone, business_name, order_count, lifetime_order_total, latest_order_created_at",
        )
        .eq("store_id", seller.store_id)
        .order("latest_order_created_at", {
          ascending: false,
          nullsFirst: false,
        })
        .order("created_at", { ascending: false })
        .limit(200)
        .returns<SellerCustomerSummaryRow[]>();

      if (!isMounted) return;

      if (result.error) {
        setError(result.error.message);
        setIsLoading(false);
        return;
      }

      setCustomers(result.data ?? []);
      setIsLoading(false);
    }

    void loadCustomers();

    return () => {
      isMounted = false;
    };
  }, [seller]);

  const visibleCustomers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) return customers;

    return customers.filter((customer) =>
      [
        formatCustomerName(customer),
        customer.business_name,
        customer.email,
        customer.phone,
      ]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(normalizedQuery)),
    );
  }, [customers, query]);

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
    <div className="grid gap-4">
      <SellerCard className="p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_18rem] md:items-end">
          <div>
            <h2 className="text-base font-semibold text-stone-950">
              Customer lookup
            </h2>
            <p className="mt-1 text-sm leading-6 text-stone-600">
              Find buyers by name, email, phone, or farm/business name.
            </p>
          </div>
          <label className="grid gap-1 text-sm font-semibold text-stone-700">
            Search customers
            <input
              className="min-h-10 rounded-md border border-stone-300 bg-white px-3 text-sm font-medium text-stone-950 shadow-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
              placeholder="Name, email, or phone"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>
      </SellerCard>

      {visibleCustomers.length > 0 ? (
        <div className="grid gap-3">
          {visibleCustomers.map((customer) => (
            <CustomerCard customer={customer} key={customer.customer_id} />
          ))}
        </div>
      ) : (
        <EmptyState
          title={
            customers.length > 0
              ? "No customers match that search"
              : "No customers yet"
          }
          description={
            customers.length > 0
              ? "Try a different name, email, or phone number."
              : "Customers will appear after storefront or seller-created orders are placed."
          }
        />
      )}
    </div>
  );
}

function CustomerCard({ customer }: { customer: SellerCustomerSummaryRow }) {
  const customerName = formatCustomerName(customer);

  return (
    <SellerCard className="p-4">
      <article className="grid gap-4 lg:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-stone-950">
              <Link
                className="hover:text-emerald-800"
                href={`/dashboard/customers/${customer.customer_id}`}
              >
                {customerName}
              </Link>
            </h3>
            {customer.business_name ? (
              <span className="inline-flex rounded-full bg-stone-100 px-2.5 py-1 text-xs font-semibold text-stone-700">
                {customer.business_name}
              </span>
            ) : null}
          </div>
          <p className="mt-2 break-words text-sm leading-6 text-stone-600">
            {customer.email}
            {customer.phone ? ` - ${customer.phone}` : ""}
          </p>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
            <CustomerFact
              label="Orders"
              value={`${customer.order_count ?? 0}`}
            />
            <CustomerFact
              label="Lifetime spend"
              value={formatCurrency(customer.lifetime_order_total)}
            />
            <CustomerFact
              label="Most recent"
              value={formatDateTime(customer.latest_order_created_at)}
            />
          </dl>
        </div>
        <Link
          className="seller-small-button self-start lg:justify-self-end"
          href={`/dashboard/customers/${customer.customer_id}`}
        >
          View customer
        </Link>
      </article>
    </SellerCard>
  );
}

function CustomerFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">
        {label}
      </dt>
      <dd className="mt-1 font-semibold text-stone-950">{value}</dd>
    </div>
  );
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
