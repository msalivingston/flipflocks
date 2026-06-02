"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSellerContext } from "../_components/seller-context";
import {
  ErrorState,
  LoadingState,
  SellerCard,
  SellerPageHeader,
  StatusBadge,
} from "../_components/seller-ui";

type StoreAdminForm = {
  store_name: string;
  store_slug: string;
  store_tagline: string;
  public_city: string;
  public_state: string;
  public_country: string;
  about_text: string;
  website_url: string;
  npip_number: string;
  show_npip: boolean;
  public_email: string;
  show_public_email: boolean;
  public_phone: string;
  show_public_phone: boolean;
  communication_email: string;
  pickup_location_text: string;
  pickup_instructions: string;
  default_pickup_option_id: string;
  pickup_policy: string;
  cancellation_policy: string;
  other_policies: string;
  order_notification_email: string;
  storefront_enabled: boolean;
};

type StoreDefaults = {
  store_id: string;
  pickup_instructions: string | null;
  pickup_location_text: string | null;
  default_pickup_option_id: string | null;
  default_pickup_option_label: string | null;
  communication_email: string | null;
  order_notification_email: string | null;
  currency: string | null;
};

type PickupOption = {
  id: string;
  store_id: string;
  label: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
};

type PickupOptionDraft = {
  id: string;
  label: string;
  description: string;
  sort_order: number;
  is_active: boolean;
  isNew?: boolean;
};

type SaveState = "idle" | "saved" | "error";

type LaunchReadinessItem = {
  item_type: "required" | "warning";
  item_key: string;
  label: string;
  passed: boolean;
  message: string;
  action: string;
  detail_count: number | null;
};

type StoreLaunchResponse = {
  launched?: boolean;
  store?: {
    store_id: string;
    store_status: string;
    storefront_enabled: boolean;
    is_publicly_available: boolean;
    launched_at: string | null;
  } | null;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
};

const unsavedWarning =
  "You have unsaved Store Admin changes. Save or discard before leaving.";

const blankForm: StoreAdminForm = {
  store_name: "",
  store_slug: "",
  store_tagline: "",
  public_city: "",
  public_state: "",
  public_country: "US",
  about_text: "",
  website_url: "",
  npip_number: "",
  show_npip: false,
  public_email: "",
  show_public_email: false,
  public_phone: "",
  show_public_phone: false,
  communication_email: "",
  pickup_location_text: "",
  pickup_instructions: "",
  default_pickup_option_id: "",
  pickup_policy: "",
  cancellation_policy: "",
  other_policies: "",
  order_notification_email: "",
  storefront_enabled: false,
};

