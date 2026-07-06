"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getPlanCapabilities,
  type LockedPlanFeature,
} from "@/lib/plan-capabilities";
import { supabase } from "@/lib/supabase";
import { PlanUpgradeDialog } from "../_components/plan-upgrade-prompt";
import { useSellerContext } from "../_components/seller-context";
import {
  ErrorState,
  LoadingState,
  SellerPageHeader,
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
  pickup_method: "notes" | "manual_options";
  pickup_location_text: string;
  pickup_instructions: string;
  default_pickup_option_id: string;
  pickup_policy: string;
  cancellation_policy: string;
  other_policies: string;
  order_notification_email: string;
  storefront_enabled: boolean;
  hatching_eggs_enabled: boolean;
  equipment_supplies_enabled: boolean;
  processed_poultry_enabled: boolean;
};

type StoreDefaults = {
  store_id: string;
  pickup_method: "notes" | "manual_options" | null;
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

type StoreSetupTab =
  | "storefront"
  | "about"
  | "photos"
  | "what-you-sell"
  | "pickup"
  | "policies"
  | "preview";

type ModulePreferenceField =
  | "hatching_eggs_enabled"
  | "processed_poultry_enabled"
  | "equipment_supplies_enabled";

type ModuleDisableDialogState = {
  field: ModulePreferenceField;
  message: string;
  title: string;
};

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

type SellerLaunchItem = {
  key: string;
  label: string;
  passed: boolean;
  action: string;
};

const unsavedWarning =
  "You have unsaved Store Admin changes. Save or discard before leaving.";

const storeSetupTabs: Array<{ id: StoreSetupTab; label: string }> = [
  { id: "storefront", label: "Storefront" },
  { id: "about", label: "About" },
  { id: "photos", label: "Photos" },
  { id: "what-you-sell", label: "What You Sell" },
  { id: "pickup", label: "Pickup" },
  { id: "policies", label: "Policies" },
  { id: "preview", label: "Preview" },
];

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
  pickup_method: "notes",
  pickup_location_text: "",
  pickup_instructions: "",
  default_pickup_option_id: "",
  pickup_policy: "",
  cancellation_policy: "",
  other_policies: "",
  order_notification_email: "",
  storefront_enabled: false,
  hatching_eggs_enabled: false,
  equipment_supplies_enabled: false,
  processed_poultry_enabled: false,
};

