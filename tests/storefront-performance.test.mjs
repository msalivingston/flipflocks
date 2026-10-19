import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { getListingImageRemotePattern, isOptimizableListingImage } from "../lib/storefront-images.ts";

const root = new URL("../", import.meta.url);
const project = "https://example-project.supabase.co";
const photo = `${project}/storage/v1/object/public/seller-media/stores/farm/photo.png`;

test("image optimization allows only this project's public seller-media bucket without query strings", () => {
  assert.deepEqual(getListingImageRemotePattern(project), {
    protocol: "https", hostname: "example-project.supabase.co", port: "",
    pathname: "/storage/v1/object/public/seller-media/**", search: "",
  });
  assert.equal(isOptimizableListingImage(photo, project), true);
  for (const src of [
    photo.replace("example-project", "another-project"),
    photo.replace("seller-media", "private-media"),
    photo.replace("https:", "http:"),
    photo.replace(".co/", ".co:444/"),
    photo.replace(".co/", ".co.evil.test/"),
    photo.replace("https://", "https://user:password@"),
    `${photo}?download=1`, `${photo}#fragment`, "/placeholder.png", "invalid",
    photo.replace("/stores/farm/photo.png", "/../../../private/photo.png"),
  ]) assert.equal(isOptimizableListingImage(src, project), false, src);
  for (const base of [undefined, "invalid", "http://localhost:54321", "https://example.test:444", "https://user@example.test"]) {
    assert.equal(getListingImageRemotePattern(base), null);
    assert.equal(isOptimizableListingImage(photo, base), false);
  }
});

test("listing photos optimize allowed sources, retain external fallbacks, and leave detail galleries unchanged", async () => {
  const ui = await load("app/store/[slug]/storefront-ui.tsx", {
    "next/image": { default: "Image" }, "next/link": { default: "Link" },
    "./storefront-fonts": {},
    "@/lib/storefront-images": {
      isOptimizableListingImage: (src) => isOptimizableListingImage(src, project),
    },
    "react/jsx-runtime": jsxRuntime,
  });
  const optimized = ui.ListingPhoto({ alt: "Breed", src: photo, optimize: true, sizes: "42vw", fetchPriority: "high" });
  assert.equal(optimized.props.unoptimized, false);
  assert.equal(optimized.props.src, photo);
  assert.equal(optimized.props.sizes, "42vw");
  assert.equal(optimized.props.fetchPriority, "high");
  // Do not eagerly download both the hidden mobile and desktop copies.
  assert.equal(optimized.props.loading, undefined);
  assert.equal(optimized.props.preload, undefined);
  assert.equal(ui.ListingPhoto({ alt: "Breed", src: photo }).props.unoptimized, true);
  const external = "https://legacy.example.test/photo.jpg";
  const fallback = ui.ListingPhoto({ alt: "Legacy", src: external, optimize: true });
  assert.equal(fallback.props.src, external);
  assert.equal(fallback.props.unoptimized, true);
  const missing = ui.ListingPhoto({ alt: "Missing", src: null, optimize: true });
  assert.equal(missing.props.label, "Photo coming soon");
});

test("the first gallery row gets high fetch priority; responsive copies and later cards stay lazy", async () => {
  const tabs = await readFile(new URL("app/store/[slug]/storefront-listing-tabs.tsx", root), "utf8");
  assert.match(tabs, /initiallyVisible=\{index < 3\}/);
  assert.equal(tabs.match(/fetchPriority=\{initiallyVisible \? "high" : undefined\}/g)?.length, 2);
  assert.match(tabs, /\(min-width: 820px\) 14vw/);
  assert.match(tabs, /\(max-width: 1023px\) 1px/);
  assert.doesNotMatch(tabs, /loading="eager"|preload=|priority=/);
});

const bird = (profile, quantity, availability = "ready_now") => ({
  seller_breed_profile_id: profile, batch_type: "live_animals", inventory_type: "female",
  quantity_available: quantity, buyer_availability_code: availability,
});

