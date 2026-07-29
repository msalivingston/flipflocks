export type HatchingEggPlatformBreed = {
  breed_name: string;
  id: string;
  species_id: string;
};

export function normalizeHatchingEggBreedName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function findMatchingHatchingEggPlatformBreed({
  breeds,
  name,
  speciesId,
}: {
  breeds: HatchingEggPlatformBreed[];
  name: string;
  speciesId: string;
}) {
  const normalizedName = normalizeHatchingEggBreedName(name);

  if (!normalizedName || !speciesId) return null;

  return (
    breeds.find(
      (breed) =>
        breed.species_id === speciesId &&
        normalizeHatchingEggBreedName(breed.breed_name) === normalizedName,
    ) ?? null
  );
}

export function resolveHatchingEggBreedName({
  breeds,
  name,
  speciesId,
}: {
  breeds: HatchingEggPlatformBreed[];
  name: string;
  speciesId: string;
}) {
  const matchingBreed = findMatchingHatchingEggPlatformBreed({
    breeds,
    name,
    speciesId,
  });

  return {
    canonicalName: matchingBreed?.breed_name ?? name.trim().replace(/\s+/g, " "),
    matchingBreed,
  };
}

export function canUseCustomHatchingEggBreedName({
  breeds,
  name,
  speciesId,
}: {
  breeds: HatchingEggPlatformBreed[];
  name: string;
  speciesId: string;
}) {
  return (
    name.trim().length > 0 &&
    !findMatchingHatchingEggPlatformBreed({ breeds, name, speciesId })
  );
}
