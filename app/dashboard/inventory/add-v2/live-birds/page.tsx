"use client";

import Link from "next/link";
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
  supportedSpeciesSlugs,
} from "./constants";
import {
  getAgeAtAvailability,
  getNumberInputValue,
  getPriceRange,
  getReadinessChecks,
} from "./helpers";
import { HatchInformationCard } from "./HatchInformationCard";
import { buildLiveBirdsSavePayloadPreview } from "./payloadPreview";
import { ReadyToPublishCard } from "./ReadyToPublishCard";
import { ReviewPublishCard } from "./ReviewPublishCard";
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

export default function LiveBirdsV2Page() {
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

  useEffect(() => {
    let isMounted = true;

    async function loadReferenceData() {
      if (!seller) return;

      setReferenceDataLoading(true);
      setReferenceDataError(null);

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
        return;
      }

      const loadedSpecies = (speciesResult.data ?? [])
        .filter((row) => supportedSpeciesSlugs.includes(row.slug))
        .map((row) => ({
          id: row.id,
          label: row.common_name,
          slug: row.slug,
        }));
      const nextSpeciesOptions =
        loadedSpecies.length > 0 ? loadedSpecies : fallbackSpeciesOptions;
      const loadedBreedOptions = (profileResult.data ?? []).map((row) => ({
        id: row.id,
        label: row.display_name,
        speciesId: row.species_id,
      }));
      const nextSpecies =
        nextSpeciesOptions.find((option) => option.slug === "chicken") ??
        nextSpeciesOptions[0] ??
        fallbackSpeciesOptions[0];
      const nextBreedOptions = getBreedOptionsForSpecies(
        loadedBreedOptions,
        nextSpecies,
      );

      setSpeciesOptions(nextSpeciesOptions);
      setSellerBreedProfileOptions(loadedBreedOptions);
      setSpecies(nextSpecies);
      setOfferings((currentOfferings) =>
        alignOfferingsToBreedOptions(currentOfferings, nextBreedOptions),
      );
      setReferenceDataLoading(false);
    }

    void loadReferenceData();

    return () => {
      isMounted = false;
    };
  }, [seller]);

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
            </div>
            <span className="inline-flex w-fit rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
              Draft not saved yet
            </span>
          </div>
        </header>

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
              offeringCount={offerings.length}
              priceRange={priceRange}
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
            <ReadyToPublishCard readiness={readiness} />
          </aside>
        </div>
      </div>
    </DashboardPageContent>
  );
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
