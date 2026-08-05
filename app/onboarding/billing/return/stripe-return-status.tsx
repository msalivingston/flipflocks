"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  formatBillingDate,
  getPlanDisplayName,
  getPlanPriceLabel,
  isConfirmedBillingLifecycle,
  isPendingBillingLifecycle,
  parseSellerBillingStatus,
  type SellerBillingStatus,
} from "@/lib/saas-billing-status";

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 30_000;

export function StripeReturnStatus({
  hasSessionHint,
  successHint,
}: {
  hasSessionHint: boolean;
  successHint: boolean;
}) {
  const router = useRouter();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [status, setStatus] = useState<SellerBillingStatus | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [failed, setFailed] = useState(false);
  const validReturnHint = successHint && hasSessionHint;

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!validReturnHint) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    async function poll() {
      if (stopped) return;
      const { data, error } = await supabase.rpc("seller_get_saas_billing_status");
      if (stopped) return;
      if (error) {
        setFailed(true);
        return;
      }
      const next = parseSellerBillingStatus(Array.isArray(data) ? data[0] : null);
      if (!next) {
        setFailed(true);
        return;
      }
      setStatus(next);

      if (isConfirmedBillingLifecycle(next.lifecycle_state)) return;
      if (!shouldContinuePolling(next)) return;
      if (Date.now() >= deadline) {
        setTimedOut(true);
        return;
      }
      timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    }

    void poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [validReturnHint]);

  useEffect(() => {
    if (status && isConfirmedBillingLifecycle(status.lifecycle_state)) {
      router.replace("/onboarding");
    }
  }, [router, status]);

  const content = getReturnContent({ failed, status, timedOut, validReturnHint });

  return (
    <main className="min-h-screen bg-[#fbfaf6] px-5 py-10 sm:px-7 sm:py-16">
      <section className="mx-auto w-full max-w-2xl rounded-2xl border border-stone-200 bg-white px-5 py-7 shadow-sm sm:px-8 sm:py-9">
        <p className="text-xs font-bold uppercase tracking-[0.08em] text-emerald-700">FlockFront billing</p>
        <h1 className="mt-2 font-serif text-3xl font-semibold text-stone-950 outline-none" ref={headingRef} tabIndex={-1}>
          {content.heading}
        </h1>
        <p className="mt-3 text-base leading-7 text-stone-700" aria-live="polite" role="status">
          {content.body}
        </p>
        {content.details.length ? (
          <dl className="mt-6 grid gap-4 rounded-xl bg-stone-50 px-4 py-4 sm:grid-cols-2">
            {content.details.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs font-bold uppercase tracking-wide text-stone-500">{label}</dt>
                <dd className="mt-1 text-sm font-semibold text-stone-950">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {content.pending ? (
          <div className="mt-6 flex items-center gap-3 text-sm font-semibold text-stone-600">
            <span className="size-3 animate-pulse rounded-full bg-emerald-700 motion-reduce:animate-none" aria-hidden="true" />
            Waiting for secure confirmation
          </div>
        ) : null}
        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          <Link className="seller-primary-button min-h-12 justify-center" href="/onboarding">Continue setup</Link>
        </div>
      </section>
    </main>
  );
}

function shouldContinuePolling(status: SellerBillingStatus) {
  return isPendingBillingLifecycle(status.lifecycle_state)
    || status.lifecycle_state === "checkout_required";
}

function getReturnContent({
  failed,
  status,
  timedOut,
  validReturnHint,
}: {
  failed: boolean;
  status: SellerBillingStatus | null;
  timedOut: boolean;
  validReturnHint: boolean;
}) {
  if (!validReturnHint || failed) {
    return result("Subscription not confirmed", "We could not confirm a subscription from this page. No billing access was changed.");
  }
  if (status?.lifecycle_state === "trial_active") {
    const plan = getPlanDisplayName(status.effective_plan_key);
    const trialEnd = formatBillingDate(status.trial_ends_at);
    const price = getPlanPriceLabel(status.effective_plan_key, status.effective_billing_cadence);
    return result("Your 7-day FlockFront trial is active.", "Stripe confirmed your secure enrollment. You were not charged today.", [
      ["Plan", plan],
      ["Trial ends", trialEnd],
      ["Billing after trial", price],
    ]);
  }
  if (status?.lifecycle_state === "active_paid" || status?.lifecycle_state === "canceling_at_period_end") {
    return result("Your FlockFront subscription is active.", "Stripe confirmed your subscription payment.", [
      ["Plan", getPlanDisplayName(status.effective_plan_key)],
      ["Access active through", formatBillingDate(status.entitlement_access_until)],
    ]);
  }
  if (status?.lifecycle_state === "payment_pending_no_trial") {
    return result("Payment confirmation is pending", "Stripe is still confirming payment. Billing access will not change until verified confirmation arrives.");
  }
  if (timedOut) {
    return result("Confirmation is taking longer than expected", "Stripe is still confirming your subscription. You can leave this page and check your Account page shortly.");
  }
  if (status && !shouldContinuePolling(status)) {
    return result("Subscription not confirmed", "We could not confirm a subscription from this page. No billing access was changed.");
  }
  return {
    ...result("Confirming your subscription", "Stripe is confirming your subscription. This usually takes only a few seconds."),
    pending: true,
  };
}

function result(
  heading: string,
  body: string,
  rows: Array<[string, string | null]> = [],
) {
  return {
    body,
    details: rows.filter((row): row is [string, string] => Boolean(row[1])),
    heading,
    pending: false,
  };
}
