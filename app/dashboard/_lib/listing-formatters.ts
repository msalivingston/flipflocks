export function calculateAgeAtAvailabilityDays(
  originDate: string,
  availableDate: string,
) {
  if (!originDate || !availableDate) return null;

  const originTime = Date.parse(`${originDate}T00:00:00Z`);
  const availableTime = Date.parse(`${availableDate}T00:00:00Z`);

  if (Number.isNaN(originTime) || Number.isNaN(availableTime)) return null;

  return Math.round((availableTime - originTime) / 86_400_000);
}

export function formatAgeAtAvailability(days: number | null | undefined) {
  if (days == null) return "Not set";
  if (days < 0) return "Available date is before hatch date";
  if (days < 7) return `${days} day${days === 1 ? "" : "s"}`;

  const weeks = Math.floor(days / 7);
  const remainder = days % 7;

  if (remainder === 0) return `${weeks} week${weeks === 1 ? "" : "s"}`;

  return `${weeks} week${weeks === 1 ? "" : "s"}, ${remainder} day${
    remainder === 1 ? "" : "s"
  }`;
}

export function formatInventoryTypeLabel(value: string | null | undefined) {
  if (value === "female") return "Female";
  if (value === "male") return "Male";
  if (value === "straight_run") return "Straight run";
  if (value === "unsexed") return "Unsexed";
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
    return roundCurrency(
      rule.maxPrice == null ? uncappedPrice : Math.min(uncappedPrice, rule.maxPrice),
    );
  }

  return roundCurrency(
    Math.max(uncappedPrice, rule.minPrice == null ? 0 : rule.minPrice, 0),
  );
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}
