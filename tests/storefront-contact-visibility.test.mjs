import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

const migration = read(
  "supabase/migrations/20260818100000_storefront_contact_visibility.sql",
);
const storeAdmin = read("app/dashboard/store-admin/store-admin.tsx");
const sellerTypes = read("app/dashboard/_lib/seller-types.ts");
const storefrontShell = read(
  "app/store/[slug]/storefront-shell-components.tsx",
);
const policiesPage = read("app/store/[slug]/policies/page.tsx");
const accessMigration = read(
  "supabase/migrations/20260809130000_store_visibility_and_embed_links.sql",
);
const worker = read("supabase/functions/postmark-email-worker/index.ts");

test("Store Information owns all three public contact controls", () => {
  const storeInformation = storeAdmin.slice(
    storeAdmin.indexOf('title="Store information"'),
    storeAdmin.indexOf('id="business"'),
  );
  const businessDetails = storeAdmin.slice(
    storeAdmin.indexOf('id="business"'),
    storeAdmin.indexOf("type StorefrontAccordionId"),
  );

  for (const label of ["Show email", "Show phone", "Show website"]) {
    assert.match(storeInformation, new RegExp(`label="${label}"`));
    assert.doesNotMatch(businessDetails, new RegExp(`label="${label}"`));
  }

  assert.match(storeInformation, /href="\/dashboard\/account"/);
  assert.doesNotMatch(storeInformation, /public_email: string/);
});

test("Store Admin carries and saves website visibility without moving the operational URL", () => {
  assert.match(sellerTypes, /show_public_website: boolean/);
  assert.match(storeAdmin, /show_public_website: boolean/);
  assert.match(storeAdmin, /show_public_website: form\.show_public_website/);
  assert.match(storeAdmin, /show_public_website: seller\.show_public_website/);

  const visibilitySection = storeAdmin.slice(
    storeAdmin.indexOf('id="visibility"'),
    storeAdmin.indexOf('title="Store information"'),
  );
  assert.match(visibilitySection, /label=\{[\s\S]*Website URL/);
  assert.match(visibilitySection, /onUpdateField\("website_url", value\)/);
});

test("desktop and compact footers render all public contacts independently", () => {
  const desktopContact = storefrontShell.slice(
    storefrontShell.indexOf('<FooterColumn title="Contact">'),
    storefrontShell.indexOf("</FooterColumn>", storefrontShell.indexOf('<FooterColumn title="Contact">')),
  );
  const compactContact = storefrontShell.slice(
    storefrontShell.indexOf("function CompactAboutFooter"),
    storefrontShell.indexOf("function FooterColumn"),
  );

  assert.match(desktopContact, /store\.public_phone \?/);
  assert.match(desktopContact, /store\.public_email \?/);
  assert.doesNotMatch(desktopContact, /!store\.public_phone && store\.public_email/);
  assert.match(desktopContact, /store\.website_url \?/);
  assert.match(desktopContact, /rel="noopener noreferrer"/);
  assert.match(desktopContact, /target="_blank"/);

  for (const field of ["public_email", "public_phone", "website_url"]) {
    assert.match(compactContact, new RegExp(`store\\.${field} \\?`));
  }
});

test("Policies contact content includes each prefiltered public contact", () => {
  assert.match(
    policiesPage,
    /store\.public_email \|\| store\.public_phone \|\| store\.website_url/,
  );
  assert.match(policiesPage, /mailto:\$\{store\.public_email\}/);
  assert.match(policiesPage, /tel:\$\{store\.public_phone\}/);
  assert.match(policiesPage, /href=\{store\.website_url\}/);
  assert.match(policiesPage, /rel="noopener noreferrer"/);
});

test("migration adds privacy-safe display state and preserves embed access routing", () => {
  assert.match(
    migration,
    /add column show_public_website boolean not null default false/,
  );
  assert.match(migration, /public\.public_storefronts/);
  assert.match(migration, /public\.get_public_storefront_home\(text\)/);
  assert.match(migration, /public\.get_seller_storefront_home_preview\(text\)/);
  assert.match(migration, /public\.get_seller_context\(\)/);
  assert.match(migration, /public\.seller_update_store_settings\(uuid,jsonb\)/);
  assert.doesNotMatch(migration, /get_public_storefront_access/);
  assert.match(accessMigration, /stores\.website_url/);
});

test("contact visibility migration does not touch transactional email behavior", () => {
  assert.doesNotMatch(migration, /email_notifications|postmark|notification_type/);
  assert.doesNotMatch(
    migration,
    /seller_new_order|seller_first_sale|seller_subscription|buyer_order/,
  );
  assert.match(worker, /sellerContactEmail: ownerEmail/);
  assert.match(worker, /recipientType === "buyer" \? ownerEmail : buyerEmail/);
});
