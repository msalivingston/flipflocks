export const breedCategoryOptions = [
  "Layers",
  "Bantams",
  "Specialty / Project",
  "Meat Birds",
  "Dual Purpose",
] as const;

export type BreedCategory = (typeof breedCategoryOptions)[number];

export function formatBreedDisplayName(
  breed: string | null | undefined,
  variety: string | null | undefined,
) {
  const normalizedBreed = breed?.trim() ?? "";
  const normalizedVariety = variety?.trim() ?? "";

  if (!normalizedVariety) return normalizedBreed;
  return `${normalizedBreed} - ${normalizedVariety}`;
}

export function getBaseBreedFromDisplayName(
  displayName: string,
  variety: string | null | undefined,
) {
  const normalizedDisplayName = displayName.trim();
  const normalizedVariety = variety?.trim() ?? "";
  const suffix = normalizedVariety ? ` - ${normalizedVariety}` : "";

  return suffix && normalizedDisplayName.endsWith(suffix)
    ? normalizedDisplayName.slice(0, -suffix.length).trim()
    : normalizedDisplayName;
}
