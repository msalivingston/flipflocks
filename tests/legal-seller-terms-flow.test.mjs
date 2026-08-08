import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("public legal routes render the approved legal documents", async () => {
  const [termsPage, privacyPage, acceptableUsePage, documents] = await Promise.all([
    read("app/terms/page.tsx"),
    read("app/privacy/page.tsx"),
    read("app/acceptable-use/page.tsx"),
    read("lib/legal-documents.ts"),
  ]);

  assert.match(termsPage, /termsDocument/);
  assert.match(privacyPage, /privacyDocument/);
  assert.match(acceptableUsePage, /acceptableUseDocument/);
  assert.match(documents, /Effective Date: August 8, 2026/);
  assert.match(documents, /Version: 2026-08-08/);
  assert.match(documents, /Pay at Pickup is available as a FlockFront payment option/);
  assert.match(documents, /FlockFront does not sell personal information/);
  assert.match(documents, /Prohibited Listings and Content/);
});

test("one shared legal contract supplies production routes and display version", async () => {
  const legal = await read("lib/legal.ts");

  assert.match(legal, /terms: "\/terms"/);
  assert.match(legal, /privacy: "\/privacy"/);
  assert.match(legal, /acceptableUse: "\/acceptable-use"/);
  assert.match(legal, /effectiveDate: "August 8, 2026"/);
  assert.match(legal, /version: "2026-08-08"/);
});

test("signup legal links use the real shared routes", async () => {
  const signup = await read("app/signup/signup-form.tsx");

  assert.match(signup, /href=\{legalRoutes\.terms\}/);
  assert.match(signup, /href=\{legalRoutes\.privacy\}/);
  assert.doesNotMatch(signup, /Terms of Service[\s\S]{0,180}href="#"/);
});

test("Seller Terms acceptance is explicit and browser input cannot choose legal identity fields", async () => {
  const component = await read("app/_components/seller-terms-acceptance.tsx");

  assert.match(component, /type="checkbox"/);
  assert.match(component, /I have read and agree to the FlockFront/);
  assert.match(component, /href=\{legalRoutes\.terms\}/);
  assert.match(component, /seller_accept_current_terms/);
  assert.match(component, /\{ p_store_id: storeId \}/);
  assert.doesNotMatch(component, /terms_version:/);
  assert.doesNotMatch(component, /accepted_by_user_id:/);
  assert.doesNotMatch(component, /accepted_at:/);
});

test("final onboarding cannot finish until authoritative acceptance succeeds", async () => {
  const review = await read("app/onboarding/_components/step-6-review-setup.tsx");

  assert.match(review, /SellerTermsAcceptance/);
  assert.match(review, /initiallyAccepted=\{reviewData\.termsAccepted\}/);
  assert.match(review, /disabled=\{isSubmitting \|\| !reviewData\.termsAccepted\}/);
  assert.match(review, /seller_complete_onboarding/);
  assert.match(review, /termsAccepted: true/);
});

test("completed existing sellers remain routed to the dashboard", async () => {
  const flow = await read("app/onboarding/_components/onboarding-flow.tsx");

  assert.match(
    flow,
    /if \(onboardingProgress\?\.onboarding_complete\) \{[\s\S]*router\.replace\("\/dashboard"\)/,
  );
});

test("Store Admin distinguishes billing success from missing Terms and refreshes readiness", async () => {
  const storeAdmin = await read("app/dashboard/store-admin/store-admin.tsx");

  assert.match(storeAdmin, /Review and accept the Seller Terms/);
  assert.match(storeAdmin, /Finish billing setup/);
  assert.match(storeAdmin, /showTermsAction/);
  assert.match(storeAdmin, /SellerTermsAcceptance/);
  assert.match(storeAdmin, /onTermsAccepted=\{reloadReadiness\}/);
  assert.match(storeAdmin, /termsAccepted &&[\s\S]*!billingAccessActive/);
});

test("the trusted RPC controls identity, version, timestamp, authorization, and idempotency", async () => {
  const migration = await read(
    "supabase/migrations/20260808160000_seller_terms_acceptance.sql",
  );

  assert.match(migration, /select '2026-08-08'::text/);
  assert.match(migration, /v_user_id uuid := auth\.uid\(\)/);
  assert.match(migration, /stores\.owner_user_id = v_user_id/);
  assert.match(migration, /v_terms_version text := public\.current_seller_terms_version\(\)/);
  assert.match(migration, /on conflict \(store_id, accepted_by_user_id, terms_version\) do nothing/);
  assert.match(migration, /grant execute on function public\.seller_accept_current_terms\(uuid\)[\s\S]*to authenticated/);
  assert.doesNotMatch(migration, /p_terms_version/);
  assert.doesNotMatch(migration, /p_accepted_by_user_id/);
  assert.doesNotMatch(migration, /p_accepted_at/);
});

test("onboarding completion has a server-side authoritative Terms gate", async () => {
  const migration = await read(
    "supabase/migrations/20260808160000_seller_terms_acceptance.sql",
  );

  assert.match(migration, /SELLER_TERMS_ACCEPTANCE_REQUIRED/);
  assert.match(
    migration,
    /seller_terms_acceptances\.accepted_by_user_id = v_store\.owner_user_id/,
  );
});

test("Step 2 edits preserve established onboarding progress", async () => {
  const migration = await read(
    "supabase/migrations/20260808160000_seller_terms_acceptance.sql",
  );
  const tests = await read("supabase/tests/onboarding_storefront_information_test.sql");

  assert.match(
    migration,
    /v_new text := \$new\$[\s\S]*profile_complete = true,[\s\S]*updated_at = now\(\)/,
  );
  assert.match(tests, /editing existing Farm Information preserves all later onboarding progress/);
  assert.match(tests, /a new onboarding row still initializes later progress flags as incomplete/);
});

