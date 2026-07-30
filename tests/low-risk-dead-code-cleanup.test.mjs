import assert from "node:assert/strict";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "..");

function readRepositoryFile(path) {
  return readFileSync(resolve(repositoryRoot, path), "utf8");
}

function listSourceFiles(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry);

    if (statSync(path).isDirectory()) {
      return listSourceFiles(path);
    }

    return /\.(?:ts|tsx|js|jsx|mjs)$/.test(entry) ? [path] : [];
  });
}

test("top-level listings route redirects to current inventory", () => {
  const source = readRepositoryFile("app/listings/page.tsx");

  assert.match(source, /import \{ redirect \} from "next\/navigation"/);
  assert.match(source, /redirect\("\/dashboard\/inventory"\)/);
  assert.doesNotMatch(source, /\.from\("listings"\)/);
});

test("glyph catalog is available only in development", () => {
  const source = readRepositoryFile("app/dev/glyphs/page.tsx");

  assert.match(source, /import \{ notFound \} from "next\/navigation"/);
  assert.match(
    source,
    /if \(process\.env\.NODE_ENV !== "development"\) \{\s*notFound\(\);\s*\}/,
  );
  assert.match(source, /Production glyphs from/);
});

test("deleted low-risk legacy modules are absent and unimported", () => {
  const deletedFiles = [
    "app/test-supabase/page.tsx",
    "app/dashboard/listings/new/equipment-supplies/equipment-supplies-legacy-form.tsx",
    "app/dashboard/listings/new/processed-poultry/processed-poultry-legacy-form.tsx",
  ];
  const deletedModuleNames = [
    "equipment-supplies-legacy-form",
    "processed-poultry-legacy-form",
  ];

  for (const path of deletedFiles) {
    assert.equal(existsSync(resolve(repositoryRoot, path)), false, path);
  }

  const applicationSource = listSourceFiles(resolve(repositoryRoot, "app"))
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");

  for (const moduleName of deletedModuleNames) {
    assert.doesNotMatch(
      applicationSource,
      new RegExp(`(?:from|import\\s*\\()[^\\n]*${moduleName}`),
      moduleName,
    );
  }
});

test("current Equipment routes use the one-page form", () => {
  const createRoute = readRepositoryFile(
    "app/dashboard/listings/new/equipment-supplies/page.tsx",
  );
  const editRoute = readRepositoryFile(
    "app/dashboard/listings/new/equipment-supplies/[equipmentItemId]/page.tsx",
  );

  assert.match(createRoute, /EquipmentSuppliesOnePageForm/);
  assert.match(editRoute, /EquipmentSuppliesOnePageForm/);
  assert.match(editRoute, /initialEquipmentItemId=\{equipmentItemId\}/);
});

test("current Poultry Products routes use the one-page form", () => {
  const createRoute = readRepositoryFile(
    "app/dashboard/listings/new/processed-poultry/page.tsx",
  );
  const editRoute = readRepositoryFile(
    "app/dashboard/listings/new/processed-poultry/[processedPoultryItemId]/page.tsx",
  );

  assert.match(createRoute, /PoultryProductsOnePageForm/);
  assert.match(editRoute, /PoultryProductsOnePageForm/);
  assert.match(
    editRoute,
    /initialProcessedPoultryItemId=\{processedPoultryItemId\}/,
  );
});

test("mobile custom breeds still auto-expand and scroll through cancellable frames", () => {
  const source = readRepositoryFile(
    "app/dashboard/breeds/mobile-breeds-library.tsx",
  );

  assert.match(
    source,
    /lastAutoExpandedProfileIdRef\.current === autoExpandProfileId/,
  );
  assert.match(
    source,
    /openFrameId[\s\S]*requestAnimationFrame\(\(\) => \{[\s\S]*setDescriptionDraft\(getProfileDescription\(profile, libraryByBreedId\)\)[\s\S]*setDescriptionError\(null\)[\s\S]*setSavedDescriptionProfileId\(null\)[\s\S]*setExpandedProfileId\(profile\.id\)/,
  );
  assert.match(source, /scrollIntoView\(\{ behavior: "smooth", block: "center" \}\)/);
  assert.match(source, /cancelAnimationFrame\(openFrameId\)/);
  assert.match(source, /cancelAnimationFrame\(firstScrollFrameId\)/);
  assert.match(source, /cancelAnimationFrame\(secondScrollFrameId\)/);
});
