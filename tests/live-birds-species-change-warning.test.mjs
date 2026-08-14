import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(
  new URL(
    "../app/dashboard/inventory/add-v2/live-birds/page.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("changing species warns only after a bird entry has been started", () => {
  assert.match(
    pageSource,
    /offerings\.some\(\(offering\) => isBirdsForSaleGroupStarted\(offering\)\)/,
  );
  assert.match(
    pageSource,
    /setPendingSpeciesChange\(nextSpecies\);\s*return;/,
  );
  assert.match(pageSource, /applySpeciesChange\(nextSpecies, false\)/);
});

test("confirming the warning changes species and clears every bird entry", () => {
  assert.match(
    pageSource,
    /applySpeciesChange\(pendingSpeciesChange, true\)/,
  );
  assert.match(
    pageSource,
    /alignOfferingsToBreedOptions\(initialOfferings, nextBreedOptions\)/,
  );
  assert.match(
    pageSource,
    /nextOfferingId\.current = initialOfferings\.length \+ 1/,
  );
  assert.match(pageSource, /setGroupsReviewMode\(false\)/);
  assert.match(pageSource, /setScrollToOfferingId\(null\)/);
  assert.match(pageSource, /setShowBirdsForSaleCompletionError\(false\)/);
  assert.match(pageSource, /setHighestUnlockedDesktopStep\(2\)/);
});

test("the shared warning dialog is available to both mobile and desktop", () => {
  assert.match(
    pageSource,
    /\{pendingSpeciesChange \? \(\s*<SpeciesChangeWarningDialog/,
  );
  assert.match(pageSource, /Change species\?/);
  assert.match(pageSource, /Keep current species/);
  assert.match(pageSource, /Change species and remove birds/);
  assert.match(
    pageSource,
    /will remove all bird\s*entries you have already added\. This cannot be undone\./,
  );
});
