export const eggColorOptions = [
  { label: "White", value: "white" },
  { label: "Light Brown", value: "light_brown" },
  { label: "Brown", value: "brown" },
  { label: "Dark Brown", value: "dark_brown" },
  { label: "Blue", value: "blue" },
  { label: "Blue-Green", value: "blue_green" },
  { label: "Green", value: "green" },
  { label: "Olive", value: "olive" },
] as const;

export { breedCategoryOptions } from "./breed-identity";

export const annualEggProductionOptions = [
  { label: "Less than 150 eggs/year", value: "under_150" },
  { label: "150-200 eggs/year", value: "150_200" },
  { label: "200-250 eggs/year", value: "200_250" },
  { label: "250-300 eggs/year", value: "250_300" },
  { label: "More than 300 eggs/year", value: "over_300" },
] as const;
