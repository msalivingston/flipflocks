"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { getPlanCapabilities } from "@/lib/plan-capabilities";
import { supabase } from "@/lib/supabase";
import {
  PhotoManager,
  type DashboardPhoto,
} from "../../../../_components/photo-manager";
import { ListingShareDialog } from "../../../../_components/listing-share-dialog";
import { PlanUpgradePrompt } from "../../../../_components/plan-upgrade-prompt";
import { useSellerContext } from "../../../../_components/seller-context";
import {
  DashboardPageContent,
  ErrorState,
  LoadingState,
  SellerCard,
} from "../../../../_components/seller-ui";
import type {
  ReferenceBreed,
  ReferenceSpecies,
} from "../../../../_lib/seller-types";
import { buildPublicListingPath } from "../../../../_lib/public-listing-url";
import {
  ListingPhotosSection,
  type ListingPhotoItem,
} from "../../../[listingBatchId]/listing-photos-section";
import {
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
  description: string;
  itemName: string;
  minimumOrderQuantity: string;
  price: string;
  quantityAvailable: string;
  speciesId: string;
  visibilityStatus: string;
};

type HatchingEggSaveResult =
  | {
      ok: true;
      hatchingEggItemId: string;
      hatchingEggProductId: string | null;
    }
  | { ok: false; message: string };

type HatchingEggRpcResult = {
  hatching_egg_inventory_item_id?: string | null;
  id?: string | null;
};

type HatchingEggManagementRow = {
  hatching_egg_inventory_item_id: string;
  hatching_egg_product_id?: string | null;
  available_date: string;
  created_at?: string;
  description: string | null;
  item_name: string;
  minimum_order_quantity: number | null;
  price: number;
  quantity_available: number;
  species_id: string;
  updated_at?: string;
  visibility_status: string;
};

