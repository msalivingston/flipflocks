"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { formatBreedDisplayName } from "@/lib/breed-identity";
import { getPlanCapabilities } from "@/lib/plan-capabilities";
import { playDustySuccessSound } from "@/lib/success-sound";
import {
  ListingShareDialog,
  ListingShareMultiDialog,
} from "../../../_components/listing-share-dialog";
import { useSellerContext } from "../../../_components/seller-context";
import { DashboardPageContent } from "../../../_components/seller-ui";
import {
  buildFallbackLivePoultryShareProduct,
  loadLivePoultryShareProducts,
  type LivePoultryShareProduct,
} from "../../../_lib/live-poultry-share-products";
import {
  breedLibrarySelect,
  restoreCatalogDefaultPhotoBestEffort,
  sellerBreedProfileSelect,
  sellerMediaSelect,
  toDisplayImageUrl,
  type BreedLibraryItem,
  type BreedSpecies,
  type SellerBreedProfile,
} from "../../../breeds/breed-data";
import {
  createBlankCustomBreedDraft,
  CustomBreedForm,
  type CustomBreedDraft,
  validateCustomBreedDraft,
} from "../../../breeds/custom-breed-form";
import type { ListingPhotoItem } from "../../../listings/[listingBatchId]/listing-photos-section";
import { uploadSellerPhoto } from "../../../_components/seller-media-client";
import { AgeBasedPriceChangesCard } from "./AgeBasedPriceChangesCard";
import { BatchSummaryCard } from "./BatchSummaryCard";
import { BirdOfferingsCard } from "./BirdOfferingsCard";
import {
  fallbackSpeciesOptions,
  initialOfferings,
  liveBirdsV2DraftMarker,
  supportedSpeciesSlugs,
} from "./constants";
import {
  buildCreateLiveBirdsDraftPayload,
  buildCreateLiveBirdsPublishPayload,
  type CreateLiveBirdsPublishPayload,
} from "./createDraftPayload";
import { DesktopLiveBirdsStepNav } from "./DesktopLiveBirdsStepNav";
import {
  areAllReadinessChecksComplete,
  getAgeAtAvailability,
  getNumberInputValue,
  getReadinessChecks,
  isBirdsForSaleGroupStarted,
} from "./helpers";
import { HatchInformationCard } from "./HatchInformationCard";
import {
  applyInventoryIdentityMap,
  getCreationInventoryIdentityMap,
  resolveDraftInventoryRow,
  type InventoryIdentityMap,
} from "./inventoryIdentity";
import {
  buildLiveBirdsSavePayloadPreview,
  getCustomInventoryLabelForSoldAs,
  mapInventoryTypeToSoldAs,
  mapSoldAsToInventoryType,
} from "./payloadPreview";
import {
  defaultPriceAdjustment,
  getPriceAdjustmentIssues,
  hydratePriceAdjustment,
} from "./priceAdjustment";
import { ReviewPublishCard } from "./ReviewPublishCard";
import type { PublishStatus, SaveDraftStatus } from "./ReviewPublishCard";
import { getSaveDraftPreflight } from "./saveDraftPreflight";
import { SavePreviewCard } from "./SavePreviewCard";
import { MobileLiveBirdsArtwork } from "./MobileLiveBirdsArtwork";
import type {
  BirdOffering,
  BreedOption,
  PriceAdjustmentState,
  PublishValidationIssue,
  SpeciesOption,
} from "./types";
import {
  createSellerBreedProfileFromCatalogBreed,
  getBreedDescriptionFromOption,
  getBreedOptionForProfile,
  getBreedOptionsForSpecies,
  upsertSellerBreedProfile,
} from "./breedProfiles";

type SpeciesRow = {
  id: string;
  common_name: string;
  slug: string;
  sort_order: number | null;
};

type DraftInventoryRow = {
  listing_batch_id: string;
  listing_batch_breed_id: string;
  inventory_item_id: string;
  species_id: string;
  species_name: string;
  species_slug: string;
  seller_breed_profile_id: string;
  breed_display_name: string;
  batch_type: string;
  origin_date: string | null;
  available_date: string;
  base_price: number | null;
  auto_price_adjustment_enabled: boolean | null;
  price_adjustment_direction: string | null;
  price_adjustment_amount: number | null;
  price_adjustment_interval_weeks: number | null;
  price_adjustment_max_price: number | null;
  price_adjustment_min_price: number | null;
  internal_batch_label: string | null;
  listing_batch_visibility_status: string;
  listing_batch_breed_sort_order: number | null;
  listing_batch_breed_visibility_status: string;
  inventory_type: string;
  custom_inventory_label: string | null;
  quantity_available: number | null;
  price_override: number | null;
  inventory_item_sort_order: number | null;
  inventory_visibility_status: string;
};

type PendingEntryPhoto = {
  error: string | null;
  file: File;
  previewUrl: string;
};


type CreateDraftResult = {
  breed_groups: unknown;
  listing_batch_id: string;
  visibility_status: string;
};

type BatchBreedResult = {
  id: string;
};

type InventoryItemResult = {
  id: string;
};

type RemovalHistoryItemRow = {
  fulfilled_quantity: number | null;
  inventory_item_id: string | null;
  order_id: string;
};

type RemovalHistoryOrderRow = {
  order_id: string;
  order_status: string;
};

type BreedProfileUpsertResult = {
  seller_breed_profile_id?: string | null;
};

type EditSaveStatus = "idle" | "saving" | "success" | "error";

type EditBaseline = {
  availableDate: string;
  hatchDate: string;
  offerings: BirdOffering[];
  priceAdjustment: PriceAdjustmentState;
};

type PendingRemovedOffering = {
  index: number;
  offering: BirdOffering;
};

type LivePoultryPublishSuccessDialogState = {
  products: LivePoultryShareProduct[];
};

type LiveBirdPublishAllowance = {
  effective_plan_key: string;
  active_bird_limit: number | null;
  currently_active_bird_units: number;
  requested_bird_units: number;
  remaining_bird_units: number | null;
  can_publish?: boolean;
  published?: boolean;
  listing_batch_id?: string;
};

const showDeveloperSavePreview =
  process.env.NODE_ENV === "development" &&
  process.env.NEXT_PUBLIC_SHOW_ADD_INVENTORY_V2_SAVE_PREVIEW === "true";

type LiveBirdsListingFormProps = {
  listingBatchId?: string;
  mode: "create" | "edit";
};

export default function LiveBirdsV2Page() {
  return <LiveBirdsListingForm mode="create" />;
}

