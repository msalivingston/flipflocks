"use client";

import Image from "next/image";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  getPlanCapabilities,
  type PlanId,
} from "@/lib/plan-capabilities";
import type {
  AdminStoreDetailRow,
  AdminStoreOperationsSummaryRow,
} from "../_lib/admin-types";

type DialogState =
  | "disable-storefront"
  | "hold"
  | "grant-comp"
  | "revoke-comp"
  | "note"
  | null;

export function AdminStoreControls({
  onRefresh,
  operations,
  store,
}: {
  onRefresh: () => Promise<void>;
  operations: AdminStoreOperationsSummaryRow;
  store: AdminStoreDetailRow;
}) {
  const [dialog, setDialog] = useState<DialogState>(null);
  const [holdReason, setHoldReason] = useState("");
  const [compReason, setCompReason] = useState("");
  const [compExpiresAt, setCompExpiresAt] = useState("");
  const [note, setNote] = useState(operations.internal_note ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "error" | "success";
    message: string;
  } | null>(null);
  const currentPlan = getPlanCapabilities(
    operations.plan_key ?? operations.requested_plan_key,
  );
  const [compPlan, setCompPlan] = useState<PlanId>(currentPlan.id);
  const hasNote = Boolean(operations.internal_note?.trim());
  const isOnHold = Boolean(store.admin_hold_reason);
  const hasActiveComp =
    operations.has_active_entitlement &&
    operations.entitlement_reason === "admin_comp";

  async function runOperation(
    operation: () => PromiseLike<{ error: { message: string } | null }>,
    successMessage: string,
  ) {
    setIsSubmitting(true);
    setFeedback(null);

    try {
      const { error } = await operation();

      if (error) {
        setFeedback({ tone: "error", message: error.message });
        return false;
      }

      await onRefresh();
      setFeedback({ tone: "success", message: successMessage });
      setDialog(null);
      return true;
    } finally {
      setIsSubmitting(false);
    }
  }

  async function enableStorefront() {
    await runOperation(
      () =>
        supabase.rpc("admin_set_storefront_enabled", {
          p_enabled: true,
          p_store_id: store.store_id,
        }),
      "Storefront enabled.",
    );
  }

  async function disableStorefront() {
    await runOperation(
      () =>
        supabase.rpc("admin_set_storefront_enabled", {
          p_enabled: false,
          p_store_id: store.store_id,
        }),
      "Storefront disabled.",
    );
  }

  async function placeHold() {
    if (!holdReason.trim()) {
      setFeedback({
        tone: "error",
        message: "Enter a short reason before placing this store on hold.",
      });
      return;
    }

    const succeeded = await runOperation(
      () =>
        supabase.rpc("admin_set_store_hold", {
          p_on_hold: true,
          p_reason: holdReason.trim(),
          p_store_id: store.store_id,
        }),
      "Store placed on hold.",
    );

    if (succeeded) setHoldReason("");
  }

  async function removeHold() {
    await runOperation(
      () =>
        supabase.rpc("admin_set_store_hold", {
          p_on_hold: false,
          p_reason: null,
          p_store_id: store.store_id,
        }),
      "Admin hold removed.",
    );
  }

  async function grantComp() {
    if (!compReason.trim() || !compExpiresAt) {
      setFeedback({
        tone: "error",
        message: "Choose a plan, expiration, and reason for the comp.",
      });
      return;
    }

    const succeeded = await runOperation(
      () =>
        supabase.rpc("admin_grant_store_comp", {
          p_expires_at: new Date(compExpiresAt).toISOString(),
          p_plan_key: compPlan,
          p_reason: compReason.trim(),
          p_store_id: store.store_id,
        }),
      `Administrative ${getPlanCapabilities(compPlan).displayName} access granted.`,
    );

    if (succeeded) {
      setCompReason("");
      setCompExpiresAt("");
    }
  }

  async function revokeComp() {
    if (!compReason.trim()) {
      setFeedback({
        tone: "error",
        message: "Enter a reason before revoking the comp.",
      });
      return;
    }

    const succeeded = await runOperation(
      () =>
        supabase.rpc("admin_revoke_store_comp", {
          p_reason: compReason.trim(),
          p_store_id: store.store_id,
        }),
      "Administrative comp revoked.",
    );

    if (succeeded) setCompReason("");
  }

  async function saveNote() {
    await runOperation(
      () =>
        supabase.rpc("admin_update_store_internal_note", {
          p_note: note,
          p_store_id: store.store_id,
        }),
      note.trim() ? "Internal note saved." : "Internal note removed.",
    );
  }

  function openNote() {
    setNote(operations.internal_note ?? "");
    setDialog("note");
  }

  return (
    <>
      <section className="rounded-lg border border-[#ceddd7] bg-white shadow-sm">
        <div className="flex flex-col gap-1 border-b border-stone-100 px-4 py-3 sm:flex-row sm:items-baseline sm:gap-3">
          <h2 className="text-base font-bold text-stone-950">Store Controls</h2>
          <p className="text-xs text-stone-500">
            Use these controls to manage this store.
          </p>
        </div>

        {feedback ? (
          <div
            aria-live="polite"
            className={`mx-3 mt-3 rounded-md border px-3 py-2 text-sm font-semibold ${
              feedback.tone === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-red-200 bg-red-50 text-red-900"
            }`}
          >
            {feedback.message}
          </div>
        ) : null}

        <div className="grid gap-2.5 p-3 md:grid-cols-2 lg:grid-cols-4">
          <ControlCard
            actionLabel={
              store.storefront_enabled
                ? "Disable Storefront"
                : "Enable Storefront"
            }
            icon="/glyphs/storefront.png"
            isSubmitting={isSubmitting}
            label="Storefront"
            onAction={
              store.storefront_enabled
                ? () => setDialog("disable-storefront")
                : enableStorefront
            }
            status={store.storefront_enabled ? "Enabled" : "Disabled"}
            tone={store.storefront_enabled ? "positive" : "neutral"}
          />
          <ControlCard
            actionLabel={isOnHold ? "Remove Hold" : "Place on Hold"}
            icon="/glyphs/shield.png"
            isSubmitting={isSubmitting}
            label="Admin Hold"
            onAction={
              isOnHold ? removeHold : () => setDialog("hold")
            }
            status={isOnHold ? "On hold" : "Not on hold"}
            tone={isOnHold ? "restrictive" : "positive"}
          />
          <ControlCard
            actionLabel={hasActiveComp ? "Revoke Comp" : "Grant Comp"}
            icon="/glyphs/shopping-bag.png"
            isSubmitting={isSubmitting}
            label="Entitlement"
            onAction={() =>
              setDialog(hasActiveComp ? "revoke-comp" : "grant-comp")
            }
            status={
              operations.has_active_entitlement
                ? `${currentPlan.displayName} · Active`
                : "No active access"
            }
            tone={operations.has_active_entitlement ? "positive" : "neutral"}
          />
          <ControlCard
            actionLabel="View / Edit"
            icon="/glyphs/clipboard.png"
            isSubmitting={isSubmitting}
            label="Internal Note"
            onAction={openNote}
            status={hasNote ? "Note saved" : "No note"}
            tone={hasNote ? "positive" : "neutral"}
          />
        </div>
      </section>

      {dialog === "disable-storefront" ? (
        <AdminDialog
          confirmLabel="Disable Storefront"
          isSubmitting={isSubmitting}
          onCancel={() => setDialog(null)}
          onConfirm={disableStorefront}
          restrictive
          title="Disable this storefront?"
        >
          Buyers will no longer be able to access this store through the public
          storefront. This does not change the store status, plan, ownership, or
          seller data.
        </AdminDialog>
      ) : null}

      {dialog === "hold" ? (
        <AdminDialog
          confirmDisabled={!holdReason.trim()}
          confirmLabel="Place on Hold"
          isSubmitting={isSubmitting}
          onCancel={() => setDialog(null)}
          onConfirm={placeHold}
          restrictive
          title="Place this store on hold"
        >
          <p>
            A hold removes the store from public storefront and checkout
            projections. It does not change ownership or the store status.
          </p>
          <label className="mt-4 grid gap-1.5 text-sm font-bold text-stone-800">
            Reason
            <textarea
              autoFocus
              className="min-h-24 rounded-md border border-stone-300 px-3 py-2 font-normal text-stone-950 outline-none focus:border-[#176252] focus:ring-2 focus:ring-[#b8dcd1]"
              maxLength={500}
              onChange={(event) => setHoldReason(event.target.value)}
              placeholder="Brief operational reason"
              required
              value={holdReason}
            />
          </label>
        </AdminDialog>
      ) : null}

      {dialog === "grant-comp" ? (
        <AdminDialog
          confirmDisabled={!compReason.trim() || !compExpiresAt}
          confirmLabel="Grant Comp"
          isSubmitting={isSubmitting}
          onCancel={() => setDialog(null)}
          onConfirm={grantComp}
          title="Grant administrative comp access"
        >
          <p>
            This is an audited, time-limited access grant. It does not create or
            impersonate a Stripe subscription.
          </p>
          <label className="mt-4 grid gap-1.5 text-sm font-bold text-stone-800">
            Plan
            <select
              className="min-h-10 rounded-md border border-stone-300 bg-white px-3 font-normal text-stone-950 outline-none focus:border-[#176252] focus:ring-2 focus:ring-[#b8dcd1]"
              onChange={(event) => setCompPlan(event.target.value as PlanId)}
              value={compPlan}
            >
              <option value="small_flock">Coop</option>
              <option value="full_flock">Market</option>
            </select>
          </label>
          <label className="mt-3 grid gap-1.5 text-sm font-bold text-stone-800">
            Access expires
            <input
              className="min-h-10 rounded-md border border-stone-300 px-3 font-normal text-stone-950 outline-none focus:border-[#176252] focus:ring-2 focus:ring-[#b8dcd1]"
              onChange={(event) => setCompExpiresAt(event.target.value)}
              required
              type="datetime-local"
              value={compExpiresAt}
            />
          </label>
          <label className="mt-3 grid gap-1.5 text-sm font-bold text-stone-800">
            Reason
            <textarea
              className="min-h-24 rounded-md border border-stone-300 px-3 py-2 font-normal text-stone-950 outline-none focus:border-[#176252] focus:ring-2 focus:ring-[#b8dcd1]"
              maxLength={500}
              onChange={(event) => setCompReason(event.target.value)}
              placeholder="Why this store is receiving comped access"
              required
              value={compReason}
            />
          </label>
        </AdminDialog>
      ) : null}

      {dialog === "revoke-comp" ? (
        <AdminDialog
          confirmDisabled={!compReason.trim()}
          confirmLabel="Revoke Comp"
          isSubmitting={isSubmitting}
          onCancel={() => setDialog(null)}
          onConfirm={revokeComp}
          restrictive
          title="Revoke administrative comp access"
        >
          <p>
            Access ends immediately and the storefront is disabled for seller
            review. The original grant and this revocation remain in the audit
            history.
          </p>
          <label className="mt-4 grid gap-1.5 text-sm font-bold text-stone-800">
            Reason
            <textarea
              className="min-h-24 rounded-md border border-stone-300 px-3 py-2 font-normal text-stone-950 outline-none focus:border-[#176252] focus:ring-2 focus:ring-[#b8dcd1]"
              maxLength={500}
              onChange={(event) => setCompReason(event.target.value)}
              placeholder="Why this comp is being revoked"
              required
              value={compReason}
            />
          </label>
        </AdminDialog>
      ) : null}

      {dialog === "note" ? (
        <AdminDialog
          confirmLabel="Save Note"
          isSubmitting={isSubmitting}
          onCancel={() => setDialog(null)}
          onConfirm={saveNote}
          title="Private internal note"
        >
          <p>
            This note is visible only in the platform-admin support area. It is
            never shown to the seller or public storefront.
          </p>
          <label className="mt-4 grid gap-1.5 text-sm font-bold text-stone-800">
            Note
            <textarea
              autoFocus
              className="min-h-36 rounded-md border border-stone-300 px-3 py-2 font-normal text-stone-950 outline-none focus:border-[#176252] focus:ring-2 focus:ring-[#b8dcd1]"
              maxLength={4000}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Private support context"
              value={note}
            />
          </label>
          <p className="mt-1 text-right text-xs font-semibold text-stone-500">
            {note.length}/4000
          </p>
        </AdminDialog>
      ) : null}
    </>
  );
}

