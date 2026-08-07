import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const presentationModule = await import(
  "../lib/storefront-hero-presentation.ts"
);

const {
  getHeroObjectPosition,
  normalizeHeroPresentation,
  resolveHeroFocalPoint,
} = presentationModule;

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("desktop focal points are normalized and clamped", () => {
  assert.deepEqual(
    normalizeHeroPresentation({ desktop: { x: -12, y: 122.345 } }),
    { desktop: { x: 0, y: 100 } },
  );
  assert.equal(
    getHeroObjectPosition({ desktop: { x: 24.25, y: 76.75 } }, "desktop"),
    "24.25% 76.75%",
  );
});

test("mobile falls back to desktop until an independent override exists", () => {
  const desktopOnly = { desktop: { x: 18, y: 64 } };
  assert.deepEqual(resolveHeroFocalPoint(desktopOnly, "mobile"), { x: 18, y: 64 });

  const overridden = { ...desktopOnly, mobile: { x: 81, y: 29 } };
  assert.deepEqual(resolveHeroFocalPoint(overridden, "desktop"), { x: 18, y: 64 });
  assert.deepEqual(resolveHeroFocalPoint(overridden, "mobile"), { x: 81, y: 29 });

  const reset = { desktop: overridden.desktop };
  assert.deepEqual(resolveHeroFocalPoint(reset, "mobile"), { x: 18, y: 64 });
});

test("the storefront and editor share one focal hero renderer", async () => {
  const [home, admin, backdrop] = await Promise.all([
    read("app/store/[slug]/storefront-home-content.tsx"),
    read("app/dashboard/store-admin/store-admin.tsx"),
    read("app/store/[slug]/storefront-hero-backdrop.tsx"),
  ]);

  assert.match(home, /<StorefrontHeroBackdrop/);
  assert.match(admin, /<StorefrontHeroBackdrop/);
  assert.match(backdrop, /objectPosition: getHeroObjectPosition/);
  assert.match(backdrop, /layout === "right"/);
  assert.match(backdrop, /lg:w-\[min\(100%,93\.75rem\)\]/);
});

test("legacy hero transforms exist only in the one-time migration", async () => {
  const [migration, appSource] = await Promise.all([
    read("supabase/migrations/20260807130000_store_hero_focal_presentation.sql"),
    Promise.all([
      read("app/dashboard/store-admin/store-admin.tsx"),
      read("app/store/[slug]/storefront-ui.tsx"),
      read("app/store/[slug]/storefront-home-content.tsx"),
      read("app/store/[slug]/storefront-hero-backdrop.tsx"),
    ]).then((parts) => parts.join("\n")),
  ]);

  assert.match(migration, /358,\s+213\.6,\s+0\.82,\s+1\.22/);
  assert.doesNotMatch(appSource, /getMobileStorefrontHeroCropStyle/);
  assert.doesNotMatch(appSource, /buildHeroInitialCrop|getHeroCoverZoom/);
  assert.doesNotMatch(appSource, /0\.82|1\.22/);
});

test("both home RPCs and media management expose the narrow presentation", async () => {
  const migration = await read(
    "supabase/migrations/20260807130000_store_hero_focal_presentation.sql",
  );

  assert.match(migration, /create function public\.get_public_storefront_home/);
  assert.match(migration, /create function public\.get_seller_storefront_home_preview/);
  assert.match(migration, /create or replace view public\.seller_media_management/);
  assert.match(migration, /seller_update_store_hero_presentation/);
  assert.doesNotMatch(
    migration.match(/create or replace function public\.seller_update_store_hero_presentation[\s\S]*?\$function\$;/)?.[0] ?? "",
    /crop_metadata|zoom|rotation|aspect/,
  );
});
