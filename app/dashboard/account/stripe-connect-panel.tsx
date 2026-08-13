"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type ConnectionState = "not_connected" | "incomplete" | "active" | "restricted";
type StatusResponse = {
  state?: ConnectionState;
  dashboard_url?: string | null;
  onboarding_url?: string | null;
};

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
    description: "Stripe manages your payments, payouts, verification, refunds, and disputes.",
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: functionError } = await supabase.functions.invoke<StatusResponse>(
      "stripe-connect-account",
      { body: { action: "status" } },
    );
    if (functionError || !data?.state) {
      setError("Card payment status is temporarily unavailable.");
    } else {
      setState(data.state);
      setDashboardUrl(data.dashboard_url ?? null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timeout);
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
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-stone-950">{copy.title}</p>
            <p className="mt-0.5 max-w-2xl text-sm leading-5 text-stone-600">{copy.description}</p>
            {error ? <p className="mt-1 text-sm text-red-700">{error}</p> : null}
          </div>
          {state === "active" ? (
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
    </section>
  );
}
