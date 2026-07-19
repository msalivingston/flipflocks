"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getPlanCapabilities } from "@/lib/plan-capabilities";
import { useSellerContext } from "../_components/seller-context";
import { ErrorState, LoadingState } from "../_components/seller-ui";

const SUPPORT_EMAIL = "hello@flockfront.com";

type AccountUser = {
  email: string | null;
  name: string | null;
};

type BillingStatus = {
  store_id: string;
  plan_key: string | null;
  billing_plan: string | null;
  subscription_status: string | null;
  current_period_end: string | null;
  storefront_access_until: string | null;
  trial_ends_at: string | null;
};

type BillingAddress = {
  billing_address_line1: string | null;
  billing_address_line2: string | null;
  billing_city: string | null;
  billing_country: string | null;
  billing_postal_code: string | null;
  billing_state: string | null;
};

type ContactForm = {
  email: string;
  name: string;
  phone: string;
  storeName: string;
};

type BillingForm = {
  addressLine1: string;
  addressLine2: string;
  billingName: string;
  city: string;
  postalCode: string;
  state: string;
};

export function SellerAccount() {
  const { seller, reload } = useSellerContext();
  const [accountUser, setAccountUser] = useState<AccountUser>({
    email: null,
    name: null,
  });
  const [billingStatus, setBillingStatus] = useState<BillingStatus | null>(
    null,
  );
  const [billingAddress, setBillingAddress] = useState<BillingAddress | null>(
    null,
  );
  const [contactForm, setContactForm] = useState<ContactForm>({
    email: "",
    name: "",
    phone: "",
    storeName: "",
  });
  const [billingForm, setBillingForm] = useState<BillingForm>({
    addressLine1: "",
    addressLine2: "",
    billingName: "",
    city: "",
    postalCode: "",
    state: "",
  });
  const [editingSection, setEditingSection] = useState<
    "contact" | "billing" | null
  >(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadAccount() {
      if (!seller) return;

      setIsLoading(true);
      setLoadError(null);

      const [userResult, billingResult, addressResult] = await Promise.all([
        supabase.auth.getUser(),
        supabase
          .from("seller_billing_status")
          .select(
            "store_id, plan_key, billing_plan, subscription_status, current_period_end, storefront_access_until, trial_ends_at",
          )
          .eq("store_id", seller.store_id)
          .maybeSingle()
          .returns<BillingStatus>(),
        supabase
          .from("stores")
          .select(
            "billing_address_line1, billing_address_line2, billing_city, billing_state, billing_postal_code, billing_country",
          )
          .eq("id", seller.store_id)
          .maybeSingle()
          .returns<BillingAddress>(),
      ]);

      if (!isMounted) return;

      const firstError =
        userResult.error ?? billingResult.error ?? addressResult.error;

      if (firstError) {
        setLoadError(firstError.message);
        setIsLoading(false);
        return;
      }

      const user = userResult.data.user;
      const nextUser = {
        email: user?.email ?? null,
        name: getUserName(user?.user_metadata),
      };
      const nextAddress = addressResult.data ?? null;

      setAccountUser(nextUser);
      setBillingStatus(billingResult.data ?? null);
      setBillingAddress(nextAddress);
      setContactForm({
        email: nextUser.email ?? "",
        name: nextUser.name ?? "",
        phone: seller.public_phone ?? "",
        storeName: seller.store_name,
      });
      setBillingForm({
        addressLine1: nextAddress?.billing_address_line1 ?? "",
        addressLine2: nextAddress?.billing_address_line2 ?? "",
        billingName: nextUser.name ?? "",
        city: nextAddress?.billing_city ?? "",
        postalCode: nextAddress?.billing_postal_code ?? "",
        state: formatState(nextAddress?.billing_state) ?? "",
      });
      setIsLoading(false);
    }

    void loadAccount();

    return () => {
      isMounted = false;
    };
  }, [seller]);

  const billing = useMemo(
    () => ({
      planKey: billingStatus?.plan_key ?? seller?.plan_key ?? null,
      status:
        billingStatus?.subscription_status ??
        seller?.subscription_status ??
        null,
      renewalDate:
        billingStatus?.current_period_end ??
        billingStatus?.storefront_access_until ??
        seller?.storefront_access_until ??
        null,
      trialEndsAt:
        billingStatus?.trial_ends_at ?? seller?.trial_ends_at ?? null,
    }),
    [billingStatus, seller],
  );
  const planCapabilities = getPlanCapabilities(billing.planKey);
  const hasBillingAddress = Boolean(
    billingAddress?.billing_address_line1 ||
      billingAddress?.billing_city ||
      billingAddress?.billing_state ||
      billingAddress?.billing_postal_code,
  );

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-7xl px-5 py-5 sm:px-7">
        <LoadingState label="Loading account" />
      </div>
    );
  }

  if (loadError || !seller) {
    return (
      <div className="mx-auto w-full max-w-7xl px-5 py-5 sm:px-7">
        <ErrorState message={loadError ?? "Account could not be loaded."} />
      </div>
    );
  }

  async function handleSaveContact() {
    if (!seller) return;

    setIsSaving(true);
    setSaveError(null);
    setSaveMessage(null);

    const trimmedName = contactForm.name.trim();
    const trimmedEmail = contactForm.email.trim().toLowerCase();
    const trimmedPhone = contactForm.phone.trim();
    const trimmedStoreName = contactForm.storeName.trim();

    if (!trimmedStoreName) {
      setSaveError("Farm/store name is required.");
      setIsSaving(false);
      return;
    }

    if (trimmedEmail && trimmedEmail !== accountUser.email) {
      const { error } = await supabase.auth.updateUser({
        email: trimmedEmail,
      });

      if (error) {
        setSaveError(error.message);
        setIsSaving(false);
        return;
      }

      setSaveMessage("Check your email to confirm the address change.");
      // Supabase keeps the current email active until verification completes.
    }

    if (trimmedName !== (accountUser.name ?? "")) {
      const { error } = await supabase.auth.updateUser({
        data: { full_name: trimmedName || null },
      });

      if (error) {
        setSaveError(error.message);
        setIsSaving(false);
        return;
      }
    }

    const shouldUpdateStore =
      trimmedPhone !== (seller.public_phone ?? "") ||
      trimmedStoreName !== seller.store_name;

    if (shouldUpdateStore) {
      const { error } = await supabase.rpc("seller_update_store_settings", {
        p_settings: {
          public_phone: trimmedPhone || null,
          store_name: trimmedStoreName,
        },
        p_store_id: seller.store_id,
      });

      if (error) {
        setSaveError(error.message);
        setIsSaving(false);
        return;
      }
    }

    setAccountUser((current) => ({
      ...current,
      name: trimmedName || null,
    }));
    setContactForm((current) => ({
      ...current,
      email: trimmedEmail || current.email,
      name: trimmedName,
      phone: trimmedPhone,
      storeName: trimmedStoreName,
    }));
    setEditingSection(null);
    setIsSaving(false);
    reload();
  }

  async function handleSaveBilling() {
    if (!seller) return;

    setIsSaving(true);
    setSaveMessage(null);
    setSaveError(null);

    const trimmedAddressLine1 = billingForm.addressLine1.trim();
    const trimmedAddressLine2 = billingForm.addressLine2.trim();
    const trimmedCity = billingForm.city.trim();
    const trimmedPostalCode = billingForm.postalCode.trim();
    const trimmedState = billingForm.state.trim().toUpperCase();

    if (
      !trimmedAddressLine1 ||
      !trimmedCity ||
      !trimmedState ||
      !trimmedPostalCode
    ) {
      setSaveError("Street address, city, state, and ZIP code are required.");
      setIsSaving(false);
      return;
    }

    const { data, error } = await supabase.rpc("seller_update_billing_address", {
      p_address: {
        billing_address_line1: trimmedAddressLine1,
        billing_address_line2: trimmedAddressLine2 || null,
        billing_city: trimmedCity,
        billing_country: billingAddress?.billing_country ?? "US",
        billing_postal_code: trimmedPostalCode,
        billing_state: trimmedState,
      },
      p_store_id: seller.store_id,
    });

    if (error) {
      setSaveError(error.message);
      setIsSaving(false);
      return;
    }

    const rows = Array.isArray(data) ? (data as BillingAddress[]) : [];
    const nextAddress = rows[0] ?? {
      billing_address_line1: trimmedAddressLine1,
      billing_address_line2: trimmedAddressLine2 || null,
      billing_city: trimmedCity,
      billing_country: billingAddress?.billing_country ?? "US",
      billing_postal_code: trimmedPostalCode,
      billing_state: trimmedState,
    };

    setBillingAddress(nextAddress);
    setBillingForm({
      addressLine1: nextAddress.billing_address_line1 ?? "",
      addressLine2: nextAddress.billing_address_line2 ?? "",
      billingName: accountUser.name ?? "",
      city: nextAddress.billing_city ?? "",
      postalCode: nextAddress.billing_postal_code ?? "",
      state: formatState(nextAddress.billing_state) ?? "",
    });
    setEditingSection(null);
    setSaveMessage("Billing address updated.");
    setIsSaving(false);
  }

  function cancelEdit() {
    if (!seller) return;

    setEditingSection(null);
    setSaveError(null);
    setSaveMessage(null);
    setContactForm({
      email: accountUser.email ?? "",
      name: accountUser.name ?? "",
      phone: seller.public_phone ?? "",
      storeName: seller.store_name,
    });
    setBillingForm({
      addressLine1: billingAddress?.billing_address_line1 ?? "",
      addressLine2: billingAddress?.billing_address_line2 ?? "",
      billingName: accountUser.name ?? "",
      city: billingAddress?.billing_city ?? "",
      postalCode: billingAddress?.billing_postal_code ?? "",
      state: formatState(billingAddress?.billing_state) ?? "",
    });
  }

  return (
    <>
      <header className="border-b border-stone-200 bg-white px-5 py-4 sm:px-7">
        <div className="mx-auto w-full max-w-7xl">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-emerald-700">
            {seller.store_name}
          </p>
          <h1 className="mt-1 text-3xl font-semibold text-stone-950">Account</h1>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            Manage your email, billing address, and subscription details.
          </p>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-7xl gap-3 px-5 py-4 sm:px-7">
        {saveMessage ? (
          <InlineNotice tone="success" message={saveMessage} />
        ) : null}
        {saveError ? <InlineNotice tone="error" message={saveError} /> : null}

        <AccountSection
          isEditing={editingSection === "contact"}
          onCancel={cancelEdit}
          onEdit={() => {
            setEditingSection("contact");
            setSaveError(null);
            setSaveMessage(null);
          }}
          onSave={handleSaveContact}
          saving={isSaving}
          title="Contact information"
        >
          {editingSection === "contact" ? (
            <EditableRows>
              <TextField
                label="Email address"
                value={contactForm.email}
                onChange={(value) =>
                  setContactForm((current) => ({ ...current, email: value }))
                }
              />
              <TextField
                label="Seller contact name"
                value={contactForm.name}
                onChange={(value) =>
                  setContactForm((current) => ({ ...current, name: value }))
                }
              />
              <TextField
                label="Phone number"
                value={contactForm.phone}
                onChange={(value) =>
                  setContactForm((current) => ({ ...current, phone: value }))
                }
              />
              <TextField
                label="Farm/store name"
                value={contactForm.storeName}
                onChange={(value) =>
                  setContactForm((current) => ({
                    ...current,
                    storeName: value,
                  }))
                }
              />
            </EditableRows>
          ) : (
            <InfoRows
              rows={[
                ["Email address", accountUser.email],
                ["Seller contact name", accountUser.name],
                ["Phone number", seller.public_phone],
                ["Farm/store name", seller.store_name],
              ]}
            />
          )}
        </AccountSection>

        <AccountSection
          isEditing={editingSection === "billing"}
          onCancel={cancelEdit}
          onEdit={() => {
            setEditingSection("billing");
            setSaveError(null);
            setSaveMessage(null);
          }}
          onSave={handleSaveBilling}
          saving={isSaving}
          title="Billing address"
        >
          {editingSection === "billing" ? (
            <EditableRows>
              <TextField
                label="Billing name"
                value={billingForm.billingName}
                onChange={(value) =>
                  setBillingForm((current) => ({
                    ...current,
                    billingName: value,
                  }))
                }
              />
              <TextField
                label="Street address"
                value={billingForm.addressLine1}
                onChange={(value) =>
                  setBillingForm((current) => ({
                    ...current,
                    addressLine1: value,
                  }))
                }
              />
              <TextField
                label="Address line 2"
                value={billingForm.addressLine2}
                onChange={(value) =>
                  setBillingForm((current) => ({
                    ...current,
                    addressLine2: value,
                  }))
                }
              />
              <TextField
                label="City"
                value={billingForm.city}
                onChange={(value) =>
                  setBillingForm((current) => ({ ...current, city: value }))
                }
              />
              <TextField
                label="State"
                value={billingForm.state}
                onChange={(value) =>
                  setBillingForm((current) => ({ ...current, state: value }))
                }
              />
              <TextField
                label="ZIP code"
                value={billingForm.postalCode}
                onChange={(value) =>
                  setBillingForm((current) => ({
                    ...current,
                    postalCode: value,
                  }))
                }
              />
            </EditableRows>
          ) : hasBillingAddress ? (
            <InfoRows
              rows={[
                ["Billing name", accountUser.name],
                ["Street address", billingAddress?.billing_address_line1],
                ["Address line 2", billingAddress?.billing_address_line2],
                ["City", billingAddress?.billing_city],
                ["State", formatState(billingAddress?.billing_state)],
                ["ZIP code", billingAddress?.billing_postal_code],
              ]}
            />
          ) : (
            <BillingEmptyState
              onAdd={() => {
                setEditingSection("billing");
                setSaveError(null);
                setSaveMessage(null);
              }}
            />
          )}
        </AccountSection>

        <StaticSection title="Store status">
          <InfoRows
            rows={[
              [
                "Storefront",
                <span className="inline-flex items-center gap-2" key="status">
                  <StatusDot live={seller.is_publicly_available} />
                  {seller.is_publicly_available ? "Live" : "Not live"}
                </span>,
              ],
              [
                "Store URL",
                <span
                  className="flex items-center justify-between gap-4"
                  key="url"
                >
                  <span>{seller.store_slug}</span>
                  <Link
                    className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-800 hover:text-emerald-950"
                    href={`/store/${seller.store_slug}`}
                    target="_blank"
                  >
                    View storefront
                    <span aria-hidden="true">↗</span>
                  </Link>
                </span>,
              ],
            ]}
          />
        </StaticSection>

        <StaticSection title="Plan & billing">
          <InfoRows
            compact
            rows={[
              ["Current plan", planCapabilities.displayName],
              ["Subscription status", formatValue(billing.status)],
              ["Renewal/end date", formatDateTime(billing.renewalDate)],
              ["Trial status", getTrialStatus(billing.status, billing.trialEndsAt)],
              ["Trial end date", formatDateTime(billing.trialEndsAt)],
            ]}
          />
        </StaticSection>

        <section className="flex flex-col gap-3 rounded-lg border border-stone-200 bg-white px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-100">
              <Image src="/glyphs/chat.png" alt="" width={20} height={20} />
            </span>
            <p className="text-sm text-stone-700">
              <span className="font-semibold text-stone-950">Need help?</span>{" "}
              Our support team is here to help with your account.
            </p>
          </div>
          <a className="seller-secondary-button justify-center" href={`mailto:${SUPPORT_EMAIL}`}>
            Contact support
          </a>
        </section>
      </main>
    </>
  );
}

