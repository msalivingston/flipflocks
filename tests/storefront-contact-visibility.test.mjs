import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");
const correctiveMigration = read(
  "supabase/migrations/20260818110000_public_contact_email_phone_only.sql",
);
const storeAdmin = read("app/dashboard/store-admin/store-admin.tsx");
const sellerTypes = read("app/dashboard/_lib/seller-types.ts");
const storefrontData = read("app/store/[slug]/storefront-data.ts");
const storefrontShell = read(
  "app/store/[slug]/storefront-shell-components.tsx",
);
const storefrontUi = read("app/store/[slug]/storefront-ui.tsx");
const policiesPage = read("app/store/[slug]/policies/page.tsx");
const onboardingForm = read(
  "app/onboarding/_components/step-4-pickup-instructions-form.tsx",
);
const accessMigration = read(
  "supabase/migrations/20260809130000_store_visibility_and_embed_links.sql",
);
const worker = read("supabase/functions/postmark-email-worker/index.ts");

test("Store Information contains email, phone, and text contact controls", () => {
  const storeInformation = storeAdmin.slice(
    storeAdmin.indexOf('title="Store information"'),
    storeAdmin.indexOf('id="business"'),
  );
  assert.match(storeInformation, /label="Show email"/);
  assert.match(storeInformation, /label="Show phone"/);
  assert.match(
    storeInformation,
    /label="Show text - will display the phone with \(Text Only\) next to it"/,
  );
  assert.doesNotMatch(storeInformation, /Show website|show_public_website/);
  assert.match(storeInformation, /href="\/dashboard\/account"/);
  assert.doesNotMatch(storeInformation, /public_email: string/);

  const visibilitySection = storeAdmin.slice(
    storeAdmin.indexOf('id="visibility"'),
    storeAdmin.indexOf('title="Store information"'),
  );
  assert.match(visibilitySection, /Website URL/);
  assert.match(visibilitySection, /onUpdateField\("website_url", value\)/);
});

test("Store Admin blocks saving both public contact methods off", () => {
  assert.match(
    storeAdmin,
    /!form\.show_public_email &&[\s\S]*!form\.buyer_contact_phone_enabled &&[\s\S]*!form\.buyer_contact_text_enabled/,
  );
  assert.match(
    storeAdmin,
    /Choose at least one contact method to display on your storefront\./,
  );
  assert.match(storeAdmin, /role="alert"/);
  assert.match(
    storeAdmin,
    /saveMessage && saveMessage !== publicContactValidationMessage/,
  );
  assert.doesNotMatch(storeAdmin, /show_public_website/);
  assert.doesNotMatch(sellerTypes, /show_public_website/);
  assert.match(sellerTypes, /buyer_contact_phone_enabled: boolean/);
  assert.match(sellerTypes, /buyer_contact_text_enabled: boolean/);
  assert.match(
    storeAdmin,
    /value \|\| form\.buyer_contact_text_enabled/,
  );
  assert.match(
    storeAdmin,
    /value \|\| form\.buyer_contact_phone_enabled/,
  );
});

test("desktop and compact footers render email and phone independently without website", () => {
  const desktopContact = storefrontShell.slice(
    storefrontShell.indexOf('<FooterColumn title="Contact">'),
    storefrontShell.indexOf(
      "</FooterColumn>",
      storefrontShell.indexOf('<FooterColumn title="Contact">'),
    ),
  );
  const compactContact = storefrontShell.slice(
    storefrontShell.indexOf("function CompactAboutFooter"),
    storefrontShell.indexOf("function FooterColumn"),
  );
  for (const contact of [desktopContact, compactContact]) {
    assert.match(contact, /store\.public_email \?/);
    assert.match(contact, /store\.public_phone \?/);
    assert.doesNotMatch(contact, /store\.website_url|Website/);
  }
  assert.doesNotMatch(desktopContact, /!store\.public_phone && store\.public_email/);
  assert.doesNotMatch(storefrontUi, /label: "Website"/);
});

test("public phone labeling uses existing call and text preferences", () => {
  assert.match(storefrontData, /buyer_contact_phone_enabled: boolean/);
  assert.match(storefrontData, /buyer_contact_text_enabled: boolean/);
  for (const source of [storefrontShell, policiesPage]) {
    assert.match(source, /\$\{store\.public_phone\} \(Text Only\)/);
    assert.match(source, /\$\{store\.public_phone\} \(Call or Text\)/);
    assert.match(
      source,
      /store\.buyer_contact_text_enabled && !store\.buyer_contact_phone_enabled/,
    );
  }
});

test("Policies contact content includes only email and phone", () => {
  assert.match(policiesPage, /store\.public_email \|\| store\.public_phone/);
  assert.match(policiesPage, /mailto:\$\{store\.public_email\}/);
  assert.match(policiesPage, /tel:\$\{store\.public_phone\}/);
  assert.doesNotMatch(policiesPage, /href=\{store\.website_url\}|Website:/);
});

test("onboarding blocks none and maps Email, Phone, and Text through the server", () => {
  assert.match(
    onboardingForm,
    /Choose at least one contact method to display on your storefront\./,
  );
  assert.match(correctiveMigration, /show_public_email = v_email_enabled/);
  assert.match(
    correctiveMigration,
    /show_public_phone = \(v_text_enabled or v_phone_enabled\)/,
  );
});

test("corrective migration removes website visibility and enforces email or phone", () => {
  assert.match(correctiveMigration, /drop column show_public_website/);
  assert.match(
    correctiveMigration,
    /check \(show_public_email or show_public_phone\)/,
  );
  assert.match(
    correctiveMigration,
    /Choose at least one contact method to display on your storefront\./,
  );
  assert.match(correctiveMigration, /buyer_contact_phone_enabled boolean/);
  assert.match(correctiveMigration, /buyer_contact_text_enabled boolean/);
});

test("embed website routing remains raw and transactional email behavior is untouched", () => {
  assert.doesNotMatch(correctiveMigration, /get_public_storefront_access/);
  assert.match(accessMigration, /stores\.website_url/);
  assert.doesNotMatch(
    correctiveMigration,
    /email_notifications|postmark|notification_type|seller_new_order|seller_first_sale|seller_subscription|buyer_order/,
  );
  assert.match(worker, /sellerContactEmail: ownerEmail/);
  assert.match(worker, /recipientType === "buyer" \? ownerEmail : buyerEmail/);
});