test("profile media starts before unrelated inventory finishes and only includes gallery-eligible breeds", async () => {
  const equipment = deferred();
  const inventory = [bird("eligible", 5), bird("eligible", 2), bird("empty", 0), bird("sold", 3, "sold_out"), bird("future", 4, "reserve_now")];
  const harness = await dataHarness({ inventory, equipment: equipment.promise });
  const pending = harness.module.loadPublicStorefrontListingData("farm");
  await new Promise((resolve) => setImmediate(resolve));
  const media = harness.calls.find((c) => c.table === "public_storefront_media_gallery");
  assert.ok(media, "profile media must not wait for equipment");
  assert.deepEqual(media.ids, ["eligible", "future"]);
  assert.equal(media.fields, "entity_id, public_url, alt_text");
  assert.ok(harness.calls.every((c) => c.slug === "farm"));
  equipment.resolve({ data: [{ item_name: "Feeder" }], error: null });
  const result = await pending;
  assert.equal(result.error, null);
  assert.deepEqual(result.data.inventory, inventory, "do not remove or alter inventory data");
  assert.deepEqual(result.data.equipment, [{ item_name: "Feeder" }]);
  assert.deepEqual(result.data.livePoultryProfileImages, {
    eligible: { imageUrl: "/first.jpg", imageAlt: "Preferred photo" },
  });
  assert.deepEqual(media.order, [["is_featured", { ascending: false }], ["sort_order", { ascending: true }]]);
});

test("all sold-out inventory skips the media query without dropping inventory", async () => {
  const inventory = [bird("empty", 0), bird("sold", 1, "sold_out")];
  const harness = await dataHarness({ inventory });
  const result = await harness.module.loadPublicStorefrontListingData("farm");
  assert.deepEqual(result.data.inventory, inventory);
  assert.deepEqual(result.data.livePoultryProfileImages, {});
  assert.ok(!harness.calls.some((c) => c.table === "public_storefront_media_gallery"));
});

test("media failure keeps the existing featured-image fallback; inventory failure remains an error", async () => {
  const mediaFailure = await dataHarness({ mediaError: { message: "media unavailable" } });
  const result = await mediaFailure.module.loadPublicStorefrontListingData("farm");
  assert.equal(result.error, null);
  assert.deepEqual(result.data.livePoultryProfileImages, {});
  const inventoryFailure = await dataHarness({ inventoryError: { message: "inventory unavailable" } });
  const failed = await inventoryFailure.module.loadPublicStorefrontListingData("farm");
  assert.equal(failed.error.message, "inventory unavailable");
  assert.ok(!inventoryFailure.calls.some((c) => c.table === "public_storefront_media_gallery"));
});

test("embed uses the lightweight access gate without changing the loading architecture", async () => {
  const source = await readFile(new URL("app/embed/store/[slug]/page.tsx", root), "utf8");
  assert.match(source, /loadStorefrontAccess\(slug\)/);
  assert.match(source, /if \(!storeResult\.data\?\.is_publicly_available\) notFound\(\)/);
  assert.match(source, /websiteUrl: storeResult\.data\.website_url/);
  assert.doesNotMatch(source, /loadStorefrontHome|Suspense|unstable_cache|use cache/);
});

async function dataHarness(options = {}) {
  const calls = [];
  const dataModule = await load("app/store/[slug]/storefront-data.ts", {
    "@/lib/public-supabase": {
      publicSupabase: { from(table) {
        const call = { table, order: [] }; calls.push(call);
        return {
          select(fields) { call.fields = fields; return this; },
          eq(key, value) { if (key === "store_slug") call.slug = value; return this; },
          neq() { return this; },
          in(key, ids) { call.ids = ids; return this; },
          order(key, value) { call.order.push([key, value]); return this; },
          then(resolve, reject) {
            let result = { data: [], error: null };
            if (table === "public_storefront_inventory") result = { data: options.inventory ?? [bird("eligible", 5)], error: options.inventoryError ?? null };
            if (table === "public_storefront_equipment_inventory" && options.equipment) return options.equipment.then(resolve, reject);
            if (table === "public_storefront_media_gallery") result = { data: [
              { entity_id: "eligible", public_url: "/first.jpg", alt_text: "Preferred photo" },
              { entity_id: "eligible", public_url: "/second.jpg", alt_text: "Other photo" },
            ], error: options.mediaError ?? null };
            return Promise.resolve(result).then(resolve, reject);
          },
        };
      } },
    },
    "@/lib/bird-age": {}, "@/lib/hatching-egg-breed-name": {},
  });
  return { calls, module: dataModule };
}

function deferred() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }
const jsxRuntime = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
async function load(path, stubs) {
  const source = await readFile(new URL(path, root), "utf8");
  const compiled = ts.transpileModule(source, { fileName: path, compilerOptions: {
    esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => {
    if (name in stubs) return stubs[name];
    throw new Error(`Unexpected test import ${name}`);
  }, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
