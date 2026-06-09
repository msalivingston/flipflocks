"use client";

import Link from "next/link";
import { useSellerContext } from "../../_components/seller-context";
import {
  SellerCard,
  SellerPageHeader,
} from "../../_components/seller-ui";

type ChoiceCardProps = {
  title: string;
  description: string;
  href?: string;
  badge?: string;
  details: string[];
  disabled?: boolean;
};

/**
 * First step in listing creation.
 *
 * This component intentionally collects no data. It only routes sellers into
 * the approved V1 bird workflow while optional workflows are revealed from
 * Store Admin module settings.
 */
export function CreateListingStart() {
  const { seller } = useSellerContext();
  const hatchingEggsEnabled = Boolean(seller?.hatching_eggs_enabled);
  const equipmentSuppliesEnabled = Boolean(
    seller?.equipment_supplies_enabled,
  );
  const processedPoultryEnabled = Boolean(seller?.processed_poultry_enabled);

  return (
    <>
      <SellerPageHeader
        title="Create Listing"
        description="Start with what you are selling. Live bird listings are always available."
      />

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-5 py-5 sm:px-7">
        <section className="grid gap-4 md:grid-cols-2">
          <ChoiceCard
            title="Birds"
            description={
              hatchingEggsEnabled
                ? "List chicks, started birds, pullets, breeding pairs, trios, or hatching eggs."
                : "List chicks, started birds, pullets, breeding pairs, or trios."
            }
            href="/dashboard/listings/new/birds"
            badge="Ready for setup"
            details={
              hatchingEggsEnabled
                ? [
                    "Live birds use hatch dates",
                    "Hatching eggs use an available date",
                    "Create inventory before publishing listings",
                  ]
                : [
                    "Live birds use hatch dates",
                    "Simple and group listings are available",
                    "Create inventory before publishing listings",
                  ]
            }
          />
          {equipmentSuppliesEnabled ? (
            <ChoiceCard
              title="Equipment & Supplies"
              description={
                "Feeders, brooders, supplies, and non-living local-pickup inventory."
              }
              href="/dashboard/listings/new/equipment-supplies"
              details={[
                "Simple quantity and price inventory",
                "Local pickup only for V1",
                "Creates a buyer-facing store item",
              ]}
            />
          ) : null}
          {processedPoultryEnabled ? (
            <ChoiceCard
              title="Processed Poultry"
              description="Simple local-pickup poultry products by product name, type, quantity, and price."
              href="/dashboard/listings/new/processed-poultry"
              details={[
                "No hatch dates or breed setup",
                "Quantity and price are required",
                "Creates a buyer-facing store item",
              ]}
            />
          ) : null}
        </section>
      </main>
    </>
  );
}

export function BirdsBranchSelection() {
  const { seller } = useSellerContext();
  const hatchingEggsEnabled = Boolean(seller?.hatching_eggs_enabled);

  return (
    <>
      <SellerPageHeader
        title="Bird Listing"
        description={
          hatchingEggsEnabled
            ? "Choose whether you are listing live birds or hatching eggs."
            : "Choose the live bird listing workflow."
        }
        action={
          <Link className="seller-secondary-button" href="/dashboard/listings/new">
            Back
          </Link>
        }
      />

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-5 py-5 sm:px-7">
        <section className="grid gap-4 md:grid-cols-2">
          <ChoiceCard
            title="Live Birds"
            description={
              "Chicks, started birds, pullets, pairs, trios, or other live bird inventory."
            }
            href="/dashboard/listings/new/birds/live"
            details={[
              "Uses the existing hatch-date workflow",
              "Supports simple and group listings",
              "Keeps age-based setup available",
            ]}
          />
          {hatchingEggsEnabled ? (
            <ChoiceCard
              title="Hatching Eggs"
              description={
                "Eggs available for local pickup, organized by breed, quantity, and price per egg."
              }
              href="/dashboard/listings/new/birds/hatching-eggs"
              details={[
                "No hatch date required",
                "Breed, available date, quantity, and price per egg",
                "Local pickup only for V1",
              ]}
            />
          ) : null}
        </section>
      </main>
    </>
  );
}

