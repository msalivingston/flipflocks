"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPlanCapabilities } from "@/lib/plan-capabilities";
import { supabase } from "@/lib/supabase";
import { PhotoManager, type DashboardPhoto } from "../../../_components/photo-manager";
import { PlanUpgradePrompt } from "../../../_components/plan-upgrade-prompt";
import { useSellerContext } from "../../../_components/seller-context";
import {
  DashboardPageContent,
  ErrorState,
  LoadingState,
  SellerCard,
} from "../../../_components/seller-ui";
import {
  sellerMediaSelect,
  type ListingPhotoItem,
} from "../../../_components/processed-poultry-photos";
import type { ReferenceSpecies } from "../../../_lib/seller-types";
import {
  ListingPhotosSection,
} from "../../[listingBatchId]/listing-photos-section";
import { SectionCard } from "../../../inventory/add-v2/live-birds/SectionCard";
import {
  SidebarCard,
  SummaryRow,
} from "../../../inventory/add-v2/live-birds/SidebarCard";
import {
  PublishInventoryButton,
  SaveDraftButton,
  type PublishStatus,
  type SaveDraftStatus,
} from "../../../inventory/add-v2/live-birds/ReviewPublishCard";
import { inputClass } from "../../../inventory/add-v2/live-birds/constants";

type PoultryProductType = "Eating Eggs" | "Meat & Broth" | "Feathers" | "Other";

type PoultryProductFormState = {
  availableDate: string;
  description: string;
  packageSize: string;
  price: string;
  productName: string;
  productType: string;
  quantityAvailable: string;
  speciesId: string;
};

type PendingPhoto = {
  file: File;
  id: string;
  url: string;
};

type PoultryProductSaveResult =
  | { ok: true; processedPoultryItemId: string }
  | { ok: false; message: string };

type PoultryProductRpcResult = {
  id?: string | null;
  processed_poultry_inventory_item_id?: string | null;
};

type UploadResponse = {
  media?: ListingPhotoItem | null;
  error?: {
    code?: string;
    message?: string;
  };
};

type ExistingPoultryProductRow = {
  id: string;
  product_name: string;
  poultry_type: string | null;
  product_type: string;
  species_id: string | null;
  available_date: string | null;
  package_size: string | null;
  description: string | null;
  quantity_available: number | null;
  price: number | null;
  visibility_status: string;
};

type PoultryProductsOnePageFormProps = {
  initialProcessedPoultryItemId?: string;
};

const emptyForm: PoultryProductFormState = {
  availableDate: "",
  description: "",
  packageSize: "",
  price: "",
  productName: "",
  productType: "",
  quantityAvailable: "",
  speciesId: "",
};

const productTypeOptions: PoultryProductType[] = [
  "Eating Eggs",
  "Meat & Broth",
  "Feathers",
  "Other",
];

const acceptedPendingImageTypes = ["image/jpeg", "image/png", "image/webp"] as const;
const maxPendingImageSizeBytes = 8 * 1024 * 1024;
const maxPoultryProductPhotos = 4;
const descriptionMaxLength = 1000;

