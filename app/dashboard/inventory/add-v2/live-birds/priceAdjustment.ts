import type { BirdOffering, PriceAdjustmentState } from "./types";

export const defaultPriceAdjustment: PriceAdjustmentState = {
  enabled: false,
  direction: "increase",
  amount: "1",
  intervalWeeks: "1",
  maxPrice: "",
  minPrice: "",
};

type PriceAdjustmentRow = {
  auto_price_adjustment_enabled: boolean | null;
  price_adjustment_direction: string | null;
  price_adjustment_amount: number | null;
  price_adjustment_interval_weeks: number | null;
  price_adjustment_max_price: number | null;
  price_adjustment_min_price: number | null;
};

export function hydratePriceAdjustment(
  row: PriceAdjustmentRow | null | undefined,
): PriceAdjustmentState {
  if (!row) return defaultPriceAdjustment;

  return {
    enabled: Boolean(row.auto_price_adjustment_enabled),
    direction:
      row.price_adjustment_direction === "decrease" ? "decrease" : "increase",
    amount:
      row.price_adjustment_amount === null ||
      row.price_adjustment_amount === undefined
        ? "1"
        : String(row.price_adjustment_amount),
    intervalWeeks:
      row.price_adjustment_interval_weeks === null ||
      row.price_adjustment_interval_weeks === undefined
        ? "1"
        : String(row.price_adjustment_interval_weeks),
    maxPrice:
      row.price_adjustment_max_price === null ||
      row.price_adjustment_max_price === undefined
        ? ""
        : String(row.price_adjustment_max_price),
    minPrice:
      row.price_adjustment_min_price === null ||
      row.price_adjustment_min_price === undefined
        ? ""
        : String(row.price_adjustment_min_price),
  };
}

export function getPriceAdjustmentIssues({
  offerings,
  priceAdjustment,
}: {
  offerings: BirdOffering[];
  priceAdjustment: PriceAdjustmentState;
}) {
  if (!priceAdjustment.enabled) return [];

  const issues: string[] = [];
  const amount = Number(priceAdjustment.amount);
  const intervalWeeks = Number(priceAdjustment.intervalWeeks);
  const stopPriceValue =
    priceAdjustment.direction === "increase"
      ? priceAdjustment.maxPrice
      : priceAdjustment.minPrice;
  const stopPrice = stopPriceValue.trim() ? Number(stopPriceValue) : NaN;
  const basePrices = offerings
    .map((offering) => Number(offering.price))
    .filter((price) => Number.isFinite(price));

  if (!["increase", "decrease"].includes(priceAdjustment.direction)) {
    issues.push("Choose whether prices should increase or decrease.");
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    issues.push("Enter an adjustment amount greater than $0.");
  }

  if (!Number.isInteger(intervalWeeks) || intervalWeeks <= 0) {
    issues.push("Enter a frequency of at least 1 week.");
  }

  if (!Number.isFinite(stopPrice)) {
    issues.push(
      priceAdjustment.direction === "increase"
        ? "Enter a maximum price."
        : "Enter a minimum price.",
    );
  }

  if (priceAdjustment.direction === "increase" && Number.isFinite(stopPrice)) {
    const highestBasePrice = Math.max(...basePrices, 0);

    if (stopPrice <= highestBasePrice) {
      issues.push(
        "Maximum price must be higher than your current prices.",
      );
    }
  }

  if (priceAdjustment.direction === "decrease" && Number.isFinite(stopPrice)) {
    const lowestBasePrice = Math.min(...basePrices, Number.POSITIVE_INFINITY);

    if (basePrices.length > 0 && stopPrice >= lowestBasePrice) {
      issues.push(
        "Minimum price must be lower than your current prices.",
      );
    }
  }

  return issues;
}

export function formatPriceAdjustmentSummary(value: PriceAdjustmentState) {
  if (!value.enabled) return "Price changes are off.";

  const verb = value.direction === "increase" ? "increase" : "decrease";
  const stopPrice =
    value.direction === "increase" ? value.maxPrice : value.minPrice;
  const amount = Number(value.amount);
  const intervalWeeks = Number(value.intervalWeeks);
  const parsedStopPrice = stopPrice.trim() ? Number(stopPrice) : NaN;

  if (!Number.isFinite(amount) || amount <= 0) {
    return "Enter an adjustment amount to finish this rule.";
  }

  if (!Number.isInteger(intervalWeeks) || intervalWeeks <= 0) {
    return "Enter how often the price should change.";
  }

  if (!Number.isFinite(parsedStopPrice)) {
    return value.direction === "increase"
      ? "Enter a maximum price to finish this rule."
      : "Enter a minimum price to finish this rule.";
  }

  const cadence =
    intervalWeeks === 1 ? "every week" : `every ${intervalWeeks} weeks`;
  const stopPhrase =
    value.direction === "increase"
      ? `up to $${parsedStopPrice}`
      : `down to $${parsedStopPrice}`;

  return `Start at the listed price when available. Then ${verb} by $${amount} ${cadence}, ${stopPhrase}.`;
}