export function StoreAdmin() {
  const { seller, reload } = useSellerContext();
  const plan = getPlanCapabilities(seller?.plan_key);
  const [lockedFeature, setLockedFeature] = useState<LockedPlanFeature | null>(
    null,
  );
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
  const [activeTab, setActiveTab] = useState<StoreSetupTab>("storefront");
  const [moduleDisableDialog, setModuleDisableDialog] =
    useState<ModuleDisableDialogState | null>(null);
  const pendingPickupOptionFocusId = useRef<string | null>(null);
  const pickupOptionRowRefs = useRef(new Map<string, HTMLElement>());
  const pickupOptionDragChangedRef = useRef(false);
  const [draggingPickupOptionId, setDraggingPickupOptionId] = useState<
    string | null
  >(null);
  const [pickupOptionDragPreview, setPickupOptionDragPreview] = useState<{
    label: string;
    width: number;
    x: number;
    y: number;
  } | null>(null);
  const [pendingNavigationUrl, setPendingNavigationUrl] = useState<
    string | null
  >(null);

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
              "store_id, pickup_method, pickup_instructions, pickup_location_text, default_pickup_option_id, default_pickup_option_label, communication_email, order_notification_email, currency",
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

  const openUnsavedNavigationDialog = useCallback((nextUrl: string) => {
    setPendingNavigationUrl(nextUrl);
  }, [setPendingNavigationUrl]);

  useUnsavedWarning(hasUnsavedChanges, openUnsavedNavigationDialog);

  function updateField<TKey extends keyof StoreAdminForm>(
    key: TKey,
    value: StoreAdminForm[TKey],
  ) {
    setSaveState("idle");
    setSaveMessage(null);
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateModulePreference(
    field: ModulePreferenceField,
    value: boolean,
  ) {
    if (!value && form[field]) {
      const warningByField: Record<
        ModulePreferenceField,
        { message: string; title: string }
      > = {
        hatching_eggs_enabled: {
          message:
            "Turning off Hatching Eggs will hide hatching egg listings from your public storefront. Your inventory will be saved, and you can turn this back on later.",
          title: "Turn off Hatching Eggs?",
        },
        processed_poultry_enabled: {
          message:
            "Turning off Processed Poultry will hide processed poultry items from your public storefront. Your inventory will be saved, and you can turn this back on later.",
          title: "Turn off Processed Poultry?",
        },
        equipment_supplies_enabled: {
          message:
            "Turning off Equipment & Supplies will hide those items from your public storefront. Your inventory will be saved, and you can turn this back on later.",
          title: "Turn off Equipment & Supplies?",
        },
      };

      setModuleDisableDialog({
        field,
        ...warningByField[field],
      });
      return;
    }

    updateField(field, value);
  }

  function confirmModuleDisable() {
    if (!moduleDisableDialog) return;

    updateField(moduleDisableDialog.field, false);
    setModuleDisableDialog(null);
  }

  function continuePendingNavigation() {
    if (!pendingNavigationUrl) return;

    window.location.href = pendingNavigationUrl;
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

  function sortPickupOptions(options: PickupOptionDraft[]) {
    return [...options].sort(
      (first, second) =>
        (first.sort_order ?? 0) - (second.sort_order ?? 0) ||
        first.label.localeCompare(second.label),
    );
  }

  function getVisiblePickupOptions(options: PickupOptionDraft[]) {
    return sortPickupOptions(options).filter((option) => option.is_active);
  }

  function normalizePickupOptionsForSave(options: PickupOptionDraft[]) {
    const visibleOptions = getVisiblePickupOptions(options);
    const visibleSortOrderById = new Map(
      visibleOptions.map((option, index) => [option.id, index]),
    );
    let inactiveSortOrder = visibleOptions.length;

    return sortPickupOptions(options).map((option) => {
      if (option.is_active) {
        return {
          ...option,
          sort_order: visibleSortOrderById.get(option.id) ?? option.sort_order,
        };
      }

      const sortOrder = inactiveSortOrder;
      inactiveSortOrder += 1;

      return {
        ...option,
        sort_order: sortOrder,
      };
    });
  }

  function removePickupOption(optionId: string) {
    setSaveState("idle");
    setSaveMessage(null);
    setPickupOptions((current) =>
      current
        .filter((option) => !(option.id === optionId && option.isNew))
        .map((option) =>
          option.id === optionId ? { ...option, is_active: false } : option,
        ),
    );
    if (form.default_pickup_option_id === optionId) {
      updateField("default_pickup_option_id", "");
    }
  }

  function reorderPickupOptionToTarget(optionId: string, targetId: string) {
    setSaveState("idle");
    setSaveMessage(null);
    setPickupOptions((current) => {
      const ordered = getVisiblePickupOptions(current);
      const fromIndex = ordered.findIndex((option) => option.id === optionId);
      const toIndex = ordered.findIndex((option) => option.id === targetId);

      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
        return current;
      }

      const [moved] = ordered.splice(fromIndex, 1);
      ordered.splice(toIndex, 0, moved);
      const sortOrderById = new Map(
        ordered.map((option, index) => [option.id, index]),
      );
      const nextInactiveSortOrder = ordered.length;

      return sortPickupOptions(
        current.map((option) => ({
          ...option,
          sort_order: option.is_active
            ? (sortOrderById.get(option.id) ?? option.sort_order)
            : Math.max(option.sort_order, nextInactiveSortOrder),
        })),
      );
    });
  }

  function beginPickupOptionDrag(
    optionId: string,
    event: React.PointerEvent<HTMLButtonElement>,
  ) {
    const row = pickupOptionRowRefs.current.get(optionId);
    const rect = row?.getBoundingClientRect();
    const option = pickupOptions.find((item) => item.id === optionId);

    event.currentTarget.setPointerCapture(event.pointerId);
    pickupOptionDragChangedRef.current = false;
    setPickupOptionDragPreview({
      label: option?.label.trim() || "Pickup choice",
      width: Math.min(rect?.width ?? 280, 520),
      x: event.clientX + 12,
      y: event.clientY + 12,
    });
    setDraggingPickupOptionId(optionId);
  }

  function movePickupOptionDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (!draggingPickupOptionId) return;

    setPickupOptionDragPreview((current) =>
      current
        ? {
            ...current,
            x: event.clientX + 12,
            y: event.clientY + 12,
          }
        : current,
    );

    const targetId = findPickupOptionIdAtPoint(event.clientX, event.clientY);

    if (!targetId || targetId === draggingPickupOptionId) return;

    pickupOptionDragChangedRef.current = true;
    reorderPickupOptionToTarget(draggingPickupOptionId, targetId);
  }

  function endPickupOptionDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (!draggingPickupOptionId) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (pickupOptionDragChangedRef.current) {
      setSaveState("idle");
      setSaveMessage(null);
    }

    pickupOptionDragChangedRef.current = false;
    setPickupOptionDragPreview(null);
    setDraggingPickupOptionId(null);
  }

  function findPickupOptionIdAtPoint(clientX: number, clientY: number) {
    for (const option of getVisiblePickupOptions(pickupOptions)) {
      const row = pickupOptionRowRefs.current.get(option.id);
      if (!row) continue;

      const rect = row.getBoundingClientRect();

      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        return option.id;
      }
    }

    return null;
  }

  function registerPickupOptionRow(
    optionId: string,
    element: HTMLElement | null,
  ) {
    if (element) {
      pickupOptionRowRefs.current.set(optionId, element);
    } else {
      pickupOptionRowRefs.current.delete(optionId);
    }
  }

  function addPickupOption() {
    const tempId = `new-${crypto.randomUUID()}`;

    pendingPickupOptionFocusId.current = tempId;
    setSaveState("idle");
    setSaveMessage(null);
    setPickupOptions((current) => [
      ...current,
      {
        id: tempId,
        label: "",
        description: "",
        sort_order: getVisiblePickupOptions(current).length,
        is_active: true,
        isNew: true,
      },
    ]);
  }

  function handlePickupOptionInputRef(
    optionId: string,
    element: HTMLInputElement | null,
  ) {
    if (!element || pendingPickupOptionFocusId.current !== optionId) return;

    element.focus();
    pendingPickupOptionFocusId.current = null;
  }

  function discardChanges() {
    setForm(initialForm);
    setPickupOptions(initialPickupOptions);
    pendingPickupOptionFocusId.current = null;
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

    for (const option of normalizePickupOptionsForSave(pickupOptions)) {
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
      hatching_eggs_enabled: form.hatching_eggs_enabled,
      equipment_supplies_enabled: form.equipment_supplies_enabled,
      processed_poultry_enabled: form.processed_poultry_enabled,
    };

    const defaultsPayload = {
      pickup_method: form.pickup_method,
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
      hatching_eggs_enabled: form.hatching_eggs_enabled,
      equipment_supplies_enabled: form.equipment_supplies_enabled,
      processed_poultry_enabled: form.processed_poultry_enabled,
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

    const launchSummary = buildLaunchSummary(readinessItems, form);
    const missingRequired = launchSummary.requiredItems.filter(
      (item) => !item.passed,
    );

    if (missingRequired.length > 0 || launchSummary.platformReviewNeeded) {
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
      "Store launched. Use storefront visibility to decide when customers can see it.",
    );
    await reloadReadiness();
    reload();
  }

  if (isLoading) {
    return (
      <>
        <SellerPageHeader
          title="Store Setup"
          description="Manage your store setup, public details, pickup information, policies, notifications, and storefront preview."
        />
        <div className="mx-auto w-full max-w-7xl px-5 py-5 sm:px-7">
          <LoadingState label="Loading Store Setup" />
        </div>
      </>
    );
  }

  if (loadError || !seller) {
    return (
      <>
        <SellerPageHeader title="Store Setup" />
        <div className="mx-auto w-full max-w-7xl px-5 py-5 sm:px-7">
          <ErrorState
            message={loadError ?? "Store Setup could not be loaded."}
          />
        </div>
      </>
    );
  }

  const launchSummary = buildLaunchSummary(readinessItems, form);
  const sellerRequiredItems = launchSummary.requiredItems;
  const sellerWarningItems = launchSummary.warningItems;
  const platformReviewNeeded = launchSummary.platformReviewNeeded;
  const missingRequiredCount = sellerRequiredItems.filter(
    (item) => !item.passed,
  ).length;
  const launchAllowed =
    seller.store_status === "draft" &&
    missingRequiredCount === 0 &&
    !platformReviewNeeded &&
    !hasUnsavedChanges &&
    !isLaunching;
  const isStoreLive = seller.store_status === "live";
  const isVisibleToCustomers = seller.is_publicly_available;

  return (
    <>
      <SellerPageHeader
        eyebrow={seller.store_name}
        title="Store Setup"
        description="Manage your public storefront setup, pickup flow, policies, and preview link."
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

        <div className="grid gap-0">
          <StoreSetupTabs
            activeTab={activeTab}
            onChange={setActiveTab}
          />
          <div className="rounded-b-xl rounded-tr-xl border border-stone-200 bg-white p-5 shadow-sm">
            {activeTab === "storefront" ? (
              <div className="grid gap-6">
                {isStoreLive ? (
                  <StoreStatusCardContent
                    form={form}
                    isVisibleToCustomers={isVisibleToCustomers}
                    onVisibilityChange={(value) =>
                      updateField("storefront_enabled", value)
                    }
                    storeUrl={storeUrl}
                  />
                ) : (
                  <LaunchStoreCardContent
                    hasUnsavedChanges={hasUnsavedChanges}
                    isLaunching={isLaunching}
                    isReadinessLoading={isReadinessLoading}
                    launchAllowed={launchAllowed}
                    onLaunch={() => void launchStore()}
                    platformReviewNeeded={platformReviewNeeded}
                    readinessError={readinessError}
                    requiredItems={sellerRequiredItems}
                    sellerStatus={seller.store_status}
                    warningItems={sellerWarningItems}
                  />
                )}

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
            ) : null}

            {activeTab === "about" ? (
              <div className="grid gap-6">
                <SettingsSection
                  description="Public story, certifications, and buyer-facing contact details."
                  title="About"
                >
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
                      onChange={(value) =>
                        updateField("show_public_email", value)
                      }
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
                      onChange={(value) =>
                        updateField("show_public_phone", value)
                      }
                    />
                  </div>
                  <TextField
                    helper="Used for seller workflows when different from public contact details."
                    label="Communication email"
                    onChange={(value) =>
                      updateField("communication_email", value)
                    }
                    value={form.communication_email}
                  />
                </SettingsSection>
              </div>
            ) : null}

            {activeTab === "photos" ? (
              <SettingsSection
                description="Store-level photo controls are not wired into Store Admin yet. Existing logo, hero, and gallery media stay preserved."
                title="Photos"
              >
                <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 px-4 py-6 text-sm font-medium leading-6 text-stone-600">
                  No Store Admin photo fields exist in this screen yet.
                </div>
              </SettingsSection>
            ) : null}

            {activeTab === "what-you-sell" ? (
            <SettingsSection
              description="Start with the products you sell now. You can turn on more options later if they're included in your plan."
              title="What You Sell"
            >
              <div className="grid gap-3">
                <ModuleOptionCard
                  description="Chicks, pullets, started birds, breeding groups, and other live poultry."
                  glyph="/glyphs/hen.png"
                  state="always"
                  status="Always included"
                  title="Live Birds"
                />
                <ModuleOptionCard
                  action={
                    plan.hatchingEggsEnabled ? (
                      <ModuleToggle
                        checked={form.hatching_eggs_enabled}
                        onChange={(value) =>
                          updateModulePreference("hatching_eggs_enabled", value)
                        }
                      />
                    ) : (
                      <LockedModuleAction
                        onClick={() => setLockedFeature("hatching_eggs")}
                      />
                    )
                  }
                  description="Let customers order breed-based hatching eggs for local pickup."
                  glyph="/glyphs/egg-carton.png"
                  state={
                    !plan.hatchingEggsEnabled
                      ? "locked"
                      : form.hatching_eggs_enabled
                        ? "enabled"
                        : "disabled"
                  }
                  status={
                    !plan.hatchingEggsEnabled
                      ? "Not included in your current plan."
                      : undefined
                  }
                  title="Hatching Eggs"
                />
                <ModuleOptionCard
                  action={
                    plan.processedPoultryEnabled ? (
                      <ModuleToggle
                        checked={form.processed_poultry_enabled}
                        onChange={(value) =>
                          updateModulePreference(
                            "processed_poultry_enabled",
                            value,
                          )
                        }
                      />
                    ) : (
                      <LockedModuleAction
                        onClick={() => setLockedFeature("processed_poultry")}
                      />
                    )
                  }
                  description="Sell simple local-pickup poultry products by item, quantity, and price."
                  glyph="/glyphs/chicken-leg.png"
                  state={
                    !plan.processedPoultryEnabled
                      ? "locked"
                      : form.processed_poultry_enabled
                        ? "enabled"
                        : "disabled"
                  }
                  status={
                    !plan.processedPoultryEnabled
                      ? "Not included in your current plan."
                      : undefined
                  }
                  title="Processed Poultry"
                />
                <ModuleOptionCard
                  action={
                    plan.equipmentSuppliesEnabled ? (
                      <ModuleToggle
                        checked={form.equipment_supplies_enabled}
                        onChange={(value) =>
                          updateModulePreference(
                            "equipment_supplies_enabled",
                            value,
                          )
                        }
                      />
                    ) : (
                      <LockedModuleAction
                        onClick={() => setLockedFeature("equipment_supplies")}
                      />
                    )
                  }
                  description="Sell basic farm equipment, supplies, and reusable farm items."
                  glyph="/glyphs/incubator.png"
                  state={
                    !plan.equipmentSuppliesEnabled
                      ? "locked"
                      : form.equipment_supplies_enabled
                        ? "enabled"
                        : "disabled"
                  }
                  status={
                    !plan.equipmentSuppliesEnabled
                      ? "Not included in your current plan."
                      : undefined
                  }
                  title="Equipment & Supplies"
                />
              </div>
              <p className="rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-2 text-xs font-medium leading-5 text-emerald-900">
                You can change these anytime. Updates may take a few minutes to
                appear on your storefront.
              </p>
            </SettingsSection>
            ) : null}

            {activeTab === "pickup" ? (
              <div className="grid gap-5">
                <PickupIntro />

                <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(19rem,0.85fr)] lg:items-start">
                  <section className="grid gap-3 border-b border-stone-200 pb-5 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-6">
                    <div>
                      <h2 className="text-lg font-semibold text-stone-950">
                        Pickup method
                      </h2>
                      <p className="mt-1 text-sm leading-6 text-stone-600">
                        Choose how buyers will handle pickup for their orders.
                      </p>
                    </div>
                    <div className="grid gap-3">
                      <PickupMethodRow
                        copy="Buyers enter their preferred pickup time or date in checkout notes. Best for most sellers."
                        glyph="/glyphs/chat.png"
                        onSelect={() => updateField("pickup_method", "notes")}
                        state={form.pickup_method === "notes" ? "current" : "neutral"}
                        title="Buyer requests pickup in notes"
                      />
                      <PickupMethodRow
                        copy="Let buyers choose from a short list of pickup choices, such as Farm pickup, Meet in town, or Text to schedule."
                        glyph="/glyphs/clipboard.png"
                        onSelect={() =>
                          updateField("pickup_method", "manual_options")
                        }
                        state={
                          form.pickup_method === "manual_options"
                            ? "current"
                            : "neutral"
                        }
                        title="Manual pickup dropdown"
                      >
                        {form.pickup_method === "manual_options" ? (
                          <ManualPickupChoiceBuilder
                            dragPreview={pickupOptionDragPreview}
                            draggingPickupOptionId={draggingPickupOptionId}
                            getVisiblePickupOptions={getVisiblePickupOptions}
                            handlePickupOptionInputRef={
                              handlePickupOptionInputRef
                            }
                            onAdd={addPickupOption}
                            onBeginDrag={beginPickupOptionDrag}
                            onEndDrag={endPickupOptionDrag}
                            onLabelChange={(optionId, label) =>
                              updatePickupOption(optionId, { label })
                            }
                            onMoveDrag={movePickupOptionDrag}
                            onRegisterRow={registerPickupOptionRow}
                            onRemove={removePickupOption}
                            pickupOptions={pickupOptions}
                          />
                        ) : null}
                      </PickupMethodRow>
                      <PickupMethodRow
                        badge="Coming soon"
                        copy="Useful if you usually offer the same pickup times each week."
                        glyph="/glyphs/calendar.png"
                        isDisabled
                        state="planned"
                        title="Regular pickup windows"
                      />
                    </div>
                  </section>

                  <section className="grid gap-4">
                    <div>
                      <h2 className="text-lg font-semibold text-stone-950">
                        Pickup details
                      </h2>
                      <p className="mt-1 text-sm leading-6 text-stone-600">
                        Tell buyers where pickup happens and what they should
                        know before they arrive.
                      </p>
                    </div>
                    <TextAreaField
                      compact
                      helper="Examples: Farm pickup in Hotchkiss; pickup at the blue barn; location shared after order confirmation."
                      label="Pickup location"
                      onChange={(value) =>
                        updateField("pickup_location_text", value)
                      }
                      placeholder="Farm pickup in Hotchkiss"
                      rows={3}
                      value={form.pickup_location_text}
                    />
                    <TextAreaField
                      compact
                      helper="Examples: Message before arriving; bring a box or crate for chicks; pickup by appointment only."
                      label="Pickup instructions"
                      onChange={(value) =>
                        updateField("pickup_instructions", value)
                      }
                      rows={3}
                      value={form.pickup_instructions}
                    />
                  </section>
                </div>

                <input
                  readOnly
                  type="hidden"
                  value={form.default_pickup_option_id}
                />
              </div>
            ) : null}

            {activeTab === "policies" ? (
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
            ) : null}

            {activeTab === "preview" ? (
              <SettingsSection
                description="Open or copy the current public storefront URL."
                title="Preview"
              >
                <label className="grid gap-1 text-sm font-semibold text-stone-700">
                  Public store URL
                  <input
                    className="seller-form-field text-xs"
                    readOnly
                    value={storeUrl}
                  />
                </label>
                <div>
                  <Link
                    className="inline-flex min-h-11 items-center justify-center rounded-md bg-emerald-800 px-5 text-sm font-semibold text-white transition hover:bg-emerald-900"
                    href={`/store/${form.store_slug}`}
                    target="_blank"
                  >
                    View Store
                  </Link>
                </div>
              </SettingsSection>
            ) : null}
          </div>
        </div>
      </div>
      {lockedFeature ? (
        <PlanUpgradeDialog
          feature={lockedFeature}
          onClose={() => setLockedFeature(null)}
        />
      ) : null}
      {moduleDisableDialog ? (
        <ModuleDisableDialog
          message={moduleDisableDialog.message}
          onCancel={() => setModuleDisableDialog(null)}
          onConfirm={confirmModuleDisable}
          title={moduleDisableDialog.title}
        />
      ) : null}
      {pendingNavigationUrl ? (
        <UnsavedChangesDialog
          onCancel={() => setPendingNavigationUrl(null)}
          onConfirm={continuePendingNavigation}
        />
      ) : null}
    </>
  );
}