export function StoreAdmin() {
  const { seller, reload } = useSellerContext();
  const [form, setForm] = useState<StoreAdminForm>(blankForm);
  const [initialForm, setInitialForm] = useState<StoreAdminForm>(blankForm);
  const [pickupOptions, setPickupOptions] = useState<PickupOptionDraft[]>([]);
  const [initialPickupOptions, setInitialPickupOptions] = useState<
    PickupOptionDraft[]
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [readinessItems, setReadinessItems] = useState<LaunchReadinessItem[]>(
    [],
  );
  const [readinessError, setReadinessError] = useState<string | null>(null);
  const [isReadinessLoading, setIsReadinessLoading] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadStoreAdmin() {
      if (!seller) return;

      setIsLoading(true);
      setLoadError(null);
      setSaveMessage(null);
      setSaveState("idle");

      const [defaultsResult, pickupOptionsResult, readinessResult] =
        await Promise.all([
          supabase
            .from("seller_store_defaults")
            .select(
              "store_id, pickup_instructions, pickup_location_text, default_pickup_option_id, default_pickup_option_label, communication_email, order_notification_email, currency",
            )
            .eq("store_id", seller.store_id)
            .maybeSingle()
            .returns<StoreDefaults>(),
          supabase
            .from("store_pickup_options")
            .select("id, store_id, label, description, sort_order, is_active")
            .eq("store_id", seller.store_id)
            .order("sort_order", { ascending: true })
            .order("label", { ascending: true })
            .returns<PickupOption[]>(),
          supabase.rpc("seller_get_store_launch_readiness", {
            p_store_id: seller.store_id,
          }),
        ]);

      if (!isMounted) return;

      const firstError = defaultsResult.error ?? pickupOptionsResult.error;

      if (firstError) {
        setLoadError(firstError.message);
        setIsLoading(false);
        return;
      }

      const defaults = defaultsResult.data;
      const nextForm = buildInitialForm(seller, defaults);
      const nextPickupOptions = (pickupOptionsResult.data ?? []).map(
        toPickupOptionDraft,
      );

      setForm(nextForm);
      setInitialForm(nextForm);
      setPickupOptions(nextPickupOptions);
      setInitialPickupOptions(nextPickupOptions);
      setReadinessItems(
        readinessResult.error
          ? []
          : ((readinessResult.data ?? []) as LaunchReadinessItem[]),
      );
      setReadinessError(readinessResult.error?.message ?? null);
      setIsLoading(false);
    }

    void loadStoreAdmin();

    return () => {
      isMounted = false;
    };
  }, [seller]);

  const storeUrl = useMemo(
    () =>
      typeof window === "undefined"
        ? `/store/${form.store_slug}`
        : `${window.location.origin}/store/${form.store_slug}`,
    [form.store_slug],
  );

  const hasUnsavedChanges = useMemo(
    () =>
      JSON.stringify(form) !== JSON.stringify(initialForm) ||
      JSON.stringify(normalizePickupOptionDrafts(pickupOptions)) !==
        JSON.stringify(normalizePickupOptionDrafts(initialPickupOptions)),
    [form, initialForm, initialPickupOptions, pickupOptions],
  );

  useUnsavedWarning(hasUnsavedChanges);

  function updateField<TKey extends keyof StoreAdminForm>(
    key: TKey,
    value: StoreAdminForm[TKey],
  ) {
    setSaveState("idle");
    setSaveMessage(null);
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updatePickupOption(
    optionId: string,
    updates: Partial<PickupOptionDraft>,
  ) {
    setSaveState("idle");
    setSaveMessage(null);
    setPickupOptions((current) =>
      current.map((option) =>
        option.id === optionId ? { ...option, ...updates } : option,
      ),
    );
  }

  function addPickupOption() {
    const tempId = `new-${crypto.randomUUID()}`;

    setPickupOptions((current) => [
      ...current,
      {
        id: tempId,
        label: "",
        description: "",
        sort_order: current.length,
        is_active: true,
        isNew: true,
      },
    ]);
  }

  function discardChanges() {
    setForm(initialForm);
    setPickupOptions(initialPickupOptions);
    setSaveState("idle");
    setSaveMessage("Changes discarded.");
  }

  async function reloadReadiness() {
    if (!seller) return;

    setIsReadinessLoading(true);
    setReadinessError(null);

    const { data, error } = await supabase.rpc(
      "seller_get_store_launch_readiness",
      {
        p_store_id: seller.store_id,
      },
    );

    if (error) {
      setReadinessItems([]);
      setReadinessError(error.message);
    } else {
      setReadinessItems((data ?? []) as LaunchReadinessItem[]);
    }

    setIsReadinessLoading(false);
  }

  async function saveChanges() {
    if (!seller) return;

    const validationMessage = validateForm(form, pickupOptions);

    if (validationMessage) {
      setSaveState("error");
      setSaveMessage(validationMessage);
      return;
    }

    setIsSaving(true);
    setSaveState("idle");
    setSaveMessage(null);

    const idMap = new Map<string, string>();
    const persistedOptions: PickupOptionDraft[] = [];

    for (const option of pickupOptions) {
      const normalizedOption = {
        ...option,
        label: option.label.trim(),
        description: option.description.trim(),
      };

      if (!normalizedOption.label && option.isNew) continue;

      if (option.isNew) {
        const { data, error } = await supabase.rpc(
          "seller_create_pickup_option",
          {
            p_store_id: seller.store_id,
            p_label: normalizedOption.label,
            p_description: normalizedOption.description || null,
            p_sort_order: normalizedOption.sort_order,
            p_is_active: normalizedOption.is_active,
          },
        );

        if (error) {
          setIsSaving(false);
          setSaveState("error");
          setSaveMessage(error.message);
          return;
        }

        const created = data as PickupOption;
        idMap.set(option.id, created.id);
        persistedOptions.push(toPickupOptionDraft(created));
      } else {
        const { data, error } = await supabase.rpc(
          "seller_update_pickup_option",
          {
            p_pickup_option_id: option.id,
            p_label: normalizedOption.label,
            p_description: normalizedOption.description || null,
            p_sort_order: normalizedOption.sort_order,
            p_is_active: normalizedOption.is_active,
          },
        );

        if (error) {
          setIsSaving(false);
          setSaveState("error");
          setSaveMessage(error.message);
          return;
        }

        persistedOptions.push(toPickupOptionDraft(data as PickupOption));
      }
    }

    const selectedDefaultId =
      idMap.get(form.default_pickup_option_id) ?? form.default_pickup_option_id;

    const settingsPayload = {
      store_name: form.store_name,
      store_slug: form.store_slug,
      store_tagline: form.store_tagline,
      public_city: form.public_city,
      public_state: form.public_state,
      public_country: form.public_country,
      about_text: form.about_text,
      website_url: form.website_url,
      npip_number: form.npip_number,
      show_npip: form.show_npip,
      public_email: form.public_email,
      public_phone: form.public_phone,
      show_public_email: form.show_public_email,
      show_public_phone: form.show_public_phone,
      pickup_policy: form.pickup_policy,
      cancellation_policy: form.cancellation_policy,
      other_policies: form.other_policies,
      storefront_enabled: form.storefront_enabled,
    };

    const defaultsPayload = {
      pickup_location_text: form.pickup_location_text,
      pickup_instructions: form.pickup_instructions,
      default_pickup_option_id: selectedDefaultId || null,
      communication_email: form.communication_email,
      order_notification_email: form.order_notification_email,
    };

    const settingsResult = await supabase.rpc("seller_update_store_settings", {
      p_store_id: seller.store_id,
      p_settings: settingsPayload,
    });

    if (settingsResult.error) {
      setIsSaving(false);
      setSaveState("error");
      setSaveMessage(settingsResult.error.message);
      return;
    }

    const defaultsResult = await supabase.rpc("seller_update_store_defaults", {
      p_store_id: seller.store_id,
      p_defaults: defaultsPayload,
    });

    if (defaultsResult.error) {
      setIsSaving(false);
      setSaveState("error");
      setSaveMessage(defaultsResult.error.message);
      return;
    }

    const savedForm = {
      ...form,
      store_name: form.store_name.trim(),
      store_slug: form.store_slug.trim().toLowerCase(),
      store_tagline: form.store_tagline.trim(),
      public_city: form.public_city.trim(),
      public_state: form.public_state.trim(),
      public_country: form.public_country.trim().toUpperCase() || "US",
      about_text: form.about_text.trim(),
      website_url: form.website_url.trim(),
      npip_number: form.npip_number.trim(),
      public_email: form.public_email.trim().toLowerCase(),
      public_phone: form.public_phone.trim(),
      communication_email: form.communication_email.trim().toLowerCase(),
      pickup_location_text: form.pickup_location_text.trim(),
      pickup_instructions: form.pickup_instructions.trim(),
      default_pickup_option_id: selectedDefaultId || "",
      pickup_policy: form.pickup_policy.trim(),
      cancellation_policy: form.cancellation_policy.trim(),
      other_policies: form.other_policies.trim(),
      order_notification_email: form.order_notification_email
        .trim()
        .toLowerCase(),
    };
    const sortedOptions = persistedOptions.sort(
      (first, second) =>
        first.sort_order - second.sort_order ||
        first.label.localeCompare(second.label),
    );

    setForm(savedForm);
    setInitialForm(savedForm);
    setPickupOptions(sortedOptions);
    setInitialPickupOptions(sortedOptions);
    setIsSaving(false);
    setSaveState("saved");
    setSaveMessage("Store Admin saved.");
    await reloadReadiness();
    reload();
  }

  async function launchStore() {
    if (!seller) return;

    setSaveState("idle");
    setSaveMessage(null);

    if (hasUnsavedChanges) {
      setSaveState("error");
      setSaveMessage("Save or discard Store Admin changes before launching.");
      return;
    }

    const missingRequired = readinessItems.filter(
      (item) => item.item_type === "required" && !item.passed,
    );

    if (missingRequired.length > 0) {
      setSaveState("error");
      setSaveMessage("Complete required launch items before launching.");
      return;
    }

    const shouldLaunch = window.confirm(
      "Launch this store now? This changes the store lifecycle to live, but does not enable the public storefront.",
    );

    if (!shouldLaunch) return;

    setIsLaunching(true);

    const { data, error } = await supabase.functions.invoke<StoreLaunchResponse>(
      "seller-store-launch",
      {
        body: {
          store_id: seller.store_id,
        },
      },
    );

    if (error || data?.error) {
      setIsLaunching(false);
      setSaveState("error");
      setSaveMessage(
        data?.error?.message ??
          error?.message ??
          "The store could not be launched.",
      );
      await reloadReadiness();
      return;
    }

    setIsLaunching(false);
    setSaveState("saved");
    setSaveMessage(
      "Store launched. Use Storefront enabled to control public publication.",
    );
    await reloadReadiness();
    reload();
  }

  if (isLoading) {
    return (
      <>
        <SellerPageHeader
          title="Store Admin"
          description="Manage your store setup, public details, pickup information, policies, notifications, and storefront preview."
        />
        <div className="mx-auto w-full max-w-7xl px-5 py-5 sm:px-7">
          <LoadingState label="Loading Store Admin" />
        </div>
      </>
    );
  }

  if (loadError || !seller) {
    return (
      <>
        <SellerPageHeader title="Store Admin" />
        <div className="mx-auto w-full max-w-7xl px-5 py-5 sm:px-7">
          <ErrorState
            message={loadError ?? "Store Admin could not be loaded."}
          />
        </div>
      </>
    );
  }

  const statusCode = getStorefrontStatusCode(form, seller);
  const statusMessage = getStorefrontStatusMessage(form, seller);
  const requiredReadinessItems = readinessItems.filter(
    (item) => item.item_type === "required",
  );
  const warningReadinessItems = readinessItems.filter(
    (item) => item.item_type === "warning",
  );
  const missingRequiredCount = requiredReadinessItems.filter(
    (item) => !item.passed,
  ).length;
  const launchAllowed =
    seller.store_status === "draft" &&
    missingRequiredCount === 0 &&
    !hasUnsavedChanges &&
    !isLaunching;

  return (
    <>
      <SellerPageHeader
        eyebrow={seller.store_name}
        title="Store Admin"
        description="Business setup for your public store, pickup flow, policies, notifications, and preview link."
        action={
          <div className="flex flex-wrap gap-2">
            <button
              className="seller-secondary-button"
              disabled={!hasUnsavedChanges || isSaving}
              onClick={discardChanges}
              type="button"
            >
              Discard Changes
            </button>
            <button
              className="inline-flex min-h-10 items-center justify-center rounded-md bg-stone-950 px-4 text-sm font-semibold text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-400"
              disabled={!hasUnsavedChanges || isSaving}
              onClick={saveChanges}
              type="button"
            >
              {isSaving ? "Saving..." : "Save"}
            </button>
          </div>
        }
      />

      <div className="mx-auto grid w-full max-w-7xl gap-5 px-5 py-5 sm:px-7">
        {saveMessage ? (
          <div
            className={`rounded-lg border px-4 py-3 text-sm font-semibold ${
              saveState === "error"
                ? "border-red-200 bg-red-50 text-red-800"
                : "border-emerald-200 bg-emerald-50 text-emerald-800"
            }`}
          >
            {saveMessage}
          </div>
        ) : null}

        {hasUnsavedChanges ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
            You have unsaved Store Admin changes.
          </div>
        ) : null}

        <div className="grid gap-5 xl:grid-cols-[1fr_22rem]">
          <div className="grid gap-5">
            <SettingsSection
              description="Core public identity for this seller store."
              title="Store Profile"
            >
              <div className="grid gap-4 md:grid-cols-2">
                <TextField
                  label="Store name"
                  onChange={(value) => updateField("store_name", value)}
                  required
                  value={form.store_name}
                />
                <TextField
                  helper={`Public URL: /store/${form.store_slug || "store-slug"}`}
                  label="Store slug"
                  onChange={(value) => updateField("store_slug", value)}
                  required
                  value={form.store_slug}
                />
                <TextField
                  label="Store tagline"
                  onChange={(value) => updateField("store_tagline", value)}
                  value={form.store_tagline}
                />
                <TextField
                  label="City"
                  onChange={(value) => updateField("public_city", value)}
                  value={form.public_city}
                />
                <TextField
                  label="State"
                  onChange={(value) => updateField("public_state", value)}
                  value={form.public_state}
                />
                <TextField
                  label="Country"
                  onChange={(value) => updateField("public_country", value)}
                  value={form.public_country}
                />
                <TextField
                  label="Website URL"
                  onChange={(value) => updateField("website_url", value)}
                  placeholder="https://example.com"
                  value={form.website_url}
                />
              </div>
              <TextAreaField
                label="About text"
                onChange={(value) => updateField("about_text", value)}
                value={form.about_text}
              />
              <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
                <TextField
                  label="NPIP number"
                  onChange={(value) => updateField("npip_number", value)}
                  value={form.npip_number}
                />
                <ToggleField
                  checked={form.show_npip}
                  label="Show NPIP"
                  onChange={(value) => updateField("show_npip", value)}
                />
              </div>
            </SettingsSection>

            <SettingsSection
              description="Choose which contact details are public and which email is used inside seller workflows."
              title="Contact Information"
            >
              <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
                <TextField
                  label="Public email"
                  onChange={(value) => updateField("public_email", value)}
                  value={form.public_email}
                />
                <ToggleField
                  checked={form.show_public_email}
                  label="Show email"
                  onChange={(value) => updateField("show_public_email", value)}
                />
              </div>
              <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
                <TextField
                  label="Public phone"
                  onChange={(value) => updateField("public_phone", value)}
                  value={form.public_phone}
                />
                <ToggleField
                  checked={form.show_public_phone}
                  label="Show phone"
                  onChange={(value) => updateField("show_public_phone", value)}
                />
              </div>
              <TextField
                helper="Used for seller workflows when different from public contact details."
                label="Communication email"
                onChange={(value) => updateField("communication_email", value)}
                value={form.communication_email}
              />
            </SettingsSection>

            <SettingsSection
              description="Reusable pickup details shown in checkout and seller order workflows."
              title="Pickup & Fulfillment"
            >
              <TextField
                label="Pickup location text"
                onChange={(value) => updateField("pickup_location_text", value)}
                placeholder="Farm pickup in Fort Collins, CO"
                value={form.pickup_location_text}
              />
              <TextAreaField
                label="Pickup instructions"
                onChange={(value) => updateField("pickup_instructions", value)}
                value={form.pickup_instructions}
              />
              <label className="grid gap-1 text-sm font-semibold text-stone-700">
                Default pickup option
                <select
                  className="seller-form-field"
                  value={form.default_pickup_option_id}
                  onChange={(event) =>
                    updateField("default_pickup_option_id", event.target.value)
                  }
                >
                  <option value="">No default</option>
                  {pickupOptions
                    .filter((option) => option.is_active && option.label.trim())
                    .map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label || "Untitled pickup option"}
                      </option>
                    ))}
                </select>
              </label>
              <div className="grid gap-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-stone-950">
                    Pickup options
                  </h3>
                  <button
                    className="seller-small-button"
                    onClick={addPickupOption}
                    type="button"
                  >
                    Add Option
                  </button>
                </div>
                {pickupOptions.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-stone-300 bg-stone-50 px-4 py-4 text-sm text-stone-600">
                    No pickup options yet.
                  </p>
                ) : (
                  <div className="grid gap-3">
                    {pickupOptions.map((option, index) => (
                      <div
                        className="grid gap-3 rounded-lg border border-stone-200 bg-stone-50 p-3"
                        key={option.id}
                      >
                        <div className="grid gap-3 md:grid-cols-[1fr_7rem_auto] md:items-end">
                          <TextField
                            label="Label"
                            onChange={(value) =>
                              updatePickupOption(option.id, { label: value })
                            }
                            value={option.label}
                          />
                          <TextField
                            label="Sort"
                            onChange={(value) =>
                              updatePickupOption(option.id, {
                                sort_order: Number(value) || 0,
                              })
                            }
                            type="number"
                            value={String(option.sort_order ?? index)}
                          />
                          <ToggleField
                            checked={option.is_active}
                            label="Active"
                            onChange={(value) =>
                              updatePickupOption(option.id, {
                                is_active: value,
                              })
                            }
                          />
                        </div>
                        <TextAreaField
                          label="Description"
                          onChange={(value) =>
                            updatePickupOption(option.id, {
                              description: value,
                            })
                          }
                          rows={2}
                          value={option.description}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </SettingsSection>

            <SettingsSection
              description="Public policy text reused on storefront and listing pages."
              title="Policies"
            >
              <TextAreaField
                label="Pickup policy"
                onChange={(value) => updateField("pickup_policy", value)}
                value={form.pickup_policy}
              />
              <TextAreaField
                label="Cancellation policy"
                onChange={(value) => updateField("cancellation_policy", value)}
                value={form.cancellation_policy}
              />
              <TextAreaField
                label="Other policies"
                onChange={(value) => updateField("other_policies", value)}
                value={form.other_policies}
              />
            </SettingsSection>

            <SettingsSection
              description="Operational notification destination for new order email."
              title="Notifications"
            >
              <TextField
                label="Order notification email"
                onChange={(value) =>
                  updateField("order_notification_email", value)
                }
                value={form.order_notification_email}
              />
            </SettingsSection>
          </div>

          <aside className="grid h-fit gap-5 xl:sticky xl:top-5">
            <SellerCard>
              <div className="grid gap-4 p-5">
                <div>
                  <h2 className="text-lg font-semibold text-stone-950">
                    Launch Readiness
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-stone-600">
                    Launching makes the store lifecycle live. Storefront enabled
                    still controls public publication.
                  </p>
                </div>
                <LaunchReadinessList
                  error={readinessError}
                  isLoading={isReadinessLoading}
                  items={requiredReadinessItems}
                  title="Required"
                />
                <LaunchReadinessList
                  items={warningReadinessItems}
                  title="Warnings"
                />
                {seller.store_status === "draft" ? (
                  <button
                    className="inline-flex min-h-10 items-center justify-center rounded-md bg-stone-950 px-4 text-sm font-semibold text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-400"
                    disabled={!launchAllowed}
                    onClick={() => void launchStore()}
                    type="button"
                  >
                    {isLaunching ? "Launching..." : "Launch Store"}
                  </button>
                ) : (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm font-semibold text-emerald-900">
                    Store lifecycle is {seller.store_status}.
                  </div>
                )}
                {hasUnsavedChanges ? (
                  <p className="text-xs font-medium leading-5 text-amber-800">
                    Save or discard Store Admin changes before launching.
                  </p>
                ) : null}
              </div>
            </SellerCard>
            <SellerCard>
              <div className="grid gap-4 p-5">
                <div>
                  <h2 className="text-lg font-semibold text-stone-950">
                    Store Preview
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-stone-600">
                    Check publication status and open the public storefront.
                  </p>
                </div>
                <ToggleField
                  checked={form.storefront_enabled}
                  label="Storefront enabled"
                  onChange={(value) => updateField("storefront_enabled", value)}
                />
                <div className="grid gap-2 rounded-lg border border-stone-200 bg-stone-50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-stone-700">
                      Status
                    </span>
                    <StatusBadge status={statusCode} />
                  </div>
                  <p className="text-sm leading-6 text-stone-600">
                    {statusMessage}
                  </p>
                </div>
                <label className="grid gap-1 text-sm font-semibold text-stone-700">
                  Public store URL
                  <input
                    className="seller-form-field text-xs"
                    readOnly
                    value={storeUrl}
                  />
                </label>
                <Link
                  className="inline-flex min-h-10 items-center justify-center rounded-md bg-emerald-800 px-4 text-sm font-semibold text-white transition hover:bg-emerald-900"
                  href={`/store/${form.store_slug}`}
                  target="_blank"
                >
                  Preview Store
                </Link>
              </div>
            </SellerCard>
          </aside>
        </div>
      </div>
    </>
  );
}

function SettingsSection({
  children,
  description,
  title,
}: {
  children: React.ReactNode;
  description: string;
  title: string;
}) {
  return (
    <SellerCard>
      <div className="grid gap-4 p-5">
        <div>
          <h2 className="text-lg font-semibold text-stone-950">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            {description}
          </p>
        </div>
        <div className="grid gap-4">{children}</div>
      </div>
    </SellerCard>
  );
}

function LaunchReadinessList({
  error,
  isLoading = false,
  items,
  title,
}: {
  error?: string | null;
  isLoading?: boolean;
  items: LaunchReadinessItem[];
  title: string;
}) {
  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm font-semibold text-red-800">
        {error}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-3 text-sm text-stone-600">
        Checking readiness...
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-3 text-sm text-stone-600">
        No {title.toLowerCase()} items found.
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <h3 className="text-sm font-semibold text-stone-950">{title}</h3>
      <div className="grid gap-2">
        {items.map((item) => (
          <div
            className={`rounded-lg border px-3 py-3 ${
              item.passed
                ? "border-emerald-200 bg-emerald-50"
                : item.item_type === "warning"
                  ? "border-amber-200 bg-amber-50"
                  : "border-red-200 bg-red-50"
            }`}
            key={item.item_key}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-stone-950">
                  {item.label}
                </p>
                <p className="mt-1 text-xs leading-5 text-stone-600">
                  {item.message}
                </p>
                {!item.passed ? (
                  <p className="mt-1 text-xs font-semibold leading-5 text-stone-800">
                    {item.action}
                  </p>
                ) : null}
              </div>
              <StatusBadge
                status={
                  item.passed
                    ? "ready_now"
                    : item.item_type === "warning"
                      ? "pending"
                      : "unavailable"
                }
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TextField({
  helper,
  label,
  onChange,
  placeholder,
  required = false,
  type = "text",
  value,
}: {
  helper?: string;
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  type?: "text" | "number";
  value: string;
}) {
  return (
    <label className="grid gap-1 text-sm font-semibold text-stone-700">
      {label}
      <input
        className="seller-form-field"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        type={type}
        value={value}
      />
      {helper ? (
        <span className="text-xs font-medium leading-5 text-stone-500">
          {helper}
        </span>
      ) : null}
    </label>
  );
}

function TextAreaField({
  label,
  onChange,
  rows = 4,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  rows?: number;
  value: string;
}) {
  return (
    <label className="grid gap-1 text-sm font-semibold text-stone-700">
      {label}
      <textarea
        className="seller-form-field min-h-28 resize-y py-3"
        onChange={(event) => onChange(event.target.value)}
        rows={rows}
        value={value}
      />
    </label>
  );
}

function ToggleField({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="inline-flex min-h-11 items-center gap-3 rounded-md border border-stone-200 bg-white px-3 text-sm font-semibold text-stone-700 shadow-sm">
      <input
        checked={checked}
        className="h-4 w-4 accent-emerald-800"
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      {label}
    </label>
  );
}

function buildInitialForm(
  seller: NonNullable<ReturnType<typeof useSellerContext>["seller"]>,
  defaults?: StoreDefaults | null,
): StoreAdminForm {
  return {
    store_name: seller.store_name ?? "",
    store_slug: seller.store_slug ?? "",
    store_tagline: seller.store_tagline ?? "",
    public_city: seller.public_city ?? "",
    public_state: seller.public_state ?? "",
    public_country: seller.public_country ?? "US",
    about_text: seller.about_text ?? "",
    website_url: seller.website_url ?? "",
    npip_number: seller.npip_number ?? "",
    show_npip: seller.show_npip,
    public_email: seller.public_email ?? "",
    show_public_email: seller.show_public_email,
    public_phone: seller.public_phone ?? "",
    show_public_phone: seller.show_public_phone,
    communication_email: defaults?.communication_email ?? "",
    pickup_location_text: defaults?.pickup_location_text ?? "",
    pickup_instructions:
      defaults?.pickup_instructions ?? seller.pickup_instructions ?? "",
    default_pickup_option_id: defaults?.default_pickup_option_id ?? "",
    pickup_policy: seller.pickup_policy ?? "",
    cancellation_policy: seller.cancellation_policy ?? "",
    other_policies: seller.other_policies ?? "",
    order_notification_email:
      defaults?.order_notification_email ?? seller.order_notification_email ?? "",
    storefront_enabled: seller.storefront_enabled,
  };
}

function toPickupOptionDraft(option: PickupOption): PickupOptionDraft {
  return {
    id: option.id,
    label: option.label,
    description: option.description ?? "",
    sort_order: option.sort_order,
    is_active: option.is_active,
  };
}

function normalizePickupOptionDrafts(options: PickupOptionDraft[]) {
  return options.map((option) => ({
    id: option.id,
    label: option.label.trim(),
    description: option.description.trim(),
    sort_order: option.sort_order,
    is_active: option.is_active,
    isNew: option.isNew ?? false,
  }));
}

function validateForm(form: StoreAdminForm, pickupOptions: PickupOptionDraft[]) {
  if (!form.store_name.trim()) return "Store name is required.";

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.store_slug.trim())) {
    return "Store slug must use lowercase letters, numbers, and hyphens.";
  }

  if (
    form.public_country.trim() &&
    !/^[A-Za-z]{2,3}$/.test(form.public_country.trim())
  ) {
    return "Country should use a two or three letter code.";
  }

  for (const option of pickupOptions) {
    if (!option.isNew || option.label.trim() || option.description.trim()) {
      if (!option.label.trim()) return "Each pickup option needs a label.";
    }
  }

  return null;
}

function getStorefrontStatusCode(
  form: StoreAdminForm,
  seller: NonNullable<ReturnType<typeof useSellerContext>["seller"]>,
) {
  if (!form.storefront_enabled) return "hidden";
  if (seller.is_publicly_available) return "live";
  if (
    seller.storefront_enabled === false &&
    seller.store_status === "live" &&
    ["hosted", "embedded"].includes(seller.storefront_mode)
  ) {
    return "pending";
  }
  if (seller.store_status !== "live") return seller.store_status;
  if (!["hosted", "embedded"].includes(seller.storefront_mode)) {
    return "private";
  }
  return "unavailable";
}

function getStorefrontStatusMessage(
  form: StoreAdminForm,
  seller: NonNullable<ReturnType<typeof useSellerContext>["seller"]>,
) {
  if (!form.storefront_enabled) {
    return "The storefront is disabled by seller settings.";
  }

  if (seller.is_publicly_available) {
    return "The storefront is publicly available.";
  }

  if (
    seller.storefront_enabled === false &&
    seller.store_status === "live" &&
    ["hosted", "embedded"].includes(seller.storefront_mode)
  ) {
    return "The storefront should become public after these settings are saved.";
  }

  if (seller.store_status !== "live") {
    return `The store status is ${seller.store_status.replaceAll("_", " ")}.`;
  }

  if (!["hosted", "embedded"].includes(seller.storefront_mode)) {
    return "The storefront mode is private.";
  }

  return "The storefront has a platform availability blocker.";
}

function useUnsavedWarning(hasUnsavedChanges: boolean) {
  useEffect(() => {
    if (!hasUnsavedChanges) return;

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = unsavedWarning;
      return unsavedWarning;
    }

    function handleLinkClick(event: MouseEvent) {
      const target = event.target;

      if (!(target instanceof Element)) return;

      const link = target.closest("a[href]");

      if (!(link instanceof HTMLAnchorElement)) return;
      if (link.target && link.target !== "_self") return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      const nextUrl = new URL(link.href);

      if (nextUrl.href === window.location.href) return;

      if (!window.confirm(unsavedWarning)) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleLinkClick, true);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleLinkClick, true);
    };
  }, [hasUnsavedChanges]);
}
