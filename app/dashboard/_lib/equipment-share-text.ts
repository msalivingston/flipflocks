export type EquipmentShareTextInput = {
  condition: string | null | undefined;
  itemName: string | null | undefined;
  price: number | string | null | undefined;
};

export function buildEquipmentShareText(
  input: EquipmentShareTextInput,
  storeName: string | null | undefined,
) {
  const listingTitle = stripTrailingSentencePunctuation(input.itemName ?? "");
  const sellerStoreName = stripTrailingSentencePunctuation(storeName ?? "");
  const price = isValidMoney(input.price) ? formatCurrency(input.price) : null;
  const sentences = [
    sellerStoreName ? `${listingTitle} from ${sellerStoreName}` : listingTitle,
    input.condition ? `${input.condition} condition` : null,
    price,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => `${stripTrailingSentencePunctuation(value)}.`);

  return sentences.length > 0 ? sentences.join(" ") : null;
}

export function buildEquipmentShareSummary(input: EquipmentShareTextInput) {
  const summaryParts = [
    input.condition ? `${input.condition} condition` : null,
    isValidMoney(input.price) ? formatCurrency(input.price) : null,
  ].filter(Boolean);

  return summaryParts.length > 0 ? summaryParts.join(" - ") : null;
}

function isValidMoney(value: number | string | null | undefined) {
  const text = String(value ?? "").trim();
  return /^\d+(\.\d{1,2})?$/.test(text) && Number(text) >= 0;
}

function formatCurrency(value: number | string | null | undefined) {
  const amount = Number(value);

  if (!String(value ?? "").trim() || !Number.isFinite(amount)) return "$0.00";

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(amount);
}

function stripTrailingSentencePunctuation(value: string) {
  return value.trim().replace(/[.!?]+$/g, "");
}