function StoreSetupTabs({
  activeTab,
  onChange,
}: {
  activeTab: StoreSetupTab;
  onChange: (tab: StoreSetupTab) => void;
}) {
  return (
    <div
      aria-label="Store setup sections"
      className="flex gap-1 overflow-x-auto border-b border-stone-200 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="tablist"
    >
      {storeSetupTabs.map((tab) => {
        const isActive = activeTab === tab.id;

        return (
          <button
            aria-selected={isActive}
            className={`relative mb-[-1px] min-h-11 shrink-0 rounded-t-lg border px-4 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 ${
              isActive
                ? "border-stone-200 border-b-white bg-white text-stone-950 shadow-[0_-1px_0_rgba(0,0,0,0.02)]"
                : "border-transparent bg-stone-100/70 text-stone-600 hover:bg-white hover:text-stone-950"
            }`}
            key={tab.id}
            onClick={() => onChange(tab.id)}
            role="tab"
            type="button"
          >
            {tab.label}
          </button>
        );
      })}
    </div>
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
    <section className="grid gap-4 border-b border-stone-200 pb-6 last:border-b-0 last:pb-0">
      <div>
        <h2 className="text-lg font-semibold text-stone-950">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-stone-600">
          {description}
        </p>
      </div>
      <div className="grid gap-4">{children}</div>
    </section>
  );
}