function ControlCard({
  actionLabel,
  icon,
  isSubmitting,
  label,
  onAction,
  status,
  tone,
}: {
  actionLabel: string;
  icon: string;
  isSubmitting: boolean;
  label: string;
  onAction: () => void | Promise<void>;
  status: string;
  tone: "neutral" | "positive" | "restrictive";
}) {
  return (
    <div className="flex min-h-28 flex-col rounded-lg border border-stone-200 bg-[#fbfcfb] p-3">
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#e8f4ef]">
          <Image alt="" height={19} src={icon} width={19} />
        </span>
        <div>
          <p className="text-sm font-bold text-stone-950">{label}</p>
          <p
            className={`mt-0.5 text-sm font-bold ${
              tone === "positive"
                ? "text-emerald-700"
                : tone === "restrictive"
                  ? "text-red-700"
                  : "text-stone-600"
            }`}
          >
            {status}
          </p>
        </div>
      </div>
      <button
        className={`mt-3 min-h-9 rounded-md border px-3 text-xs font-bold text-white transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
          tone === "restrictive"
            ? "border-red-700 bg-red-700 hover:bg-red-800 focus-visible:ring-red-300"
            : "border-[#145447] bg-[#145447] hover:bg-[#0f3f35] focus-visible:ring-[#78b5a5]"
        }`}
        disabled={isSubmitting}
        onClick={onAction}
        type="button"
      >
        {actionLabel}
      </button>
    </div>
  );
}

function AdminDialog({
  children,
  confirmDisabled = false,
  confirmLabel,
  isSubmitting,
  onCancel,
  onConfirm,
  restrictive = false,
  title,
}: {
  children: React.ReactNode;
  confirmDisabled?: boolean;
  confirmLabel: string;
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  restrictive?: boolean;
  title: string;
}) {
  return (
    <div
      aria-labelledby="admin-store-dialog-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/45 p-4"
      role="dialog"
    >
      <div className="w-full max-w-lg rounded-xl border border-stone-200 bg-white p-5 shadow-2xl">
        <h2
          className="text-lg font-bold text-stone-950"
          id="admin-store-dialog-title"
        >
          {title}
        </h2>
        <div className="mt-2 text-sm leading-6 text-stone-600">{children}</div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            className="seller-secondary-button min-h-10"
            disabled={isSubmitting}
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
          <button
            className={`min-h-10 rounded-md px-4 text-sm font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${
              restrictive
                ? "bg-red-700 hover:bg-red-800"
                : "bg-[#145447] hover:bg-[#0f3f35]"
            }`}
            disabled={isSubmitting || confirmDisabled}
            onClick={onConfirm}
            type="button"
          >
            {isSubmitting ? "Saving..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
