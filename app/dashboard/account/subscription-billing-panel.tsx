"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getBillingManagementAvailability } from "@/lib/saas-billing-management";
import {
  formatBillingDate,
  getCadenceDisplayName,
  getPlanDisplayName,
  getPlanPriceLabel,
  isSafeStripePortalUrl,
  type SellerBillingStatus,
} from "@/lib/saas-billing-status";
import { useSellerBillingStatus } from "../_components/seller-billing-context";

type DowngradeInventoryRow = {
  inventory_item_id: string;
  breed_display_name: string;
  species_name: string;
  inventory_type: string;
  quantity_available: number;
  bird_units: number;
  effective_unit_price: number | null;
  inventory_visibility_status: string;
  listing_batch_visibility_status: string;
};

export function SubscriptionBillingPanel() {
  const { error, isLoading, reload, status } = useSellerBillingStatus();
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [confirmingPlanChange, setConfirmingPlanChange] = useState<"upgrade" | "downgrade" | null>(null);
  const [downgradeInventory, setDowngradeInventory] = useState<DowngradeInventoryRow[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const actionInFlight = useRef(false);
  const pollingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("billing") !== "portal_return") return;
    let active = true;
    let polls = 0;
    const poll = async () => {
      if (!active || polls >= 5) return;
      polls += 1;
      await reload();
      if (!active) return;
      if (polls < 5) {
        pollingTimer.current = setTimeout(poll, 2_000);
      }
    };
    void poll();
    return () => {
      active = false;
      if (pollingTimer.current) clearTimeout(pollingTimer.current);
    };
  }, [reload]);

  useEffect(() => () => {
    if (pollingTimer.current) clearTimeout(pollingTimer.current);
  }, []);

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
  const pendingPlan = getPlanDisplayName(status.pending_plan_key);
  const pendingCadence = getCadenceDisplayName(status.pending_billing_cadence);

  const rows: Array<[string, string | null]> = [
    ["Status", presentation.label],
    ["Current plan", effectivePlan],
    ["Billing", cadence],
    ["Price", price],
    requestedDiffers ? ["Selected plan", requestedPlan] : ["Selected plan", null],
    requestedDiffers ? ["Selected billing", requestedCadence] : ["Selected billing", null],
    ["Trial ends", ["stripe_trial", "trial"].includes(status.entitlement_reason ?? "")
      ? formatBillingDate(status.trial_ends_at)
      : null],
    ["Access active through", formatBillingDate(status.paid_through_at)],
    ["Grace ends", formatBillingDate(status.grace_ends_at, { includeTime: true })],
    ["Scheduled to end", status.cancel_at_period_end ? formatBillingDate(status.entitlement_access_until) : null],
    ["Complimentary access ends", formatBillingDate(status.complimentary_access_ends_at)],
    ["Scheduled plan", status.pending_plan_change_status === "scheduled" ? pendingPlan : null],
    ["Scheduled billing", status.pending_plan_change_status === "scheduled" ? pendingCadence : null],
    ["Scheduled effective date", formatBillingDate(status.pending_effective_at)],
  ];

  const management = getBillingManagementAvailability(status);
  const activeThrough = formatBillingDate(status.entitlement_access_until) ??
    "the end of your confirmed access period";

  async function openPortal(
    action: "manage_billing" | "update_payment_method" | "invoice_history" | "cancel_subscription",
    control: string = action,
  ) {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setActionError(false);
    setActiveAction(control);
    try {
      const { data, error: requestError } = await supabase.functions.invoke<{ portal_url?: string }>(
        "stripe-saas-portal",
        { body: { action } },
      );
      if (requestError || !isSafeStripePortalUrl(data?.portal_url)) {
        actionInFlight.current = false;
        setActionError(true);
        setActiveAction(null);
        return;
      }
      window.location.assign(data.portal_url);
    } catch {
      actionInFlight.current = false;
      setActionError(true);
      setActiveAction(null);
    }
  }

  function pollBillingStatus() {
    if (pollingTimer.current) clearTimeout(pollingTimer.current);
    let polls = 0;
    const poll = async () => {
      polls += 1;
      await reload();
      if (polls < 8) pollingTimer.current = setTimeout(poll, 2_000);
    };
    pollingTimer.current = setTimeout(poll, 500);
  }

  async function requestPlanChange(targetPlanKey: "small_flock" | "full_flock") {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setActionError(false);
    setActiveAction("change_plan");
    try {
      const { error: requestError } = await supabase.functions.invoke(
        "stripe-saas-subscription-action",
        { body: {
          action: "change_plan",
          target_plan_key: targetPlanKey,
          target_billing_cadence: "monthly",
        } },
      );
      if (requestError) throw requestError;
      setConfirmingPlanChange(null);
      pollBillingStatus();
    } catch {
      setActionError(true);
    } finally {
      actionInFlight.current = false;
      setActiveAction(null);
    }
  }

  async function openDowngradeConfirmation() {
    setInventoryLoading(true);
    setActionError(false);
    try {
      const { data, error: inventoryError } = await supabase.rpc(
        "seller_get_saas_downgrade_inventory_preview",
      );
      if (inventoryError || !Array.isArray(data)) throw inventoryError;
      setDowngradeInventory(data as DowngradeInventoryRow[]);
      setConfirmingPlanChange("downgrade");
    } catch {
      setActionError(true);
    } finally {
      setInventoryLoading(false);
    }
  }

  async function cancelScheduledChange() {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setActiveAction("cancel_scheduled_change");
    setActionError(false);
    try {
      const { error: requestError } = await supabase.functions.invoke(
        "stripe-saas-subscription-action",
        { body: { action: "cancel_scheduled_change" } },
      );
      if (requestError) throw requestError;
      pollBillingStatus();
    } catch {
      setActionError(true);
    } finally {
      actionInFlight.current = false;
      setActiveAction(null);
    }
  }

  const canUpgrade = status.subscription_changes_available &&
    status.effective_plan_key === "small_flock" &&
    status.effective_billing_cadence === "monthly" &&
    !status.pending_plan_change_status;
  const canDowngrade = status.subscription_changes_available &&
    status.effective_plan_key === "full_flock" &&
    status.effective_billing_cadence === "monthly" &&
    !status.pending_plan_change_status;

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
      {actionError ? (
        <p className="mt-4 text-sm font-semibold text-red-800" role="alert">
          We could not complete that billing request. Please try again.
        </p>
      ) : null}
      {status.pending_payment_required ? (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3" role="status">
          <p className="text-sm font-semibold text-amber-950">Your Market upgrade is waiting for Stripe payment confirmation. Coop remains your current plan.</p>
          <button className="seller-secondary-button mt-3" disabled={Boolean(activeAction)} onClick={() => void openPortal("manage_billing")} type="button">
            Manage payment &amp; invoice
          </button>
        </div>
      ) : null}
      {canUpgrade ? (
        <div className="mt-4 border-t border-stone-200 pt-4">
          <p className="text-sm font-semibold text-stone-950">Upgrade to Market monthly</p>
          <p className="mt-1 text-sm leading-6 text-stone-600">Stripe will prorate the rest of this billing period and charge the difference. Coop stays active until payment and the Market Price are verified.</p>
          <button className="seller-primary-button mt-3" disabled={Boolean(activeAction)} onClick={() => setConfirmingPlanChange("upgrade")} type="button">Review upgrade</button>
        </div>
      ) : null}
      {canDowngrade ? (
        <div className="mt-4 border-t border-stone-200 pt-4">
          <p className="text-sm font-semibold text-stone-950">Downgrade to Coop monthly</p>
          <p className="mt-1 text-sm leading-6 text-stone-600">Market remains active through the current paid period. Live-poultry quantities reset to zero only when Coop takes effect.</p>
          <button className="seller-secondary-button mt-3" disabled={Boolean(activeAction) || inventoryLoading} onClick={() => void openDowngradeConfirmation()} type="button">
            {inventoryLoading ? "Loading inventory…" : "Review downgrade"}
          </button>
        </div>
      ) : null}
      {status.scheduled_change_cancelable ? (
        <div className="mt-4 rounded-md border border-sky-300 bg-sky-50 p-3" role="status">
          <p className="text-sm font-semibold text-sky-950">Market remains current. Coop monthly is scheduled for {formatBillingDate(status.pending_effective_at) ?? "the current paid-period boundary"}.</p>
          <button className="seller-secondary-button mt-3" disabled={Boolean(activeAction)} onClick={() => void cancelScheduledChange()} type="button">
            {activeAction === "cancel_scheduled_change" ? "Canceling…" : "Cancel scheduled change"}
          </button>
        </div>
      ) : null}
      {confirmingPlanChange === "upgrade" ? (
        <div className="mt-4 rounded-md border border-emerald-300 bg-emerald-50 p-3" role="group" aria-label="Confirm Market upgrade">
          <p className="text-sm font-semibold text-emerald-950">Upgrade from Coop monthly to Market monthly now?</p>
          <p className="mt-1 text-sm leading-6 text-emerald-900">The change completes only after Stripe successfully collects the prorated charge.</p>
          <div className="mt-3 flex gap-2">
            <button className="seller-primary-button" disabled={Boolean(activeAction)} onClick={() => void requestPlanChange("full_flock")} type="button">{activeAction === "change_plan" ? "Confirming…" : "Confirm upgrade"}</button>
            <button className="seller-secondary-button" disabled={Boolean(activeAction)} onClick={() => setConfirmingPlanChange(null)} type="button">Not now</button>
          </div>
        </div>
      ) : null}
      {confirmingPlanChange === "downgrade" ? (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3" role="group" aria-label="Confirm Coop downgrade">
          <p className="text-sm font-semibold text-amber-950">Your current live-poultry inventory</p>
          <p className="mt-1 text-sm leading-6 text-amber-900">When Coop takes effect, all quantities below become zero. Listings, photos, descriptions, prices, visibility, and history stay saved.</p>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead><tr><th className="pr-4">Listing</th><th className="pr-4">Type</th><th>Quantity</th></tr></thead>
              <tbody>{downgradeInventory.map((item) => (
                <tr key={item.inventory_item_id}><td className="pr-4">{item.breed_display_name}</td><td className="pr-4">{item.inventory_type}</td><td>{item.quantity_available}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <p className="mt-2 text-sm font-semibold text-amber-950">Total bird units: {downgradeInventory.reduce((total, item) => total + item.bird_units, 0)}</p>
          <button className="seller-secondary-button mt-3" onClick={() => downloadInventoryCsv(downgradeInventory)} type="button">Download inventory CSV</button>
          <div className="mt-3 flex gap-2">
            <button className="seller-primary-button" disabled={Boolean(activeAction)} onClick={() => void requestPlanChange("small_flock")} type="button">{activeAction === "change_plan" ? "Scheduling…" : "Schedule downgrade"}</button>
            <button className="seller-secondary-button" disabled={Boolean(activeAction)} onClick={() => setConfirmingPlanChange(null)} type="button">Not now</button>
          </div>
        </div>
      ) : null}
      {management.manageBilling ? (
        <div className="mt-5 flex flex-col gap-2 border-t border-stone-200 pt-4 sm:flex-row sm:flex-wrap">
          <button className={billingActionButtonClass("seller-secondary-button")} disabled={Boolean(activeAction)} onClick={() => void openPortal("manage_billing")} type="button">
            {activeAction === "manage_billing" ? "Opening…" : "Manage billing & invoices"}
          </button>
          {management.updatePaymentMethod ? (
            <button className={billingActionButtonClass("seller-secondary-button")} disabled={Boolean(activeAction)} onClick={() => void openPortal("update_payment_method")} type="button">
              {activeAction === "update_payment_method" ? "Opening…" : "Update payment method"}
            </button>
          ) : null}
          {management.cancelSubscription && !confirmingCancel ? (
            <button className={billingActionButtonClass("seller-secondary-button")} disabled={Boolean(activeAction)} onClick={() => setConfirmingCancel(true)} type="button">
              Cancel subscription
            </button>
          ) : null}
          {management.resumeSubscription ? (
            <button className={billingActionButtonClass("seller-primary-button")} disabled={Boolean(activeAction)} onClick={() => void openPortal("manage_billing", "keep_subscription")} type="button">
              {activeAction === "keep_subscription" ? "Opening…" : "Keep my subscription"}
            </button>
          ) : null}
        </div>
      ) : null}
      {confirmingCancel ? (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3" role="group" aria-labelledby="cancel-subscription-confirmation">
          <p className="text-sm font-semibold leading-6 text-amber-950" id="cancel-subscription-confirmation">
            Canceling stops your next renewal. Your subscription will remain active through {activeThrough}, and your listings and account data will remain saved.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <button className={billingActionButtonClass("seller-secondary-button border-red-300 text-red-800 hover:bg-red-50")} disabled={Boolean(activeAction)} onClick={() => void openPortal("cancel_subscription")} type="button">
              {activeAction === "cancel_subscription" ? "Opening…" : "Continue to cancellation"}
            </button>
            <button className={billingActionButtonClass("seller-secondary-button")} disabled={Boolean(activeAction)} onClick={() => setConfirmingCancel(false)} type="button">
              Keep subscription
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function billingActionButtonClass(baseClass: string) {
  return `${baseClass} min-h-11 enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-50`;
}

function downloadInventoryCsv(rows: DowngradeInventoryRow[]) {
  const escapeCell = (value: string | number | null) => {
    const text = value == null ? "" : String(value);
    const protectedText = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${protectedText.replaceAll('"', '""')}"`;
  };
  const header = [
    "Listing", "Species", "Inventory type", "Quantity", "Bird units",
    "Unit price", "Inventory visibility", "Listing visibility",
  ];
  const lines = [
    header.map(escapeCell).join(","),
    ...rows.map((row) => [
      row.breed_display_name,
      row.species_name,
      row.inventory_type,
      row.quantity_available,
      row.bird_units,
      row.effective_unit_price,
      row.inventory_visibility_status,
      row.listing_batch_visibility_status,
    ].map(escapeCell).join(",")),
  ];
  const blob = new Blob([`\uFEFF${lines.join("\r\n")}\r\n`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "flockfront-live-poultry-before-coop-downgrade.csv";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function getBillingPresentation(status: SellerBillingStatus) {
  switch (status.lifecycle_state) {
    case "trial_active":
      return present("Trial", "Your 7-day FlockFront trial is active.", "bg-emerald-100 text-emerald-900");
    case "trial_payment_problem":
      return present("Payment needs attention", "Your trial is active, but your payment method needs attention before billing begins.", "bg-amber-100 text-amber-950");
    case "trial_canceling_at_period_end":
      return present("Trial ending", "Your trial remains active through the verified trial end shown. You can keep your subscription before it ends.", "bg-sky-100 text-sky-950");
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
