"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export type StripeConnectionState =
  | "not_connected"
  | "incomplete"
  | "active"
  | "restricted";

type StatusResponse = {
  state?: StripeConnectionState;
  dashboard_url?: string | null;
  onboarding_url?: string | null;
};

const RETURN_STATUS_RECHECK_INTERVAL_MS = 5_000;
const RETURN_STATUS_RECHECK_LIMIT = 6;

export function StripeConnectPanel({
  onStateChange,
  payAtPickupEnabled,
}: {
  onStateChange?: (state: StripeConnectionState | null) => void;
  payAtPickupEnabled: boolean;
}) {
  const [state, setState] = useState<StripeConnectionState | null>(null);
  const [dashboardUrl, setDashboardUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [returnedFromStripe, setReturnedFromStripe] = useState(false);

  const load = useCallback(
    async (showLoading = true): Promise<StripeConnectionState | null> => {
      if (showLoading) setLoading(true);
      setError(null);
      const { data, error: functionError } =
        await supabase.functions.invoke<StatusResponse>(
          "stripe-connect-account",
          { body: { action: "status" } },
        );

      if (functionError || !data?.state) {
        setError("Card payment status is temporarily unavailable.");
        onStateChange?.(null);
        if (showLoading) setLoading(false);
        return null;
      }

      setState(data.state);
      setDashboardUrl(data.dashboard_url ?? null);
      onStateChange?.(data.state);
      if (showLoading) setLoading(false);
      return data.state;
    },
    [onStateChange],
  );

  useEffect(() => {
    const isStripeReturn =
      new URLSearchParams(window.location.search).get("stripe") === "return";
    let stopped = false;
    let recheckCount = 0;
    let recheckTimeout: number | undefined;

    async function checkStatus(showLoading: boolean) {
      const nextState = await load(showLoading);
      if (
        stopped ||
        !isStripeReturn ||
        nextState === "active" ||
        recheckCount >= RETURN_STATUS_RECHECK_LIMIT
      ) {
        return;
      }

      recheckCount += 1;
      recheckTimeout = window.setTimeout(
        () => void checkStatus(false),
        RETURN_STATUS_RECHECK_INTERVAL_MS,
      );
    }

    const initialTimeout = window.setTimeout(() => {
      if (isStripeReturn) setReturnedFromStripe(true);
      void checkStatus(true);
    }, 0);

    return () => {
      stopped = true;
      window.clearTimeout(initialTimeout);
      if (recheckTimeout !== undefined) window.clearTimeout(recheckTimeout);
    };
  }, [load]);

  async function openStripeSetup() {
    setOpening(true);
    setError(null);
    const { data, error: functionError } =
      await supabase.functions.invoke<StatusResponse>(
        "stripe-connect-account",
        { body: { action: "onboard" } },
      );

    if (functionError || !data?.onboarding_url) {
      setError("Stripe setup could not be opened. Please try again.");
      setOpening(false);
      return;
    }

    window.location.assign(data.onboarding_url);
  }

  const isStripeReturnPending = returnedFromStripe && state !== "active";
  const copy = getStateCopy(state, payAtPickupEnabled);
  const statusTone =
    state === "active"
      ? "bg-emerald-100 text-emerald-900"
      : isStripeReturnPending || state === "restricted"
        ? "bg-amber-100 text-amber-950"
        : "bg-stone-100 text-stone-800";
  const statusDotTone =
    state === "active"
      ? "bg-emerald-600"
      : isStripeReturnPending || state === "restricted"
        ? "bg-amber-500"
        : "bg-stone-400";

  return (
    <section className="rounded-lg border border-stone-200 bg-white px-4 py-4 sm:px-5">
      <h2 className="text-lg font-semibold text-stone-950">
        Customer card payments
      </h2>
      {loading ? (
        <p className="mt-2 text-sm text-stone-600">Checking Stripe status…</p>
      ) : error && !copy ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-red-700">{error}</p>
          <button
            className="seller-secondary-button"
            onClick={() => void load()}
            type="button"
          >
            Try again
          </button>
        </div>
      ) : copy && state ? (
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
          <div className="min-w-0">
            <p
              className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-sm font-semibold ${statusTone}`}
            >
              <span
                aria-hidden="true"
                className={`size-2 shrink-0 rounded-full ${statusDotTone}`}
              />
              {isStripeReturnPending ? "Stripe setup submitted" : copy.title}
            </p>
            <p className="mt-1.5 max-w-2xl text-sm leading-5 text-stone-600">
              {isStripeReturnPending
                ? "Stripe is finishing your setup. This can take a few minutes. You do not need to complete setup again. Refresh this page in a few minutes."
                : copy.description}
            </p>
            {error ? <p className="mt-1 text-sm text-red-700">{error}</p> : null}
          </div>
          {isStripeReturnPending ? (
            <button
              className="seller-secondary-button shrink-0 justify-center"
              onClick={() => void load()}
              type="button"
            >
              Refresh status
            </button>
          ) : state === "active" ? (
            <a
              className="seller-secondary-button shrink-0 justify-center"
              href={dashboardUrl ?? "https://dashboard.stripe.com/"}
              rel="noreferrer"
              target="_blank"
            >
              Open Stripe Dashboard
            </a>
          ) : (
            <button
              className="seller-primary-button shrink-0 justify-center"
              disabled={opening}
              onClick={() => void openStripeSetup()}
              type="button"
            >
              {opening
                ? "Opening Stripe…"
                : state === "not_connected"
                  ? "Set up Stripe"
                  : "Continue Stripe setup"}
            </button>
          )}
        </div>
      ) : null}

      <details className="group mt-4 border-t border-stone-200 pt-3">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-stone-800 marker:hidden">
          <span>How card payments work</span>
          <span
            aria-hidden="true"
            className="text-stone-400 transition group-open:rotate-180"
          >
            ▾
          </span>
        </summary>
        <div className="mt-4 max-w-3xl space-y-5 text-sm leading-6 text-stone-700">
          <div>
            <h3 className="text-base font-semibold text-stone-950">
              Set Up Credit Card Payments
            </h3>
            <p className="mt-2">
              FlockFront lets you accept credit and debit card payments directly
              through Stripe.
            </p>
            <p className="mt-2">
              Your customers pay your business directly. FlockFront does{" "}
              <strong>not</strong> take a percentage of your sales or add a
              transaction fee. Stripe charges its normal payment-processing fees
              directly to your Stripe account.
            </p>
            <p className="mt-2">
              <StripePricingLink>
                View Stripe’s current pricing and processing fees
              </StripePricingLink>
            </p>
          </div>

          <div>
            <h3 className="text-base font-semibold text-stone-950">
              How to set up card payments
            </h3>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>Go to Store Admin and open Payment Methods.</li>
              <li>Select Pay by Card and save your changes.</li>
              <li>Click Set up Stripe.</li>
              <li>
                Complete the information Stripe requests on Stripe’s secure
                website. Stripe handles identity verification, banking, payouts,
                and the connected payment account directly.
              </li>
              <li>When you finish, Stripe will return you to Payment Methods.</li>
              <li>
                Stripe may need a few minutes to finish verification. You do not
                need to complete setup again.
              </li>
              <li>
                Refresh the status until you see Card payments ready.
              </li>
            </ol>
            <p className="mt-2">
              Selecting Pay by Card and Stripe being ready are separate. Buyers
              can pay by card only while both are true.
            </p>
          </div>

          <div>
            <h3 className="text-base font-semibold text-stone-950">
              Already use Stripe?
            </h3>
            <p className="mt-2">
              You can use your existing Stripe login during setup. Stripe may
              still ask you to confirm information for the account connected to
              your FlockFront store.
            </p>
            <p className="mt-2">
              Turning Pay by Card off in FlockFront does not disconnect or delete
              this Stripe account. When you turn it back on, FlockFront checks the
              same account’s current readiness.
            </p>
          </div>

          <div>
            <h3 className="text-base font-semibold text-stone-950">Fees</h3>
            <p className="mt-2">
              FlockFront does not receive any portion of Stripe’s processing fees
              and does not collect a percentage of your customer sales.
            </p>
            <p className="mt-2">
              Stripe deducts its applicable processing fees from your payments.
              Check Stripe’s current pricing page for the latest information.
            </p>
            <p className="mt-2">
              <StripePricingLink>View Stripe Pricing</StripePricingLink>
            </p>
          </div>
        </div>
      </details>
    </section>
  );
}

function getStateCopy(
  state: StripeConnectionState | null,
  payAtPickupEnabled: boolean,
) {
  if (!state) return null;

  if (state === "not_connected") {
    return {
      title: "Not connected",
      description:
        "Set up Stripe before buyers can use the selected Pay by Card option.",
    };
  }

  if (state === "incomplete") {
    return {
      title: "Setup incomplete",
      description:
        "Continue Stripe’s secure setup before buyers can pay by card.",
    };
  }

  if (state === "active") {
    return {
      title: "Card payments ready",
      description:
        "Your connected Stripe account is ready. Buyers can pay by card whenever Pay by Card is enabled and saved.",
    };
  }

  return {
    title: "Stripe needs information",
    description: payAtPickupEnabled
      ? "Visit Stripe to resolve the account requirement. Pay at Pickup can remain available while card payments are restricted."
      : "Visit Stripe to resolve the account requirement. Checkout is unavailable while this card-only store cannot accept online payments.",
  };
}

function StripePricingLink({ children }: { children: React.ReactNode }) {
  return (
    <a
      className="font-semibold text-amber-800 underline decoration-amber-300 underline-offset-2 hover:text-amber-950"
      href="https://stripe.com/pricing"
      rel="noreferrer"
      target="_blank"
    >
      {children}
    </a>
  );
}
