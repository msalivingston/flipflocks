"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "../../storefront-ui";

type PayAtPickupFormProps = {
  canCheckout: boolean;
  inventoryItemId: string;
  quantityAvailable: number;
  storeSlug: string;
  unitPrice: number;
};

type BuyerForm = {
  buyerEmail: string;
  buyerFirstName: string;
  buyerLastName: string;
  buyerPhone: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  buyerNotes: string;
};

type OrderResponse = {
  order?: {
    created_at?: string | null;
    order_number?: string | null;
    total_amount?: number | string | null;
    currency?: string | null;
  } | null;
};

type ConfirmationState = {
  orderNumber: string | null;
  totalText: string;
} | null;

const initialForm: BuyerForm = {
  buyerEmail: "",
  buyerFirstName: "",
  buyerLastName: "",
  buyerPhone: "",
  addressLine1: "",
  city: "",
  state: "",
  postalCode: "",
  buyerNotes: "",
};

/**
 * Single-item pay-at-pickup starter form for public listings.
 * Final inventory safety remains server-side: the Edge Function and checkout RPC
 * re-check availability and lock inventory before an order can be created.
 */
export function PayAtPickupForm({
  canCheckout,
  inventoryItemId,
  quantityAvailable,
  storeSlug,
  unitPrice,
}: PayAtPickupFormProps) {
  const router = useRouter();
  const maxQuantity = Math.max(0, Math.floor(quantityAvailable));
  const isAvailable = canCheckout && maxQuantity > 0;
  const [form, setForm] = useState<BuyerForm>(initialForm);
  const [quantity, setQuantity] = useState(isAvailable ? 1 : 0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationState>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const selectedQuantity = isAvailable
    ? Math.min(Math.max(quantity, 1), maxQuantity)
    : 0;

  const estimatedTotal = useMemo(
    () => formatCurrency(unitPrice * selectedQuantity),
    [selectedQuantity, unitPrice],
  );

  function updateField(field: keyof BuyerForm, value: string) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function updateQuantity(value: string) {
    const parsed = Number.parseInt(value, 10);

    if (Number.isNaN(parsed)) {
      setQuantity(isAvailable ? 1 : 0);
      return;
    }

    setQuantity(Math.min(Math.max(parsed, isAvailable ? 1 : 0), maxQuantity));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    if (!isAvailable) {
      setErrorMessage("This listing is currently sold out.");
      return;
    }

    if (selectedQuantity < 1 || selectedQuantity > maxQuantity) {
      setErrorMessage(`Please choose between 1 and ${maxQuantity}.`);
      return;
    }

    setIsSubmitting(true);

    const payload = {
      store_slug: storeSlug,
      idempotency_key: createIdempotencyKey(inventoryItemId),
      buyer_email: form.buyerEmail.trim(),
      buyer_first_name: form.buyerFirstName.trim(),
      buyer_last_name: form.buyerLastName.trim(),
      buyer_phone: form.buyerPhone.trim(),
      delivery_address_line1: form.addressLine1.trim(),
      delivery_city: form.city.trim(),
      delivery_state: form.state.trim(),
      delivery_postal_code: form.postalCode.trim(),
      buyer_notes: form.buyerNotes.trim() || null,
      items: [
        {
          inventory_item_id: inventoryItemId,
          quantity: selectedQuantity,
        },
      ],
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
        console.warn(
          "Pay-at-pickup order failed",
          JSON.stringify(
            {
              detail,
              inventoryItemId,
              quantity: selectedQuantity,
              storeSlug,
            },
            null,
            2,
          ),
        );
        setErrorMessage(toBuyerOrderError(detail?.message));
        router.refresh();
        return;
      }

      const orderNumber = data?.order?.order_number;
      const totalAmount = data?.order?.total_amount;
      const totalText = formatOrderTotal(totalAmount, estimatedTotal);

      setConfirmation({
        orderNumber: orderNumber ?? null,
        totalText,
      });
      setForm(initialForm);
      setQuantity(1);
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!isAvailable) {
    return (
      <section className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
        <h2 className="font-semibold text-stone-950">Checkout</h2>
        <p className="mt-2 text-sm leading-6 text-stone-600">
          This listing is currently sold out, so orders are paused for now.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
      <h2 className="font-semibold text-stone-950">Request pickup order</h2>
      <p className="mt-2 text-sm leading-6 text-stone-600">
        Choose how many you want, then share your contact details for pickup.
      </p>

      {confirmation ? (
        <ConfirmationPanel confirmation={confirmation} />
      ) : null}

      {errorMessage ? (
        <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm leading-6 text-rose-800">
          {errorMessage}
        </div>
      ) : null}

      <form className="mt-4 grid gap-4" onSubmit={handleSubmit}>
        <label className="grid gap-1 text-sm font-semibold text-stone-800">
          Quantity
          <input
            className="min-h-11 rounded-md border border-stone-300 px-3 py-2 text-base font-normal text-stone-950 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-200"
            inputMode="numeric"
            max={maxQuantity}
            min={1}
            name="quantity"
            onChange={(event) => updateQuantity(event.target.value)}
            required
            type="number"
            value={selectedQuantity}
          />
          <span className="text-xs font-normal text-stone-500">
            {maxQuantity} available. Estimated total: {estimatedTotal}
          </span>
        </label>

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

        <TextField
          label="Address line 1"
          name="addressLine1"
          onChange={(value) => updateField("addressLine1", value)}
          value={form.addressLine1}
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

        <label className="grid gap-1 text-sm font-semibold text-stone-800">
          Notes for the seller
          <textarea
            className="min-h-24 rounded-md border border-stone-300 px-3 py-2 text-base font-normal text-stone-950 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-200"
            maxLength={2000}
            name="buyerNotes"
            onChange={(event) => updateField("buyerNotes", event.target.value)}
            value={form.buyerNotes}
          />
          <span className="text-xs font-normal text-stone-500">
            Optional. Use this for pickup questions or timing notes.
          </span>
        </label>

        <button
          className="min-h-11 rounded-md bg-emerald-800 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-900 disabled:cursor-not-allowed disabled:bg-stone-300"
          disabled={isSubmitting || confirmation !== null}
          type="submit"
        >
          {confirmation
            ? "Request sent"
            : isSubmitting
              ? "Sending request..."
              : "Request pickup order"}
        </button>
      </form>
    </section>
  );
}

function ConfirmationPanel({
  confirmation,
}: {
  confirmation: Exclude<ConfirmationState, null>;
}) {
  return (
    <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm leading-6 text-emerald-900">
      <h3 className="font-semibold text-emerald-950">
        Your pickup request has been sent.
      </h3>
      <p className="mt-1">
        The seller received your request and will follow up with pickup details.
        Please save this page or watch your email for confirmation.
      </p>
      <dl className="mt-3 grid gap-1">
        {confirmation.orderNumber ? (
          <div className="flex justify-between gap-3">
            <dt className="font-medium">Order number</dt>
            <dd className="font-semibold">{confirmation.orderNumber}</dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-3">
          <dt className="font-medium">Estimated total</dt>
          <dd className="font-semibold">{confirmation.totalText}</dd>
        </div>
      </dl>
    </div>
  );
}

function TextField({
  label,
  maxLength,
  name,
  onChange,
  type = "text",
  value,
}: {
  label: string;
  maxLength?: number;
  name: string;
  onChange: (value: string) => void;
  type?: "email" | "tel" | "text";
  value: string;
}) {
  return (
    <label className="grid gap-1 text-sm font-semibold text-stone-800">
      {label}
      <input
        className="min-h-11 rounded-md border border-stone-300 px-3 py-2 text-base font-normal text-stone-950 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-200"
        maxLength={maxLength}
        name={name}
        onChange={(event) => onChange(event.target.value)}
        required
        type={type}
        value={value}
      />
    </label>
  );
}

function createIdempotencyKey(inventoryItemId: string) {
  const randomPart =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return `${inventoryItemId}:${randomPart}`;
}

function formatOrderTotal(
  totalAmount: number | string | null | undefined,
  fallback: string,
) {
  const numericTotal =
    typeof totalAmount === "number"
      ? totalAmount
      : typeof totalAmount === "string"
        ? Number(totalAmount)
        : null;

  return typeof numericTotal === "number" && Number.isFinite(numericTotal)
    ? formatCurrency(numericTotal)
    : fallback;
}

async function readFunctionError(error: unknown) {
  const context = error && typeof error === "object"
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
        message: context.statusText || "Order request failed.",
      };
    }
  }

  return error && typeof error === "object"
    ? {
        message:
          typeof (error as { message?: unknown }).message === "string"
            ? (error as { message: string }).message
            : "Order request failed.",
      }
    : {
        message: "Order request failed.",
      };
}

function toBuyerOrderError(message: string | undefined) {
  if (
    message === "Insufficient inventory quantity available." ||
    message === "One or more checkout items are unavailable." ||
    message === "One or more items are no longer available."
  ) {
    return "That quantity is no longer available. Please refresh the listing and try again.";
  }

  if (message === "This store is currently unavailable.") {
    return "This storefront is not accepting orders right now.";
  }

  if (message === "Pickup option is not available for this store.") {
    return "That pickup option is no longer available. Please review the pickup details and try again.";
  }

  if (message?.includes("required") || message?.includes("invalid")) {
    return "Please check your contact details and try again.";
  }

  return "We could not send this order request. Please try again.";
}
