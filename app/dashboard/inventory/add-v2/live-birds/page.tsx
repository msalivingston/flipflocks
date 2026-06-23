"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSellerContext } from "../../../_components/seller-context";
import { DashboardPageContent } from "../../../_components/seller-ui";
import { BatchSummaryCard } from "./BatchSummaryCard";
import { BirdOfferingsCard } from "./BirdOfferingsCard";
import {
  defaultAvailableDate,
  defaultHatchDate,
  fallbackBreedOptions,
  fallbackSpeciesOptions,
  initialOfferings,
  liveBirdsV2DraftMarker,
  supportedSpeciesSlugs,
} from "./constants";
import { buildCreateLiveBirdsDraftPayload } from "./createDraftPayload";
import {
  getAgeAtAvailability,
  getNumberInputValue,
  getPriceRange,
  getReadinessChecks,
} from "./helpers";
import { HatchInformationCard } from "./HatchInformationCard";
import {
  buildLiveBirdsSavePayloadPreview,
  mapInventoryTypeToSoldAs,
  mapSoldAsToInventoryType,
} from "./payloadPreview";
import { ReadyToPublishCard } from "./ReadyToPublishCard";
import { ReviewPublishCard } from "./ReviewPublishCard";
import type { SaveDraftStatus } from "./ReviewPublishCard";
import { getSaveDraftPreflight } from "./saveDraftPreflight";
import { SavePreviewCard } from "./SavePreviewCard";
import type { BirdOffering, BreedOption, SpeciesOption } from "./types";

type SpeciesRow = {
  id: string;
  common_name: string;
  slug: string;
  sort_order: number | null;
};

