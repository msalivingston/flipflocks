"use client";

import {
  formatBillingDate,
  getCadenceDisplayName,
  getPlanDisplayName,
  getPlanPriceLabel,
  type SellerBillingStatus,
} from "@/lib/saas-billing-status";
import { useSellerBillingStatus } from "../_components/seller-billing-context";

export function SubscriptionBillingPanel() {
  const { error, isLoading, reload, status } = useSellerBillingStatus();

  if (isLoading) {
    return (
      <section className="rounded-lg border border-stone-200 bg-white px-4 py-4" aria-labelledby="subscription-billing-heading">
        <h2 className="text-base font-bold text-stone-950" id="subscription-billing-heading">Plan &amp; billing</h2>
        <p className="mt-2 text-sm text-stone-600" role="status">Loading billing status…</p>
      </section>
    );
  }

  if (error || !status) {
    return (
      <section className="rounded-lg border border-red-200 bg-red-50 px-4 py-4" aria-labelledby="subscription-billing-heading">
        <h2 className="text-base font-bold text-stone-950" id="subscription-billing-heading">Plan &amp; billing</h2>
        <p className="mt-2 text-sm font-semibold text-red-900">We could not confirm your billing status. Please contact support.</p>
        <button className="seller-secondary-button mt-3" onClick={() => void reload()} type="button">Try again</button>
      </section>
    );
  }

  const presentation = getBillingPresentation(status);
  const effectivePlan = getPlanDisplayName(status.effective_plan_key);
  const requestedPlan = getPlanDisplayName(status.requested_plan_key);
  const cadence = getCadenceDisplayName(status.effective_billing_cadence);
  const requestedCadence = getCadenceDisplayName(status.requested_billing_cadence);
  const price = getPlanPriceLabel(status.effective_plan_key, status.effective_billing_cadence);
  const requestedDiffers = Boolean(
    requestedPlan && (
      status.requested_plan_key !== status.effective_plan_key ||
      status.requested_billing_cadence !== status.effective_billing_cadence
    ),
  );

  const rows: Array<[string, string | null]> = [
    ["Status", presentation.label],
    ["Current plan", effectivePlan],
    ["Billing", cadence],
    ["Price", price],
    requestedDiffers ? ["Selected plan", requestedPlan] : ["Selected plan", null],
    requestedDiffers ? ["Selected billing", requestedCadence] : ["Selected billing", null],
    ["Trial ends", status.lifecycle_state.includes("trial") ? formatBillingDate(status.trial_ends_at) : null],
    ["Access active through", formatBillingDate(status.paid_through_at)],
    ["Grace ends", formatBillingDate(status.grace_ends_at, { includeTime: true })],
    ["Scheduled to end", status.cancel_at_period_end ? formatBillingDate(status.entitlement_access_until) : null],
    ["Complimentary access ends", formatBillingDate(status.complimentary_access_ends_at)],
  ];

  return (
    <section className="rounded-lg border border-stone-200 bg-white px-4 py-4" aria-labelledby="subscription-billing-heading">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-bold text-stone-950" id="subscription-billing-heading">Plan &amp; billing</h2>
          <p className="mt-1 text-sm leading-6 text-stone-600">{presentation.description}</p>
        </div>
        <span className={`w-fit rounded-full px-3 py-1 text-xs font-bold ${presentation.badgeClass}`}>
          {presentation.label}
        </span>
      </div>
      <dl className="mt-4 grid gap-3 border-t border-stone-200 pt-4 sm:grid-cols-2">
        {rows.filter(([, value]) => value).map(([label, value]) => (
          <div className="min-w-0" key={label}>
            <dt className="text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</dt>
            <dd className="mt-1 break-words text-sm font-semibold text-stone-950">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function getBillingPresentation(status: SellerBillingStatus) {
  switch (status.lifecycle_state) {
    case "trial_active":
      return present("Trial", "Your 7-day FlockFront trial is active.", "bg-emerald-100 text-emerald-900");
    case "trial_payment_problem":
      return present("Payment needs attention", "Your trial is active, but your payment method needs attention before billing begins.", "bg-amber-100 text-amber-950");
    case "active_paid":
      return present("Active", "Your FlockFront subscription is active.", "bg-emerald-100 text-emerald-900");
    case "payment_failed_paid_through":
      return present("Payment needs attention", "Payment was unsuccessful, but your existing paid access remains active through the date shown.", "bg-amber-100 text-amber-950");
    case "payment_grace":
      return present("Grace period", "Payment remains unresolved. Selling access will pause at the grace deadline unless payment succeeds.", "bg-amber-100 text-amber-950");
    case "suspended_nonpayment":
      return present("Suspended", "Selling features are paused because the subscription is unpaid. Your listings and account data remain safe.", "bg-red-100 text-red-950");
    case "canceling_at_period_end":
      return present("Canceling", "Your subscription will not renew. Access continues through the proven paid period shown.", "bg-sky-100 text-sky-950");
    case "fully_canceled":
      return present("Canceled", "This subscription has ended. Your account data remains safe.", "bg-stone-200 text-stone-900");
    case "checkout_required":
      return present("Checkout required", "Your plan selection is saved. Secure Checkout must be completed before billing access can begin.", "bg-sky-100 text-sky-950");
    case "checkout_in_progress":
      return present("Checkout in progress", "Secure Checkout has started, but no billing access has been confirmed.", "bg-sky-100 text-sky-950");
    case "checkout_canceled":
      return present("Checkout not completed", "Your plan selection is saved, but no subscription was confirmed.", "bg-stone-200 text-stone-900");
    case "awaiting_stripe_confirmation":
      return present("Confirming", "Stripe is still confirming your subscription. No access is granted until confirmation arrives.", "bg-sky-100 text-sky-950");
    case "payment_pending_no_trial":
      return present("Payment pending", "Your enrollment is recorded, but access waits for Stripe to confirm a successful payment.", "bg-amber-100 text-amber-950");
    case "complimentary_access":
      return present("Complimentary access", "Your access is complimentary. No recurring Stripe charge is active.", "bg-emerald-100 text-emerald-900");
    case "administrative_hold":
      return present("Account needs support", "Selling access is paused. Contact support for help; your account data remains safe.", "bg-red-100 text-red-950");
    case "selection_required":
      return present("Plan needed", "Choose a FlockFront plan to continue setup.", "bg-stone-200 text-stone-900");
    case "unknown":
      return present("Status unavailable", "We could not confirm your billing status. Please contact support.", "bg-red-100 text-red-950");
    default:
      return present("Status unavailable", "We could not confirm your billing status. Please contact support.", "bg-red-100 text-red-950");
  }
}

function present(label: string, description: string, badgeClass: string) {
  return { badgeClass, description, label };
}
