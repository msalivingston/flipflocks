import Link from "next/link";
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
 * the approved V1 bird workflow while keeping Equipment & Supplies visible as a
 * deferred product decision.
 */
export function CreateListingStart() {
  return (
    <>
      <SellerPageHeader
        title="Create Listing"
        description="Start with what you are selling. Bird listings are available first; Equipment & Supplies will come later."
      />

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-5 py-5 sm:px-7">
        <section className="grid gap-4 md:grid-cols-2">
          <ChoiceCard
            title="Birds"
            description="List chicks, started birds, pullets, breeding pairs, trios, or hatching eggs."
            href="/dashboard/listings/new/birds"
            badge="Ready for setup"
            details={[
              "Use hatch or birth dates",
              "Show when birds are ready",
              "Support age-based pricing later in the flow",
            ]}
          />
          <ChoiceCard
            title="Equipment & Supplies"
            description="Feeders, brooders, supplies, and non-living inventory will use a separate future workflow."
            badge="Coming later"
            disabled
            details={[
              "Deferred for V1",
              "No product inventory setup yet",
              "Bird listings stay the priority",
            ]}
          />
        </section>
      </main>
    </>
  );
}

export function BirdsBranchSelection() {
  return (
    <>
      <SellerPageHeader
        title="Bird Listing"
        description="Choose the way you naturally think about this group. Both options use the same listing structure behind the scenes."
        action={
          <Link className="seller-secondary-button" href="/dashboard/listings/new">
            Back
          </Link>
        }
      />

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-5 py-5 sm:px-7">
        <section className="grid gap-4 md:grid-cols-2">
          <ChoiceCard
            title="Single Breed / Offering"
            description="Best when the listing is one breed or one simple offering, like Lavender Ameraucana pullets."
            href="/dashboard/listings/new/birds/single"
            details={[
              "One main breed or offering",
              "Simple quantity and price setup",
              "Good for a quick listing",
            ]}
          />
          <ChoiceCard
            title="Batch / Mixed Group"
            description="Best when one hatch date includes several breeds or bird groups."
            href="/dashboard/listings/new/birds/batch"
            details={[
              "One hatch or availability group",
              "Multiple breeds or bird groups",
              "Good for larger farm batches",
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
    <Link className="block h-full focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2" href={href}>
      {content}
    </Link>
  );
}
