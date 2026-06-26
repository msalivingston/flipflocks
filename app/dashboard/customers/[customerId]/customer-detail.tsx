"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSellerContext } from "../../_components/seller-context";
import {
  DashboardPageContent,
  EmptyState,
  ErrorState,
  LoadingState,
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
  internal_notes: string | null;
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

type CustomerContactForm = {
  email: string;
  phone: string;
  pickupLocation: string;
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
            "customer_id, email, first_name, last_name, phone, business_name, city, state, country, delivery_address_line1, delivery_address_line2, delivery_city, delivery_state, delivery_postal_code, delivery_country, internal_notes, order_count, open_order_count, lifetime_order_total, latest_order_created_at",
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
      <DashboardPageContent>
        <DetailHeader customerName="Customer" isLoading />
        <LoadingState label="Loading customer" />
      </DashboardPageContent>
    );
  }

  if (error) {
    return (
      <DashboardPageContent>
        <DetailHeader customerName="Customer" />
        <ErrorState
          title="Customer could not load"
          message="Please refresh the page or return to Customers."
          action={<BackToCustomersLink />}
        />
      </DashboardPageContent>
    );
  }

  if (!customer) {
    return (
      <DashboardPageContent>
        <DetailHeader customerName="Customer not found" />
        <EmptyState
          title="Customer not found"
          description="Return to Customers to review buyers for this store."
          action={<BackToCustomersLink />}
        />
      </DashboardPageContent>
    );
  }

  return (
    <DashboardPageContent className="space-y-5">
      <DetailHeader customerName={customerName} />

      <CustomerSummaryCard
        customer={customer}
        customerName={customerName}
        firstOrderDate={firstOrderDate}
        pickupLocation={pickupLocation}
      />

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(19rem,0.95fr)]">
        <OrderHistoryCard orders={data.orders} />

        <aside className="grid min-w-0 content-start gap-5">
          <ContactDetailsCard
            customer={customer}
            pickupLocation={pickupLocation}
            onCustomerChange={(updates) => {
              setData((current) => ({
                ...current,
                customer: current.customer
                  ? { ...current.customer, ...updates }
                  : current.customer,
              }));
            }}
          />
          <CustomerNotesCard
            customer={customer}
            onCustomerChange={(updates) => {
              setData((current) => ({
                ...current,
                customer: current.customer
                  ? { ...current.customer, ...updates }
                  : current.customer,
              }));
            }}
          />
          <WorkingOrdersCard count={customer.open_order_count ?? 0} />
        </aside>
      </div>
    </DashboardPageContent>
  );
}

function DetailHeader({
  customerName,
  isLoading = false,
}: {
  customerName: string;
  isLoading?: boolean;
}) {
  return (
    <header className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <nav
          aria-label="Breadcrumb"
          className="flex min-w-0 items-center gap-2 text-sm font-semibold"
        >
          <Link className="text-emerald-800 hover:text-emerald-950" href="/dashboard/customers">
            Customers
          </Link>
          <span className="text-stone-400">&gt;</span>
          <span className="min-w-0 truncate text-stone-700">
            {isLoading ? "Loading" : customerName}
          </span>
        </nav>
        <h1 className="mt-3 truncate text-3xl font-semibold text-stone-950">
          {customerName}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-600">
          Review contact details and purchase history for this buyer.
        </p>
      </div>
      <BackToCustomersLink />
    </header>
  );
}

function CustomerSummaryCard({
  customer,
  customerName,
  firstOrderDate,
  pickupLocation,
}: {
  customer: SellerCustomerDetailRow;
  customerName: string;
  firstOrderDate: string | null;
  pickupLocation: string | null;
}) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] xl:items-center">
        <div className="flex min-w-0 gap-4">
          <InitialsBubble customer={customer} />
          <div className="min-w-0">
            <h2 className="truncate text-xl font-semibold text-stone-950">
              {customerName}
            </h2>
            {customer.business_name ? (
              <p className="mt-1 truncate text-sm font-semibold text-stone-700">
                {customer.business_name}
              </p>
            ) : null}
            <div className="mt-4 grid min-w-0 gap-2 text-sm text-stone-600">
              <ContactLine
                icon="/glyphs/envelope.png"
                value={customer.email}
              />
              <ContactLine
                icon="/glyphs/phone.png"
                value={customer.phone || "No phone on file"}
              />
              <ContactLine
                icon="/glyphs/map-pin.png"
                value={pickupLocation || "No pickup location on file"}
              />
            </div>
          </div>
        </div>

        <div className="grid min-w-0 gap-3 border-stone-200 sm:grid-cols-2 xl:grid-cols-4 xl:divide-x xl:divide-stone-200 xl:border-l xl:pl-4">
          <SummaryStat
            icon="/glyphs/shopping-bag.png"
            label="Total orders"
            value={`${customer.order_count ?? 0}`}
          />
          <SummaryStat
            icon="/glyphs/egg.png"
            label="Lifetime spend"
            value={formatCurrency(customer.lifetime_order_total)}
          />
          <SummaryStat
            icon="/glyphs/calendar.png"
            label="First order"
            value={formatDateOnly(firstOrderDate)}
            subvalue={formatTimeOnly(firstOrderDate)}
          />
          <SummaryStat
            icon="/glyphs/calendar.png"
            label="Most recent"
            value={formatDateOnly(customer.latest_order_created_at)}
            subvalue={formatTimeOnly(customer.latest_order_created_at)}
          />
        </div>
      </div>
    </section>
  );
}

