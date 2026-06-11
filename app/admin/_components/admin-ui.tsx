"use client";

import { useState } from "react";

export function AdminPageHeader({
  action,
  eyebrow,
  title,
  description,
}: {
  action?: React.ReactNode;
  eyebrow?: string;
  title: string;
  description?: string;
}) {
  return (
    <header className="border-b border-stone-200 bg-white">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-5 py-6 sm:px-7 lg:flex-row lg:items-end lg:justify-between">
        <div>
          {eyebrow ? (
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-emerald-800">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="mt-1 text-2xl font-bold text-stone-950">{title}</h1>
          {description ? (
            <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </header>
  );
}

export function AdminCard({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white shadow-sm">
      {children}
    </section>
  );
}

export function AdminLoadingState({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-6 text-sm font-semibold text-stone-600">
      {label}
    </div>
  );
}

export function AdminAccessState({
  message,
  title = "Admin access required",
}: {
  message: string;
  title?: string;
}) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-6">
      <h2 className="text-base font-bold text-amber-950">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-amber-900">{message}</p>
    </div>
  );
}

export function AdminErrorState({
  message,
  title = "Admin data could not load",
}: {
  message: string;
  title?: string;
}) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-6">
      <h2 className="text-base font-bold text-red-950">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-red-800">{message}</p>
    </div>
  );
}

export function AdminStatusBadge({ value }: { value: string | boolean | null }) {
  const label =
    typeof value === "boolean" ? (value ? "Yes" : "No") : value ?? "Unknown";
  const normalized = String(label).toLowerCase();
  const tone =
    normalized === "live" || normalized === "yes" || normalized === "active"
      ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
      : normalized === "suspended" ||
          normalized === "no" ||
          normalized === "failed"
        ? "bg-red-50 text-red-800 ring-red-200"
        : "bg-stone-100 text-stone-700 ring-stone-200";

  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold capitalize ring-1 ${tone}`}
    >
      {label}
    </span>
  );
}

export function AdminCopyButton({
  label = "Copy",
  value,
}: {
  label?: string;
  value: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copyValue() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      className="seller-small-button"
      onClick={copyValue}
      type="button"
    >
      {copied ? "Copied" : label}
    </button>
  );
}

export function AdminMetric({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-3">
      <p className="text-xs font-bold uppercase tracking-[0.08em] text-stone-500">
        {label}
      </p>
      <p className="mt-1 text-xl font-bold text-stone-950">{value}</p>
    </div>
  );
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "Not set";

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatMoney(value: number | null | undefined) {
  if (value == null) return "-";

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value);
}

export function isAdminAuthorizationError(message: string) {
  const normalized = message.toLowerCase();

  return (
    normalized.includes("not authorized") ||
    normalized.includes("permission denied") ||
    normalized.includes("jwt") ||
    normalized.includes("authentication")
  );
}
