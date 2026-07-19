"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPlanCapabilities } from "@/lib/plan-capabilities";
import { supabase } from "@/lib/supabase";
import { PlanUpgradePrompt } from "../../../../_components/plan-upgrade-prompt";
import { useSellerContext } from "../../../../_components/seller-context";
import {
  DashboardPageContent,
  ErrorState,
  LoadingState,
  SellerCard,
} from "../../../../_components/seller-ui";
import type {
  ReferenceSpecies,
  SellerInventoryManagementRow,
} from "../../../../_lib/seller-types";
import {
  PhotoManager,
  type DashboardPhoto,
} from "../../../../_components/photo-manager";
import {
  ListingPhotosSection,
  type ListingPhotoItem,
} from "../../../[listingBatchId]/listing-photos-section";
import {
  formatCurrency,
  formatDate,
  isPositiveWholeNumber,
  isValidMoney,
  listingInventorySelect,
  MoneyInput,
  sellerMediaSelect,
  ValidationMessage,
} from "../../_components/creation-wizard-shared";
import { SectionCard } from "../../../../inventory/add-v2/live-birds/SectionCard";
import {
  SidebarCard,
  SummaryRow,
} from "../../../../inventory/add-v2/live-birds/SidebarCard";
import {
  PublishInventoryButton,
  SaveDraftButton,
  type PublishStatus,
  type SaveDraftStatus,
} from "../../../../inventory/add-v2/live-birds/ReviewPublishCard";
import { inputClass } from "../../../../inventory/add-v2/live-birds/constants";

type HatchingEggFormState = {
  availableDate: string;
  breedName: string;
  description: string;
  minimumOrderQuantity: string;
  pricePerEgg: string;
  quantity: string;
  speciesId: string;
};

type CreateListingBatchResult = {
  listing_batch_id: string;
};

type BreedProfileUpsertResult = {
  seller_breed_profile_id?: string | null;
};

type SaveDraftResult =
  | { ok: true; listingBatchId: string; inventoryItemId: string }
  | { ok: false; message: string };

type PendingPhoto = {
  file: File;
  id: string;
  url: string;
};

type UploadResponse = {
  media?: ListingPhotoItem | null;
  error?: {
    code?: string;
    message?: string;
  };
};

type HatchingEggsOnePageFormProps = {
  initialListingBatchId?: string;
};

const emptyForm: HatchingEggFormState = {
  availableDate: "",
  breedName: "",
  description: "",
  minimumOrderQuantity: "",
  pricePerEgg: "",
  quantity: "",
  speciesId: "",
};

const publicDescriptionMaxLength = 1000;
const acceptedPendingImageTypes = ["image/jpeg", "image/png", "image/webp"] as const;
const maxPendingImageSizeBytes = 8 * 1024 * 1024;
const maxHatchingEggPhotos = 4;