function PickupIntro() {
  return (
    <section className="rounded-lg border border-stone-200 bg-stone-50/70 px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white ring-1 ring-stone-200">
          <Image
            alt=""
            className="object-contain"
            height={20}
            src="/glyphs/map-pin.png"
            width={20}
          />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-stone-950">
            How should buyers handle pickup?
          </p>
          <p className="text-sm leading-6 text-stone-700">
            Most sellers can start simple: buyers request a pickup time in
            checkout notes, and you confirm the details after the order comes in.
          </p>
        </div>
      </div>
    </section>
  );
}

function PickupMethodRow({
  badge,
  children,
  copy,
  glyph,
  isDisabled = false,
  onSelect,
  state,
  title,
}: {
  badge?: string;
  children?: React.ReactNode;
  copy: string;
  glyph: string;
  isDisabled?: boolean;
  onSelect?: () => void;
  state: "current" | "planned" | "neutral";
  title: string;
}) {
  const isCurrent = state === "current";
  const isPlanned = state === "planned";

  return (
    <div
      className={`overflow-hidden rounded-lg border transition ${
        isCurrent
          ? "border-emerald-200 bg-emerald-50/35"
          : isPlanned
            ? "border-stone-200 bg-stone-50/80 opacity-85"
            : "border-stone-200 bg-white hover:border-emerald-200 hover:bg-emerald-50/20"
      }`}
    >
      <button
        aria-checked={isCurrent}
        className={`grid w-full gap-2 px-3 py-3 text-left sm:items-center ${
          badge
            ? "sm:grid-cols-[minmax(0,1fr)_6.75rem]"
            : "sm:grid-cols-[minmax(0,1fr)_2rem]"
        }`}
        disabled={isDisabled}
        onClick={onSelect}
        role="radio"
        type="button"
      >
        <div className="flex min-w-0 gap-2.5">
          <span className="pt-2">
            <PickupMethodRadio
              isChecked={isCurrent}
              isDisabled={isDisabled}
            />
          </span>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-stone-100 ring-1 ring-stone-200">
            <Image
              alt=""
              className="object-contain"
              height={22}
              src={glyph}
              width={22}
            />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-stone-950">{title}</h3>
            <p className="mt-0.5 text-xs leading-5 text-stone-600">{copy}</p>
          </div>
        </div>
        {badge ? (
          <div className="flex items-center justify-between gap-2 sm:justify-end">
            <span
              className={`inline-flex min-h-6 items-center rounded-full px-2.5 text-xs font-semibold ${
                isCurrent
                  ? "bg-emerald-100 text-emerald-900"
                  : isPlanned
                    ? "bg-stone-100 text-stone-500"
                    : "bg-stone-100 text-stone-600"
              }`}
            >
              {badge}
            </span>
          </div>
        ) : null}
      </button>
      {children ? (
        <div className="border-t border-emerald-100 bg-white/75 px-3 py-3">
          {children}
        </div>
      ) : null}
    </div>
  );
}

