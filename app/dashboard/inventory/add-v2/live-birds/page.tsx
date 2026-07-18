"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getPlanCapabilities } from "@/lib/plan-capabilities";
import { useSellerContext } from "../../../_components/seller-context";
import { DashboardPageContent } from "../../../_components/seller-ui";
import {
  breedLibrarySelect,
  pickFeaturedMedia,
  restoreCatalogDefaultPhotoBestEffort,
  sellerBreedProfileSelect,
  sellerMediaSelect,
  toDisplayImageUrl,
  type BreedLibraryItem,
  type SellerBreedProfile,
} from "../../../breeds/breed-data";
import type { ListingPhotoItem } from "../../../listings/[listingBatchId]/listing-photos-section";
import { BatchSummaryCard } from "./BatchSummaryCard";
import { BirdOfferingsCard } from "./BirdOfferingsCard";
import { AgeBasedPriceChangesCard } from "./AgeBasedPriceChangesCard";
import {
  fallbackBreedOptions,
  fallbackSpeciesOptions,
  initialOfferings,
  liveBirdsV2DraftMarker,
  supportedSpeciesSlugs,
} from "./constants";
import { buildCreateLiveBirdsDraftPayload } from "./createDraftPayload";
import {
  areAllReadinessChecksComplete,
  getAgeAtAvailability,
  getBirdsForSaleGroupCount,
  getNumberInputValue,
  getReadinessChecks,
} from "./helpers";
import { HatchInformationCard } from "./HatchInformationCard";
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
import { ReadyToPublishCard } from "./ReadyToPublishCard";
import { ReviewPublishCard } from "./ReviewPublishCard";
import type { PublishStatus, SaveDraftStatus } from "./ReviewPublishCard";
import { getSaveDraftPreflight } from "./saveDraftPreflight";
import { SavePreviewCard } from "./SavePreviewCard";
import { SidebarCard } from "./SidebarCard";
import type {
  BirdOffering,
  BreedOption,
  PriceAdjustmentState,
  PublishValidationIssue,
  SpeciesOption,
} from "./types";

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

type CreateDraftResult = {
  listing_batch_id: string;
  visibility_status: string;
};

type BatchBreedResult = {
  id: string;
};

type InventoryItemResult = {
  id: string;
};

type ReservationRow = {
  inventory_item_id: string | null;
  remaining_unfulfilled_quantity: number | null;
};

type BreedProfileUpsertResult = {
  seller_breed_profile_id?: string | null;
};

