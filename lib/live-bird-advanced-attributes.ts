export const breedingHistoryOptions = [
  { value: "", label: "Not specified" },
  { value: "never_bred", label: "Never Bred" },
  { value: "breeder", label: "Breeder" },
] as const;

export const featherConditionOptions = [
  { value: "", label: "Not specified" },
  { value: "excellent", label: "Excellent" },
  { value: "good", label: "Good" },
  { value: "rough", label: "Rough" },
  { value: "very_rough", label: "Very Rough" },
] as const;

export type BreedingHistory = "never_bred" | "breeder";
export type FeatherCondition = "excellent" | "good" | "rough" | "very_rough";

export function formatBreedingHistory(value: string | null | undefined) {
  if (value === "never_bred") return "Never Bred";
  if (value === "breeder") return "Breeder";
  return null;
}

export function formatFeatherCondition(value: string | null | undefined) {
  if (value === "excellent") return "Excellent feathers";
  if (value === "good") return "Good feathers";
  if (value === "rough") return "Rough feathers";
  if (value === "very_rough") return "Very rough feathers";
  return null;
}

export function formatLiveBirdAdvancedDetails({
  breedingHistory,
  featherCondition,
}: {
  breedingHistory?: string | null;
  featherCondition?: string | null;
}) {
  return [
    formatBreedingHistory(breedingHistory),
    formatFeatherCondition(featherCondition),
  ]
    .filter(Boolean)
    .join(" \u00b7 ");
}

export function hasLiveBirdAdvancedDetails(
  options: ReadonlyArray<{
    breedingHistory?: string | null;
    featherCondition?: string | null;
  }>,
) {
  return options.some(
    (option) => Boolean(option.breedingHistory) || Boolean(option.featherCondition),
  );
}

export function getLiveBirdDetailsColumnLabel(
  options: ReadonlyArray<{
    breedingHistory?: string | null;
    featherCondition?: string | null;
  }>,
) {
  return hasLiveBirdAdvancedDetails(options) ? "Bird details" : "Sex";
}

export function isBreedingHistory(value: string) {
  return value === "" || value === "never_bred" || value === "breeder";
}

export function isFeatherCondition(value: string) {
  return (
    value === "" ||
    value === "excellent" ||
    value === "good" ||
    value === "rough" ||
    value === "very_rough"
  );
}