type SellerBreedProfileRow = {
  id: string;
  species_id: string;
  display_name: string;
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
  internal_batch_label: string | null;
  listing_batch_visibility_status: string;
  listing_batch_breed_sort_order: number | null;
  listing_batch_breed_visibility_status: string;
  inventory_type: string;
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

export default function LiveBirdsV2Page() {
  const searchParams = useSearchParams();
  const draftId = searchParams.get("draftId");
  const { seller } = useSellerContext();
  const nextOfferingId = useRef(initialOfferings.length + 1);
  const nextPhotoId = useRef(4);
  const [species, setSpecies] = useState<SpeciesOption>(
    fallbackSpeciesOptions[0],
  );
  const [speciesOptions, setSpeciesOptions] = useState<SpeciesOption[]>(
    fallbackSpeciesOptions,
  );
  const [sellerBreedProfileOptions, setSellerBreedProfileOptions] = useState<
    BreedOption[]
  >([]);
  const [referenceDataLoading, setReferenceDataLoading] = useState(true);
  const [referenceDataError, setReferenceDataError] = useState<string | null>(
    null,
  );
  const [draftLoadError, setDraftLoadError] = useState<string | null>(null);
  const [draftLoading, setDraftLoading] = useState(Boolean(draftId));
  const [loadedDraftSpeciesId, setLoadedDraftSpeciesId] = useState<
    string | null
  >(null);
  const [loadedDraftId, setLoadedDraftId] = useState<string | null>(null);
  const [saveDraftMessage, setSaveDraftMessage] = useState<string | null>(null);
  const [saveDraftStatus, setSaveDraftStatus] =
    useState<SaveDraftStatus>("idle");
  const [savedListingBatchId, setSavedListingBatchId] = useState<string | null>(
    null,
  );
  const [hatchDate, setHatchDate] = useState(defaultHatchDate);
  const [availableDate, setAvailableDate] = useState(defaultAvailableDate);
  const [offerings, setOfferings] = useState<BirdOffering[]>(initialOfferings);
  const breedOptions = useMemo(
    () => getBreedOptionsForSpecies(sellerBreedProfileOptions, species),
    [sellerBreedProfileOptions, species],
  );
  const usingFallbackSpecies = speciesOptions.every((option) => option.id === null);
  const usingFallbackBreeds = breedOptions.every((option) => option.id === null);
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
  const priceRange = useMemo(() => getPriceRange(offerings), [offerings]);
  const duplicateOfferingIds = useMemo(
    () => getDuplicateBreedSoldAsOfferingIds(offerings),
    [offerings],
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
  const saveDraftPreflight = useMemo(
    () =>
      getSaveDraftPreflight({
        availableDate,
        hatchDate,
        offerings,
        species,
        usingFallbackBreeds,
        usingFallbackSpecies,
      }),
    [
      availableDate,
      hatchDate,
      offerings,
      species,
      usingFallbackBreeds,
      usingFallbackSpecies,
    ],
  );
  const isLoadedDraft = loadedDraftId !== null;
  const saveDraftDisabledReason = isLoadedDraft
    ? getLoadedDraftSaveDisabledReason({
        loadedDraftSpeciesId,
        speciesId: species.id,
      })
    : null;

  useEffect(() => {
    let isMounted = true;

    async function loadPageData() {
      if (!seller) return;

      setReferenceDataLoading(true);
      setDraftLoading(Boolean(draftId));
      setReferenceDataError(null);
      setDraftLoadError(null);

      const [speciesResult, profileResult] = await Promise.all([
        supabase
          .from("species")
          .select("id, common_name, slug, sort_order")
          .eq("is_active", true)
          .order("sort_order", { ascending: true })
          .order("common_name", { ascending: true })
          .returns<SpeciesRow[]>(),
        supabase
          .from("seller_breed_profiles")
          .select("id, species_id, display_name")
          .eq("store_id", seller.store_id)
          .eq("visibility_status", "active")
          .eq("moderation_status", "normal")
          .order("display_name", { ascending: true })
          .returns<SellerBreedProfileRow[]>(),
      ]);

      if (!isMounted) return;

      const loadError = speciesResult.error ?? profileResult.error;

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
      const loadedBreedOptions = (profileResult.data ?? []).map((row) => ({
        id: row.id,
        label: row.display_name,
        speciesId: row.species_id,
      }));
      const draftRows = draftId
        ? await loadDraftRows({
            draftId,
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
      const selectedSpecies =
        nextSpecies ??
        nextSpeciesOptions.find((option) => option.slug === "chicken") ??
        nextSpeciesOptions[0] ??
        fallbackSpeciesOptions[0];
      const nextSellerBreedProfileOptions = draftRows?.rows
        ? mergeDraftBreedOptions(loadedBreedOptions, draftRows.rows)
        : loadedBreedOptions;
      const nextBreedOptions = getBreedOptionsForSpecies(
        nextSellerBreedProfileOptions,
        selectedSpecies,
      );

      setSpeciesOptions(nextSpeciesOptions);
      setSellerBreedProfileOptions(nextSellerBreedProfileOptions);
      setSpecies(selectedSpecies);

      if (draftRows) {
        const loadedOfferings = getOfferingsFromDraftRows(draftRows.rows);

        setLoadedDraftId(draftId);
        setLoadedDraftSpeciesId(draftRows.rows[0]?.species_id ?? null);
        setHatchDate(draftRows.rows[0]?.origin_date ?? "");
        setAvailableDate(draftRows.rows[0]?.available_date ?? "");
        setOfferings(loadedOfferings);
        nextOfferingId.current = loadedOfferings.length + 1;
        nextPhotoId.current = 1;
        setSaveDraftStatus("idle");
        setSaveDraftMessage(null);
        setSavedListingBatchId(null);
      } else {
        setLoadedDraftId(null);
        setLoadedDraftSpeciesId(null);
        setHatchDate(defaultHatchDate);
        setAvailableDate(defaultAvailableDate);
        setOfferings(alignOfferingsToBreedOptions(initialOfferings, nextBreedOptions));
        nextOfferingId.current = initialOfferings.length + 1;
        nextPhotoId.current = 4;
        setSaveDraftStatus("idle");
        setSaveDraftMessage(null);
        setSavedListingBatchId(null);
      }

      setReferenceDataLoading(false);
      setDraftLoading(false);
    }

    void loadPageData();

    return () => {
      isMounted = false;
    };
  }, [draftId, seller]);

  function createLocalOfferingId() {
    const offeringId = `offering-${nextOfferingId.current}`;
    nextOfferingId.current += 1;

    return offeringId;
  }

  function createLocalPhotoId() {
    const photoId = `photo-${nextPhotoId.current}`;
    nextPhotoId.current += 1;

    return photoId;
  }

  function selectSpecies(nextSpecies: SpeciesOption) {
    const nextBreedOptions = getBreedOptionsForSpecies(
      sellerBreedProfileOptions,
      nextSpecies,
    );

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

  function toggleOfferingExpanded(offeringId: string) {
    setOfferings((currentOfferings) =>
      currentOfferings.map((offering) =>
        offering.id === offeringId
          ? { ...offering, expanded: !offering.expanded }
          : offering,
      ),
    );
  }

  function addOffering() {
    const offeringId = createLocalOfferingId();
    const defaultBreed = breedOptions[0] ?? fallbackBreedOptions[0];

    setOfferings((currentOfferings) => [
      ...currentOfferings.map((offering) => ({
        ...offering,
        expanded: false,
      })),
      {
        id: offeringId,
        sellerBreedProfileId: defaultBreed.id,
        breed: defaultBreed.label,
        soldAs: "Straight run",
        quantity: "0",
        price: "0",
        description: "",
        expanded: true,
        photos: [],
      },
    ]);
  }

  function addPlaceholderPhoto(offeringId: string) {
    const photoId = createLocalPhotoId();

    setOfferings((currentOfferings) =>
      currentOfferings.map((offering) => {
        if (offering.id !== offeringId) return offering;

        const hasFeaturedPhoto = offering.photos.some(
          (photo) => photo.isFeatured,
        );

        return {
          ...offering,
          photos: [
            ...offering.photos,
            {
              id: photoId,
              label: `Photo ${offering.photos.length + 1}`,
              isFeatured: !hasFeaturedPhoto,
            },
          ],
        };
      }),
    );
  }

  function removePlaceholderPhoto(offeringId: string, photoId: string) {
    setOfferings((currentOfferings) =>
      currentOfferings.map((offering) => {
        if (offering.id !== offeringId) return offering;

        const removedPhoto = offering.photos.find(
          (photo) => photo.id === photoId,
        );
        const remainingPhotos = offering.photos.filter(
          (photo) => photo.id !== photoId,
        );

        if (!removedPhoto?.isFeatured) {
          return {
            ...offering,
            photos: remainingPhotos,
          };
        }

        return {
          ...offering,
          photos: remainingPhotos.map((photo, index) => ({
            ...photo,
            isFeatured: index === 0,
          })),
        };
      }),
    );
  }

  function setFeaturedPhoto(offeringId: string, photoId: string) {
    setOfferings((currentOfferings) =>
      currentOfferings.map((offering) =>
        offering.id === offeringId
          ? {
              ...offering,
              photos: offering.photos.map((photo) => ({
                ...photo,
                isFeatured: photo.id === photoId,
              })),
            }
          : offering,
      ),
    );
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

      return nextOfferings.map((offering, index) => ({
        ...offering,
        expanded: index === 0,
      }));
    });
  }

  async function handleSaveDraft() {
    if (
      !saveDraftPreflight.canSaveDraft ||
      saveDraftStatus === "saving" ||
      savedListingBatchId ||
      (isLoadedDraft && saveDraftDisabledReason)
    ) {
      return;
    }

    if (!seller?.store_id) {
      setSaveDraftStatus("error");
      setSaveDraftMessage("The store context is missing. The draft was not saved.");
      return;
    }

    if (isLoadedDraft && loadedDraftId) {
      await updateLoadedDraft({
        draftId: loadedDraftId,
        storeId: seller.store_id,
      });
      return;
    }

    const payload = buildCreateLiveBirdsDraftPayload({
      availableDate,
      hatchDate,
      offerings,
      species,
      storeId: seller.store_id,
    });

    if (!payload) {
      setSaveDraftStatus("error");
      setSaveDraftMessage("The draft payload could not be prepared.");
      return;
    }

    setSaveDraftStatus("saving");
    setSaveDraftMessage(null);

    const createResult = await supabase.rpc(
      "seller_create_listing_batch_with_inventory",
      payload,
    );

    if (createResult.error) {
      setSaveDraftStatus("error");
      setSaveDraftMessage(
        `Draft could not be saved. ${createResult.error.message}`,
      );
      return;
    }

    const createdRows = Array.isArray(createResult.data)
      ? (createResult.data as CreateDraftResult[])
      : [];
    const createdDraft = createdRows[0];

    if (!createdDraft?.listing_batch_id) {
      setSaveDraftStatus("error");
      setSaveDraftMessage("Draft could not be saved. No draft ID was returned.");
      return;
    }

    setSavedListingBatchId(createdDraft.listing_batch_id);
    setSaveDraftStatus("success");
    setSaveDraftMessage("Draft saved. It is not published yet.");
  }

  async function updateLoadedDraft({
    draftId,
    storeId,
  }: {
    draftId: string;
    storeId: string;
  }) {
    setSaveDraftStatus("saving");
    setSaveDraftMessage(null);

    const draftRowsResult = await loadDraftRows({ draftId, storeId });

    if ("error" in draftRowsResult) {
      setSaveDraftStatus("error");
      setSaveDraftMessage(`Draft could not be updated. ${draftRowsResult.error}`);
      return;
    }

    const currentRows = draftRowsResult.rows;
    const currentSpeciesId = currentRows[0]?.species_id ?? null;

    if (!species.id || species.id !== currentSpeciesId) {
      setSaveDraftStatus("error");
      setSaveDraftMessage(
        "Draft could not be updated. Changing species on saved drafts is coming next.",
      );
      return;
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
      setSaveDraftStatus("error");
      setSaveDraftMessage(
        `Draft could not be updated. ${batchResult.error.message}`,
      );
      return;
    }

    const synced = await syncDraftOfferings({
      basePrice,
      currentRows,
      draftId,
      offerings,
    });

    if (!synced.ok) {
      setSaveDraftStatus("error");
      setSaveDraftMessage(`Draft could not be updated. ${synced.message}`);
      return;
    }

    const refreshedRows = await loadDraftRows({ draftId, storeId });

    if ("rows" in refreshedRows) {
      const loadedOfferings = getOfferingsFromDraftRows(refreshedRows.rows);

      setOfferings(loadedOfferings);
      nextOfferingId.current = loadedOfferings.length + 1;
      setHatchDate(refreshedRows.rows[0]?.origin_date ?? hatchDate);
      setAvailableDate(refreshedRows.rows[0]?.available_date ?? availableDate);
    }

    setSaveDraftStatus("success");
    setSaveDraftMessage("Draft updated. It is not published yet.");
  }

  return (
    <DashboardPageContent className="bg-stone-50/60">
      <div className="max-w-7xl">
        <header className="mb-5">
          <Link
            className="inline-flex text-sm font-semibold text-emerald-800 underline-offset-4 hover:underline"
            href="/dashboard/inventory/add-v2"
          >
            Inventory / Add Inventory
          </Link>
          <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h1 className="text-3xl font-semibold text-stone-950">
                Add Live Birds
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
                Add birds from one hatch date, then create one or more bird
                offerings from that batch.
              </p>
              {isLoadedDraft ? (
                <p className="mt-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-800">
                  Draft loaded. Save Draft updates this hidden draft.
                </p>
              ) : null}
            </div>
            <span className="inline-flex w-fit rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
              {isLoadedDraft ? "Loaded draft" : "Draft not saved yet"}
            </span>
          </div>
        </header>

        {draftLoading ? (
          <div className="rounded-lg border border-stone-200 bg-white px-5 py-8 text-sm font-semibold text-stone-600 shadow-sm">
            Loading saved draft...
          </div>
        ) : draftLoadError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-5 py-5 shadow-sm">
            <h2 className="text-base font-semibold text-red-950">
              Draft could not be loaded
            </h2>
            <p className="mt-2 text-sm leading-6 text-red-800">
              {draftLoadError}
            </p>
          </div>
        ) : (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <main className="space-y-4">
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
                speciesOptions={speciesOptions}
                usingFallbackSpecies={usingFallbackSpecies}
              />
              <BirdOfferingsCard
                addOffering={addOffering}
                addPlaceholderPhoto={addPlaceholderPhoto}
                breedOptions={breedOptions}
                breedOptionsMessage={breedOptionsMessage}
                duplicateOfferingIds={duplicateOfferingIds}
                offerings={offerings}
                removeOffering={removeOffering}
                removePlaceholderPhoto={removePlaceholderPhoto}
                setFeaturedPhoto={setFeaturedPhoto}
                toggleOfferingExpanded={toggleOfferingExpanded}
                updateOffering={updateOffering}
              />
              <ReviewPublishCard
                availableDate={availableDate}
                birdsTotal={birdsTotal}
                hatchDate={hatchDate}
                onSaveDraft={handleSaveDraft}
                offeringCount={offerings.length}
                priceRange={priceRange}
                saveDraftMessage={
                  saveDraftPreflight.canSaveDraft
                    ? saveDraftMessage ?? saveDraftDisabledReason
                    : saveDraftDisabledReason
                }
                saveDraftDisabledReason={saveDraftDisabledReason}
                saveDraftPreflight={saveDraftPreflight}
                saveDraftStatus={saveDraftStatus}
                species={species.label}
              />
              {process.env.NODE_ENV === "development" ? (
                <SavePreviewCard payloadPreview={savePayloadPreview} />
              ) : null}
            </main>

            <aside className="space-y-4">
              <BatchSummaryCard
                birdsTotal={birdsTotal}
                hatchDate={hatchDate}
                offeringCount={offerings.length}
              />
              <ReadyToPublishCard
                onSaveDraft={handleSaveDraft}
                readiness={readiness}
                saveDraftDisabledReason={saveDraftDisabledReason}
                saveDraftPreflight={saveDraftPreflight}
                saveDraftStatus={saveDraftStatus}
              />
            </aside>
          </div>
        )}
      </div>
    </DashboardPageContent>
  );
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
        message: `Bird Offering ${index + 1} is missing a breed profile ID.`,
      };
    }

    const inventoryType = mapSoldAsToInventoryType(offering.soldAs);

    if (inventoryType === "unknown") {
      return {
        ok: false,
        message: `Bird Offering ${index + 1} has an unsupported sold-as type.`,
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
          message: "The breed group could not be prepared.",
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
        p_custom_inventory_label: null,
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
        p_custom_inventory_label: null,
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

async function loadDraftRows({
  draftId,
  storeId,
}: {
  draftId: string;
  storeId: string;
}): Promise<{ rows: DraftInventoryRow[] } | { error: string }> {
  const { data, error } = await supabase
    .from("seller_inventory_management")
    .select(
      "listing_batch_id, listing_batch_breed_id, inventory_item_id, species_id, species_name, species_slug, seller_breed_profile_id, breed_display_name, batch_type, origin_date, available_date, base_price, internal_batch_label, listing_batch_visibility_status, listing_batch_breed_sort_order, listing_batch_breed_visibility_status, inventory_type, quantity_available, price_override, inventory_item_sort_order, inventory_visibility_status",
    )
    .eq("store_id", storeId)
    .eq("listing_batch_id", draftId)
    .eq("batch_type", "live_animals")
    .eq("listing_batch_visibility_status", "hidden")
    .eq("internal_batch_label", liveBirdsV2DraftMarker)
    .order("listing_batch_breed_sort_order", { ascending: true })
    .order("inventory_item_sort_order", { ascending: true })
    .returns<DraftInventoryRow[]>();

  if (error) {
    return { error: error.message };
  }

  if (!data || data.length === 0) {
    return {
      error:
        "This draft was not found, is not a hidden Live Birds v2 draft, or is not available for this store.",
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

function mergeDraftSpeciesOptions(
  speciesOptions: SpeciesOption[],
  draftSpecies: SpeciesOption,
) {
  if (speciesOptions.some((option) => option.id === draftSpecies.id)) {
    return speciesOptions;
  }

  return [...speciesOptions, draftSpecies];
}

function mergeDraftBreedOptions(
  breedOptions: BreedOption[],
  rows: DraftInventoryRow[],
) {
  const optionsById = new Map<string, BreedOption>();

  breedOptions.forEach((option) => {
    if (!option.id) return;

    optionsById.set(option.id, option);
  });

  rows.forEach((row) => {
    if (optionsById.has(row.seller_breed_profile_id)) return;

    optionsById.set(row.seller_breed_profile_id, {
      id: row.seller_breed_profile_id,
      label: row.breed_display_name,
      speciesId: row.species_id,
    });
  });

  return Array.from(optionsById.values());
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
      breed: row.breed_display_name,
      soldAs: mapInventoryTypeToSoldAs(row.inventory_type),
      quantity: String(row.quantity_available ?? 0),
      price: String(row.price_override ?? row.base_price ?? 0),
      description: "",
      expanded: index === 0,
      photos: [],
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

function findBreedOptionByLabel(options: BreedOption[], label: string) {
  const normalizedLabel = label.trim().toLowerCase();

  return (
    options.find(
      (option) => option.label.trim().toLowerCase() === normalizedLabel,
    ) ?? null
  );
}

function getBreedOptionsForSpecies(
  sellerBreedProfileOptions: BreedOption[],
  species: SpeciesOption,
) {
  const realOptionsForSpecies = species.id
    ? sellerBreedProfileOptions.filter(
        (option) => option.speciesId === species.id,
      )
    : sellerBreedProfileOptions;

  return realOptionsForSpecies.length > 0
    ? realOptionsForSpecies
    : fallbackBreedOptions;
}

function alignOfferingsToBreedOptions(
  offerings: BirdOffering[],
  breedOptions: BreedOption[],
) {
  let changed = false;
  const nextOfferings = offerings.map((offering, index) => {
    const matchingOption =
      findBreedOptionById(breedOptions, offering.sellerBreedProfileId) ??
      findBreedOptionByLabel(breedOptions, offering.breed) ??
      breedOptions[index] ??
      breedOptions[0];

    if (!matchingOption) return offering;

    if (
      offering.sellerBreedProfileId === matchingOption.id &&
      offering.breed === matchingOption.label
    ) {
      return offering;
    }

    changed = true;

    return {
      ...offering,
      breed: matchingOption.label,
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
