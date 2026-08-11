import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const liveBirdsPickerSource = await readFile(
  new URL(
    "../app/dashboard/inventory/add-v2/live-birds/BirdOfferingsCard.tsx",
    import.meta.url,
  ),
  "utf8",
);
const hatchingEggPickerSource = await readFile(
  new URL(
    "../app/dashboard/listings/new/birds/hatching-eggs-standalone/hatching-eggs-standalone-one-page-form.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("Live Birds uses the searchable breed picker at every viewport", () => {
  assert.match(liveBirdsPickerSource, /function BreedCombobox\(/);
  assert.doesNotMatch(liveBirdsPickerSource, /MobileBreedCombobox|max-sm:hidden/);
  assert.match(
    liveBirdsPickerSource,
    /\{isBreedField \? \([\s\S]*?<BreedCombobox[\s\S]*?\) : \([\s\S]*?<select/,
  );
  assert.match(liveBirdsPickerSource, /\+ Add Custom Breed/);
});

test("Live Birds filters visible labels and selects the exact profile or library ID", () => {
  assert.match(
    liveBirdsPickerSource,
    /option\.label\.toLowerCase\(\)\.includes\(normalizedQuery\)/,
  );
  assert.match(liveBirdsPickerSource, /\.slice\(0, 40\)/);
  assert.match(liveBirdsPickerSource, /key=\{optionValue\}[\s\S]*?onChange\(option\)/);
  assert.match(
    liveBirdsPickerSource,
    /if \(option\.id\) return `profile:\$\{option\.id\}`;[\s\S]*?if \(option\.breedId\) return `catalog:\$\{option\.breedId\}`;/,
  );
});

test("Hatching Eggs retains its searchable reference-breed picker", () => {
  assert.match(hatchingEggPickerSource, /function HatchingEggBreedLookup\(/);
  assert.match(
    hatchingEggPickerSource,
    /normalizeHatchingEggBreedName\(breed\.breed_name\)\.includes\(normalizedValue\)/,
  );
  assert.match(
    hatchingEggPickerSource,
    /key=\{breed\.id\}[\s\S]*?onSelectBreed\(breed\)/,
  );
});
