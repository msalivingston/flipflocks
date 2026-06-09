"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  StorefrontCart,
  cartItemKey,
  StorefrontCartItem,
  clearStorefrontCart,
  readStorefrontCart,
  summarizeStorefrontCart,
} from "../_components/storefront-cart-client";
import { StorefrontHome } from "../storefront-data";
import {
  StorefrontButton,
  StorefrontCard,
  StorefrontInput,
  StorefrontLabel,
  StorefrontPage,
  StorefrontSummaryCard,
  StorefrontTextarea,
  formatCurrency,
  formatDate,
} from "../storefront-ui";

type BuyerForm = {
  buyerEmail: string;
  buyerFirstName: string;
  buyerLastName: string;
  buyerPhone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  buyerNotes: string;
  pickupNote: string;
};

type CheckoutSummary = {
  is_checkout_available: boolean;
  message: string | null;
  item_count: number;
  total_quantity: number;
  subtotal_amount: number | string;
  items: CheckoutSummaryItem[];
};

type CheckoutSummaryItem = {
  item_type: "listing_inventory" | "equipment_inventory" | string;
  item_id: string;
  inventory_item_id: string | null;
  equipment_inventory_item_id: string | null;
  processed_poultry_inventory_item_id: string | null;
  item_name: string;
  item_category: string;
  breed_display_name?: string;
  custom_inventory_label: string | null;
  inventory_type: string;
  requested_quantity: number;
  quantity_available: number;
  available_date: string;
  unit_price: number | string;
  line_subtotal: number | string;
};

type OrderResponse = {
  order?: {
    order_number?: string | null;
    total_amount?: number | string | null;
    currency?: string | null;
  } | null;
};

type SuccessState = {
  orderNumber: string | null;
  totalText: string;
};

const initialForm: BuyerForm = {
  buyerEmail: "",
  buyerFirstName: "",
  buyerLastName: "",
  buyerPhone: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
  buyerNotes: "",
  pickupNote: "",
};

const emptyCartItems: StorefrontCart["items"] = [];

