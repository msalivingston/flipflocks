import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const planPath = new URL("../../../supabase/functions/_shared/breed-image-family-plan.json", import.meta.url);
const edgePath = new URL("../../../supabase/functions/admin-breed-image-workbench/index.ts", import.meta.url);
const migrationPath = new URL("../../../supabase/migrations/20260818125000_temporary_admin_breed_image_workbench.sql", import.meta.url);
const uiPath = new URL("../_components/admin-breed-image-workbench.tsx", import.meta.url);

const [plan, edgeSource, migrationSource, uiSource] = await Promise.all([
  readFile(planPath, "utf8").then(JSON.parse),
  readFile(edgePath, "utf8"),
  readFile(migrationPath, "utf8"),
  readFile(uiPath, "utf8"),
]);
const executableMigrationSource = migrationSource.replace(/^\s*--.*$/gm, "");

test("finalized plan contains every reviewed chicken record with resolvable masters", () => {
  assert.equal(plan.length, 217);
  assert.equal(new Set(plan.map((record) => record.stable_id)).size, 217);
  assert.equal(new Set(plan.map((record) => record.slug)).size, 217);
  assert.deepEqual(
    new Set(plan.map((record) => record.image_strategy)),
    new Set(["UNIQUE_MASTER", "VARIETY_DERIVATIVE", "VARIABLE_PHENOTYPE"]),
  );

  const bySlug = new Map(plan.map((record) => [record.slug, record]));
  for (const record of plan) {
    const [masterId, masterSlug] = record.proposed_master_record.split("|").map((value) => value.trim());
    const master = bySlug.get(masterSlug);
    assert.ok(master, `${record.slug} master must exist`);
    assert.equal(master.stable_id, masterId, `${record.slug} master ID must match its slug`);
    if (record.image_strategy !== "VARIETY_DERIVATIVE") {
      assert.equal(masterSlug, record.slug, `${record.slug} must reference itself as its independent source`);
    }
  }
});

test("the five final human decisions are unique masters", () => {
  const expected = ["butter-blue", "mesa-blue", "moon-dust-blue", "moon-dust-brown", "orloff-gold"];
  for (const slug of expected) {
    const record = plan.find((item) => item.slug === slug);
    assert.equal(record?.image_strategy, "UNIQUE_MASTER");
    assert.match(record?.proposed_master_record ?? "", new RegExp(`\\| ${slug}$`));
  }
});

test("derivative generation requires the approved plan master", () => {
  assert.match(edgeSource, /mode === "derivative" && !masterBreed\?\.image_url\?\.trim\(\)/);
  assert.match(edgeSource, /master_not_approved/);
  assert.match(edgeSource, /Use the first supplied image as the approved family master/);
  assert.match(edgeSource, /Preserve its bird morphology, pose, framing, camera perspective, lighting, background, and overall composition/);
  assert.match(edgeSource, /Use the second supplied image only as real-world guidance for the target variety's plumage color/);
  assert.match(edgeSource, /Do not copy the target reference's background, pose, framing, camera perspective, lighting, or composition/);
});

test("reference research uses OpenAI image search with the exact finalized identity", () => {
  assert.match(edgeSource, /fetch\("https:\/\/api\.openai\.com\/v1\/responses"/);
  assert.match(edgeSource, /search_content_types: \["image", "text"\]/);
  assert.match(edgeSource, /image_settings: \{ max_results: MAX_REFERENCE_RESULTS, caption: true \}/);
  assert.match(edgeSource, /include: \["web_search_call\.results"\]/);
  assert.match(edgeSource, /`Breed: \$\{record\.breed\}\.`/);
  assert.match(edgeSource, /`Variety: \$\{record\.variety \|\| "none"\}\.`/);
  assert.match(edgeSource, /established hatcheries, poultry breed clubs, agricultural or university sources/);
  assert.match(edgeSource, /do not substitute a vaguely similar heritage breed/);
});

test("selected web references are short-lived server-verified generation inputs", () => {
  assert.match(edgeSource, /crypto\.subtle\.sign/);
  assert.match(edgeSource, /crypto\.subtle\.verify/);
  assert.match(edgeSource, /REFERENCE_TOKEN_TTL_SECONDS = 30 \* 60/);
  assert.match(edgeSource, /payload\.breed_id !== breedId/);
  assert.match(edgeSource, /await loadWebReferenceFile\(await verifyReferenceToken\(webReferenceToken, breedId, serviceRoleKey\)\)/);
  assert.match(edgeSource, /Choose either a web reference or an uploaded reference, not both/);
  assert.doesNotMatch(edgeSource, /reference_storage_path|web_reference_url.*admin_breed_image_reviews/);
});

test("candidates and references cannot publish without explicit approval", () => {
  assert.match(edgeSource, /const WORKBENCH_BUCKET = "breed-image-workbench"/);
  assert.match(edgeSource, /const CATALOG_BUCKET = "catalog-images"/);
  const generateBody = edgeSource.slice(edgeSource.indexOf("async function generateCandidate"), edgeSource.indexOf("async function approveCandidate"));
  assert.doesNotMatch(generateBody, /from\("breeds"\)\.update/);
  const approvalBody = edgeSource.slice(edgeSource.indexOf("async function approveCandidate"), edgeSource.indexOf("async function skipBreed"));
  assert.match(approvalBody, /from\("breeds"\)\.update/);
  assert.match(approvalBody, /image_url: imageUrl/);
  assert.match(uiSource, /Used only as a generation input; never published automatically/);
});

test("OpenAI credentials and approved prompt remain server-side", () => {
  assert.match(edgeSource, /requiredEnv\("OPENAI_API_KEY"\)/);
  assert.match(edgeSource, /FLOCKFRONT_BREED_IMAGE_PROMPT/);
  assert.match(edgeSource, /"gpt-image-2"/);
  assert.match(edgeSource, /OPENAI_BREED_IMAGE_QUALITY.*\|\| "medium"/);
  assert.match(edgeSource, /OPENAI_BREED_REFERENCE_SEARCH_MODEL/);
  assert.doesNotMatch(uiSource, /OPENAI_API_KEY|FLOCKFRONT_BREED_IMAGE_PROMPT/);
});

test("workbench persistence is private and does not recreate storefront views", () => {
  assert.match(migrationSource, /'breed-image-workbench',[\s\S]*?false,/);
  assert.match(migrationSource, /enable row level security/);
  assert.match(migrationSource, /revoke all on table public\.admin_breed_image_reviews from authenticated/);
  assert.doesNotMatch(executableMigrationSource, /public_storefront_inventory|^\s*create\s+(or\s+replace\s+)?view/im);
  assert.doesNotMatch(executableMigrationSource, /seller_breed_profiles|order_items|listing_batches|inventory_items/);
});

test("review UI exposes reference research, manual fallback, and per-record controls", () => {
  for (const label of ["Generate", "Regenerate", "Approve", "Skip", "Not generated", "Waiting for master", "Candidate ready", "Approved", "Skipped", "Generation failed"]) {
    assert.ok(uiSource.includes(label), `missing UI label: ${label}`);
  }
  for (const label of ["Reference Images", "Find References", "Refresh References", "Use uploaded reference instead", "Web reference selected above."]) {
    assert.ok(uiSource.includes(label), `missing reference UI label: ${label}`);
  }
  assert.match(uiSource, /aria-pressed=\{isSelected\}/);
  assert.match(uiSource, /candidate\.source_domain/);
  assert.match(uiSource, /webReferenceToken: action === "generate"/);
  assert.doesNotMatch(uiSource, /generate all|batch generate/i);
});
