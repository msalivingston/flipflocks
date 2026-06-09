export function calculateAgeAtAvailabilityDays(
  originDate: string,
  availableDate: string,
) {
  if (!originDate || !availableDate) return null;

  const originTime = Date.parse(`${originDate}T00:00:00`);
  const availableTime = Date.parse(`${availableDate}T00:00:00`);

  if (Number.isNaN(originTime) || Number.isNaN(availableTime)) return null;

  return Math.round((availableTime - originTime) / 86_400_000);
}

export function formatAgeAtAvailability(days: number | null | undefined) {
  if (days == null) return "Not set";
  if (days < 0) return "Not set";
  if (days === 0) return "At hatch";

  const weeks = Math.floor(days / 7);
  const remainingDays = days % 7;
  const parts: string[] = [];

  if (weeks > 0) {
    parts.push(`${weeks} week${weeks === 1 ? "" : "s"}`);
  }

  if (remainingDays > 0) {
    parts.push(`${remainingDays} day${remainingDays === 1 ? "" : "s"}`);
  }

  return parts.join(" + ");
}

export function formatAgeAtAvailabilityFromDates(
  originDate: string | null | undefined,
  availableDate: string | null | undefined,
) {
  if (!originDate || !availableDate) return "Not set";

  return formatAgeAtAvailability(
    calculateAgeAtAvailabilityDays(originDate, availableDate),
  );
}

export function formatInventoryTypeLabel(value: string | null | undefined) {
  if (value === "female") return "Female";
  if (value === "male") return "Male";
  if (value === "straight_run") return "Straight Run";
  if (value === "unsexed") return "Straight Run";
  if (value === "pair") return "Pair";
  if (value === "trio") return "Trio";
  if (value === "hatching_eggs") return "Hatching eggs";
  if (value === "other") return "Other";

  return value ? value.replaceAll("_", " ") : "Not set";
}

export type PriceAdjustmentDirection = "increase" | "decrease";

export type PriceAdjustmentRule = {
  enabled: boolean;
  direction: PriceAdjustmentDirection | null;
  amount: number | null;
  intervalWeeks: number | null;
  maxPrice: number | null;
  minPrice: number | null;
  availableDate: string | null;
};

export function calculateAdjustedUnitPrice(
  basePrice: number | null | undefined,
  rule: PriceAdjustmentRule,
  asOfDate = new Date(),
) {
  if (basePrice == null) return null;

  if (
    !rule.enabled ||
    !rule.direction ||
    rule.amount == null ||
    rule.amount <= 0 ||
    rule.intervalWeeks == null ||
    rule.intervalWeeks <= 0 ||
    !rule.availableDate
  ) {
    return roundCurrency(basePrice);
  }

  const availableTime = Date.parse(`${rule.availableDate}T00:00:00Z`);

  if (Number.isNaN(availableTime)) return roundCurrency(basePrice);

  const asOfUtc = Date.UTC(
    asOfDate.getUTCFullYear(),
    asOfDate.getUTCMonth(),
    asOfDate.getUTCDate(),
  );
  const elapsedDays = Math.floor((asOfUtc - availableTime) / 86_400_000);
  const completedIntervals = Math.floor(
    elapsedDays / (rule.intervalWeeks * 7),
  );

  if (completedIntervals <= 0) return roundCurrency(basePrice);

  const uncappedPrice =
    rule.direction === "increase"
      ? basePrice + rule.amount * completedIntervals
      : basePrice - rule.amount * completedIntervals;

  if (rule.direction === "increase") {
    const cappedPrice =
      rule.maxPrice == null
        ? uncappedPrice
        : Math.min(uncappedPrice, Math.max(rule.maxPrice, basePrice));

    return roundCurrency(cappedPrice);
  }

  const cappedFloor =
    rule.minPrice == null ? 0 : Math.min(rule.minPrice, basePrice);

  return roundCurrency(Math.max(uncappedPrice, cappedFloor, 0));
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}