export function CheckoutPage({ store }: { store: StorefrontHome }) {
  const router = useRouter();
  const [cart, setCart] = useState<StorefrontCart | null>(null);
  const [form, setForm] = useState<BuyerForm>(initialForm);
  const [summary, setSummary] = useState<CheckoutSummary | null>(null);
  const [summaryMessage, setSummaryMessage] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessState | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setCart(readStorefrontCart(store.store_slug));
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [store.store_slug]);

  const cartItems = cart?.items ?? emptyCartItems;
  const cartSummary = useMemo(
    () => summarizeStorefrontCart(cartItems),
    [cartItems],
  );
  const checkoutItems = useMemo(() => toCheckoutItems(cartItems), [cartItems]);
  const validatedSubtotal =
    summary?.is_checkout_available === true
      ? toNumber(summary.subtotal_amount)
      : null;
  const estimatedTotal = validatedSubtotal ?? cartSummary.subtotal;

  useEffect(() => {
    if (cart === null || checkoutItems.length === 0) {
      const timeout = window.setTimeout(() => {
        setSummary(null);
        setSummaryMessage(null);
        setIsChecking(false);
      }, 0);

      return () => window.clearTimeout(timeout);
    }

    let isActive = true;

    async function validateCart() {
      setIsChecking(true);
      setSummaryMessage(null);

      const { data, error } = await supabase.rpc("get_public_checkout_summary", {
        p_store_slug: store.store_slug,
        p_items: checkoutItems,
      });

      if (!isActive) return;

      if (error) {
        setSummary(null);
        setSummaryMessage(
          "We could not verify this cart yet. Please try checkout again.",
        );
      } else {
        const nextSummary = Array.isArray(data)
          ? (data[0] as CheckoutSummary | undefined)
          : null;

        setSummary(nextSummary ?? null);
        setSummaryMessage(nextSummary?.message ?? null);
      }

      setIsChecking(false);
    }

    validateCart();

    return () => {
      isActive = false;
    };
  }, [cart, checkoutItems, store.store_slug]);

  function updateField(field: keyof BuyerForm, value: string) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    if (checkoutItems.length === 0) {
      setErrorMessage("Your cart is empty.");
      return;
    }

    if (summary && !summary.is_checkout_available) {
      setErrorMessage(toBuyerOrderError(summary.message ?? undefined));
      return;
    }

    setIsSubmitting(true);

    const payload = {
      store_slug: store.store_slug,
      idempotency_key: createIdempotencyKey(store.store_slug),
      buyer_email: form.buyerEmail.trim(),
      buyer_first_name: form.buyerFirstName.trim(),
      buyer_last_name: form.buyerLastName.trim(),
      buyer_phone: form.buyerPhone.trim(),
      delivery_address_line1: form.addressLine1.trim(),
      delivery_address_line2: form.addressLine2.trim() || null,
      delivery_city: form.city.trim(),
      delivery_state: form.state.trim(),
      delivery_postal_code: form.postalCode.trim(),
      delivery_country: "US",
      buyer_notes: form.buyerNotes.trim() || null,
      pickup_note: form.pickupNote.trim() || null,
      items: checkoutItems,
    };

    try {
      const { data, error } = await supabase.functions.invoke<OrderResponse>(
        "pay-at-pickup-order",
        {
          body: payload,
        },
      );

      if (error) {
        const detail = await readFunctionError(error);
        setErrorMessage(toBuyerOrderError(detail?.message));
        router.refresh();
        return;
      }

      clearStorefrontCart(store.store_slug);
      setCart(readStorefrontCart(store.store_slug));
      setSuccess({
        orderNumber: data?.order?.order_number ?? null,
        totalText: formatOrderTotal(data?.order?.total_amount, estimatedTotal),
      });
      setForm(initialForm);
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  if (success) {
    return (
      <StorefrontPage size="narrow" className="py-10">
        <StorefrontCard className="border-emerald-200 p-6">
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-emerald-800">
            Order placed
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-stone-950">
            Your order has been placed.
          </h1>
          <p className="mt-3 text-sm leading-6 text-stone-600">
            The seller will follow up with pickup details.
          </p>
          <dl className="mt-5 grid gap-2 text-sm">
            {success.orderNumber ? (
              <SummaryRow label="Order number" value={success.orderNumber} />
            ) : null}
            <SummaryRow label="Estimated total" value={success.totalText} />
          </dl>
          <StorefrontButton className="mt-6" href={`/store/${store.store_slug}`}>
            Continue shopping
          </StorefrontButton>
        </StorefrontCard>
      </StorefrontPage>
    );
  }

  return (
    <StorefrontPage className="gap-7">
      <div className="rounded-xl border border-[#ded7c8] bg-white p-6 shadow-[0_16px_40px_rgba(46,35,20,0.07)]">
        <p className="text-sm font-semibold uppercase tracking-[0.12em] text-emerald-800">
          Checkout
        </p>
        <h1 className="mt-1 text-4xl font-semibold text-stone-950">
          Place your order
        </h1>
        <p className="mt-2 text-sm leading-6 text-stone-600">
          Enter your contact details once and review your order summary.
        </p>
      </div>

      {cart === null ? (
        <CheckoutPanel>
          <p className="text-sm text-stone-600">Loading checkout...</p>
        </CheckoutPanel>
      ) : cartItems.length === 0 ? (
        <CheckoutPanel>
          <h2 className="text-xl font-semibold text-stone-950">
            Your cart is empty
          </h2>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            Add available options before checkout.
          </p>
          <StorefrontButton className="mt-4 min-h-10" href={`/store/${store.store_slug}`}>
            Continue shopping
          </StorefrontButton>
        </CheckoutPanel>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_22rem] lg:items-start">
          <form
            className="rounded-xl border border-[#ded7c8] bg-white p-6 shadow-[0_16px_40px_rgba(46,35,20,0.08)]"
            onSubmit={handleSubmit}
          >
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-800">
              Buyer details
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-stone-950">
              Contact and pickup information
            </h2>
            <div className="mt-5 grid gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  label="First name"
                  name="buyerFirstName"
                  onChange={(value) => updateField("buyerFirstName", value)}
                  value={form.buyerFirstName}
                />
                <TextField
                  label="Last name"
                  name="buyerLastName"
                  onChange={(value) => updateField("buyerLastName", value)}
                  value={form.buyerLastName}
                />
              </div>

              <TextField
                label="Email"
                name="buyerEmail"
                onChange={(value) => updateField("buyerEmail", value)}
                type="email"
                value={form.buyerEmail}
              />
              <TextField
                label="Phone"
                name="buyerPhone"
                onChange={(value) => updateField("buyerPhone", value)}
                type="tel"
                value={form.buyerPhone}
              />

              <h2 className="border-t border-[#eee5d6] pt-5 text-xl font-semibold text-stone-950">
                Pickup details
              </h2>
              <TextField
                label="Address line 1"
                name="addressLine1"
                onChange={(value) => updateField("addressLine1", value)}
                value={form.addressLine1}
              />
              <TextField
                label="Address line 2"
                name="addressLine2"
                onChange={(value) => updateField("addressLine2", value)}
                required={false}
                value={form.addressLine2}
              />
              <div className="grid gap-3 sm:grid-cols-[1fr_5rem_7rem]">
                <TextField
                  label="City"
                  name="city"
                  onChange={(value) => updateField("city", value)}
                  value={form.city}
                />
                <TextField
                  label="State"
                  maxLength={40}
                  name="state"
                  onChange={(value) => updateField("state", value)}
                  value={form.state}
                />
                <TextField
                  label="ZIP"
                  maxLength={20}
                  name="postalCode"
                  onChange={(value) => updateField("postalCode", value)}
                  value={form.postalCode}
                />
              </div>

              <TextArea
                label="Notes for the seller"
                name="buyerNotes"
                onChange={(value) => updateField("buyerNotes", value)}
                value={form.buyerNotes}
              />
              <TextArea
                label="Pickup notes"
                name="pickupNote"
                onChange={(value) => updateField("pickupNote", value)}
                value={form.pickupNote}
              />

              {errorMessage ? (
                <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm leading-6 text-rose-800">
                  {errorMessage}
                </div>
              ) : null}

              <StorefrontButton
                className="mt-2"
                disabled={
                  isSubmitting ||
                  isChecking ||
                  checkoutItems.length === 0 ||
                  summary?.is_checkout_available === false
                }
                type="submit"
              >
                {isSubmitting ? "Placing order..." : "Place order"}
              </StorefrontButton>
            </div>
          </form>

          <aside className="grid h-fit gap-4 lg:sticky lg:top-28">
            <StorefrontSummaryCard>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-800">
                Order summary
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-stone-950">
                Your order
              </h2>
              <div className="mt-4 grid gap-3">
                {cartItems.map((item) => (
                  <div
                    className="rounded-lg border border-[#eee5d6] bg-[#fffdf8] p-3 text-sm"
                    key={cartItemKey(item)}
                  >
                    <div className="flex justify-between gap-3">
                      <p className="font-semibold text-stone-950">
                        {item.productName}
                      </p>
                      <p className="font-semibold text-stone-950">
                        {formatCurrency(item.unitPrice * item.quantity)}
                      </p>
                    </div>
                    <p className="mt-1 text-stone-600">
                      {item.quantity} x {item.optionLabel}
                    </p>
                    <p className="mt-1 text-stone-500">
                      {formatCartAvailability(item.availableDate)}
                    </p>
                  </div>
                ))}
              </div>
              <dl className="mt-5 grid gap-2 text-sm">
                <SummaryRow
                  label="Items"
                  value={String(summary?.total_quantity ?? cartSummary.totalQuantity)}
                />
                <SummaryRow
                  label="Estimated total"
                  value={formatCurrency(estimatedTotal)}
                />
              </dl>
              {isChecking ? (
                <p className="mt-3 text-sm text-stone-500">
                  Checking availability...
                </p>
              ) : null}
              {summaryMessage ? (
                <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  {toBuyerOrderError(summaryMessage)}
                </p>
              ) : null}
              <StorefrontButton
                className="mt-4 min-h-10 w-full"
                href={`/store/${store.store_slug}/cart`}
                variant="secondary"
              >
                View cart
              </StorefrontButton>

            </StorefrontSummaryCard>

            <StorefrontSummaryCard className="bg-[#fffdf8]">
              <h2 className="text-lg font-semibold text-stone-950">
                Pickup and policies
              </h2>
              <div className="mt-3 grid gap-3 whitespace-pre-line text-sm leading-6 text-stone-600">
                <p>{store.pickup_instructions || "Pickup details coming soon."}</p>
                {store.pickup_policy ? <p>{store.pickup_policy}</p> : null}
                {store.cancellation_policy ? (
                  <p>{store.cancellation_policy}</p>
                ) : null}
              </div>
            </StorefrontSummaryCard>
          </aside>
        </div>
      )}
    </StorefrontPage>
  );
}

