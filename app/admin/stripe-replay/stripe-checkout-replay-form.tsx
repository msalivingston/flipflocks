"use client";

import { FormEvent, useState } from "react";
import { supabase } from "@/lib/supabase";
import { AdminCard } from "../_components/admin-ui";

type ReplayResponse = {
  result: string;
  conflict_code: string | null;
  customer_binding_exists: boolean;
  subscription_enrollment_exists: boolean;
  trial_claim_exists: boolean;
  lifecycle_state: string;
};

function isReplayResponse(value: unknown): value is ReplayResponse {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return typeof result.result === "string" &&
    (result.conflict_code === null || typeof result.conflict_code === "string") &&
    typeof result.customer_binding_exists === "boolean" &&
    typeof result.subscription_enrollment_exists === "boolean" &&
    typeof result.trial_claim_exists === "boolean" &&
    typeof result.lifecycle_state === "string";
}

export function StripeCheckoutReplayForm() {
  const [eventId, setEventId] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReplayResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = eventId.trim();
    if (!/^evt_[A-Za-z0-9]+$/.test(normalized)) {
      setMessage("Enter the verified Stripe event ID.");
      return;
    }
    setBusy(true);
    setResult(null);
    setMessage(null);
    const { data, error } = await supabase.functions.invoke(
      "stripe-saas-replay-checkout-event",
      { body: { event_id: normalized } },
    );
    setBusy(false);
    if (error || !isReplayResponse(data)) {
      setMessage("The verified enrollment replay could not be completed.");
      return;
    }
    setEventId("");
    setResult(data);
  }

  return (
    <AdminCard>
      <form className="space-y-5 p-5" onSubmit={submit}>
        <div>
          <h2 className="text-lg font-bold text-stone-950">
            Verified Checkout event
          </h2>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            This temporary action accepts only the known event ID. Customer,
            subscription, Checkout, account, and payment evidence remain
            server-derived.
          </p>
        </div>
        <label className="block">
          <span className="text-sm font-bold text-stone-800">Event ID</span>
          <input
            autoComplete="off"
            className="mt-2 w-full rounded-lg border border-stone-300 px-3 py-3 font-mono text-sm text-stone-950 outline-none focus:border-[#145447] focus:ring-2 focus:ring-[#145447]/20"
            disabled={busy}
            name="event_id"
            onChange={(event) => setEventId(event.target.value)}
            placeholder="evt_..."
            required
            spellCheck={false}
            type="text"
            value={eventId}
          />
        </label>
        <button
          className="seller-primary-button min-h-11 rounded-lg px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
          disabled={busy}
          type="submit"
        >
          {busy ? "Replaying verified enrollment..." : "Replay verified enrollment"}
        </button>
        {message ? (
          <p className="text-sm font-semibold text-red-700" role="alert">
            {message}
          </p>
        ) : null}
        {result ? (
          <div
            className="rounded-lg border border-stone-200 bg-stone-50 p-4 text-sm text-stone-800"
            role="status"
          >
            <p className="font-bold">Result: {result.result}</p>
            <dl className="mt-3 grid gap-2 sm:grid-cols-2">
              <div><dt>Conflict code</dt><dd className="font-semibold">{result.conflict_code ?? "None"}</dd></div>
              <div><dt>Lifecycle state</dt><dd className="font-semibold">{result.lifecycle_state}</dd></div>
              <div><dt>Customer binding</dt><dd className="font-semibold">{result.customer_binding_exists ? "Created" : "Not created"}</dd></div>
              <div><dt>Subscription enrollment</dt><dd className="font-semibold">{result.subscription_enrollment_exists ? "Created" : "Not created"}</dd></div>
              <div><dt>Trial claim</dt><dd className="font-semibold">{result.trial_claim_exists ? "Created" : "Not created"}</dd></div>
            </dl>
          </div>
        ) : null}
      </form>
    </AdminCard>
  );
}
