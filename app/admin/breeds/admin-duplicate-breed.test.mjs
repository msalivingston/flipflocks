import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const detailPath = new URL(
  "../_components/admin-breed-image-manager.tsx",
  import.meta.url,
);
const modalPath = new URL(
  "../_components/admin-add-breed-modal.tsx",
  import.meta.url,
);
const sharedFormPath = new URL(
  "../../dashboard/breeds/custom-breed-form.tsx",
  import.meta.url,
);

const [detailSource, modalSource, sharedFormSource] = await Promise.all([
  readFile(detailPath, "utf8"),
  readFile(modalPath, "utf8"),
  readFile(sharedFormPath, "utf8"),
]);

test("breed detail places Duplicate Breed in its existing header actions", () => {
  assert.match(detailSource, /<AdminPageHeader[\s\S]*?action=\{/);
  assert.match(detailSource, />\s*Duplicate Breed\s*<\/button>/);
  assert.match(detailSource, /setIsDuplicateBreedOpen\(true\)/);
});

test("Duplicate Breed opens the existing Admin modal in duplicate mode", () => {
  assert.match(
    detailSource,
    /<AdminAddBreedModal[\s\S]*?initialDraft=\{toDuplicateDraft\(breed\)\}[\s\S]*?mode="duplicate"/,
  );
  assert.match(modalSource, /isDuplicate \? "Duplicate Breed" : "Create Breed"/);
  assert.match(modalSource, /"Create Duplicate"/);
  assert.match(modalSource, /<CustomBreedForm/);
});

test("duplicate draft copies only editable catalog fields", () => {
  for (const copiedField of [
    /annualEggProduction: breed\.annual_egg_production/,
    /breedCategory: breed\.category/,
    /description: breed\.description/,
    /eggColor: breed\.egg_color/,
    /name: breed\.breed_name/,
    /speciesId: breed\.species_id/,
    /variety: breed\.variety/,
  ]) {
    assert.match(detailSource, copiedField);
  }

  const duplicateDraft = detailSource.match(
    /function toDuplicateDraft[\s\S]*?return \{([\s\S]*?)\n  \};/,
  )?.[1];
  assert.ok(duplicateDraft);
  assert.doesNotMatch(
    duplicateDraft,
    /breed_id|breed_slug|image_url|is_active|is_custom|sort_order|created_at|updated_at/,
  );
});

test("initial values are cloned, remain editable, and favor Variety focus", () => {
  assert.match(modalSource, /initialDraft\s*\? \{ \.\.\.initialDraft \}/);
  assert.match(modalSource, /onDraftChange=\{setDraft\}/);
  assert.match(modalSource, /varietyInputRef\.current\?\.focus\(\)/);
  assert.match(sharedFormSource, /ref=\{varietyInputRef\}/);
});

test("duplicate submission uses the existing create RPC and detail routing", () => {
  assert.match(modalSource, /"admin_create_catalog_breed"/);
  assert.doesNotMatch(modalSource, /duplicate_catalog_breed|admin_duplicate/);
  assert.match(
    modalSource,
    /router\.push\(`\/admin\/breeds\/\$\{createdBreed\.breed_id\}`\)/,
  );
  assert.match(
    modalSource,
    /This breed and variety already exist for this species\./,
  );
  assert.doesNotMatch(modalSource, /p_image_url|image_url:/);
});

test("opening and editing a duplicate cannot update its source record", () => {
  assert.doesNotMatch(
    modalSource,
    /admin_update_catalog_breed_details|admin_update_catalog_breed_image_url/,
  );
  assert.doesNotMatch(modalSource, /\.update\(/);
});