function CheckoutPanel({ children }: { children: React.ReactNode }) {
  return (
    <StorefrontCard>
      {children}
    </StorefrontCard>
  );
}

function TextField({
  label,
  maxLength,
  name,
  onChange,
  required = true,
  type = "text",
  value,
}: {
  label: string;
  maxLength?: number;
  name: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: "email" | "tel" | "text";
  value: string;
}) {
  return (
    <StorefrontLabel>
      {label}
      <StorefrontInput
        maxLength={maxLength}
        name={name}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        type={type}
        value={value}
      />
    </StorefrontLabel>
  );
}

function TextArea({
  label,
  name,
  onChange,
  value,
}: {
  label: string;
  name: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <StorefrontLabel>
      {label}
      <StorefrontTextarea
        maxLength={2000}
        name={name}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </StorefrontLabel>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-stone-600">{label}</dt>
      <dd className="font-semibold text-stone-950">{value}</dd>
    </div>
  );
}

function toCheckoutItems(items: StorefrontCartItem[]) {
  return items
    .filter((item) => item.quantity > 0)
    .map((item) => ({
      item_type: item.itemType,
      item_id: item.itemId,
      quantity: item.quantity,
    }));
}

function createIdempotencyKey(storeSlug: string) {
  const randomPart =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return `${storeSlug}:${randomPart}`;
}