function OrderHistoryCard({ orders }: { orders: SellerCustomerOrderRow[] }) {
  return (
    <section className="min-w-0 rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
      <div className="flex min-w-0 items-start gap-3">
        <IconBubble src="/glyphs/clipboard.png" />
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-stone-950">
            Order history
          </h2>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            Previous requests and purchases from this customer.
          </p>
        </div>
      </div>

      {orders.length > 0 ? (
        <div className="mt-5 grid gap-3">
          {orders.map((order) => (
            <CustomerOrderCard key={order.order_id} order={order} />
          ))}
        </div>
      ) : (
        <div className="mt-5">
          <EmptyState
            title="No orders yet"
            description="Order history will appear here after this customer places an order."
          />
        </div>
      )}
    </section>
  );
}

function CustomerOrderCard({ order }: { order: SellerCustomerOrderRow }) {
  const status = formatOrderLifecycle(order);

  return (
    <article className="rounded-lg border border-stone-200 bg-white p-4 shadow-[0_8px_18px_rgba(46,39,25,0.04)]">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-stone-950">
              {formatOrderNumber(order.order_number)}
            </h3>
            <span className="inline-flex min-h-7 items-center rounded-full bg-emerald-50 px-2.5 py-1 text-sm font-semibold text-emerald-800 ring-1 ring-emerald-100 sm:min-h-0 sm:text-xs">
              {status}
            </span>
          </div>
          <p className="mt-3 flex min-w-0 flex-wrap items-center gap-2 text-sm leading-5 text-stone-600">
            <Image src="/glyphs/calendar.png" alt="" width={15} height={15} />
            <span>{formatDateTime(order.created_at)}</span>
            <span aria-hidden="true">-</span>
            <span>{formatOrderSource(order)}</span>
          </p>
        </div>
        <Link
          className="inline-flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-950 transition hover:border-emerald-700 hover:bg-emerald-50 hover:text-emerald-900 sm:min-h-10"
          href={`/dashboard/orders/${order.order_id}`}
        >
          View order
        </Link>
      </div>

      <dl className="mt-4 grid gap-3 border-t border-stone-100 pt-4 text-sm sm:grid-cols-3">
        <CompactFact
          label="Items"
          value={`${order.total_item_quantity ?? order.item_count ?? 0}`}
        />
        <CompactFact label="Total" value={formatCurrency(order.total_amount)} />
        <CompactFact label="Status" value={status} />
      </dl>
    </article>
  );
}