function PickupMethodRadio({
  isChecked,
  isDisabled,
}: {
  isChecked: boolean;
  isDisabled: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex size-5 shrink-0 items-center justify-center rounded-full border transition ${
        isChecked
          ? "border-emerald-700 bg-white"
          : isDisabled
            ? "border-stone-300 bg-stone-100"
            : "border-stone-300 bg-white"
      }`}
    >
      {isChecked ? (
        <span className="size-2.5 rounded-full bg-emerald-700" />
      ) : null}
    </span>
  );
}

function ManualPickupChoiceBuilder({
  dragPreview,
  draggingPickupOptionId,
  getVisiblePickupOptions,
  handlePickupOptionInputRef,
  onAdd,
  onBeginDrag,
  onEndDrag,
  onLabelChange,
  onMoveDrag,
  onRegisterRow,
  onRemove,
  pickupOptions,
}: {
  dragPreview: {
    label: string;
    width: number;
    x: number;
    y: number;
  } | null;
  draggingPickupOptionId: string | null;
  getVisiblePickupOptions: (
    options: PickupOptionDraft[],
  ) => PickupOptionDraft[];
  handlePickupOptionInputRef: (
    optionId: string,
    element: HTMLInputElement | null,
  ) => void;
  onAdd: () => void;
  onBeginDrag: (
    optionId: string,
    event: React.PointerEvent<HTMLButtonElement>,
  ) => void;
  onEndDrag: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onLabelChange: (optionId: string, label: string) => void;
  onMoveDrag: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onRegisterRow: (optionId: string, element: HTMLElement | null) => void;
  onRemove: (optionId: string) => void;
  pickupOptions: PickupOptionDraft[];
}) {
  const visibleOptions = getVisiblePickupOptions(pickupOptions);

  return (
    <div className="grid gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-stone-950">
            Dropdown choices
          </p>
          <p className="mt-0.5 text-xs leading-5 text-stone-600">
            Create the short choices buyers will see at checkout.
          </p>
        </div>
        <button
          className="seller-small-button w-full sm:w-auto"
          onClick={onAdd}
          type="button"
        >
          + Add new
        </button>
      </div>
      <p className="text-xs font-medium leading-5 text-stone-500">
        Examples: Tuesday, July 7 at 9am; Meet in town; Text to schedule.
      </p>
      {visibleOptions.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 bg-stone-50 px-3 py-3 text-sm text-stone-600">
          No manual pickup choices yet.
        </p>
      ) : (
        <div className="grid gap-2">
          {visibleOptions.map((option) => (
            <PickupChoiceRow
              inputRef={(element) =>
                handlePickupOptionInputRef(option.id, element)
              }
              isDragging={draggingPickupOptionId === option.id}
              key={option.id}
              onDragHandlePointerCancel={onEndDrag}
              onDragHandlePointerDown={(event) =>
                onBeginDrag(option.id, event)
              }
              onDragHandlePointerMove={onMoveDrag}
              onDragHandlePointerUp={onEndDrag}
              onLabelChange={(label) => onLabelChange(option.id, label)}
              onRemove={() => onRemove(option.id)}
              option={option}
              rowRef={(element) => onRegisterRow(option.id, element)}
            />
          ))}
        </div>
      )}
      {dragPreview ? <PickupChoiceDragPreview preview={dragPreview} /> : null}
    </div>
  );
}

function PickupChoiceDragPreview({
  preview,
}: {
  preview: {
    label: string;
    width: number;
    x: number;
    y: number;
  };
}) {
  return (
    <div
      className="pointer-events-none fixed z-50 rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-stone-950 shadow-lg"
      style={{
        left: preview.x,
        top: preview.y,
        width: preview.width,
      }}
    >
      {preview.label}
    </div>
  );
}

function PickupChoiceRow({
  inputRef,
  isDragging,
  onLabelChange,
  onDragHandlePointerCancel,
  onDragHandlePointerDown,
  onDragHandlePointerMove,
  onDragHandlePointerUp,
  onRemove,
  option,
  rowRef,
}: {
  inputRef: (element: HTMLInputElement | null) => void;
  isDragging: boolean;
  onLabelChange: (label: string) => void;
  onDragHandlePointerCancel: (
    event: React.PointerEvent<HTMLButtonElement>,
  ) => void;
  onDragHandlePointerDown: (
    event: React.PointerEvent<HTMLButtonElement>,
  ) => void;
  onDragHandlePointerMove: (
    event: React.PointerEvent<HTMLButtonElement>,
  ) => void;
  onDragHandlePointerUp: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onRemove: () => void;
  option: PickupOptionDraft;
  rowRef: (element: HTMLDivElement | null) => void;
}) {
  return (
    <div className="grid gap-1">
      <div
        className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md border bg-white px-2.5 py-2 transition ${
          isDragging
            ? "border-emerald-300 bg-emerald-50/40 shadow-sm"
            : "border-stone-200"
        }`}
        ref={rowRef}
      >
        <button
          aria-label="Drag to reorder pickup choice"
          className="inline-flex size-10 touch-none cursor-grab items-center justify-center rounded-md border border-stone-200 bg-stone-50 text-lg font-semibold leading-none text-stone-400 transition hover:border-stone-300 hover:bg-stone-100 active:cursor-grabbing active:border-emerald-300 active:bg-emerald-50 active:text-emerald-800"
          onPointerCancel={onDragHandlePointerCancel}
          onPointerDown={onDragHandlePointerDown}
          onPointerMove={onDragHandlePointerMove}
          onPointerUp={onDragHandlePointerUp}
          type="button"
        >
          ⋮⋮
        </button>
        <input
          className="min-h-10 rounded-md border border-stone-200 bg-stone-50/70 px-3 text-sm font-medium text-stone-950 outline-none transition placeholder:text-stone-400 focus:border-emerald-700 focus:bg-white focus:ring-2 focus:ring-emerald-700/15"
          onChange={(event) => onLabelChange(event.target.value)}
          placeholder="Tuesday, July 7 at 9am"
          ref={inputRef}
          value={option.label}
        />
        <button
          aria-label="Remove pickup choice"
          className="inline-flex min-h-10 items-center justify-center rounded-md border border-stone-200 bg-white px-3 text-sm font-semibold text-stone-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700"
          onClick={onRemove}
          type="button"
        >
          Remove
        </button>
      </div>
      {option.label !== option.label.trim() ? (
        <p className="px-2 text-xs font-medium text-stone-500">
          Extra spaces will be cleaned up when you save.
        </p>
      ) : null}
    </div>
  );
}