export function PoultryProductsOnePageForm({
  initialProcessedPoultryItemId = "",
}: PoultryProductsOnePageFormProps) {
  const router = useRouter();
  const { seller, isLoading: isSellerLoading } = useSellerContext();
  const plan = getPlanCapabilities(seller?.plan_key);
  const storeId = seller?.store_id ?? "";
  const processedPoultryEnabled =
    Boolean(seller?.processed_poultry_enabled) && plan.processedPoultryEnabled;
  const [species, setSpecies] = useState<ReferenceSpecies[]>([]);
  const [form, setForm] = useState<PoultryProductFormState>(emptyForm);
  const [processedPoultryItemId, setProcessedPoultryItemId] = useState(
    initialProcessedPoultryItemId,
  );
  const [mediaItems, setMediaItems] = useState<ListingPhotoItem[]>([]);
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [savedFormSnapshot, setSavedFormSnapshot] = useState<string | null>(
    null,
  );
  const pendingPhotosRef = useRef<PendingPhoto[]>([]);
  const [isLoadingSpecies, setIsLoadingSpecies] = useState(false);
  const [isLoadingExistingProduct, setIsLoadingExistingProduct] =
    useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [saveDraftStatus, setSaveDraftStatus] =
    useState<SaveDraftStatus>("idle");
  const [publishStatus, setPublishStatus] = useState<PublishStatus>("idle");
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isStartOverDialogOpen, setIsStartOverDialogOpen] = useState(false);
  const isEditMode = Boolean(initialProcessedPoultryItemId);

  useEffect(() => {
    if (!storeId || !processedPoultryEnabled) return;

    let isMounted = true;

    async function loadSpecies() {
      setIsLoadingSpecies(true);
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
        setIsLoadingSpecies(false);
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
      setIsLoadingSpecies(false);
    }

    void loadSpecies();

    return () => {
      isMounted = false;
    };
  }, [processedPoultryEnabled, storeId]);

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
  const formSnapshot = useMemo(() => getFormSnapshot(form), [form]);
  const activePhotoCount =
    mediaItems.filter(
      (item) =>
        item.visibility_status === "active" &&
        item.asset_status === "active" &&
        item.moderation_status === "approved",
    ).length + pendingPhotos.length;
  const productDetailsComplete = validateProductDetails(form).length === 0;
  const descriptionComplete = form.description.trim().length > 0;
  const publishDisabledReason = getPublishDisabledReason({
    isPublishing: publishStatus === "publishing",
    productDetailsComplete,
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
        "Leave without saving this poultry product?",
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

  const loadProcessedPoultryMedia = useCallback(
    async (currentProcessedPoultryItemId: string) => {
      if (!storeId || !currentProcessedPoultryItemId) return;

      const mediaResult = await supabase
        .from("seller_media_management")
        .select(sellerMediaSelect)
        .eq("store_id", storeId)
        .eq("entity_type", "processed_poultry_inventory_item")
        .eq("entity_id", currentProcessedPoultryItemId)
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
    if (
      !storeId ||
      !processedPoultryEnabled ||
      !initialProcessedPoultryItemId
    ) {
      return;
    }

    let isMounted = true;

    async function loadExistingPoultryProduct() {
      setIsLoadingExistingProduct(true);
      setLoadError(null);

      const result = await supabase
        .from("processed_poultry_inventory_items")
        .select(
          "id, product_name, poultry_type, product_type, species_id, available_date, package_size, description, quantity_available, price, visibility_status",
        )
        .eq("store_id", storeId)
        .eq("id", initialProcessedPoultryItemId)
        .maybeSingle<ExistingPoultryProductRow>();

      if (!isMounted) return;

      if (result.error) {
        setLoadError(result.error.message);
        setIsLoadingExistingProduct(false);
        return;
      }

      if (!result.data) {
        setLoadError("This poultry product draft could not be found.");
        setIsLoadingExistingProduct(false);
        return;
      }

      const loadedForm: PoultryProductFormState = {
        availableDate: result.data.available_date ?? "",
        description: result.data.description ?? "",
        packageSize: result.data.package_size ?? "",
        price:
          result.data.price === null || result.data.price === undefined
            ? ""
            : String(result.data.price),
        productName: result.data.product_name ?? "",
        productType: result.data.product_type ?? "",
        quantityAvailable:
          result.data.quantity_available === null ||
          result.data.quantity_available === undefined
            ? ""
            : String(result.data.quantity_available),
        speciesId:
          result.data.species_id ??
          getSpeciesIdForLegacyPoultryType(species, result.data.poultry_type) ??
          "",
      };

      setProcessedPoultryItemId(result.data.id);
      setForm(loadedForm);
      setSavedFormSnapshot(getFormSnapshot(loadedForm));
      setActionMessage(null);
      setActionError(null);
      await loadProcessedPoultryMedia(
        result.data.id,
      );

      if (isMounted) setIsLoadingExistingProduct(false);
    }

    void loadExistingPoultryProduct();

    return () => {
      isMounted = false;
    };
  }, [
    initialProcessedPoultryItemId,
    loadProcessedPoultryMedia,
    processedPoultryEnabled,
    species,
    storeId,
  ]);

  function updateForm(updates: Partial<PoultryProductFormState>) {
    setForm((current) => ({ ...current, ...updates }));
    setValidationErrors([]);
    setActionError(null);
    setActionMessage(null);
    if (saveDraftStatus === "success") setSaveDraftStatus("idle");
    if (publishStatus === "success") setPublishStatus("idle");
  }

  function addPendingPhotos(files: FileList | null) {
    if (!files || files.length === 0) return;

    const selectedFiles = Array.from(files);
    const availableSlots = maxPoultryProductPhotos - activePhotoCount;

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
    currentProcessedPoultryItemId: string,
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
      formData.append("entity_type", "processed_poultry_inventory_item");
      formData.append("entity_id", currentProcessedPoultryItemId);
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
    await loadProcessedPoultryMedia(currentProcessedPoultryItemId);

    return { ok: true };
  }

  async function saveDraft(): Promise<PoultryProductSaveResult> {
    if (!seller) {
      return {
        ok: false,
        message: "Store context is missing. Refresh and try again.",
      };
    }

    const errors = validatePoultryProductForm(form);
    setValidationErrors(errors);

    if (errors.length > 0) {
      return {
        ok: false,
        message: "Complete the required product details first.",
      };
    }

    const rpcName = processedPoultryItemId
      ? "seller_update_poultry_product_inventory_item"
      : "seller_create_poultry_product_inventory_item";
    const payload = processedPoultryItemId
      ? {
          p_processed_poultry_inventory_item_id: processedPoultryItemId,
          ...buildPoultryProductRpcPayload(form),
        }
      : {
          ...buildPoultryProductRpcPayload(form),
          p_store_id: seller.store_id,
        };

    const result = await supabase.rpc(rpcName, payload);

    if (result.error) {
      return { ok: false, message: result.error.message };
    }

    const savedId = getProcessedPoultryItemId(result.data) || processedPoultryItemId;

    if (!savedId) {
      return {
        ok: false,
        message: "The poultry product saved, but the photo target could not be loaded.",
      };
    }

    setProcessedPoultryItemId(savedId);
    await loadProcessedPoultryMedia(savedId);

    return {
      ok: true,
      processedPoultryItemId: savedId,
    };
  }

  async function handleSaveDraft() {
    if (saveDraftStatus === "saving" || publishStatus === "publishing") return;

    setSaveDraftStatus("saving");
    setActionError(null);
    setActionMessage(null);

    const saveResult = await saveDraft();

    if (!saveResult.ok) {
      setSaveDraftStatus("error");
      setActionError(saveResult.message);
      return;
    }

    const uploadResult = await uploadPendingPhotos(saveResult.processedPoultryItemId);

    if (!uploadResult.ok) {
      setSaveDraftStatus("error");
      setActionError(
        `Poultry product was saved as a draft, but photos were not uploaded. ${uploadResult.message}`,
      );
      return;
    }

    setSavedFormSnapshot(getFormSnapshot(form));
    setSaveDraftStatus("success");
    setActionMessage(isEditMode ? "Changes saved." : "Draft saved.");
  }

  async function handlePublish() {
    if (publishStatus === "publishing" || saveDraftStatus === "saving") return;

    setPublishStatus("publishing");
    setActionError(null);
    setActionMessage(null);

    const saveResult = await saveDraft();

    if (!saveResult.ok) {
      setPublishStatus("error");
      setActionError(saveResult.message);
      return;
    }

    const uploadResult = await uploadPendingPhotos(saveResult.processedPoultryItemId);

    if (!uploadResult.ok) {
      setPublishStatus("error");
      setActionError(
        `Poultry product was saved as a draft, but photos were not uploaded. ${uploadResult.message}`,
      );
      return;
    }

    const publishResult = await supabase.rpc(
      "seller_set_processed_poultry_inventory_visibility",
      {
        p_processed_poultry_inventory_item_id:
          saveResult.processedPoultryItemId,
        p_visibility_status: "active",
      },
    );

    if (publishResult.error) {
      setPublishStatus("error");
      setActionError(publishResult.error.message);
      return;
    }

    setSavedFormSnapshot(getFormSnapshot(form));
    setPublishStatus("success");
    router.push("/dashboard/inventory");
  }

  function resetForm() {
    pendingPhotos.forEach((photo) => URL.revokeObjectURL(photo.url));
    setForm((current) => ({
      ...emptyForm,
      speciesId: species.find((item) => item.slug === "chicken")?.id ??
        species[0]?.id ??
        current.speciesId,
    }));
    setProcessedPoultryItemId("");
    setMediaItems([]);
    setPendingPhotos([]);
    setPhotoError(null);
    setSavedFormSnapshot(null);
    setValidationErrors([]);
    setActionError(null);
    setActionMessage(null);
    setSaveDraftStatus("idle");
    setPublishStatus("idle");
    setIsStartOverDialogOpen(false);
  }

  if (isSellerLoading) {
    return <LoadingState label="Loading selling options..." />;
  }

  if (!processedPoultryEnabled) {
    return (
      <DashboardPageContent className="bg-stone-50/60">
        <div className="max-w-3xl">
          <SellerCard className="p-5">
            {!plan.processedPoultryEnabled ? (
              <PlanUpgradePrompt feature="processed_poultry" />
            ) : (
              <>
                <h1 className="text-xl font-semibold text-stone-950">
                  Poultry Products is turned off for this store.
                </h1>
                <p className="mt-2 text-sm leading-6 text-stone-600">
                  Turn it on in Store Admin when you want to create new poultry
                  product listings.
                </p>
              </>
            )}
            <div className="mt-5">
              <Link className="seller-secondary-button" href="/dashboard/store-admin">
                Store Admin
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
                {isEditMode ? "Edit Poultry Product" : "Add Poultry Products"}
              </h1>
              <p className="mt-2 max-w-3xl text-base leading-7 text-stone-600 sm:text-sm sm:leading-6">
                Add eggs, meat, broth, feathers, or other poultry products for
                sale.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 lg:justify-end">
              {isEditMode ? (
                <Link className="seller-secondary-button bg-white" href="/dashboard/inventory">
                  Cancel
                </Link>
              ) : (
                <button
                  className="seller-secondary-button bg-white"
                  type="button"
                  onClick={() => setIsStartOverDialogOpen(true)}
                >
                  Start over
                </button>
              )}
              <span className="inline-flex min-h-10 items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-800">
                {isEditMode
                  ? savedFormSnapshot
                    ? "Changes saved"
                    : "Loaded for editing"
                  : savedFormSnapshot
                    ? "Draft saved"
                    : "Draft not saved yet"}
              </span>
            </div>
          </div>
        </header>

        {isLoadingSpecies || isLoadingExistingProduct ? (
          <LoadingState label="Loading poultry product form..." />
        ) : loadError ? (
          <ErrorState
            title="Poultry Products could not load"
            message={loadError}
          />
        ) : (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <main className="space-y-4">
              <SectionCard step="1" title="Product Details">
                <div className="grid gap-4">
                  <label>
                    <span className="mb-1.5 block text-base font-bold text-stone-700 sm:text-xs sm:font-semibold sm:text-stone-600">
                      Product Name
                    </span>
                    <input
                      className={inputClass}
                      placeholder="Enter product name"
                      value={form.productName}
                      onChange={(event) =>
                        updateForm({ productName: event.target.value })
                      }
                    />
                  </label>

                  <div className="grid gap-4 md:grid-cols-3">
                    <CompactField label="Product Type">
                      <select
                        className={inputClass}
                        value={form.productType}
                        onChange={(event) =>
                          updateForm({ productType: event.target.value })
                        }
                      >
                        <option value="">Choose product type</option>
                        {productTypeOptions.map((productType) => (
                          <option key={productType} value={productType}>
                            {productType}
                          </option>
                        ))}
                      </select>
                    </CompactField>
                    <CompactField label="Species">
                      <select
                        className={inputClass}
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
                    </CompactField>
                    <CompactField label="Available Date">
                      <input
                        className={inputClass}
                        type="date"
                        value={form.availableDate}
                        onChange={(event) =>
                          updateForm({ availableDate: event.target.value })
                        }
                      />
                    </CompactField>
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <CompactField
                      helperText="Examples: 1 dozen, approx. 4 lb bird, 1 lb package, 8 oz jar"
                      label="Package Weight / Size"
                    >
                      <input
                        className={inputClass}
                        placeholder="1 dozen"
                        value={form.packageSize}
                        onChange={(event) =>
                          updateForm({ packageSize: event.target.value })
                        }
                      />
                    </CompactField>
                    <CompactField
                      helperText="Number of packages/items available."
                      label="Quantity Available"
                    >
                      <input
                        className={inputClass}
                        inputMode="numeric"
                        min="0"
                        placeholder="Enter quantity"
                        step="1"
                        type="number"
                        value={form.quantityAvailable}
                        onChange={(event) =>
                          updateForm({ quantityAvailable: event.target.value })
                        }
                      />
                    </CompactField>
                    <CompactField helperText="Price per package/item." label="Price">
                      <input
                        className={inputClass}
                        inputMode="decimal"
                        min="0"
                        placeholder="0.00"
                        step="0.01"
                        type="number"
                        value={form.price}
                        onChange={(event) =>
                          updateForm({ price: event.target.value })
                        }
                      />
                    </CompactField>
                  </div>
                </div>
                {validationErrors.length > 0 ? (
                  <div className="mt-4">
                    <ValidationMessage errors={validationErrors} />
                  </div>
                ) : null}
              </SectionCard>

              <SectionCard step="2" title="Photos">
                <PoultryProductPhotos
                  addPendingPhotos={addPendingPhotos}
                  mediaItems={mediaItems}
                  pendingPhotos={pendingPhotos}
                  photoError={photoError}
                  processedPoultryItemId={processedPoultryItemId}
                  removePendingPhoto={removePendingPhoto}
                  reorderPendingPhotos={reorderPendingPhotos}
                  storeId={storeId}
                  onReload={() => {
                    if (processedPoultryItemId) {
                      void loadProcessedPoultryMedia(processedPoultryItemId);
                    }
                  }}
                />
              </SectionCard>

              <SectionCard step="3" title="Description">
                <p className="text-base leading-7 text-stone-600 sm:text-sm sm:leading-6">
                  Add pickup details, processing notes, package details,
                  storage info, or anything buyers should know.
                </p>
                <textarea
                  className={`${inputClass} mt-4 min-h-32 resize-y py-3 leading-6`}
                  maxLength={descriptionMaxLength}
                  placeholder="Share important information that helps buyers make informed decisions."
                  value={form.description}
                  onChange={(event) =>
                    updateForm({ description: event.target.value })
                  }
                />
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
                      Your product will be visible in your storefront inventory.
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
              <PoultryProductSummaryCard
                form={form}
                selectedSpeciesName={selectedSpecies?.common_name ?? ""}
              />
              <PoultryProductReadinessCard
                descriptionComplete={descriptionComplete}
                photoCount={activePhotoCount}
                productDetailsComplete={productDetailsComplete}
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

function PoultryProductPhotos({
  addPendingPhotos,
  mediaItems,
  onReload,
  pendingPhotos,
  photoError,
  processedPoultryItemId,
  removePendingPhoto,
  reorderPendingPhotos,
  storeId,
}: {
  addPendingPhotos: (files: FileList | null) => void;
  mediaItems: ListingPhotoItem[];
  onReload: () => void;
  pendingPhotos: PendingPhoto[];
  photoError: string | null;
  processedPoultryItemId: string;
  removePendingPhoto: (photo: PendingPhoto) => void;
  reorderPendingPhotos: (photos: DashboardPhoto[]) => void;
  storeId: string;
}) {
  if (pendingPhotos.length > 0 || !processedPoultryItemId) {
    return (
      <PendingPoultryProductPhotos
        addPendingPhotos={addPendingPhotos}
        pendingPhotos={pendingPhotos}
        photoError={photoError}
        removePendingPhoto={removePendingPhoto}
        reorderPendingPhotos={reorderPendingPhotos}
      />
    );
  }

  return (
    <ListingPhotosSection
      key={processedPoultryItemId}
      canManage
      description="Manage the photos buyers see for this product. The first photo will be the featured storefront photo."
      emptyDescription="No poultry product photos have been added yet."
      entityId={processedPoultryItemId}
      entityType="processed_poultry_inventory_item"
      listingBatchId={processedPoultryItemId}
      mediaItems={mediaItems}
      mode="setup"
      storeId={storeId}
      title="Photos"
      onReload={onReload}
    />
  );
}

function PendingPoultryProductPhotos({
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
        description="Manage the photos buyers see for this product. The first photo will be the featured storefront photo."
        emptyDescription="Add photos now. They will be saved when you save or publish this product."
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
        maxPhotos={maxPoultryProductPhotos}
        photos={dashboardPhotos}
        removePhotoContext="item"
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
          Photos will be saved when you save or publish this product.
        </p>
      ) : null}
    </div>
  );
}

function CompactField({
  children,
  helperText,
  label,
}: {
  children: ReactNode;
  helperText?: string;
  label: string;
}) {
  return (
    <label>
      <span className="mb-1.5 block text-base font-bold text-stone-700 sm:text-xs sm:font-semibold sm:text-stone-600">
        {label}
      </span>
      {children}
      {helperText ? (
        <span className="mt-1.5 block text-sm font-medium leading-5 text-stone-500">
          {helperText}
        </span>
      ) : null}
    </label>
  );
}

function PoultryProductSummaryCard({
  form,
  selectedSpeciesName,
}: {
  form: PoultryProductFormState;
  selectedSpeciesName: string;
}) {
  return (
    <SidebarCard title="Poultry Products Summary">
      <SummaryRow
        glyph="/glyphs/egg-carton.png"
        label="Product type"
        value={form.productType || "Not selected"}
      />
      <SummaryRow
        glyph="/glyphs/hen.png"
        label="Species"
        value={selectedSpeciesName || "Not selected"}
      />
      <SummaryRow
        glyph="/glyphs/calendar.png"
        label="Available date"
        value={formatDate(form.availableDate)}
      />
      <SummaryRow
        glyph="/glyphs/feed-sack.png"
        label="Quantity available"
        value={form.quantityAvailable.trim() || "0"}
      />
      <SummaryRow
        glyph="/glyphs/egg.png"
        label="Price"
        value={isValidMoney(form.price) ? formatCurrency(form.price) : "$0.00"}
      />
    </SidebarCard>
  );
}

function PoultryProductReadinessCard({
  descriptionComplete,
  photoCount,
  productDetailsComplete,
}: {
  descriptionComplete: boolean;
  photoCount: number;
  productDetailsComplete: boolean;
}) {
  return (
    <SidebarCard title="Ready to Publish">
      <div className="space-y-3">
        <ChecklistRow complete={photoCount > 0} label="Photos" />
        <ChecklistRow complete={productDetailsComplete} label="Product Details" />
        <ChecklistRow complete={descriptionComplete} label="Description" />
      </div>
      <p
        className={`mt-5 rounded-md border px-3 py-2 text-base font-semibold sm:text-sm ${
          productDetailsComplete
            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
            : "border-stone-200 bg-stone-50 text-stone-600"
        }`}
      >
        {productDetailsComplete
          ? "Looks ready to publish."
          : "Complete product details to publish."}
      </p>
      <p className="mt-4 text-sm leading-6 text-stone-600">
        Products go live immediately and are visible to buyers in your
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

function ValidationMessage({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null;

  return (
    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2">
      <p className="text-sm font-semibold text-red-700">{errors.join(" ")}</p>
    </div>
  );
}

function validatePoultryProductForm(form: PoultryProductFormState) {
  const errors = validateProductDetails(form);

  if (form.description.length > descriptionMaxLength) {
    errors.push(`Description must be ${descriptionMaxLength} characters or less.`);
  }

  return errors;
}

function validateProductDetails(form: PoultryProductFormState) {
  const errors: string[] = [];

  if (!form.productName.trim()) errors.push("Add a product name.");
  if (!productTypeOptions.includes(form.productType as PoultryProductType)) {
    errors.push("Choose a product type.");
  }
  if (!form.speciesId) errors.push("Choose a species.");
  if (!form.availableDate) errors.push("Add an available date.");
  if (!form.quantityAvailable.trim() || !isWholeNumber(form.quantityAvailable)) {
    errors.push("Quantity available must be a whole number of zero or more.");
  }
  if (!form.price.trim()) {
    errors.push("Add a price.");
  } else if (!isValidMoney(form.price)) {
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

function buildPoultryProductRpcPayload(form: PoultryProductFormState) {
  return {
    p_available_date: form.availableDate,
    p_description: form.description.trim() || null,
    p_package_size: form.packageSize.trim() || null,
    p_price: Number(form.price),
    p_product_name: form.productName.trim(),
    p_product_type: form.productType,
    p_quantity_available: Number(form.quantityAvailable),
    p_seller_notes: null,
    p_species_id: form.speciesId,
  };
}

function getProcessedPoultryItemId(data: unknown) {
  const rows = Array.isArray(data)
    ? (data as PoultryProductRpcResult[])
    : data
      ? [data as PoultryProductRpcResult]
      : [];

  return rows[0]?.processed_poultry_inventory_item_id ?? rows[0]?.id ?? "";
}

function getSpeciesIdForLegacyPoultryType(
  species: ReferenceSpecies[],
  poultryType: string | null,
) {
  const slugByLegacyType: Record<string, string> = {
    Chicken: "chicken",
    Duck: "duck",
    Goose: "goose",
    Turkey: "turkey",
  };
  const speciesSlug = poultryType ? slugByLegacyType[poultryType] : null;

  if (!speciesSlug) return null;

  return species.find((item) => item.slug === speciesSlug)?.id ?? null;
}

function getFormSnapshot(form: PoultryProductFormState) {
  return JSON.stringify({
    availableDate: form.availableDate,
    description: form.description.trim(),
    packageSize: form.packageSize.trim(),
    price: form.price.trim(),
    productName: form.productName.trim(),
    productType: form.productType,
    quantityAvailable: form.quantityAvailable.trim(),
    speciesId: form.speciesId,
  });
}

function hasStartedForm(form: PoultryProductFormState) {
  return Boolean(
    form.availableDate ||
      form.description.trim() ||
      form.packageSize.trim() ||
      form.price.trim() ||
      form.productName.trim() ||
      form.productType ||
      form.quantityAvailable.trim(),
  );
}

function isWholeNumber(value: string) {
  if (!/^\d+$/.test(value.trim())) return false;

  return Number(value) >= 0;
}

function isValidMoney(value: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) return false;

  return Number(value) >= 0;
}

function formatCurrency(value: string) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(Number(value || 0));
}

function formatDate(value: string) {
  if (!value) return "Not selected";

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value.slice(0, 10)}T00:00:00`));
}

function getPublishDisabledReason({
  isPublishing,
  productDetailsComplete,
}: {
  isPublishing: boolean;
  productDetailsComplete: boolean;
}) {
  if (isPublishing) return "Publish already in progress.";
  if (!productDetailsComplete) return "Complete product details to publish.";

  return null;
}
