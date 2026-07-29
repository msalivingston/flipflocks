import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  canUseCustomHatchingEggBreedName,
  findMatchingHatchingEggPlatformBreed,
  normalizeHatchingEggBreedName,
  resolveHatchingEggBreedName,
} from "../lib/hatching-egg-breed-name.ts";

const breeds = [
  {
    id: "chicken-barred-rock",
    species_id: "chicken",
    breed_name: "Barred Rock",
  },
  {
    id: "duck-barred-rock",
    species_id: "duck",
    breed_name: "Barred Rock Duck",
  },
];

test("normalizes case, outer whitespace, and repeated internal spaces", () => {
  assert.equal(
    normalizeHatchingEggBreedName("  BaRReD   Rock  "),
    "barred rock",
  );
});

test("resolves exact and normalized matches to platform spelling", () => {
  for (const name of ["Barred Rock", "barred rock", "  barred   rock "]) {
    const result = resolveHatchingEggBreedName({
      breeds,
      name,
      speciesId: "chicken",
    });

    assert.equal(result.matchingBreed?.id, "chicken-barred-rock");
    assert.equal(result.canonicalName, "Barred Rock");
  }
});

test("limits platform matches to the selected species", () => {
  assert.equal(
    findMatchingHatchingEggPlatformBreed({
      breeds,
      name: "Barred Rock",
      speciesId: "duck",
    }),
    null,
  );
});

test("allows a custom name when no platform breed matches", () => {
  const result = resolveHatchingEggBreedName({
    breeds,
    name: "  Meadowgate   Blue  ",
    speciesId: "chicken",
  });

  assert.equal(result.matchingBreed, null);
  assert.equal(result.canonicalName, "Meadowgate Blue");
  assert.equal(
    canUseCustomHatchingEggBreedName({
      breeds,
      name: "Meadowgate Blue",
      speciesId: "chicken",
    }),
    true,
  );
});

test("hides the custom-name action for a platform breed match", () => {
  assert.equal(
    canUseCustomHatchingEggBreedName({
      breeds,
      name: " barred   ROCK ",
      speciesId: "chicken",
    }),
    false,
  );
});

test("breed lookup renders the custom action only without an exact match", () => {
  const formSource = readFileSync(
    resolve(
      import.meta.dirname,
      "../app/dashboard/listings/new/birds/hatching-eggs-standalone/hatching-eggs-standalone-one-page-form.tsx",
    ),
    "utf8",
  );

  assert.match(
    formSource,
    /const exactMatchingBreed = findMatchingHatchingEggPlatformBreed/,
  );
  assert.match(formSource, /\{!exactMatchingBreed \? \(/);
  assert.match(formSource, /`Use custom name: \$\{value\.trim\(\)\}`/);
});

test("backend canonicalizes direct writes without prohibiting repeated offerings", () => {
  const migration = readFileSync(
    resolve(
      import.meta.dirname,
      "../supabase/migrations/20260729170000_canonicalize_hatching_egg_platform_breed_names.sql",
    ),
    "utf8",
  );

  assert.match(migration, /breeds\.species_id = new\.species_id/);
  assert.match(migration, /breeds\.is_active = true/);
  assert.match(
    migration,
    /normalize_hatching_egg_item_name\(breeds\.breed_name\)[\s\S]*normalize_hatching_egg_item_name\(new\.item_name\)/,
  );
  assert.match(
    migration,
    /before insert or update of item_name, species_id/,
  );
  assert.match(migration, /new\.item_name := coalesce/);
  assert.doesNotMatch(migration, /unique\s*\(/i);
  assert.doesNotMatch(migration, /raise exception/i);
});

test("buyer grouping imports the shared normalization helper", () => {
  const storefrontData = readFileSync(
    resolve(import.meta.dirname, "../app/store/[slug]/storefront-data.ts"),
    "utf8",
  );

  assert.match(
    storefrontData,
    /normalizeHatchingEggBreedName\(item\.item_name\)/,
  );
});
