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

export function getPriceAdjustmentExample({
  availableDate,
  offerings,
  priceAdjustment,
}: {
  availableDate: string;
  offerings: BirdOffering[];
  priceAdjustment: PriceAdjustmentState;
}) {
  if (!priceAdjustment.enabled) return null;

  const issues = getPriceAdjustmentIssues({ offerings, priceAdjustment });
  if (issues.length > 0) return null;

  const amount = Number(priceAdjustment.amount);
  const intervalWeeks = Number(priceAdjustment.intervalWeeks);
  const stopPrice =
    priceAdjustment.direction === "increase"
      ? Number(priceAdjustment.maxPrice)
      : Number(priceAdjustment.minPrice);
  const futureDate = addWeeksToDate(availableDate, intervalWeeks);

  if (
    !Number.isFinite(amount) ||
    !Number.isInteger(intervalWeeks) ||
    intervalWeeks <= 0 ||
    !Number.isFinite(stopPrice)
  ) {
    return null;
  }

  const pricedOfferings = offerings
    .map((offering) => {
      const price = Number(offering.price);

      if (!Number.isFinite(price) || price <= 0) return null;

      return {
        label: getOfferingExampleLabel(offering),
        nextPrice: applyOnePriceAdjustment({
          amount,
          direction: priceAdjustment.direction,
          price,
          stopPrice,
        }),
        price,
      };
    })
    .filter(Boolean) as Array<{
      label: string;
      nextPrice: number;
      price: number;
    }>;

  if (pricedOfferings.length === 0 || !futureDate) return null;

  const uniquePrices = new Set(
    pricedOfferings.map((offering) => offering.price.toFixed(2)),
  );

  return {
    direction: priceAdjustment.direction,
    intervalLabel: intervalWeeks === 1 ? "every week" : `every ${intervalWeeks} weeks`,
    line:
      uniquePrices.size === 1
        ? `Starting at ${formatCurrency(pricedOfferings[0].price)}, the price will ${priceAdjustment.direction} by ${formatCurrency(amount)} ${intervalWeeks === 1 ? "every week" : `every ${intervalWeeks} weeks`} ${getStopPhrase(priceAdjustment.direction, stopPrice)}.`
        : `Prices will ${priceAdjustment.direction} by ${formatCurrency(amount)} ${intervalWeeks === 1 ? "every week" : `every ${intervalWeeks} weeks`} ${getStopPhrase(priceAdjustment.direction, stopPrice)}.`,
    resultDate: formatDate(futureDate),
    results:
      uniquePrices.size === 1
        ? [
            `On ${formatDate(futureDate)}, these birds will be ${formatCurrency(
              pricedOfferings[0].nextPrice,
            )} each.`,
          ]
        : pricedOfferings.map(
            (offering) =>
              `${offering.label}: ${formatCurrency(offering.price)} -> ${formatCurrency(
                offering.nextPrice,
              )} on ${formatDate(futureDate)}`,
          ),
  };
}

function getStopPhrase(
  direction: PriceAdjustmentState["direction"],
  stopPrice: number,
) {
  return direction === "increase"
    ? `up to ${formatCurrency(stopPrice)}`
    : `down to ${formatCurrency(stopPrice)}`;
}

function applyOnePriceAdjustment({
  amount,
  direction,
  price,
  stopPrice,
}: {
  amount: number;
  direction: PriceAdjustmentState["direction"];
  price: number;
  stopPrice: number;
}) {
  if (direction === "increase") return Math.min(price + amount, stopPrice);

  return Math.max(price - amount, stopPrice);
}

function addWeeksToDate(value: string, weeks: number) {
  if (!value) return null;

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;

  date.setDate(date.getDate() + weeks * 7);

  return date;
}

function getOfferingExampleLabel(offering: BirdOffering) {
  const breed = offering.breed.trim();
  const soldAs = offering.soldAs.trim();

  if (breed && soldAs) return `${breed} ${soldAs.toLowerCase()}`;
  if (breed) return breed;

  return "Bird entry";
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
  }).format(value);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    style: "currency",
  }).format(value);
}
