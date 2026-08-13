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
