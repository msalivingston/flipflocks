"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSellerContext } from "../../_components/seller-context";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  SellerCard,
  SellerPageHeader,
} from "../../_components/seller-ui";
import {
  formatCurrency,
  formatDateTime,
  formatOrderLifecycle,
  formatOrderSource,
} from "../../orders/order-formatters";

type SellerCustomerDetailRow = {
  customer_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  business_name: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  delivery_address_line1: string | null;
  delivery_address_line2: string | null;
  delivery_city: string | null;
  delivery_state: string | null;
  delivery_postal_code: string | null;
  delivery_country: string | null;
  order_count: number | null;
  open_order_count: number | null;
  lifetime_order_total: number | null;
  latest_order_created_at: string | null;
};

type SellerCustomerOrderRow = {
  order_id: string;
  order_number: string;
  order_source: string | null;
  order_status: string | null;
  payment_method: string | null;
  ready_for_pickup_at: string | null;
  created_at: string;
  total_amount: number | null;
  item_count: number | null;
  total_item_quantity: number | null;
};

type CustomerDetailState = {
  customer: SellerCustomerDetailRow | null;
  orders: SellerCustomerOrderRow[];
};

/**
 * Read-only customer detail built from seller-safe customer and order
 * projections. This is intentionally lookup-focused, not a CRM surface.
 */
export function CustomerDetail({ customerId }: { customerId: string }) {
  const { seller } = useSellerContext();
  const [data, setData] = useState<CustomerDetailState>({
    customer: null,
    orders: [],
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadCustomer() {
      if (!seller) return;

      setIsLoading(true);
      setError(null);

      const [customerResult, ordersResult] = await Promise.all([
        supabase
          .from("seller_customer_detail")
          .select(
            "customer_id, email, first_name, last_name, phone, business_name, city, state, country, delivery_address_line1, delivery_address_line2, delivery_city, delivery_state, delivery_postal_code, delivery_country, order_count, open_order_count, lifetime_order_total, latest_order_created_at",
          )
          .eq("store_id", seller.store_id)
          .eq("customer_id", customerId)
          .maybeSingle<SellerCustomerDetailRow>(),
        supabase
          .from("seller_order_management")
          .select(
            "order_id, order_number, order_source, order_status, payment_method, ready_for_pickup_at, created_at, total_amount, item_count, total_item_quantity",
          )
          .eq("store_id", seller.store_id)
          .eq("customer_id", customerId)
          .order("created_at", { ascending: false })
          .returns<SellerCustomerOrderRow[]>(),
      ]);

      if (!isMounted) return;

      const firstError = customerResult.error ?? ordersResult.error;

      if (firstError) {
        setError(firstError.message);
        setIsLoading(false);
        return;
      }

      setData({
        customer: customerResult.data,
        orders: ordersResult.data ?? [],
      });
      setIsLoading(false);
    }

    void loadCustomer();

    return () => {
      isMounted = false;
    };
  }, [customerId, seller]);

  const customer = data.customer;
  const customerName = useMemo(
    () => (customer ? formatCustomerName(customer) : "Customer"),
    [customer],
  );
  const firstOrderDate =
    data.orders.length > 0
      ? data.orders[data.orders.length - 1].created_at
      : null;
  const pickupLocation = customer ? formatPickupLocation(customer) : null;

  if (isLoading) {
    return (
      <>
        <SellerPageHeader
          title="Customer"
          description="Loading customer details."
        />
        <DetailFrame>
          <LoadingState label="Loading customer" />
        </DetailFrame>
      </>
    );
  }

  if (error) {
    return (
      <>
        <SellerPageHeader
          title="Customer"
          description="Review customer order history."
        />
        <DetailFrame>
          <ErrorState
            title="Customer could not load"
            message="Please refresh the page or return to Customers."
            action={<BackToCustomersLink />}
          />
        </DetailFrame>
      </>
    );
  }

  if (!customer) {
    return (
      <>
        <SellerPageHeader
          title="Customer not found"
          description="This customer may not exist or may not belong to this store."
        />
        <DetailFrame>
          <EmptyState
            title="Customer not found"
            description="Return to Customers to review buyers for this store."
            action={<BackToCustomersLink />}
          />
        </DetailFrame>
      </>
    );
  }

  return (
    <>
      <SellerPageHeader
        eyebrow="Customer"
        title={customerName}
        description="Review contact details and purchase history for this buyer."
        action={<BackToCustomersLink />}
      />

      <DetailFrame>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="grid gap-5">
            <SellerCard className="p-5">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-stone-950">
                  {customerName}
                </h2>
                {customer.business_name ? (
                  <p className="mt-1 text-sm font-semibold text-stone-700">
                    {customer.business_name}
                  </p>
                ) : null}
                <p className="mt-2 break-words text-sm leading-6 text-stone-600">
                  {customer.email}
                  {customer.phone ? ` - ${customer.phone}` : ""}
                </p>
              </div>
            </SellerCard>

            <SellerCard className="p-5">
              <h2 className="text-base font-semibold text-stone-950">
                Purchase summary
              </h2>
              <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <CustomerFact
                  label="Total orders"
                  value={`${customer.order_count ?? 0}`}
                />
                <CustomerFact
                  label="Lifetime spend"
                  value={formatCurrency(customer.lifetime_order_total)}
                />
                <CustomerFact
                  label="First order"
                  value={formatDateTime(firstOrderDate)}
                />
                <CustomerFact
                  label="Most recent"
                  value={formatDateTime(customer.latest_order_created_at)}
                />
              </dl>
            </SellerCard>

            <SellerCard className="p-5">
              <h2 className="text-base font-semibold text-stone-950">
                Order history
              </h2>
              <p className="mt-1 text-sm leading-6 text-stone-600">
                Previous requests and purchases from this customer.
              </p>

              {data.orders.length > 0 ? (
                <div className="mt-4 grid gap-3">
                  {data.orders.map((order) => (
                    <CustomerOrderCard key={order.order_id} order={order} />
                  ))}
                </div>
              ) : (
                <div className="mt-4">
                  <EmptyState
                    title="No orders yet"
                    description="Order history will appear here after this customer places an order."
                  />
                </div>
              )}
            </SellerCard>
          </div>

          <aside className="grid content-start gap-5">
            <SellerCard className="p-5">
              <h2 className="text-base font-semibold text-stone-950">
                Contact details
              </h2>
              <dl className="mt-4 grid gap-4">
                <CustomerFact label="Email" value={customer.email} />
                <CustomerFact
                  label="Phone"
                  value={customer.phone || "No phone on file"}
                />
                <CustomerFact
                  label="Pickup location"
                  value={pickupLocation || "No pickup location on file"}
                />
              </dl>
            </SellerCard>

            <SellerCard className="p-5">
              <h2 className="text-base font-semibold text-stone-950">
                Working orders
              </h2>
              <p className="mt-2 text-2xl font-semibold text-stone-950">
                {customer.open_order_count ?? 0}
              </p>
              <p className="mt-1 text-sm leading-6 text-stone-600">
                Open orders that may still need pickup coordination.
              </p>
            </SellerCard>
          </aside>
        </div>
      </DetailFrame>
    </>
  );
}