export function LiveBirdsBranchSelection() {
  return (
    <>
      <SellerPageHeader
        title="Live Bird Listing"
        description={
          "Every live bird listing is organized around one hatch date. Choose Simple for one breed/type, or Group when this hatch needs multiple rows."
        }
        action={
          <Link
            className="seller-secondary-button"
            href="/dashboard/listings/new/birds"
          >
            Back to Bird Options
          </Link>
        }
      />

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-5 py-5 sm:px-7">
        <section className="grid gap-4 md:grid-cols-2">
          <ChoiceCard
            title="Simple Listing"
            description="I'm selling one breed/type from one hatch date."
            href="/dashboard/listings/new/birds/single"
            details={[
              "One breed",
              "One type, quantity, and price",
              "Good for one bird, a trio, or many birds of the same breed/type",
            ]}
          />
          <ChoiceCard
            title="Group Listing"
            description="I'm selling multiple types or breeds from the same hatch date."
            href="/dashboard/listings/new/birds/batch"
            details={[
              "One shared hatch date",
              "Multiple inventory rows",
              "Good for hatchery-style availability lists",
            ]}
          />
        </section>
      </main>
    </>
  );
}

export function BirdWorkflowPlaceholder({
  workflow,
  description,
}: {
  workflow: string;
  description: string;
}) {
  return (
    <>
      <SellerPageHeader
        title={workflow}
        description={description}
        action={
          <Link
            className="seller-secondary-button"
            href="/dashboard/listings/new/birds"
          >
            Back to Bird Options
          </Link>
        }
      />

      <main className="mx-auto w-full max-w-3xl px-5 py-5 sm:px-7">
        <SellerCard className="p-5">
          <p className="text-sm font-semibold uppercase tracking-[0.08em] text-emerald-700">
            Next group
          </p>
          <h2 className="mt-2 text-xl font-semibold text-stone-950">
            Full form comes next
          </h2>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            This route is ready so the create-listing flow has a real place to
            continue. The next implementation slice should add the actual bird
            listing form, validation, and save behavior.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link
              className="seller-secondary-button"
              href="/dashboard/listings"
            >
              Back to Listings
            </Link>
            <Link
              className="seller-secondary-button"
              href="/dashboard/listings/new/birds"
            >
              Choose Different Bird Flow
            </Link>
          </div>
        </SellerCard>
      </main>
    </>
  );
}

function ChoiceCard({
  title,
  description,
  href,
  badge,
  details,
  disabled = false,
}: ChoiceCardProps) {
  const content = (
    <SellerCard
      className={`h-full p-5 transition ${
        disabled
          ? "bg-stone-50 opacity-80"
          : "hover:border-emerald-700 hover:shadow-md"
      }`}
    >
      <div className="flex h-full flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-stone-950">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              {description}
            </p>
          </div>
          {badge ? (
            <span
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                disabled
                  ? "bg-stone-200 text-stone-700"
                  : "bg-emerald-100 text-emerald-800"
              }`}
            >
              {badge}
            </span>
          ) : null}
        </div>

        <ul className="grid gap-2 text-sm text-stone-700">
          {details.map((detail) => (
            <li key={detail} className="flex gap-2">
              <span aria-hidden="true" className="text-emerald-700">
                -
              </span>
              <span>{detail}</span>
            </li>
          ))}
        </ul>

        <div className="mt-auto pt-2">
          {disabled ? (
            <button
              className="seller-secondary-button w-full cursor-not-allowed opacity-70"
              type="button"
              disabled
            >
              Coming Later
            </button>
          ) : (
            <span className="inline-flex min-h-10 w-full items-center justify-center rounded-md bg-stone-950 px-4 text-sm font-semibold text-white">
              Continue
            </span>
          )}
        </div>
      </div>
    </SellerCard>
  );

  if (!href || disabled) return content;

  return (
    <Link
      className="block h-full focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
      href={href}
    >
      {content}
    </Link>
  );
}