export function LiveBirdsListingForm({
  listingBatchId,
  mode,
}: LiveBirdsListingFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const draftId =
    mode === "create" ? searchParams.get("draftId") : listingBatchId ?? null;
  const isEditMode = mode === "edit";
  const { seller } = useSellerContext();
  const plan = getPlanCapabilities(seller?.plan_key);
  const nextOfferingId = useRef(initialOfferings.length + 1);
  const [species, setSpecies] = useState<SpeciesOption>(
    fallbackSpeciesOptions[0],
  );
  const [speciesOptions, setSpeciesOptions] = useState<SpeciesOption[]>(
    fallbackSpeciesOptions,
  );
  const [catalogBreeds, setCatalogBreeds] = useState<BreedLibraryItem[]>([]);
  const [sellerBreedProfiles, setSellerBreedProfiles] = useState<
    SellerBreedProfile[]
  >([]);
  const [breedMediaItems, setBreedMediaItems] = useState<ListingPhotoItem[]>(
    [],
  );
  const [entryMediaItems, setEntryMediaItems] = useState<ListingPhotoItem[]>(
    [],
  );
  const [pendingEntryPhotos, setPendingEntryPhotos] = useState<
    Record<string, PendingEntryPhoto>
  >({});
  const pendingEntryPhotosRef = useRef<Record<string, PendingEntryPhoto>>({});
  const [breedPhotoActionMessage, setBreedPhotoActionMessage] = useState<
    string | null
  >(null);
  const [referenceDataLoading, setReferenceDataLoading] = useState(true);
  const [referenceDataError, setReferenceDataError] = useState<string | null>(
    null,
  );
  const [draftLoadError, setDraftLoadError] = useState<string | null>(null);
  const [draftLoading, setDraftLoading] = useState(Boolean(draftId));
  const [formResetKey, setFormResetKey] = useState(0);
  const [loadedDraftSpeciesId, setLoadedDraftSpeciesId] = useState<
    string | null
  >(null);
  const [loadedDraftId, setLoadedDraftId] = useState<string | null>(null);
  const [saveDraftMessage, setSaveDraftMessage] = useState<string | null>(null);
  const [saveDraftStatus, setSaveDraftStatus] =
    useState<SaveDraftStatus>("idle");
  const [publishMessage, setPublishMessage] = useState<string | null>(null);
  const [publishStatus, setPublishStatus] = useState<PublishStatus>("idle");
  const [editSaveMessage, setEditSaveMessage] = useState<string | null>(null);
  const [editSaveStatus, setEditSaveStatus] =
    useState<EditSaveStatus>("idle");
  const [publishedListingBatchId, setPublishedListingBatchId] = useState<
    string | null
  >(null);
  const [publishSuccessDialog, setPublishSuccessDialog] =
    useState<LivePoultryPublishSuccessDialogState | null>(null);
  const [shareDialogProducts, setShareDialogProducts] = useState<
    LivePoultryShareProduct[]
  >([]);
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
  const [isResolvingShareProducts, setIsResolvingShareProducts] =
    useState(false);
  const isNavigatingAfterPublishRef = useRef(false);
  const [isStartOverDialogOpen, setIsStartOverDialogOpen] = useState(false);
  const [pendingSpeciesChange, setPendingSpeciesChange] =
    useState<SpeciesOption | null>(null);
  const [pendingNavigationHref, setPendingNavigationHref] = useState<
    string | null
  >(null);
  const [navigationSaveMessage, setNavigationSaveMessage] = useState<
    string | null
  >(null);
  const [savedListingBatchId, setSavedListingBatchId] = useState<string | null>(
    null,
  );
  const [savedFormSnapshot, setSavedFormSnapshot] = useState<string | null>(null);
  const [hatchDate, setHatchDate] = useState("");
  const [availableDate, setAvailableDate] = useState(() =>
    getTodayDateInputValue(),
  );
  const [offerings, setOfferings] = useState<BirdOffering[]>(initialOfferings);
  const [editBaseline, setEditBaseline] = useState<EditBaseline | null>(null);
  const [pendingRemovedOfferings, setPendingRemovedOfferings] = useState<
    PendingRemovedOffering[]
  >([]);
  const [removeBlockedInventoryItemIds, setRemoveBlockedInventoryItemIds] =
    useState<Set<string>>(() => new Set());
  const [hasUnsavedSavedEntryPhotoChanges, setHasUnsavedSavedEntryPhotoChanges] =
    useState(false);
  const [scrollToOfferingId, setScrollToOfferingId] = useState<string | null>(
    null,
  );
  const [groupsReviewMode, setGroupsReviewMode] = useState(false);
  const [mobileActiveStep, setMobileActiveStep] = useState<1 | 2 | 3 | 4>(1);
  const [
    showBirdsForSaleCompletionError,
    setShowBirdsForSaleCompletionError,
  ] = useState(false);
  const [desktopExpandedStep, setDesktopExpandedStep] = useState<
    1 | 2 | 3 | 4 | null
  >(isEditMode ? 2 : 1);
  const [highestUnlockedDesktopStep, setHighestUnlockedDesktopStep] = useState<
    1 | 2 | 3 | 4
  >(isEditMode ? 4 : 1);
  const [customBreedOfferingId, setCustomBreedOfferingId] = useState<
    string | null
  >(null);

  useEffect(() => {
    pendingEntryPhotosRef.current = pendingEntryPhotos;
  }, [pendingEntryPhotos]);

  useEffect(
    () => () => {
      Object.values(pendingEntryPhotosRef.current).forEach((photo) => {
        URL.revokeObjectURL(photo.previewUrl);
      });
    },
    [],
  );
  const [customBreedDraft, setCustomBreedDraft] = useState<CustomBreedDraft>(() =>
    createBlankCustomBreedDraft(""),
  );
  const [customBreedError, setCustomBreedError] = useState<string | null>(null);
  const [customBreedDuplicate, setCustomBreedDuplicate] =
    useState<BreedOption | null>(null);
  const [customBreedSaving, setCustomBreedSaving] = useState(false);
  const customBreedInputRef = useRef<HTMLInputElement>(null);
  const [priceAdjustment, setPriceAdjustment] = useState<PriceAdjustmentState>(
    defaultPriceAdjustment,
  );
  const breedOptions = useMemo(
    () =>
      getBreedOptionsForSpecies({
        catalogBreeds,
        mediaItems: breedMediaItems,
        sellerBreedProfiles,
        species,
      }),
    [catalogBreeds, breedMediaItems, sellerBreedProfiles, species],
  );
  const customBreedSpecies = useMemo<BreedSpecies[]>(
    () =>
      species.id
        ? [
            {
              common_name: species.label,
              id: species.id,
              slug: species.slug ?? "",
              sort_order: 0,
            },
          ]
        : [],
    [species.id, species.label, species.slug],
  );
  const breedMediaItemsByProfileId = useMemo(
    () => groupBreedMediaByProfileId(breedMediaItems),
    [breedMediaItems],
  );
  const usingFallbackSpecies = speciesOptions.every((option) => option.id === null);
  const usingFallbackBreeds = breedOptions.every(
    (option) => option.source === "fallback",
  );
  const breedOptionsMessage = getBreedOptionsMessage({
    referenceDataError,
    referenceDataLoading,
    selectedSpeciesLabel: species.label,
    usingFallbackBreeds,
  });
  const ageAtAvailability = useMemo(
    () => getAgeAtAvailability(hatchDate, availableDate),
    [availableDate, hatchDate],
  );
  const readiness = useMemo(
    () =>
      getReadinessChecks({
        availableDate,
        hatchDate,
        offerings,
        species: species.label,
      }),
    [availableDate, hatchDate, offerings, species.label],
  );
  const savePayloadPreview = useMemo(
    () =>
      buildLiveBirdsSavePayloadPreview({
        availableDate,
        hatchDate,
        offerings,
        species,
      }),
    [availableDate, hatchDate, offerings, species],
  );
  const currentFormSnapshot = useMemo(
    () =>
      getLiveBirdsFormSnapshot({
        availableDate,
        hatchDate,
        offerings,
        priceAdjustment: plan.ageBasedPricingEnabled
          ? priceAdjustment
          : defaultPriceAdjustment,
        species,
      }),
    [
      availableDate,
      hatchDate,
      offerings,
      plan.ageBasedPricingEnabled,
      priceAdjustment,
      species,
    ],
  );
  const hasMeaningfulUnsavedChanges =
    publishedListingBatchId === null &&
    savedFormSnapshot !== null &&
    (currentFormSnapshot !== savedFormSnapshot ||
      pendingRemovedOfferings.length > 0 ||
      hasUnsavedSavedEntryPhotoChanges ||
      Object.keys(pendingEntryPhotos).length > 0);
  const editChangeSummaries = useMemo(
    () =>
      isEditMode
        ? getEditChangeSummaries({
            availableDate,
            baseline: editBaseline,
            hatchDate,
            offerings,
            pendingEntryPhotos,
            pendingRemovedOfferings,
            priceAdjustment,
          })
        : [],
    [
      availableDate,
      editBaseline,
      hatchDate,
      isEditMode,
      offerings,
      pendingEntryPhotos,
      pendingRemovedOfferings,
      priceAdjustment,
    ],
  );
  const editCurrentAgeLabel = isEditMode
    ? formatAgeFromHatchDate(editBaseline?.hatchDate ?? hatchDate)
    : null;
  const editPriceSummariesByOfferingId = useMemo(() => {
    if (!isEditMode) return {};

    const baselineByInventoryId = new Map(
      (editBaseline?.offerings ?? []).map((offering) => [
        offering.inventoryItemId,
        offering,
      ]),
    );

    return Object.fromEntries(
      offerings.map((offering) => {
        const baselineOffering = offering.inventoryItemId
          ? baselineByInventoryId.get(offering.inventoryItemId)
          : null;
        const current = calculateCurrentListingPrice({
          availableDate: editBaseline?.availableDate ?? availableDate,
          price: baselineOffering?.price ?? offering.price,
          priceAdjustment: editBaseline?.priceAdjustment ?? priceAdjustment,
        });
        const after = calculateCurrentListingPrice({
          availableDate,
          price: offering.price,
          priceAdjustment,
        });
        const currentStarting = Number(baselineOffering?.price ?? offering.price);
        const newStarting = Number(offering.price);

        return [
          offering.id,
          {
            after: formatCurrency(after),
            current: formatCurrency(current),
            currentStarting: formatCurrency(currentStarting),
            newStarting: formatCurrency(newStarting),
          },
        ];
      }),
    );
  }, [availableDate, editBaseline, isEditMode, offerings, priceAdjustment]);
  const saveDraftPreflight = useMemo(
    () =>
      getSaveDraftPreflight({
        availableDate,
        hatchDate,
        offerings,
        priceAdjustment: plan.ageBasedPricingEnabled
          ? priceAdjustment
          : defaultPriceAdjustment,
        species,
        usingFallbackBreeds,
        usingFallbackSpecies,
      }),
    [
      availableDate,
      hatchDate,
      offerings,
      plan.ageBasedPricingEnabled,
      priceAdjustment,
      species,
      usingFallbackBreeds,
      usingFallbackSpecies,
    ],
  );
  const publishValidationIssues = useMemo(
    () =>
      getPublishValidationIssues({
        allowZeroQuantity: isEditMode,
        availableDate,
        breedMediaItemsByProfileId,
        breedOptions,
        hatchDate,
        offerings,
        priceAdjustment,
        species,
      }),
    [
      availableDate,
      breedMediaItemsByProfileId,
      breedOptions,
      hatchDate,
      isEditMode,
      offerings,
      priceAdjustment,
      species,
    ],
  );
  const displayReadiness = useMemo(
    () => ({
      ...readiness,
      buyerContentComplete:
        readiness.buyerContentComplete &&
        !publishValidationIssues.some(
          (issue) =>
            issue.id.endsWith("-photo") || issue.id.endsWith("-description"),
        ),
    }),
    [publishValidationIssues, readiness],
  );
  const editSaveBlockingIssues = useMemo(
    () =>
      isEditMode
        ? getEditSaveBlockingIssues({
            availableDate,
            hatchDate,
            loadedSpeciesId: loadedDraftSpeciesId,
            offerings,
            priceAdjustment: plan.ageBasedPricingEnabled
              ? priceAdjustment
              : defaultPriceAdjustment,
            species,
            sellerBreedProfiles,
          })
        : [],
    [
      availableDate,
      hatchDate,
      isEditMode,
      loadedDraftSpeciesId,
      offerings,
      plan.ageBasedPricingEnabled,
      priceAdjustment,
      species,
      sellerBreedProfiles,
    ],
  );
  const isLoadedDraft = loadedDraftId !== null;
  const currentSavedDraftId = loadedDraftId ?? savedListingBatchId;
  const hasSavedDraft = currentSavedDraftId !== null;
  const loadedDraftSpeciesDisabledReason = isLoadedDraft
    ? getLoadedDraftSaveDisabledReason({
        loadedDraftSpeciesId,
        speciesId: species.id,
      })
    : null;
  const isPublished = publishedListingBatchId !== null;
  const saveDraftDisabledReason = isPublished
    ? "Published inventory cannot be saved as a draft here."
    : loadedDraftSpeciesDisabledReason;
  const publishDisabledReason = getPublishDisabledReason({
    isPublished,
    loadedDraftSpeciesDisabledReason,
    preflightCanSaveDraft: saveDraftPreflight.canSaveDraft,
    readyToPublish:
      areAllReadinessChecksComplete(displayReadiness) &&
      publishValidationIssues.length === 0,
    saveDraftStatus,
  });
  const mobileStepProgression = useMemo(
    () => getMobileLiveBirdsStepProgression(publishValidationIssues),
    [publishValidationIssues],
  );
  const birdsForSaleCompletionErrorMessage = useMemo(
    () => getBirdsForSaleCompletionErrorMessage(publishValidationIssues),
    [publishValidationIssues],
  );
  const visibleMobileActiveStep =
    mobileActiveStep > mobileStepProgression.highestUnlockedStep
      ? mobileStepProgression.highestUnlockedStep
      : mobileActiveStep;
  const editSaveDisabledReason = getEditSaveDisabledReason({
    blockingIssues: editSaveBlockingIssues,
    draftLoading,
    hasMeaningfulUnsavedChanges,
    isEditMode,
    saveStatus: editSaveStatus,
  });

  useEffect(() => {
    let isMounted = true;

    async function loadPageData() {
      if (!seller) return;

      setReferenceDataLoading(true);
      setDraftLoading(Boolean(draftId));
      setReferenceDataError(null);
      setDraftLoadError(null);

      const [speciesResult, catalogBreedResult, profileResult] = await Promise.all([
        supabase
          .from("species")
          .select("id, common_name, slug, sort_order")
          .eq("is_active", true)
          .order("sort_order", { ascending: true })
          .order("common_name", { ascending: true })
          .returns<SpeciesRow[]>(),
        supabase
          .from("breeds")
          .select(breedLibrarySelect)
          .eq("is_active", true)
          .order("sort_order", { ascending: true })
          .order("breed_name", { ascending: true })
          .returns<BreedLibraryItem[]>(),
        supabase
          .from("seller_breed_profiles")
          .select(sellerBreedProfileSelect)
          .eq("store_id", seller.store_id)
          .eq("visibility_status", "active")
          .eq("moderation_status", "normal")
          .order("display_name", { ascending: true })
          .returns<SellerBreedProfile[]>(),
      ]);

      if (!isMounted) return;

      const loadError =
        speciesResult.error ?? catalogBreedResult.error ?? profileResult.error;

      if (loadError) {
        setReferenceDataError(loadError.message);
        setReferenceDataLoading(false);
        setDraftLoading(false);
        return;
      }

      const loadedSpecies = (speciesResult.data ?? [])
        .filter((row) => supportedSpeciesSlugs.includes(row.slug))
        .map((row) => ({
          id: row.id,
          label: row.common_name,
          slug: row.slug,
        }));
      const baseSpeciesOptions =
        loadedSpecies.length > 0 ? loadedSpecies : fallbackSpeciesOptions;
      const loadedCatalogBreeds = catalogBreedResult.data ?? [];
      const loadedSellerBreedProfiles = profileResult.data ?? [];
      const mediaResult =
        loadedSellerBreedProfiles.length > 0
          ? await supabase
              .from("seller_media_management")
              .select(sellerMediaSelect)
              .eq("store_id", seller.store_id)
              .eq("entity_type", "seller_breed_profile")
              .in(
                "entity_id",
                loadedSellerBreedProfiles.map((profile) => profile.id),
              )
              .returns<ListingPhotoItem[]>()
          : { data: [] as ListingPhotoItem[], error: null };

      if (!isMounted) return;

      const loadedBreedMediaItems = mediaResult.data ?? [];

      if (mediaResult.error) {
        setReferenceDataError(
          `Breed photos could not be loaded. ${mediaResult.error.message}`,
        );
      }

      const draftRows = draftId
        ? await loadListingRows({
            listingBatchId: draftId,
            mode,
            storeId: seller.store_id,
          })
        : null;

      if (!isMounted) return;

      if (draftRows && "error" in draftRows) {
        setDraftLoadError(draftRows.error);
        setLoadedDraftId(null);
        setReferenceDataLoading(false);
        setDraftLoading(false);
        return;
      }

      const nextSpecies =
        draftRows
          ? getDraftSpeciesOption(draftRows.rows, baseSpeciesOptions)
          : null;
      const entryMediaResult = draftRows
        ? await loadInventoryEntryMediaItems({
            inventoryItemIds: draftRows.rows.map((row) => row.inventory_item_id),
            storeId: seller.store_id,
          })
        : { items: [] as ListingPhotoItem[] };
      const removalHistoryResult =
        draftRows && isEditMode
          ? await loadInventoryRemovalBlockedIds(
              draftRows.rows.map((row) => row.inventory_item_id),
            )
          : { blockedIds: new Set<string>() };

      if (!isMounted) return;

      if ("error" in entryMediaResult) {
        setReferenceDataError(
          `Option photos could not be loaded. ${entryMediaResult.error}`,
        );
      }
      const loadedEntryMediaItems =
        "items" in entryMediaResult ? entryMediaResult.items : [];
      const nextSpeciesOptions =
        draftRows && nextSpecies
          ? mergeDraftSpeciesOptions(baseSpeciesOptions, nextSpecies)
          : baseSpeciesOptions;
      const blankSpecies = getBlankSpeciesOption();
      const selectedSpecies = nextSpecies ?? blankSpecies;
      const nextBreedOptions = getBreedOptionsForSpecies({
        catalogBreeds: loadedCatalogBreeds,
        mediaItems: loadedBreedMediaItems,
        sellerBreedProfiles: loadedSellerBreedProfiles,
        species: selectedSpecies,
      });

      setSpeciesOptions(nextSpeciesOptions);
      setCatalogBreeds(loadedCatalogBreeds);
      setSellerBreedProfiles(loadedSellerBreedProfiles);
      setBreedMediaItems(loadedBreedMediaItems);
      setEntryMediaItems(loadedEntryMediaItems);
      setRemoveBlockedInventoryItemIds(removalHistoryResult.blockedIds);
      setHasUnsavedSavedEntryPhotoChanges(false);
      setSpecies(selectedSpecies);

      if (draftRows) {
        const loadedOfferings = alignOfferingsToBreedOptions(
          getOfferingsFromDraftRows(draftRows.rows),
          nextBreedOptions,
        );
        const loadedHatchDate = draftRows.rows[0]?.origin_date ?? "";
        const loadedAvailableDate = draftRows.rows[0]?.available_date ?? "";
        const loadedPriceAdjustment = hydratePriceAdjustment(draftRows.rows[0]);

        setLoadedDraftId(draftId);
        setLoadedDraftSpeciesId(draftRows.rows[0]?.species_id ?? null);
        setHatchDate(loadedHatchDate);
        setAvailableDate(loadedAvailableDate);
        setHighestUnlockedDesktopStep(
          isEditMode
            ? 4
            : isBirdsForSaleStepLocked({
            availableDate: loadedAvailableDate,
            hatchDate: loadedHatchDate,
            species: selectedSpecies,
          })
              ? 1
              : 2,
        );
        setPriceAdjustment(loadedPriceAdjustment);
        setOfferings(loadedOfferings);
        setPendingRemovedOfferings([]);
        setEditBaseline(
          isEditMode
            ? {
                availableDate: loadedAvailableDate,
                hatchDate: loadedHatchDate,
                offerings: loadedOfferings,
                priceAdjustment: loadedPriceAdjustment,
              }
            : null,
        );
        nextOfferingId.current = loadedOfferings.length + 1;
        setGroupsReviewMode(false);
        setSavedFormSnapshot(getLiveBirdsFormSnapshot({
          availableDate: loadedAvailableDate,
          hatchDate: loadedHatchDate,
          offerings: loadedOfferings,
          priceAdjustment: loadedPriceAdjustment,
          species: selectedSpecies,
        }));
        setSaveDraftStatus("idle");
        setSaveDraftMessage(null);
        setPublishStatus("idle");
        setPublishMessage(null);
        setPublishSuccessDialog(null);
        isNavigatingAfterPublishRef.current = false;
        setEditSaveStatus("idle");
        setEditSaveMessage(null);
        setPublishedListingBatchId(null);
        setSavedListingBatchId(null);
      } else {
        const todayDate = getTodayDateInputValue();
        const blankOfferings = alignOfferingsToBreedOptions(
          initialOfferings,
          nextBreedOptions,
        );

        setLoadedDraftId(null);
        setLoadedDraftSpeciesId(null);
        setHatchDate("");
        setAvailableDate(todayDate);
        setHighestUnlockedDesktopStep(1);
        setPriceAdjustment(defaultPriceAdjustment);
        setOfferings(blankOfferings);
        setPendingRemovedOfferings([]);
        setEditBaseline(null);
        nextOfferingId.current = initialOfferings.length + 1;
        setGroupsReviewMode(false);
        setSavedFormSnapshot(getLiveBirdsFormSnapshot({
          availableDate: todayDate,
          hatchDate: "",
          offerings: blankOfferings,
          priceAdjustment: defaultPriceAdjustment,
          species: selectedSpecies,
        }));
        setSaveDraftStatus("idle");
        setSaveDraftMessage(null);
        setPublishStatus("idle");
        setPublishMessage(null);
        setPublishSuccessDialog(null);
        isNavigatingAfterPublishRef.current = false;
        setEditSaveStatus("idle");
        setEditSaveMessage(null);
        setPublishedListingBatchId(null);
        setSavedListingBatchId(null);
      }

      setReferenceDataLoading(false);
      setDraftLoading(false);
    }

    void loadPageData();

    return () => {
      isMounted = false;
    };
  }, [draftId, isEditMode, mode, seller]);

  useEffect(() => {
    if (isEditMode || !hasMeaningfulUnsavedChanges) return;

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [hasMeaningfulUnsavedChanges, isEditMode]);

  useEffect(() => {
    function handleDocumentClick(event: MouseEvent) {
      if (
        isEditMode ||
        !hasMeaningfulUnsavedChanges ||
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

      const currentLocation = `${window.location.pathname}${window.location.search}`;
      const nextLocation = `${destination.pathname}${destination.search}`;

      if (nextLocation === currentLocation) return;

      event.preventDefault();
      setNavigationSaveMessage(null);
      setPendingNavigationHref(nextLocation);
    }

    document.addEventListener("click", handleDocumentClick, true);

    return () => {
      document.removeEventListener("click", handleDocumentClick, true);
    };
  }, [hasMeaningfulUnsavedChanges, isEditMode]);

  useEffect(() => {
    if (!customBreedOfferingId) return;

    customBreedInputRef.current?.focus();

    function handleModalKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !customBreedSaving) {
        setCustomBreedOfferingId(null);
        setCustomBreedDraft(createBlankCustomBreedDraft(""));
        setCustomBreedError(null);
        setCustomBreedDuplicate(null);
      }
    }

    document.addEventListener("keydown", handleModalKeyDown);

    return () => {
      document.removeEventListener("keydown", handleModalKeyDown);
    };
  }, [customBreedOfferingId, customBreedSaving]);

  function createLocalOfferingId() {
    const offeringId = `offering-${nextOfferingId.current}`;
    nextOfferingId.current += 1;

    return offeringId;
  }

  function selectSpecies(nextSpecies: SpeciesOption) {
    const speciesChanged =
      nextSpecies.id !== species.id ||
      nextSpecies.slug !== species.slug ||
      nextSpecies.label !== species.label;

    if (
      speciesChanged &&
      offerings.some((offering) => isBirdsForSaleGroupStarted(offering))
    ) {
      setPendingSpeciesChange(nextSpecies);
      return;
    }

    applySpeciesChange(nextSpecies, false);
  }

  function applySpeciesChange(
    nextSpecies: SpeciesOption,
    clearBirdEntries: boolean,
  ) {
    const nextBreedOptions = getBreedOptionsForSpecies({
      catalogBreeds,
      mediaItems: breedMediaItems,
      sellerBreedProfiles,
      species: nextSpecies,
    });

    setSpecies(nextSpecies);
    unlockBirdsForSaleIfReady({
      nextAvailableDate: availableDate,
      nextHatchDate: hatchDate,
      nextSpecies,
    });

    if (clearBirdEntries) {
      setOfferings(
        alignOfferingsToBreedOptions(initialOfferings, nextBreedOptions),
      );
      nextOfferingId.current = initialOfferings.length + 1;
      setGroupsReviewMode(false);
      setScrollToOfferingId(null);
      setShowBirdsForSaleCompletionError(false);
      setBreedPhotoActionMessage(null);
      setHighestUnlockedDesktopStep(2);
      return;
    }

    setOfferings((currentOfferings) =>
      alignOfferingsToBreedOptions(currentOfferings, nextBreedOptions),
    );
  }

  function confirmSpeciesChange() {
    if (!pendingSpeciesChange) return;

    applySpeciesChange(pendingSpeciesChange, true);
    setPendingSpeciesChange(null);
  }

  function unlockBirdsForSaleIfReady({
    nextAvailableDate,
    nextHatchDate,
    nextSpecies,
  }: {
    nextAvailableDate: string;
    nextHatchDate: string;
    nextSpecies: SpeciesOption;
  }) {
    if (
      isEditMode ||
      !isBirdsForSaleStepLocked({
        availableDate: nextAvailableDate,
        hatchDate: nextHatchDate,
        species: nextSpecies,
      })
    ) {
      setHighestUnlockedDesktopStep((currentStep) =>
        currentStep < 2 ? 2 : currentStep,
      );
    }
  }

  function updateHatchDate(nextHatchDate: string) {
    setHatchDate(nextHatchDate);
    unlockBirdsForSaleIfReady({
      nextAvailableDate: availableDate,
      nextHatchDate,
      nextSpecies: species,
    });
  }

  function updateAvailableDate(nextAvailableDate: string) {
    setAvailableDate(nextAvailableDate);
    unlockBirdsForSaleIfReady({
      nextAvailableDate,
      nextHatchDate: hatchDate,
      nextSpecies: species,
    });
  }

  function updateOffering(
    offeringId: string,
    updates: Partial<Omit<BirdOffering, "id">>,
  ) {
    setOfferings((currentOfferings) =>
      currentOfferings.map((offering) =>
        offering.id === offeringId ? { ...offering, ...updates } : offering,
      ),
    );
  }

  function updateOfferingBreed(
    offeringId: string,
    option: BreedOption,
    options: { preserveExistingDescription?: boolean } = {},
  ) {
    const { preserveExistingDescription = false } = options;

    setBreedPhotoActionMessage(null);

    setOfferings((currentOfferings) =>
      currentOfferings.map((offering) =>
        offering.id === offeringId
          ? {
              ...offering,
              breed: option.label,
              breedId: option.breedId,
              description:
                preserveExistingDescription &&
                offering.description.trim().length > 0
                  ? offering.description
                  : getBreedDescriptionFromOption(option),
              breedContentExpanded: false,
              breedContentUserToggled: false,
              sellerBreedProfileId: option.id,
            }
          : offering,
      ),
    );

    if (!option.id && option.breedId) {
      void ensureSellerProfileForCatalogOption({
        offeringId,
        option,
        successMessage:
          "Breed added to your personal breed library for this draft.",
      });
    }
  }

  async function prepareBreedPhotoProfile(offeringId: string) {
    const offering = offerings.find((item) => item.id === offeringId);
    const option =
      offering &&
      (findBreedOptionById(breedOptions, offering.sellerBreedProfileId) ??
        findBreedOptionByBreedId(breedOptions, offering.breedId ?? null) ??
        findBreedOptionByLabel(breedOptions, offering.breed));

    if (!seller?.store_id || !offering || !option?.breedId) {
      setBreedPhotoActionMessage(
        "Choose a catalog breed before changing its breed photo.",
      );
      return;
    }

    if (option.id) return;

    await ensureSellerProfileForCatalogOption({
      offeringId,
      option,
      successMessage:
        "Breed added to your personal breed library. You can change its breed photo now.",
    });
  }

  async function ensureSellerProfileForCatalogOption({
    offeringId,
    option,
    successMessage,
  }: {
    offeringId: string;
    option: BreedOption;
    successMessage: string;
  }) {
    if (!seller?.store_id || !option.breedId) return;

    setBreedPhotoActionMessage("Adding this breed to your personal breed library...");
    const createdProfile = await createSellerBreedProfileFromCatalogBreed({
      breedId: option.breedId,
      catalogBreeds,
      storeId: seller.store_id,
    });

    if (!createdProfile.ok) {
      setBreedPhotoActionMessage(createdProfile.message);
      return;
    }

    const nextProfiles = upsertSellerBreedProfile(
      sellerBreedProfiles,
      createdProfile.profile,
    );
    const restoredDefaultPhoto = option.catalogImageUrl
      ? await restoreCatalogDefaultPhotoBestEffort(createdProfile.profile.id)
      : { ok: true as const };
    const refreshedMedia = await loadBreedMediaItems({
      profileIds: nextProfiles.map((profile) => profile.id),
      storeId: seller.store_id,
    });
    const nextMediaItems =
      "items" in refreshedMedia ? refreshedMedia.items : breedMediaItems;
    const nextOption = getBreedOptionForProfile({
      catalogBreeds,
      mediaItems: nextMediaItems,
      profile: createdProfile.profile,
    });

    setSellerBreedProfiles(nextProfiles);
    setBreedMediaItems(nextMediaItems);
    updateOfferingBreed(offeringId, nextOption, {
      preserveExistingDescription: true,
    });
    setBreedPhotoActionMessage(
      restoredDefaultPhoto.ok
        ? successMessage
        : "Breed added to your personal breed library. The default photo could not be copied automatically.",
    );
  }

  function openCustomBreedModal(offeringId: string) {
    setCustomBreedOfferingId(offeringId);
    setCustomBreedDraft(createBlankCustomBreedDraft(species.id ?? ""));
    setCustomBreedError(null);
    setCustomBreedDuplicate(null);
  }

  function closeCustomBreedModal() {
    if (customBreedSaving) return;

    setCustomBreedOfferingId(null);
    setCustomBreedDraft(createBlankCustomBreedDraft(""));
    setCustomBreedError(null);
    setCustomBreedDuplicate(null);
  }

  function updateCustomBreedDraft(draft: CustomBreedDraft) {
    setCustomBreedDraft(draft);
    setCustomBreedError(null);
    setCustomBreedDuplicate(null);
  }

  function useDuplicateCustomBreed() {
    if (!customBreedOfferingId || !customBreedDuplicate) return;

    updateOfferingBreed(customBreedOfferingId, customBreedDuplicate);
    closeCustomBreedModal();
  }

  async function submitCustomBreed() {
    if (customBreedSaving || !customBreedOfferingId) return;

    if (!species.id) {
      setCustomBreedError("Select a species before adding a custom breed.");
      return;
    }

    const validation = validateCustomBreedDraft({
      draft: customBreedDraft,
      species: customBreedSpecies,
    });

    if (!validation.ok) {
      setCustomBreedError(validation.message);
      return;
    }

    const duplicateOption = findDuplicateBreedOption({
      breedOptions,
      name: validation.draft.name,
      speciesId: species.id,
    });

    if (duplicateOption) {
      setCustomBreedDuplicate(duplicateOption);
      setCustomBreedError("That breed is already in the list.");
      return;
    }

    if (!seller?.store_id) {
      setCustomBreedError("The store context is missing. The breed was not added.");
      return;
    }

    setCustomBreedSaving(true);
    setCustomBreedError(null);

    const createdProfile = await createSellerCustomBreedProfile({
      draft: validation.draft,
      speciesId: species.id,
      storeId: seller.store_id,
    });

    if (!createdProfile.ok) {
      setCustomBreedSaving(false);
      setCustomBreedError(createdProfile.message);
      return;
    }

    const nextProfiles = upsertSellerBreedProfile(
      sellerBreedProfiles,
      createdProfile.profile,
    );
    const nextOption = getBreedOptionForProfile({
      catalogBreeds,
      mediaItems: breedMediaItems,
      profile: createdProfile.profile,
    });

    setSellerBreedProfiles(nextProfiles);
    updateOfferingBreed(customBreedOfferingId, nextOption, {
      preserveExistingDescription: true,
    });
    setCustomBreedSaving(false);
    closeCustomBreedModal();
  }

  async function reloadBreedPhotos() {
    if (!seller?.store_id || sellerBreedProfiles.length === 0) return;

    const refreshedMedia = await loadBreedMediaItems({
      profileIds: sellerBreedProfiles.map((profile) => profile.id),
      storeId: seller.store_id,
    });

    if ("items" in refreshedMedia) {
      setBreedMediaItems(refreshedMedia.items);
    }
  }

  async function reloadEntryPhotos() {
    if (!seller?.store_id) return;
    const inventoryItemIds = offerings
      .map((offering) => offering.inventoryItemId)
      .filter((id): id is string => Boolean(id));
    const refreshedMedia = await loadInventoryEntryMediaItems({
      inventoryItemIds,
      storeId: seller.store_id,
    });

    if ("items" in refreshedMedia) setEntryMediaItems(refreshedMedia.items);
  }

  function handleSavedEntryPhotosChanged() {
    setHasUnsavedSavedEntryPhotoChanges(true);
    void reloadEntryPhotos();
  }

  function toggleOfferingExpanded(offeringId: string) {
    setGroupsReviewMode(false);
    setOfferings((currentOfferings) =>
      currentOfferings.map((offering) =>
        offering.id === offeringId
          ? { ...offering, expanded: !offering.expanded }
          : { ...offering, expanded: false },
      ),
    );
  }

  function addOffering() {
    const offeringId = createLocalOfferingId();

    setOfferings((currentOfferings) => [
      ...currentOfferings.map((offering) => ({
        ...offering,
        expanded: false,
      })),
      {
        ...createBlankOffering(offeringId),
        expanded: true,
      },
    ]);
    setGroupsReviewMode(false);
    setScrollToOfferingId(offeringId);
  }

  function finishAddingGroups() {
    setGroupsReviewMode(true);
    setOfferings((currentOfferings) =>
      pruneUntouchedOfferings(currentOfferings).map((offering) => ({
        ...offering,
        expanded: false,
      })),
    );
    window.setTimeout(() => {
      document
        .querySelector<HTMLElement>('[data-live-birds-section="price-changes"]')
        ?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 0);
  }

  function focusPublishValidationIssue(issue: PublishValidationIssue) {
    if (issue.target.type === "hatch") {
      const hatchField = issue.target.field;
      const focusHatchField = () => {
        const fieldSelector = `[data-live-birds-field="${hatchField}"]`;
        const field = Array.from(
          document.querySelectorAll<HTMLElement>(fieldSelector),
        ).find((candidate) => candidate.offsetParent !== null);

        field?.scrollIntoView({ block: "center", behavior: "smooth" });
        field?.focus({ preventScroll: true });
      };

      if (window.matchMedia("(min-width: 640px)").matches && !isEditMode) {
        setDesktopExpandedStep(1);
        window.setTimeout(focusHatchField, 0);
      } else {
        focusHatchField();
      }
      return;
    }

    setGroupsReviewMode(false);
    const offeringId = issue.target.offeringId;

    if (window.matchMedia("(min-width: 640px)").matches && !isEditMode) {
      setDesktopExpandedStep(2);
      setScrollToOfferingId(null);
      window.setTimeout(() => setScrollToOfferingId(offeringId), 0);
    } else {
      setScrollToOfferingId(offeringId);
    }

    setOfferings((currentOfferings) =>
      currentOfferings.map((offering) => ({
        ...offering,
        expanded: offering.id === offeringId,
      })),
    );
  }

  function updateBreedDescription(offeringId: string, description: string) {
    const changedOffering = offerings.find((offering) => offering.id === offeringId);

    if (!changedOffering) return;

    setOfferings((currentOfferings) =>
      currentOfferings.map((offering) => {
        const isSameBreedProfile =
          changedOffering.sellerBreedProfileId &&
          offering.sellerBreedProfileId === changedOffering.sellerBreedProfileId;
        const isSameCatalogBreed =
          !changedOffering.sellerBreedProfileId &&
          changedOffering.breedId &&
          offering.breedId === changedOffering.breedId;

        return offering.id === offeringId || isSameBreedProfile || isSameCatalogBreed
          ? { ...offering, description }
          : offering;
      }),
    );
  }

  function updatePriceAdjustment(updates: Partial<PriceAdjustmentState>) {
    setPriceAdjustment((current) => ({ ...current, ...updates }));
  }

  function removeOffering(offeringId: string) {
    const offering = offerings.find((item) => item.id === offeringId);

    if (isEditMode && offering?.inventoryItemId) {
      const index = offerings.findIndex((item) => item.id === offeringId);
      setPendingRemovedOfferings((current) => [
        ...current,
        { index, offering },
      ]);
    }

    clearPendingEntryPhoto(offeringId);
    setOfferings((currentOfferings) => {
      if (currentOfferings.length <= 1) return currentOfferings;

      const nextOfferings = currentOfferings.filter(
        (offering) => offering.id !== offeringId,
      );

      if (nextOfferings.some((offering) => offering.expanded)) {
        return nextOfferings;
      }

      if (groupsReviewMode) return nextOfferings;

      return nextOfferings.map((offering, index) => ({
        ...offering,
        expanded: index === 0,
      }));
    });
  }

  function undoPendingRemoval(offeringId: string) {
    const pending = pendingRemovedOfferings.find(
      ({ offering }) => offering.id === offeringId,
    );
    if (!pending) return;

    setOfferings((current) => {
      const next = [...current];
      next.splice(Math.min(pending.index, next.length), 0, pending.offering);
      return next;
    });
    setPendingRemovedOfferings((current) =>
      current.filter(({ offering }) => offering.id !== offeringId),
    );
  }

  function setPendingEntryPhoto(offeringId: string, file: File) {
    setPendingEntryPhotos((current) => {
      const previousPhoto = current[offeringId];
      if (previousPhoto) URL.revokeObjectURL(previousPhoto.previewUrl);
      return {
        ...current,
        [offeringId]: {
          error: null,
          file,
          previewUrl: URL.createObjectURL(file),
        },
      };
    });
  }

  function clearPendingEntryPhoto(offeringId: string) {
    setPendingEntryPhotos((current) => {
      const photo = current[offeringId];
      if (!photo) return current;
      URL.revokeObjectURL(photo.previewUrl);
      const remaining = { ...current };
      delete remaining[offeringId];
      return remaining;
    });
  }

  async function saveBreedDescriptionsToLibrary({
    offeringsToSave = offerings,
    storeId,
  }: {
    offeringsToSave?: BirdOffering[];
    storeId: string;
  }) {
    const descriptionsByProfileId = new Map<string, string>();

    offeringsToSave.forEach((offering) => {
      if (!offering.sellerBreedProfileId) return;

      if (!descriptionsByProfileId.has(offering.sellerBreedProfileId)) {
        descriptionsByProfileId.set(
          offering.sellerBreedProfileId,
          offering.description.trim(),
        );
      }
    });

    const profilesById = new Map(
      sellerBreedProfiles.map((profile) => [profile.id, profile] as const),
    );
    let nextProfiles = sellerBreedProfiles;

    for (const [profileId, nextDescription] of descriptionsByProfileId) {
      const profile = profilesById.get(profileId);

      if (!profile) {
        return {
          ok: false as const,
          message:
            "A breed description could not be saved because its personal breed profile was missing.",
        };
      }

      if ((profile.seller_description ?? "").trim() === nextDescription) {
        continue;
      }

      const { error } = await supabase.rpc("seller_upsert_breed_profile", {
        p_breed_id: profile.breed_id,
        p_custom_breed_name: profile.custom_breed_name,
        p_display_name: profile.display_name,
        p_annual_egg_production: profile.annual_egg_production,
        p_egg_color: profile.egg_color,
        p_seller_breed_profile_id: profile.id,
        p_seller_description: nextDescription || null,
        p_seller_notes: profile.seller_notes,
        p_species_id: profile.species_id,
        p_store_id: storeId,
        p_visibility_status: profile.visibility_status,
      });

      if (error) {
        return {
          ok: false as const,
          message: error.message,
        };
      }

      const updatedProfile = {
        ...profile,
        seller_description: nextDescription || null,
      };
      profilesById.set(profileId, updatedProfile);
      nextProfiles = upsertSellerBreedProfile(nextProfiles, updatedProfile);
    }

    if (nextProfiles !== sellerBreedProfiles) {
      setSellerBreedProfiles(nextProfiles);
    }

    return { ok: true as const };
  }

  async function savePriceAdjustmentForBatch(listingBatchId: string) {
    const effectivePriceAdjustment = plan.ageBasedPricingEnabled
      ? priceAdjustment
      : defaultPriceAdjustment;
    const { error } = await supabase.rpc(
      "seller_set_listing_batch_price_adjustment",
      {
        p_listing_batch_id: listingBatchId,
        p_auto_price_adjustment_enabled: effectivePriceAdjustment.enabled,
        p_price_adjustment_direction: effectivePriceAdjustment.enabled
          ? effectivePriceAdjustment.direction
          : null,
        p_price_adjustment_amount: effectivePriceAdjustment.enabled
          ? Number(effectivePriceAdjustment.amount)
          : null,
        p_price_adjustment_interval_weeks: effectivePriceAdjustment.enabled
          ? Number(effectivePriceAdjustment.intervalWeeks)
          : null,
        p_price_adjustment_max_price:
          effectivePriceAdjustment.enabled &&
          effectivePriceAdjustment.direction === "increase"
            ? Number(effectivePriceAdjustment.maxPrice)
            : null,
        p_price_adjustment_min_price:
          effectivePriceAdjustment.enabled &&
          effectivePriceAdjustment.direction === "decrease"
            ? Number(effectivePriceAdjustment.minPrice)
            : null,
      },
    );

    if (error) {
      return { ok: false as const, message: error.message };
    }

    return { ok: true as const };
  }

  async function createHiddenDraft({
    offeringsToSave = offerings,
    storeId,
  }: {
    offeringsToSave?: BirdOffering[];
    storeId: string;
  }): Promise<
    | {
        ok: true;
        inventoryIdentities: InventoryIdentityMap;
        listingBatchId: string;
      }
    | { ok: false; message: string }
  > {
    const payload = buildCreateLiveBirdsDraftPayload({
      availableDate,
      hatchDate,
      offerings: offeringsToSave,
      species,
      storeId,
    });

    if (!payload) {
      return { ok: false, message: "The draft payload could not be prepared." };
    }

    const descriptionResult = await saveBreedDescriptionsToLibrary({
      offeringsToSave,
      storeId,
    });

    if (!descriptionResult.ok) {
      return {
        ok: false,
        message: `Breed description could not be updated. ${descriptionResult.message}`,
      };
    }

    const createResult = await supabase.rpc(
      "seller_create_listing_batch_with_inventory",
      payload,
    );

    if (createResult.error) {
      return { ok: false, message: createResult.error.message };
    }

    const createdRows = Array.isArray(createResult.data)
      ? (createResult.data as CreateDraftResult[])
      : [];
    const createdDraft = createdRows[0];

    if (!createdDraft?.listing_batch_id) {
      return { ok: false, message: "The draft could not be created." };
    }

    const priceAdjustmentResult = await savePriceAdjustmentForBatch(
      createdDraft.listing_batch_id,
    );

    if (!priceAdjustmentResult.ok) {
      return {
        ok: false,
        message: `Draft was created, but age-based price changes could not be saved. ${priceAdjustmentResult.message}`,
      };
    }

    return {
      ok: true,
      inventoryIdentities: getCreationInventoryIdentityMap(
        createdDraft.breed_groups,
      ),
      listingBatchId: createdDraft.listing_batch_id,
    };
  }

  async function createPublishedListing({
    offeringsToSave,
    payload,
    storeId,
  }: {
    offeringsToSave: BirdOffering[];
    payload: CreateLiveBirdsPublishPayload;
    storeId: string;
  }): Promise<
    | {
        ok: true;
        inventoryIdentities: InventoryIdentityMap;
        listingBatchId: string;
      }
    | { ok: false; message: string }
  > {
    const descriptionResult = await saveBreedDescriptionsToLibrary({
      offeringsToSave,
      storeId,
    });

    if (!descriptionResult.ok) {
      return {
        ok: false,
        message: `Breed description could not be updated. ${descriptionResult.message}`,
      };
    }

    const createResult = await supabase.rpc(
      "seller_create_listing_batch_with_inventory",
      payload,
    );

    if (createResult.error) {
      return { ok: false, message: createResult.error.message };
    }

    const createdRows = Array.isArray(createResult.data)
      ? (createResult.data as CreateDraftResult[])
      : [];
    const createdListing = createdRows[0];

    if (!createdListing?.listing_batch_id) {
      return { ok: false, message: "The listing could not be created." };
    }

    const priceAdjustmentResult = await savePriceAdjustmentForBatch(
      createdListing.listing_batch_id,
    );

    if (!priceAdjustmentResult.ok) {
      return {
        ok: false,
        message: `The listing was published, but age-based price changes could not be saved. ${priceAdjustmentResult.message}`,
      };
    }

    return {
      ok: true,
      inventoryIdentities: getCreationInventoryIdentityMap(
        createdListing.breed_groups,
      ),
      listingBatchId: createdListing.listing_batch_id,
    };
  }

  async function preflightLiveBirdPublication({
    draftId,
    payload,
    storeId,
  }: {
    draftId: string | null;
    payload: CreateLiveBirdsPublishPayload;
    storeId: string;
  }): Promise<
    | { ok: true; allowance: LiveBirdPublishAllowance }
    | { ok: false; message: string }
  > {
    const result = await supabase.rpc("seller_preflight_live_bird_publication", {
      p_store_id: storeId,
      p_breed_groups: payload.p_breed_groups,
      p_excluded_listing_batch_id: draftId,
    });

    if (result.error) {
      return { ok: false, message: result.error.message };
    }

    const rows = Array.isArray(result.data)
      ? (result.data as LiveBirdPublishAllowance[])
      : [];
    const allowance = rows[0];

    if (!allowance) {
      return { ok: false, message: "The publication allowance could not be checked." };
    }

    return { ok: true, allowance };
  }

  async function updateHiddenDraft({
    draftId,
    offeringsToSave = offerings,
    storeId,
  }: {
    draftId: string;
    offeringsToSave?: BirdOffering[];
    storeId: string;
  }): Promise<
    | {
        ok: true;
        inventoryIdentities: InventoryIdentityMap;
        listingBatchId: string;
      }
    | { ok: false; message: string }
  > {
    const draftRowsResult = await loadListingRows({
      listingBatchId: draftId,
      mode: "create",
      storeId,
    });

    if ("error" in draftRowsResult) {
      return { ok: false, message: draftRowsResult.error };
    }

    const currentRows = draftRowsResult.rows;
    const currentSpeciesId = currentRows[0]?.species_id ?? null;

    if (!species.id || species.id !== currentSpeciesId) {
      return {
        ok: false,
        message: "Changing species on saved drafts is coming next.",
      };
    }

    const descriptionResult = await saveBreedDescriptionsToLibrary({
      offeringsToSave,
      storeId,
    });

    if (!descriptionResult.ok) {
      return {
        ok: false,
        message: `Breed description could not be updated. ${descriptionResult.message}`,
      };
    }

    const basePrice = getBasePriceForOfferings(offeringsToSave);
    const batchResult = await supabase.rpc("seller_update_listing_batch", {
      p_listing_batch_id: draftId,
      p_origin_date: hatchDate,
      p_available_date: availableDate,
      p_base_price: basePrice,
      p_auto_price_increase_enabled: false,
      p_auto_price_increase_amount: null,
      p_auto_price_increase_max_price: null,
      p_internal_batch_label: liveBirdsV2DraftMarker,
      p_seller_notes: null,
    });

    if (batchResult.error) {
      return { ok: false, message: batchResult.error.message };
    }

    const synced = await syncDraftOfferings({
      basePrice,
      currentRows,
      draftId,
      offerings: offeringsToSave,
    });

    if (!synced.ok) {
      return { ok: false, message: synced.message };
    }

    const priceAdjustmentResult = await savePriceAdjustmentForBatch(draftId);

    if (!priceAdjustmentResult.ok) {
      return {
        ok: false,
        message: `Age-based price changes could not be saved. ${priceAdjustmentResult.message}`,
      };
    }

    const refreshedRows = await loadListingRows({
      listingBatchId: draftId,
      mode: "create",
      storeId,
    });

    if ("rows" in refreshedRows) {
      const loadedOfferings = alignOfferingsToBreedOptions(
        getOfferingsFromDraftRows(refreshedRows.rows),
        breedOptions,
      );

      setOfferings(loadedOfferings);
      nextOfferingId.current = loadedOfferings.length + 1;
      setGroupsReviewMode(false);
      setHatchDate(refreshedRows.rows[0]?.origin_date ?? hatchDate);
      setAvailableDate(refreshedRows.rows[0]?.available_date ?? availableDate);
      setPriceAdjustment(hydratePriceAdjustment(refreshedRows.rows[0]));
    }

    return {
      ok: true,
      inventoryIdentities: synced.inventoryIdentities,
      listingBatchId: draftId,
    };
  }

  async function refreshEditListingState({
    storeId,
    updateSnapshot,
  }: {
    storeId: string;
    updateSnapshot: boolean;
  }) {
    if (!listingBatchId) return;

    const refreshedRows = await loadListingRows({
      listingBatchId,
      mode: "edit",
      storeId,
    });

    if ("error" in refreshedRows) {
      setDraftLoadError(refreshedRows.error);
      return false;
    }

    const loadedOfferings = alignOfferingsToBreedOptions(
      getOfferingsFromDraftRows(refreshedRows.rows),
      breedOptions,
    );
    const loadedHatchDate = refreshedRows.rows[0]?.origin_date ?? "";
    const loadedAvailableDate = refreshedRows.rows[0]?.available_date ?? "";
    const loadedPriceAdjustment = hydratePriceAdjustment(refreshedRows.rows[0]);
    const removalHistoryResult = await loadInventoryRemovalBlockedIds(
      refreshedRows.rows.map((row) => row.inventory_item_id),
    );

    setOfferings(loadedOfferings);
    setPendingRemovedOfferings([]);
    setEditBaseline({
      availableDate: loadedAvailableDate,
      hatchDate: loadedHatchDate,
      offerings: loadedOfferings,
      priceAdjustment: loadedPriceAdjustment,
    });
    setRemoveBlockedInventoryItemIds(removalHistoryResult.blockedIds);
    nextOfferingId.current = loadedOfferings.length + 1;
    setGroupsReviewMode(false);
    setHatchDate(loadedHatchDate);
    setAvailableDate(loadedAvailableDate);
    setPriceAdjustment(loadedPriceAdjustment);
    setLoadedDraftSpeciesId(refreshedRows.rows[0]?.species_id ?? null);

    if (updateSnapshot) {
      setSavedFormSnapshot(
        getLiveBirdsFormSnapshot({
          availableDate: loadedAvailableDate,
          hatchDate: loadedHatchDate,
          offerings: loadedOfferings,
          priceAdjustment: loadedPriceAdjustment,
          species,
        }),
      );
    }

    return true;
  }

  async function saveEditedListing({
    storeId,
  }: {
    storeId: string;
  }): Promise<
    | { ok: true; inventoryIdentities: InventoryIdentityMap }
    | { ok: false; message: string; shouldReloadListing?: boolean }
  > {
    if (!listingBatchId) {
      return { ok: false, message: "This listing could not be found." };
    }

    const blockingIssue = editSaveBlockingIssues[0];

    if (blockingIssue) {
      return { ok: false, message: blockingIssue };
    }

    const currentRowsResult = await loadListingRows({
      listingBatchId,
      mode: "edit",
      storeId,
    });

    if ("error" in currentRowsResult) {
      return { ok: false, message: currentRowsResult.error };
    }

    const currentRows = currentRowsResult.rows;
    const editValidationIssue = getEditCurrentRowsValidationIssue({
      currentRows,
      loadedSpeciesId: loadedDraftSpeciesId,
      offerings,
      pendingRemovalInventoryItemIds: pendingRemovedOfferings
        .map(({ offering }) => offering.inventoryItemId)
        .filter((value): value is string => Boolean(value)),
      speciesId: species.id,
      sellerBreedProfiles,
    });

    if (editValidationIssue) {
      return { ok: false, message: editValidationIssue };
    }

    const descriptionResult = await saveBreedDescriptionsToLibrary({ storeId });

    if (!descriptionResult.ok) {
      return {
        ok: false,
        message: `Breed description could not be updated. ${descriptionResult.message}`,
      };
    }

    const firstRow = currentRows[0];
    const basePrice = getBasePriceForOfferings(offerings);
    const batchResult = await supabase.rpc("seller_update_listing_batch", {
      p_listing_batch_id: listingBatchId,
      p_origin_date: hatchDate,
      p_available_date: availableDate,
      p_base_price: basePrice,
      p_auto_price_increase_enabled: false,
      p_auto_price_increase_amount: null,
      p_auto_price_increase_max_price: null,
      p_internal_batch_label: firstRow?.internal_batch_label ?? null,
      p_seller_notes: null,
    });

    if (batchResult.error) {
      return {
        ok: false,
        message: batchResult.error.message,
        shouldReloadListing: true,
      };
    }

    const priceAdjustmentResult = await savePriceAdjustmentForBatch(listingBatchId);

    if (!priceAdjustmentResult.ok) {
      return {
        ok: false,
        message: `Age-based price changes could not be saved. ${priceAdjustmentResult.message}`,
        shouldReloadListing: true,
      };
    }

    const syncResult = await syncExistingEditOfferings({
      basePrice,
      currentRows,
      listingBatchId,
      offerings,
    });

    if (!syncResult.ok) {
      return {
        ok: false,
        message: syncResult.message,
        shouldReloadListing: true,
      };
    }

    const inventoryItemIdsToDelete = pendingRemovedOfferings
      .map(({ offering }) => offering.inventoryItemId)
      .filter((value): value is string => Boolean(value));

    if (inventoryItemIdsToDelete.length > 0) {
      const deletionResult = await supabase.rpc("seller_delete_inventory_entries", {
        p_equipment_inventory_item_ids: [],
        p_inventory_item_ids: inventoryItemIdsToDelete,
      });

      if (deletionResult.error) {
        return {
          ok: false,
          message: `The other changes were saved, but the selected bird entry could not be permanently removed. ${deletionResult.error.message}`,
          shouldReloadListing: false,
        };
      }
    }

    return {
      ok: true,
      inventoryIdentities: syncResult.inventoryIdentities,
    };
  }

  async function saveCurrentHiddenDraft({
    draftId,
    offeringsToSave,
    storeId,
  }: {
    draftId: string | null;
    offeringsToSave: BirdOffering[];
    storeId: string;
  }) {
    return draftId
      ? updateHiddenDraft({ draftId, offeringsToSave, storeId })
      : createHiddenDraft({ offeringsToSave, storeId });
  }

  async function uploadPendingEntryPhotos({
    inventoryIdentities,
    offeringsToSave,
    storeId,
  }: {
    inventoryIdentities: InventoryIdentityMap;
    offeringsToSave: BirdOffering[];
    storeId: string;
  }) {
    const savedOfferings = applyInventoryIdentityMap(
      offeringsToSave,
      inventoryIdentities,
    );

    setOfferings(savedOfferings);
    const failedOfferingIds: string[] = [];
    let uploadedAtLeastOne = false;

    for (const offering of savedOfferings) {
      const pendingPhoto = pendingEntryPhotosRef.current[offering.id];
      if (!pendingPhoto) continue;

      if (!offering.inventoryItemId) {
        failedOfferingIds.push(offering.id);
        setPendingEntryPhotos((current) => ({
          ...current,
          [offering.id]: {
            ...current[offering.id],
            error: "This option was saved, but its inventory row could not be matched for photo upload.",
          },
        }));
        continue;
      }

      const uploadResult = await uploadSellerPhoto({
        entityId: offering.inventoryItemId,
        entityType: "inventory_item",
        file: pendingPhoto.file,
        isFeatured: true,
        sortOrder: 0,
        storeId,
      });

      if (!uploadResult.ok) {
        failedOfferingIds.push(offering.id);
        setPendingEntryPhotos((current) => ({
          ...current,
          [offering.id]: {
            ...current[offering.id],
            error: uploadResult.error.message,
          },
        }));
        continue;
      }

      clearPendingEntryPhoto(offering.id);
      uploadedAtLeastOne = true;
    }

    if (uploadedAtLeastOne) {
      await reloadEntryPhotos();
    }

    return { failedOfferingIds };
  }

  async function saveDraftFromCurrentForm({
    errorPrefix = "Draft could not be saved.",
  }: {
    errorPrefix?: string;
  } = {}) {
    if (
      !saveDraftPreflight.canSaveDraft ||
      saveDraftStatus === "saving" ||
      publishStatus === "publishing" ||
      (isLoadedDraft && saveDraftDisabledReason)
    ) {
      return {
        ok: false as const,
        message: saveDraftPreflight.blockingIssues[0] ?? "This draft is not ready to save yet.",
      };
    }

    if (!seller?.store_id) {
      setSaveDraftStatus("error");
      setSaveDraftMessage("The store context is missing. The draft was not saved.");
      return {
        ok: false as const,
        message: "The store context is missing. The draft was not saved.",
      };
    }

    const offeringsToSave = pruneUntouchedOfferings(offerings);

    if (offeringsToSave.length !== offerings.length) {
      const retainedOfferingIds = new Set(
        offeringsToSave.map((offering) => offering.id),
      );
      Object.keys(pendingEntryPhotosRef.current).forEach((offeringId) => {
        if (!retainedOfferingIds.has(offeringId)) clearPendingEntryPhoto(offeringId);
      });
      setOfferings(offeringsToSave);
    }

    setSaveDraftStatus("saving");
    setSaveDraftMessage(null);

    const saveResult = await saveCurrentHiddenDraft({
      draftId: currentSavedDraftId,
      offeringsToSave,
      storeId: seller.store_id,
    });

    if (!saveResult.ok) {
      setSaveDraftStatus("error");
      setSaveDraftMessage(
        `${errorPrefix} ${saveResult.message}`,
      );
      return {
        ok: false as const,
        message: saveResult.message,
      };
    }

    if (!currentSavedDraftId) {
      setSavedListingBatchId(saveResult.listingBatchId);
    }
    const pendingUploadResult = await uploadPendingEntryPhotos({
      inventoryIdentities: saveResult.inventoryIdentities,
      offeringsToSave,
      storeId: seller.store_id,
    });
    setSaveDraftStatus("success");
    setSaveDraftMessage(
      pendingUploadResult.failedOfferingIds.length > 0
        ? `Draft saved. ${pendingUploadResult.failedOfferingIds.length} option photo${pendingUploadResult.failedOfferingIds.length === 1 ? " needs" : "s need"} attention; retry it from the matching bird entry.`
        : "Draft saved. You can find it in Saved drafts at the bottom of the Add Inventory page until it is published.",
    );

    setSavedFormSnapshot(
      getLiveBirdsFormSnapshot({
        availableDate,
        hatchDate,
        offerings: offeringsToSave,
        priceAdjustment: plan.ageBasedPricingEnabled
          ? priceAdjustment
          : defaultPriceAdjustment,
        species,
      }),
    );

    return {
      ok: true as const,
      listingBatchId: saveResult.listingBatchId,
    };
  }

  async function handleSaveDraft() {
    await saveDraftFromCurrentForm({
      errorPrefix: `Draft could not be ${currentSavedDraftId ? "updated" : "saved"}.`,
    });
  }

  async function handleSaveEdit() {
    if (editSaveDisabledReason || editSaveStatus === "saving") return;

    if (!seller?.store_id) {
      setEditSaveStatus("error");
      setEditSaveMessage("The store context is missing. Changes were not saved.");
      return;
    }

    setEditSaveStatus("saving");
    setEditSaveMessage(null);

    const saveResult = await saveEditedListing({ storeId: seller.store_id });

    if (!saveResult.ok) {
      if (saveResult.shouldReloadListing) {
        await refreshEditListingState({
          storeId: seller.store_id,
          updateSnapshot: false,
        });
      }

      setEditSaveStatus("error");
      setEditSaveMessage(`Changes could not be saved. ${saveResult.message}`);
      return;
    }

    const pendingUploadResult = await uploadPendingEntryPhotos({
      inventoryIdentities: saveResult.inventoryIdentities,
      offeringsToSave: offerings,
      storeId: seller.store_id,
    });

    if (pendingUploadResult.failedOfferingIds.length === 0) {
      Object.values(pendingEntryPhotosRef.current).forEach((photo) => {
        URL.revokeObjectURL(photo.previewUrl);
      });
      pendingEntryPhotosRef.current = {};
      setPendingEntryPhotos({});
    }

    const refreshSucceeded = await refreshEditListingState({
      storeId: seller.store_id,
      updateSnapshot: true,
    });
    if (!refreshSucceeded) {
      setEditSaveStatus("error");
      setEditSaveMessage(
        "Changes were saved, but the refreshed listing could not be loaded. Reload this page before editing again.",
      );
      return;
    }
    setHasUnsavedSavedEntryPhotoChanges(false);
    setEditSaveStatus("success");
    setEditSaveMessage(
      pendingUploadResult.failedOfferingIds.length > 0
        ? `Changes saved. ${pendingUploadResult.failedOfferingIds.length} option photo${pendingUploadResult.failedOfferingIds.length === 1 ? " needs" : "s need"} attention; retry it from the matching bird entry.`
        : "Changes saved",
    );
  }

  function undoEditChanges() {
    if (!editBaseline || editSaveStatus === "saving") return;

    Object.values(pendingEntryPhotosRef.current).forEach((photo) => {
      URL.revokeObjectURL(photo.previewUrl);
    });
    pendingEntryPhotosRef.current = {};
    setPendingEntryPhotos({});
    setOfferings(editBaseline.offerings);
    setPendingRemovedOfferings([]);
    setHatchDate(editBaseline.hatchDate);
    setAvailableDate(editBaseline.availableDate);
    setPriceAdjustment(editBaseline.priceAdjustment);
    nextOfferingId.current = editBaseline.offerings.length + 1;
    setGroupsReviewMode(false);
    setHasUnsavedSavedEntryPhotoChanges(false);
    setSavedFormSnapshot(
      getLiveBirdsFormSnapshot({
        availableDate: editBaseline.availableDate,
        hatchDate: editBaseline.hatchDate,
        offerings: editBaseline.offerings,
        priceAdjustment: editBaseline.priceAdjustment,
        species,
      }),
    );
    setEditSaveStatus("idle");
    setEditSaveMessage(null);
    setFormResetKey((current) => current + 1);
  }

  async function handleReviewPublish() {
    if (
      publishDisabledReason ||
      publishStatus === "publishing" ||
      publishStatus === "success" ||
      publishSuccessDialog ||
      saveDraftStatus === "saving"
    ) {
      return;
    }

    if (!seller?.store_id) {
      setPublishStatus("error");
      setPublishMessage("The store context is missing. Nothing was published.");
      return;
    }

    const offeringsToSave = pruneUntouchedOfferings(offerings);

    if (offeringsToSave.length !== offerings.length) {
      const retainedOfferingIds = new Set(
        offeringsToSave.map((offering) => offering.id),
      );
      Object.keys(pendingEntryPhotosRef.current).forEach((offeringId) => {
        if (!retainedOfferingIds.has(offeringId)) clearPendingEntryPhoto(offeringId);
      });
      setOfferings(offeringsToSave);
    }

    setPublishStatus("publishing");
    setPublishMessage(null);
    setSaveDraftMessage(null);

    const publishPayload = buildCreateLiveBirdsPublishPayload({
      availableDate,
      hatchDate,
      offerings: offeringsToSave,
      species,
      storeId: seller.store_id,
    });

    if (!publishPayload) {
      setPublishStatus("error");
      setPublishMessage("Inventory could not be published. The listing payload could not be prepared.");
      return;
    }

    const preflightResult = await preflightLiveBirdPublication({
      draftId: currentSavedDraftId,
      payload: publishPayload,
      storeId: seller.store_id,
    });

    if (!preflightResult.ok) {
      setPublishStatus("error");
      setPublishMessage(`Inventory could not be published. ${preflightResult.message}`);
      return;
    }

    if (preflightResult.allowance.can_publish === false) {
      setPublishStatus("error");
      setPublishMessage(formatCoopAllowanceMessage(preflightResult.allowance));
      return;
    }

    let publishedListingBatchId: string;
    let publishedInventoryIdentities: InventoryIdentityMap = {};

    if (currentSavedDraftId) {
      const saveResult = await saveCurrentHiddenDraft({
        draftId: currentSavedDraftId,
        offeringsToSave,
        storeId: seller.store_id,
      });

      if (!saveResult.ok) {
        setPublishStatus("error");
        setPublishMessage(`Draft could not be published. ${saveResult.message}`);
        return;
      }

      const publishResult = await supabase.rpc("seller_publish_live_bird_draft", {
        p_listing_batch_id: saveResult.listingBatchId,
      });

      if (publishResult.error) {
        setPublishStatus("error");
        setPublishMessage(`Draft could not be published. ${publishResult.error.message}`);
        return;
      }

      const publishRows = Array.isArray(publishResult.data)
        ? (publishResult.data as LiveBirdPublishAllowance[])
        : [];
      const publication = publishRows[0];

      if (!publication?.published) {
        setPublishStatus("error");
        setPublishMessage(
          publication
            ? formatCoopAllowanceMessage(publication)
            : "Draft could not be published. The publication result was unavailable.",
        );
        return;
      }

      publishedListingBatchId =
        publication.listing_batch_id ?? saveResult.listingBatchId;
      publishedInventoryIdentities = saveResult.inventoryIdentities;
    } else {
      const createResult = await createPublishedListing({
        offeringsToSave,
        payload: publishPayload,
        storeId: seller.store_id,
      });

      if (!createResult.ok) {
        let allowanceMessage: string | null = null;

        if (isCoopAllowanceDatabaseError(createResult.message)) {
          const refreshedPreflight = await preflightLiveBirdPublication({
            draftId: null,
            payload: publishPayload,
            storeId: seller.store_id,
          });

          allowanceMessage = formatCoopAllowanceMessage(
            refreshedPreflight.ok
              ? refreshedPreflight.allowance
              : preflightResult.allowance,
          );
        }

        setPublishStatus("error");
        setPublishMessage(
          allowanceMessage ??
            `Inventory could not be published. ${createResult.message}`,
        );
        return;
      }

      publishedListingBatchId = createResult.listingBatchId;
      publishedInventoryIdentities = createResult.inventoryIdentities;
    }

    const pendingUploadResult = await uploadPendingEntryPhotos({
      inventoryIdentities: publishedInventoryIdentities,
      offeringsToSave,
      storeId: seller.store_id,
    });

    const shareProductsResult = await loadLivePoultryShareProducts({
      listingBatchId: publishedListingBatchId,
      storeId: seller.store_id,
      storeName: seller.store_name,
      storeSlug: seller.store_slug,
    });
    const shareProducts = shareProductsResult.ok
      ? shareProductsResult.products
      : [];

    if (!shareProductsResult.ok) {
      console.error("Live poultry share products could not be loaded", {
        listingBatchId: publishedListingBatchId,
        message: shareProductsResult.message,
      });
    }

    setPublishedListingBatchId(publishedListingBatchId);
    setPublishStatus("success");
    setPublishMessage(
      pendingUploadResult.failedOfferingIds.length > 0
        ? `Published to storefront. ${pendingUploadResult.failedOfferingIds.length} option photo${pendingUploadResult.failedOfferingIds.length === 1 ? " needs" : "s need"} attention; retry it from the matching bird entry.`
        : "Published to storefront.",
    );
    if (!isEditMode) {
      playDustySuccessSound();
    }
    setSaveDraftMessage(null);
    setSavedFormSnapshot(currentFormSnapshot);
    setPublishSuccessDialog({
      products:
        shareProducts.length > 0
          ? shareProducts
          : [buildFallbackLivePoultryShareProduct(publishedListingBatchId)],
    });
  }

  function navigateToInventoryAfterPublish() {
    if (isNavigatingAfterPublishRef.current) return;

    isNavigatingAfterPublishRef.current = true;
    setPublishSuccessDialog(null);
    router.push("/dashboard/inventory?tab=live_poultry");
  }

  function backToInventory() {
    if (
      hasMeaningfulUnsavedChanges &&
      !window.confirm("Leave without saving this Live Birds listing?")
    ) {
      return;
    }

    router.push("/dashboard/inventory?tab=live_poultry");
  }

  async function openLivePoultryShareDialog() {
    if (!seller?.store_id || !draftId || isResolvingShareProducts) return;

    setShareDialogProducts([]);
    setIsShareDialogOpen(false);
    setIsResolvingShareProducts(true);
    setEditSaveMessage(null);

    const result = await loadLivePoultryShareProducts({
      listingBatchId: draftId,
      storeId: seller.store_id,
      storeName: seller.store_name,
      storeSlug: seller.store_slug,
    });

    setIsResolvingShareProducts(false);

    if (!result.ok) {
      setEditSaveStatus("error");
      setEditSaveMessage(`Share links could not be loaded. ${result.message}`);
      return;
    }

    setShareDialogProducts(
      result.products.length > 0
        ? result.products
        : [buildFallbackLivePoultryShareProduct(draftId)],
    );
    setIsShareDialogOpen(true);
  }

  function resetNewFormState({
    replaceUrl = true,
  }: {
    replaceUrl?: boolean;
  } = {}) {
    const nextSpecies = getBlankSpeciesOption();
    const nextBreedOptions = getBreedOptionsForSpecies({
      catalogBreeds,
      mediaItems: breedMediaItems,
      sellerBreedProfiles,
      species: nextSpecies,
    });

    setSpecies(nextSpecies);
    setLoadedDraftId(null);
    setLoadedDraftSpeciesId(null);
    setHatchDate("");
    const todayDate = getTodayDateInputValue();

    setAvailableDate(todayDate);
    const nextOfferings = alignOfferingsToBreedOptions(
      initialOfferings,
      nextBreedOptions,
    );
    setOfferings(nextOfferings);
    nextOfferingId.current = initialOfferings.length + 1;
    setGroupsReviewMode(false);
    setMobileActiveStep(1);
    setDesktopExpandedStep(1);
    setHighestUnlockedDesktopStep(1);
    setPriceAdjustment(defaultPriceAdjustment);
    setBreedPhotoActionMessage(null);
    setSaveDraftMessage(null);
    setSaveDraftStatus("idle");
    setPublishMessage(null);
    setPublishStatus("idle");
    setPublishSuccessDialog(null);
    isNavigatingAfterPublishRef.current = false;
    setPublishedListingBatchId(null);
    setSavedListingBatchId(null);
    setPendingNavigationHref(null);
    setNavigationSaveMessage(null);
    setSavedFormSnapshot(getLiveBirdsFormSnapshot({
      availableDate: todayDate,
      hatchDate: "",
      offerings: nextOfferings,
      priceAdjustment: defaultPriceAdjustment,
      species: nextSpecies,
    }));
    setFormResetKey((current) => current + 1);

    if (replaceUrl) {
      router.replace("/dashboard/inventory/add-v2/live-birds");
    }
  }

  function confirmStartOver() {
    setIsStartOverDialogOpen(false);

    if (draftId) {
      router.push("/dashboard/inventory/add-v2");
      return;
    }

    resetNewFormState();
  }

  function leavePendingNavigationWithoutSaving() {
    const nextHref = pendingNavigationHref;

    if (!nextHref) return;

    resetNewFormState({ replaceUrl: false });
    setPendingNavigationHref(null);
    router.push(nextHref);
  }

  async function saveDraftThenContinuePendingNavigation() {
    if (!pendingNavigationHref) return;

    setNavigationSaveMessage(null);
    const result = await saveDraftFromCurrentForm();

    if (!result.ok) {
      setNavigationSaveMessage(`Draft could not be saved. ${result.message}`);
      return;
    }

    const nextHref = pendingNavigationHref;
    setPendingNavigationHref(null);
    router.push(nextHref);
  }

  return (
    <>
    <MobileLiveBirdsTaskHeader
      currentStep={visibleMobileActiveStep}
      disabled={Boolean(saveDraftDisabledReason) || saveDraftStatus === "saving"}
      highestUnlockedStep={mobileStepProgression.highestUnlockedStep}
      isEditMode={isEditMode}
      onSaveDraft={handleSaveDraft}
      onStartOver={() => setIsStartOverDialogOpen(true)}
      saveDraftStatus={saveDraftStatus}
    />
    <DashboardPageContent
      className={`bg-stone-50/60 max-sm:px-4 max-sm:py-5 ${
        isEditMode && hasMeaningfulUnsavedChanges
          ? "pb-32 sm:pb-28"
          : "max-sm:pb-24"
      }`}
    >
      <div className="mx-auto w-full max-w-[1150px]">
        <header className="mb-5 max-sm:hidden">
          <Link
            className="inline-flex min-h-11 items-center text-base font-bold text-emerald-800 underline-offset-4 hover:underline sm:min-h-0 sm:text-sm sm:font-semibold"
            href={
              isEditMode
                ? "/dashboard/inventory?tab=live_poultry"
                : "/dashboard/inventory/add-v2"
            }
            onClick={(event) => {
              if (!isEditMode || !hasMeaningfulUnsavedChanges) return;
              if (window.confirm("Leave without saving this Live Birds listing?")) return;
              event.preventDefault();
            }}
          >
            {isEditMode ? "Inventory" : "Inventory / Add Inventory"}
          </Link>
          <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 lg:flex-1">
              <h1 className="text-3xl font-semibold text-stone-950">
                {isEditMode ? "Edit Live Birds Listing" : "Add Live Birds"}
              </h1>
              <p className="mt-2 max-w-3xl text-base leading-7 text-stone-600">
                {isEditMode
                  ? "Update your listing details below. Each time you save, your storefront listing updates automatically. When you’re finished, click Return to Inventory."
                  : "Tell us when these birds hatched so FlockFront can keep track of their age and update your listings automatically as they get older. Then add the birds you’re selling. Make a separate entry whenever the breed, sex/type, quantity, or price is different."}
              </p>
              {!isEditMode && isLoadedDraft ? (
                <p className="mt-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-base font-semibold leading-7 text-sky-800">
                  {isPublished
                    ? "Published to storefront."
                    : "Draft loaded. Save draft updates this saved draft."}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap lg:shrink-0">
              {isEditMode ? (
                <>
                  <button
                    className="inline-flex min-h-12 items-center rounded-md border border-stone-300 bg-white px-3 text-base font-bold text-stone-700 shadow-sm transition hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:ring-offset-2 sm:min-h-9 sm:text-sm sm:font-semibold"
                    type="button"
                    onClick={backToInventory}
                  >
                    Return to Inventory
                  </button>
                  <button
                    className="inline-flex min-h-12 items-center rounded-md bg-emerald-800 px-4 text-base font-bold text-white shadow-sm transition hover:bg-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-emerald-800/45 sm:min-h-9 sm:text-sm sm:font-semibold"
                    disabled={Boolean(editSaveDisabledReason)}
                    type="button"
                    onClick={handleSaveEdit}
                  >
                    {editSaveStatus === "saving" ? "Saving..." : "Save Changes"}
                  </button>
                </>
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
                  isEditMode && hasMeaningfulUnsavedChanges
                    ? "border-amber-200 bg-amber-50 text-amber-800"
                    : isEditMode
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : isPublished
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : hasSavedDraft && !hasMeaningfulUnsavedChanges
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-amber-200 bg-amber-50 text-amber-800"
                }`}
              >
                {isEditMode
                  ? hasMeaningfulUnsavedChanges
                    ? `${editChangeSummaries.length || 1} unsaved change${editChangeSummaries.length === 1 ? "" : "s"}`
                    : "Changes saved"
                  : isPublished
                    ? "Published"
                    : hasSavedDraft
                      ? hasMeaningfulUnsavedChanges
                        ? "Unsaved changes"
                        : "Draft saved"
                      : "Draft not saved yet"}
              </span>
            </div>
          </div>
        </header>

        {!isEditMode ? <BatchAddEntryPoint /> : null}

        {draftLoading ? (
          <div className="rounded-xl border border-transparent bg-white px-5 py-8 text-base font-semibold text-stone-600 shadow-none sm:rounded-lg sm:border-stone-200 sm:shadow-sm">
            {isEditMode ? "Loading Live Birds listing..." : "Loading saved draft..."}
          </div>
        ) : draftLoadError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-5 py-5 shadow-sm">
            <h2 className="text-base font-semibold text-red-950">
              {isEditMode
                ? "Live Birds listing could not be loaded"
                : "Draft could not be loaded"}
            </h2>
            <p className="mt-2 text-base leading-7 text-red-800">
              {draftLoadError}
            </p>
          </div>
        ) : (
          <div
            className="w-full"
            key={formResetKey}
          >
            <div className="sm:grid sm:grid-cols-[11.25rem_minmax(0,1fr)] sm:items-start sm:gap-0 lg:grid-cols-[12.25rem_minmax(0,1fr)]">
              <DesktopLiveBirdsStepNav
                activeStep={desktopExpandedStep ?? 1}
                highestUnlockedStep={highestUnlockedDesktopStep}
                mode={mode}
                onStepSelect={setDesktopExpandedStep}
              />
              <main
                className="min-w-0 max-sm:space-y-3 sm:-ml-px sm:space-y-0"
              >
              <HatchInformationCard
                ageAtAvailability={ageAtAvailability}
                availableDate={availableDate}
                desktopActive={desktopExpandedStep === 1}
                desktopPanelMode
                hatchDate={hatchDate}
                ageContext={
                  isEditMode ? (
                    <EditAgeContext
                      availableDate={availableDate}
                      baselineHatchDate={editBaseline?.hatchDate ?? hatchDate}
                      hatchDate={hatchDate}
                    />
                  ) : undefined
                }
                referenceError={referenceDataError}
                referenceLoading={referenceDataLoading}
                species={species}
                setAvailableDate={updateAvailableDate}
                setHatchDate={updateHatchDate}
                setSpecies={selectSpecies}
                speciesReadOnly={isEditMode}
                speciesOptions={speciesOptions}
                usingFallbackSpecies={usingFallbackSpecies}
                availableDateHelpText={
                  isEditMode
                    ? "This available date applies to every bird entry in this listing."
                    : undefined
                }
                introText={
                  isEditMode
                    ? "Use a separate listing for birds with a different hatch date."
                    : undefined
                }
                mobileActive={visibleMobileActiveStep === 1}
                onDesktopContinue={() => {
                  setHighestUnlockedDesktopStep((currentStep) =>
                    currentStep < 2 ? 2 : currentStep,
                  );
                  setDesktopExpandedStep(2);
                }}
                onMobileContinue={() => {
                  if (mobileStepProgression.highestUnlockedStep >= 2) {
                    setMobileActiveStep(2);
                  }
                }}
                onMobileOpen={() => setMobileActiveStep(1)}
                onDesktopOpen={() =>
                  setDesktopExpandedStep((currentStep) =>
                    currentStep === 1 ? null : 1,
                  )
                }
              />
              <BirdOfferingsCard
                addOffering={addOffering}
                breedMediaItemsByProfileId={breedMediaItemsByProfileId}
                entryMediaItemsByInventoryItemId={groupEntryMediaByInventoryItemId(entryMediaItems)}
                editCurrentAgeLabel={editCurrentAgeLabel}
                editPriceSummariesByOfferingId={editPriceSummariesByOfferingId}
                breedOptions={breedOptions}
                breedOptionsMessage={breedOptionsMessage}
                canAddCustomBreed={Boolean(species.id)}
                desktopActive={desktopExpandedStep === 2}
                desktopDisabled={highestUnlockedDesktopStep < 2}
                desktopPanelMode
                groupsReviewMode={groupsReviewMode}
                mobileActive={visibleMobileActiveStep === 2}
                offerings={offerings}
                onDoneAddingGroups={() => {
                  if (!mobileStepProgression.step2Complete) {
                    setShowBirdsForSaleCompletionError(true);
                    return;
                  }

                  setShowBirdsForSaleCompletionError(false);
                  finishAddingGroups();
                  setMobileActiveStep(3);
                  setDesktopExpandedStep(3);
                  setHighestUnlockedDesktopStep((currentStep) =>
                    currentStep < 3 ? 3 : currentStep,
                  );
                }}
                onDesktopOpen={() => {
                  setGroupsReviewMode(false);
                  setDesktopExpandedStep((currentStep) =>
                    currentStep === 2 ? null : 2,
                  );
                }}
                onMobileOpen={() => {
                  if (mobileStepProgression.highestUnlockedStep < 2) return;

                  setGroupsReviewMode(false);
                  setMobileActiveStep(2);
                }}
                onOpenCustomBreedModal={openCustomBreedModal}
                prepareBreedPhotoProfile={(offeringId) =>
                  void prepareBreedPhotoProfile(offeringId)
                }
                removeOffering={removeOffering}
                scrollToOfferingId={scrollToOfferingId}
                storeId={seller?.store_id ?? ""}
                stepLocked={mobileStepProgression.highestUnlockedStep < 2}
                completionErrorMessage={
                  showBirdsForSaleCompletionError &&
                  !mobileStepProgression.step2Complete
                    ? birdsForSaleCompletionErrorMessage
                    : null
                }
                toggleOfferingExpanded={toggleOfferingExpanded}
                updateBreedDescription={updateBreedDescription}
                updateOffering={updateOffering}
                updateOfferingBreed={updateOfferingBreed}
                onBreedPhotosChanged={() => void reloadBreedPhotos()}
                onEntryPhotosChanged={handleSavedEntryPhotosChanged}
                onPendingEntryPhotoChange={setPendingEntryPhoto}
                onPendingEntryPhotoRemove={clearPendingEntryPhoto}
                pendingEntryPhotosByOfferingId={pendingEntryPhotos}
                pendingRemovedOfferings={pendingRemovedOfferings}
                removeBlockedInventoryItemIds={removeBlockedInventoryItemIds}
                undoPendingRemoval={undoPendingRemoval}
                planKey={seller?.plan_key}
                mode={mode}
              />
              {breedPhotoActionMessage ? (
                <p
                  className={`rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-base font-semibold leading-7 text-emerald-900 ${
                    !isEditMode && desktopExpandedStep !== 2 ? "sm:hidden" : ""
                  }`}
                >
                  {breedPhotoActionMessage}
                </p>
              ) : null}
              <div data-live-birds-section="price-changes">
                <AgeBasedPriceChangesCard
                  offerings={offerings}
                  priceAdjustment={priceAdjustment}
                  availableDate={availableDate}
                  desktopActive={desktopExpandedStep === 3}
                  desktopComplete={highestUnlockedDesktopStep === 4}
                  desktopDisabled={highestUnlockedDesktopStep < 3}
                  desktopPanelMode
                  locked={!plan.ageBasedPricingEnabled}
                  mobileActive={visibleMobileActiveStep === 3}
                  onDesktopContinue={() => {
                    if (isEditMode) {
                      setDesktopExpandedStep(1);
                      return;
                    }

                    setDesktopExpandedStep(4);
                    setHighestUnlockedDesktopStep(4);
                  }}
                  onMobileContinue={() => {
                    if (!mobileStepProgression.step3Complete) return;

                    setMobileActiveStep(4);
                    setDesktopExpandedStep(4);
                    setHighestUnlockedDesktopStep(4);
                  }}
                  onMobileOpen={() => {
                    if (mobileStepProgression.highestUnlockedStep >= 3) {
                      setMobileActiveStep(3);
                    }
                  }}
                  onDesktopOpen={() =>
                    setDesktopExpandedStep((currentStep) =>
                      currentStep === 3 ? null : 3,
                    )
                  }
                  stepLocked={mobileStepProgression.highestUnlockedStep < 3}
                  updatePriceAdjustment={updatePriceAdjustment}
                  introText={
                    isEditMode
                      ? "These price changes apply to this listing."
                      : undefined
                  }
                />
              </div>
              {isEditMode ? (
                <EditModeActionsCard
                  active={desktopExpandedStep === 4}
                  changes={editChangeSummaries}
                  disabledReason={editSaveDisabledReason}
                  isSharing={isResolvingShareProducts}
                  message={
                    hasMeaningfulUnsavedChanges &&
                    editSaveStatus === "success"
                      ? null
                      : editSaveMessage
                  }
                  onBack={backToInventory}
                  onSave={handleSaveEdit}
                  onShare={() => void openLivePoultryShareDialog()}
                  status={editSaveStatus}
                />
              ) : (
                <ReviewPublishCard
                  desktopActive={desktopExpandedStep === 4}
                  desktopDisabled={highestUnlockedDesktopStep < 4}
                  desktopListingSummary={
                    <BatchSummaryCard
                      ageAtAvailability={ageAtAvailability.message}
                      availableDate={availableDate}
                      hatchDate={hatchDate}
                      offerings={offerings}
                      priceAdjustment={priceAdjustment}
                    />
                  }
                  desktopPanelMode
                  mobileActive={visibleMobileActiveStep === 4}
                  onMobileOpen={() => {
                    if (mobileStepProgression.highestUnlockedStep >= 4) {
                      setMobileActiveStep(4);
                    }
                  }}
                  onValidationIssueClick={focusPublishValidationIssue}
                  onSaveDraft={handleSaveDraft}
                  onReviewPublish={handleReviewPublish}
                  publishDisabledReason={publishDisabledReason}
                  publishMessage={publishMessage}
                  publishStatus={publishStatus}
                  saveDraftMessage={saveDraftMessage}
                  saveDraftDisabledReason={saveDraftDisabledReason}
                  saveDraftPreflight={saveDraftPreflight}
                  saveDraftStatus={saveDraftStatus}
                  stepLocked={mobileStepProgression.highestUnlockedStep < 4}
                  validationIssues={publishValidationIssues}
                />
              )}
              {showDeveloperSavePreview ? (
                <SavePreviewCard payloadPreview={savePayloadPreview} />
              ) : null}
              {!isEditMode && visibleMobileActiveStep === 4 ? (
                <div className="flex items-center gap-4 rounded-2xl bg-white px-4 py-5 shadow-sm sm:hidden">
                  <MobileLiveBirdsArtwork
                    className="h-20 w-24 rounded-xl opacity-80"
                    name="nest"
                  />
                  <div className="min-w-0">
                    <p className="text-xl font-bold text-stone-950">Almost there!</p>
                    <p className="mt-1 text-base leading-6 text-stone-600">
                      Once published, your birds will appear in your storefront
                      inventory.
                    </p>
                  </div>
                </div>
              ) : null}
              </main>
            </div>
          </div>
        )}
      </div>
      {customBreedOfferingId ? (
        <CustomBreedDialog
          duplicateBreed={customBreedDuplicate}
          draft={customBreedDraft}
          error={customBreedError}
          inputRef={customBreedInputRef}
          saving={customBreedSaving}
          species={customBreedSpecies}
          onCancel={closeCustomBreedModal}
          onDraftChange={updateCustomBreedDraft}
          onSubmit={() => void submitCustomBreed()}
          onUseExisting={useDuplicateCustomBreed}
        />
      ) : null}
      {!isEditMode && isStartOverDialogOpen ? (
        <StartOverDialog
          onCancel={() => setIsStartOverDialogOpen(false)}
          onConfirm={confirmStartOver}
        />
      ) : null}
      {pendingSpeciesChange ? (
        <SpeciesChangeWarningDialog
          nextSpeciesLabel={pendingSpeciesChange.label}
          onCancel={() => setPendingSpeciesChange(null)}
          onConfirm={confirmSpeciesChange}
        />
      ) : null}
      {!isEditMode && pendingNavigationHref ? (
        <UnsavedNavigationDialog
          canSaveDraft={saveDraftPreflight.canSaveDraft}
          message={navigationSaveMessage}
          saving={saveDraftStatus === "saving"}
          onKeepEditing={() => {
            setNavigationSaveMessage(null);
            setPendingNavigationHref(null);
          }}
          onLeaveWithoutSaving={leavePendingNavigationWithoutSaving}
          onSaveDraft={saveDraftThenContinuePendingNavigation}
        />
      ) : null}
      {publishSuccessDialog ? (
        publishSuccessDialog.products.length > 1 ? (
          <ListingShareMultiDialog
            isStorePublic={Boolean(seller?.is_publicly_available)}
            items={publishSuccessDialog.products}
            open
            storeName={seller?.store_name ?? "your store"}
            onClose={navigateToInventoryAfterPublish}
            onDone={navigateToInventoryAfterPublish}
          />
        ) : (
          <ListingShareDialog
            isStorePublic={Boolean(seller?.is_publicly_available)}
            listingTitle={
              publishSuccessDialog.products[0]?.title ?? "Live poultry listing"
            }
            mode="published"
            open
            publicPath={publishSuccessDialog.products[0]?.publicPath}
            shareText={publishSuccessDialog.products[0]?.shareText}
            storeName={seller?.store_name ?? "your store"}
            summary={publishSuccessDialog.products[0]?.summary}
            onClose={navigateToInventoryAfterPublish}
            onDone={navigateToInventoryAfterPublish}
          />
        )
      ) : null}
      {shareDialogProducts.length > 0 ? (
        shareDialogProducts.length > 1 ? (
          <ListingShareMultiDialog
            isStorePublic={Boolean(seller?.is_publicly_available)}
            items={shareDialogProducts}
            mode="share"
            open={isShareDialogOpen}
            storeName={seller?.store_name ?? "your store"}
            onClose={() => setIsShareDialogOpen(false)}
          />
        ) : (
          <ListingShareDialog
            isStorePublic={Boolean(seller?.is_publicly_available)}
            listingTitle={shareDialogProducts[0]?.title ?? "Live poultry listing"}
            mode="share"
            open={isShareDialogOpen}
            publicPath={shareDialogProducts[0]?.publicPath}
            shareText={shareDialogProducts[0]?.shareText}
            storeName={seller?.store_name ?? "your store"}
            summary={shareDialogProducts[0]?.summary}
            onClose={() => setIsShareDialogOpen(false)}
          />
        )
      ) : null}
    </DashboardPageContent>
    {isEditMode && hasMeaningfulUnsavedChanges ? (
      <EditStickySaveBar
        changedCount={editChangeSummaries.length || 1}
        disabledReason={editSaveDisabledReason}
        isSaving={editSaveStatus === "saving"}
        onSave={handleSaveEdit}
        onUndo={undoEditChanges}
      />
    ) : null}
    </>
  );
}

function BatchAddEntryPoint() {
  return (
    <aside className="mb-5 flex flex-col gap-3 rounded-lg border border-emerald-900/10 bg-emerald-50/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm font-semibold leading-6 text-stone-700">
        Adding several breeds or hatch dates? Enter them together in Batch Add.
      </p>
      <Link
        className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-emerald-800/25 bg-white px-4 text-sm font-bold text-emerald-900 shadow-sm transition hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:ring-offset-2 sm:min-h-9"
        href="/dashboard/inventory/add-v2/live-birds/batch"
      >
        Batch Add Live Birds
      </Link>
    </aside>
  );
}

function EditStickySaveBar({
  changedCount,
  disabledReason,
  isSaving,
  onSave,
  onUndo,
}: {
  changedCount: number;
  disabledReason: string | null;
  isSaving: boolean;
  onSave: () => void;
  onUndo: () => void;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-amber-200 bg-white/95 px-4 py-3 shadow-[0_-10px_30px_rgba(0,0,0,0.12)] backdrop-blur">
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-base font-bold text-stone-950 sm:text-sm">
          Unsaved changes
          <span className="ml-2 font-semibold text-stone-600">
            {changedCount} change{changedCount === 1 ? "" : "s"}
          </span>
        </p>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
          <button
            className="seller-secondary-button"
            disabled={isSaving}
            type="button"
            onClick={onUndo}
          >
            Undo Changes
          </button>
          <button
            className="seller-primary-button"
            disabled={Boolean(disabledReason) || isSaving}
            title={disabledReason ?? undefined}
            type="button"
            onClick={onSave}
          >
            {isSaving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function MobileLiveBirdsTaskHeader({
  currentStep,
  disabled,
  highestUnlockedStep,
  isEditMode,
  onSaveDraft,
  onStartOver,
  saveDraftStatus,
}: {
  currentStep: 1 | 2 | 3 | 4;
  disabled: boolean;
  highestUnlockedStep: 1 | 2 | 3 | 4;
  isEditMode: boolean;
  onSaveDraft: () => void;
  onStartOver: () => void;
  saveDraftStatus: SaveDraftStatus;
}) {
  if (isEditMode) return null;

  return (
    <header className="sticky top-0 z-40 border-b border-stone-200/80 bg-white pt-[env(safe-area-inset-top)] shadow-[0_1px_8px_rgba(67,55,38,0.06)] sm:hidden">
      <div className="grid min-h-13 grid-cols-[2.5rem_1fr_3.5rem] items-center gap-1 px-3">
        <Link
          aria-label="Back to inventory"
          className="inline-flex size-9 items-center justify-start text-2xl text-stone-950"
          href="/dashboard/inventory"
        >
          <span aria-hidden="true">←</span>
        </Link>
        <div className="min-w-0 text-center">
          <h1 className="truncate text-lg font-bold text-stone-950">
            Add Live Birds
          </h1>
          <p className="text-[11px] font-semibold leading-4 text-stone-500">
            <span className="text-emerald-800">Step {currentStep} of 4</span>
            <span aria-hidden="true"> &nbsp;•&nbsp; </span>
            About 2 minutes
          </p>
        </div>
        <div className="flex justify-self-end items-center">
          <button
            className="min-h-9 text-right text-xs font-bold leading-4 text-stone-950 disabled:text-stone-400"
            disabled={disabled || saveDraftStatus === "success"}
            type="button"
            onClick={onSaveDraft}
          >
            {saveDraftStatus === "saving" ? "Saving..." : "Save draft"}
          </button>
        </div>
      </div>
      <div className="px-5 pb-2 pt-1.5">
        <div
          aria-label={`Step ${currentStep} of 4`}
          aria-valuemax={4}
          aria-valuemin={1}
          aria-valuenow={currentStep}
          className="relative grid grid-cols-4"
          role="progressbar"
        >
          <span
            aria-hidden="true"
            className="absolute left-[12.5%] right-[12.5%] top-4 h-px bg-stone-200"
          />
          {[
            ["Hatch", "Details"],
            ["Birds for", "Sale"],
            ["Price", "Changes"],
            ["Publish", ""],
          ].map(([firstLine, secondLine], index) => {
            const step = (index + 1) as 1 | 2 | 3 | 4;
            const active = step === currentStep;
            const complete = step < highestUnlockedStep;
            const locked = step > highestUnlockedStep;
            return (
              <div className="relative flex flex-col items-center" key={step}>
                <span
                  aria-hidden="true"
                  className={`z-10 flex size-8 items-center justify-center rounded-full border text-xs font-bold transition-all duration-200 ${
                    active || complete
                      ? "border-emerald-800 bg-emerald-800 text-white"
                      : locked
                        ? "border-stone-200 bg-stone-100 text-stone-400"
                        : "border-stone-300 bg-white text-stone-500"
                  }`}
                >
                  {step}
                </span>
                <span
                  className={`mt-1 text-center text-[10px] font-semibold leading-3 ${
                    locked
                      ? "text-stone-400"
                      : active
                        ? "text-stone-950"
                        : "text-stone-600"
                  }`}
                >
                  {firstLine}
                  {secondLine ? (
                    <>
                      <br />
                      {secondLine}
                    </>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
        <button
          className="ml-auto mt-0.5 block min-h-6 text-[10px] font-semibold text-emerald-800 underline-offset-4 hover:underline focus:outline-none focus:ring-2 focus:ring-emerald-700"
          type="button"
          onClick={onStartOver}
        >
          Start over
        </button>
      </div>
    </header>
  );
}

function CustomBreedDialog({
  duplicateBreed,
  draft,
  error,
  inputRef,
  saving,
  species,
  onCancel,
  onDraftChange,
  onSubmit,
  onUseExisting,
}: {
  duplicateBreed: BreedOption | null;
  draft: CustomBreedDraft;
  error: string | null;
  inputRef: { current: HTMLInputElement | null };
  saving: boolean;
  species: BreedSpecies[];
  onCancel: () => void;
  onDraftChange: (draft: CustomBreedDraft) => void;
  onSubmit: () => void;
  onUseExisting: () => void;
}) {
  return (
    <div
      aria-labelledby="custom-breed-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/60 px-3 py-4 sm:items-center"
      role="dialog"
    >
      <form
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-stone-200 px-5 py-4">
          <div>
            <h2
              className="text-xl font-semibold text-stone-950"
              id="custom-breed-title"
            >
              Add Breed
            </h2>
            <p className="mt-1 text-sm leading-6 text-stone-600">
              Create a custom breed for your Breed Catalog.
            </p>
          </div>
          <button
            aria-label="Close Add Breed"
            className="rounded-md px-2 py-1 text-2xl leading-none text-stone-500 hover:bg-stone-100 hover:text-stone-950"
            disabled={saving}
            onClick={onCancel}
            type="button"
          >
            x
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-5">
          <CustomBreedForm
            draft={draft}
            disabled={saving}
            nameInputRef={inputRef}
            onDraftChange={onDraftChange}
            species={species}
            speciesLocked
          />

          {error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold leading-6 text-red-700">
              <p>{error}</p>
              {duplicateBreed ? (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-red-800">{duplicateBreed.label}</span>
                  <button
                    className="inline-flex min-h-10 items-center rounded-md bg-emerald-800 px-3 text-sm font-bold text-white transition hover:bg-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
                    type="button"
                    onClick={onUseExisting}
                  >
                    Use existing breed
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-stone-200 bg-stone-50 px-5 py-4 sm:flex-row sm:justify-end">
          <button
            className="seller-secondary-button"
            disabled={saving}
            type="button"
            onClick={onCancel}
          >
            Cancel
          </button>
          {!duplicateBreed ? (
            <button
              className="seller-primary-button"
              disabled={saving || draft.name.trim().length === 0}
              type="submit"
            >
              {saving ? "Creating" : "Create Custom Breed"}
            </button>
          ) : null}
        </div>
      </form>
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
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/35 px-4"
      role="dialog"
    >
      <div className="w-full max-w-md rounded-lg border border-stone-200 bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-stone-950">Start over?</h2>
        <p className="mt-2 text-base leading-7 text-stone-600">
          This will clear the information on this page. Saved drafts will not be
          deleted.
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            className="inline-flex min-h-12 items-center rounded-md border border-stone-300 bg-white px-4 text-base font-bold text-stone-700 shadow-sm transition hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:ring-offset-2 sm:min-h-10 sm:text-sm sm:font-semibold"
            type="button"
            onClick={onCancel}
          >
            Keep editing
          </button>
          <button
            className="inline-flex min-h-12 items-center rounded-md bg-emerald-800 px-4 text-base font-bold text-white shadow-sm transition hover:bg-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 sm:min-h-10 sm:text-sm sm:font-semibold"
            type="button"
            onClick={onConfirm}
          >
            Start over
          </button>
        </div>
      </div>
    </div>
  );
}

function SpeciesChangeWarningDialog({
  nextSpeciesLabel,
  onCancel,
  onConfirm,
}: {
  nextSpeciesLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      aria-labelledby="species-change-warning-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/45 px-4"
      role="dialog"
    >
      <div className="w-full max-w-md rounded-lg border border-amber-200 bg-white p-5 shadow-xl">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-lg font-bold text-amber-800"
          >
            !
          </span>
          <div className="min-w-0">
            <h2
              className="text-lg font-semibold text-stone-950"
              id="species-change-warning-title"
            >
              Change species?
            </h2>
            <p className="mt-2 text-base leading-7 text-stone-600">
              Changing the species to {nextSpeciesLabel} will remove all bird
              entries you have already added. This cannot be undone.
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            className="inline-flex min-h-12 items-center justify-center rounded-md border border-stone-300 bg-white px-4 text-base font-bold text-stone-700 shadow-sm transition hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:ring-offset-2 sm:min-h-10 sm:text-sm sm:font-semibold"
            type="button"
            onClick={onCancel}
          >
            Keep current species
          </button>
          <button
            className="inline-flex min-h-12 items-center justify-center rounded-md bg-red-700 px-4 text-base font-bold text-white shadow-sm transition hover:bg-red-800 focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2 sm:min-h-10 sm:text-sm sm:font-semibold"
            type="button"
            onClick={onConfirm}
          >
            Change species and remove birds
          </button>
        </div>
      </div>
    </div>
  );
}

function EditAgeContext({
  availableDate,
  baselineHatchDate,
  hatchDate,
}: {
  availableDate: string;
  baselineHatchDate: string;
  hatchDate: string;
}) {
  const currentAge = formatAgeFromHatchDate(baselineHatchDate);
  const pendingAge = formatAgeFromHatchDate(hatchDate);
  const availableLabel = formatDateForDisplay(availableDate);
  const isAvailable = Boolean(availableDate && availableDate <= getTodayDateInputValue());

  return (
    <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-base leading-7 text-emerald-950">
      <span className="font-semibold">Current age today:</span>{" "}
      {currentAge ?? "Not available"}
      {pendingAge && pendingAge !== currentAge ? (
        <>
          <span aria-hidden="true"> &nbsp;&#8226;&nbsp; </span>
          <span className="font-semibold">After saving:</span> {pendingAge}
        </>
      ) : null}
      {availableLabel ? (
        <p className="mt-1 text-sm text-emerald-900">
          {isAvailable ? "Available since" : "Available on"} {availableLabel}.
        </p>
      ) : null}
    </div>
  );
}

function EditModeActionsCard({
  active,
  changes,
  disabledReason,
  isSharing,
  message,
  onBack,
  onSave,
  onShare,
  status,
}: {
  active: boolean;
  changes: string[];
  disabledReason: string | null;
  isSharing: boolean;
  message: string | null;
  onBack: () => void;
  onSave: () => void;
  onShare: () => void;
  status: EditSaveStatus;
}) {
  const isSaving = status === "saving";
  const isDisabled = Boolean(disabledReason) || isSaving;

  return (
    <section
      className={`rounded-xl border border-transparent bg-white p-5 shadow-none sm:rounded-lg sm:border-stone-200 sm:shadow-sm ${
        active ? "" : "sm:hidden"
      }`}
    >
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-stone-950">
            Review & Save
          </h2>
          <p className="mt-1 text-base leading-7 text-stone-600">
            Review only the changes you are making to this live listing.
          </p>
        </div>
        {changes.length > 0 ? (
          <ul className="space-y-2 rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-sm leading-6 text-stone-700">
            {changes.map((change) => (
              <li className="flex gap-2" key={change}>
                <span aria-hidden="true" className="text-emerald-700">&#8226;</span>
                <span>{change}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-600">
            No unsaved changes.
          </p>
        )}
        {message ? (
          <p
            className={`rounded-md border px-3 py-2 text-sm font-semibold leading-6 ${
              status === "error"
                ? "border-red-200 bg-red-50 text-red-800"
                : "border-emerald-200 bg-emerald-50 text-emerald-900"
            }`}
          >
            {message}
          </p>
        ) : disabledReason ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-base font-semibold leading-7 text-amber-800">
            {disabledReason}
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            className="inline-flex min-h-12 items-center justify-center rounded-md border border-stone-300 bg-white px-5 text-base font-bold text-stone-700 shadow-sm transition hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:ring-offset-2 sm:min-h-10 sm:text-sm sm:font-semibold"
            type="button"
            onClick={onBack}
          >
            Return to Inventory
          </button>
          <button
            className="inline-flex min-h-12 items-center justify-center rounded-md border border-stone-300 bg-white px-5 text-base font-bold text-stone-700 shadow-sm transition hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:ring-offset-2 disabled:cursor-wait disabled:opacity-60 sm:min-h-10 sm:text-sm sm:font-semibold"
            disabled={isSharing}
            type="button"
            onClick={onShare}
          >
            {isSharing ? "Opening..." : "Share listing"}
          </button>
          <button
            className="inline-flex min-h-12 items-center justify-center rounded-md bg-emerald-800 px-5 text-base font-bold text-white shadow-sm transition hover:bg-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-emerald-800/45 sm:min-h-10 sm:text-sm sm:font-semibold"
            disabled={isDisabled}
            onClick={onSave}
            type="button"
          >
            {isSaving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </section>
  );
}

function UnsavedNavigationDialog({
  canSaveDraft,
  message,
  saving,
  onKeepEditing,
  onLeaveWithoutSaving,
  onSaveDraft,
}: {
  canSaveDraft: boolean;
  message: string | null;
  saving: boolean;
  onKeepEditing: () => void;
  onLeaveWithoutSaving: () => void;
  onSaveDraft: () => void;
}) {
  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/35 px-4"
      role="dialog"
    >
      <div className="w-full max-w-lg rounded-lg border border-stone-200 bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-stone-950">
          Save this draft?
        </h2>
        <p className="mt-2 text-base leading-7 text-stone-600">
          This inventory has not been saved. Save it as a draft before leaving?
        </p>
        {message ? (
          <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold leading-6 text-red-800">
            {message}
          </p>
        ) : null}
        {!canSaveDraft ? (
          <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-base font-semibold leading-7 text-amber-800">
            This draft needs a few more details before it can be saved.
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            className="inline-flex min-h-12 items-center rounded-md border border-stone-300 bg-white px-4 text-base font-bold text-stone-700 shadow-sm transition hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:ring-offset-2 sm:min-h-10 sm:text-sm sm:font-semibold"
            type="button"
            onClick={onLeaveWithoutSaving}
            disabled={saving}
          >
            Leave without saving
          </button>
          <button
            className="inline-flex min-h-12 items-center rounded-md border border-stone-300 bg-white px-4 text-base font-bold text-stone-700 shadow-sm transition hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:ring-offset-2 sm:min-h-10 sm:text-sm sm:font-semibold"
            type="button"
            onClick={onKeepEditing}
            disabled={saving}
          >
            Keep editing
          </button>
          <button
            className="inline-flex min-h-12 items-center rounded-md bg-emerald-800 px-4 text-base font-bold text-white shadow-sm transition hover:bg-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-emerald-800/45 sm:min-h-10 sm:text-sm sm:font-semibold"
            type="button"
            onClick={onSaveDraft}
            disabled={!canSaveDraft || saving}
          >
            {saving ? "Saving..." : "Save draft"}
          </button>
        </div>
      </div>
    </div>
  );
}

function getEditSaveDisabledReason({
  blockingIssues,
  draftLoading,
  hasMeaningfulUnsavedChanges,
  isEditMode,
  saveStatus,
}: {
  blockingIssues: string[];
  draftLoading: boolean;
  hasMeaningfulUnsavedChanges: boolean;
  isEditMode: boolean;
  saveStatus: EditSaveStatus;
}) {
  if (!isEditMode) return null;
  if (draftLoading) return "Listing is still loading.";
  if (saveStatus === "saving") return "Save is already in progress.";
  if (!hasMeaningfulUnsavedChanges) return "No unsaved changes.";

  return blockingIssues[0] ?? null;
}

function getEditSaveBlockingIssues({
  availableDate,
  hatchDate,
  loadedSpeciesId,
  offerings,
  priceAdjustment,
  species,
  sellerBreedProfiles,
}: {
  availableDate: string;
  hatchDate: string;
  loadedSpeciesId: string | null;
  offerings: BirdOffering[];
  priceAdjustment: PriceAdjustmentState;
  species: SpeciesOption;
  sellerBreedProfiles: SellerBreedProfile[];
}) {
  const issues: string[] = [];
  const parsedHatchDate = parseDateValue(hatchDate);
  const parsedAvailableDate = parseDateValue(availableDate);
  const breedProfileSpeciesById = new Map(
    sellerBreedProfiles.map((profile) => [profile.id, profile.species_id] as const),
  );

  if (!species.id) {
    issues.push("Select a species.");
  }

  if (loadedSpeciesId && species.id && loadedSpeciesId !== species.id) {
    issues.push("Species cannot be changed for this listing.");
  }

  if (!parsedHatchDate) {
    issues.push("Enter the hatch date.");
  }

  if (!parsedAvailableDate) {
    issues.push("Enter the date the birds will be available.");
  }

  if (
    parsedHatchDate &&
    parsedAvailableDate &&
    parsedAvailableDate.getTime() < parsedHatchDate.getTime()
  ) {
    issues.push("Enter an available date that is on or after the hatch date.");
  }

  if (offerings.length === 0) {
    issues.push("This listing needs at least one bird entry.");
  }

  offerings.forEach((offering, index) => {
    const label = `Entry ${index + 1}`;
    const quantity = Number(offering.quantity);
    const price = Number(offering.price);

    if (!offering.sellerBreedProfileId) {
      issues.push(`Select a breed for ${label}.`);
    } else if (
      species.id &&
      breedProfileSpeciesById.get(offering.sellerBreedProfileId) !== species.id
    ) {
      issues.push(`Select a breed for ${label} that matches this species.`);
    }

    if (!offering.soldAs.trim()) {
      issues.push(`Select how the birds in ${label} will be sold.`);
    } else if (mapSoldAsToInventoryType(offering.soldAs) === "unknown") {
      issues.push(`Select how the birds in ${label} will be sold.`);
    }

    if (!offering.quantity.trim()) {
      issues.push(`Enter a quantity for ${label}.`);
    } else if (!Number.isInteger(quantity) || quantity < 0) {
      issues.push(`Enter a quantity for ${label}.`);
    }

    if (!offering.price.trim()) {
      issues.push(`Enter a price for ${label}.`);
    } else if (!Number.isFinite(price) || price < 0) {
      issues.push(`Enter a price for ${label}.`);
    }
  });

  return [
    ...issues,
    ...getPriceAdjustmentIssues({ offerings, priceAdjustment }),
  ];
}

async function loadInventoryRemovalBlockedIds(inventoryItemIds: string[]) {
  const uniqueInventoryItemIds = Array.from(new Set(inventoryItemIds));
  const blockAll = () => ({ blockedIds: new Set(uniqueInventoryItemIds) });

  if (uniqueInventoryItemIds.length === 0) {
    return { blockedIds: new Set<string>() };
  }

  const itemResult = await supabase
    .from("seller_order_item_detail")
    .select("inventory_item_id, order_id, fulfilled_quantity")
    .in("inventory_item_id", uniqueInventoryItemIds)
    .returns<RemovalHistoryItemRow[]>();

  if (itemResult.error) return blockAll();

  const itemRows = itemResult.data ?? [];
  const orderIds = Array.from(new Set(itemRows.map((row) => row.order_id)));
  if (orderIds.length === 0) return { blockedIds: new Set<string>() };

  const orderResult = await supabase
    .from("seller_order_management")
    .select("order_id, order_status")
    .in("order_id", orderIds)
    .returns<RemovalHistoryOrderRow[]>();

  if (orderResult.error) return blockAll();

  const statusByOrderId = new Map(
    (orderResult.data ?? []).map((row) => [row.order_id, row.order_status]),
  );
  const blockedIds = new Set<string>();

  itemRows.forEach((row) => {
    if (!row.inventory_item_id) return;
    const orderStatus = statusByOrderId.get(row.order_id);
    if (
      orderStatus !== "canceled" ||
      Math.max(row.fulfilled_quantity ?? 0, 0) > 0
    ) {
      blockedIds.add(row.inventory_item_id);
    }
  });

  return { blockedIds };
}

function getEditCurrentRowsValidationIssue({
  currentRows,
  loadedSpeciesId,
  offerings,
  pendingRemovalInventoryItemIds,
  speciesId,
  sellerBreedProfiles,
}: {
  currentRows: DraftInventoryRow[];
  loadedSpeciesId: string | null;
  offerings: BirdOffering[];
  pendingRemovalInventoryItemIds: string[];
  speciesId: string | null;
  sellerBreedProfiles: SellerBreedProfile[];
}) {
  const activeRows = getActiveInventoryRows(currentRows);
  const activeInventoryIds = new Set(
    activeRows.map((row) => row.inventory_item_id),
  );
  const offeringInventoryIds = new Set(
    offerings
      .map((offering) => offering.inventoryItemId)
      .filter((value): value is string => Boolean(value)),
  );
  const removalInventoryIds = new Set(pendingRemovalInventoryItemIds);
  const breedProfileSpeciesById = new Map(
    sellerBreedProfiles.map((profile) => [profile.id, profile.species_id] as const),
  );

  if (loadedSpeciesId && speciesId !== loadedSpeciesId) {
    return "Species cannot be changed for this listing.";
  }

  if (
    offerings.some(
      (offering) =>
        offering.inventoryItemId && !activeInventoryIds.has(offering.inventoryItemId),
    )
  ) {
    return "Adding entries to an existing listing is coming soon.";
  }

  if (
    activeRows.some(
      (row) =>
        !offeringInventoryIds.has(row.inventory_item_id) &&
        !removalInventoryIds.has(row.inventory_item_id),
    )
  ) {
    return "This listing changed elsewhere. Reload it before saving.";
  }

  for (const offering of offerings) {
    if (
      offering.sellerBreedProfileId &&
      speciesId &&
      breedProfileSpeciesById.get(offering.sellerBreedProfileId) !== speciesId
    ) {
      return "Breed must belong to this listing species.";
    }
  }

  return null;
}

async function syncExistingEditOfferings({
  basePrice,
  currentRows,
  listingBatchId,
  offerings,
}: {
  basePrice: number;
  currentRows: DraftInventoryRow[];
  listingBatchId: string;
  offerings: BirdOffering[];
}): Promise<
  | { ok: true; inventoryIdentities: InventoryIdentityMap }
  | { ok: false; message: string }
> {
  const activeRowsByInventoryId = new Map(
    getActiveInventoryRows(currentRows).map(
      (row) => [row.inventory_item_id, row] as const,
    ),
  );
  const breedIdByProfileId = new Map<string, string>();
  const breedStatusById = new Map<string, string>();
  const inventoryIdentities: InventoryIdentityMap = {};
  const processedInventoryIds = new Set<string>();

  currentRows.forEach((row) => {
    if (!breedIdByProfileId.has(row.seller_breed_profile_id)) {
      breedIdByProfileId.set(
        row.seller_breed_profile_id,
        row.listing_batch_breed_id,
      );
    }

    breedStatusById.set(
      row.listing_batch_breed_id,
      row.listing_batch_breed_visibility_status,
    );
  });

  for (const [index, offering] of offerings.entries()) {
    const inventoryType = mapSoldAsToInventoryType(offering.soldAs);
    const customInventoryLabel = getCustomInventoryLabelForSoldAs(offering.soldAs);

    if (!offering.sellerBreedProfileId) {
      return {
        ok: false,
        message: `Entry ${index + 1} is missing a breed.`,
      };
    }

    if (inventoryType === "unknown") {
      return {
        ok: false,
        message: `Select how the birds in Entry ${index + 1} will be sold.`,
      };
    }

    if (
      offering.inventoryItemId &&
      processedInventoryIds.has(offering.inventoryItemId)
    ) {
      return {
        ok: false,
        message: `Entry ${index + 1} points to an inventory row already used by another entry. Reload the listing before saving.`,
      };
    }

    if (!offering.inventoryItemId) {
      let listingBatchBreedId = breedIdByProfileId.get(
        offering.sellerBreedProfileId,
      );

      if (!listingBatchBreedId) {
        const breedResult = await supabase.rpc("seller_add_listing_batch_breed", {
          p_listing_batch_id: listingBatchId,
          p_seller_breed_profile_id: offering.sellerBreedProfileId,
          p_seller_notes: null,
          p_sort_order: index,
          p_visibility_status: "active",
        });

        if (breedResult.error) {
          return { ok: false, message: breedResult.error.message };
        }

        const createdBreed = breedResult.data as BatchBreedResult | null;
        listingBatchBreedId = createdBreed?.id;

        if (!listingBatchBreedId) {
          return {
            ok: false,
            message: `Entry ${index + 1} could not be prepared.`,
          };
        }

        breedIdByProfileId.set(
          offering.sellerBreedProfileId,
          listingBatchBreedId,
        );
        breedStatusById.set(listingBatchBreedId, "active");
      } else if (breedStatusById.get(listingBatchBreedId) !== "active") {
        const restoreBreedResult = await supabase.rpc(
          "seller_set_listing_batch_breed_visibility",
          {
            p_listing_batch_breed_id: listingBatchBreedId,
            p_visibility_status: "active",
            p_note: "Restored from Edit Live Birds Listing.",
          },
        );

        if (restoreBreedResult.error) {
          return { ok: false, message: restoreBreedResult.error.message };
        }

        breedStatusById.set(listingBatchBreedId, "active");
      }

      const createItemResult = await supabase.rpc("seller_create_inventory_item", {
        p_listing_batch_breed_id: listingBatchBreedId,
        p_inventory_type: inventoryType,
        p_custom_inventory_label: customInventoryLabel,
        p_quantity_available: getNumberInputValue(offering.quantity),
        p_price_override:
          getNumberInputValue(offering.price) === basePrice
            ? null
            : getNumberInputValue(offering.price),
        p_sort_order: index,
        p_visibility_status: "active",
        p_seller_notes: null,
      });

      if (createItemResult.error) {
        return { ok: false, message: createItemResult.error.message };
      }

      const createdItem = createItemResult.data as InventoryItemResult | null;
      if (!createdItem?.id) {
        return {
          ok: false,
          message: `Entry ${index + 1} was created without an inventory identity.`,
        };
      }

      inventoryIdentities[offering.id] = {
        inventoryItemId: createdItem.id,
        listingBatchBreedId,
      };

      continue;
    }

    const currentRow = activeRowsByInventoryId.get(offering.inventoryItemId);

    if (!currentRow) {
      return {
        ok: false,
        message: "This entry is not currently active on the listing.",
      };
    }

    inventoryIdentities[offering.id] = {
      inventoryItemId: currentRow.inventory_item_id,
      listingBatchBreedId: currentRow.listing_batch_breed_id,
    };
    processedInventoryIds.add(currentRow.inventory_item_id);

    if (
      offering.sellerBreedProfileId !== currentRow.seller_breed_profile_id ||
      offering.listingBatchBreedId !== currentRow.listing_batch_breed_id
    ) {
      return {
        ok: false,
        message: "Changing an entry's breed is coming soon.",
      };
    }

    const inventoryResult = await supabase.rpc("seller_update_inventory_item", {
      p_inventory_item_id: currentRow.inventory_item_id,
      p_inventory_type: inventoryType,
      p_custom_inventory_label: customInventoryLabel,
      p_price_override:
        getNumberInputValue(offering.price) === basePrice
          ? null
          : getNumberInputValue(offering.price),
      p_sort_order: index,
      p_seller_notes: null,
    });

    if (inventoryResult.error) {
      return { ok: false, message: inventoryResult.error.message };
    }

    if (getNumberInputValue(offering.quantity) !== currentRow.quantity_available) {
      const quantityResult = await supabase.rpc("seller_adjust_inventory_quantity", {
        p_inventory_item_id: currentRow.inventory_item_id,
        p_quantity_available: getNumberInputValue(offering.quantity),
        p_quantity_delta: null,
        p_note: "Updated from Edit Live Birds Listing.",
      });

      if (quantityResult.error) {
        return { ok: false, message: quantityResult.error.message };
      }
    }
  }

  return { ok: true, inventoryIdentities };
}

function getActiveInventoryRows(rows: DraftInventoryRow[]) {
  return rows.filter(
    (row) =>
      row.inventory_visibility_status === "active" &&
      row.listing_batch_breed_visibility_status === "active",
  );
}

function pruneUntouchedOfferings(offerings: BirdOffering[]) {
  return offerings.filter(isBirdsForSaleGroupStarted);
}

function parseDateValue(value: string) {
  const [year, month, day] = value.split("-").map(Number);

  if (!year || !month || !day) return null;

  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

async function syncDraftOfferings({
  basePrice,
  currentRows,
  draftId,
  offerings,
}: {
  basePrice: number;
  currentRows: DraftInventoryRow[];
  draftId: string;
  offerings: BirdOffering[];
}): Promise<
  | { ok: true; inventoryIdentities: InventoryIdentityMap }
  | { ok: false; message: string }
> {
  const activeRows = currentRows.filter(
    (row) =>
      row.inventory_visibility_status === "active" &&
      row.listing_batch_breed_visibility_status === "active",
  );
  const retainedInventoryIds = new Set<string>();
  const inventoryIdentities: InventoryIdentityMap = {};
  const claimedPersistedInventoryIds = new Set(
    offerings
      .map((offering) => offering.inventoryItemId)
      .filter((value): value is string => Boolean(value)),
  );
  const breedIdByProfileId = new Map<string, string>();
  const breedStatusById = new Map<string, string>();

  currentRows.forEach((row) => {
    breedIdByProfileId.set(
      row.seller_breed_profile_id,
      row.listing_batch_breed_id,
    );
    breedStatusById.set(
      row.listing_batch_breed_id,
      row.listing_batch_breed_visibility_status,
    );
  });

  for (const [index, offering] of offerings.entries()) {
    if (!offering.sellerBreedProfileId) {
      return {
        ok: false,
        message: `Select a breed for Entry ${index + 1}.`,
      };
    }

    const inventoryType = mapSoldAsToInventoryType(offering.soldAs);
    const customInventoryLabel = getCustomInventoryLabelForSoldAs(
      offering.soldAs,
    );

    if (inventoryType === "unknown") {
      return {
        ok: false,
        message: `Select how the birds in Entry ${index + 1} will be sold.`,
      };
    }


    if (
      offering.inventoryItemId &&
      retainedInventoryIds.has(offering.inventoryItemId)
    ) {
      return {
        ok: false,
        message: `Entry ${index + 1} points to an inventory row already used by another entry. Reload the draft before saving.`,
      };
    }

    let listingBatchBreedId = breedIdByProfileId.get(
      offering.sellerBreedProfileId,
    );

    if (!listingBatchBreedId) {
      const breedResult = await supabase.rpc("seller_add_listing_batch_breed", {
        p_listing_batch_id: draftId,
        p_seller_breed_profile_id: offering.sellerBreedProfileId,
        p_seller_notes: null,
        p_sort_order: index,
        p_visibility_status: "active",
      });

      if (breedResult.error) {
        return { ok: false, message: breedResult.error.message };
      }

      const createdBreed = breedResult.data as BatchBreedResult | null;
      listingBatchBreedId = createdBreed?.id;

      if (!listingBatchBreedId) {
        return {
          ok: false,
          message: "The entry could not be prepared.",
        };
      }

      breedIdByProfileId.set(offering.sellerBreedProfileId, listingBatchBreedId);
      breedStatusById.set(listingBatchBreedId, "active");
    } else {
      if (breedStatusById.get(listingBatchBreedId) !== "active") {
        const restoreBreedResult = await supabase.rpc(
          "seller_set_listing_batch_breed_visibility",
          {
            p_listing_batch_breed_id: listingBatchBreedId,
            p_visibility_status: "active",
            p_note: "Restored from Add Inventory v2.",
          },
        );

        if (restoreBreedResult.error) {
          return { ok: false, message: restoreBreedResult.error.message };
        }
      }

      const breedUpdateResult = await supabase.rpc(
        "seller_update_listing_batch_breed",
        {
          p_listing_batch_breed_id: listingBatchBreedId,
          p_seller_notes: null,
          p_sort_order: index,
        },
      );

      if (breedUpdateResult.error) {
        return { ok: false, message: breedUpdateResult.error.message };
      }
    }

    const unavailableInventoryIds = new Set([
      ...claimedPersistedInventoryIds,
      ...retainedInventoryIds,
    ]);
    const resolution = resolveDraftInventoryRow({
      customInventoryLabel,
      inventoryItemId: offering.inventoryItemId,
      inventoryType,
      rows: currentRows,
      sellerBreedProfileId: offering.sellerBreedProfileId,
      unavailableInventoryIds,
    });

    if (resolution.kind === "ambiguous") {
      return {
        ok: false,
        message: `Entry ${index + 1} matches more than one saved inventory row. Reload the draft before saving.`,
      };
    }

    if (resolution.kind === "none" && offering.inventoryItemId) {
      return {
        ok: false,
        message: `Entry ${index + 1} no longer matches its saved inventory row. Reload the draft before saving.`,
      };
    }

    const rowToUpdate = resolution.row;

    if (rowToUpdate) {
      if (
        offering.sellerBreedProfileId !== rowToUpdate.seller_breed_profile_id ||
        listingBatchBreedId !== rowToUpdate.listing_batch_breed_id
      ) {
        return {
          ok: false,
          message: "Changing an existing draft entry's breed is not supported.",
        };
      }

      retainedInventoryIds.add(rowToUpdate.inventory_item_id);
      inventoryIdentities[offering.id] = {
        inventoryItemId: rowToUpdate.inventory_item_id,
        listingBatchBreedId: rowToUpdate.listing_batch_breed_id,
      };

      if (rowToUpdate.inventory_visibility_status !== "active") {
        const visibilityResult = await supabase.rpc(
          "seller_set_inventory_visibility",
          {
            p_inventory_item_id: rowToUpdate.inventory_item_id,
            p_visibility_status: "active",
            p_note: "Restored from Add Inventory v2.",
          },
        );

        if (visibilityResult.error) {
          return { ok: false, message: visibilityResult.error.message };
        }
      }

      const inventoryResult = await supabase.rpc("seller_update_inventory_item", {
        p_inventory_item_id: rowToUpdate.inventory_item_id,
        p_inventory_type: inventoryType,
        p_custom_inventory_label: customInventoryLabel,
        p_price_override: getNumberInputValue(offering.price) === basePrice
          ? null
          : getNumberInputValue(offering.price),
        p_sort_order: index,
        p_seller_notes: null,
      });

      if (inventoryResult.error) {
        return { ok: false, message: inventoryResult.error.message };
      }

      const quantityResult = await supabase.rpc("seller_adjust_inventory_quantity", {
        p_inventory_item_id: rowToUpdate.inventory_item_id,
        p_quantity_available: getNumberInputValue(offering.quantity),
        p_quantity_delta: null,
        p_note: "Updated from Add Inventory v2.",
      });

      if (quantityResult.error) {
        return { ok: false, message: quantityResult.error.message };
      }
    } else {
      const createItemResult = await supabase.rpc("seller_create_inventory_item", {
        p_listing_batch_breed_id: listingBatchBreedId,
        p_inventory_type: inventoryType,
        p_custom_inventory_label: customInventoryLabel,
        p_quantity_available: getNumberInputValue(offering.quantity),
        p_price_override: getNumberInputValue(offering.price) === basePrice
          ? null
          : getNumberInputValue(offering.price),
        p_sort_order: index,
        p_visibility_status: "active",
        p_seller_notes: null,
      });

      if (createItemResult.error) {
        return { ok: false, message: createItemResult.error.message };
      }

      const createdItem = createItemResult.data as InventoryItemResult | null;

      if (!createdItem?.id) {
        return {
          ok: false,
          message: `Entry ${index + 1} was created without an inventory identity.`,
        };
      }

      retainedInventoryIds.add(createdItem.id);
      inventoryIdentities[offering.id] = {
        inventoryItemId: createdItem.id,
        listingBatchBreedId,
      };
    }
  }

  for (const row of activeRows) {
    if (retainedInventoryIds.has(row.inventory_item_id)) continue;

    const archiveResult = await supabase.rpc("seller_set_inventory_visibility", {
      p_inventory_item_id: row.inventory_item_id,
      p_visibility_status: "archived",
      p_note: "Removed from Add Inventory v2.",
    });

    if (archiveResult.error) {
      return { ok: false, message: archiveResult.error.message };
    }
  }

  return { ok: true, inventoryIdentities };
}

async function loadListingRows({
  listingBatchId,
  mode,
  storeId,
}: {
  listingBatchId: string;
  mode: "create" | "edit";
  storeId: string;
}): Promise<{ rows: DraftInventoryRow[] } | { error: string }> {
  let query = supabase
    .from("seller_inventory_management")
    .select(
      "listing_batch_id, listing_batch_breed_id, inventory_item_id, species_id, species_name, species_slug, seller_breed_profile_id, breed_display_name, batch_type, origin_date, available_date, base_price, auto_price_adjustment_enabled, price_adjustment_direction, price_adjustment_amount, price_adjustment_interval_weeks, price_adjustment_max_price, price_adjustment_min_price, internal_batch_label, listing_batch_visibility_status, listing_batch_breed_sort_order, listing_batch_breed_visibility_status, inventory_type, custom_inventory_label, quantity_available, price_override, inventory_item_sort_order, inventory_visibility_status",
    )
    .eq("store_id", storeId)
    .eq("listing_batch_id", listingBatchId)
    .eq("batch_type", "live_animals");

  if (mode === "create") {
    query = query
      .eq("listing_batch_visibility_status", "hidden")
      .eq("internal_batch_label", liveBirdsV2DraftMarker);
  }

  const { data, error } = await query
    .order("listing_batch_breed_sort_order", { ascending: true })
    .order("inventory_item_sort_order", { ascending: true })
    .returns<DraftInventoryRow[]>();

  if (error) {
    return { error: error.message };
  }

  if (!data || data.length === 0) {
    return {
      error:
        mode === "create"
          ? "This draft was not found, is not a hidden Live Birds v2 draft, or is not available for this store."
          : "This Live Birds listing was not found or is not available for this store.",
    };
  }

  return { rows: data };
}

function getDraftSpeciesOption(
  rows: DraftInventoryRow[],
  speciesOptions: SpeciesOption[],
) {
  const firstRow = rows[0];

  if (!firstRow) return null;

  return (
    speciesOptions.find((option) => option.id === firstRow.species_id) ?? {
      id: firstRow.species_id,
      label: firstRow.species_name,
      slug: firstRow.species_slug,
    }
  );
}

function getBlankSpeciesOption(): SpeciesOption {
  return {
    id: null,
    label: "",
    slug: null,
  };
}

function createBlankOffering(id: string): BirdOffering {
  return {
    id,
    sellerBreedProfileId: null,
    breedId: null,
    breed: "",
    soldAs: "",
    quantity: "",
    price: "",
    description: "",
    expanded: true,
    breedContentExpanded: false,
    breedContentUserToggled: false,
  };
}

function isBirdsForSaleStepLocked({
  availableDate,
  hatchDate,
  species,
}: {
  availableDate: string;
  hatchDate: string;
  species: SpeciesOption;
}) {
  const hasSpecies = species.label.trim().length > 0;
  const hasHatchDate = parseDateValue(hatchDate) !== null;
  const hasAvailableDate = parseDateValue(availableDate) !== null;

  return !hasSpecies || !hasHatchDate || !hasAvailableDate;
}

function getTodayDateInputValue() {
  const now = new Date();
  const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);

  return localDate.toISOString().slice(0, 10);
}

type MobileLiveBirdsStepProgression = {
  highestUnlockedStep: 1 | 2 | 3 | 4;
  step1Complete: boolean;
  step2Complete: boolean;
  step3Complete: boolean;
  publishable: boolean;
};

function getMobileLiveBirdsStepProgression(
  validationIssues: PublishValidationIssue[],
): MobileLiveBirdsStepProgression {
  const hasStep1Issues = validationIssues.some(
    (issue) =>
      issue.target.type === "hatch" &&
      (issue.id === "species" ||
        issue.id === "hatch-date" ||
        issue.id === "available-date" ||
        issue.id === "available-date-before-hatch-date"),
  );
  const hasStep2Issues = validationIssues.some(
    (issue) =>
      issue.id === "missing-groups" ||
      (issue.target.type === "offering" &&
        !issue.id.endsWith("-photo") &&
        !issue.id.endsWith("-description")),
  );
  const hasStep3Issues = validationIssues.some((issue) =>
    issue.id.startsWith("price-adjustment-"),
  );

  const step1Complete = !hasStep1Issues;
  const step2Complete = step1Complete && !hasStep2Issues;
  const step3Complete = step2Complete && !hasStep3Issues;
  const highestUnlockedStep: 1 | 2 | 3 | 4 = !step1Complete
    ? 1
    : !step2Complete
      ? 2
      : !step3Complete
        ? 3
        : 4;

  return {
    highestUnlockedStep,
    publishable: validationIssues.length === 0,
    step1Complete,
    step2Complete,
    step3Complete,
  };
}

function getBirdsForSaleCompletionErrorMessage(
  validationIssues: PublishValidationIssue[],
) {
  const birdsForSaleIssue = validationIssues.find(
    (issue) =>
      issue.id === "missing-groups" ||
      (issue.target.type === "offering" &&
        !issue.id.endsWith("-photo") &&
        !issue.id.endsWith("-description")),
  );

  return birdsForSaleIssue?.message ?? "Finish the bird details before continuing.";
}

function getPublishValidationIssues({
  allowZeroQuantity = false,
  availableDate,
  breedMediaItemsByProfileId,
  breedOptions,
  hatchDate,
  offerings,
  priceAdjustment,
  species,
}: {
  allowZeroQuantity?: boolean;
  availableDate: string;
  breedMediaItemsByProfileId: Record<string, ListingPhotoItem[]>;
  breedOptions: BreedOption[];
  hatchDate: string;
  offerings: BirdOffering[];
  priceAdjustment: PriceAdjustmentState;
  species: SpeciesOption;
}): PublishValidationIssue[] {
  const issues: PublishValidationIssue[] = [];
  const startedOfferings = offerings.filter(isBirdsForSaleGroupStarted);
  const parsedHatchDate = parseDateValue(hatchDate);
  const parsedAvailableDate = parseDateValue(availableDate);

  if (!species.id) {
    issues.push({
      id: "species",
      message: "Select a species.",
      target: { type: "hatch", field: "species" },
    });
  }

  if (!parsedHatchDate) {
    issues.push({
      id: "hatch-date",
      message: "Enter the hatch date.",
      target: { type: "hatch", field: "hatchDate" },
    });
  }

  if (!parsedAvailableDate) {
    issues.push({
      id: "available-date",
      message: "Enter the date the birds will be available.",
      target: { type: "hatch", field: "availableDate" },
    });
  }

  if (
    parsedHatchDate &&
    parsedAvailableDate &&
    parsedAvailableDate.getTime() < parsedHatchDate.getTime()
  ) {
    issues.push({
      id: "available-date-before-hatch-date",
      message: "Enter an available date that is on or after the hatch date.",
      target: { type: "hatch", field: "availableDate" },
    });
  }

  if (startedOfferings.length === 0) {
    issues.push({
      id: "missing-groups",
      message: "Add at least one bird entry.",
      target: { type: "hatch", field: "species" },
    });
  }

  startedOfferings.forEach((offering, index) => {
    const groupLabel = `Entry ${index + 1}`;
    const target = { type: "offering", offeringId: offering.id } as const;
    const quantity = Number(offering.quantity);
    const price = Number(offering.price);
    const breedOption =
      findBreedOptionById(breedOptions, offering.sellerBreedProfileId) ??
      findBreedOptionByBreedId(breedOptions, offering.breedId ?? null);
    const breedMediaItems = offering.sellerBreedProfileId
      ? breedMediaItemsByProfileId[offering.sellerBreedProfileId] ?? []
      : [];

    if (!offering.sellerBreedProfileId) {
      issues.push({
        id: `${offering.id}-breed`,
        message: `Select a breed for ${groupLabel}.`,
        target,
      });
    }

    if (
      !offering.soldAs.trim() ||
      mapSoldAsToInventoryType(offering.soldAs) === "unknown"
    ) {
      issues.push({
        id: `${offering.id}-sold-as`,
        message: `Select how the birds in ${groupLabel} will be sold.`,
        target,
      });
    }

    if (
      !offering.quantity.trim() ||
      !Number.isInteger(quantity) ||
      quantity < (allowZeroQuantity ? 0 : 1)
    ) {
      issues.push({
        id: `${offering.id}-quantity`,
        message: `Enter a quantity for ${groupLabel}.`,
        target,
      });
    }

    if (!offering.price.trim() || !Number.isFinite(price) || price <= 0) {
      issues.push({
        id: `${offering.id}-price`,
        message: `Enter a price for ${groupLabel}.`,
        target,
      });
    }

    if (
      offering.sellerBreedProfileId &&
      !hasPublishReadyBreedPhoto({ breedMediaItems, breedOption })
    ) {
      issues.push({
        id: `${offering.id}-photo`,
        message: `Add a breed photo for ${groupLabel}.`,
        target,
      });
    }

    if (offering.sellerBreedProfileId && !offering.description.trim()) {
      issues.push({
        id: `${offering.id}-description`,
        message: `Add a breed description for ${groupLabel}.`,
        target,
      });
    }
  });

  return [
    ...issues,
    ...getPriceAdjustmentIssues({
      offerings: startedOfferings,
      priceAdjustment,
    }).map(
      (message, index) => ({
        id: `price-adjustment-${index}`,
        message,
        target: { type: "hatch", field: "availableDate" } as const,
      }),
    ),
  ];
}

function hasPublishReadyBreedPhoto({
  breedMediaItems,
  breedOption,
}: {
  breedMediaItems: ListingPhotoItem[];
  breedOption: BreedOption | null;
}) {
  return (
    breedMediaItems.some(
      (item) =>
        item.visibility_status === "active" &&
        item.asset_status === "active" &&
        item.moderation_status === "approved" &&
        Boolean(toDisplayImageUrl(item.public_url)),
    ) ||
    Boolean(toDisplayImageUrl(breedOption?.sellerPhotoUrl)) ||
    Boolean(toDisplayImageUrl(breedOption?.catalogImageUrl))
  );
}

function getLiveBirdsFormSnapshot({
  availableDate,
  hatchDate,
  offerings,
  priceAdjustment,
  species,
}: {
  availableDate: string;
  hatchDate: string;
  offerings: BirdOffering[];
  priceAdjustment: PriceAdjustmentState;
  species: SpeciesOption;
}) {
  return JSON.stringify({
    availableDate,
    hatchDate,
    offerings: offerings.map((offering) => ({
      breed: offering.breed.trim(),
      breedId: offering.breedId ?? null,
      description: offering.description.trim(),
      price: offering.price.trim(),
      quantity: offering.quantity.trim(),
      sellerBreedProfileId: offering.sellerBreedProfileId,
      soldAs: offering.soldAs.trim(),
    })),
    priceAdjustment: {
      amount: priceAdjustment.amount.trim(),
      direction: priceAdjustment.direction,
      enabled: priceAdjustment.enabled,
      intervalWeeks: priceAdjustment.intervalWeeks.trim(),
      maxPrice: priceAdjustment.maxPrice.trim(),
      minPrice: priceAdjustment.minPrice.trim(),
    },
    species: {
      id: species.id,
      label: species.label.trim(),
      slug: species.slug,
    },
  });
}

function getEditChangeSummaries({
  availableDate,
  baseline,
  hatchDate,
  offerings,
  pendingEntryPhotos,
  pendingRemovedOfferings,
  priceAdjustment,
}: {
  availableDate: string;
  baseline: EditBaseline | null;
  hatchDate: string;
  offerings: BirdOffering[];
  pendingEntryPhotos: Record<string, PendingEntryPhoto>;
  pendingRemovedOfferings: PendingRemovedOffering[];
  priceAdjustment: PriceAdjustmentState;
}) {
  if (!baseline) return [];
  const changes: string[] = [];

  if (baseline.hatchDate !== hatchDate) {
    changes.push(
      `Hatch date changed from ${formatDateForDisplay(baseline.hatchDate)} to ${formatDateForDisplay(hatchDate)}.`,
    );
    changes.push(
      `Current calculated age changes from ${formatAgeFromHatchDate(baseline.hatchDate)} to ${formatAgeFromHatchDate(hatchDate)}.`,
    );
  }
  if (baseline.availableDate !== availableDate) {
    changes.push(
      `Available date changed from ${formatDateForDisplay(baseline.availableDate)} to ${formatDateForDisplay(availableDate)}.`,
    );
  }

  const baselineByInventoryId = new Map(
    baseline.offerings.map((offering) => [offering.inventoryItemId, offering]),
  );
  offerings.forEach((offering) => {
    const saved = offering.inventoryItemId
      ? baselineByInventoryId.get(offering.inventoryItemId)
      : null;
    const label = `${offering.breed || "Bird"} ${offering.soldAs || "entry"}`;
    if (!saved) {
      changes.push(`${label} will be added.`);
      return;
    }
    if (saved.quantity !== offering.quantity) {
      changes.push(`${label} quantity changed from ${saved.quantity} to ${offering.quantity}.`);
    }
    if (saved.price !== offering.price) {
      changes.push(`${label} starting price changed from ${formatCurrency(Number(saved.price))} to ${formatCurrency(Number(offering.price))}.`);
    }
    if (saved.soldAs !== offering.soldAs) {
      changes.push(`${offering.breed} sale type changed from ${saved.soldAs} to ${offering.soldAs}.`);
    }
  });

  pendingRemovedOfferings.forEach(({ offering }) => {
    changes.push(`${offering.breed} ${offering.soldAs.toLowerCase()} entry will be permanently removed.`);
  });
  Object.keys(pendingEntryPhotos).forEach((offeringId) => {
    const offering = offerings.find((item) => item.id === offeringId);
    changes.push(`${offering?.breed || "Bird"} entry photo will be added.`);
  });

  const currentPrices = baseline.offerings.map((offering) =>
    calculateCurrentListingPrice({
      availableDate: baseline.availableDate,
      price: offering.price,
      priceAdjustment: baseline.priceAdjustment,
    }),
  );
  const nextPrices = offerings.map((offering) =>
    calculateCurrentListingPrice({ availableDate, price: offering.price, priceAdjustment }),
  );
  const currentPriceRange = formatPriceRange(currentPrices);
  const nextPriceRange = formatPriceRange(nextPrices);
  if (currentPriceRange !== nextPriceRange) {
    changes.push(
      `Current storefront price changes from ${currentPriceRange} to ${nextPriceRange}.`,
    );
  }

  return changes;
}

function calculateCurrentListingPrice({
  availableDate,
  price,
  priceAdjustment,
}: {
  availableDate: string;
  price: string;
  priceAdjustment: PriceAdjustmentState;
}) {
  const startingPrice = Number(price);
  if (!Number.isFinite(startingPrice)) return 0;
  if (!priceAdjustment.enabled) return startingPrice;

  const available = parseDateValue(availableDate);
  const today = parseDateValue(getTodayDateInputValue());
  const intervalWeeks = Number(priceAdjustment.intervalWeeks);
  const amount = Number(priceAdjustment.amount);
  if (!available || !today || intervalWeeks <= 0 || amount <= 0 || today <= available) {
    return startingPrice;
  }

  const completedIntervals = Math.floor(
    (today.getTime() - available.getTime()) /
      (intervalWeeks * 7 * 24 * 60 * 60 * 1000),
  );
  if (priceAdjustment.direction === "increase") {
    const uncapped = startingPrice + amount * completedIntervals;
    const maximum = Number(priceAdjustment.maxPrice);
    return Number.isFinite(maximum)
      ? Math.min(uncapped, Math.max(maximum, startingPrice))
      : uncapped;
  }

  const uncapped = startingPrice - amount * completedIntervals;
  const minimum = Number(priceAdjustment.minPrice);
  return Math.max(
    uncapped,
    Number.isFinite(minimum) ? Math.min(minimum, startingPrice) : 0,
    0,
  );
}

function formatAgeFromHatchDate(value: string) {
  const hatch = parseDateValue(value);
  const today = parseDateValue(getTodayDateInputValue());
  if (!hatch || !today || hatch > today) return null;
  const days = Math.floor((today.getTime() - hatch.getTime()) / (24 * 60 * 60 * 1000));
  if (days < 14) return `${days} day${days === 1 ? "" : "s"}`;
  const weeks = Math.floor(days / 7);
  return `${weeks} week${weeks === 1 ? "" : "s"}`;
}

function formatDateForDisplay(value: string) {
  const date = parseDateValue(value);
  if (!date) return value || "not set";
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    style: "currency",
  }).format(value);
}

function formatPriceRange(values: number[]) {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (finite.length === 0) return "Not available";
  return finite[0] === finite[finite.length - 1]
    ? formatCurrency(finite[0])
    : `${formatCurrency(finite[0])}–${formatCurrency(finite[finite.length - 1])}`;
}

function mergeDraftSpeciesOptions(
  speciesOptions: SpeciesOption[],
  draftSpecies: SpeciesOption,
) {
  if (speciesOptions.some((option) => option.id === draftSpecies.id)) {
    return speciesOptions;
  }

  return [...speciesOptions, draftSpecies];
}

function getOfferingsFromDraftRows(rows: DraftInventoryRow[]) {
  const uniqueRowsByInventoryItemId = new Map<string, DraftInventoryRow>();

  rows
    .filter(
      (row) =>
        row.inventory_visibility_status === "active" &&
        row.listing_batch_breed_visibility_status === "active",
    )
    .forEach((row) => {
      uniqueRowsByInventoryItemId.set(row.inventory_item_id, row);
    });

  return Array.from(uniqueRowsByInventoryItemId.values()).map(
    (row, index): BirdOffering => ({
      id: `offering-${index + 1}`,
      inventoryItemId: row.inventory_item_id,
      listingBatchBreedId: row.listing_batch_breed_id,
      sellerBreedProfileId: row.seller_breed_profile_id,
      breedId: null,
      breed: row.breed_display_name,
      soldAs: mapInventoryTypeToSoldAs(
        row.inventory_type,
        row.custom_inventory_label,
      ),
      quantity: String(row.quantity_available ?? 0),
      price: String(row.price_override ?? row.base_price ?? 0),
      description: "",
      expanded: index === 0,
    }),
  );
}

function getLoadedDraftSaveDisabledReason({
  loadedDraftSpeciesId,
  speciesId,
}: {
  loadedDraftSpeciesId: string | null;
  speciesId: string | null;
}) {
  if (loadedDraftSpeciesId && speciesId && loadedDraftSpeciesId !== speciesId) {
    return "Changing species on saved drafts is coming next.";
  }

  return null;
}

function getPublishDisabledReason({
  isPublished,
  loadedDraftSpeciesDisabledReason,
  preflightCanSaveDraft,
  readyToPublish,
  saveDraftStatus,
}: {
  isPublished: boolean;
  loadedDraftSpeciesDisabledReason: string | null;
  preflightCanSaveDraft: boolean;
  readyToPublish: boolean;
  saveDraftStatus: SaveDraftStatus;
}) {
  if (isPublished) return "Published to storefront.";

  if (saveDraftStatus === "saving") {
    return "Save is already in progress.";
  }

  if (loadedDraftSpeciesDisabledReason) {
    return loadedDraftSpeciesDisabledReason;
  }

  if (!preflightCanSaveDraft) {
    return "Finish the required details before publishing.";
  }

  if (!readyToPublish) {
    return "Finish the remaining items before publishing.";
  }

  return null;
}

function getBasePriceForOfferings(offerings: BirdOffering[]) {
  const firstNonNegativePrice = offerings
    .map((offering) => getNumberInputValue(offering.price))
    .find((price) => price >= 0);

  return firstNonNegativePrice ?? 0;
}

function findBreedOptionById(
  options: BreedOption[],
  sellerBreedProfileId: string | null,
) {
  if (!sellerBreedProfileId) return null;

  return options.find((option) => option.id === sellerBreedProfileId) ?? null;
}

function findBreedOptionByBreedId(
  options: BreedOption[],
  breedId: string | null,
) {
  if (!breedId) return null;

  return options.find((option) => option.breedId === breedId) ?? null;
}

function findBreedOptionByLabel(options: BreedOption[], label: string) {
  const normalizedLabel = label.trim().toLowerCase();

  return (
    options.find(
      (option) => option.label.trim().toLowerCase() === normalizedLabel,
    ) ?? null
  );
}

function findDuplicateBreedOption({
  breedOptions,
  name,
  speciesId,
}: {
  breedOptions: BreedOption[];
  name: string;
  speciesId: string;
}) {
  const normalizedName = normalizeBreedNameForDuplicateCheck(name);

  return (
    breedOptions.find(
      (option) =>
        (option.speciesId === speciesId || option.speciesId === null) &&
        normalizeBreedNameForDuplicateCheck(option.label) === normalizedName,
    ) ?? null
  );
}

function normalizeBreedNameForDuplicateCheck(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[-!"#$%&'()*+,./:;<=>?@[\\\]^_`{|}~]+/g, " ")
    .replace(/\s+/g, " ");
}

function groupBreedMediaByProfileId(mediaItems: ListingPhotoItem[]) {
  return mediaItems.reduce<Record<string, ListingPhotoItem[]>>((groups, item) => {
    groups[item.entity_id] = [...(groups[item.entity_id] ?? []), item];

    return groups;
  }, {});
}

function groupEntryMediaByInventoryItemId(mediaItems: ListingPhotoItem[]) {
  return mediaItems.reduce<Record<string, ListingPhotoItem[]>>((groups, item) => {
    groups[item.entity_id] = [...(groups[item.entity_id] ?? []), item];
    return groups;
  }, {});
}

function alignOfferingsToBreedOptions(
  offerings: BirdOffering[],
  breedOptions: BreedOption[],
) {
  let changed = false;
  const nextOfferings = offerings.map((offering, index) => {
    const isBlankOffering =
      !offering.sellerBreedProfileId &&
      !offering.breedId &&
      offering.breed.trim().length === 0;

    if (isBlankOffering) return offering;

    const matchingOption =
      findBreedOptionById(breedOptions, offering.sellerBreedProfileId) ??
      findBreedOptionByBreedId(breedOptions, offering.breedId ?? null) ??
      findBreedOptionByLabel(breedOptions, offering.breed) ??
      breedOptions[index] ??
      breedOptions[0];

    if (!matchingOption) return offering;

    if (
      offering.sellerBreedProfileId === matchingOption.id &&
      offering.breedId === matchingOption.breedId &&
      offering.breed === matchingOption.label &&
      offering.description.trim().length > 0
    ) {
      return offering;
    }

    changed = true;

    return {
      ...offering,
      breed: matchingOption.label,
      breedId: matchingOption.breedId,
      description:
        offering.description.trim().length > 0
          ? offering.description
          : getBreedDescriptionFromOption(matchingOption),
      sellerBreedProfileId: matchingOption.id,
    };
  });

  return changed ? nextOfferings : offerings;
}

function getBreedOptionsMessage({
  referenceDataError,
  referenceDataLoading,
  selectedSpeciesLabel,
  usingFallbackBreeds,
}: {
  referenceDataError: string | null;
  referenceDataLoading: boolean;
  selectedSpeciesLabel: string;
  usingFallbackBreeds: boolean;
}) {
  if (referenceDataLoading) {
    return "Loading seller breed profiles for this UI shell.";
  }

  if (referenceDataError) {
    return "Seller breed profiles could not be loaded. Local placeholder breed labels are shown for now.";
  }

  if (usingFallbackBreeds) {
    return `No active seller breed profiles were found for ${selectedSpeciesLabel}. Local placeholder breed labels are shown for now.`;
  }

  return null;
}

async function createSellerCustomBreedProfile({
  draft,
  speciesId,
  storeId,
}: {
  draft: CustomBreedDraft;
  speciesId: string;
  storeId: string;
}): Promise<
  | { ok: true; profile: SellerBreedProfile }
  | { ok: false; message: string }
> {
  const upsertResult = await supabase.rpc("seller_upsert_breed_profile", {
    p_annual_egg_production: draft.annualEggProduction || null,
    p_breed_category: draft.breedCategory || null,
    p_breed_id: null,
    p_custom_breed_name: draft.name,
    p_display_name: formatBreedDisplayName(draft.name, draft.variety),
    p_egg_color: draft.eggColor || null,
    p_seller_breed_profile_id: null,
    p_seller_description: draft.description || null,
    p_seller_notes: null,
    p_species_id: speciesId,
    p_store_id: storeId,
    p_visibility_status: "active",
    p_variety: draft.variety || null,
  });

  if (upsertResult.error) {
    return {
      ok: false,
      message: "The custom breed could not be added. Please try again.",
    };
  }

  const upsertRows = Array.isArray(upsertResult.data)
    ? (upsertResult.data as BreedProfileUpsertResult[])
    : [];
  const createdProfileId =
    upsertRows[0]?.seller_breed_profile_id ??
    (upsertResult.data as BreedProfileUpsertResult | null)
      ?.seller_breed_profile_id;

  if (!createdProfileId) {
    return {
      ok: false,
      message: "The custom breed could not be opened after it was added.",
    };
  }

  const profileResult = await supabase
    .from("seller_breed_profiles")
    .select(sellerBreedProfileSelect)
    .eq("store_id", storeId)
    .eq("id", createdProfileId)
    .maybeSingle<SellerBreedProfile>();

  if (profileResult.error || !profileResult.data) {
    return {
      ok: false,
      message: "The custom breed could not be opened after it was added.",
    };
  }

  return { ok: true, profile: profileResult.data };
}

async function loadBreedMediaItems({
  profileIds,
  storeId,
}: {
  profileIds: string[];
  storeId: string;
}): Promise<{ items: ListingPhotoItem[] } | { error: string }> {
  if (profileIds.length === 0) return { items: [] };

  const { data, error } = await supabase
    .from("seller_media_management")
    .select(sellerMediaSelect)
    .eq("store_id", storeId)
    .eq("entity_type", "seller_breed_profile")
    .in("entity_id", profileIds)
    .returns<ListingPhotoItem[]>();

  if (error) return { error: error.message };

  return { items: data ?? [] };
}

async function loadInventoryEntryMediaItems({
  inventoryItemIds,
  storeId,
}: {
  inventoryItemIds: string[];
  storeId: string;
}): Promise<{ items: ListingPhotoItem[] } | { error: string }> {
  if (inventoryItemIds.length === 0) return { items: [] };

  const { data, error } = await supabase
    .from("seller_media_management")
    .select(sellerMediaSelect)
    .eq("store_id", storeId)
    .eq("entity_type", "inventory_item")
    .in("entity_id", inventoryItemIds)
    .returns<ListingPhotoItem[]>();

  if (error) return { error: error.message };
  return { items: data ?? [] };
}

function formatCoopAllowanceMessage(allowance: LiveBirdPublishAllowance) {
  const limit = allowance.active_bird_limit ?? 5;
  const remaining = allowance.remaining_bird_units ?? 0;
  const requested = allowance.requested_bird_units;
  const spotLabel = remaining === 1 ? "spot" : "spots";
  const birdLabel = requested === 1 ? "bird" : "birds";

  return `Your Coop plan allows up to ${limit} birds for sale at a time. You currently have ${remaining} available ${spotLabel}, but this listing contains ${requested} ${birdLabel}. Reduce the listing to ${remaining} birds or upgrade to Market. You can also click Save Draft to save the full listing without publishing it yet; drafts do not count against your active-bird allowance.`;
}

function isCoopAllowanceDatabaseError(message: string) {
  return message.includes("Coop includes up to 5 active birds");
}