function ModuleOptionCard({
  action,
  description,
  glyph,
  state,
  status,
  title,
}: {
  action?: React.ReactNode;
  description: string;
  glyph: string;
  state: "always" | "enabled" | "disabled" | "locked";
  status?: string;
  title: string;
}) {
  const isLocked = state === "locked";
  const isAlways = state === "always";

  return (
    <div
      className={`grid gap-2.5 rounded-lg border p-2.5 transition sm:grid-cols-[minmax(0,1fr)_13.5rem] sm:items-center ${
        isAlways
          ? "border-emerald-100 bg-emerald-50/40"
          : isLocked
            ? "border-stone-200 bg-stone-50"
            : "border-stone-200 bg-white"
      }`}
    >
      <div className="flex min-w-0 gap-2.5">
        <span
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-stone-100 ring-1 ring-stone-200"
        >
          <Image
            alt=""
            className="object-contain"
            height={28}
            src={glyph}
            width={28}
          />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-stone-950">{title}</h3>
          </div>
          <p className="mt-0.5 text-sm leading-5 text-stone-600">
            {description}
          </p>
        </div>
      </div>

      <div className="grid gap-2 border-stone-200 sm:border-l sm:pl-3">
        <div className="flex items-center justify-end gap-3">
          {status ? (
            state === "always" ? (
              <div className="flex items-center gap-2">
                <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-emerald-700 text-xs font-bold text-emerald-800">
                  &#10003;
                </span>
                <p className="text-sm font-semibold leading-5 text-stone-800">
                  {status}
                </p>
              </div>
            ) : (
              <p
                className={`text-sm font-semibold leading-5 ${
                  isLocked ? "text-stone-600" : "text-stone-800"
                }`}
              >
                {status}
              </p>
            )
          ) : null}
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      </div>
    </div>
  );
}

function ModuleToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-stone-700">
      <span>{checked ? "Enabled" : "Disabled"}</span>
      <span
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
          checked ? "bg-emerald-700" : "bg-stone-300"
        }`}
      >
        <input
          checked={Boolean(checked)}
          className="sr-only"
          onChange={(event) => onChange(event.target.checked)}
          type="checkbox"
        />
        <span
          className={`absolute size-5 rounded-full bg-white shadow-sm transition ${
            checked ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </span>
    </label>
  );
}

function ModuleDisableDialog({
  message,
  onCancel,
  onConfirm,
  title,
}: {
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
}) {
  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/45 px-4 py-6"
      role="dialog"
    >
      <div className="w-full max-w-md rounded-xl border border-stone-200 bg-white p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-amber-200 bg-amber-50 text-lg font-bold text-amber-800"
          >
            !
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold leading-6 text-stone-950">
              {title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-stone-700">
              {message}
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            className="seller-secondary-button"
            type="button"
            onClick={onCancel}
          >
            Keep showing it
          </button>
          <button
            className="inline-flex min-h-10 items-center justify-center rounded-md bg-emerald-800 px-4 text-sm font-semibold text-white transition hover:bg-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
            type="button"
            onClick={onConfirm}
          >
            Turn off
          </button>
        </div>
      </div>
    </div>
  );
}

function UnsavedChangesDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/45 px-4 py-6"
      role="dialog"
    >
      <div className="w-full max-w-md rounded-xl border border-stone-200 bg-white p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-emerald-100 bg-emerald-50 text-lg font-bold text-emerald-800"
          >
            !
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold leading-6 text-stone-950">
              Save changes before leaving?
            </h2>
            <p className="mt-2 text-sm leading-6 text-stone-700">
              You have unsaved Store Setup changes. Save or discard your changes
              before leaving this page.
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            className="seller-secondary-button"
            type="button"
            onClick={onConfirm}
          >
            Leave without saving
          </button>
          <button
            className="inline-flex min-h-10 items-center justify-center rounded-md bg-emerald-800 px-4 text-sm font-semibold text-white transition hover:bg-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
            type="button"
            onClick={onCancel}
          >
            Stay here
          </button>
        </div>
      </div>
    </div>
  );
}

function LockedModuleAction({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="inline-flex min-h-8 items-center rounded-md border border-stone-300 bg-white px-2.5 text-xs font-semibold text-emerald-900 transition hover:border-emerald-700 hover:text-emerald-950 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
      type="button"
      onClick={onClick}
    >
      View plans
    </button>
  );
}

