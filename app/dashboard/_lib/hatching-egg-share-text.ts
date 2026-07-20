export type HatchingEggShareTextInput = {
  availableDate: string | null | undefined;
  itemName: string | null | undefined;
  price: number | string | null | undefined;
};

export function buildHatchingEggShareText(
  input: HatchingEggShareTextInput,
  storeName: string | null | undefined,
) {
  const listingTitle = stripTrailingSentencePunctuation(input.itemName ?? "");
  const sellerStoreName = stripTrailingSentencePunctuation(storeName ?? "");
  const listingLabel = /\bhatching eggs\b/i.test(listingTitle)
    ? listingTitle
    : `${listingTitle || "Hatching eggs"} hatching eggs`;
  const sentences = [
    sellerStoreName ? `${listingLabel} from ${sellerStoreName}` : listingLabel,
    input.availableDate ? `Ready ${formatShareDate(input.availableDate)}` : null,
    isValidMoney(input.price) ? `${formatCurrency(input.price)} per egg` : null,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => `${stripTrailingSentencePunctuation(value)}.`);

  return sentences.length > 0 ? sentences.join(" ") : null;
}

export function buildHatchingEggShareSummary(input: HatchingEggShareTextInput) {
  const summaryParts = [
    input.availableDate ? `Ready ${formatDate(input.availableDate)}` : null,
    isValidMoney(input.price) ? `${formatCurrency(input.price)} per egg` : null,
  ].filter(Boolean);

  return summaryParts.length > 0 ? summaryParts.join(" - ") : null;
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

function formatDate(value: string) {
  if (!value) return "Not selected";

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value.slice(0, 10)}T00:00:00`));
}

function formatShareDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${value.slice(0, 10)}T00:00:00`));
}

function stripTrailingSentencePunctuation(value: string) {
  return value.trim().replace(/[.!?]+$/g, "");
}