function formatOrderTotal(
  totalAmount: number | string | null | undefined,
  fallback: number,
) {
  const numericTotal = toNumber(totalAmount);

  return formatCurrency(numericTotal ?? fallback);
}

function toNumber(value: number | string | null | undefined) {
  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : null;

  return typeof numericValue === "number" && Number.isFinite(numericValue)
    ? numericValue
    : null;
}

async function readFunctionError(error: unknown) {
  const context =
    error && typeof error === "object"
      ? (error as { context?: unknown }).context
      : null;

  if (context instanceof Response) {
    try {
      const body = (await context.json()) as unknown;

      if (body && typeof body === "object") {
        return {
          status: context.status,
          statusText: context.statusText,
          ...(body as { error?: string; message?: string }),
        };
      }
    } catch {
      return {
        status: context.status,
        statusText: context.statusText,
        message: context.statusText || "Order failed.",
      };
    }
  }

  return error && typeof error === "object"
    ? {
        message:
          typeof (error as { message?: unknown }).message === "string"
            ? (error as { message: string }).message
            : "Order failed.",
      }
    : {
        message: "Order failed.",
      };
}

function toBuyerOrderError(message: string | undefined) {
  if (
    message === "Insufficient inventory quantity available." ||
    message === "One or more checkout items are unavailable." ||
    message === "One or more items are no longer available."
  ) {
    return "That quantity is no longer available. Please review your cart and try again.";
  }

  if (message === "This store is currently unavailable.") {
    return "This storefront is not accepting orders right now.";
  }

  if (message?.includes("required") || message?.includes("invalid")) {
    return "Please check your contact details and try again.";
  }

  return "We could not place this order. Please try again.";
}

function formatCartAvailability(availableDate: string) {
  if (!availableDate) return "Available now";

  const today = new Date();
  const normalizedToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const availability = new Date(`${availableDate}T00:00:00`);

  if (availability <= normalizedToday) return "Available now";

  return `Available ${formatDate(availableDate)}`;
}