function LaunchStoreCardContent({
  hasUnsavedChanges,
  isLaunching,
  isReadinessLoading,
  launchAllowed,
  onLaunch,
  platformReviewNeeded,
  readinessError,
  requiredItems,
  sellerStatus,
  warningItems,
}: {
  hasUnsavedChanges: boolean;
  isLaunching: boolean;
  isReadinessLoading: boolean;
  launchAllowed: boolean;
  onLaunch: () => void;
  platformReviewNeeded: boolean;
  readinessError: string | null;
  requiredItems: SellerLaunchItem[];
  sellerStatus: string;
  warningItems: SellerLaunchItem[];
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-start">
      <div className="grid gap-4">
        <div>
          <h2 className="text-xl font-semibold text-stone-950">
            Launch your store
          </h2>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            Before customers can view your store, finish the required setup
            items below.
          </p>
        </div>

        {readinessError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
            Readiness could not be checked. Please try again.
          </div>
        ) : null}

        {platformReviewNeeded ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
            Something needs platform review before this store can launch.
            Contact support or an admin.
          </div>
        ) : null}

        {sellerStatus !== "draft" ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
            This store cannot be launched from its current status.
          </div>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {requiredItems.map((item) => (
            <SellerReadinessRow item={item} key={item.key} />
          ))}
        </div>

        {warningItems.some((item) => !item.passed) ? (
          <div className="grid gap-2 border-t border-stone-200 pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              Optional polish
            </p>
            <div className="flex flex-wrap gap-2">
              {warningItems
                .filter((item) => !item.passed)
                .map((item) => (
                  <span
                    className="rounded-md bg-stone-100 px-3 py-2 text-xs font-medium text-stone-600"
                    key={item.key}
                  >
                    {item.action}
                  </span>
                ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="grid gap-2 lg:min-w-52">
        <button
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-stone-950 px-5 text-sm font-semibold text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-400"
          disabled={!launchAllowed}
          onClick={onLaunch}
          type="button"
        >
          {isLaunching ? "Launching..." : "Launch Store"}
        </button>
        {hasUnsavedChanges ? (
          <p className="text-xs font-medium leading-5 text-amber-800">
            Save or discard Store Admin changes before launching.
          </p>
        ) : null}
        {isReadinessLoading ? (
          <p className="text-xs font-medium leading-5 text-stone-500">
            Checking setup...
          </p>
        ) : null}
      </div>
    </div>
  );
}

function StoreStatusCardContent({
  form,
  isVisibleToCustomers,
  onVisibilityChange,
  storeUrl,
}: {
  form: StoreAdminForm;
  isVisibleToCustomers: boolean;
  onVisibilityChange: (value: boolean) => void;
  storeUrl: string;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-start">
      <div className="grid gap-3">
        <div>
          <h2 className="text-xl font-semibold text-stone-950">
            Your store is live
          </h2>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            {isVisibleToCustomers
              ? "Customers can currently view your storefront."
              : "Your store is live, but hidden from customers."}
          </p>
        </div>
        <ToggleField
          checked={form.storefront_enabled}
          label="Make storefront visible to customers"
          onChange={onVisibilityChange}
        />
        <label className="grid gap-1 text-sm font-semibold text-stone-700">
          Public store URL
          <input
            className="seller-form-field text-xs"
            readOnly
            value={storeUrl}
          />
        </label>
      </div>
      <div className="grid gap-2 lg:min-w-44">
        <Link
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-emerald-800 px-5 text-sm font-semibold text-white transition hover:bg-emerald-900"
          href={`/store/${form.store_slug}`}
          target="_blank"
        >
          View Store
        </Link>
        {form.storefront_enabled ? (
          <button
            className="seller-secondary-button"
            onClick={() => onVisibilityChange(false)}
            type="button"
          >
            Hide Storefront
          </button>
        ) : (
          <button
            className="seller-secondary-button"
            onClick={() => onVisibilityChange(true)}
            type="button"
          >
            Turn on Storefront
          </button>
        )}
      </div>
    </div>
  );
}

function SellerReadinessRow({ item }: { item: SellerLaunchItem }) {
  return (
    <div
      className={`rounded-lg border px-3 py-3 ${
        item.passed
          ? "border-emerald-100 bg-emerald-50/70"
          : "border-stone-200 bg-stone-50"
      }`}
    >
      <p className="text-sm font-semibold text-stone-950">
        <span
          className={
            item.passed
              ? "mr-2 text-emerald-700"
              : "mr-2 text-stone-400"
          }
        >
          {item.passed ? "\u2713" : "\u25cb"}
        </span>
        {item.label}
      </p>
      {!item.passed ? (
        <p className="mt-1 text-xs font-medium leading-5 text-stone-600">
          {item.action}
        </p>
      ) : null}
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
  compact = false,
  helper,
  label,
  onChange,
  placeholder,
  rows = 4,
  value,
}: {
  compact?: boolean;
  helper?: string;
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  value: string;
}) {
  return (
    <label className="grid gap-1 text-sm font-semibold text-stone-700">
      {label}
      <textarea
        className={`seller-form-field resize-y py-3 ${
          compact ? "min-h-20" : "min-h-28"
        }`}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={rows}
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
        checked={Boolean(checked)}
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
    pickup_method:
      defaults?.pickup_method === "manual_options" ? "manual_options" : "notes",
    pickup_location_text: defaults?.pickup_location_text ?? "",
    pickup_instructions:
      defaults?.pickup_instructions ?? seller.pickup_instructions ?? "",
    default_pickup_option_id: defaults?.default_pickup_option_id ?? "",
    pickup_policy: seller.pickup_policy ?? "",
    cancellation_policy: seller.cancellation_policy ?? "",
    other_policies: seller.other_policies ?? "",
    order_notification_email:
      defaults?.order_notification_email ?? seller.order_notification_email ?? "",
    storefront_enabled: Boolean(seller.storefront_enabled),
    hatching_eggs_enabled: Boolean(seller.hatching_eggs_enabled),
    equipment_supplies_enabled: Boolean(seller.equipment_supplies_enabled),
    processed_poultry_enabled: Boolean(seller.processed_poultry_enabled),
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

function buildLaunchSummary(
  readinessItems: LaunchReadinessItem[],
  form: StoreAdminForm,
) {
  const readiness = new Map(
    readinessItems.map((item) => [item.item_key, item]),
  );
  const isReady = (key: string) => readiness.get(key)?.passed === true;
  const hasPickupDetails =
    Boolean(form.pickup_location_text.trim()) ||
    Boolean(form.pickup_instructions.trim());
  const platformReviewNeeded = [
    "store_exists",
    "seller_owns_store",
    "no_admin_hold",
  ].some((key) => readiness.has(key) && !isReady(key));
  const storeStatusBlocked =
    readiness.has("store_status_draft") && !isReady("store_status_draft");
  const requiredItems: SellerLaunchItem[] = [
    {
      key: "store-profile",
      label: "Store profile",
      passed: isReady("store_name_present") && isReady("store_slug_present"),
      action: "Add your store name and store URL.",
    },
    {
      key: "location",
      label: "Location",
      passed: isReady("location_present"),
      action: "Add your city and state.",
    },
    {
      key: "pickup-details",
      label: "Pickup details",
      passed: hasPickupDetails,
      action: "Add pickup details.",
    },
    {
      key: "billing-terms",
      label: "Billing and terms",
      passed: isReady("terms_accepted") && isReady("billing_access_active"),
      action: "Finish billing and seller terms.",
    },
    {
      key: "available-inventory",
      label: "Available inventory",
      passed: isReady("saleable_inventory"),
      action: "Publish at least one listing with available quantity.",
    },
  ];
  const warningItems: SellerLaunchItem[] = [
    {
      key: "store-image",
      label: "Store image",
      passed: isReady("store_image_present"),
      action: "Add a logo or store image.",
    },
    {
      key: "about-section",
      label: "About section",
      passed: isReady("about_text_present"),
      action: "Add an about section.",
    },
    {
      key: "public-email",
      label: "Public email",
      passed: isReady("public_email_present"),
      action: "Add a public email.",
    },
    {
      key: "inventory-quantity",
      label: "Inventory quantity",
      passed: isReady("inventory_quantity"),
      action: "Add more available quantity when you can.",
    },
  ];

  return {
    platformReviewNeeded: platformReviewNeeded || storeStatusBlocked,
    requiredItems,
    warningItems,
  };
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
    if (option.is_active && !option.isNew && !option.label.trim()) {
      return "Each visible pickup choice needs a label.";
    }
  }

  return null;
}

function useUnsavedWarning(
  hasUnsavedChanges: boolean,
  onBlockedNavigation: (nextUrl: string) => void,
) {
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

      event.preventDefault();
      event.stopPropagation();
      onBlockedNavigation(nextUrl.href);
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleLinkClick, true);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleLinkClick, true);
    };
  }, [hasUnsavedChanges, onBlockedNavigation]);
}
