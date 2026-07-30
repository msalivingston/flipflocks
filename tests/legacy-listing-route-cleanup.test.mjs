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

test("obsolete Listings routes redirect to current inventory routes", () => {
  const listingsIndex = readRepositoryFile(
    "app/dashboard/listings/page.tsx",
  );
  const listingDetail = readRepositoryFile(
    "app/dashboard/listings/[listingBatchId]/page.tsx",
  );

  assert.match(listingsIndex, /redirect\("\/dashboard\/inventory"\)/);
  assert.match(
    listingDetail,
    /redirect\(`\/dashboard\/inventory\/\$\{listingBatchId\}\/edit`\)/,
  );
});

test("obsolete Live Birds wizard routes redirect to Add Live Birds v2", () => {
  for (const path of [
    "app/dashboard/listings/new/birds/single/page.tsx",
    "app/dashboard/listings/new/birds/batch/page.tsx",
  ]) {
    assert.match(
      readRepositoryFile(path),
      /redirect\("\/dashboard\/inventory\/add-v2\/live-birds"\)/,
    );
  }
});

test("obsolete standalone Hatching Eggs URL redirects to the canonical route", () => {
  const route = readRepositoryFile(
    "app/dashboard/listings/new/birds/hatching-eggs-standalone/page.tsx",
  );

  assert.match(
    route,
    /redirect\("\/dashboard\/listings\/new\/birds\/hatching-eggs"\)/,
  );
});

test("current Live Birds and Hatching Eggs entrypoints remain intact", () => {
  const addLiveBirds = readRepositoryFile(
    "app/dashboard/inventory/add-v2/live-birds/page.tsx",
  );
  const editLiveBirds = readRepositoryFile(
    "app/dashboard/inventory/[listingBatchId]/edit/page.tsx",
  );
  const addHatchingEggs = readRepositoryFile(
    "app/dashboard/listings/new/birds/hatching-eggs/page.tsx",
  );
  const editHatchingEggs = readRepositoryFile(
    "app/dashboard/listings/new/birds/hatching-eggs/[hatchingEggItemId]/page.tsx",
  );

  assert.match(addLiveBirds, /export default function LiveBirdsV2Page/);
  assert.match(editLiveBirds, /LiveBirdsListingForm/);
  assert.match(editLiveBirds, /mode="edit"/);
  assert.match(addHatchingEggs, /HatchingEggsStandaloneOnePageForm/);
  assert.match(editHatchingEggs, /HatchingEggsStandaloneOnePageForm/);
  assert.match(editHatchingEggs, /mode="edit"/);
});

test("deleted legacy listing implementations are absent and unimported", () => {
  const deletedFiles = [
    "app/dashboard/listings/listings-foundation.tsx",
    "app/dashboard/listings/[listingBatchId]/listing-detail.tsx",
    "app/dashboard/listings/[listingBatchId]/publish-readiness.ts",
    "app/dashboard/listings/[listingBatchId]/publish-readiness-review.tsx",
    "app/dashboard/listings/new/birds/single/single-breed-basics-form.tsx",
    "app/dashboard/listings/new/birds/batch/batch-listing-form.tsx",
    "app/dashboard/listings/new/_components/breed-combobox.tsx",
    "app/dashboard/listings/new/_components/custom-breed-dialog.tsx",
    "app/dashboard/listings/new/create-listing-start.tsx",
  ];
  const deletedModuleNames = [
    "listings-foundation",
    "listing-detail",
    "publish-readiness",
    "publish-readiness-review",
    "single-breed-basics-form",
    "batch-listing-form",
    "breed-combobox",
    "custom-breed-dialog",
    "create-listing-start",
  ];

  for (const path of deletedFiles) {
    assert.equal(existsSync(resolve(repositoryRoot, path)), false, path);
  }

  const source = listSourceFiles(resolve(repositoryRoot, "app"))
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");

  for (const moduleName of deletedModuleNames) {
    assert.doesNotMatch(
      source,
      new RegExp(`(?:from|import\\s*\\()[^\\n]*${moduleName}`),
      moduleName,
    );
  }
});
