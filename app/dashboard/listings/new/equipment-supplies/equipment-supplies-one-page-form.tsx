"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPlanCapabilities } from "@/lib/plan-capabilities";
import { supabase } from "@/lib/supabase";
import { ListingShareDialog } from "../../../_components/listing-share-dialog";
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
} from "../../../_components/equipment-photos";
import { buildPublicListingPath } from "../../../_lib/public-listing-url";
import {
  equipmentCategories,
  equipmentConditions,
  type EquipmentCategory,
  type EquipmentCondition,
} from "../../../_lib/equipment-inventory";
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
import { ListingPhotosSection } from "../../[listingBatchId]/listing-photos-section";

type EquipmentFormState = {
  availableDate: string;
  category: string;
  condition: string;
  description: string;
  itemName: string;
  price: string;
  quantityAvailable: string;
};

type EquipmentSaveResult =
  | { ok: true; equipmentItemId: string }
  | { ok: false; message: string };

type EquipmentRpcResult = {
  equipment_inventory_item_id?: string | null;
  id?: string | null;
};

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

type ExistingEquipmentRow = {
  available_date: string | null;
  category: string;
  condition: string | null;
  description: string | null;
  equipment_inventory_item_id: string;
  item_name: string;
  price: number | null;
  quantity_available: number | null;
};

type EquipmentSuppliesOnePageFormProps = {
  initialEquipmentItemId?: string;
};

type PublishSuccessDialogState = {
  listingTitle: string;
  publicPath: ReturnType<typeof buildPublicListingPath>;
  shareText: string | null;
  summary: string | null;
};

const todayIsoDate = new Date().toISOString().slice(0, 10);

const emptyForm: EquipmentFormState = {
  availableDate: todayIsoDate,
  category: "",
  condition: "",
  description: "",
  itemName: "",
  price: "",
  quantityAvailable: "",
};

const acceptedPendingImageTypes = ["image/jpeg", "image/png", "image/webp"] as const;
const descriptionMaxLength = 1000;
const maxEquipmentPhotos = 4;
const maxPendingImageSizeBytes = 8 * 1024 * 1024;