type EditSaveStatus = "idle" | "saving" | "success" | "error";

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
  const [isStartOverDialogOpen, setIsStartOverDialogOpen] = useState(false);
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
  const [scrollToOfferingId, setScrollToOfferingId] = useState<string | null>(
    null,
  );
  const [groupsReviewMode, setGroupsReviewMode] = useState(false);
  const [customBreedOfferingId, setCustomBreedOfferingId] = useState<
    string | null
  >(null);
  const [customBreedName, setCustomBreedName] = useState("");
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
  const birdsTotal = offerings.reduce(
    (total, offering) => total + getNumberInputValue(offering.quantity),
    0,
  );
  const birdsForSaleGroupCount = useMemo(
    () => getBirdsForSaleGroupCount(offerings),
    [offerings],
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
  const duplicateOfferingIds = useMemo(
    () => getDuplicateBreedSoldAsOfferingIds(offerings),
    [offerings],
  );
  const birdsForSaleStepLocked = isEditMode
    ? false
    : isBirdsForSaleStepLocked({ availableDate, hatchDate, species });
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
    currentFormSnapshot !== savedFormSnapshot;
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
        setPriceAdjustment(loadedPriceAdjustment);
        setOfferings(loadedOfferings);
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
        setPriceAdjustment(defaultPriceAdjustment);
        setOfferings(blankOfferings);
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
  }, [draftId, mode, seller]);

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
        setCustomBreedName("");
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
    const nextBreedOptions = getBreedOptionsForSpecies({
      catalogBreeds,
      mediaItems: breedMediaItems,
      sellerBreedProfiles,
      species: nextSpecies,
    });

    setSpecies(nextSpecies);
    setOfferings((currentOfferings) =>
      alignOfferingsToBreedOptions(currentOfferings, nextBreedOptions),
    );
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
    setCustomBreedName("");
    setCustomBreedError(null);
    setCustomBreedDuplicate(null);
  }

  function closeCustomBreedModal() {
    if (customBreedSaving) return;

    setCustomBreedOfferingId(null);
    setCustomBreedName("");
    setCustomBreedError(null);
    setCustomBreedDuplicate(null);
  }

  function updateCustomBreedName(value: string) {
    setCustomBreedName(value);
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

    const trimmedName = customBreedName.trim();

    if (!species.id) {
      setCustomBreedError("Select a species before adding a custom breed.");
      return;
    }

    if (!trimmedName) {
      setCustomBreedError("Enter a breed name.");
      return;
    }

    const duplicateOption = findDuplicateBreedOption({
      breedOptions,
      name: trimmedName,
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
      breedName: trimmedName,
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
        expanded: groupsReviewMode ? false : offering.expanded,
      })),
      {
        ...createBlankOffering(offeringId),
        expanded: groupsReviewMode,
      },
    ]);
    setGroupsReviewMode(false);

    if (groupsReviewMode) {
      setScrollToOfferingId(offeringId);
    }
  }

  function finishAddingGroups() {
    setGroupsReviewMode(true);
    setOfferings((currentOfferings) =>
      currentOfferings.map((offering) => ({ ...offering, expanded: false })),
    );
  }

  function focusPublishValidationIssue(issue: PublishValidationIssue) {
    if (issue.target.type === "hatch") {
      const fieldSelector = `[data-live-birds-field="${issue.target.field}"]`;
      const field = document.querySelector<HTMLElement>(fieldSelector);

      field?.scrollIntoView({ block: "center", behavior: "smooth" });
      field?.focus({ preventScroll: true });
      return;
    }

    setGroupsReviewMode(false);
    const offeringId = issue.target.offeringId;

    setOfferings((currentOfferings) =>
      currentOfferings.map((offering) => ({
        ...offering,
        expanded: offering.id === offeringId,
      })),
    );
    setScrollToOfferingId(offeringId);
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

  async function saveBreedDescriptionsToLibrary({ storeId }: { storeId: string }) {
    const descriptionsByProfileId = new Map<string, string>();

    offerings.forEach((offering) => {
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
        p_bird_type: profile.bird_type,
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
    storeId,
  }: {
    storeId: string;
  }): Promise<{ ok: true; listingBatchId: string } | { ok: false; message: string }> {
    const payload = buildCreateLiveBirdsDraftPayload({
      availableDate,
      hatchDate,
      offerings,
      species,
      storeId,
    });

    if (!payload) {
      return { ok: false, message: "The draft payload could not be prepared." };
    }

    const descriptionResult = await saveBreedDescriptionsToLibrary({ storeId });

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

    return { ok: true, listingBatchId: createdDraft.listing_batch_id };
  }

  async function updateHiddenDraft({
    draftId,
    storeId,
  }: {
    draftId: string;
    storeId: string;
  }): Promise<{ ok: true; listingBatchId: string } | { ok: false; message: string }> {
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

    const descriptionResult = await saveBreedDescriptionsToLibrary({ storeId });

    if (!descriptionResult.ok) {
      return {
        ok: false,
        message: `Breed description could not be updated. ${descriptionResult.message}`,
      };
    }

    const basePrice = getBasePriceForOfferings(offerings);
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
      offerings,
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

    return { ok: true, listingBatchId: draftId };
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
      return;
    }

    const loadedOfferings = alignOfferingsToBreedOptions(
      getOfferingsFromDraftRows(refreshedRows.rows),
      breedOptions,
    );
    const loadedHatchDate = refreshedRows.rows[0]?.origin_date ?? "";
    const loadedAvailableDate = refreshedRows.rows[0]?.available_date ?? "";
    const loadedPriceAdjustment = hydratePriceAdjustment(refreshedRows.rows[0]);

    setOfferings(loadedOfferings);
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
  }

  async function saveEditedListing({
    storeId,
  }: {
    storeId: string;
  }): Promise<
    | { ok: true }
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
    const reservationResult = await loadActiveReservationMap(
      currentRows.map((row) => row.inventory_item_id),
    );

    if (!reservationResult.ok) {
      return { ok: false, message: reservationResult.message };
    }

    const editValidationIssue = getEditCurrentRowsValidationIssue({
      currentRows,
      loadedSpeciesId: loadedDraftSpeciesId,
      offerings,
      reservationMap: reservationResult.reservationMap,
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

    return { ok: true };
  }

  async function saveCurrentHiddenDraft({
    draftId,
    storeId,
  }: {
    draftId: string | null;
    storeId: string;
  }) {
    return draftId
      ? updateHiddenDraft({ draftId, storeId })
      : createHiddenDraft({ storeId });
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

    setSaveDraftStatus("saving");
    setSaveDraftMessage(null);

    const saveResult = await saveCurrentHiddenDraft({
      draftId: currentSavedDraftId,
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
    setSaveDraftStatus("success");
    setSaveDraftMessage(
      currentSavedDraftId
        ? "Draft updated. It is not published yet."
        : "Draft saved. It is not published yet.",
    );

    setSavedFormSnapshot(currentFormSnapshot);

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

    await refreshEditListingState({
      storeId: seller.store_id,
      updateSnapshot: true,
    });
    setEditSaveStatus("success");
    setEditSaveMessage("Changes saved");
  }

  async function handleReviewPublish() {
    if (
      publishDisabledReason ||
      publishStatus === "publishing" ||
      publishStatus === "success" ||
      saveDraftStatus === "saving"
    ) {
      return;
    }

    if (!seller?.store_id) {
      setPublishStatus("error");
      setPublishMessage("The store context is missing. Nothing was published.");
      return;
    }

    setPublishStatus("publishing");
    setPublishMessage(null);
    setSaveDraftMessage(null);

    const saveResult = await saveCurrentHiddenDraft({
      draftId: currentSavedDraftId,
      storeId: seller.store_id,
    });

    if (!saveResult.ok) {
      setPublishStatus("error");
      setPublishMessage(
        `Inventory could not be published. ${saveResult.message}`,
      );
      return;
    }

    const publishResult = await supabase.rpc(
      "seller_set_listing_batch_visibility",
      {
        p_listing_batch_id: saveResult.listingBatchId,
        p_visibility_status: "active",
        p_note: "Published from Add Inventory v2.",
      },
    );

    if (publishResult.error) {
      setPublishStatus("error");
      setPublishMessage(`Draft could not be published. ${publishResult.error.message}`);
      return;
    }

    setPublishedListingBatchId(saveResult.listingBatchId);
    setPublishStatus("success");
    setPublishMessage("Published to storefront.");
    setSaveDraftMessage(null);
    setSavedFormSnapshot(currentFormSnapshot);
    router.push("/dashboard/inventory");
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
    setPriceAdjustment(defaultPriceAdjustment);
    setBreedPhotoActionMessage(null);
    setSaveDraftMessage(null);
    setSaveDraftStatus("idle");
    setPublishMessage(null);
    setPublishStatus("idle");
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
                {isEditMode ? "Edit Live Birds Listing" : "Add Live Birds"}
              </h1>
              <p className="mt-2 max-w-3xl text-base leading-7 text-stone-600 sm:text-sm sm:leading-6">
                {isEditMode
                  ? "Update the hatch information, bird groups, pricing, and buyer content for this listing."
                  : "Add birds from one hatch date, then create one or more groups for sale."}
              </p>
              {!isEditMode && isLoadedDraft ? (
                <p className="mt-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold leading-6 text-sky-800">
                  {isPublished
                    ? "Published to storefront."
                    : "Draft loaded. Save draft updates this saved draft."}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {isEditMode ? (
                <Link
                  className="inline-flex min-h-12 items-center rounded-md border border-stone-300 bg-white px-3 text-base font-bold text-stone-700 shadow-sm transition hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:ring-offset-2 sm:min-h-9 sm:text-sm sm:font-semibold"
                  href="/dashboard/inventory"
                >
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
                  isEditMode && hasMeaningfulUnsavedChanges
                    ? "border-amber-200 bg-amber-50 text-amber-800"
                    : isEditMode
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : isPublished
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-amber-200 bg-amber-50 text-amber-800"
                }`}
              >
                {isEditMode
                  ? hasMeaningfulUnsavedChanges
                    ? "Unsaved changes"
                    : "Changes saved"
                  : isPublished
                    ? "Published"
                    : isLoadedDraft
                      ? "Loaded draft"
                      : "Draft not saved yet"}
              </span>
            </div>
          </div>
        </header>

        {draftLoading ? (
          <div className="rounded-xl border border-transparent bg-white px-5 py-8 text-base font-semibold text-stone-600 shadow-none sm:rounded-lg sm:border-stone-200 sm:text-sm sm:shadow-sm">
            {isEditMode ? "Loading Live Birds listing..." : "Loading saved draft..."}
          </div>
        ) : draftLoadError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-5 py-5 shadow-sm">
            <h2 className="text-base font-semibold text-red-950">
              {isEditMode
                ? "Live Birds listing could not be loaded"
                : "Draft could not be loaded"}
            </h2>
            <p className="mt-2 text-base leading-7 text-red-800 sm:text-sm sm:leading-6">
              {draftLoadError}
            </p>
          </div>
        ) : (
          <div
            className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]"
            key={formResetKey}
          >
            <main className="space-y-4">
              {isEditMode && birdsForSaleGroupCount > 1 ? (
                <p className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-semibold leading-6 text-sky-900">
                  This listing includes multiple bird groups. Hatch date and
                  available date apply to all groups in this listing.
                </p>
              ) : null}
              <HatchInformationCard
                ageAtAvailability={ageAtAvailability}
                availableDate={availableDate}
                hatchDate={hatchDate}
                referenceError={referenceDataError}
                referenceLoading={referenceDataLoading}
                species={species}
                setAvailableDate={setAvailableDate}
                setHatchDate={setHatchDate}
                setSpecies={selectSpecies}
                speciesReadOnly={isEditMode}
                speciesOptions={speciesOptions}
                usingFallbackSpecies={usingFallbackSpecies}
                availableDateHelpText={
                  isEditMode
                    ? "This available date applies to every bird group in this listing."
                    : undefined
                }
                introText={
                  isEditMode
                    ? "Use a separate listing for birds with a different hatch date."
                    : undefined
                }
              />
              <BirdOfferingsCard
                addOffering={addOffering}
                breedMediaItemsByProfileId={breedMediaItemsByProfileId}
                breedOptions={breedOptions}
                breedOptionsMessage={breedOptionsMessage}
                canAddCustomBreed={Boolean(species.id)}
                duplicateOfferingIds={duplicateOfferingIds}
                groupsReviewMode={groupsReviewMode}
                offerings={offerings}
                onDoneAddingGroups={finishAddingGroups}
                onOpenCustomBreedModal={openCustomBreedModal}
                prepareBreedPhotoProfile={(offeringId) =>
                  void prepareBreedPhotoProfile(offeringId)
                }
                removeOffering={removeOffering}
                scrollToOfferingId={scrollToOfferingId}
                storeId={seller?.store_id ?? ""}
                stepLocked={birdsForSaleStepLocked}
                toggleOfferingExpanded={toggleOfferingExpanded}
                updateBreedDescription={updateBreedDescription}
                updateOffering={updateOffering}
                updateOfferingBreed={updateOfferingBreed}
                onBreedPhotosChanged={() => void reloadBreedPhotos()}
                planKey={seller?.plan_key}
                mode={mode}
              />
              {breedPhotoActionMessage ? (
                <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold leading-6 text-emerald-900">
                  {breedPhotoActionMessage}
                </p>
              ) : null}
              <AgeBasedPriceChangesCard
                offerings={offerings}
                priceAdjustment={priceAdjustment}
                locked={!plan.ageBasedPricingEnabled}
                stepLocked={birdsForSaleStepLocked}
                updatePriceAdjustment={updatePriceAdjustment}
                introText={
                  isEditMode
                    ? "These price changes apply to this listing."
                    : undefined
                }
              />
              {isEditMode ? (
                <EditModeActionsCard
                  disabledReason={editSaveDisabledReason}
                  message={
                    hasMeaningfulUnsavedChanges &&
                    editSaveStatus === "success"
                      ? null
                      : editSaveMessage
                  }
                  onSave={handleSaveEdit}
                  status={editSaveStatus}
                />
              ) : (
                <ReviewPublishCard
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
                  stepLocked={birdsForSaleStepLocked}
                  validationIssues={publishValidationIssues}
                />
              )}
              {showDeveloperSavePreview ? (
                <SavePreviewCard payloadPreview={savePayloadPreview} />
              ) : null}
            </main>

            <aside className="hidden space-y-4 xl:block">
              <BatchSummaryCard
                birdsTotal={birdsTotal}
                hatchDate={hatchDate}
                offeringCount={birdsForSaleGroupCount}
              />
              {isEditMode ? (
                <EditModeSidebarCard
                  disabledReason={editSaveDisabledReason}
                  message={
                    hasMeaningfulUnsavedChanges &&
                    editSaveStatus === "success"
                      ? null
                      : editSaveMessage
                  }
                  onSave={handleSaveEdit}
                  status={editSaveStatus}
                />
              ) : (
                <ReadyToPublishCard
                  onReviewPublish={handleReviewPublish}
                  onSaveDraft={handleSaveDraft}
                  publishDisabledReason={publishDisabledReason}
                  publishStatus={publishStatus}
                  readiness={displayReadiness}
                  saveDraftDisabledReason={saveDraftDisabledReason}
                  saveDraftPreflight={saveDraftPreflight}
                  saveDraftStatus={saveDraftStatus}
                />
              )}
            </aside>
          </div>
        )}
      </div>
      {customBreedOfferingId ? (
        <CustomBreedDialog
          duplicateBreed={customBreedDuplicate}
          error={customBreedError}
          inputRef={customBreedInputRef}
          name={customBreedName}
          saving={customBreedSaving}
          onCancel={closeCustomBreedModal}
          onNameChange={updateCustomBreedName}
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
    </DashboardPageContent>
  );
}

function CustomBreedDialog({
  duplicateBreed,
  error,
  inputRef,
  name,
  saving,
  onCancel,
  onNameChange,
  onSubmit,
  onUseExisting,
}: {
  duplicateBreed: BreedOption | null;
  error: string | null;
  inputRef: { current: HTMLInputElement | null };
  name: string;
  saving: boolean;
  onCancel: () => void;
  onNameChange: (value: string) => void;
  onSubmit: () => void;
  onUseExisting: () => void;
}) {
  return (
    <div
      aria-labelledby="custom-breed-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/35 px-4"
      role="dialog"
    >
      <form
        className="w-full max-w-md rounded-lg border border-stone-200 bg-white p-5 shadow-xl"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <h2
          className="text-lg font-semibold text-stone-950"
          id="custom-breed-title"
        >
          Add custom breed
        </h2>
        <label className="mt-4 block">
          <span className="mb-1.5 block text-base font-bold text-stone-700 sm:text-xs sm:font-semibold sm:text-stone-600">
            Breed name
          </span>
          <input
            className="block min-h-12 w-full rounded-md border border-stone-300 bg-white px-3 text-base text-stone-950 shadow-sm outline-none transition placeholder:text-stone-400 focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20 sm:min-h-10 sm:text-sm"
            disabled={saving}
            ref={inputRef}
            type="text"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
          />
        </label>
        {error ? (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold leading-6 text-red-700">
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
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            className="inline-flex min-h-12 items-center rounded-md border border-stone-300 bg-white px-4 text-base font-bold text-stone-700 shadow-sm transition hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-10 sm:text-sm sm:font-semibold"
            disabled={saving}
            type="button"
            onClick={onCancel}
          >
            Cancel
          </button>
          {!duplicateBreed ? (
            <button
              className="inline-flex min-h-12 items-center rounded-md bg-emerald-800 px-4 text-base font-bold text-white shadow-sm transition hover:bg-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-emerald-800/45 sm:min-h-10 sm:text-sm sm:font-semibold"
              disabled={saving || name.trim().length === 0}
              type="submit"
            >
              {saving ? "Adding..." : "Add breed"}
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
        <p className="mt-2 text-base leading-7 text-stone-600 sm:text-sm sm:leading-6">
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

function EditModeActionsCard({
  disabledReason,
  message,
  onSave,
  status,
}: {
  disabledReason: string | null;
  message: string | null;
  onSave: () => void;
  status: EditSaveStatus;
}) {
  const isSaving = status === "saving";
  const isDisabled = Boolean(disabledReason) || isSaving;

  return (
    <section className="rounded-xl border border-transparent bg-white p-5 shadow-none sm:rounded-lg sm:border-stone-200 sm:shadow-sm">
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-stone-950">
            Ready to save?
          </h2>
          <p className="mt-1 text-base leading-7 text-stone-600 sm:text-sm sm:leading-6">
            Save listing-level details and updates to existing bird groups.
          </p>
        </div>
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
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold leading-6 text-amber-800">
            {disabledReason}
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Link
            className="inline-flex min-h-12 items-center justify-center rounded-md border border-stone-300 bg-white px-5 text-base font-bold text-stone-700 shadow-sm transition hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:ring-offset-2 sm:min-h-10 sm:text-sm sm:font-semibold"
            href="/dashboard/inventory"
          >
            Cancel
          </Link>
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

function EditModeSidebarCard({
  disabledReason,
  message,
  onSave,
  status,
}: {
  disabledReason: string | null;
  message: string | null;
  onSave: () => void;
  status: EditSaveStatus;
}) {
  const isSaving = status === "saving";
  const isDisabled = Boolean(disabledReason) || isSaving;

  return (
    <SidebarCard title="Ready to Save">
      {message ? (
        <p
          className={`rounded-md border px-3 py-2 text-base font-semibold sm:text-sm ${
            status === "error"
              ? "border-red-200 bg-red-50 text-red-800"
              : "border-emerald-200 bg-emerald-50 text-emerald-900"
          }`}
        >
          {message}
        </p>
      ) : disabledReason ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-base font-semibold text-amber-800 sm:text-sm">
          {disabledReason}
        </p>
      ) : (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-base font-semibold text-emerald-900 sm:text-sm">
          Ready to save.
        </p>
      )}
      <button
        className="mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-md bg-emerald-800 px-5 text-base font-bold text-white shadow-sm transition hover:bg-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-emerald-800/45 sm:min-h-10 sm:text-sm sm:font-semibold"
        disabled={isDisabled}
        onClick={onSave}
        type="button"
      >
        {isSaving ? "Saving..." : "Save Changes"}
      </button>
    </SidebarCard>
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
        <p className="mt-2 text-base leading-7 text-stone-600 sm:text-sm sm:leading-6">
          This inventory has not been saved. Save it as a draft before leaving?
        </p>
        {message ? (
          <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold leading-6 text-red-800">
            {message}
          </p>
        ) : null}
        {!canSaveDraft ? (
          <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold leading-6 text-amber-800">
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
    issues.push("This listing needs at least one bird group.");
  }

  offerings.forEach((offering, index) => {
    const label = `Group ${index + 1}`;
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
    ...getDuplicateEditOfferingIssues(offerings),
    ...getPriceAdjustmentIssues({ offerings, priceAdjustment }),
  ];
}

function getDuplicateEditOfferingIssues(offerings: BirdOffering[]) {
  const offeringLabelsByCombination = new Map<string, string[]>();

  offerings.forEach((offering, index) => {
    if (!offering.sellerBreedProfileId) return;

    const inventoryType = mapSoldAsToInventoryType(offering.soldAs);

    if (inventoryType === "unknown") return;

    const combinationKey = `${offering.sellerBreedProfileId}:${inventoryType}`;
    offeringLabelsByCombination.set(combinationKey, [
      ...(offeringLabelsByCombination.get(combinationKey) ?? []),
      `Group ${index + 1}`,
    ]);
  });

  return Array.from(offeringLabelsByCombination.values())
    .filter((offeringLabels) => offeringLabels.length > 1)
    .map(
      (offeringLabels) =>
        `${offeringLabels.join(" and ")} use the same breed and sale type.`,
    );
}

async function loadActiveReservationMap(inventoryItemIds: string[]) {
  const uniqueInventoryItemIds = Array.from(new Set(inventoryItemIds));
  const reservationMap = new Map<string, number>();

  if (uniqueInventoryItemIds.length === 0) {
    return { ok: true as const, reservationMap };
  }

  const { data, error } = await supabase
    .from("seller_order_item_detail")
    .select("inventory_item_id, remaining_unfulfilled_quantity")
    .in("inventory_item_id", uniqueInventoryItemIds)
    .returns<ReservationRow[]>();

  if (error) {
    return { ok: false as const, message: error.message };
  }

  (data ?? []).forEach((row) => {
    if (!row.inventory_item_id) return;

    reservationMap.set(
      row.inventory_item_id,
      (reservationMap.get(row.inventory_item_id) ?? 0) +
        Math.max(row.remaining_unfulfilled_quantity ?? 0, 0),
    );
  });

  return { ok: true as const, reservationMap };
}

function getEditCurrentRowsValidationIssue({
  currentRows,
  loadedSpeciesId,
  offerings,
  reservationMap,
  speciesId,
  sellerBreedProfiles,
}: {
  currentRows: DraftInventoryRow[];
  loadedSpeciesId: string | null;
  offerings: BirdOffering[];
  reservationMap: Map<string, number>;
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
    return "Adding groups to an existing listing is coming soon.";
  }

  if (
    activeRows.some((row) => !offeringInventoryIds.has(row.inventory_item_id))
  ) {
    return "Group removal is not available yet. Set quantity to 0 to stop selling this group.";
  }

  for (const offering of offerings) {
    if (
      offering.sellerBreedProfileId &&
      speciesId &&
      breedProfileSpeciesById.get(offering.sellerBreedProfileId) !== speciesId
    ) {
      return "Breed must belong to this listing species.";
    }

    if (!offering.inventoryItemId) continue;

    const reservedQuantity = reservationMap.get(offering.inventoryItemId) ?? 0;
    const nextQuantity = Number(offering.quantity);

    if (nextQuantity < reservedQuantity) {
      return "Quantity cannot be lower than the number already reserved in active orders.";
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
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const activeRowsByInventoryId = new Map(
    getActiveInventoryRows(currentRows).map(
      (row) => [row.inventory_item_id, row] as const,
    ),
  );
  const breedIdByProfileId = new Map<string, string>();
  const breedStatusById = new Map<string, string>();

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
        message: `Group ${index + 1} is missing a breed.`,
      };
    }

    if (inventoryType === "unknown") {
      return {
        ok: false,
        message: `Select how the birds in Group ${index + 1} will be sold.`,
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
            message: `Group ${index + 1} could not be prepared.`,
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

      continue;
    }

    const currentRow = activeRowsByInventoryId.get(offering.inventoryItemId);

    if (!currentRow) {
      return {
        ok: false,
        message: "This group is not currently active on the listing.",
      };
    }

    if (
      offering.sellerBreedProfileId !== currentRow.seller_breed_profile_id ||
      offering.listingBatchBreedId !== currentRow.listing_batch_breed_id
    ) {
      return {
        ok: false,
        message: "Changing a group's breed is coming soon.",
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

  return { ok: true };
}

function getActiveInventoryRows(rows: DraftInventoryRow[]) {
  return rows.filter(
    (row) =>
      row.inventory_visibility_status === "active" &&
      row.listing_batch_breed_visibility_status === "active",
  );
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
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const activeRows = currentRows.filter(
    (row) =>
      row.inventory_visibility_status === "active" &&
      row.listing_batch_breed_visibility_status === "active",
  );
  const retainedInventoryIds = new Set<string>();
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
        message: `Select a breed for Group ${index + 1}.`,
      };
    }

    const inventoryType = mapSoldAsToInventoryType(offering.soldAs);
    const customInventoryLabel = getCustomInventoryLabelForSoldAs(
      offering.soldAs,
    );

    if (inventoryType === "unknown") {
      return {
        ok: false,
        message: `Select how the birds in Group ${index + 1} will be sold.`,
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
          message: "The group could not be prepared.",
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

    const targetMatchingRow = currentRows.find(
      (row) =>
        !retainedInventoryIds.has(row.inventory_item_id) &&
        row.seller_breed_profile_id === offering.sellerBreedProfileId &&
        row.inventory_type === inventoryType,
    );
    const existingRow = activeRows.find(
      (row) =>
        row.inventory_item_id === offering.inventoryItemId &&
        row.seller_breed_profile_id === offering.sellerBreedProfileId &&
        !targetMatchingRow,
    );
    const rowToUpdate = targetMatchingRow ?? existingRow ?? null;

    if (rowToUpdate) {
      retainedInventoryIds.add(rowToUpdate.inventory_item_id);

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

      if (createdItem?.id) {
        retainedInventoryIds.add(createdItem.id);
      }
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

  return { ok: true };
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

function getPublishValidationIssues({
  availableDate,
  breedMediaItemsByProfileId,
  breedOptions,
  hatchDate,
  offerings,
  priceAdjustment,
  species,
}: {
  availableDate: string;
  breedMediaItemsByProfileId: Record<string, ListingPhotoItem[]>;
  breedOptions: BreedOption[];
  hatchDate: string;
  offerings: BirdOffering[];
  priceAdjustment: PriceAdjustmentState;
  species: SpeciesOption;
}): PublishValidationIssue[] {
  const issues: PublishValidationIssue[] = [];
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

  if (offerings.length === 0) {
    issues.push({
      id: "missing-groups",
      message: "Add at least one bird group.",
      target: { type: "hatch", field: "species" },
    });
  }

  offerings.forEach((offering, index) => {
    const groupLabel = `Group ${index + 1}`;
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
      quantity <= 0
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
    ...getDuplicatePublishValidationIssues(offerings),
    ...getPriceAdjustmentIssues({ offerings, priceAdjustment }).map(
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

function getDuplicatePublishValidationIssues(
  offerings: BirdOffering[],
): PublishValidationIssue[] {
  const offeringLabelsByCombination = new Map<
    string,
    Array<{ label: string; offeringId: string }>
  >();

  offerings.forEach((offering, index) => {
    if (!offering.sellerBreedProfileId) return;

    const inventoryType = mapSoldAsToInventoryType(offering.soldAs);

    if (inventoryType === "unknown") return;

    const combinationKey = `${offering.sellerBreedProfileId}:${inventoryType}`;
    offeringLabelsByCombination.set(combinationKey, [
      ...(offeringLabelsByCombination.get(combinationKey) ?? []),
      { label: `Group ${index + 1}`, offeringId: offering.id },
    ]);
  });

  return Array.from(offeringLabelsByCombination.values())
    .filter((offeringLabels) => offeringLabels.length > 1)
    .map((offeringLabels, index) => ({
      id: `duplicate-group-${index}`,
      message: `${formatGroupLabelList(
        offeringLabels.map((offeringLabel) => offeringLabel.label),
      )} use the same breed and sale type. Update one group before publishing.`,
      target: {
        type: "offering",
        offeringId: offeringLabels[0]?.offeringId ?? "",
      } as const,
    }));
}

function formatGroupLabelList(labels: string[]) {
  if (labels.length <= 2) return labels.join(" and ");

  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
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

function getBreedOptionsForSpecies({
  catalogBreeds,
  mediaItems,
  sellerBreedProfiles,
  species,
}: {
  catalogBreeds: BreedLibraryItem[];
  mediaItems: ListingPhotoItem[];
  sellerBreedProfiles: SellerBreedProfile[];
  species: SpeciesOption;
}) {
  const profilesForSpecies = species.id
    ? sellerBreedProfiles.filter((profile) => profile.species_id === species.id)
    : sellerBreedProfiles;
  const profilesByBreedId = new Map(
    profilesForSpecies
      .filter((profile) => profile.breed_id)
      .map((profile) => [profile.breed_id, profile] as const),
  );
  const catalogOptions = catalogBreeds
    .filter((breed) => !species.id || breed.species_id === species.id)
    .map((breed) => {
      const profile = profilesByBreedId.get(breed.id);

      if (profile) {
        return getBreedOptionForProfile({
          catalogBreeds,
          mediaItems,
          profile,
        });
      }

      return {
        id: null,
        label: breed.breed_name,
        speciesId: breed.species_id,
        breedId: breed.id,
        catalogImageUrl: breed.image_url,
        catalogDescription: breed.description,
        sellerPhotoUrl: null,
        sellerDescription: null,
        source: "catalog_breed" as const,
      };
    });
  const customProfileOptions = profilesForSpecies
    .filter((profile) => !profile.breed_id)
    .map((profile) =>
      getBreedOptionForProfile({
        catalogBreeds,
        mediaItems,
        profile,
      }),
    );
  const options = [...catalogOptions, ...customProfileOptions];

  return options.length > 0 ? options : fallbackBreedOptions;
}

function getBreedOptionForProfile({
  catalogBreeds,
  mediaItems,
  profile,
}: {
  catalogBreeds: BreedLibraryItem[];
  mediaItems: ListingPhotoItem[];
  profile: SellerBreedProfile;
}): BreedOption {
  const catalogBreed = profile.breed_id
    ? catalogBreeds.find((breed) => breed.id === profile.breed_id) ?? null
    : null;
  const profileMediaItems = mediaItems.filter(
    (item) => item.entity_id === profile.id,
  );
  const featuredMedia = pickFeaturedMedia(profileMediaItems);
  const sellerPhotoUrl = toDisplayImageUrl(featuredMedia?.public_url) || null;

  return {
    id: profile.id,
    label: profile.display_name || catalogBreed?.breed_name || "Breed",
    speciesId: profile.species_id,
    breedId: profile.breed_id,
    catalogImageUrl: catalogBreed?.image_url ?? null,
    catalogDescription: catalogBreed?.description ?? null,
    sellerPhotoUrl,
    sellerDescription: profile.seller_description,
    source: "seller_profile",
  };
}

function getBreedDescriptionFromOption(option: BreedOption | null | undefined) {
  return (
    option?.sellerDescription?.trim() ||
    option?.catalogDescription?.trim() ||
    ""
  );
}

function groupBreedMediaByProfileId(mediaItems: ListingPhotoItem[]) {
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

function getDuplicateBreedSoldAsOfferingIds(offerings: BirdOffering[]) {
  const offeringIdsByCombination = new Map<string, string[]>();

  offerings.forEach((offering) => {
    if (!offering.sellerBreedProfileId) return;

    const combinationKey = `${offering.sellerBreedProfileId}:${offering.soldAs}`;
    offeringIdsByCombination.set(combinationKey, [
      ...(offeringIdsByCombination.get(combinationKey) ?? []),
      offering.id,
    ]);
  });

  return new Set(
    Array.from(offeringIdsByCombination.values())
      .filter((offeringIds) => offeringIds.length > 1)
      .flat(),
  );
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

async function createSellerBreedProfileFromCatalogBreed({
  breedId,
  catalogBreeds,
  storeId,
}: {
  breedId: string;
  catalogBreeds: BreedLibraryItem[];
  storeId: string;
}): Promise<
  | { ok: true; profile: SellerBreedProfile }
  | { ok: false; message: string }
> {
  const catalogBreed = catalogBreeds.find((breed) => breed.id === breedId);

  if (!catalogBreed) {
    return { ok: false, message: "That catalog breed could not be found." };
  }

  const upsertResult = await supabase.rpc("seller_upsert_breed_profile", {
    p_breed_id: catalogBreed.id,
    p_custom_breed_name: null,
    p_display_name: catalogBreed.breed_name,
    p_annual_egg_production: catalogBreed.annual_egg_production,
    p_bird_type: catalogBreed.bird_type,
    p_egg_color: catalogBreed.egg_color,
    p_seller_breed_profile_id: null,
    p_seller_description: catalogBreed.description,
    p_seller_notes: null,
    p_species_id: catalogBreed.species_id,
    p_store_id: storeId,
    p_visibility_status: "active",
  });

  if (upsertResult.error) {
    return { ok: false, message: upsertResult.error.message };
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
      message: "The breed could not be added to your personal breed library.",
    };
  }

  const profileResult = await supabase
    .from("seller_breed_profiles")
    .select(sellerBreedProfileSelect)
    .eq("store_id", storeId)
    .eq("id", createdProfileId)
    .maybeSingle<SellerBreedProfile>();

  if (profileResult.error) {
    return { ok: false, message: profileResult.error.message };
  }

  if (!profileResult.data) {
    return {
      ok: false,
      message: "The new breed profile could not be loaded.",
    };
  }

  return { ok: true, profile: profileResult.data };
}

async function createSellerCustomBreedProfile({
  breedName,
  speciesId,
  storeId,
}: {
  breedName: string;
  speciesId: string;
  storeId: string;
}): Promise<
  | { ok: true; profile: SellerBreedProfile }
  | { ok: false; message: string }
> {
  const trimmedName = breedName.trim();
  const upsertResult = await supabase.rpc("seller_upsert_breed_profile", {
    p_breed_id: null,
    p_custom_breed_name: trimmedName,
    p_display_name: trimmedName,
    p_seller_breed_profile_id: null,
    p_seller_description: null,
    p_seller_notes: null,
    p_species_id: speciesId,
    p_store_id: storeId,
    p_visibility_status: "active",
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

function upsertSellerBreedProfile(
  profiles: SellerBreedProfile[],
  nextProfile: SellerBreedProfile,
) {
  const existingIndex = profiles.findIndex(
    (profile) => profile.id === nextProfile.id,
  );

  if (existingIndex === -1) {
    return [...profiles, nextProfile];
  }

  return profiles.map((profile, index) =>
    index === existingIndex ? nextProfile : profile,
  );
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