function AccountSection({
  children,
  isEditing,
  onCancel,
  onEdit,
  onSave,
  saving,
  title,
}: {
  children: React.ReactNode;
  isEditing: boolean;
  onCancel: () => void;
  onEdit: () => void;
  onSave: () => void;
  saving: boolean;
  title: string;
}) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white px-4 py-3 sm:px-5">
      <div className="mb-1.5 flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold text-stone-950">{title}</h2>
        {isEditing ? (
          <div className="flex gap-2">
            <button
              className="seller-small-button"
              disabled={saving}
              type="button"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              className="seller-primary-button min-h-9 px-3 text-sm"
              disabled={saving}
              type="button"
              onClick={onSave}
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
          </div>
        ) : (
          <button
            className="inline-flex min-h-9 items-center gap-2 rounded-md px-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50"
            type="button"
            onClick={onEdit}
          >
            <Image src="/glyphs/pencil.png" alt="" width={16} height={16} />
            Edit
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

function StaticSection({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white px-4 py-3 sm:px-5">
      <h2 className="mb-1.5 text-lg font-semibold text-stone-950">{title}</h2>
      {children}
    </section>
  );
}

function InfoRows({
  compact = false,
  rows,
}: {
  compact?: boolean;
  rows: [string, React.ReactNode | null | undefined][];
}) {
  return (
    <dl className="divide-y divide-stone-200">
      {rows.map(([label, value]) => (
        <div
          className={`grid gap-1 text-sm sm:grid-cols-[18rem_1fr] ${
            compact ? "py-1" : "py-1.5"
          }`}
          key={label}
        >
          <dt className="font-medium text-stone-600">{label}</dt>
          <dd className="font-semibold text-stone-950">
            {value || <span className="font-medium text-stone-500">Not configured</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function EditableRows({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>;
}

function BillingEmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-dashed border-stone-300 bg-stone-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm font-medium text-stone-600">
        No billing address added yet.
      </p>
      <button
        className="seller-secondary-button justify-center"
        type="button"
        onClick={onAdd}
      >
        Add billing address
      </button>
    </div>
  );
}

function TextField({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="grid gap-1 text-sm font-semibold text-stone-700">
      {label}
      <input
        className="min-h-10 rounded-md border border-stone-300 bg-white px-3 text-sm font-medium text-stone-950 shadow-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function InlineNotice({
  message,
  tone,
}: {
  message: string;
  tone: "error" | "success";
}) {
  return (
    <div
      className={`rounded-lg border px-4 py-3 text-sm font-medium ${
        tone === "error"
          ? "border-red-200 bg-red-50 text-red-800"
          : "border-emerald-200 bg-emerald-50 text-emerald-800"
      }`}
    >
      {message}
    </div>
  );
}

function StatusDot({ live }: { live: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`size-2 rounded-full ${live ? "bg-green-500" : "bg-stone-400"}`}
    />
  );
}

function getUserName(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return null;

  const record = metadata as Record<string, unknown>;
  const candidate =
    record.full_name ??
    record.name ??
    record.display_name ??
    record.user_name;

  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim()
    : null;
}

function formatValue(value: string | null | undefined) {
  if (!value) return null;
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function getTrialStatus(
  subscriptionStatus: string | null | undefined,
  trialEndsAt: string | null | undefined,
) {
  if (subscriptionStatus === "trialing") {
    const formattedTrialEnd = formatDateTime(trialEndsAt);
    return formattedTrialEnd ? `Trialing until ${formattedTrialEnd}` : "Trialing";
  }

  if (trialEndsAt) return "Trial ended";

  return null;
}

function formatState(value: string | null | undefined) {
  if (!value) return null;

  const normalized = value.trim().toUpperCase();
  const states: Record<string, string> = {
    CO: "Colorado",
  };

  return states[normalized] ?? value;
}
