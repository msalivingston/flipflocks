import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const draftStateSource = await readFile(
  new URL(
    "../app/dashboard/inventory/_lib/live-bird-draft-state.ts",
    import.meta.url,
  ),
  "utf8",
);
const inventorySource = await readFile(
  new URL("../app/dashboard/inventory/inventory-management.tsx", import.meta.url),
  "utf8",
);
const savedDraftsSource = await readFile(
  new URL("../app/dashboard/inventory/add-v2/page.tsx", import.meta.url),
  "utf8",
);

test("unfinished add-v2 drafts require hidden state, the marker, and no publication history", () => {
  assert.match(
    draftStateSource,
    /listing_batch_visibility_status === "hidden"[\s\S]*internal_batch_label === liveBirdsV2DraftMarker[\s\S]*!state\.has_published_activity/,
  );
});

test("unfinished drafts continue through the existing draftId workflow", () => {
  assert.match(
    draftStateSource,
    /\/dashboard\/inventory\/add-v2\/live-birds\?draftId=\$\{listingBatchId\}/,
  );
  assert.match(inventorySource, /\? "Continue draft"[\s\S]*: "Edit"/);
});

test("Saved drafts only includes publication-state rows classified as unfinished", () => {
  assert.match(
    savedDraftsSource,
    /filter\(\(state\) => state\.is_unfinished_add_v2_draft\)/,
  );
});

test("direct re-show translates the authoritative Coop error", () => {
  assert.match(
    draftStateSource,
    /would exceed your Coop plan’s limit of 5 active birds/,
  );
  assert.match(inventorySource, /getCoopActivationErrorMessage/);
});