type HatchingEggGroupRow = {
  hatching_egg_inventory_item_id: string;
  created_at: string;
  description: string | null;
  item_name: string;
  updated_at: string;
  visibility_status: string;
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

type PublishSuccessDialogState = {
  listingTitle: string;
  publicPath: ReturnType<typeof buildPublicListingPath>;
  shareText: string | null;
  summary: string | null;
};

const emptyForm: HatchingEggFormState = {
  availableDate: "",
  description: "",
  itemName: "",
  minimumOrderQuantity: "",
  price: "",
  quantityAvailable: "",
  speciesId: "",
  visibilityStatus: "hidden",
};

const acceptedPendingImageTypes = ["image/jpeg", "image/png", "image/webp"] as const;
const descriptionMaxLength = 1000;
const maxHatchingEggPhotos = 4;
const maxPendingImageSizeBytes = 8 * 1024 * 1024;

export function HatchingEggsStandaloneOnePageForm({
  hatchingEggItemId: initialHatchingEggItemId,
  mode = "add",
}: {
  hatchingEggItemId?: string;
  mode?: "add" | "edit";
}) {
  const router = useRouter();
  const isEditMode = mode === "edit";
  const { seller, isLoading: isSellerLoading } = useSellerContext();
  const plan = getPlanCapabilities(seller?.plan_key);
  const storeId = seller?.store_id ?? "";
  const hatchingEggsEnabled =
    Boolean(seller?.hatching_eggs_enabled) && plan.hatchingEggsEnabled;
  const [species, setSpecies] = useState<ReferenceSpecies[]>([]);
  const [breeds, setBreeds] = useState<ReferenceBreed[]>([]);
  const [hatchingEggGroupRows, setHatchingEggGroupRows] = useState<
    HatchingEggGroupRow[]
  >([]);
  const [selectedBreedId, setSelectedBreedId] = useState<string | null>(null);
  const [form, setForm] = useState<HatchingEggFormState>(emptyForm);
  const [hatchingEggItemId, setHatchingEggItemId] = useState(
    initialHatchingEggItemId ?? "",
  );
  const [mediaItems, setMediaItems] = useState<ListingPhotoItem[]>([]);
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [savedFormSnapshot, setSavedFormSnapshot] = useState<string | null>(null);
  const pendingPhotosRef = useRef<PendingPhoto[]>([]);
  const [isLoadingSpecies, setIsLoadingSpecies] = useState(false);
  const [isLoadingItem, setIsLoadingItem] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [saveDraftStatus, setSaveDraftStatus] =
    useState<SaveDraftStatus>("idle");
  const [publishStatus, setPublishStatus] = useState<PublishStatus>("idle");
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [hasEditedDescription, setHasEditedDescription] = useState(false);
  const [isStartOverDialogOpen, setIsStartOverDialogOpen] = useState(false);
  const [publishSuccessDialog, setPublishSuccessDialog] =
    useState<PublishSuccessDialogState | null>(null);
  const isNavigatingAfterPublishRef = useRef(false);

  useEffect(() => {
    if (!storeId || !hatchingEggsEnabled) return;

    let isMounted = true;

    async function loadReferenceData() {
      setIsLoadingSpecies(true);
      setLoadError(null);

      const [speciesResult, breedResult, groupResult] = await Promise.all([
        supabase
          .from("species")
          .select("id, common_name, slug, sort_order")
          .eq("is_active", true)
          .order("sort_order", { ascending: true })
          .order("common_name", { ascending: true })
          .returns<ReferenceSpecies[]>(),
        supabase
          .from("breeds")
          .select("id, species_id, breed_name, breed_slug, sort_order")
          .eq("is_active", true)
          .order("sort_order", { ascending: true })
          .order("breed_name", { ascending: true })
          .returns<ReferenceBreed[]>(),
        supabase
          .from("seller_hatching_egg_inventory_management")
          .select(
            "hatching_egg_inventory_item_id, hatching_egg_product_id, item_name, description, visibility_status, created_at, updated_at",
          )
          .eq("store_id", storeId)
          .neq("visibility_status", "archived")
          .returns<HatchingEggGroupRow[]>(),
      ]);

      if (!isMounted) return;

      const firstError =
        speciesResult.error ?? breedResult.error ?? groupResult.error;

      if (firstError) {
        setLoadError(firstError.message);
        setSpecies([]);
        setBreeds([]);
        setHatchingEggGroupRows([]);
        setIsLoadingSpecies(false);
        return;
      }

      const loadedSpecies = speciesResult.data ?? [];
      const defaultSpecies =
        loadedSpecies.find((item) => item.slug === "chicken") ??
        loadedSpecies[0] ??
        null;

      setSpecies(loadedSpecies);
      setBreeds(breedResult.data ?? []);
      setHatchingEggGroupRows(groupResult.data ?? []);
      setForm((current) => ({
        ...current,
        speciesId: current.speciesId || defaultSpecies?.id || "",
      }));
      setIsLoadingSpecies(false);
    }

    void loadReferenceData();

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
  const matchingDescriptionGroup = useMemo(
    () =>
      findMatchingHatchingEggDescriptionGroup({
        currentItemId: hatchingEggItemId,
        itemName: form.itemName,
        rows: hatchingEggGroupRows,
      }),
    [form.itemName, hatchingEggGroupRows, hatchingEggItemId],
  );
  const formSnapshot = useMemo(() => getFormSnapshot(form), [form]);
  const activeSavedPhotoCount = mediaItems.filter(isActiveApprovedPhoto).length;
  const activePhotoCount = activeSavedPhotoCount + pendingPhotos.length;
  const detailsComplete = validateItemDetails(form).length === 0;
  const descriptionComplete = form.description.trim().length > 0;
  const hasSavedItem = Boolean(hatchingEggItemId);
  const fieldsLockedAfterAddSave = hasSavedItem && !isEditMode;
  const hasSavedChanges =
    savedFormSnapshot !== null && formSnapshot === savedFormSnapshot;
  const saveDraftDisabledReason =
    saveDraftStatus === "saving" ||
    publishStatus === "publishing" ||
    publishSuccessDialog
      ? "Save already in progress."
      : fieldsLockedAfterAddSave && !pendingPhotos.length
        ? "This draft has already been saved."
        : null;
  const publishDisabledReason = getPublishDisabledReason({
    descriptionComplete,
    detailsComplete,
    hasSavedChanges,
    isPublishing: publishStatus === "publishing" || Boolean(publishSuccessDialog),
  });
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

  function updateForm(updates: Partial<HatchingEggFormState>) {
    setForm((current) => ({ ...current, ...updates }));
    setValidationErrors([]);
    setActionError(null);
    setActionMessage(null);
    if (saveDraftStatus === "success") setSaveDraftStatus("idle");
    if (publishStatus === "success") setPublishStatus("idle");
  }

  function updateSpecies(nextSpeciesId: string) {
    const selectedBreed = selectedBreedId
      ? breeds.find((breed) => breed.id === selectedBreedId)
      : null;
    const shouldClearSelectedBreed =
      selectedBreed != null && selectedBreed.species_id !== nextSpeciesId;

    updateForm({
      itemName: shouldClearSelectedBreed ? "" : form.itemName,
      speciesId: nextSpeciesId,
    });

    if (shouldClearSelectedBreed) {
      setSelectedBreedId(null);
    }
  }

  function updateBreedOrVarietyName(value: string) {
    setSelectedBreedId(null);
    updateForm(buildNameUpdateWithSharedDescription(value));
  }

  function selectReferenceBreed(breed: ReferenceBreed) {
    setSelectedBreedId(breed.id);
    updateForm(buildNameUpdateWithSharedDescription(breed.breed_name));
  }

  function updateDescription(value: string) {
    setHasEditedDescription(true);
    updateForm({ description: value });
  }

  function buildNameUpdateWithSharedDescription(
    itemName: string,
  ): Partial<HatchingEggFormState> {
    const matchingGroup = findMatchingHatchingEggDescriptionGroup({
      currentItemId: hatchingEggItemId,
      itemName,
      rows: hatchingEggGroupRows,
    });

    return {
      itemName,
      ...(!hasEditedDescription && matchingGroup
        ? { description: matchingGroup.description }
        : {}),
    };
  }

  const loadHatchingEggMedia = useCallback(
    async (currentHatchingEggItemId: string) => {
      if (!storeId || !currentHatchingEggItemId) return;

      const mediaResult = await supabase
        .from("seller_media_management")
        .select(sellerMediaSelect)
        .eq("store_id", storeId)
        .eq("entity_type", "hatching_egg_inventory_item")
        .eq("entity_id", currentHatchingEggItemId)
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
    if (!seller || !hatchingEggsEnabled || !initialHatchingEggItemId) return;

    let isMounted = true;
    const sellerStoreId = seller.store_id;

    async function loadHatchingEggItem() {
      setIsLoadingItem(true);
      setLoadError(null);

      const result = await supabase
        .from("seller_hatching_egg_inventory_management")
        .select(
          "hatching_egg_inventory_item_id, hatching_egg_product_id, item_name, species_id, description, quantity_available, price, available_date, minimum_order_quantity, visibility_status",
        )
        .eq("store_id", sellerStoreId)
        .eq("hatching_egg_inventory_item_id", initialHatchingEggItemId)
        .maybeSingle<HatchingEggManagementRow>();

      if (!isMounted) return;

      if (result.error) {
        setLoadError(result.error.message);
        setIsLoadingItem(false);
        return;
      }

      if (!result.data) {
        setLoadError("The hatching egg item could not be found.");
        setIsLoadingItem(false);
        return;
      }

      const loadedForm = hatchingEggRowToForm(result.data);
      setForm(loadedForm);
      setHasEditedDescription(false);
      setSelectedBreedId(null);
      setHatchingEggItemId(result.data.hatching_egg_inventory_item_id);
      setSavedFormSnapshot(getFormSnapshot(loadedForm));
      setValidationErrors([]);
      setActionError(null);
      setActionMessage(null);
      await loadHatchingEggMedia(result.data.hatching_egg_inventory_item_id);

      if (!isMounted) return;

      setIsLoadingItem(false);
    }

    void loadHatchingEggItem();

    return () => {
      isMounted = false;
    };
  }, [
    hatchingEggsEnabled,
    initialHatchingEggItemId,
    loadHatchingEggMedia,
    seller,
  ]);

  async function verifySavedItem(currentHatchingEggItemId: string) {
    if (!seller) return null;

    const result = await supabase
      .from("seller_hatching_egg_inventory_management")
      .select(
        "hatching_egg_inventory_item_id, hatching_egg_product_id, visibility_status",
      )
      .eq("store_id", seller.store_id)
      .eq("hatching_egg_inventory_item_id", currentHatchingEggItemId)
      .maybeSingle<HatchingEggManagementRow>();

    if (result.error) {
      setActionError(result.error.message);
      return null;
    }

    if (!result.data) {
      setActionError("The saved hatching egg item could not be loaded.");
      return null;
    }

    return result.data;
  }

  function addPendingPhotos(files: FileList | null) {
    if (!files || files.length === 0) return;

    const selectedFiles = Array.from(files);
    const availableSlots = maxHatchingEggPhotos - activePhotoCount;

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
    currentHatchingEggItemId: string,
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
      formData.append("entity_type", "hatching_egg_inventory_item");
      formData.append("entity_id", currentHatchingEggItemId);
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
    await loadHatchingEggMedia(currentHatchingEggItemId);

    return { ok: true };
  }

  async function setHatchingEggVisibility(
    currentHatchingEggItemId: string,
    visibilityStatus: string,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const visibilityResult = await supabase.rpc(
      "seller_set_hatching_egg_inventory_visibility",
      {
        p_hatching_egg_inventory_item_id: currentHatchingEggItemId,
        p_visibility_status: visibilityStatus,
      },
    );

    if (visibilityResult.error) {
      return { ok: false, message: visibilityResult.error.message };
    }

    return { ok: true };
  }

  async function syncHatchingEggGroupMedia(
    currentHatchingEggItemId: string,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const syncResult = await supabase.rpc(
      "seller_sync_hatching_egg_group_media_from_item",
      {
        p_hatching_egg_inventory_item_id: currentHatchingEggItemId,
      },
    );

    if (syncResult.error) {
      return { ok: false, message: syncResult.error.message };
    }

    return { ok: true };
  }

  async function saveDraft(): Promise<HatchingEggSaveResult> {
    if (!seller) {
      return {
        ok: false,
        message: "Store context is missing. Refresh and try again.",
      };
    }

    const errors = validateHatchingEggForm(form);
    setValidationErrors(errors);

    if (errors.length > 0) {
      return {
        ok: false,
        message: "Complete the required item details first.",
      };
    }

    if (hatchingEggItemId) {
      if (isEditMode) {
        const updateResult = await supabase.rpc(
          "seller_update_hatching_egg_inventory_item",
          {
            ...buildHatchingEggRpcPayload(form),
            p_hatching_egg_inventory_item_id: hatchingEggItemId,
          },
        );

        if (updateResult.error) {
          return { ok: false, message: updateResult.error.message };
        }

        const visibilityResult = await setHatchingEggVisibility(
          hatchingEggItemId,
          form.visibilityStatus,
        );

        if (!visibilityResult.ok) return visibilityResult;

        const verifiedItem = await verifySavedItem(hatchingEggItemId);
        await loadHatchingEggMedia(hatchingEggItemId);

        return {
          ok: true,
          hatchingEggItemId,
          hatchingEggProductId: verifiedItem?.hatching_egg_product_id ?? null,
        };
      }

      if (formSnapshot !== savedFormSnapshot) {
        return {
          ok: false,
          message:
            "This Add-only draft has already been created. Publish it as saved or start over.",
        };
      }

      const verifiedItem = await verifySavedItem(hatchingEggItemId);
      return {
        ok: true,
        hatchingEggItemId,
        hatchingEggProductId: verifiedItem?.hatching_egg_product_id ?? null,
      };
    }

    const result = await supabase.rpc("seller_create_hatching_egg_inventory_item", {
      ...buildHatchingEggRpcPayload(form),
      p_store_id: seller.store_id,
    });

    if (result.error) {
      return { ok: false, message: result.error.message };
    }

    const savedId = getHatchingEggItemId(result.data);

    if (!savedId) {
      return {
        ok: false,
        message: "The hatching egg item saved, but the photo target could not be loaded.",
      };
    }

    setHatchingEggItemId(savedId);
    const verifiedItem = await verifySavedItem(savedId);
    await loadHatchingEggMedia(savedId);

    return {
      ok: true,
      hatchingEggItemId: savedId,
      hatchingEggProductId: verifiedItem?.hatching_egg_product_id ?? null,
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

    const uploadResult = await uploadPendingPhotos(saveResult.hatchingEggItemId);

    if (!uploadResult.ok) {
      setSaveDraftStatus("error");
      setActionError(
        `Hatching egg item was saved as a draft, but photos were not uploaded. ${uploadResult.message}`,
      );
      return;
    }

    const syncResult = await syncHatchingEggGroupMedia(
      saveResult.hatchingEggItemId,
    );

    if (!syncResult.ok) {
      setSaveDraftStatus("error");
      setActionError(
        `Hatching egg item was saved, but shared photos were not updated. ${syncResult.message}`,
      );
      return;
    }

    setSavedFormSnapshot(getFormSnapshot(form));
    setSaveDraftStatus("success");
    setActionMessage(isEditMode ? "Changes saved." : "Draft saved.");
    router.push("/dashboard/inventory");
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

    const uploadResult = await uploadPendingPhotos(saveResult.hatchingEggItemId);

    if (!uploadResult.ok) {
      setPublishStatus("error");
      setActionError(
        `Hatching egg item was saved as a draft, but photos were not uploaded. ${uploadResult.message}`,
      );
      return;
    }

    const publishResult = await setHatchingEggVisibility(
      saveResult.hatchingEggItemId,
      "active",
    );

    if (!publishResult.ok) {
      setPublishStatus("error");
      setActionError(publishResult.message);
      return;
    }

    const syncResult = await syncHatchingEggGroupMedia(
      saveResult.hatchingEggItemId,
    );

    if (!syncResult.ok) {
      setPublishStatus("error");
      setActionError(
        `Hatching egg item was published, but shared photos were not updated. ${syncResult.message}`,
      );
      return;
    }

    setSavedFormSnapshot(getFormSnapshot(form));
    setPublishStatus("success");
    setPublishSuccessDialog({
      listingTitle: form.itemName.trim() || "Hatching eggs",
      publicPath: buildPublicListingPath({
        listingType: "hatching_eggs",
        productId: saveResult.hatchingEggProductId,
        storeSlug: seller?.store_slug,
      }),
      shareText: buildHatchingEggShareText(form, seller?.store_name),
      summary: buildHatchingEggShareSummary(form),
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
    setHasEditedDescription(false);
    setSelectedBreedId(null);
    setForm((current) => ({
      ...emptyForm,
      speciesId:
        species.find((item) => item.slug === "chicken")?.id ??
        species[0]?.id ??
        current.speciesId,
    }));
    setHatchingEggItemId("");
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
    setPublishSuccessDialog(null);
    isNavigatingAfterPublishRef.current = false;
  }

  if (isSellerLoading) {
    return <LoadingState label="Loading selling options..." />;
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
                  Turn it on in Store Admin when you want to create hatching egg
                  inventory.
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
                {isEditMode ? "Edit Hatching Eggs" : "Add Hatching Eggs"}
              </h1>
              <p className="mt-2 max-w-3xl text-base leading-7 text-stone-600 sm:text-sm sm:leading-6">
                {isEditMode
                  ? "Update this standalone hatching egg item without breed profiles or listing batches."
                  : "Create standalone hatching egg inventory with its own name, description, price, quantity, available date, and photos."}
              </p>
            </div>
            {!isEditMode ? (
              <div className="flex flex-wrap gap-2 lg:justify-end">
                <button
                  className="seller-secondary-button bg-white"
                  type="button"
                  onClick={() => setIsStartOverDialogOpen(true)}
                >
                  Start Over
                </button>
              </div>
            ) : null}
          </div>
        </header>

        {loadError ? (
          <ErrorState title="Hatching eggs could not load" message={loadError} />
        ) : isLoadingSpecies || isLoadingItem ? (
          <LoadingState
            label={isEditMode ? "Loading hatching egg item..." : "Loading species..."}
          />
        ) : (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
            <main className="space-y-4">
              <SectionCard step="1" title="Item Details">
                <div className="grid gap-4">
                  <CompactField label="Species">
                    <select
                      className={inputClass}
                      disabled={fieldsLockedAfterAddSave}
                      value={form.speciesId}
                      onChange={(event) => updateSpecies(event.target.value)}
                    >
                      <option value="">Choose species</option>
                      {species.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.common_name}
                        </option>
                      ))}
                    </select>
                  </CompactField>

                  <HatchingEggBreedLookup
                    breeds={breeds}
                    disabled={fieldsLockedAfterAddSave}
                    selectedBreedId={selectedBreedId}
                    speciesId={form.speciesId}
                    value={form.itemName}
                    onCustomChange={updateBreedOrVarietyName}
                    onSelectBreed={selectReferenceBreed}
                  />

                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <CompactField label="Available Date">
                      <input
                        className={inputClass}
                        disabled={fieldsLockedAfterAddSave}
                        type="date"
                        value={form.availableDate}
                        onChange={(event) =>
                          updateForm({ availableDate: event.target.value })
                        }
                      />
                    </CompactField>
                    <CompactField label="Quantity">
                      <input
                        className={inputClass}
                        disabled={fieldsLockedAfterAddSave}
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
                    <CompactField label="Price Per Egg">
                      <MoneyInput
                        disabled={fieldsLockedAfterAddSave}
                        value={form.price}
                        onChange={(value) => updateForm({ price: value })}
                      />
                    </CompactField>
                    <CompactField label="Minimum Order">
                      <input
                        className={inputClass}
                        disabled={fieldsLockedAfterAddSave}
                        inputMode="numeric"
                        min="1"
                        placeholder="Optional"
                        step="1"
                        type="number"
                        value={form.minimumOrderQuantity}
                        onChange={(event) =>
                          updateForm({
                            minimumOrderQuantity: event.target.value,
                          })
                        }
                      />
                    </CompactField>
                  </div>
                  {fieldsLockedAfterAddSave ? (
                    <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-800">
                      This Add-only draft has been created. Publish it as saved,
                      or start over to create another hatching egg item.
                    </p>
                  ) : null}
                  {isEditMode ? (
                    <CompactField label="Visibility">
                      <select
                        className={inputClass}
                        value={form.visibilityStatus}
                        onChange={(event) =>
                          updateForm({ visibilityStatus: event.target.value })
                        }
                      >
                        <option value="hidden">Hidden</option>
                        <option value="active">Live</option>
                        <option value="sold_out">Sold out</option>
                      </select>
                    </CompactField>
                  ) : null}
                  <ValidationMessage errors={validationErrors} />
                </div>
              </SectionCard>

              <SectionCard step="2" title="Photos">
                <HatchingEggPhotos
                  addPendingPhotos={addPendingPhotos}
                  hatchingEggItemId={hatchingEggItemId}
                  mediaItems={mediaItems}
                  pendingPhotos={pendingPhotos}
                  photoError={photoError}
                  removePendingPhoto={removePendingPhoto}
                  reorderPendingPhotos={reorderPendingPhotos}
                  storeId={storeId}
                  onReload={() => {
                    if (hatchingEggItemId) {
                      void loadHatchingEggMedia(hatchingEggItemId);
                    }
                  }}
                />
              </SectionCard>

              <SectionCard step="3" title="Description">
                {matchingDescriptionGroup ? (
                  <div className="mb-3 space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm leading-6 text-emerald-900">
                    <p className="font-semibold">
                      This will appear with your other{" "}
                      {matchingDescriptionGroup.displayName} hatching eggs on
                      the storefront.
                    </p>
                    <p>Shared on the storefront: breed name and description</p>
                    <p>
                      Kept separate: available date, price, quantity, minimum
                      order, and photos
                    </p>
                  </div>
                ) : null}
                <label>
                  <span className="mb-1.5 block text-base font-bold text-stone-700 sm:text-xs sm:font-semibold sm:text-stone-600">
                    {matchingDescriptionGroup
                      ? `Storefront description for ${matchingDescriptionGroup.displayName}`
                      : "Storefront description"}
                  </span>
                <textarea
                  className={`${inputClass} min-h-32 resize-y py-3 leading-6`}
                  disabled={fieldsLockedAfterAddSave}
                  maxLength={descriptionMaxLength}
                  placeholder="Share collection timing, fertility notes, rooster details, pickup expectations, or anything buyers should know."
                  value={form.description}
                  onChange={(event) => updateDescription(event.target.value)}
                />
                </label>
                <p className="mt-2 text-sm text-stone-500">
                  {matchingDescriptionGroup
                    ? `Changing this description will update it for every ${matchingDescriptionGroup.displayName} hatching egg option.`
                    : "Required. Keep it clear, accurate, and helpful."}
                </p>
              </SectionCard>

              <SectionCard step="4" title="Ready to publish?">
                <div className="space-y-4 sm:space-y-6">
                  <div className="space-y-2">
                    <p className="text-base leading-7 text-stone-700 sm:text-sm sm:leading-6">
                      {isEditMode
                        ? "Save changes to update this standalone hatching egg item."
                        : "Save a hidden draft first, or publish once the item details are ready."}
                    </p>
                    <p className="text-base leading-7 text-stone-500 sm:text-sm sm:leading-6">
                      This standalone item is saved outside breed profiles and
                      listing batches.
                    </p>
                  </div>
                  <ActionStatus
                    actionError={actionError}
                    actionMessage={actionMessage}
                    publishDisabledReason={
                      isEditMode ? null : publishDisabledReason
                    }
                    validationErrors={validationErrors}
                  />
                  {isEditMode ? (
                    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:flex-wrap sm:justify-end">
                      <Link className="seller-secondary-button" href="/dashboard/inventory">
                        Cancel
                      </Link>
                      <button
                        className="seller-primary-button"
                        disabled={saveDraftStatus === "saving"}
                        type="button"
                        onClick={handleSaveDraft}
                      >
                        {saveDraftStatus === "saving" ? "Saving..." : "Save Changes"}
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:flex-wrap sm:justify-end">
                      <SaveDraftButton
                        canSaveDraft={!saveDraftDisabledReason}
                        onSaveDraft={handleSaveDraft}
                        saveDraftDisabledReason={saveDraftDisabledReason}
                        saveDraftStatus={saveDraftStatus}
                      />
                      <PublishInventoryButton
                        onReviewPublish={handlePublish}
                        publishDisabledReason={publishDisabledReason}
                        publishStatus={publishStatus}
                      />
                    </div>
                  )}
                </div>
              </SectionCard>
            </main>

            <aside className="hidden space-y-4 xl:block">
              <HatchingEggSummaryCard
                form={form}
                selectedSpeciesName={selectedSpecies?.common_name ?? ""}
              />
              <HatchingEggReadinessCard
                descriptionComplete={descriptionComplete}
                detailsComplete={detailsComplete}
                photoCount={activePhotoCount}
              />
            </aside>
          </div>
        )}
      </div>

      {isStartOverDialogOpen ? (
        <StartOverDialog
          onCancel={() => setIsStartOverDialogOpen(false)}
          onConfirm={resetForm}
        />
      ) : null}
      <ListingShareDialog
        isStorePublic={Boolean(seller?.is_publicly_available)}
        listingTitle={publishSuccessDialog?.listingTitle ?? "Hatching eggs"}
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

function HatchingEggPhotos({
  addPendingPhotos,
  hatchingEggItemId,
  mediaItems,
  onReload,
  pendingPhotos,
  photoError,
  removePendingPhoto,
  reorderPendingPhotos,
  storeId,
}: {
  addPendingPhotos: (files: FileList | null) => void;
  hatchingEggItemId: string;
  mediaItems: ListingPhotoItem[];
  onReload: () => void;
  pendingPhotos: PendingPhoto[];
  photoError: string | null;
  removePendingPhoto: (photo: PendingPhoto) => void;
  reorderPendingPhotos: (photos: DashboardPhoto[]) => void;
  storeId: string;
}) {
  if (!hatchingEggItemId) {
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
    <ListingPhotosSection
      key={hatchingEggItemId}
      canManage
      description="Manage the photos buyers see for this hatching egg item. The first photo will be the featured photo."
      emptyDescription="No hatching egg photos have been added yet."
      entityId={hatchingEggItemId}
      entityType={"hatching_egg_inventory_item" as "inventory_item"}
      listingBatchId={hatchingEggItemId}
      mediaItems={mediaItems}
      mode="setup"
      storeId={storeId}
      title="Photos"
      onReload={onReload}
    />
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
        description="Manage the photos buyers see for this hatching egg item. The first photo will be the featured photo."
        emptyDescription="Add photos now. They will be saved when you save or publish this item."
        error={
          photoError
            ? {
                message: photoError,
                title: "Photo could not be added",
              }
            : null
        }
        fillEmptySlots
        helperText="Drag photos to reorder. The first photo is the featured photo."
        maxFileSizeMb={maxPendingImageSizeBytes / 1024 / 1024}
        maxPhotos={maxHatchingEggPhotos}
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
          Photos will be saved when you save or publish this item.
        </p>
      ) : null}
    </div>
  );
}

function HatchingEggBreedLookup({
  breeds,
  disabled,
  onCustomChange,
  onSelectBreed,
  selectedBreedId,
  speciesId,
  value,
}: {
  breeds: ReferenceBreed[];
  disabled: boolean;
  onCustomChange: (value: string) => void;
  onSelectBreed: (breed: ReferenceBreed) => void;
  selectedBreedId: string | null;
  speciesId: string;
  value: string;
}) {
  const listboxId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const normalizedValue = normalizeLookupText(value);
  const speciesBreeds = useMemo(
    () =>
      speciesId
        ? breeds.filter((breed) => breed.species_id === speciesId)
        : breeds,
    [breeds, speciesId],
  );
  const matchingBreeds = useMemo(() => {
    const matches = normalizedValue
      ? speciesBreeds.filter((breed) =>
          normalizeLookupText(breed.breed_name).includes(normalizedValue),
        )
      : speciesBreeds;

    return matches.slice(0, 12);
  }, [normalizedValue, speciesBreeds]);
  const selectedBreed = selectedBreedId
    ? breeds.find((breed) => breed.id === selectedBreedId)
    : null;
  const canUseCustomName = value.trim().length > 0;

  function closeSoon() {
    window.setTimeout(() => setIsOpen(false), 120);
  }

  return (
    <label className="relative block">
      <span className="mb-1.5 block text-base font-bold text-stone-700 sm:text-xs sm:font-semibold sm:text-stone-600">
        Breed or variety
      </span>
      <input
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-expanded={isOpen}
        className={inputClass}
        disabled={disabled}
        placeholder="Search breeds or enter a custom name"
        role="combobox"
        value={value}
        onBlur={closeSoon}
        onChange={(event) => {
          onCustomChange(event.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
      />

      {selectedBreed ? (
        <p className="mt-1 text-xs font-semibold text-emerald-800">
          Using reference breed name: {selectedBreed.breed_name}
        </p>
      ) : value.trim() ? (
        <p className="mt-1 text-xs font-semibold text-stone-500">
          Using custom name.
        </p>
      ) : null}

      {isOpen && !disabled ? (
        <div
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-lg border border-stone-200 bg-white p-2 shadow-lg"
          id={listboxId}
          role="listbox"
        >
          <p className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-stone-500">
            Breed reference list
          </p>

          {matchingBreeds.length === 0 ? (
            <p className="px-3 py-3 text-sm leading-6 text-stone-600">
              No matching breeds found.
            </p>
          ) : null}

          {matchingBreeds.map((breed) => (
            <button
              aria-selected={breed.id === selectedBreedId}
              className="block w-full rounded-md px-3 py-2 text-left text-sm transition hover:bg-stone-50 focus:bg-stone-50 focus:outline-none"
              key={breed.id}
              role="option"
              type="button"
              onClick={() => {
                onSelectBreed(breed);
                setIsOpen(false);
              }}
              onMouseDown={(event) => event.preventDefault()}
            >
              <span className="block font-semibold text-stone-950">
                {breed.breed_name}
              </span>
            </button>
          ))}

          <div className="mt-2 border-t border-stone-100 pt-2">
            <button
              className="block w-full rounded-md px-3 py-2 text-left text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50 focus:bg-emerald-50 focus:outline-none disabled:text-stone-400 disabled:hover:bg-transparent"
              disabled={!canUseCustomName}
              type="button"
              onClick={() => {
                onCustomChange(value);
                setIsOpen(false);
              }}
              onMouseDown={(event) => event.preventDefault()}
            >
              {canUseCustomName
                ? `Use custom name: ${value.trim()}`
                : "Use custom name"}
            </button>
          </div>
        </div>
      ) : null}
    </label>
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

function MoneyInput({
  disabled,
  onChange,
  value,
}: {
  disabled: boolean;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <div className="flex overflow-hidden rounded-md border border-stone-300 bg-white focus-within:border-emerald-700 focus-within:ring-2 focus-within:ring-emerald-700/20">
      <span className="flex items-center border-r border-stone-200 bg-stone-50 px-3 text-stone-600">
        $
      </span>
      <input
        className="min-h-11 w-full border-0 bg-transparent px-3 text-base text-stone-950 outline-none placeholder:text-stone-400 disabled:bg-stone-50 sm:min-h-10 sm:text-sm"
        disabled={disabled}
        inputMode="decimal"
        min="0"
        placeholder="0.00"
        step="0.01"
        type="number"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function HatchingEggSummaryCard({
  form,
  selectedSpeciesName,
}: {
  form: HatchingEggFormState;
  selectedSpeciesName: string;
}) {
  return (
    <SidebarCard title="Hatching Eggs Summary">
      <SummaryRow
        glyph="/glyphs/hen.png"
        label="Name"
        value={form.itemName.trim() || "Not set"}
      />
      <SummaryRow
        glyph="/glyphs/egg.png"
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
        label="Quantity"
        value={form.quantityAvailable.trim() || "0"}
      />
      <SummaryRow
        glyph="/glyphs/cart.png"
        label="Price per egg"
        value={isValidMoney(form.price) ? formatCurrency(form.price) : "$0.00"}
      />
    </SidebarCard>
  );
}

function HatchingEggReadinessCard({
  descriptionComplete,
  detailsComplete,
  photoCount,
}: {
  descriptionComplete: boolean;
  detailsComplete: boolean;
  photoCount: number;
}) {
  return (
    <SidebarCard title="Ready to Publish">
      <div className="space-y-3">
        <ChecklistRow complete={photoCount > 0} label="Photos" />
        <ChecklistRow complete={detailsComplete} label="Item Details" />
        <ChecklistRow complete={descriptionComplete} label="Description" />
      </div>
      <p
        className={`mt-5 rounded-md border px-3 py-2 text-base font-semibold sm:text-sm ${
          detailsComplete
            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
            : "border-stone-200 bg-stone-50 text-stone-600"
        }`}
      >
        {detailsComplete
          ? "Looks ready to publish."
          : "Complete item details to publish."}
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
          This clears the form on this page. Saved drafts remain in the new
          standalone hatching egg table.
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

function validateHatchingEggForm(form: HatchingEggFormState) {
  const errors = validateItemDetails(form);

  if (!form.description.trim()) {
    errors.push("Add a storefront description.");
  }

  if (form.description.length > descriptionMaxLength) {
    errors.push(`Description must be ${descriptionMaxLength} characters or less.`);
  }

  if (
    form.minimumOrderQuantity.trim() &&
    !isPositiveWholeNumber(form.minimumOrderQuantity)
  ) {
    errors.push("Minimum order must be a whole number of 1 or more.");
  }

  if (!["hidden", "active", "sold_out"].includes(form.visibilityStatus)) {
    errors.push("Choose a valid visibility status.");
  }

  return errors;
}

function validateItemDetails(form: HatchingEggFormState) {
  const errors: string[] = [];

  if (!form.itemName.trim()) errors.push("Add a breed or variety name.");
  if (!form.speciesId) errors.push("Choose a species.");
  if (!form.availableDate) errors.push("Add an available date.");
  if (
    !form.quantityAvailable.trim() ||
    !isWholeNumber(form.quantityAvailable)
  ) {
    errors.push("Quantity must be a whole number of zero or more.");
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

function buildHatchingEggRpcPayload(form: HatchingEggFormState) {
  return {
    p_available_date: form.availableDate,
    p_description: form.description.trim() || null,
    p_item_name: form.itemName.trim(),
    p_minimum_order_quantity: form.minimumOrderQuantity.trim()
      ? Number(form.minimumOrderQuantity)
      : null,
    p_price: Number(form.price),
    p_quantity_available: Number(form.quantityAvailable),
    p_seller_notes: null,
    p_species_id: form.speciesId,
  };
}

function hatchingEggRowToForm(
  row: HatchingEggManagementRow,
): HatchingEggFormState {
  return {
    availableDate: row.available_date,
    description: row.description ?? "",
    itemName: row.item_name,
    minimumOrderQuantity:
      row.minimum_order_quantity == null
        ? ""
        : String(row.minimum_order_quantity),
    price: String(row.price),
    quantityAvailable: String(row.quantity_available),
    speciesId: row.species_id,
    visibilityStatus: row.visibility_status,
  };
}

function getHatchingEggItemId(data: unknown) {
  const rows = Array.isArray(data)
    ? (data as HatchingEggRpcResult[])
    : data
      ? [data as HatchingEggRpcResult]
      : [];

  return rows[0]?.hatching_egg_inventory_item_id ?? rows[0]?.id ?? "";
}

function getFormSnapshot(form: HatchingEggFormState) {
  return JSON.stringify({
    availableDate: form.availableDate,
    description: form.description.trim(),
    itemName: form.itemName.trim(),
    minimumOrderQuantity: form.minimumOrderQuantity.trim(),
    price: form.price.trim(),
    quantityAvailable: form.quantityAvailable.trim(),
    speciesId: form.speciesId,
    visibilityStatus: form.visibilityStatus,
  });
}

function normalizeLookupText(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function findMatchingHatchingEggDescriptionGroup({
  currentItemId,
  itemName,
  rows,
}: {
  currentItemId: string;
  itemName: string;
  rows: HatchingEggGroupRow[];
}) {
  const groupKey = normalizeLookupText(itemName);

  if (!groupKey) return null;

  const matchingRows = rows.filter(
    (row) => normalizeLookupText(row.item_name) === groupKey,
  );
  const matchingOtherRows = matchingRows.filter(
    (row) => row.hatching_egg_inventory_item_id !== currentItemId,
  );

  if (matchingRows.length === 0 || matchingOtherRows.length === 0) {
    return null;
  }

  const descriptionSource = [...matchingRows].sort(compareGroupDescriptionRows)[0];

  return {
    description: descriptionSource.description ?? "",
    displayName: descriptionSource.item_name,
    normalizedName: groupKey,
  };
}

function compareGroupDescriptionRows(
  first: HatchingEggGroupRow,
  second: HatchingEggGroupRow,
) {
  const updatedComparison = second.updated_at.localeCompare(first.updated_at);

  if (updatedComparison !== 0) return updatedComparison;

  const createdComparison = second.created_at.localeCompare(first.created_at);

  if (createdComparison !== 0) return createdComparison;

  return second.hatching_egg_inventory_item_id.localeCompare(
    first.hatching_egg_inventory_item_id,
  );
}

function hasStartedForm(form: HatchingEggFormState) {
  return Boolean(
    form.availableDate ||
      form.description.trim() ||
      form.itemName.trim() ||
      form.minimumOrderQuantity.trim() ||
      form.price.trim() ||
      form.quantityAvailable.trim(),
  );
}

function getPublishDisabledReason({
  descriptionComplete,
  detailsComplete,
  hasSavedChanges,
  isPublishing,
}: {
  descriptionComplete: boolean;
  detailsComplete: boolean;
  hasSavedChanges: boolean;
  isPublishing: boolean;
}) {
  if (isPublishing) return "Publish already in progress.";
  if (!detailsComplete) return "Complete item details to publish.";
  if (!descriptionComplete) return "Add a storefront description to publish.";
  if (!hasSavedChanges) return null;

  return null;
}

function isActiveApprovedPhoto(item: ListingPhotoItem) {
  return (
    item.visibility_status === "active" &&
    item.asset_status === "active" &&
    item.moderation_status === "approved"
  );
}

function isPositiveWholeNumber(value: string) {
  return /^\d+$/.test(value.trim()) && Number(value) >= 1;
}

function isWholeNumber(value: string) {
  return /^\d+$/.test(value.trim()) && Number(value) >= 0;
}

function isValidMoney(value: string) {
  return /^\d+(\.\d{1,2})?$/.test(value.trim()) && Number(value) >= 0;
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

function formatShareDate(value: string) {
  if (!value) return null;

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${value.slice(0, 10)}T00:00:00`));
}

function buildHatchingEggShareText(
  form: HatchingEggFormState,
  storeName: string | null | undefined,
) {
  const listingTitle = stripTrailingSentencePunctuation(form.itemName);
  const sellerStoreName = stripTrailingSentencePunctuation(storeName ?? "");
  const listingLabel = /\bhatching eggs\b/i.test(listingTitle)
    ? listingTitle
    : `${listingTitle || "Hatching eggs"} hatching eggs`;
  const sentences = [
    sellerStoreName ? `${listingLabel} from ${sellerStoreName}` : listingLabel,
    form.availableDate ? `Ready ${formatShareDate(form.availableDate)}` : null,
    isValidMoney(form.price) ? `${formatCurrency(form.price)} per egg` : null,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => `${stripTrailingSentencePunctuation(value)}.`);

  return sentences.length > 0 ? sentences.join(" ") : null;
}

function buildHatchingEggShareSummary(form: HatchingEggFormState) {
  const summaryParts = [
    form.availableDate ? `Ready ${formatDate(form.availableDate)}` : null,
    isValidMoney(form.price) ? `${formatCurrency(form.price)} per egg` : null,
  ].filter(Boolean);

  return summaryParts.length > 0 ? summaryParts.join(" - ") : null;
}

function stripTrailingSentencePunctuation(value: string) {
  return value.trim().replace(/[.!?]+$/g, "");
}
