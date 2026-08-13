"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type ConnectionState = "not_connected" | "incomplete" | "active" | "restricted";
type StatusResponse = {
  state?: ConnectionState;
  dashboard_url?: string | null;
  onboarding_url?: string | null;
};

const RETURN_STATUS_RECHECK_INTERVAL_MS = 5_000;
const RETURN_STATUS_RECHECK_LIMIT = 6;

const stateCopy: Record<ConnectionState, { title: string; description: string }> = {
  not_connected: {
    title: "Not connected",
    description: "Set up Stripe to accept card payments from storefront customers.",
  },
  incomplete: {
    title: "Setup incomplete",
    description: "Continue Stripe’s secure setup before customers can pay by card.",
  },
  active: {
    title: "Card payments ready",
    description: "Customers can pay you by card at checkout. Payments go directly to your Stripe account, and FlockFront does not take a percentage of your sales.",
  },
  restricted: {
    title: "Stripe needs information",
    description: "Visit Stripe to resolve the account requirement. Pay at Pickup remains available.",
  },
};

export function StripeConnectPanel() {
  const [state, setState] = useState<ConnectionState | null>(null);
  const [dashboardUrl, setDashboardUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [returnedFromStripe, setReturnedFromStripe] = useState(false);

  const load = useCallback(async (showLoading = true): Promise<ConnectionState | null> => {
    if (showLoading) setLoading(true);
    setError(null);
    const { data, error: functionError } = await supabase.functions.invoke<StatusResponse>(
      "stripe-connect-account",
      { body: { action: "status" } },
    );
    if (functionError || !data?.state) {
      setError("Card payment status is temporarily unavailable.");
      if (showLoading) setLoading(false);
      return null;
    } else {
      setState(data.state);
      setDashboardUrl(data.dashboard_url ?? null);
    }
    if (showLoading) setLoading(false);
    return data.state;
  }, []);

  useEffect(() => {
    const isStripeReturn = new URLSearchParams(window.location.search).get("stripe") === "return";
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
      ) return;

      recheckCount += 1;
      recheckTimeout = window.setTimeout(
        () => { void checkStatus(false); },
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
    const { data, error: functionError } = await supabase.functions.invoke<StatusResponse>(
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

  const copy = state ? stateCopy[state] : null;
  const isStripeReturnPending = returnedFromStripe && state !== "active";
  const statusTone = state === "active"
    ? "bg-emerald-100 text-emerald-900"
    : isStripeReturnPending || state === "restricted"
    ? "bg-amber-100 text-amber-950"
    : "bg-stone-100 text-stone-800";
  const statusDotTone = state === "active"
    ? "bg-emerald-600"
    : isStripeReturnPending || state === "restricted"
    ? "bg-amber-500"
    : "bg-stone-400";
  return (
    <section className="rounded-lg border border-stone-200 bg-white px-4 py-3 sm:px-5">
      <h2 className="text-lg font-semibold text-stone-950">Customer card payments</h2>
      {loading ? (
        <p className="mt-2 text-sm text-stone-600">Checking Stripe status…</p>
      ) : error && !copy ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-red-700">{error}</p>
          <button className="seller-secondary-button" type="button" onClick={() => void load()}>Try again</button>
        </div>
      ) : copy && state ? (
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
          <div className="min-w-0">
            <p className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-sm font-semibold ${statusTone}`}>
              <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${statusDotTone}`} />
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
            <button className="seller-secondary-button shrink-0 justify-center" type="button" onClick={() => void load()}>
              Refresh status
            </button>
          ) : state === "active" ? (
            <a className="seller-secondary-button shrink-0 justify-center" href={dashboardUrl ?? "https://dashboard.stripe.com/"} target="_blank" rel="noreferrer">
              Open Stripe Dashboard
            </a>
          ) : (
            <button className="seller-primary-button shrink-0 justify-center" disabled={opening} type="button" onClick={() => void openStripeSetup()}>
              {opening ? "Opening Stripe…" : state === "not_connected" ? "Set up Stripe" : "Continue Stripe setup"}
            </button>
          )}
        </div>
      ) : null}

      <details className="group mt-4 border-t border-stone-200 pt-3">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-stone-800 marker:hidden">
          <span>How card payments work</span>
          <span aria-hidden="true" className="text-stone-400 transition group-open:rotate-180">▾</span>
        </summary>
        <div className="mt-4 max-w-3xl space-y-5 text-sm leading-6 text-stone-700">
          <div>
            <h3 className="text-base font-semibold text-stone-950">Set Up Credit Card Payments</h3>
            <p className="mt-2">
              FlockFront lets you accept credit and debit card payments directly through Stripe.
            </p>
            <p className="mt-2">
              Your customers pay your business directly. FlockFront does <strong>not</strong> take a percentage of your sales or add a transaction fee. Stripe charges its normal payment-processing fees directly to your Stripe account.
            </p>
            <p className="mt-2">
              <a className="font-semibold text-amber-800 underline decoration-amber-300 underline-offset-2 hover:text-amber-950" href="https://stripe.com/pricing" target="_blank" rel="noreferrer">
                View Stripe’s current pricing and processing fees
              </a>
            </p>
          </div>

          <div>
            <h3 className="text-base font-semibold text-stone-950">How to set up card payments</h3>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>Sign in to FlockFront and go to Account.</li>
              <li>Find Customer card payments and click Set up Stripe.</li>
              <li>FlockFront will send you to Stripe’s secure website to complete your payment setup.</li>
              <li>Complete the information Stripe requests. Stripe handles your identity verification, banking information, payouts, and payment account directly.</li>
              <li>When you finish, Stripe will return you to FlockFront.</li>
              <li>Stripe may need a few minutes to finish verifying your account. You do not need to complete the setup process again.</li>
              <li>Wait a few minutes and refresh your FlockFront Account page. When everything is ready, you will see Card payments ready.</li>
            </ol>
            <p className="mt-2">
              Once card payments are ready, customers checking out from your storefront can choose to pay by card or use Pay at Pickup when that option is available.
            </p>
          </div>

          <div>
            <h3 className="text-base font-semibold text-stone-950">Already use Stripe?</h3>
            <p className="mt-2">
              You can use your existing Stripe login during setup. Stripe may still ask you to confirm or re-enter some information for the Stripe account connected to your FlockFront store.
            </p>
            <p className="mt-2">
              Your FlockFront sales stay in your own Stripe account. You can use Stripe to view payments, manage payouts, issue refunds, update banking information, and handle other payment-related tasks.
            </p>
          </div>

          <div>
            <h3 className="text-base font-semibold text-stone-950">Fees</h3>
            <p className="mt-2">
              FlockFront does not receive any portion of Stripe’s processing fees and does not collect a percentage of your customer sales.
            </p>
            <p className="mt-2">
              Stripe deducts its applicable processing fees from your payments. Because Stripe’s pricing may change or vary by payment method, always check Stripe’s current pricing page for the latest information.
            </p>
            <p className="mt-2">
              <a className="font-semibold text-amber-800 underline decoration-amber-300 underline-offset-2 hover:text-amber-950" href="https://stripe.com/pricing" target="_blank" rel="noreferrer">
                View Stripe Pricing
              </a>
            </p>
          </div>
        </div>
      </details>
    </section>
  );
}
