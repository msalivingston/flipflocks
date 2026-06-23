"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { DashboardPageContent } from "../../../_components/seller-ui";
import { BatchSummaryCard } from "./BatchSummaryCard";
import { BirdOfferingsCard } from "./BirdOfferingsCard";
import {
  defaultAvailableDate,
  defaultHatchDate,
  initialOfferings,
} from "./constants";
import {
  getAgeAtAvailability,
  getNumberInputValue,
  getPriceRange,
  getReadinessChecks,
} from "./helpers";
import { HatchInformationCard } from "./HatchInformationCard";
import { ReadyToPublishCard } from "./ReadyToPublishCard";
import { ReviewPublishCard } from "./ReviewPublishCard";
import type { BirdOffering } from "./types";

export default function LiveBirdsV2Page() {
  const nextOfferingId = useRef(initialOfferings.length + 1);
  const [species, setSpecies] = useState("Chickens");
  const [hatchDate, setHatchDate] = useState(defaultHatchDate);
  const [availableDate, setAvailableDate] = useState(defaultAvailableDate);
  const [offerings, setOfferings] = useState<BirdOffering[]>(initialOfferings);
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
        species,
      }),
    [availableDate, hatchDate, offerings, species],
  );
  const priceRange = useMemo(() => getPriceRange(offerings), [offerings]);

  function createLocalOfferingId() {
    const offeringId = `offering-${nextOfferingId.current}`;
    nextOfferingId.current += 1;

    return offeringId;
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

    setOfferings((currentOfferings) => [
      ...currentOfferings.map((offering) => ({
        ...offering,
        expanded: false,
      })),
      {
        id: offeringId,
        breed: "Easter Egger",
        soldAs: "Straight run",
        quantity: "0",
        price: "0",
        description: "",
        expanded: true,
        photos: [],
      },
    ]);
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

  function duplicateOffering(offeringId: string) {
    const duplicatedOfferingId = createLocalOfferingId();

    setOfferings((currentOfferings) => {
      const sourceIndex = currentOfferings.findIndex(
        (offering) => offering.id === offeringId,
      );

      if (sourceIndex === -1) return currentOfferings;

      const sourceOffering = currentOfferings[sourceIndex];
      const nextOffering: BirdOffering = {
        id: duplicatedOfferingId,
        breed: sourceOffering.breed,
        soldAs: sourceOffering.soldAs,
        quantity: sourceOffering.quantity,
        price: sourceOffering.price,
        description: sourceOffering.description,
        expanded: true,
        photos: sourceOffering.photos.map((photo, index) => ({
          ...photo,
          id: `${duplicatedOfferingId}-photo-${index + 1}`,
        })),
      };

      return [
        ...currentOfferings.slice(0, sourceIndex + 1).map((offering) => ({
          ...offering,
          expanded: false,
        })),
        nextOffering,
        ...currentOfferings.slice(sourceIndex + 1).map((offering) => ({
          ...offering,
          expanded: false,
        })),
      ];
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
              species={species}
              setAvailableDate={setAvailableDate}
              setHatchDate={setHatchDate}
              setSpecies={setSpecies}
            />
            <BirdOfferingsCard
              addOffering={addOffering}
              duplicateOffering={duplicateOffering}
              offerings={offerings}
              removeOffering={removeOffering}
              toggleOfferingExpanded={toggleOfferingExpanded}
              updateOffering={updateOffering}
            />
            <ReviewPublishCard
              availableDate={availableDate}
              birdsTotal={birdsTotal}
              hatchDate={hatchDate}
              offeringCount={offerings.length}
              priceRange={priceRange}
              species={species}
            />
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