function ContactDetailsCard({
  customer,
  pickupLocation,
  onCustomerChange,
}: {
  customer: SellerCustomerDetailRow;
  pickupLocation: string | null;
  onCustomerChange: (updates: Partial<SellerCustomerDetailRow>) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<CustomerContactForm>(() =>
    getContactForm(customer, pickupLocation),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function beginEditing() {
    setForm(getContactForm(customer, pickupLocation));
    setSaveError(null);
    setIsEditing(true);
  }

  function cancelEditing() {
    setForm(getContactForm(customer, pickupLocation));
    setSaveError(null);
    setIsEditing(false);
  }

  async function saveContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveError(null);

    const email = form.email.trim();

    if (email && !isValidEmail(email)) {
      setSaveError("Enter a valid email address.");
      return;
    }

    setIsSaving(true);

    const pickupLocationValue = form.pickupLocation.trim();
    const updates = {
      email,
      phone: form.phone.trim() || null,
      delivery_address_line1: pickupLocationValue || null,
      delivery_address_line2: null,
      delivery_city: null,
      delivery_state: null,
      delivery_postal_code: null,
      delivery_country: null,
    };
    const { error } = await supabase.rpc("seller_update_customer", {
      p_customer_id: customer.customer_id,
      p_updates: updates,
    });

    setIsSaving(false);

    if (error) {
      setSaveError(error.message);
      return;
    }

    onCustomerChange(updates);
    setIsEditing(false);
  }

  return (
    <section className="min-w-0 rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <IconBubble src="/glyphs/person.png" />
          <h2 className="text-xl font-semibold text-stone-950">
            Contact details
          </h2>
        </div>
        {!isEditing ? (
          <IconButton
            label="Edit contact details"
            onClick={beginEditing}
            src="/glyphs/pencil.png"
          />
        ) : null}
      </div>
      {isEditing ? (
        <form className="mt-5 grid gap-4" onSubmit={saveContact}>
          <EditableField
            label="Email"
            type="email"
            value={form.email}
            onChange={(value) => setForm((current) => ({ ...current, email: value }))}
          />
          <EditableField
            label="Phone"
            value={form.phone}
            onChange={(value) => setForm((current) => ({ ...current, phone: value }))}
          />
          <EditableField
            label="Pickup location"
            value={form.pickupLocation}
            onChange={(value) =>
              setForm((current) => ({ ...current, pickupLocation: value }))
            }
          />
          {saveError ? (
            <p className="text-sm font-medium text-red-700">{saveError}</p>
          ) : null}
          <FormActions
            isSaving={isSaving}
            onCancel={cancelEditing}
            saveLabel="Save"
          />
        </form>
      ) : (
        <dl className="mt-5 grid gap-5">
          <DetailField label="Email" value={customer.email} />
          <DetailField label="Phone" value={customer.phone || "No phone on file"} />
          <DetailField
            label="Pickup location"
            value={pickupLocation || "No pickup location on file"}
          />
        </dl>
      )}
    </section>
  );
}

function CustomerNotesCard({
  customer,
  onCustomerChange,
}: {
  customer: SellerCustomerDetailRow;
  onCustomerChange: (updates: Partial<SellerCustomerDetailRow>) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [notes, setNotes] = useState(customer.internal_notes ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function beginEditing() {
    setNotes(customer.internal_notes ?? "");
    setSaveError(null);
    setIsEditing(true);
  }

  function cancelEditing() {
    setNotes(customer.internal_notes ?? "");
    setSaveError(null);
    setIsEditing(false);
  }

  async function saveNotes(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveError(null);
    setIsSaving(true);

    const internalNotes = notes.trim() || null;
    const { error } = await supabase.rpc("seller_update_customer", {
      p_customer_id: customer.customer_id,
      p_updates: {
        internal_notes: internalNotes,
      },
    });

    setIsSaving(false);

    if (error) {
      setSaveError(error.message);
      return;
    }

    onCustomerChange({ internal_notes: internalNotes });
    setIsEditing(false);
  }

  return (
    <section className="min-w-0 rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <IconBubble src="/glyphs/clipboard.png" />
          <h2 className="text-xl font-semibold text-stone-950">
            Customer notes
          </h2>
        </div>
        {!isEditing ? (
          <IconButton
            label="Edit customer notes"
            onClick={beginEditing}
            src="/glyphs/pencil.png"
          />
        ) : null}
      </div>

      {isEditing ? (
        <form className="mt-5 grid gap-4" onSubmit={saveNotes}>
          <label className="grid gap-2">
            <span className="text-sm font-semibold uppercase tracking-[0.12em] text-stone-500 sm:text-xs">
              Notes
            </span>
            <textarea
              className="min-h-32 w-full resize-y rounded-md border border-stone-300 bg-white px-3 py-2 text-base leading-6 text-stone-950 shadow-sm outline-none transition placeholder:text-stone-400 focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100 sm:text-sm"
              onChange={(event) => setNotes(event.target.value)}
              value={notes}
            />
          </label>
          {saveError ? (
            <p className="text-sm font-medium text-red-700">{saveError}</p>
          ) : null}
          <FormActions
            isSaving={isSaving}
            onCancel={cancelEditing}
            saveLabel="Save"
          />
        </form>
      ) : (
        <p className="mt-5 whitespace-pre-wrap break-words text-sm font-medium leading-6 text-stone-700">
          {customer.internal_notes?.trim() || (
            <span className="font-normal text-stone-500">No notes yet.</span>
          )}
        </p>
      )}
    </section>
  );
}

function WorkingOrdersCard({ count }: { count: number }) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <IconBubble src="/glyphs/egg-carton.png" />
        <h2 className="text-xl font-semibold text-stone-950">
          Working orders
        </h2>
      </div>
      <p className="mt-5 text-3xl font-semibold text-stone-950">{count}</p>
      <p className="mt-3 text-sm leading-6 text-stone-600">
        Open orders that may still need pickup coordination.
      </p>
    </section>
  );
}

function SummaryStat({
  icon,
  label,
  value,
  subvalue,
}: {
  icon: string;
  label: string;
  value: string;
  subvalue?: string;
}) {
  return (
    <div className="min-w-0 px-0 py-1 text-left sm:text-center xl:px-3">
      <div className="flex justify-start sm:justify-center">
        <IconBubble src={icon} size="sm" />
      </div>
      <dt className="mt-2 text-sm font-medium text-stone-600 sm:text-xs">{label}</dt>
      <dd className="mt-1 whitespace-nowrap text-base font-semibold text-stone-950">
        {value}
      </dd>
      {subvalue ? (
        <dd className="mt-1 whitespace-nowrap text-sm font-medium text-stone-600 sm:text-xs">
          {subvalue}
        </dd>
      ) : null}
    </div>
  );
}

function CompactFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border-stone-100 sm:border-l sm:pl-4 sm:first:border-l-0 sm:first:pl-0">
      <dt className="text-sm font-medium text-stone-500 sm:text-xs">{label}</dt>
      <dd className="mt-1 truncate text-base font-semibold text-stone-950 sm:text-sm">{value}</dd>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm font-semibold uppercase tracking-[0.12em] text-stone-500 sm:text-xs">
        {label}
      </dt>
      <dd className="mt-2 break-words text-base font-semibold leading-6 text-stone-950 sm:text-sm">
        {value}
      </dd>
    </div>
  );
}

