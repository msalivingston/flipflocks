"use client";

import Image from "next/image";
import { useState } from "react";
import {
  StripeConnectPanel,
  type StripeConnectionState,
} from "../_components/stripe-connect-panel";

export type PaymentMethodsTabProps = {
  cardPaymentsEnabled: boolean;
  onCardPaymentsEnabledChange: (enabled: boolean) => void;
  onPayAtPickupEnabledChange: (enabled: boolean) => void;
  payAtPickupEnabled: boolean;
};

export default function PaymentMethodsTab({
  cardPaymentsEnabled,
  onCardPaymentsEnabledChange,
  onPayAtPickupEnabledChange,
  payAtPickupEnabled,
}: PaymentMethodsTabProps) {
  const [stripeState, setStripeState] =
    useState<StripeConnectionState | null>(null);
  const hasPaymentMethod = payAtPickupEnabled || cardPaymentsEnabled;
  const stripeReady = stripeState === "active";

  return (
    <div className="grid gap-5">
      <section aria-labelledby="payment-methods-heading" className="grid gap-4">
        <div>
          <h1
            className="text-xl font-bold text-stone-950 sm:text-2xl"
            id="payment-methods-heading"
          >
            Payment Methods
          </h1>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            Choose how customers can pay for orders from your store. At least
            one payment method must be enabled.
          </p>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <PaymentMethodCard
            checked={payAtPickupEnabled}
            description="Customers pay when they pick up their order. Best for cash, check, or other in-person payments."
            glyph="/glyphs/shopping-bag.png"
            onChange={onPayAtPickupEnabledChange}
            title="Pay at Pickup"
          />
          <PaymentMethodCard
            checked={cardPaymentsEnabled}
            description="Customers pay securely by credit or debit card at checkout."
            glyph="/glyphs/storefront.png"
            onChange={onCardPaymentsEnabledChange}
            status={
              cardPaymentsEnabled
                ? stripeReady
                  ? "Stripe ready"
                  : "Stripe setup required"
                : undefined
            }
            statusTone={stripeReady ? "ready" : "warning"}
            title="Pay by Card"
          />
        </div>

        {!hasPaymentMethod ? (
          <div
            aria-live="polite"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800"
            role="alert"
          >
            At least one payment method must be enabled. Select Pay at Pickup,
            Pay by Card, or both before saving.
          </div>
        ) : (
          <PaymentSummary
            cardPaymentsEnabled={cardPaymentsEnabled}
            payAtPickupEnabled={payAtPickupEnabled}
            stripeReady={stripeReady}
          />
        )}
      </section>

      <StripeConnectPanel
        onStateChange={setStripeState}
        payAtPickupEnabled={payAtPickupEnabled}
      />

      <div className="rounded-lg border border-amber-100 bg-amber-50/70 px-4 py-3 text-sm leading-6 text-stone-700">
        <p className="font-semibold text-stone-950">Changes apply to new orders</p>
        <p>These payment choices apply to checkout after you save.</p>
      </div>
    </div>
  );
}

function PaymentMethodCard({
  checked,
  description,
  glyph,
  onChange,
  status,
  statusTone = "ready",
  title,
}: {
  checked: boolean;
  description: string;
  glyph: string;
  onChange: (checked: boolean) => void;
  status?: string;
  statusTone?: "ready" | "warning";
  title: string;
}) {
  return (
    <label
      className={`relative flex min-h-36 cursor-pointer gap-3 rounded-xl border p-4 transition focus-within:ring-2 focus-within:ring-emerald-700 focus-within:ring-offset-2 sm:p-5 ${
        checked
          ? "border-emerald-700 bg-emerald-50/30 shadow-sm"
          : "border-stone-200 bg-white hover:border-stone-300"
      }`}
    >
      <input
        checked={checked}
        className="mt-1 size-5 shrink-0 accent-emerald-800"
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span className="flex min-w-0 gap-3">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-emerald-100/80">
          <Image alt="" height={25} src={glyph} width={25} />
        </span>
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-stone-950">{title}</span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                checked
                  ? "bg-emerald-100 text-emerald-900"
                  : "bg-stone-100 text-stone-600"
              }`}
            >
              {checked ? "Enabled" : "Disabled"}
            </span>
          </span>
          <span className="mt-2 block text-sm leading-6 text-stone-600">
            {description}
          </span>
          {status ? (
            <span
              className={`mt-2 block text-sm font-semibold ${
                statusTone === "ready" ? "text-emerald-800" : "text-amber-800"
              }`}
            >
              {status}
            </span>
          ) : null}
        </span>
      </span>
    </label>
  );
}

function PaymentSummary({
  cardPaymentsEnabled,
  payAtPickupEnabled,
  stripeReady,
}: {
  cardPaymentsEnabled: boolean;
  payAtPickupEnabled: boolean;
  stripeReady: boolean;
}) {
  let title = "Pay at Pickup is enabled";
  let description = "Customers place their order now and pay when they pick it up.";

  if (cardPaymentsEnabled && payAtPickupEnabled) {
    title = "Both payment methods are enabled";
    description = stripeReady
      ? "At checkout, customers can choose to pay by card or pay at pickup."
      : "Pay at Pickup remains available. Card checkout will appear after Stripe is ready.";
  } else if (cardPaymentsEnabled) {
    title = "This store is configured for card payments only";
    description = stripeReady
      ? "Customers must complete Stripe payment before their FlockFront order is created."
      : "Checkout will remain unavailable until the connected Stripe account is ready.";
  }

  return (
    <div className="rounded-lg border border-emerald-100 bg-emerald-50/70 px-4 py-3 text-sm leading-6 text-emerald-950">
      <p className="font-bold">{title}</p>
      <p>{description}</p>
    </div>
  );
}
