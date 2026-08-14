import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const sourceUrl = new URL(`../${specifier.slice(2)}.ts`, import.meta.url);
      return nextResolve(sourceUrl.href, context);
    }

    return nextResolve(specifier, context);
  },
});

const migrationUrl = new URL(
  "../supabase/migrations/20260820110000_fix_embed_only_checkout_lookup.sql",
  import.meta.url,
);
const correctiveMigrationUrl = new URL(
  "../supabase/migrations/20260820130000_restore_embed_safe_payment_storefront_lookup.sql",
  import.meta.url,
);

test("checkout lookups use canonical storefront home without widening discovery", async () => {
  const [migration, visibilityMigration] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(
      new URL(
        "../supabase/migrations/20260809130000_store_visibility_and_embed_links.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(
    migration,
    /public\.get_public_storefront_by_slug\(text\)'::regprocedure/,
  );
  assert.match(
    migration,
    /public\.get_public_checkout_summary\(text,jsonb\)'::regprocedure/,
  );
  assert.equal(
    (migration.match(/public\.get_public_storefront_home\(/g) ?? []).length,
    2,
  );
  assert.match(
    visibilityMigration,
    /stores\.storefront_visibility = ''public''/,
  );
  assert.doesNotMatch(
    migration,
    /create or replace view public\.public_storefront_home/,
  );
});

test("Payment Methods retains the canonical embed-safe storefront lookup", async () => {
  const [migration, checkout] = await Promise.all([
    readFile(correctiveMigrationUrl, "utf8"),
    readFile(
      new URL(
        "../supabase/functions/stripe-connect-checkout/index.ts",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(
    migration,
    /left join lateral public\.get_public_storefront_home\(\s*storefront_status\.store_slug\s*\) as public_storefront_home on true/,
  );
  assert.doesNotMatch(
    migration,
    /left join public\.public_storefront_home/,
  );
  assert.doesNotMatch(
    migration,
    /create or replace view public\.public_storefront_home/,
  );
  assert.match(
    migration,
    /'pay_at_pickup_enabled', stores\.pay_at_pickup_enabled/,
  );
  assert.match(
    migration,
    /'card_payments_enabled', stores\.card_payments_enabled/,
  );

  const availability = checkout.slice(
    checkout.indexOf('if (body.action === "availability")'),
    checkout.indexOf('if (body.action === "status")'),
  );
  assert.match(
    availability,
    /storefrontData\.card_payments_enabled !== true[\s\S]*connectionForStore\(storeId\)[\s\S]*readyAccount\(accountId\)/,
  );
});

test("the intended embed route still gates embed-only checkout access", async () => {
  const { resolveStorefrontVisibilityDecision } = await import(
    "../lib/storefront-visibility.ts"
  );
  const websiteUrl = "https://www.sunshinemesafarm.com/shopping";

  assert.deepEqual(
    resolveStorefrontVisibilityDecision({
      isPubliclyAvailable: true,
      searchParams: {},
      storeSlug: "public-farm",
      visibility: "public",
      websiteUrl: null,
    }),
    { action: "allow", orderMode: null },
  );

  const embedDecision = resolveStorefrontVisibilityDecision({
    isPubliclyAvailable: true,
    searchParams: { orderMode: "embed", return: websiteUrl },
    storeSlug: "sunshine-mesa-farm",
    visibility: "embed_only",
    websiteUrl,
  });
  assert.equal(embedDecision.action, "allow");
  assert.equal(embedDecision.orderMode?.mode, "embed");

  assert.notEqual(
    resolveStorefrontVisibilityDecision({
      isPubliclyAvailable: true,
      searchParams: {},
      storeSlug: "sunshine-mesa-farm",
      visibility: "embed_only",
      websiteUrl,
    }).action,
    "allow",
  );
});
