"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { getPlanCapabilities } from "@/lib/plan-capabilities";
import { playDustySuccessSound } from "@/lib/success-sound";
import { supabase } from "@/lib/supabase";
import {
  canUseCustomHatchingEggBreedName,
  findMatchingHatchingEggPlatformBreed,
  normalizeHatchingEggBreedName,
  resolveHatchingEggBreedName,
} from "@/lib/hatching-egg-breed-name";
import {
  PhotoManager,
  type DashboardPhoto,
} from "../../../../_components/photo-manager";
import type { PhotoCropMetadata } from "../../../../_components/photo-crop-editor";
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
  PublishInventoryButton,
  SaveDraftButton,
  type PublishStatus,
  type SaveDraftStatus,
} from "../../../../inventory/add-v2/live-birds/ReviewPublishCard";
import {
  buildHatchingEggShareSummary,
  buildHatchingEggShareText,
} from "../../../../_lib/hatching-egg-share-text";
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
  cropMetadata?: PhotoCropMetadata | null;
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

const todayIsoDate = getLocalIsoDate(new Date());

const emptyForm: HatchingEggFormState = {
  availableDate: todayIsoDate,
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
  const [hatchingEggProductId, setHatchingEggProductId] = useState<string | null>(
    null,
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
  const [desktopActiveStep, setDesktopActiveStep] = useState<1 | 2 | null>(1);
  const [desktopHighestUnlockedStep, setDesktopHighestUnlockedStep] = useState<
    1 | 2 | 3
  >(isEditMode ? 3 : 1);
  const [mobileActiveStep, setMobileActiveStep] = useState<1 | 2 | 3>(1);
  const [mobileHighestUnlockedStep, setMobileHighestUnlockedStep] = useState<
    1 | 2 | 3
  >(isEditMode ? 3 : 1);
  const [publishSuccessDialog, setPublishSuccessDialog] =
    useState<PublishSuccessDialogState | null>(null);
  const [isPersistentShareOpen, setIsPersistentShareOpen] = useState(false);
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
    const matchingBreed = findMatchingHatchingEggPlatformBreed({
      breeds,
      name: value,
      speciesId: form.speciesId,
    });
    const nextName = matchingBreed?.breed_name ?? value;

    setSelectedBreedId(matchingBreed?.id ?? null);
    updateForm(buildNameUpdateWithSharedDescription(nextName));
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
      setHatchingEggProductId(result.data.hatching_egg_product_id ?? null);
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

  function savePendingPhotoCrop(
    photo: DashboardPhoto,
    crop: PhotoCropMetadata | null,
  ) {
    setPendingPhotos((current) =>
      current.map((item) =>
        item.id === photo.id ? { ...item, cropMetadata: crop } : item,
      ),
    );
    setSaveDraftStatus("idle");
    setPublishStatus("idle");
    setActionMessage(null);
    setActionError(null);
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

      if (data?.media) {
        if (pendingPhoto.cropMetadata) {
          const { error: cropError } = await supabase.rpc(
            "seller_update_media_crop",
            {
              p_crop_metadata: pendingPhoto.cropMetadata,
              p_media_link_id: data.media.media_link_id,
            },
          );

          if (cropError) {
            return {
              ok: false,
              message: "The photo was uploaded, but its crop was not saved.",
            };
          }
        }

        uploadedMedia.push({
          ...data.media,
          crop_metadata: pendingPhoto.cropMetadata ?? data.media.crop_metadata,
        });
      }
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

    const resolvedBreed = resolveHatchingEggBreedName({
      breeds,
      name: form.itemName,
      speciesId: form.speciesId,
    });
    const formToSave =
      resolvedBreed.canonicalName === form.itemName
        ? form
        : { ...form, itemName: resolvedBreed.canonicalName };

    if (resolvedBreed.matchingBreed) {
      setSelectedBreedId(resolvedBreed.matchingBreed.id);
    }
    if (formToSave !== form) setForm(formToSave);

    const errors = validateHatchingEggForm(formToSave);
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
            ...buildHatchingEggRpcPayload(formToSave),
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
        setHatchingEggProductId(verifiedItem?.hatching_egg_product_id ?? null);
        await loadHatchingEggMedia(hatchingEggItemId);

        return {
          ok: true,
          hatchingEggItemId,
          hatchingEggProductId: verifiedItem?.hatching_egg_product_id ?? null,
        };
      }

      if (getFormSnapshot(formToSave) !== savedFormSnapshot) {
        return {
          ok: false,
          message:
            "This Add-only draft has already been created. Publish it as saved or start over.",
        };
      }

      const verifiedItem = await verifySavedItem(hatchingEggItemId);
      setHatchingEggProductId(verifiedItem?.hatching_egg_product_id ?? null);
      return {
        ok: true,
        hatchingEggItemId,
        hatchingEggProductId: verifiedItem?.hatching_egg_product_id ?? null,
      };
    }

    const result = await supabase.rpc("seller_create_hatching_egg_inventory_item", {
      ...buildHatchingEggRpcPayload(formToSave),
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
    setHatchingEggProductId(verifiedItem?.hatching_egg_product_id ?? null);
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
    if (!isEditMode) {
      playDustySuccessSound();
    }
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
    router.push("/dashboard/inventory?tab=hatching_eggs");
  }

  function backToInventory() {
    if (
      hasUnsavedChanges &&
      !window.confirm("Leave without saving this hatching egg item?")
    ) {
      return;
    }

    router.push("/dashboard/inventory?tab=hatching_eggs");
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
    setHatchingEggProductId(null);
    setMediaItems([]);
    setPendingPhotos([]);
    setPhotoError(null);
    setSavedFormSnapshot(null);
    setValidationErrors([]);
    setActionError(null);
    setActionMessage(null);
    setSaveDraftStatus("idle");
    setPublishStatus("idle");
    setDesktopActiveStep(1);
    setDesktopHighestUnlockedStep(1);
    setMobileActiveStep(1);
    setMobileHighestUnlockedStep(1);
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
    <>
    <MobileHatchingEggTaskHeader
      currentStep={mobileActiveStep}
      disabled={
        saveDraftStatus === "saving" ||
        (isEditMode ? !hasUnsavedChanges : Boolean(saveDraftDisabledReason))
      }
      isEditMode={isEditMode}
      saveDraftStatus={saveDraftStatus}
      onBack={backToInventory}
      onSaveDraft={handleSaveDraft}
      onStartOver={() => setIsStartOverDialogOpen(true)}
    />
    <DashboardPageContent className="bg-stone-50/60 max-sm:px-4 max-sm:py-5 max-sm:pb-24">
      <div className="mx-auto w-full max-w-[1150px]">
        <header className="mb-5 max-sm:hidden">
          <Link
            className="inline-flex min-h-11 items-center text-base font-bold text-emerald-800 underline-offset-4 hover:underline sm:min-h-0 sm:text-sm sm:font-semibold"
            href={
              isEditMode
                ? "/dashboard/inventory?tab=hatching_eggs"
                : "/dashboard/inventory/add-v2"
            }
            onClick={(event) => {
              if (!isEditMode || !hasUnsavedChanges) return;
              if (window.confirm("Leave without saving this hatching egg item?")) return;
              event.preventDefault();
            }}
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
          <DesktopHatchingEggProgress
            activeStep={desktopActiveStep ?? desktopHighestUnlockedStep}
            highestUnlockedStep={desktopHighestUnlockedStep}
            onStepOpen={(step) => {
              if (step === 3) {
                setDesktopActiveStep(null);
                return;
              }

              setDesktopActiveStep((currentStep) =>
                currentStep === step ? null : step,
              );
            }}
          />
        </header>

        {loadError ? (
          <ErrorState title="Hatching eggs could not load" message={loadError} />
        ) : isLoadingSpecies || isLoadingItem ? (
          <LoadingState
            label={isEditMode ? "Loading hatching egg item..." : "Loading species..."}
          />
        ) : (
          <>
          <div className="sm:hidden">
            <MobileHatchingEggWorkflow
              actionError={actionError}
              actionMessage={actionMessage}
              activePhotoCount={activePhotoCount}
              activeStep={mobileActiveStep}
              addPendingPhotos={addPendingPhotos}
              breeds={breeds}
              descriptionComplete={descriptionComplete}
              detailsComplete={detailsComplete}
              fieldsLockedAfterAddSave={fieldsLockedAfterAddSave}
              form={form}
              hatchingEggItemId={hatchingEggItemId}
              hatchingEggProductId={hatchingEggProductId}
              hasUnsavedChanges={hasUnsavedChanges}
              highestUnlockedStep={mobileHighestUnlockedStep}
              isEditMode={isEditMode}
              matchingDescriptionGroup={matchingDescriptionGroup}
              mediaItems={mediaItems}
              pendingPhotos={pendingPhotos}
              photoError={photoError}
              publishDisabledReason={publishDisabledReason}
              publishStatus={publishStatus}
              removePendingPhoto={removePendingPhoto}
              reorderPendingPhotos={reorderPendingPhotos}
              saveDraftDisabledReason={saveDraftDisabledReason}
              saveDraftStatus={saveDraftStatus}
              savePendingPhotoCrop={savePendingPhotoCrop}
              selectedBreedId={selectedBreedId}
              selectedSpeciesName={selectedSpecies?.common_name ?? ""}
              species={species}
              storeId={storeId}
              validationErrors={validationErrors}
              onBackToInventory={backToInventory}
              onBreedChange={updateBreedOrVarietyName}
              onBreedSelect={selectReferenceBreed}
              onDescriptionChange={updateDescription}
              onFormUpdate={updateForm}
              onOpenPersistentShare={() => setIsPersistentShareOpen(true)}
              onPublish={handlePublish}
              onReloadPhotos={() => {
                if (hatchingEggItemId) {
                  void loadHatchingEggMedia(hatchingEggItemId);
                }
              }}
              onSaveDraft={handleSaveDraft}
              onSpeciesChange={updateSpecies}
              onStepContinue={(step) => {
                const nextStep = Math.min(3, step + 1) as 1 | 2 | 3;
                setMobileHighestUnlockedStep((currentStep) =>
                  currentStep < nextStep ? nextStep : currentStep,
                );
                setMobileActiveStep(nextStep);
              }}
              onStepOpen={setMobileActiveStep}
            />
          </div>
          <DesktopHatchingEggWorkflow
            actionError={actionError}
            actionMessage={actionMessage}
            activePhotoCount={activePhotoCount}
            activeStep={desktopActiveStep}
            addPendingPhotos={addPendingPhotos}
            breeds={breeds}
            descriptionComplete={descriptionComplete}
            detailsComplete={detailsComplete}
            desktopHighestUnlockedStep={desktopHighestUnlockedStep}
            fieldsLockedAfterAddSave={fieldsLockedAfterAddSave}
            form={form}
            hatchingEggItemId={hatchingEggItemId}
            hatchingEggProductId={hatchingEggProductId}
            hasUnsavedChanges={hasUnsavedChanges}
            isEditMode={isEditMode}
            matchingDescriptionGroup={matchingDescriptionGroup}
            mediaItems={mediaItems}
            pendingPhotos={pendingPhotos}
            photoError={photoError}
            publishDisabledReason={publishDisabledReason}
            publishStatus={publishStatus}
            removePendingPhoto={removePendingPhoto}
            reorderPendingPhotos={reorderPendingPhotos}
            saveDraftDisabledReason={saveDraftDisabledReason}
            saveDraftStatus={saveDraftStatus}
            savePendingPhotoCrop={savePendingPhotoCrop}
            selectedBreedId={selectedBreedId}
            selectedSpeciesName={selectedSpecies?.common_name ?? ""}
            species={species}
            storeId={storeId}
            validationErrors={validationErrors}
            onBackToInventory={backToInventory}
            onDescriptionChange={updateDescription}
            onBreedChange={updateBreedOrVarietyName}
            onBreedSelect={selectReferenceBreed}
            onDetailsContinue={() => {
              setDesktopHighestUnlockedStep((currentStep) =>
                currentStep < 2 ? 2 : currentStep,
              );
              setDesktopActiveStep(2);
            }}
            onDoneEditing={() => {
              setDesktopHighestUnlockedStep(3);
              setDesktopActiveStep(null);
            }}
            onOpenPersistentShare={() => setIsPersistentShareOpen(true)}
            onPublish={handlePublish}
            onReloadPhotos={() => {
              if (hatchingEggItemId) {
                void loadHatchingEggMedia(hatchingEggItemId);
              }
            }}
            onSaveDraft={handleSaveDraft}
            onSpeciesChange={updateSpecies}
            onFormUpdate={updateForm}
            onStepToggle={(step) =>
              setDesktopActiveStep((currentStep) =>
                currentStep === step ? null : step,
              )
            }
          />
          </>
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
      <ListingShareDialog
        isStorePublic={Boolean(seller?.is_publicly_available)}
        listingTitle={form.itemName.trim() || "Hatching eggs"}
        mode="share"
        open={isPersistentShareOpen}
        publicPath={buildPublicListingPath({
          listingType: "hatching_eggs",
          productId: hatchingEggProductId,
          storeSlug: seller?.store_slug,
        })}
        shareText={buildHatchingEggShareText(form, seller?.store_name)}
        storeName={seller?.store_name ?? "your store"}
        summary={buildHatchingEggShareSummary(form)}
        onClose={() => setIsPersistentShareOpen(false)}
      />
    </DashboardPageContent>
    </>
  );
}

function MobileHatchingEggWorkflow({
  actionError,
  actionMessage,
  activePhotoCount,
  activeStep,
  addPendingPhotos,
  breeds,
  descriptionComplete,
  detailsComplete,
  fieldsLockedAfterAddSave,
  form,
  hatchingEggItemId,
  hatchingEggProductId,
  hasUnsavedChanges,
  highestUnlockedStep,
  isEditMode,
  matchingDescriptionGroup,
  mediaItems,
  onBackToInventory,
  onBreedChange,
  onBreedSelect,
  onDescriptionChange,
  onFormUpdate,
  onOpenPersistentShare,
  onPublish,
  onReloadPhotos,
  onSaveDraft,
  onSpeciesChange,
  onStepContinue,
  onStepOpen,
  pendingPhotos,
  photoError,
  publishDisabledReason,
  publishStatus,
  removePendingPhoto,
  reorderPendingPhotos,
  saveDraftDisabledReason,
  saveDraftStatus,
  savePendingPhotoCrop,
  selectedBreedId,
  selectedSpeciesName,
  species,
  storeId,
  validationErrors,
}: {
  actionError: string | null;
  actionMessage: string | null;
  activePhotoCount: number;
  activeStep: 1 | 2 | 3;
  addPendingPhotos: (files: FileList | null) => void;
  breeds: ReferenceBreed[];
  descriptionComplete: boolean;
  detailsComplete: boolean;
  fieldsLockedAfterAddSave: boolean;
  form: HatchingEggFormState;
  hatchingEggItemId: string;
  hatchingEggProductId: string | null;
  hasUnsavedChanges: boolean;
  highestUnlockedStep: 1 | 2 | 3;
  isEditMode: boolean;
  matchingDescriptionGroup: ReturnType<
    typeof findMatchingHatchingEggDescriptionGroup
  >;
  mediaItems: ListingPhotoItem[];
  onBackToInventory: () => void;
  onBreedChange: (value: string) => void;
  onBreedSelect: (breed: ReferenceBreed) => void;
  onDescriptionChange: (value: string) => void;
  onFormUpdate: (updates: Partial<HatchingEggFormState>) => void;
  onOpenPersistentShare: () => void;
  onPublish: () => void;
  onReloadPhotos: () => void;
  onSaveDraft: () => void;
  onSpeciesChange: (speciesId: string) => void;
  onStepContinue: (step: 1 | 2) => void;
  onStepOpen: (step: 1 | 2 | 3) => void;
  pendingPhotos: PendingPhoto[];
  photoError: string | null;
  publishDisabledReason: string | null;
  publishStatus: PublishStatus;
  removePendingPhoto: (photo: PendingPhoto) => void;
  reorderPendingPhotos: (photos: DashboardPhoto[]) => void;
  saveDraftDisabledReason: string | null;
  saveDraftStatus: SaveDraftStatus;
  savePendingPhotoCrop: (
    photo: DashboardPhoto,
    crop: PhotoCropMetadata | null,
  ) => void;
  selectedBreedId: string | null;
  selectedSpeciesName: string;
  species: ReferenceSpecies[];
  storeId: string;
  validationErrors: string[];
}) {
  const workflowReady = detailsComplete && descriptionComplete;

  return (
    <main className="space-y-3">
      <MobileHatchingEggSection
        active={activeStep === 1}
        complete={highestUnlockedStep > 1}
        step={1}
        summary={
          <>
            <p className="font-semibold text-stone-700">
              {form.itemName.trim() || "Breed not set"}
            </p>
            <p>
              {formatDate(form.availableDate)}{" "}
              <span aria-hidden="true">•</span>{" "}
              {form.quantityAvailable.trim() || "0"} eggs{" "}
              <span aria-hidden="true">•</span>{" "}
              {isValidMoney(form.price) ? formatCurrency(form.price) : "$0.00"} each
            </p>
          </>
        }
        title="Egg Details"
        onOpen={() => onStepOpen(1)}
      >
        <div className="relative">
          <Image
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute -right-2 -top-4 h-24 w-28 object-contain opacity-90"
            height={96}
            src="/illustrations/hatching-eggs-chick-nest.png"
            width={112}
          />
          <div className="max-w-[58%]">
            <p className="text-base font-bold leading-6 text-stone-950">
              Tell buyers about these hatching eggs
            </p>
            <p className="mt-2 text-base leading-7 text-stone-600">
              Add the breed, availability, quantity, and price for this egg
              offering.
            </p>
          </div>

          <div className="mt-5 grid gap-4">
            <CompactField label="Species">
              <select
                className={inputClass}
                disabled={fieldsLockedAfterAddSave}
                value={form.speciesId}
                onChange={(event) => onSpeciesChange(event.target.value)}
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
              onCustomChange={onBreedChange}
              onSelectBreed={onBreedSelect}
            />
            <CompactField label="Available Date">
              <span className="relative block min-w-0 overflow-hidden rounded-md">
                <input
                  className={`${inputClass} block h-12 w-full min-w-0 appearance-none py-0 pr-11 text-left leading-[3rem] [-webkit-appearance:none] [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-date-and-time-value]:min-h-12 [&::-webkit-date-and-time-value]:leading-[3rem]`}
                  disabled={fieldsLockedAfterAddSave}
                  type="date"
                  value={form.availableDate}
                  onChange={(event) =>
                    onFormUpdate({ availableDate: event.target.value })
                  }
                />
                <Image
                  alt=""
                  aria-hidden="true"
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 object-contain"
                  height={18}
                  src="/glyphs/calendar.png"
                  width={18}
                />
              </span>
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
                  onFormUpdate({ quantityAvailable: event.target.value })
                }
              />
            </CompactField>
            <CompactField label="Price Per Egg">
              <MoneyInput
                disabled={fieldsLockedAfterAddSave}
                value={form.price}
                onChange={(value) => onFormUpdate({ price: value })}
              />
            </CompactField>
            {isEditMode ? (
              <CompactField label="Visibility">
                <select
                  className={inputClass}
                  value={form.visibilityStatus}
                  onChange={(event) =>
                    onFormUpdate({ visibilityStatus: event.target.value })
                  }
                >
                  <option value="hidden">Hidden</option>
                  <option value="active">Live</option>
                  <option value="sold_out">Sold out</option>
                </select>
              </CompactField>
            ) : null}
          </div>

          <div
            className={`mt-5 rounded-lg border px-4 py-3 text-sm font-semibold leading-6 ${
              detailsComplete
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-amber-200 bg-amber-50 text-amber-900"
            }`}
          >
            {detailsComplete
              ? `${form.quantityAvailable} eggs will be available ${formatDate(
                  form.availableDate,
                )} at ${formatCurrency(form.price)} each.`
              : "Complete the required egg details to continue."}
          </div>
          <ValidationMessage errors={validationErrors} />
          <button
            className="mt-5 inline-flex min-h-13 w-full items-center justify-center gap-3 rounded-xl bg-emerald-800 px-5 text-base font-bold text-white shadow-sm transition active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-500"
            disabled={!detailsComplete}
            type="button"
            onClick={() => onStepContinue(1)}
          >
            Continue to next step
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </MobileHatchingEggSection>

      <MobileHatchingEggSection
        active={activeStep === 2}
        complete={highestUnlockedStep > 2}
        disabled={highestUnlockedStep < 2}
        step={2}
        summary={
          <p>
            {activePhotoCount} photo{activePhotoCount === 1 ? "" : "s"}{" "}
            <span aria-hidden="true">•</span>{" "}
            {descriptionComplete ? "Description added" : "Description needed"}
          </p>
        }
        title="Photos & Description"
        onOpen={() => onStepOpen(2)}
      >
        <div className="space-y-5">
          <HatchingEggPhotos
            addPendingPhotos={addPendingPhotos}
            desktopCompact
            hatchingEggItemId={hatchingEggItemId}
            mediaItems={mediaItems}
            pendingPhotos={pendingPhotos}
            photoError={photoError}
            removePendingPhoto={removePendingPhoto}
            reorderPendingPhotos={reorderPendingPhotos}
            savePendingPhotoCrop={savePendingPhotoCrop}
            storeId={storeId}
            title="Photos"
            onReload={onReloadPhotos}
          />
          <div className="border-t border-stone-200 pt-5">
            <h3 className="text-lg font-bold text-stone-950">Description</h3>
            {matchingDescriptionGroup ? (
              <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm leading-6 text-emerald-900">
                <p className="font-semibold">
                  Shared with your other {matchingDescriptionGroup.displayName}{" "}
                  hatching eggs.
                </p>
              </div>
            ) : null}
            <label className="mt-4 block">
              <span className="mb-1.5 block text-base font-bold text-stone-700">
                Storefront description
              </span>
              <textarea
                className={`${inputClass} min-h-40 resize-y py-3 leading-6`}
                disabled={fieldsLockedAfterAddSave}
                maxLength={descriptionMaxLength}
                placeholder="Share collection timing, fertility notes, rooster details, pickup expectations, or anything buyers should know."
                value={form.description}
                onChange={(event) => onDescriptionChange(event.target.value)}
              />
            </label>
            <p className="mt-2 text-sm font-medium text-stone-500">
              {form.description.length} / {descriptionMaxLength}
            </p>
          </div>
          <button
            className="inline-flex min-h-13 w-full items-center justify-center rounded-xl bg-emerald-800 px-5 text-base font-bold text-white shadow-sm transition active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-500"
            disabled={!descriptionComplete}
            type="button"
            onClick={() => onStepContinue(2)}
          >
            Done editing
          </button>
        </div>
      </MobileHatchingEggSection>

      <MobileHatchingEggSection
        active={activeStep === 3}
        complete={workflowReady && !publishDisabledReason}
        disabled={highestUnlockedStep < 3}
        headerArtwork={
          <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-amber-50">
            <Image
              alt=""
              className="size-12 object-contain"
              height={48}
              src="/illustrations/hatching-eggs-chick-nest.png"
              width={48}
            />
          </span>
        }
        step={3}
        summary={
          <p className="font-semibold text-emerald-800">
            {workflowReady
              ? "Everything ready to publish"
              : "Review and publish when ready"}
          </p>
        }
        title="Ready to Publish"
        onOpen={() => onStepOpen(3)}
      >
        <div className="space-y-5">
          <div className="flex flex-col items-center py-2 text-center">
            <span
              aria-hidden="true"
              className="flex size-20 items-center justify-center rounded-full bg-emerald-800 text-4xl font-bold text-white shadow-[0_10px_30px_rgba(6,95,70,0.2)]"
            >
              ✓
            </span>
            <p className="mt-4 text-xl font-bold text-stone-950">
              Everything looks good!
            </p>
            <p className="mt-2 text-base leading-7 text-stone-600">
              Review the summary, then publish your hatching eggs.
            </p>
          </div>
          <ActionStatus
            actionError={actionError}
            actionMessage={actionMessage}
            publishDisabledReason={isEditMode ? null : publishDisabledReason}
            validationErrors={validationErrors}
          />
          {isEditMode ? (
            <div className="flex flex-col gap-3">
              <button
                className="seller-primary-button"
                disabled={saveDraftStatus === "saving" || !hasUnsavedChanges}
                type="button"
                onClick={onSaveDraft}
              >
                {saveDraftStatus === "saving" ? "Saving..." : "Save Changes"}
              </button>
              {hatchingEggProductId ? (
                <button
                  className="seller-secondary-button"
                  type="button"
                  onClick={onOpenPersistentShare}
                >
                  Share listing
                </button>
              ) : null}
              <button
                className="seller-secondary-button"
                type="button"
                onClick={onBackToInventory}
              >
                Back to Inventory
              </button>
            </div>
          ) : (
            <div className="flex flex-col-reverse gap-3">
              <SaveDraftButton
                canSaveDraft={!saveDraftDisabledReason}
                desktopFullWidth
                onSaveDraft={onSaveDraft}
                saveDraftDisabledReason={saveDraftDisabledReason}
                saveDraftStatus={saveDraftStatus}
              />
              <PublishInventoryButton
                desktopFullWidth
                onReviewPublish={onPublish}
                publishDisabledReason={publishDisabledReason}
                publishStatus={publishStatus}
              />
            </div>
          )}
          <HatchingEggDesktopSummary
            activePhotoCount={activePhotoCount}
            form={form}
            selectedSpeciesName={selectedSpeciesName}
          />
        </div>
      </MobileHatchingEggSection>
    </main>
  );
}

function MobileHatchingEggSection({
  active,
  children,
  complete = false,
  disabled = false,
  headerArtwork,
  onOpen,
  step,
  summary,
  title,
}: {
  active: boolean;
  children: ReactNode;
  complete?: boolean;
  disabled?: boolean;
  headerArtwork?: ReactNode;
  onOpen: () => void;
  step: 1 | 2 | 3;
  summary: ReactNode;
  title: string;
}) {
  return (
    <section
      className={`rounded-2xl border p-5 transition-all duration-200 ${
        disabled
          ? "border-stone-200 bg-white opacity-60"
          : active
            ? "border-emerald-200 bg-emerald-50/60 shadow-[0_6px_20px_rgba(31,42,32,0.07)]"
            : "border-stone-200 bg-white shadow-sm"
      }`}
    >
      <button
        aria-expanded={active}
        className="flex min-h-11 w-full items-center gap-3 text-left disabled:cursor-not-allowed"
        disabled={disabled}
        type="button"
        onClick={onOpen}
      >
        {headerArtwork}
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-800 text-sm font-bold text-white">
          {step}
        </span>
        <span className="min-w-0 flex-1 text-xl font-bold text-stone-950">
          {title}
        </span>
        {complete ? (
          <span className="text-xs font-bold text-emerald-800">✓ Complete</span>
        ) : null}
        {!disabled ? (
          <span
            aria-hidden="true"
            className={`h-2.5 w-2.5 shrink-0 border-b-2 border-r-2 border-emerald-800/80 transition-transform ${
              active ? "rotate-45" : "-rotate-45"
            }`}
          />
        ) : null}
      </button>
      {active && !disabled ? (
        <div className="mt-4">{children}</div>
      ) : (
        <div className="mt-2 pl-11 text-sm font-medium leading-5 text-stone-600">
          {summary}
        </div>
      )}
    </section>
  );
}

function MobileHatchingEggTaskHeader({
  currentStep,
  disabled,
  isEditMode,
  onBack,
  onSaveDraft,
  onStartOver,
  saveDraftStatus,
}: {
  currentStep: 1 | 2 | 3;
  disabled: boolean;
  isEditMode: boolean;
  onBack: () => void;
  onSaveDraft: () => void;
  onStartOver: () => void;
  saveDraftStatus: SaveDraftStatus;
}) {
  const steps = [
    ["Egg", "Details"],
    ["Photos &", "Description"],
    ["Ready to", "Publish"],
  ] as const;

  return (
    <header className="sticky top-0 z-40 border-b border-stone-200/80 bg-white pt-[env(safe-area-inset-top)] shadow-[0_1px_8px_rgba(67,55,38,0.06)] sm:hidden">
      <div className="grid min-h-13 grid-cols-[2.5rem_1fr_3.75rem] items-center gap-1 px-3">
        <button
          aria-label="Back to inventory"
          className="inline-flex size-9 items-center justify-start text-2xl text-stone-950"
          type="button"
          onClick={onBack}
        >
          <span aria-hidden="true">←</span>
        </button>
        <div className="min-w-0 text-center">
          <h1 className="truncate text-lg font-bold text-stone-950">
            {isEditMode ? "Edit Hatching Eggs" : "Add Hatching Eggs"}
          </h1>
          <p className="text-[11px] font-semibold leading-4 text-stone-500">
            <span className="text-emerald-800">Step {currentStep} of 3</span>
            <span aria-hidden="true"> &nbsp;•&nbsp; </span>
            About 2 minutes
          </p>
        </div>
        <button
          className="min-h-9 text-right text-xs font-bold leading-4 text-stone-950 disabled:text-stone-400"
          disabled={disabled || saveDraftStatus === "success"}
          type="button"
          onClick={onSaveDraft}
        >
          {saveDraftStatus === "saving"
            ? "Saving..."
            : isEditMode
              ? "Save"
              : "Save draft"}
        </button>
      </div>
      <div className="px-5 pb-2 pt-1.5">
        <div
          aria-label={`Step ${currentStep} of 3`}
          aria-valuemax={3}
          aria-valuemin={1}
          aria-valuenow={currentStep}
          className="relative grid grid-cols-3"
          role="progressbar"
        >
          <span
            aria-hidden="true"
            className="absolute left-[16.67%] right-[16.67%] top-4 h-px bg-stone-200"
          />
          {steps.map(([firstLine, secondLine], index) => {
            const step = (index + 1) as 1 | 2 | 3;
            const active = step === currentStep;
            const complete = step < currentStep;

            return (
              <div className="relative flex flex-col items-center" key={step}>
                <span
                  aria-hidden="true"
                  className={`z-10 flex size-8 items-center justify-center rounded-full border text-xs font-bold transition-all duration-200 ${
                    active || complete
                      ? "border-emerald-800 bg-emerald-800 text-white"
                      : "border-stone-300 bg-white text-stone-500"
                  }`}
                >
                  {step}
                </span>
                <span
                  className={`mt-1 text-center text-[10px] font-semibold leading-3 ${
                    active ? "text-stone-950" : "text-stone-600"
                  }`}
                >
                  {firstLine}
                  <br />
                  {secondLine}
                </span>
              </div>
            );
          })}
        </div>
        {!isEditMode ? (
          <button
            className="ml-auto mt-0.5 block min-h-6 text-[10px] font-semibold text-emerald-800 underline-offset-4 hover:underline focus:outline-none focus:ring-2 focus:ring-emerald-700"
            type="button"
            onClick={onStartOver}
          >
            Start over
          </button>
        ) : null}
      </div>
    </header>
  );
}

function DesktopHatchingEggWorkflow({
  actionError,
  actionMessage,
  activePhotoCount,
  activeStep,
  addPendingPhotos,
  breeds,
  descriptionComplete,
  detailsComplete,
  desktopHighestUnlockedStep,
  fieldsLockedAfterAddSave,
  form,
  hatchingEggItemId,
  hatchingEggProductId,
  hasUnsavedChanges,
  isEditMode,
  matchingDescriptionGroup,
  mediaItems,
  onBackToInventory,
  onBreedChange,
  onBreedSelect,
  onDescriptionChange,
  onDetailsContinue,
  onDoneEditing,
  onFormUpdate,
  onOpenPersistentShare,
  onPublish,
  onReloadPhotos,
  onSaveDraft,
  onSpeciesChange,
  onStepToggle,
  pendingPhotos,
  photoError,
  publishDisabledReason,
  publishStatus,
  removePendingPhoto,
  reorderPendingPhotos,
  saveDraftDisabledReason,
  saveDraftStatus,
  savePendingPhotoCrop,
  selectedBreedId,
  selectedSpeciesName,
  species,
  storeId,
  validationErrors,
}: {
  actionError: string | null;
  actionMessage: string | null;
  activePhotoCount: number;
  activeStep: 1 | 2 | null;
  addPendingPhotos: (files: FileList | null) => void;
  breeds: ReferenceBreed[];
  descriptionComplete: boolean;
  detailsComplete: boolean;
  desktopHighestUnlockedStep: 1 | 2 | 3;
  fieldsLockedAfterAddSave: boolean;
  form: HatchingEggFormState;
  hatchingEggItemId: string;
  hatchingEggProductId: string | null;
  hasUnsavedChanges: boolean;
  isEditMode: boolean;
  matchingDescriptionGroup: ReturnType<
    typeof findMatchingHatchingEggDescriptionGroup
  >;
  mediaItems: ListingPhotoItem[];
  onBackToInventory: () => void;
  onBreedChange: (value: string) => void;
  onBreedSelect: (breed: ReferenceBreed) => void;
  onDescriptionChange: (value: string) => void;
  onDetailsContinue: () => void;
  onDoneEditing: () => void;
  onFormUpdate: (updates: Partial<HatchingEggFormState>) => void;
  onOpenPersistentShare: () => void;
  onPublish: () => void;
  onReloadPhotos: () => void;
  onSaveDraft: () => void;
  onSpeciesChange: (speciesId: string) => void;
  onStepToggle: (step: 1 | 2) => void;
  pendingPhotos: PendingPhoto[];
  photoError: string | null;
  publishDisabledReason: string | null;
  publishStatus: PublishStatus;
  removePendingPhoto: (photo: PendingPhoto) => void;
  reorderPendingPhotos: (photos: DashboardPhoto[]) => void;
  saveDraftDisabledReason: string | null;
  saveDraftStatus: SaveDraftStatus;
  savePendingPhotoCrop: (
    photo: DashboardPhoto,
    crop: PhotoCropMetadata | null,
  ) => void;
  selectedBreedId: string | null;
  selectedSpeciesName: string;
  species: ReferenceSpecies[];
  storeId: string;
  validationErrors: string[];
}) {
  const workflowReady = detailsComplete && descriptionComplete;
  const hasActionFeedback =
    Boolean(actionError) ||
    Boolean(actionMessage) ||
    validationErrors.length > 0;

  return (
    <main className="hidden space-y-5 sm:block">
      <SectionCard
        desktopComplete={desktopHighestUnlockedStep >= 2}
        desktopExpanded={activeStep === 1}
        desktopSummary={
          <span>
            {form.itemName.trim() || "Breed not set"}{" "}
            <span aria-hidden="true">•</span> Available{" "}
            {formatDate(form.availableDate)} <span aria-hidden="true">•</span>{" "}
            {form.quantityAvailable.trim() || "0"} eggs{" "}
            <span aria-hidden="true">•</span>{" "}
            {isValidMoney(form.price) ? formatCurrency(form.price) : "$0.00"} per egg
          </span>
        }
        onDesktopToggle={() => onStepToggle(1)}
        step="1"
        title="Egg Details"
      >
        <div className="relative grid gap-5 pr-0 xl:pr-36">
          <Image
            alt=""
            aria-hidden="true"
            className="absolute right-0 top-0 hidden h-28 w-36 object-contain opacity-90 xl:block"
            height={112}
            src="/illustrations/hatching-eggs-chick-nest.png"
            width={144}
          />
          <div className="grid gap-4 lg:grid-cols-2">
            <CompactField label="Species">
              <select
                className={inputClass}
                disabled={fieldsLockedAfterAddSave}
                value={form.speciesId}
                onChange={(event) => onSpeciesChange(event.target.value)}
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
              onCustomChange={onBreedChange}
              onSelectBreed={onBreedSelect}
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-4">
            <CompactField label="Available Date">
              <input
                className={inputClass}
                disabled={fieldsLockedAfterAddSave}
                type="date"
                value={form.availableDate}
                onChange={(event) =>
                  onFormUpdate({ availableDate: event.target.value })
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
                  onFormUpdate({ quantityAvailable: event.target.value })
                }
              />
            </CompactField>
            <CompactField label="Price Per Egg">
              <MoneyInput
                disabled={fieldsLockedAfterAddSave}
                value={form.price}
                onChange={(value) => onFormUpdate({ price: value })}
              />
            </CompactField>
          </div>
          {fieldsLockedAfterAddSave ? (
            <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-800">
              This Add-only draft has been created. Publish it as saved, or start
              over to create another hatching egg item.
            </p>
          ) : null}
          {isEditMode ? (
            <CompactField label="Visibility">
              <select
                className={inputClass}
                value={form.visibilityStatus}
                onChange={(event) =>
                  onFormUpdate({ visibilityStatus: event.target.value })
                }
              >
                <option value="hidden">Hidden</option>
                <option value="active">Live</option>
                <option value="sold_out">Sold out</option>
              </select>
            </CompactField>
          ) : null}
          <ValidationMessage errors={validationErrors} />
          <button
            className="ml-auto inline-flex min-h-10 items-center justify-center rounded-md bg-emerald-800 px-6 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-500"
            disabled={!detailsComplete}
            type="button"
            onClick={onDetailsContinue}
          >
            Continue
          </button>
        </div>
      </SectionCard>

      <SectionCard
        badge={activePhotoCount > 0 ? "Added" : undefined}
        desktopComplete={desktopHighestUnlockedStep === 3}
        desktopDisabled={desktopHighestUnlockedStep < 2}
        desktopExpanded={activeStep === 2}
        desktopSummary={`${activePhotoCount} photo${
          activePhotoCount === 1 ? "" : "s"
        } • ${descriptionComplete ? "Description added" : "Description needed"}`}
        onDesktopToggle={() => onStepToggle(2)}
        step="2"
        title="Photos & Description"
      >
        <div className="grid gap-4 lg:grid-cols-2 lg:items-stretch">
          <div className="min-w-0">
            <HatchingEggPhotos
              addPendingPhotos={addPendingPhotos}
              desktopCompact
              hatchingEggItemId={hatchingEggItemId}
              mediaItems={mediaItems}
              pendingPhotos={pendingPhotos}
              photoError={photoError}
              removePendingPhoto={removePendingPhoto}
              reorderPendingPhotos={reorderPendingPhotos}
              savePendingPhotoCrop={savePendingPhotoCrop}
              storeId={storeId}
              title="Photos"
              onReload={onReloadPhotos}
            />
          </div>
          <div className="flex min-w-0 flex-col rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
            <h3 className="text-base font-bold text-stone-950">Description</h3>
            {matchingDescriptionGroup ? (
              <div className="mt-3 space-y-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm leading-6 text-emerald-900">
                <p className="font-semibold">
                  Shared with your other {matchingDescriptionGroup.displayName}{" "}
                  hatching eggs.
                </p>
                <p>Price, quantity, date, and photos stay separate.</p>
              </div>
            ) : null}
            <label className="mt-4 flex min-h-0 flex-1 flex-col">
              <span className="mb-1.5 block text-sm font-semibold text-stone-600">
                {matchingDescriptionGroup
                  ? `Storefront description for ${matchingDescriptionGroup.displayName}`
                  : "Storefront description"}
              </span>
              <textarea
                className={`${inputClass} min-h-56 flex-1 resize-y py-3 leading-6`}
                disabled={fieldsLockedAfterAddSave}
                maxLength={descriptionMaxLength}
                placeholder="Share collection timing, fertility notes, rooster details, pickup expectations, or anything buyers should know."
                value={form.description}
                onChange={(event) => onDescriptionChange(event.target.value)}
              />
            </label>
            <div className="mt-2 flex items-center justify-between gap-4">
              <p className="text-sm text-stone-500">
                {form.description.length} / {descriptionMaxLength}
              </p>
              <button
                className="inline-flex min-h-10 items-center justify-center rounded-md border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-700 shadow-sm transition hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:ring-offset-2 disabled:cursor-not-allowed disabled:text-stone-400"
                disabled={!descriptionComplete}
                type="button"
                onClick={onDoneEditing}
              >
                Done editing
              </button>
            </div>
          </div>
        </div>
      </SectionCard>

      <section
        className={`rounded-lg border border-stone-200 bg-white p-5 shadow-sm ${
          desktopHighestUnlockedStep < 3
            ? "bg-stone-50/70 opacity-60 shadow-none"
            : ""
        }`}
      >
        <div className="flex min-h-12 items-center gap-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-base font-bold text-emerald-900">
            3
          </span>
          <div>
            <h2 className="text-xl font-bold text-stone-950">Ready to Publish</h2>
            <p className="mt-1 text-sm text-stone-600">
              Review the summary below, then publish your inventory.
            </p>
          </div>
        </div>
        {desktopHighestUnlockedStep >= 3 ? (
          <div className="mt-4 space-y-5">
            <div
              className={`flex items-center gap-5 rounded-lg px-5 py-4 ${
                workflowReady ? "bg-emerald-50" : "bg-amber-50"
              }`}
            >
              <span
                aria-hidden="true"
                className={`flex size-16 shrink-0 items-center justify-center rounded-full text-3xl font-bold text-white ${
                  workflowReady ? "bg-emerald-800" : "bg-amber-600"
                }`}
              >
                {workflowReady ? "✓" : "!"}
              </span>
              <div>
                <p className="text-xl font-bold text-stone-950">
                  {workflowReady ? "You’re all set!" : "A few details remain"}
                </p>
                <p className="mt-1 text-sm leading-6 text-stone-600">
                  {workflowReady
                    ? "Everything looks great. Publish when you’re ready."
                    : publishDisabledReason ??
                      "Finish the remaining details before publishing."}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                {hasActionFeedback ? (
                  <ActionStatus
                    actionError={actionError}
                    actionMessage={actionMessage}
                    publishDisabledReason={
                      isEditMode ? null : publishDisabledReason
                    }
                    validationErrors={validationErrors}
                  />
                ) : (
                  <p
                    className={`rounded-md border px-3 py-2 text-sm font-semibold ${
                      workflowReady
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : "border-stone-200 bg-stone-50 text-stone-600"
                    }`}
                  >
                    {workflowReady
                      ? "Everything is ready to publish."
                      : "Complete the required details to publish."}
                  </p>
                )}
              </div>
              {isEditMode ? (
                <>
                  <button
                    className="seller-secondary-button"
                    type="button"
                    onClick={onBackToInventory}
                  >
                    Back to Inventory
                  </button>
                  {hatchingEggProductId ? (
                    <button
                      className="seller-secondary-button"
                      type="button"
                      onClick={onOpenPersistentShare}
                    >
                      Share listing
                    </button>
                  ) : null}
                  <button
                    className="seller-primary-button"
                    disabled={saveDraftStatus === "saving" || !hasUnsavedChanges}
                    type="button"
                    onClick={onSaveDraft}
                  >
                    {saveDraftStatus === "saving" ? "Saving..." : "Save Changes"}
                  </button>
                </>
              ) : (
                <>
                  <PublishInventoryButton
                    onReviewPublish={onPublish}
                    publishDisabledReason={publishDisabledReason}
                    publishStatus={publishStatus}
                  />
                  <SaveDraftButton
                    canSaveDraft={!saveDraftDisabledReason}
                    onSaveDraft={onSaveDraft}
                    saveDraftDisabledReason={saveDraftDisabledReason}
                    saveDraftStatus={saveDraftStatus}
                  />
                </>
              )}
            </div>

            <HatchingEggDesktopSummary
              activePhotoCount={activePhotoCount}
              form={form}
              selectedSpeciesName={selectedSpeciesName}
            />
            <div className="flex items-center gap-5 border-t border-stone-200 pt-5">
              <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-amber-50">
                <Image
                  alt=""
                  className="size-10 object-contain"
                  height={40}
                  src="/glyphs/egg-carton.png"
                  width={40}
                />
              </span>
              <div>
                <p className="text-lg font-bold text-stone-950">Almost there!</p>
                <p className="mt-1 text-sm text-stone-600">
                  Once published, your hatching eggs will appear in your
                  storefront inventory.
                </p>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function HatchingEggDesktopSummary({
  activePhotoCount,
  form,
  selectedSpeciesName,
}: {
  activePhotoCount: number;
  form: HatchingEggFormState;
  selectedSpeciesName: string;
}) {
  const items = [
    {
      glyph: "/glyphs/egg.png",
      label: "Breed",
      value: form.itemName.trim() || "Not set",
    },
    {
      glyph: "/glyphs/calendar.png",
      label: "Available date",
      value: formatDate(form.availableDate),
    },
    {
      glyph: "/glyphs/feed-sack.png",
      label: "Quantity",
      value: `${form.quantityAvailable.trim() || "0"} eggs`,
    },
    {
      glyph: "/glyphs/cart.png",
      label: "Price per egg",
      value: isValidMoney(form.price) ? formatCurrency(form.price) : "$0.00",
    },
    {
      glyph: "/glyphs/egg-carton.png",
      label: "Species",
      value: selectedSpeciesName || "Not selected",
    },
    {
      glyph: "/glyphs/camera.png",
      label: "Photos",
      value: String(activePhotoCount),
    },
  ];

  return (
    <section
      aria-labelledby="hatching-eggs-desktop-summary-title"
      className="border-t border-stone-200 pt-5"
    >
      <h3
        className="text-lg font-bold text-stone-950"
        id="hatching-eggs-desktop-summary-title"
      >
        Listing Summary
      </h3>
      <div className="mt-4 grid gap-x-8 gap-y-5 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <div className="flex min-w-0 items-start gap-3" key={item.label}>
            <Image
              alt=""
              className="mt-0.5 size-5 shrink-0 object-contain"
              height={20}
              src={item.glyph}
              width={20}
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-stone-500">{item.label}</p>
              <p className="mt-1 text-base font-semibold leading-6 text-stone-900">
                {item.value}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function DesktopHatchingEggProgress({
  activeStep,
  highestUnlockedStep,
  onStepOpen,
}: {
  activeStep: 1 | 2 | 3;
  highestUnlockedStep: 1 | 2 | 3;
  onStepOpen: (step: 1 | 2 | 3) => void;
}) {
  const steps = ["Egg Details", "Photos & Description", "Ready to Publish"] as const;

  return (
    <nav
      aria-label="Add Hatching Eggs progress"
      className="mx-auto mt-8 hidden max-w-3xl px-4 sm:block"
    >
      <ol className="relative grid grid-cols-3">
        <span
          aria-hidden="true"
          className="absolute left-[16.67%] right-[16.67%] top-5 h-px bg-stone-300"
        />
        {steps.map((label, index) => {
          const step = (index + 1) as 1 | 2 | 3;
          const active = step === activeStep;
          const complete = step < highestUnlockedStep;
          const disabled = step > highestUnlockedStep;

          return (
            <li className="relative flex flex-col items-center" key={label}>
              <button
                aria-current={active ? "step" : undefined}
                className="group z-10 flex flex-col items-center text-center focus:outline-none disabled:cursor-not-allowed"
                disabled={disabled}
                type="button"
                onClick={() => onStepOpen(step)}
              >
                <span
                  className={`flex size-10 items-center justify-center rounded-full border text-sm font-bold shadow-sm transition-all group-focus:ring-2 group-focus:ring-emerald-700 group-focus:ring-offset-2 ${
                    (active || complete) && !disabled
                      ? "border-emerald-800 bg-emerald-800 text-white"
                      : disabled
                        ? "border-stone-200 bg-stone-100 text-stone-400 shadow-none"
                        : "border-stone-300 bg-white text-stone-600"
                  }`}
                >
                  {step}
                </span>
                <span
                  className={`mt-2 text-sm font-semibold ${
                    disabled
                      ? "text-stone-400"
                      : active
                        ? "text-stone-950"
                        : "text-stone-600"
                  }`}
                >
                  {label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
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
  savePendingPhotoCrop,
  storeId,
  desktopCompact = false,
  title = "Photos",
}: {
  addPendingPhotos: (files: FileList | null) => void;
  hatchingEggItemId: string;
  mediaItems: ListingPhotoItem[];
  onReload: () => void;
  pendingPhotos: PendingPhoto[];
  photoError: string | null;
  removePendingPhoto: (photo: PendingPhoto) => void;
  reorderPendingPhotos: (photos: DashboardPhoto[]) => void;
  savePendingPhotoCrop: (
    photo: DashboardPhoto,
    crop: PhotoCropMetadata | null,
  ) => void;
  storeId: string;
  desktopCompact?: boolean;
  title?: string;
}) {
  if (!hatchingEggItemId) {
    return (
      <PendingHatchingEggPhotos
        addPendingPhotos={addPendingPhotos}
        pendingPhotos={pendingPhotos}
        photoError={photoError}
        removePendingPhoto={removePendingPhoto}
        reorderPendingPhotos={reorderPendingPhotos}
        savePendingPhotoCrop={savePendingPhotoCrop}
        desktopCompact={desktopCompact}
        title={title}
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
      entityType="hatching_egg_inventory_item"
      listingBatchId={hatchingEggItemId}
      mediaItems={mediaItems}
      mode="setup"
      storeId={storeId}
      title={title}
      mobileCompact={desktopCompact}
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
  savePendingPhotoCrop,
  desktopCompact = false,
  title = "Photos",
}: {
  addPendingPhotos: (files: FileList | null) => void;
  pendingPhotos: PendingPhoto[];
  photoError: string | null;
  removePendingPhoto: (photo: PendingPhoto) => void;
  reorderPendingPhotos: (photos: DashboardPhoto[]) => void;
  savePendingPhotoCrop: (
    photo: DashboardPhoto,
    crop: PhotoCropMetadata | null,
  ) => void;
  desktopCompact?: boolean;
  title?: string;
}) {
  const dashboardPhotos = pendingPhotos.map((photo, index) => ({
    altText: photo.file.name,
    filename: photo.file.name,
    height: null,
    id: photo.id,
    label: photo.file.name || `Pending photo ${index + 1}`,
    cropMetadata: photo.cropMetadata ?? null,
    sortOrder: index,
    url: photo.url,
    width: null,
  }));

  return (
    <div className="space-y-3">
      <PhotoManager
        acceptedTypes={acceptedPendingImageTypes}
        canManage
        description={
          desktopCompact
            ? ""
            : "Manage the photos buyers see for this hatching egg item. The first photo will be the featured photo."
        }
        emptyDescription="Add photos now. They will be saved when you save or publish this item."
        error={
          photoError
            ? {
                message: photoError,
                title: "Photo could not be added",
              }
            : null
        }
        fillEmptySlots={!desktopCompact}
        helperText="Drag photos to reorder. The first photo is the featured photo."
        maxFileSizeMb={maxPendingImageSizeBytes / 1024 / 1024}
        maxPhotos={maxHatchingEggPhotos}
        mobileCompact={desktopCompact}
        photos={dashboardPhotos}
        removePhotoContext="item"
        title={title}
        onAddPhotos={addPendingPhotos}
        onRemovePhoto={(photo) => {
          const pendingPhoto = pendingPhotos.find((item) => item.id === photo.id);
          if (pendingPhoto) removePendingPhoto(pendingPhoto);
        }}
        onReorderPhotos={reorderPendingPhotos}
        onResetCrop={(photo) => savePendingPhotoCrop(photo, null)}
        onSaveCrop={(photo, crop) => savePendingPhotoCrop(photo, crop)}
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
  const normalizedValue = normalizeHatchingEggBreedName(value);
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
          normalizeHatchingEggBreedName(breed.breed_name).includes(normalizedValue),
        )
      : speciesBreeds;

    return matches.slice(0, 12);
  }, [normalizedValue, speciesBreeds]);
  const selectedBreed = selectedBreedId
    ? breeds.find((breed) => breed.id === selectedBreedId)
    : null;
  const exactMatchingBreed = findMatchingHatchingEggPlatformBreed({
    breeds,
    name: value,
    speciesId,
  });
  const canUseCustomName = canUseCustomHatchingEggBreedName({
    breeds,
    name: value,
    speciesId,
  });

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

          {!exactMatchingBreed ? (
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
          ) : null}
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

function findMatchingHatchingEggDescriptionGroup({
  currentItemId,
  itemName,
  rows,
}: {
  currentItemId: string;
  itemName: string;
  rows: HatchingEggGroupRow[];
}) {
  const groupKey = normalizeHatchingEggBreedName(itemName);

  if (!groupKey) return null;

  const matchingRows = rows.filter(
    (row) => normalizeHatchingEggBreedName(row.item_name) === groupKey,
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
    form.availableDate !== todayIsoDate ||
      form.description.trim() ||
      form.itemName.trim() ||
      form.minimumOrderQuantity.trim() ||
      form.price.trim() ||
      form.quantityAvailable.trim(),
  );
}

function getLocalIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
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
