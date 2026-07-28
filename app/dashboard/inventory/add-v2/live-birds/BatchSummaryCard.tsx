import Image from "next/image";
import {
  formatDisplayDate,
  getNumberInputValue,
  isBirdsForSaleGroupStarted,
} from "./helpers";
import type {
  BirdOffering,
  PriceAdjustmentState,
} from "./types";

export function BatchSummaryCard({
  ageAtAvailability,
  availableDate,
  hatchDate,
  offerings,
  priceAdjustment,
}: {
  ageAtAvailability: string;
  availableDate: string;
  hatchDate: string;
  offerings: BirdOffering[];
  priceAdjustment: PriceAdjustmentState;
}) {
  const startedOfferings = offerings.filter(isBirdsForSaleGroupStarted);
  const birdsTotal = startedOfferings.reduce(
    (total, offering) => total + getNumberInputValue(offering.quantity),
    0,
  );
  const prices = startedOfferings
    .map((offering) => getNumberInputValue(offering.price))
    .filter((price) => price > 0);
  const averagePrice =
    prices.length > 0
      ? prices.reduce((total, price) => total + price, 0) / prices.length
      : 0;
  const summaryItems = [
    {
      glyph: "/glyphs/calendar.png",
      label: "Hatch date",
      value: formatDisplayDate(hatchDate),
    },
    {
      glyph: "/glyphs/calendar.png",
      label: "Pickup date",
      value: formatDisplayDate(availableDate),
    },
    {
      glyph: "/glyphs/hen.png",
      label: "Age when available",
      value: formatAgeSummary(ageAtAvailability),
    },
    {
      glyph: "/glyphs/hen.png",
      label: "Bird groups",
      value: String(startedOfferings.length),
    },
    {
      glyph: "/glyphs/customers.png",
      label: "Total birds available",
      value: String(birdsTotal),
    },
    {
      glyph: "/glyphs/clipboard.png",
      label: "Average price",
      value: averagePrice > 0 ? formatCurrency(averagePrice) : "Not set",
    },
    {
      glyph: "/glyphs/reports.png",
      label: "Automatic pricing",
      value: formatAutomaticPricingSummary(priceAdjustment),
    },
  ];

  return (
    <section
      aria-labelledby="desktop-listing-summary-title"
      className="border-t border-stone-200 pt-6"
    >
      <h3
        className="text-lg font-bold text-stone-950"
        id="desktop-listing-summary-title"
      >
        Listing Summary
      </h3>
      <div className="mt-4 grid gap-x-8 gap-y-5 md:grid-cols-2 xl:grid-cols-3">
        {summaryItems.map((item) => (
          <div className="flex min-w-0 items-start gap-3" key={item.label}>
            <Image
              alt=""
              className="mt-0.5 size-5 shrink-0 object-contain"
              height={20}
              src={item.glyph}
              width={20}
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-stone-500">
                {item.label}
              </p>
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

function formatAgeSummary(message: string) {
  return message
    .replace(/^These birds will be /, "")
    .replace(/ when available\.$/, "");
}

function formatAutomaticPricingSummary(
  priceAdjustment: PriceAdjustmentState,
) {
  if (!priceAdjustment.enabled) return "No automatic price changes";

  const amount = Number(priceAdjustment.amount);
  const intervalWeeks = Number(priceAdjustment.intervalWeeks);
  const stopPriceValue =
    priceAdjustment.direction === "increase"
      ? priceAdjustment.maxPrice
      : priceAdjustment.minPrice;
  const stopPrice = stopPriceValue.trim() ? Number(stopPriceValue) : NaN;
  const direction =
    priceAdjustment.direction === "increase" ? "Increasing" : "Decreasing";
  const cadence =
    intervalWeeks === 1 ? "week" : `${intervalWeeks || "—"} weeks`;
  const limit =
    priceAdjustment.direction === "increase" ? "maximum" : "minimum";

  if (!Number.isFinite(amount) || amount <= 0) {
    return "Automatic price changes need an amount";
  }

  if (!Number.isFinite(stopPrice)) {
    return `${direction} ${formatCurrency(amount)}/${cadence}`;
  }

  return `${direction} ${formatCurrency(amount)}/${cadence}, ${limit} ${formatCurrency(stopPrice)}`;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    minimumFractionDigits: 2,
    style: "currency",
  }).format(value);
}
