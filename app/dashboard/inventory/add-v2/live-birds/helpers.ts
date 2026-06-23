import type {
  AgeAtAvailabilityResult,
  BirdOffering,
  ReadinessChecks,
} from "./types";

export function getAgeAtAvailability(
  hatchDateValue: string,
  availableDateValue: string,
): AgeAtAvailabilityResult {
  const hatchDate = parseDateValue(hatchDateValue);
  const availableDate = parseDateValue(availableDateValue);

  if (!hatchDate || !availableDate) {
    return {
      message: "Choose hatch and available dates to calculate age.",
      status: "warning",
    };
  }

  const diffDays = getDateDifferenceDays(hatchDate, availableDate);

  if (diffDays < 0) {
    return {
      message: "Available date cannot be before hatch date.",
      status: "warning",
    };
  }

  const weeks = Math.floor(diffDays / 7);
  const days = diffDays % 7;

  return {
    message: `Age at availability: ${weeks} weeks + ${days} days`,
    status: "ready",
  };
}

export function getReadinessChecks({
  availableDate,
  hatchDate,
  offerings,
  species,
}: {
  availableDate: string;
  hatchDate: string;
  offerings: BirdOffering[];
  species: string;
}): ReadinessChecks {
  const parsedHatchDate = parseDateValue(hatchDate);
  const parsedAvailableDate = parseDateValue(availableDate);
  const datesAreOrdered =
    parsedHatchDate !== null &&
    parsedAvailableDate !== null &&
    getDateDifferenceDays(parsedHatchDate, parsedAvailableDate) >= 0;
  const birdOfferingsAdded = offerings.length > 0;

  return {
    hatchInformationComplete:
      species.trim().length > 0 &&
      parsedHatchDate !== null &&
      parsedAvailableDate !== null &&
      datesAreOrdered,
    birdOfferingsAdded,
    birdQuantitiesEntered:
      birdOfferingsAdded &&
      offerings.every(
        (offering) => getNumberInputValue(offering.quantity) > 0,
      ),
    pricingEntered:
      birdOfferingsAdded &&
      offerings.every((offering) => getNumberInputValue(offering.price) > 0),
    buyerContentComplete:
      birdOfferingsAdded &&
      offerings.every(
        (offering) =>
          offering.breed.trim().length > 0 &&
          offering.soldAs.trim().length > 0,
      ),
  };
}

export function areAllReadinessChecksComplete(readiness: ReadinessChecks) {
  return Object.values(readiness).every(Boolean);
}

export function getPriceRange(offerings: BirdOffering[]) {
  const prices = offerings
    .map((offering) => getNumberInputValue(offering.price))
    .filter((price) => price > 0);

  if (prices.length === 0) return "\u2014";

  const lowestPrice = Math.min(...prices);
  const highestPrice = Math.max(...prices);

  if (lowestPrice === highestPrice) {
    return formatDollarAmount(lowestPrice);
  }

  return `${formatDollarAmount(lowestPrice)}\u2013${formatDollarAmount(
    highestPrice,
  )}`;
}

export function formatDisplayDate(value: string) {
  const date = parseDateValue(value);

  if (!date) return "Not selected";

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(date);
}

export function getNumberInputValue(value: string) {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) return 0;

  return numberValue;
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

function getDateDifferenceDays(startDate: Date, endDate: Date) {
  const millisecondsPerDay = 24 * 60 * 60 * 1000;

  return Math.round(
    (endDate.getTime() - startDate.getTime()) / millisecondsPerDay,
  );
}

function formatDollarAmount(value: number) {
  return `$${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value)}`;
}
