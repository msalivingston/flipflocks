export type PoultryProductShareTextInput = {
  availableDate?: string | null;
  packageSize: string | null | undefined;
  price: number | string | null | undefined;
  productName: string | null | undefined;
  quantityAvailable: number | string | null | undefined;
};

export function buildPoultryProductShareText(
  input: PoultryProductShareTextInput,
  storeName: string | null | undefined,
) {
  const listingTitle = stripTrailingSentencePunctuation(input.productName ?? "");
  const sellerStoreName = stripTrailingSentencePunctuation(storeName ?? "");
  const price = isValidMoney(input.price) ? formatCurrency(input.price) : null;
  const priceUnit = formatPoultryProductShareUnit(input.packageSize);
  const sentences = [
    sellerStoreName ? `${listingTitle} from ${sellerStoreName}` : listingTitle,
    formatPoultryProductAvailability(input),
    price ? `${price}${priceUnit ? ` per ${priceUnit}` : ""}` : null,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => `${stripTrailingSentencePunctuation(value)}.`);

  return sentences.length > 0 ? sentences.join(" ") : null;
}

export function buildPoultryProductShareSummary(
  input: PoultryProductShareTextInput,
) {
  const price = isValidMoney(input.price) ? formatCurrency(input.price) : null;
  const priceUnit = formatPoultryProductShareUnit(input.packageSize);
  const summaryParts = [
    formatPoultryProductAvailability(input),
    price ? `${price}${priceUnit ? ` per ${priceUnit}` : ""}` : null,
  ].filter(Boolean);

  return summaryParts.length > 0 ? summaryParts.join(" - ") : null;
}

function formatPoultryProductAvailability(input: PoultryProductShareTextInput) {
  const quantity = Number(input.quantityAvailable);

  if (Number.isFinite(quantity) && quantity <= 0) return "Sold out";
  if (input.availableDate) {
    return isDateTodayOrEarlier(input.availableDate)
      ? "Available now"
      : `Available ${formatShareDate(input.availableDate)}`;
  }

  return null;
}

function formatPoultryProductShareUnit(value: string | null | undefined) {
  const unit = stripTrailingSentencePunctuation(value ?? "")
    .replace(/^per\s+/i, "")
    .trim();

  return unit || null;
}

function isValidMoney(value: number | string | null | undefined) {
  const text = String(value ?? "").trim();
  return /^\d+(\.\d{1,2})?$/.test(text) && Number(text) >= 0;
}

function formatCurrency(value: number | string | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(Number(value || 0));
}

function formatShareDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${value.slice(0, 10)}T00:00:00`));
}

function isDateTodayOrEarlier(value: string) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Number.isFinite(date.getTime()) && date <= today;
}

function stripTrailingSentencePunctuation(value: string) {
  return value.trim().replace(/[.!?]+$/g, "");
}