export function HatchingEggsOnePageForm({
  initialListingBatchId = "",
}: HatchingEggsOnePageFormProps) {
  const router = useRouter();
  const { seller } = useSellerContext();
  const plan = getPlanCapabilities(seller?.plan_key);
  const storeId = seller?.store_id ?? "";
  const hatchingEggsEnabled =
    Boolean(seller?.hatching_eggs_enabled) && plan.hatchingEggsEnabled;
  const [species, setSpecies] = useState<ReferenceSpecies[]>([]);
  const [form, setForm] = useState<HatchingEggFormState>(emptyForm);
  const [listingBatchId, setListingBatchId] = useState(initialListingBatchId);
  const [listingBatchBreedId, setListingBatchBreedId] = useState("");
  const [inventoryItemId, setInventoryItemId] = useState("");
  const [sellerBreedProfileId, setSellerBreedProfileId] = useState("");
  const [draftRows, setDraftRows] = useState<SellerInventoryManagementRow[]>(
    [],
  );
  const [mediaItems, setMediaItems] = useState<ListingPhotoItem[]>([]);
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [savedFormSnapshot, setSavedFormSnapshot] = useState<string | null>(
    null,
  );
  const pendingPhotosRef = useRef<PendingPhoto[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [saveDraftStatus, setSaveDraftStatus] =
    useState<SaveDraftStatus>("idle");
  const [publishStatus, setPublishStatus] = useState<PublishStatus>("idle");
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isStartOverDialogOpen, setIsStartOverDialogOpen] = useState(false);
  const isEditMode = Boolean(initialListingBatchId);

  useEffect(() => {
    if (!storeId || !hatchingEggsEnabled) return;

    let isMounted = true;

    async function loadSpecies() {
      setIsLoading(true);
      setLoadError(null);

      const result = await supabase
        .from("species")
        .select("id, common_name, slug, sort_order")
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("common_name", { ascending: true })
        .returns<ReferenceSpecies[]>();

      if (!isMounted) return;

      if (result.error) {
        setLoadError(result.error.message);
        setSpecies([]);
        setIsLoading(false);
        return;
      }

      const loadedSpecies = result.data ?? [];
      const defaultSpecies =
        loadedSpecies.find((item) => item.slug === "chicken") ??
        loadedSpecies[0] ??
        null;

      setSpecies(loadedSpecies);
      setForm((current) => ({
        ...current,
        speciesId: current.speciesId || defaultSpecies?.id || "",
      }));
      setIsLoading(false);
    }

    void loadSpecies();

    return () => {
      isMounted = false;
    };
  }, [hatchingEggsEnabled, storeId]);

  useEffect(() => {
    pendingPhotosRef.current = pendingPhotos;
  }, [pendingPhotos]);

  useEffect(() => {
    return () => {
      pendingPhotosRef.current.forEach((photo) =>
        URL.revokeObjectURL(photo.url),
      );
    };
  }, []);

  const selectedSpecies = species.find((item) => item.id === form.speciesId);
  const publicDescription = useMemo(() => buildPublicDescription(form), [form]);
  const formSnapshot = useMemo(() => getFormSnapshot(form), [form]);
  const activePhotoCount = mediaItems.filter(
    (item) =>
      item.visibility_status === "active" &&
      item.asset_status === "active" &&
      item.moderation_status === "approved",
  ).length + pendingPhotos.length;
  const listingDetailsComplete = validateListingDetails(form).length === 0;
  const descriptionComplete = publicDescription.trim().length > 0;
  const publishDisabledReason = getPublishDisabledReason({
    isPublishing: publishStatus === "publishing",
    listingDetailsComplete,
  });
  const saveDraftDisabledReason =
    saveDraftStatus === "saving" || publishStatus === "publishing"
      ? "Save already in progress."
      : null;
  const hasUnsavedChanges =
    pendingPhotos.length > 0 ||
    (savedFormSnapshot !== null
      ? formSnapshot !== savedFormSnapshot
      : hasStartedForm(form));

  useEffect(() => {
    if (!hasUnsavedChanges) return;

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;

    function handleDocumentClick(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target;

      if (!(target instanceof Element)) return;

      const link = target.closest("a");

      if (!link) return;

      const href = link.getAttribute("href");
      const targetAttribute = link.getAttribute("target");

      if (
        !href ||
        href.startsWith("#") ||
        href.startsWith("mailto:") ||
        href.startsWith("tel:") ||
        targetAttribute === "_blank" ||
        link.hasAttribute("download")
      ) {
        return;
      }

      const destination = new URL(href, window.location.href);

      if (destination.origin !== window.location.origin) return;
      if (destination.pathname === window.location.pathname) return;

      const shouldLeave = window.confirm(
        "Leave without saving this hatching egg listing?",
      );

      if (!shouldLeave) {
        event.preventDefault();
      }
    }

    document.addEventListener("click", handleDocumentClick, true);

    return () => {
      document.removeEventListener("click", handleDocumentClick, true);
    };
  }, [hasUnsavedChanges]);

  function updateForm(updates: Partial<HatchingEggFormState>) {
    setForm((current) => ({ ...current, ...updates }));
    setValidationErrors([]);
    setActionError(null);
    setActionMessage(null);
    if (saveDraftStatus === "success") setSaveDraftStatus("idle");
    if (publishStatus === "success") setPublishStatus("idle");
  }

  const loadDraftRows = useCallback(
    async (currentListingBatchId: string) => {
      if (!storeId) return [];

      const listingResult = await supabase
        .from("seller_inventory_management")
        .select(listingInventorySelect)
        .eq("store_id", storeId)
        .eq("listing_batch_id", currentListingBatchId)
        .order("listing_batch_breed_sort_order", { ascending: true })
        .order("inventory_item_sort_order", { ascending: true })
        .returns<SellerInventoryManagementRow[]>();

      if (listingResult.error) {
        setActionError(listingResult.error.message);
        return [];
      }

      const rows = listingResult.data ?? [];
      setDraftRows(rows);
      setInventoryItemId(rows[0]?.inventory_item_id ?? "");
      setSellerBreedProfileId(rows[0]?.seller_breed_profile_id ?? "");
      return rows;
    },
    [storeId],
  );

  const loadInventoryItemMedia = useCallback(
    async (currentInventoryItemId: string) => {
      if (!storeId || !currentInventoryItemId) return;

      const mediaResult = await supabase
        .from("seller_media_management")
        .select(sellerMediaSelect)
        .eq("store_id", storeId)
        .eq("entity_type", "inventory_item")
        .eq("entity_id", currentInventoryItemId)
        .returns<ListingPhotoItem[]>();

      if (mediaResult.error) {
        setActionError(mediaResult.error.message);
        return;
      }

      setMediaItems(mediaResult.data ?? []);
    },
    [storeId],
  );

  useEffect(() => {
    if (!storeId || !hatchingEggsEnabled || !initialListingBatchId) return;

    let isMounted = true;

    async function loadExistingHatchingEggs() {
      setIsLoading(true);
      setLoadError(null);

      const rows = await loadDraftRows(initialListingBatchId);
      const firstRow = rows[0];

      if (!isMounted) return;

      if (!firstRow || firstRow.batch_type !== "hatching_eggs") {
        setLoadError("This hatching egg listing could not be found.");
        setIsLoading(false);
        return;
      }

      const parsedDescription = parseHatchingEggDescription(
        firstRow.breed_description ?? "",
      );
      const loadedForm: HatchingEggFormState = {
        availableDate: firstRow.available_date ?? "",
        breedName: firstRow.breed_display_name ?? "",
        description: parsedDescription.description,
        minimumOrderQuantity: parsedDescription.minimumOrderQuantity,
        pricePerEgg:
          firstRow.base_price === null || firstRow.base_price === undefined
            ? ""
            : String(firstRow.base_price),
        quantity:
          firstRow.quantity_available === null ||
          firstRow.quantity_available === undefined
            ? ""
            : String(firstRow.quantity_available),
        speciesId: firstRow.species_id,
      };

      setListingBatchId(firstRow.listing_batch_id);
      setListingBatchBreedId(firstRow.listing_batch_breed_id);
      setInventoryItemId(firstRow.inventory_item_id);
      setForm(loadedForm);
      setSavedFormSnapshot(getFormSnapshot(loadedForm));
      setActionMessage(null);
      setActionError(null);
      await loadInventoryItemMedia(firstRow.inventory_item_id);

      if (isMounted) setIsLoading(false);
    }

    void loadExistingHatchingEggs();

    return () => {
      isMounted = false;
    };
  }, [
    hatchingEggsEnabled,
    initialListingBatchId,
    loadDraftRows,
    loadInventoryItemMedia,
    storeId,
  ]);

  function addPendingPhotos(files: FileList | null) {
    if (!files || files.length === 0) return;

    const selectedFiles = Array.from(files);
    const availableSlots =
      maxHatchingEggPhotos - activePhotoCount;

    setPhotoError(null);

    if (selectedFiles.length > availableSlots) {
      setPhotoError(
        availableSlots <= 0
          ? "You've added the maximum of 4 photos."
          : `You can add ${availableSlots} more photo${
              availableSlots === 1 ? "" : "s"
            }.`,
      );
      return;
    }

    const validationError = validatePendingPhotoFiles(selectedFiles);

    if (validationError) {
      setPhotoError(validationError);
      return;
    }

    const nextPhotos = selectedFiles.map((file) => ({
      file,
      id: crypto.randomUUID(),
      url: URL.createObjectURL(file),
    }));

    setPendingPhotos((current) => [...current, ...nextPhotos]);
    setSaveDraftStatus("idle");
    setPublishStatus("idle");
    setActionMessage(null);
    setActionError(null);
  }

  function removePendingPhoto(photo: PendingPhoto) {
    URL.revokeObjectURL(photo.url);
    setPendingPhotos((current) =>
      current.filter((item) => item.id !== photo.id),
    );
    setPhotoError(null);
  }

  function reorderPendingPhotos(nextPhotos: DashboardPhoto[]) {
    const orderById = new Map(
      nextPhotos.map((photo, index) => [photo.id, index]),
    );

    setPendingPhotos((current) =>
      [...current].sort(
        (first, second) =>
          (orderById.get(first.id) ?? 0) - (orderById.get(second.id) ?? 0),
      ),
    );
  }

  async function uploadPendingPhotos(
    currentInventoryItemId: string,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    if (pendingPhotos.length === 0) return { ok: true };
    if (!seller) {
      return {
        ok: false,
        message: "Store context is missing. Refresh and try again.",
      };
    }

    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;

    if (sessionError || !accessToken) {
      return {
        ok: false,
        message: "Please sign in again and try uploading the photos.",
      };
    }

    const existingPhotoCount = mediaItems.filter(
      (item) =>
        item.visibility_status === "active" &&
        item.asset_status === "active" &&
        item.moderation_status === "approved",
    ).length;

    const uploadedMedia: ListingPhotoItem[] = [];

    for (const [index, pendingPhoto] of pendingPhotos.entries()) {
      const formData = new FormData();
      formData.append("file", pendingPhoto.file);
      formData.append("store_id", seller.store_id);
      formData.append("entity_type", "inventory_item");
      formData.append("entity_id", currentInventoryItemId);
      formData.append("display_context", "gallery");
      formData.append("sort_order", String(existingPhotoCount + index));
      formData.append(
        "is_featured",
        String(existingPhotoCount === 0 && uploadedMedia.length === 0 && index === 0),
      );

      const { data, error } =
        await supabase.functions.invoke<UploadResponse>("seller-media-upload", {
          body: formData,
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

      if (error || data?.error) {
        return {
          ok: false,
          message:
            data?.error?.message ??
            "The photos were not uploaded. Please try again.",
        };
      }

      if (data?.media) uploadedMedia.push(data.media);
    }

    pendingPhotos.forEach((photo) => URL.revokeObjectURL(photo.url));
    setPendingPhotos([]);
    setMediaItems((current) => [...current, ...uploadedMedia]);
    await loadInventoryItemMedia(currentInventoryItemId);

    return { ok: true };
  }

  async function saveDraft(): Promise<SaveDraftResult> {
    if (!seller) {
      return { ok: false, message: "Store context is missing. Refresh and try again." };
    }

    const errors = validateHatchingEggForm(form, publicDescription);
    setValidationErrors(errors);

    if (errors.length > 0) {
      return { ok: false, message: "Complete the required listing details first." };
    }

    const breedProfileResult = await upsertPlainBreedProfile({
      description: publicDescription,
      form,
      sellerBreedProfileId,
      speciesName: selectedSpecies?.common_name ?? "Hatching Eggs",
      storeId: seller.store_id,
    });

    if (!breedProfileResult.ok) return breedProfileResult;
    setSellerBreedProfileId(breedProfileResult.profileId);

    if (listingBatchId) {
      const updateResult = await updateExistingDraft({
        listingBatchId,
        inventoryItemId: draftRows[0]?.inventory_item_id ?? inventoryItemId,
      });

      if (!updateResult.ok) return updateResult;

      const rows = await loadDraftRows(listingBatchId);
      const nextInventoryItemId =
        rows[0]?.inventory_item_id ?? inventoryItemId;

      if (!nextInventoryItemId) {
        return {
          ok: false,
          message: "The draft saved, but the photo target could not be loaded.",
        };
      }

      await loadInventoryItemMedia(nextInventoryItemId);
      return { ok: true, listingBatchId, inventoryItemId: nextInventoryItemId };
    }

    const createResult = await supabase.rpc(
      "seller_create_listing_batch_with_inventory",
      {
        p_store_id: seller.store_id,
        p_species_id: form.speciesId,
        p_batch_type: "hatching_eggs",
        p_origin_date: form.availableDate,
        p_available_date: form.availableDate,
        p_base_price: Number(form.pricePerEgg),
        p_breed_groups: [
          {
            seller_breed_profile_id: breedProfileResult.profileId,
            sort_order: 0,
            visibility_status: "active",
            inventory_items: [
              {
                inventory_type: "hatching_eggs",
                custom_inventory_label: null,
                quantity_available: Number(form.quantity),
                price_override: null,
                sort_order: 0,
                visibility_status: "active",
              },
            ],
          },
        ],
        p_auto_price_increase_enabled: false,
        p_auto_price_increase_amount: null,
        p_auto_price_increase_max_price: null,
        p_internal_batch_label: null,
        p_seller_notes: null,
        p_visibility_status: "hidden",
      },
    );

    if (createResult.error) {
      return { ok: false, message: createResult.error.message };
    }

    const rows = Array.isArray(createResult.data)
      ? (createResult.data as CreateListingBatchResult[])
      : [];
    const createdListingBatchId = rows[0]?.listing_batch_id;

    if (!createdListingBatchId) {
      return {
        ok: false,
        message: "The hatching egg listing could not be saved. Please try again.",
      };
    }

    setListingBatchId(createdListingBatchId);
    const loadedRows = await loadDraftRows(createdListingBatchId);
    const createdInventoryItemId = loadedRows[0]?.inventory_item_id;
    const createdListingBatchBreedId = loadedRows[0]?.listing_batch_breed_id;

    if (!createdInventoryItemId || !createdListingBatchBreedId) {
      return {
        ok: false,
        message: "The draft saved, but the listing details could not be loaded.",
      };
    }

    setListingBatchBreedId(createdListingBatchBreedId);
    await loadInventoryItemMedia(createdInventoryItemId);
    return {
      ok: true,
      inventoryItemId: createdInventoryItemId,
      listingBatchId: createdListingBatchId,
    };
  }

  async function updateExistingDraft({
    inventoryItemId,
    listingBatchId,
  }: {
    inventoryItemId: string;
    listingBatchId: string;
  }): Promise<{ ok: true } | { ok: false; message: string }> {
    const batchResult = await supabase.rpc("seller_update_listing_batch", {
      p_listing_batch_id: listingBatchId,
      p_origin_date: form.availableDate,
      p_available_date: form.availableDate,
      p_base_price: Number(form.pricePerEgg),
      p_auto_price_increase_enabled: false,
      p_auto_price_increase_amount: null,
      p_auto_price_increase_max_price: null,
      p_internal_batch_label: null,
      p_seller_notes: null,
    });

    if (batchResult.error) {
      return { ok: false, message: batchResult.error.message };
    }

    if (!inventoryItemId) {
      return {
        ok: false,
        message: "The inventory row could not be found. Refresh and try again.",
      };
    }

    const inventoryResult = await supabase.rpc("seller_update_inventory_item", {
      p_inventory_item_id: inventoryItemId,
      p_inventory_type: "hatching_eggs",
      p_custom_inventory_label: null,
      p_price_override: null,
      p_sort_order: 0,
      p_seller_notes: null,
    });

    if (inventoryResult.error) {
      return { ok: false, message: inventoryResult.error.message };
    }

    const quantityResult = await supabase.rpc("seller_adjust_inventory_quantity", {
      p_inventory_item_id: inventoryItemId,
      p_quantity_available: Number(form.quantity),
      p_quantity_delta: null,
      p_note: "Updated from Add Hatching Eggs.",
    });

    if (quantityResult.error) {
      return { ok: false, message: quantityResult.error.message };
    }

    return { ok: true };
  }

  async function handleSaveDraft() {
    if (saveDraftDisabledReason) return;

    setSaveDraftStatus("saving");
    setActionError(null);
    setActionMessage(null);

    const result = await saveDraft();

    if (!result.ok) {
      setSaveDraftStatus("error");
      setActionError(`Draft could not be saved. ${result.message}`);
      return;
    }

    const uploadResult = await uploadPendingPhotos(result.inventoryItemId);

    if (!uploadResult.ok) {
      setSaveDraftStatus("error");
      setActionError(
        `Draft saved, but photos were not uploaded. ${uploadResult.message}`,
      );
      return;
    }

    setSaveDraftStatus("success");
    setSavedFormSnapshot(formSnapshot);
    setActionMessage(isEditMode ? "Changes saved." : "Draft saved.");
  }

  async function handlePublish() {
    if (publishDisabledReason || publishStatus === "publishing") return;

    setPublishStatus("publishing");
    setActionError(null);
    setActionMessage(null);

    const saveResult = await saveDraft();

    if (!saveResult.ok) {
      setPublishStatus("error");
      setActionError(`Inventory could not be published. ${saveResult.message}`);
      return;
    }

    const uploadResult = await uploadPendingPhotos(saveResult.inventoryItemId);

    if (!uploadResult.ok) {
      setPublishStatus("error");
      setActionError(
        `Inventory was saved, but photos were not uploaded. ${uploadResult.message}`,
      );
      return;
    }

    const publishResult = await supabase.rpc(
      "seller_set_listing_batch_visibility",
      {
        p_listing_batch_id: saveResult.listingBatchId,
        p_visibility_status: "active",
        p_note: "Published from Add Hatching Eggs.",
      },
    );

    if (publishResult.error) {
      setPublishStatus("error");
      setActionError(`Draft could not be published. ${publishResult.error.message}`);
      return;
    }

    setPublishStatus("success");
    setSavedFormSnapshot(formSnapshot);
    router.push("/dashboard/inventory");
  }

  function resetForm() {
    const defaultSpecies =
      species.find((item) => item.slug === "chicken") ?? species[0] ?? null;

    setForm({ ...emptyForm, speciesId: defaultSpecies?.id ?? "" });
    setListingBatchId("");
    setListingBatchBreedId("");
    setInventoryItemId("");
    setSellerBreedProfileId("");
    setDraftRows([]);
    setMediaItems([]);
    pendingPhotos.forEach((photo) => URL.revokeObjectURL(photo.url));
    setPendingPhotos([]);
    setPhotoError(null);
    setSavedFormSnapshot(null);
    setValidationErrors([]);
    setSaveDraftStatus("idle");
    setPublishStatus("idle");
    setActionError(null);
    setActionMessage(null);
    setIsStartOverDialogOpen(false);
  }

  if (!storeId || (hatchingEggsEnabled && isLoading)) {
    return <LoadingState label="Loading hatching egg form..." />;
  }

  if (!hatchingEggsEnabled) {
    return (
      <DashboardPageContent className="bg-stone-50/60">
        <div className="max-w-3xl">
          <SellerCard className="p-5">
            {!plan.hatchingEggsEnabled ? (
              <PlanUpgradePrompt feature="hatching_eggs" />
            ) : (
              <>
                <h1 className="text-xl font-semibold text-stone-950">
                  Hatching Eggs is turned off for this store.
                </h1>
                <p className="mt-2 text-sm leading-6 text-stone-600">
                  Turn it on in Store Admin when you want to create new hatching
                  egg listings.
                </p>
              </>
            )}
            <div className="mt-5">
              <Link className="seller-secondary-button" href="/dashboard/store-admin">
                Go to Store Admin
              </Link>
            </div>
          </SellerCard>
        </div>
      </DashboardPageContent>
    );
  }

  return (
    <DashboardPageContent className="bg-stone-50/60">
      <div className="max-w-7xl">
        <header className="mb-5">
          <Link
            className="inline-flex min-h-11 items-center text-base font-bold text-emerald-800 underline-offset-4 hover:underline sm:min-h-0 sm:text-sm sm:font-semibold"
            href={isEditMode ? "/dashboard/inventory" : "/dashboard/inventory/add-v2"}
          >
            {isEditMode ? "Inventory" : "Inventory / Add Inventory"}
          </Link>
          <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h1 className="text-3xl font-semibold text-stone-950">
                {isEditMode ? "Edit Hatching Eggs" : "Add Hatching Eggs"}
              </h1>
              <p className="mt-2 max-w-3xl text-base leading-7 text-stone-600 sm:text-sm sm:leading-6">
                Add hatching eggs from one collection date, then list them for
                sale.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {isEditMode ? (
                <Link className="seller-secondary-button bg-white" href="/dashboard/inventory">
                  Cancel
                </Link>
              ) : (
                <button
                  className="inline-flex min-h-12 items-center rounded-md border border-stone-300 bg-white px-3 text-base font-bold text-stone-700 shadow-sm transition hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:ring-offset-2 sm:min-h-9 sm:text-sm sm:font-semibold"
                  type="button"
                  onClick={() => setIsStartOverDialogOpen(true)}
                >
                  Start over
                </button>
              )}
              <span
                className={`inline-flex min-h-8 w-fit items-center rounded-full border px-3 py-1 text-sm font-semibold sm:min-h-0 sm:text-xs ${
                  publishStatus === "success"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : listingBatchId
                      ? "border-sky-200 bg-sky-50 text-sky-800"
                      : "border-amber-200 bg-amber-50 text-amber-800"
                }`}
              >
                {publishStatus === "success"
                  ? "Published"
                  : isEditMode
                    ? savedFormSnapshot
                      ? "Changes saved"
                      : "Loaded for editing"
                    : listingBatchId
                    ? "Draft saved"
                    : "Draft not saved yet"}
              </span>
            </div>
          </div>
        </header>

        {loadError ? (
          <ErrorState
            title="Hatching egg form could not load"
            message={loadError}
          />
        ) : (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <main className="space-y-4">
              <SectionCard step="1" title="Photos">
                <HatchingEggPhotos
                  addPendingPhotos={addPendingPhotos}
                  inventoryItemId={inventoryItemId}
                  mediaItems={mediaItems}
                  pendingPhotos={pendingPhotos}
                  photoError={photoError}
                  removePendingPhoto={removePendingPhoto}
                  reorderPendingPhotos={reorderPendingPhotos}
                  storeId={storeId}
                  onReload={() => {
                    if (inventoryItemId) void loadInventoryItemMedia(inventoryItemId);
                  }}
                />
              </SectionCard>

              <SectionCard step="2" title="Listing Details">
                <p className="text-base leading-7 text-stone-600 sm:text-sm sm:leading-6">
                  Enter the core details for this hatching egg listing.
                </p>
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <label>
                    <span className="mb-1.5 block text-base font-bold text-stone-700 sm:text-xs sm:font-semibold sm:text-stone-600">
                      Species
                    </span>
                    <select
                      className={inputClass}
                      disabled={isEditMode}
                      value={form.speciesId}
                      onChange={(event) =>
                        updateForm({ speciesId: event.target.value })
                      }
                    >
                      <option value="">Choose species</option>
                      {species.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.common_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className="mb-1.5 block text-base font-bold text-stone-700 sm:text-xs sm:font-semibold sm:text-stone-600">
                      Breed
                    </span>
                    <input
                      className={inputClass}
                      placeholder="Enter breed"
                      value={form.breedName}
                      onChange={(event) =>
                        updateForm({ breedName: event.target.value })
                      }
                    />
                  </label>
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <CompactField label="Available date">
                    <input
                      className={inputClass}
                      type="date"
                      value={form.availableDate}
                      onChange={(event) =>
                        updateForm({ availableDate: event.target.value })
                      }
                    />
                  </CompactField>
                  <CompactField label="Quantity available">
                    <input
                      className={inputClass}
                      inputMode="numeric"
                      min="1"
                      placeholder="Enter quantity"
                      step="1"
                      type="number"
                      value={form.quantity}
                      onChange={(event) =>
                        updateForm({ quantity: event.target.value })
                      }
                    />
                  </CompactField>
                  <CompactField label="Price per egg">
                    <MoneyInput
                      value={form.pricePerEgg}
                      onChange={(value) => updateForm({ pricePerEgg: value })}
                    />
                  </CompactField>
                  <CompactField label="Minimum order quantity">
                    <input
                      className={inputClass}
                      inputMode="numeric"
                      min="1"
                      placeholder="Enter minimum"
                      step="1"
                      type="number"
                      value={form.minimumOrderQuantity}
                      onChange={(event) =>
                        updateForm({ minimumOrderQuantity: event.target.value })
                      }
                    />
                  </CompactField>
                </div>
                {validationErrors.length > 0 ? (
                  <div className="mt-4">
                    <ValidationMessage errors={validationErrors} />
                  </div>
                ) : null}
              </SectionCard>

              <SectionCard step="3" title="Description">
                <p className="text-base leading-7 text-stone-600 sm:text-sm sm:leading-6">
                  Describe your hatching eggs, including collection timing,
                  fertility notes, and pickup details.
                </p>
                <textarea
                  className={`${inputClass} mt-4 min-h-32 resize-y py-3 leading-6`}
                  maxLength={publicDescriptionMaxLength}
                  placeholder="Share important information that helps buyers make informed decisions."
                  value={form.description}
                  onChange={(event) =>
                    updateForm({ description: event.target.value })
                  }
                />
                <p className="mt-2 text-sm font-medium text-stone-500">
                  Keep it clear, accurate, and helpful.
                </p>
              </SectionCard>

              <SectionCard step="4" title="Ready to publish?">
                <div className="space-y-4 sm:space-y-6">
                  <div className="space-y-2">
                    <p className="text-base leading-7 text-stone-700 sm:text-sm sm:leading-6">
                      {isEditMode
                        ? "Review the details above, then save your changes."
                        : "Review the details above, then publish when everything looks right."}
                    </p>
                    <p className="text-base leading-7 text-stone-500 sm:text-sm sm:leading-6">
                      Your listing will be visible in your storefront inventory.
                    </p>
                  </div>
                  <ActionStatus
                    actionError={actionError}
                    actionMessage={actionMessage}
                    publishDisabledReason={publishDisabledReason}
                    validationErrors={validationErrors}
                  />
                  <div className="flex flex-col-reverse gap-3 sm:flex-row sm:flex-wrap sm:justify-end">
                    <SaveDraftButton
                      canSaveDraft={!saveDraftDisabledReason}
                      idleLabel={isEditMode ? "Save Changes" : undefined}
                      onSaveDraft={handleSaveDraft}
                      saveDraftDisabledReason={saveDraftDisabledReason}
                      saveDraftStatus={saveDraftStatus}
                      successLabel={isEditMode ? "Changes saved" : undefined}
                    />
                    {!isEditMode ? (
                      <PublishInventoryButton
                        onReviewPublish={handlePublish}
                        publishDisabledReason={publishDisabledReason}
                        publishStatus={publishStatus}
                      />
                    ) : null}
                  </div>
                </div>
              </SectionCard>
            </main>

            <aside className="hidden space-y-4 xl:block">
              <HatchingEggSummaryCard form={form} />
              <HatchingEggReadinessCard
                descriptionComplete={descriptionComplete}
                listingDetailsComplete={listingDetailsComplete}
                photoCount={activePhotoCount}
              />
            </aside>
          </div>
        )}
      </div>

      {!isEditMode && isStartOverDialogOpen ? (
        <StartOverDialog
          onCancel={() => setIsStartOverDialogOpen(false)}
          onConfirm={resetForm}
        />
      ) : null}
    </DashboardPageContent>
  );
}

function HatchingEggPhotos({
  addPendingPhotos,
  inventoryItemId,
  mediaItems,
  onReload,
  pendingPhotos,
  photoError,
  removePendingPhoto,
  reorderPendingPhotos,
  storeId,
}: {
  addPendingPhotos: (files: FileList | null) => void;
  inventoryItemId: string;
  mediaItems: ListingPhotoItem[];
  onReload: () => void;
  pendingPhotos: PendingPhoto[];
  photoError: string | null;
  removePendingPhoto: (photo: PendingPhoto) => void;
  reorderPendingPhotos: (photos: DashboardPhoto[]) => void;
  storeId: string;
}) {
  if (pendingPhotos.length > 0 || !inventoryItemId) {
    return (
      <PendingHatchingEggPhotos
        addPendingPhotos={addPendingPhotos}
        pendingPhotos={pendingPhotos}
        photoError={photoError}
        removePendingPhoto={removePendingPhoto}
        reorderPendingPhotos={reorderPendingPhotos}
      />
    );
  }

  return (
    <div className="space-y-3">
      <ListingPhotosSection
        key={inventoryItemId}
        canManage
        description="Manage the photos buyers see for this listing. The first photo will be the featured storefront photo."
        emptyDescription="No hatching egg photos have been added yet."
        entityId={inventoryItemId}
        entityType="inventory_item"
        listingBatchId={inventoryItemId}
        mediaItems={mediaItems}
        mode="setup"
        storeId={storeId}
        title="Photos"
        onReload={onReload}
      />
    </div>
  );
}

function PendingHatchingEggPhotos({
  addPendingPhotos,
  pendingPhotos,
  photoError,
  removePendingPhoto,
  reorderPendingPhotos,
}: {
  addPendingPhotos: (files: FileList | null) => void;
  pendingPhotos: PendingPhoto[];
  photoError: string | null;
  removePendingPhoto: (photo: PendingPhoto) => void;
  reorderPendingPhotos: (photos: DashboardPhoto[]) => void;
}) {
  const dashboardPhotos = pendingPhotos.map((photo, index) => ({
    altText: photo.file.name,
    filename: photo.file.name,
    height: null,
    id: photo.id,
    label: photo.file.name || `Pending photo ${index + 1}`,
    sortOrder: index,
    url: photo.url,
    width: null,
  }));

  return (
    <div className="space-y-3">
      <PhotoManager
        acceptedTypes={acceptedPendingImageTypes}
        allowCropEdit={false}
        canManage
        description="Manage the photos buyers see for this listing. The first photo will be the featured storefront photo."
        emptyDescription="Add photos now. They will be saved when you save or publish this listing."
        error={
          photoError
            ? {
                message: photoError,
                title: "Photo could not be added",
              }
            : null
        }
        fillEmptySlots
        helperText="Drag photos to reorder. The first photo is the featured storefront photo."
        maxFileSizeMb={maxPendingImageSizeBytes / 1024 / 1024}
        maxPhotos={maxHatchingEggPhotos}
        photos={dashboardPhotos}
        removePhotoContext="listing"
        title="Photos"
        onAddPhotos={addPendingPhotos}
        onRemovePhoto={(photo) => {
          const pendingPhoto = pendingPhotos.find((item) => item.id === photo.id);
          if (pendingPhoto) removePendingPhoto(pendingPhoto);
        }}
        onReorderPhotos={reorderPendingPhotos}
        onResetCrop={() => undefined}
        onSaveCrop={() => undefined}
        onSetFeaturedPhoto={(photo) => {
          const nextPhotos = [
            photo,
            ...dashboardPhotos.filter((item) => item.id !== photo.id),
          ];
          reorderPendingPhotos(nextPhotos);
        }}
      />
      {pendingPhotos.length > 0 ? (
        <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold leading-6 text-sky-800">
          Photos will be saved when you save or publish this listing.
        </p>
      ) : null}
    </div>
  );
}

function CompactField({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <label>
      <span className="mb-1.5 block text-base font-bold text-stone-700 sm:text-xs sm:font-semibold sm:text-stone-600">
        {label}
      </span>
      {children}
    </label>
  );
}

function HatchingEggSummaryCard({ form }: { form: HatchingEggFormState }) {
  return (
    <SidebarCard title="Hatching Eggs Summary">
      <SummaryRow
        glyph="/glyphs/calendar.png"
        label="Available date"
        value={formatDate(form.availableDate)}
      />
      <SummaryRow
        glyph="/glyphs/hen.png"
        label="Breed"
        value={form.breedName.trim() || "Not set"}
      />
      <SummaryRow
        glyph="/glyphs/feed-sack.png"
        label="Quantity available"
        value={form.quantity.trim() || "0"}
      />
      <SummaryRow
        glyph="/glyphs/egg.png"
        label="Price per egg"
        value={isValidMoney(form.pricePerEgg) ? formatCurrency(form.pricePerEgg) : "$0.00"}
      />
    </SidebarCard>
  );
}

function HatchingEggReadinessCard({
  descriptionComplete,
  listingDetailsComplete,
  photoCount,
}: {
  descriptionComplete: boolean;
  listingDetailsComplete: boolean;
  photoCount: number;
}) {
  const readyToPublish = listingDetailsComplete;

  return (
    <SidebarCard title="Ready to Publish">
      <div className="space-y-3">
        <ChecklistRow complete={photoCount > 0} label="Photos" />
        <ChecklistRow complete={listingDetailsComplete} label="Listing Details" />
        <ChecklistRow complete={descriptionComplete} label="Description" />
      </div>
      <p
        className={`mt-5 rounded-md border px-3 py-2 text-base font-semibold sm:text-sm ${
          readyToPublish
            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
            : "border-stone-200 bg-stone-50 text-stone-600"
        }`}
      >
        {readyToPublish
          ? "Looks ready to publish."
          : "Complete listing details to publish."}
      </p>
      <p className="mt-4 text-sm leading-6 text-stone-600">
        Listings go live immediately and are visible to buyers in your
        storefront.
      </p>
    </SidebarCard>
  );
}

function ChecklistRow({
  complete,
  label,
}: {
  complete: boolean;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3 text-base font-medium text-stone-700 sm:text-sm">
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full sm:h-5 sm:w-5 ${
          complete ? "bg-emerald-600" : "border border-stone-300 bg-stone-100"
        }`}
      >
        {complete ? (
          <span className="block h-2.5 w-1.5 rotate-45 border-b-2 border-r-2 border-white" />
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-stone-400" />
        )}
      </span>
      {label}
    </div>
  );
}

function ActionStatus({
  actionError,
  actionMessage,
  publishDisabledReason,
  validationErrors,
}: {
  actionError: string | null;
  actionMessage: string | null;
  publishDisabledReason: string | null;
  validationErrors: string[];
}) {
  if (
    !actionError &&
    !actionMessage &&
    !publishDisabledReason &&
    validationErrors.length === 0
  ) {
    return null;
  }

  return (
    <div className="space-y-2">
      {actionMessage ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-base font-semibold text-emerald-800 sm:text-sm">
          {actionMessage}
        </p>
      ) : null}
      {actionError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-base font-semibold text-red-700 sm:text-sm">
          {actionError}
        </p>
      ) : null}
      {!actionError && publishDisabledReason ? (
        <p className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-base font-semibold text-stone-700 sm:text-sm">
          {publishDisabledReason}
        </p>
      ) : null}
    </div>
  );
}

function StartOverDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      aria-labelledby="start-over-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/55 p-4"
      role="dialog"
    >
      <div className="w-full max-w-sm rounded-lg border border-stone-200 bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-stone-950" id="start-over-title">
          Start over?
        </h2>
        <p className="mt-2 text-sm leading-6 text-stone-600">
          This clears the form on this page. Saved drafts remain in inventory.
        </p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button className="seller-secondary-button" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="seller-primary-button" type="button" onClick={onConfirm}>
            Start over
          </button>
        </div>
      </div>
    </div>
  );
}

async function upsertPlainBreedProfile({
  description,
  form,
  sellerBreedProfileId,
  speciesName,
  storeId,
}: {
  description: string;
  form: HatchingEggFormState;
  sellerBreedProfileId: string;
  speciesName: string;
  storeId: string;
}): Promise<
  | { ok: true; profileId: string }
  | { ok: false; message: string }
> {
  const displayName = form.breedName.trim();
  const { data, error } = await supabase.rpc("seller_upsert_breed_profile", {
    p_store_id: storeId,
    p_species_id: form.speciesId,
    p_breed_id: null,
    p_custom_breed_name: createUniqueProfileToken(displayName, speciesName),
    p_display_name: displayName,
    p_seller_description: description.trim() || null,
    p_seller_notes: null,
    p_visibility_status: "active",
    p_seller_breed_profile_id: sellerBreedProfileId || null,
  });

  if (error) {
    return { ok: false, message: error.message };
  }

  const rows = Array.isArray(data)
    ? (data as BreedProfileUpsertResult[])
    : [data as BreedProfileUpsertResult | null];
  const profileId = rows[0]?.seller_breed_profile_id ?? null;

  if (!profileId) {
    return {
      ok: false,
      message: "The hatching egg breed profile could not be saved.",
    };
  }

  return { ok: true, profileId };
}

function createUniqueProfileToken(displayName: string, speciesName: string) {
  return `${speciesName.trim()} ${displayName.trim()}`.trim();
}

function validateHatchingEggForm(
  form: HatchingEggFormState,
  publicDescription: string,
) {
  const errors = validateListingDetails(form);

  if (
    form.minimumOrderQuantity.trim() &&
    !isPositiveWholeNumber(form.minimumOrderQuantity)
  ) {
    errors.push("Minimum order quantity must be a whole number of 1 or more.");
  }

  if (publicDescription.length > publicDescriptionMaxLength) {
    errors.push(
      `Description must be ${publicDescriptionMaxLength} characters or less, including the minimum order note.`,
    );
  }

  return errors;
}

function validateListingDetails(form: HatchingEggFormState) {
  const errors: string[] = [];

  if (!form.speciesId) errors.push("Choose a species.");
  if (!form.breedName.trim()) errors.push("Enter a breed.");
  if (!form.availableDate) errors.push("Add an available date.");
  if (!isPositiveWholeNumber(form.quantity)) {
    errors.push("Quantity available must be a whole number of 1 or more.");
  }
  if (!form.pricePerEgg.trim()) {
    errors.push("Add a price per egg.");
  } else if (!isValidMoney(form.pricePerEgg)) {
    errors.push("Use a valid price with no more than two decimal places.");
  }

  return errors;
}

function validatePendingPhotoFiles(files: File[]) {
  for (const file of files) {
    if (
      !acceptedPendingImageTypes.includes(
        file.type as (typeof acceptedPendingImageTypes)[number],
      )
    ) {
      return "Use a JPG, PNG, or WebP photo.";
    }

    if (file.size <= 0 || file.size > maxPendingImageSizeBytes) {
      return "Use a photo under 8 MB.";
    }
  }

  return null;
}

function getFormSnapshot(form: HatchingEggFormState) {
  return JSON.stringify({
    availableDate: form.availableDate,
    breedName: form.breedName.trim(),
    description: form.description.trim(),
    minimumOrderQuantity: form.minimumOrderQuantity.trim(),
    pricePerEgg: form.pricePerEgg.trim(),
    quantity: form.quantity.trim(),
    speciesId: form.speciesId,
  });
}

function hasStartedForm(form: HatchingEggFormState) {
  return Boolean(
    form.availableDate ||
      form.breedName.trim() ||
      form.description.trim() ||
      form.minimumOrderQuantity.trim() ||
      form.pricePerEgg.trim() ||
      form.quantity.trim(),
  );
}

function buildPublicDescription(form: HatchingEggFormState) {
  const parts: string[] = [];

  if (form.minimumOrderQuantity.trim()) {
    parts.push(`Minimum order: ${form.minimumOrderQuantity.trim()} eggs.`);
  }

  if (form.description.trim()) {
    parts.push(form.description.trim());
  }

  return parts.join("\n\n");
}

function parseHatchingEggDescription(value: string) {
  const match = value.match(/^Minimum order:\s*(\d+)\s*eggs?\.\s*(?:\n\n)?/i);

  if (!match) {
    return {
      description: value,
      minimumOrderQuantity: "",
    };
  }

  return {
    description: value.slice(match[0].length),
    minimumOrderQuantity: match[1],
  };
}

function getPublishDisabledReason({
  isPublishing,
  listingDetailsComplete,
}: {
  isPublishing: boolean;
  listingDetailsComplete: boolean;
}) {
  if (isPublishing) return "Publish already in progress.";
  if (!listingDetailsComplete) return "Complete listing details to publish.";

  return null;
}
