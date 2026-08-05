"use client";

import { useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { AdminCard } from "../_components/admin-ui";

type ResyncResult = {
  status: "applied" | "already_applied";
  scheduled_cancellation: boolean;
};

function isResyncResult(value: unknown): value is ResyncResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return ["applied", "already_applied"].includes(String(result.status)) &&
    typeof result.scheduled_cancellation === "boolean";
}

export function StripeSubscriptionResyncForm() {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ResyncResult | null>(null);
  const [failed, setFailed] = useState(false);

  async function resync() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFailed(false);
    setResult(null);
    const { data, error } = await supabase.functions.invoke(
      "stripe-saas-resync-subscription",
      { body: { action: "resync" } },
    );
    inFlight.current = false;
    setBusy(false);
    if (error || !isResyncResult(data)) {
      setFailed(true);
      return;
    }
    setResult(data);
  }

  return (
    <AdminCard>
      <div className="space-y-5 p-5">
        <div>
          <h2 className="text-lg font-bold text-stone-950">
            Current verified enrollment
          </h2>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            Store, Customer, Subscription, account, mode, Price, Product, and
            environment are derived and verified by the server. This action
            cannot change trial or paid-through authority.
          </p>
        </div>
        <button
          className="seller-primary-button min-h-11 rounded-lg px-5 py-3 text-sm font-bold text-white enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
          disabled={busy}
          onClick={resync}
          type="button"
        >
          {busy ? "Refreshing…" : "Refresh subscription snapshot"}
        </button>
        {failed ? (
          <p className="text-sm font-semibold text-red-700" role="alert">
            The verified subscription snapshot could not be refreshed.
          </p>
        ) : null}
        {result ? (
          <p className="text-sm font-semibold text-stone-800" role="status">
            Snapshot {result.status === "applied" ? "refreshed" : "was already refreshed"}.
            {result.scheduled_cancellation
              ? " The subscription is scheduled to end at its verified boundary."
              : " No scheduled cancellation is present."}
          </p>
        ) : null}
      </div>
    </AdminCard>
  );
}