function EditableField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "email" | "text";
}) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-semibold uppercase tracking-[0.12em] text-stone-500 sm:text-xs">
        {label}
      </span>
      <input
        className="min-h-11 w-full rounded-md border border-stone-300 bg-white px-3 text-base text-stone-950 shadow-sm outline-none transition placeholder:text-stone-400 focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100 sm:min-h-10 sm:text-sm"
        onChange={(event) => onChange(event.target.value)}
        type={type}
        value={value}
      />
    </label>
  );
}

function ContactLine({ icon, value }: { icon: string; value: string }) {
  return (
    <p className="flex min-w-0 items-center gap-3">
      <Image className="shrink-0 opacity-75" src={icon} alt="" width={16} height={16} />
      <span className="min-w-0 break-words leading-6">{value}</span>
    </p>
  );
}

function IconButton({
  label,
  onClick,
  src,
}: {
  label: string;
  onClick: () => void;
  src: string;
}) {
  return (
    <button
      aria-label={label}
      className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-stone-200 bg-white text-stone-600 transition hover:border-emerald-700 hover:bg-emerald-50"
      onClick={onClick}
      title={label}
      type="button"
    >
      <Image src={src} alt="" width={16} height={16} />
    </button>
  );
}

function FormActions({
  isSaving,
  onCancel,
  saveLabel,
}: {
  isSaving: boolean;
  onCancel: () => void;
  saveLabel: string;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <button
        className="inline-flex min-h-11 items-center justify-center rounded-md border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-950 transition hover:border-emerald-700 hover:bg-emerald-50 hover:text-emerald-900 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-10"
        disabled={isSaving}
        onClick={onCancel}
        type="button"
      >
        Cancel
      </button>
      <button
        className="inline-flex min-h-11 items-center justify-center rounded-md bg-emerald-800 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-10"
        disabled={isSaving}
        type="submit"
      >
        {isSaving ? "Saving..." : saveLabel}
      </button>
    </div>
  );
}

function IconBubble({
  src,
  size = "md",
}: {
  src: string;
  size?: "md" | "sm";
}) {
  const classes =
    size === "sm"
      ? "size-8"
      : "size-9";
  const iconSize = size === "sm" ? 16 : 18;

  return (
    <span className={`flex ${classes} shrink-0 items-center justify-center rounded-full bg-emerald-50 ring-1 ring-emerald-100`}>
      <Image src={src} alt="" width={iconSize} height={iconSize} />
    </span>
  );
}

function InitialsBubble({ customer }: { customer: SellerCustomerDetailRow }) {
  return (
    <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xl font-bold text-emerald-900">
      {formatCustomerInitials(customer)}
    </span>
  );
}

function BackToCustomersLink() {
  return (
    <Link
      className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-md border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-950 shadow-sm transition hover:border-emerald-700 hover:bg-emerald-50 hover:text-emerald-900 sm:min-h-10"
      href="/dashboard/customers"
    >
      <ArrowLeft aria-hidden="true" className="size-4" />
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

function formatCustomerInitials(customer: SellerCustomerDetailRow) {
  const initials = [customer.first_name, customer.last_name]
    .filter(Boolean)
    .map((value) => value?.trim().charAt(0))
    .join("");

  if (initials) return initials.slice(0, 2).toUpperCase();

  return customer.email.slice(0, 2).toUpperCase();
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

function getContactForm(
  customer: SellerCustomerDetailRow,
  pickupLocation: string | null,
): CustomerContactForm {
  return {
    email: customer.email,
    phone: customer.phone ?? "",
    pickupLocation: pickupLocation ?? "",
  };
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function formatDateOnly(value: string | null) {
  if (!value) return "Not set";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatTimeOnly(value: string | null) {
  if (!value) return undefined;

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatOrderNumber(orderNumber: string) {
  return orderNumber.startsWith("#") ? orderNumber : `#${orderNumber}`;
}