function CustomerOrderCard({ order }: { order: SellerCustomerOrderRow }) {
  return (
    <article className="rounded-lg border border-stone-200 bg-stone-50 p-4">
      <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-stone-950">
              {order.order_number}
            </h3>
            <span className="inline-flex rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-stone-700 ring-1 ring-stone-200">
              {formatOrderLifecycle(order)}
            </span>
          </div>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            {formatDateTime(order.created_at)} - {formatOrderSource(order)}
          </p>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
            <CustomerFact
              label="Items"
              value={`${order.total_item_quantity ?? order.item_count ?? 0}`}
            />
            <CustomerFact
              label="Total"
              value={formatCurrency(order.total_amount)}
            />
            <CustomerFact
              label="Status"
              value={formatOrderLifecycle(order)}
            />
          </dl>
        </div>
        <Link
          className="seller-small-button self-start lg:justify-self-end"
          href={`/dashboard/orders/${order.order_id}`}
        >
          View order
        </Link>
      </div>
    </article>
  );
}

function CustomerFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">
        {label}
      </dt>
      <dd className="mt-1 break-words font-semibold text-stone-950">{value}</dd>
    </div>
  );
}

function DetailFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-7xl px-5 py-5 sm:px-7">
      {children}
    </div>
  );
}

function BackToCustomersLink() {
  return (
    <Link className="seller-small-button" href="/dashboard/customers">
      Back to Customers
    </Link>
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

function formatPickupLocation(customer: SellerCustomerDetailRow) {
  const deliveryLine = [
    customer.delivery_address_line1,
    customer.delivery_address_line2,
  ]
    .filter(Boolean)
    .join(", ");
  const deliveryCityLine = [
    customer.delivery_city,
    customer.delivery_state,
    customer.delivery_postal_code,
  ]
    .filter(Boolean)
    .join(", ");
  const deliveryLocation = [
    deliveryLine,
    deliveryCityLine,
    customer.delivery_country,
  ]
    .filter(Boolean)
    .join(", ");

  if (deliveryLocation) return deliveryLocation;

  return [customer.city, customer.state, customer.country]
    .filter(Boolean)
    .join(", ");
}