export function EquipmentSuppliesOnePageForm({
  initialEquipmentItemId = "",
}: EquipmentSuppliesOnePageFormProps) {
  const router = useRouter();
  const { seller, isLoading: isSellerLoading } = useSellerContext();
  const plan = getPlanCapabilities(seller?.plan_key);
  const storeId = seller?.store_id ?? "";
  const equipmentSuppliesEnabled =
    Boolean(seller?.equipment_supplies_enabled) && plan.equipmentSuppliesEnabled;
  const [form, setForm] = useState<EquipmentFormState>(emptyForm);
  const [equipmentItemId, setEquipmentItemId] = useState(initialEquipmentItemId);
  const [mediaItems, setMediaItems] = useState<ListingPhotoItem[]>([]);
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [savedFormSnapshot, setSavedFormSnapshot] = useState<string | null>(
    null,
  );
  const pendingPhotosRef = useRef<PendingPhoto[]>([]);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [isLoadingExistingEquipment, setIsLoadingExistingEquipment] =
    useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveDraftStatus, setSaveDraftStatus] =
    useState<SaveDraftStatus>("idle");
  const [publishStatus, setPublishStatus] = useState<PublishStatus>("idle");
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isStartOverDialogOpen, setIsStartOverDialogOpen] = useState(false);
  const [publishSuccessDialog, setPublishSuccessDialog] =
    useState<PublishSuccessDialogState | null>(null);
  const isNavigatingAfterPublishRef = useRef(false);
  const isEditMode = Boolean(initialEquipmentItemId);

  const formSnapshot = useMemo(() => getFormSnapshot(form), [form]);
  const activeSavedPhotoCount = mediaItems.filter(
    (item) =>
      item.visibility_status === "active" &&
      item.asset_status === "active" &&
      item.moderation_status === "approved",
  ).length;
  const activePhotoCount = activeSavedPhotoCount + pendingPhotos.length;
  const itemDetailsComplete = validateItemDetails(form).length === 0;
  const descriptionComplete = form.description.trim().length > 0;
  const saveDraftDisabledReason =
    saveDraftStatus === "saving" ||
    publishStatus === "publishing" ||
    publishSuccessDialog
      ? "Save already in progress."
      : null;
  const publishDisabledReason = getPublishDisabledReason({
    isPublishing: publishStatus === "publishing" || Boolean(publishSuccessDialog),
    itemDetailsComplete,
  });
  const hasUnsavedChanges =
    pendingPhotos.length > 0 ||
    (savedFormSnapshot !== null
      ? formSnapshot !== savedFormSnapshot
      : hasStartedForm(form));

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
        "Leave without saving this equipment item?",
      );

      if (!shouldLeave) event.preventDefault();
    }

    document.addEventListener("click", handleDocumentClick, true);

    return () => {
      document.removeEventListener("click", handleDocumentClick, true);
    };
  }, [hasUnsavedChanges]);

  const loadEquipmentMedia = useCallback(
    async (currentEquipmentItemId: string) => {
      if (!storeId || !currentEquipmentItemId) return;

      const mediaResult = await supabase
        .from("seller_media_management")
        .select(sellerMediaSelect)
        .eq("store_id", storeId)
        .eq("entity_type", "equipment_inventory_item")
        .eq("entity_id", currentEquipmentItemId)
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
    if (!storeId || !equipmentSuppliesEnabled || !initialEquipmentItemId) {
      return;
    }

    let isMounted = true;

    async function loadExistingEquipment() {
      setIsLoadingExistingEquipment(true);
      setLoadError(null);

      const result = await supabase
        .from("seller_equipment_inventory_management")
        .select(
          "equipment_inventory_item_id, item_name, category, condition, available_date, description, quantity_available, price",
        )
        .eq("store_id", storeId)
        .eq("equipment_inventory_item_id", initialEquipmentItemId)
        .maybeSingle<ExistingEquipmentRow>();

      if (!isMounted) return;

      if (result.error) {
        setLoadError(result.error.message);
        setIsLoadingExistingEquipment(false);
        return;
      }

      if (!result.data) {
        setLoadError("This equipment item could not be found.");
        setIsLoadingExistingEquipment(false);
        return;
      }

      const loadedForm: EquipmentFormState = {
        availableDate: result.data.available_date ?? todayIsoDate,
        category: result.data.category ?? "",
        condition: result.data.condition ?? "",
        description: result.data.description ?? "",
        itemName: result.data.item_name ?? "",
        price:
          result.data.price === null || result.data.price === undefined
            ? ""
            : String(result.data.price),
        quantityAvailable:
          result.data.quantity_available === null ||
          result.data.quantity_available === undefined
            ? ""
            : String(result.data.quantity_available),
      };

      setEquipmentItemId(result.data.equipment_inventory_item_id);
      setForm(loadedForm);
      setSavedFormSnapshot(getFormSnapshot(loadedForm));
      setActionMessage(null);
      setActionError(null);
      await loadEquipmentMedia(result.data.equipment_inventory_item_id);

      if (isMounted) setIsLoadingExistingEquipment(false);
    }

    void loadExistingEquipment();

    return () => {
      isMounted = false;
    };
  }, [
    equipmentSuppliesEnabled,
    initialEquipmentItemId,
    loadEquipmentMedia,
    storeId,
  ]);

  function updateForm(updates: Partial<EquipmentFormState>) {
    setForm((current) => ({ ...current, ...updates }));
    setValidationErrors([]);
    setActionError(null);
    setActionMessage(null);
    if (saveDraftStatus === "success") setSaveDraftStatus("idle");
    if (publishStatus === "success") setPublishStatus("idle");
    setPublishSuccessDialog(null);
  }

  function addPendingPhotos(files: FileList | null) {
    if (!files || files.length === 0) return;

    const selectedFiles = Array.from(files);
    const availableSlots = maxEquipmentPhotos - activePhotoCount;

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
    currentEquipmentItemId: string,
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

    const uploadedMedia: ListingPhotoItem[] = [];

    for (const [index, pendingPhoto] of pendingPhotos.entries()) {
      const formData = new FormData();
      formData.append("file", pendingPhoto.file);
      formData.append("store_id", seller.store_id);
      formData.append("entity_type", "equipment_inventory_item");
      formData.append("entity_id", currentEquipmentItemId);
      formData.append("display_context", "gallery");
      formData.append("sort_order", String(activeSavedPhotoCount + index));
      formData.append(
        "is_featured",
        String(
          activeSavedPhotoCount === 0 &&
            uploadedMedia.length === 0 &&
            index === 0,
        ),
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
    await loadEquipmentMedia(currentEquipmentItemId);

    return { ok: true };
  }

  async function saveDraft(): Promise<EquipmentSaveResult> {
    if (!seller) {
      return {
        ok: false,
        message: "Store context is missing. Refresh and try again.",
      };
    }

    const errors = validateEquipmentForm(form);
    setValidationErrors(errors);

    if (errors.length > 0) {
      return {
        ok: false,
        message: "Complete the required item details first.",
      };
    }

    const rpcName = equipmentItemId
      ? "seller_update_equipment_inventory_item_v2"
      : "seller_create_equipment_inventory_item_v2";
    const payload = equipmentItemId
      ? {
          p_equipment_inventory_item_id: equipmentItemId,
          ...buildEquipmentRpcPayload(form),
        }
      : {
          ...buildEquipmentRpcPayload(form),
          p_store_id: seller.store_id,
        };

    const result = await supabase.rpc(rpcName, payload);

    if (result.error) {
      return { ok: false, message: result.error.message };
    }

    const savedId = getEquipmentItemId(result.data) || equipmentItemId;

    if (!savedId) {
      return {
        ok: false,
        message: "The equipment item saved, but the photo target could not be loaded.",
      };
    }

    setEquipmentItemId(savedId);
    await loadEquipmentMedia(savedId);

    return { ok: true, equipmentItemId: savedId };
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

    const uploadResult = await uploadPendingPhotos(saveResult.equipmentItemId);

    if (!uploadResult.ok) {
      setSaveDraftStatus("error");
      setActionError(
        `Equipment was saved as a draft, but photos were not uploaded. ${uploadResult.message}`,
      );
      return;
    }

    setSavedFormSnapshot(getFormSnapshot(form));
    setSaveDraftStatus("success");
    setActionMessage(isEditMode ? "Changes saved." : "Draft saved.");
  }

  async function handlePublish() {
    if (
      publishStatus === "publishing" ||
      saveDraftStatus === "saving" ||
      publishSuccessDialog
    ) {
      return;
    }

    setPublishStatus("publishing");
    setActionError(null);
    setActionMessage(null);
    setPublishSuccessDialog(null);

    const saveResult = await saveDraft();

    if (!saveResult.ok) {
      setPublishStatus("error");
      setActionError(saveResult.message);
      return;
    }

    const uploadResult = await uploadPendingPhotos(saveResult.equipmentItemId);

    if (!uploadResult.ok) {
      setPublishStatus("error");
      setActionError(
        `Equipment was saved as a draft, but photos were not uploaded. ${uploadResult.message}`,
      );
      return;
    }

    const publishResult = await supabase.rpc(
      "seller_set_equipment_inventory_visibility",
      {
        p_equipment_inventory_item_id: saveResult.equipmentItemId,
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
    setPublishSuccessDialog({
      listingTitle: form.itemName.trim() || "Equipment or supply item",
      publicPath: buildPublicListingPath({
        listingType: "equipment_supplies",
        equipmentItemId: saveResult.equipmentItemId,
        storeSlug: seller?.store_slug,
      }),
      shareText: buildEquipmentShareText(form, seller?.store_name),
      summary: buildEquipmentShareSummary(form),
    });
  }

  function navigateToInventoryAfterPublish() {
    if (isNavigatingAfterPublishRef.current) return;

    isNavigatingAfterPublishRef.current = true;
    setPublishSuccessDialog(null);
    router.push("/dashboard/inventory");
  }

  function resetForm() {
    pendingPhotos.forEach((photo) => URL.revokeObjectURL(photo.url));
    setForm(emptyForm);
    setEquipmentItemId("");
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

  if (!equipmentSuppliesEnabled) {
    return (
      <DashboardPageContent className="bg-stone-50/60">
        <div className="max-w-3xl">
          <SellerCard className="p-5">
            {!plan.equipmentSuppliesEnabled ? (
              <PlanUpgradePrompt feature="equipment_supplies" />
            ) : (
              <>
                <h1 className="text-xl font-semibold text-stone-950">
                  Equipment & Supplies is turned off for this store.
                </h1>
                <p className="mt-2 text-sm leading-6 text-stone-600">
                  Turn it on in Store Admin when you want to create equipment or
                  supply listings.
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
                {isEditMode ? "Edit Equipment & Supplies" : "Add Equipment & Supplies"}
              </h1>
              <p className="mt-2 max-w-3xl text-base leading-7 text-stone-600 sm:text-sm sm:leading-6">
                Add equipment, supplies, or other non-bird inventory for sale.
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

        {isLoadingExistingEquipment ? (
          <LoadingState label="Loading equipment form..." />
        ) : loadError ? (
          <ErrorState title="Equipment could not load" message={loadError} />
        ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <main className="space-y-4">
            <SectionCard step="1" title="Item Details">
              <div className="grid gap-4">
                <label>
                  <span className="mb-1.5 block text-base font-bold text-stone-700 sm:text-xs sm:font-semibold sm:text-stone-600">
                    Item Name
                  </span>
                  <input
                    className={inputClass}
                    placeholder="Enter item name"
                    value={form.itemName}
                    onChange={(event) =>
                      updateForm({ itemName: event.target.value })
                    }
                  />
                </label>

                <div className="grid gap-4 md:grid-cols-3">
                  <CompactField label="Category">
                    <select
                      className={inputClass}
                      value={form.category}
                      onChange={(event) =>
                        updateForm({ category: event.target.value })
                      }
                    >
                      <option value="">Choose category</option>
                      {equipmentCategories.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  </CompactField>

                  <CompactField label="Condition">
                    <select
                      className={inputClass}
                      value={form.condition}
                      onChange={(event) =>
                        updateForm({ condition: event.target.value })
                      }
                    >
                      <option value="">Not specified</option>
                      {equipmentConditions.map((condition) => (
                        <option key={condition} value={condition}>
                          {condition}
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

                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  <CompactField
                    helperText="Number of items available."
                    label="Quantity Available"
                  >
                    <input
                      className={inputClass}
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

                  <CompactField helperText="Flat price per item." label="Price">
                    <div className="flex overflow-hidden rounded-md border border-stone-300 bg-white focus-within:border-emerald-700 focus-within:ring-2 focus-within:ring-emerald-700/20">
                      <span className="flex items-center border-r border-stone-200 bg-stone-50 px-3 text-stone-600">
                        $
                      </span>
                      <input
                        className="min-h-11 w-full border-0 bg-transparent px-3 text-base text-stone-950 outline-none placeholder:text-stone-400 sm:min-h-10 sm:text-sm"
                        min="0"
                        placeholder="0.00"
                        step="0.01"
                        type="number"
                        value={form.price}
                        onChange={(event) =>
                          updateForm({ price: event.target.value })
                        }
                      />
                    </div>
                  </CompactField>
                </div>

                <ValidationMessage errors={validationErrors} />
              </div>
            </SectionCard>

            <SectionCard step="2" title="Photos">
              <EquipmentPhotos
                addPendingPhotos={addPendingPhotos}
                equipmentItemId={equipmentItemId}
                mediaItems={mediaItems}
                pendingPhotos={pendingPhotos}
                photoError={photoError}
                removePendingPhoto={removePendingPhoto}
                reorderPendingPhotos={reorderPendingPhotos}
                storeId={storeId}
                onReload={() => {
                  if (equipmentItemId) void loadEquipmentMedia(equipmentItemId);
                }}
              />
            </SectionCard>

            <SectionCard step="3" title="Description">
              <label>
                <span className="mb-2 block text-base leading-7 text-stone-600 sm:text-sm sm:leading-6">
                  Add item details, pickup notes, condition notes, dimensions,
                  compatibility, or anything buyers should know.
                </span>
                <textarea
                  className={`${inputClass} min-h-28 resize-y py-3`}
                  maxLength={descriptionMaxLength}
                  placeholder="Share important information that helps buyers make informed decisions."
                  value={form.description}
                  onChange={(event) =>
                    updateForm({ description: event.target.value })
                  }
                />
              </label>
              <p className="mt-2 text-sm text-stone-500">
                Keep it clear, accurate, and helpful.
              </p>
            </SectionCard>

            <SectionCard step="4" title="Ready to publish?">
              <div className="space-y-4">
                <div>
                  <p className="text-base leading-7 text-stone-700 sm:text-sm sm:leading-6">
                    {isEditMode
                      ? "Review the details above, then save your changes."
                      : "Review the details above, then publish when everything looks right."}
                  </p>
                  <p className="text-base leading-7 text-stone-500 sm:text-sm sm:leading-6">
                    Your item will be visible in your storefront inventory.
                  </p>
                </div>

                {actionError ? (
                  <ErrorState title="Equipment was not saved" message={actionError} />
                ) : null}
                {actionMessage ? (
                  <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
                    {actionMessage}
                  </p>
                ) : null}

                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:flex-wrap sm:justify-end">
                  <SaveDraftButton
                    canSaveDraft
                    idleLabel={isEditMode ? "Save Changes" : undefined}
                    onSaveDraft={() => void handleSaveDraft()}
                    saveDraftDisabledReason={saveDraftDisabledReason}
                    saveDraftStatus={saveDraftStatus}
                    successLabel={isEditMode ? "Changes saved" : undefined}
                  />
                  {!isEditMode ? (
                    <PublishInventoryButton
                      onReviewPublish={() => void handlePublish()}
                      publishDisabledReason={publishDisabledReason}
                      publishStatus={publishStatus}
                    />
                  ) : null}
                </div>
              </div>
            </SectionCard>
          </main>

          <aside className="space-y-4">
            <EquipmentSummarySidebar
              form={form}
              itemDetailsComplete={itemDetailsComplete}
              photoCount={activePhotoCount}
              descriptionComplete={descriptionComplete}
            />
          </aside>
        </div>
        )}
      </div>

      {!isEditMode && isStartOverDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-stone-950">
              Start over?
            </h2>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              This clears the form on this page. Saved drafts remain in
              inventory.
            </p>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                className="seller-secondary-button"
                type="button"
                onClick={() => setIsStartOverDialogOpen(false)}
              >
                Cancel
              </button>
              <button
                className="seller-primary-button"
                type="button"
                onClick={resetForm}
              >
                Start over
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <ListingShareDialog
        isStorePublic={Boolean(seller?.is_publicly_available)}
        listingTitle={
          publishSuccessDialog?.listingTitle ?? "Equipment or supply item"
        }
        mode="published"
        open={Boolean(publishSuccessDialog)}
        publicPath={publishSuccessDialog?.publicPath}
        shareText={publishSuccessDialog?.shareText}
        storeName={seller?.store_name ?? "your store"}
        summary={publishSuccessDialog?.summary}
        onClose={navigateToInventoryAfterPublish}
        onDone={navigateToInventoryAfterPublish}
      />
    </DashboardPageContent>
  );
}

function EquipmentPhotos({
  addPendingPhotos,
  equipmentItemId,
  mediaItems,
  pendingPhotos,
  photoError,
  removePendingPhoto,
  reorderPendingPhotos,
  storeId,
  onReload,
}: {
  addPendingPhotos: (files: FileList | null) => void;
  equipmentItemId: string;
  mediaItems: ListingPhotoItem[];
  pendingPhotos: PendingPhoto[];
  photoError: string | null;
  removePendingPhoto: (photo: PendingPhoto) => void;
  reorderPendingPhotos: (photos: DashboardPhoto[]) => void;
  storeId: string;
  onReload: () => void;
}) {
  if (equipmentItemId) {
    return (
      <ListingPhotosSection
        canManage
        description="Manage the photos buyers see for this listing. The first photo will be the featured storefront photo."
        emptyDescription="Add clear photos so buyers can recognize this item."
        entityId={equipmentItemId}
        entityType="equipment_inventory_item"
        listingBatchId={equipmentItemId}
        mediaItems={mediaItems}
        mode="setup"
        storeId={storeId}
        title="Photos"
        onReload={onReload}
      />
    );
  }

  return (
    <PendingEquipmentPhotos
      addPendingPhotos={addPendingPhotos}
      pendingPhotos={pendingPhotos}
      photoError={photoError}
      removePendingPhoto={removePendingPhoto}
      reorderPendingPhotos={reorderPendingPhotos}
    />
  );
}

function PendingEquipmentPhotos({
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
  const photos = pendingPhotos.map((photo, index) => ({
    filename: photo.file.name,
    id: photo.id,
    label: photo.file.name || `Pending photo ${index + 1}`,
    sortOrder: index,
    url: photo.url,
  }));
  const managerError = photoError
    ? { message: photoError, title: "Photo could not be added" }
    : null;

  return (
    <div className="space-y-2">
      <PhotoManager
        acceptedTypes={acceptedPendingImageTypes}
        allowCropEdit={false}
        canManage
        description="Manage the photos buyers see for this listing. The first photo will be the featured storefront photo."
        emptyDescription="Add clear photos so buyers can recognize this item."
        error={managerError}
        fillEmptySlots
        helperText="Photos will be saved when you save or publish this listing."
        maxFileSizeMb={maxPendingImageSizeBytes / 1024 / 1024}
        maxPhotos={maxEquipmentPhotos}
        photos={photos}
        removePhotoContext="photo"
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
          const index = pendingPhotos.findIndex((item) => item.id === photo.id);
          if (index <= 0) return;
          const nextPhotos = [...photos];
          const [featured] = nextPhotos.splice(index, 1);
          nextPhotos.unshift(featured);
          reorderPendingPhotos(nextPhotos);
        }}
      />
    </div>
  );
}

function EquipmentSummarySidebar({
  descriptionComplete,
  form,
  itemDetailsComplete,
  photoCount,
}: {
  descriptionComplete: boolean;
  form: EquipmentFormState;
  itemDetailsComplete: boolean;
  photoCount: number;
}) {
  return (
    <>
      <SidebarCard title="Equipment & Supplies Summary">
        <div className="divide-y divide-stone-100">
          <SummaryRow
            glyph="/glyphs/feed-sack.png"
            label="Category"
            value={form.category || "Not selected"}
          />
          <SummaryRow
            glyph="/glyphs/clipboard.png"
            label="Condition"
            value={form.condition || "Not specified"}
          />
          <SummaryRow
            glyph="/glyphs/calendar.png"
            label="Available date"
            value={formatDate(form.availableDate)}
          />
          <SummaryRow
            glyph="/glyphs/shopping-bag.png"
            label="Quantity available"
            value={form.quantityAvailable || "0"}
          />
          <SummaryRow
            glyph="/glyphs/cart.png"
            label="Price"
            value={formatCurrency(form.price)}
          />
        </div>
      </SidebarCard>

      <SidebarCard title="Ready to Publish">
        <div className="space-y-3">
          <ChecklistItem complete={photoCount > 0} label="Photos" />
          <ChecklistItem complete={itemDetailsComplete} label="Item Details" />
          <ChecklistItem complete={descriptionComplete} label="Description" />
        </div>
        <p className="mt-5 text-sm leading-6 text-stone-600">
          Listings go live immediately and are visible to buyers in your
          storefront.
        </p>
      </SidebarCard>
    </>
  );
}

function ChecklistItem({
  complete,
  label,
}: {
  complete: boolean;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={`flex size-5 items-center justify-center rounded-full border text-xs font-bold ${
          complete
            ? "border-emerald-600 bg-emerald-50 text-emerald-700"
            : "border-stone-300 bg-stone-50 text-stone-400"
        }`}
      >
        {complete ? "✓" : ""}
      </span>
      <span className="text-sm font-medium text-stone-700">{label}</span>
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
        <span className="mt-1.5 block text-xs leading-5 text-stone-500">
          {helperText}
        </span>
      ) : null}
    </label>
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

function buildEquipmentRpcPayload(form: EquipmentFormState) {
  return {
    p_available_date: form.availableDate,
    p_category: form.category,
    p_condition: form.condition || null,
    p_description: form.description.trim() || null,
    p_item_name: form.itemName.trim(),
    p_price: Number(form.price),
    p_quantity_available: Number(form.quantityAvailable),
    p_seller_notes: null,
  };
}

function getEquipmentItemId(data: unknown) {
  const rows = Array.isArray(data)
    ? (data as EquipmentRpcResult[])
    : data
      ? [data as EquipmentRpcResult]
      : [];

  return rows[0]?.equipment_inventory_item_id ?? rows[0]?.id ?? "";
}

function getFormSnapshot(form: EquipmentFormState) {
  return JSON.stringify({
    availableDate: form.availableDate,
    category: form.category,
    condition: form.condition,
    description: form.description.trim(),
    itemName: form.itemName.trim(),
    price: form.price.trim(),
    quantityAvailable: form.quantityAvailable.trim(),
  });
}

function getPublishDisabledReason({
  isPublishing,
  itemDetailsComplete,
}: {
  isPublishing: boolean;
  itemDetailsComplete: boolean;
}) {
  if (isPublishing) return "Publishing already in progress.";
  if (!itemDetailsComplete) return "Complete item details to publish.";

  return null;
}

function hasStartedForm(form: EquipmentFormState) {
  return Boolean(
    form.category ||
      form.condition ||
      form.description.trim() ||
      form.itemName.trim() ||
      form.price.trim() ||
      form.quantityAvailable.trim() ||
      form.availableDate !== todayIsoDate,
  );
}

function validateEquipmentForm(form: EquipmentFormState) {
  const errors = validateItemDetails(form);

  if (form.description.length > descriptionMaxLength) {
    errors.push(`Description must be ${descriptionMaxLength} characters or less.`);
  }

  return errors;
}

function validateItemDetails(form: EquipmentFormState) {
  const errors: string[] = [];

  if (!form.itemName.trim()) errors.push("Add an item name.");
  if (!equipmentCategories.includes(form.category as EquipmentCategory)) {
    errors.push("Choose a category.");
  }
  if (
    form.condition &&
    !equipmentConditions.includes(form.condition as EquipmentCondition)
  ) {
    errors.push("Choose a supported condition.");
  }
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

function isValidMoney(value: string) {
  return /^\d+(\.\d{1,2})?$/.test(value.trim()) && Number(value) >= 0;
}

function isWholeNumber(value: string) {
  return /^\d+$/.test(value.trim()) && Number(value) >= 0;
}

function formatCurrency(value: string) {
  const amount = Number(value);

  if (!value.trim() || !Number.isFinite(amount)) return "$0.00";

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(amount);
}

function buildEquipmentShareText(
  form: EquipmentFormState,
  storeName: string | null | undefined,
) {
  const listingTitle = stripTrailingSentencePunctuation(form.itemName);
  const sellerStoreName = stripTrailingSentencePunctuation(storeName ?? "");
  const price = isValidMoney(form.price) ? formatCurrency(form.price) : null;
  const sentences = [
    sellerStoreName ? `${listingTitle} from ${sellerStoreName}` : listingTitle,
    form.condition ? `${form.condition} condition` : null,
    price,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => `${stripTrailingSentencePunctuation(value)}.`);

  return sentences.length > 0 ? sentences.join(" ") : null;
}

function buildEquipmentShareSummary(form: EquipmentFormState) {
  const summaryParts = [
    form.condition ? `${form.condition} condition` : null,
    isValidMoney(form.price) ? formatCurrency(form.price) : null,
  ].filter(Boolean);

  return summaryParts.length > 0 ? summaryParts.join(" - ") : null;
}

function formatDate(value: string) {
  if (!value) return "Not selected";

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function stripTrailingSentencePunctuation(value: string) {
  return value.trim().replace(/[.!?]+$/g, "");
}
