import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import {
  isIndexingEnabled,
  PRODUCTION_ORIGIN,
} from "../lib/seo-config.ts";

const repositoryRoot = new URL("../", import.meta.url);

test("indexing is enabled only by the production-only launch combination", () => {
  assert.equal(isIndexingEnabled({}), false);
  assert.equal(
    isIndexingEnabled({
      SEO_INDEXING_ENABLED: "true",
      VERCEL_ENV: "preview",
    }),
    false,
  );
  assert.equal(
    isIndexingEnabled({
      SEO_INDEXING_ENABLED: "true",
      VERCEL_ENV: "development",
    }),
    false,
  );
  assert.equal(
    isIndexingEnabled({
      SEO_INDEXING_ENABLED: "false",
      VERCEL_ENV: "production",
    }),
    false,
  );
  assert.equal(
    isIndexingEnabled({
      SEO_INDEXING_ENABLED: "true",
      VERCEL_ENV: "production",
    }),
    true,
  );
});

test("robots blocks prelaunch and allows all crawling after launch", async () => {
  const blocked = await loadTypeScriptModule("app/robots.ts", {
    "@/lib/seo-config": {
      INDEXING_ENABLED: false,
      PRODUCTION_ORIGIN,
    },
  });
  assert.deepEqual(blocked.default(), {
    host: PRODUCTION_ORIGIN,
    rules: { disallow: "/", userAgent: "*" },
  });

  const launched = await loadTypeScriptModule("app/robots.ts", {
    "@/lib/seo-config": {
      INDEXING_ENABLED: true,
      PRODUCTION_ORIGIN,
    },
  });
  const output = launched.default();
  assert.deepEqual(output, {
    host: PRODUCTION_ORIGIN,
    rules: { allow: "/", userAgent: "*" },
    sitemap: `${PRODUCTION_ORIGIN}/sitemap.xml`,
  });
});

test("private and transactional route boundaries retain noindex metadata", async () => {
  const noindex = {
    follow: false,
    index: false,
    nocache: true,
  };
  const layouts = [
    "app/admin/layout.tsx",
    "app/dashboard/layout.tsx",
    "app/dev/layout.tsx",
    "app/listings/layout.tsx",
    "app/login/layout.tsx",
    "app/onboarding/layout.tsx",
    "app/reset-password/layout.tsx",
    "app/sign-in/layout.tsx",
    "app/signup/layout.tsx",
    "app/store/[slug]/cart/layout.tsx",
    "app/store/[slug]/checkout/layout.tsx",
    "app/store/[slug]/items/layout.tsx",
  ];

  for (const layout of layouts) {
    const loaded = await loadTypeScriptModule(layout, {
      "@/lib/seo-config": { NOINDEX_ROBOTS: noindex },
      "./_components/admin-app-shell": {},
      "./_components/seller-app-shell": {},
      "react/jsx-runtime": { jsx: () => null },
    });
    assert.deepEqual(loaded.metadata.robots, noindex, layout);
  }

  const storefrontPage = await readFile(
    new URL("app/store/[slug]/page.tsx", repositoryRoot),
    "utf8",
  );
  assert.match(
    storefrontPage,
    /query\.preview === "1"\) return \{ robots: NOINDEX_ROBOTS \}/,
  );
  assert.match(storefrontPage, /robots: NOINDEX_ROBOTS/);

  for (const listingPage of [
    "app/store/[slug]/products/[productId]/page.tsx",
    "app/store/[slug]/equipment/[equipmentItemId]/page.tsx",
    "app/store/[slug]/processed-poultry/[processedPoultryItemId]/page.tsx",
  ]) {
    const source = await readFile(new URL(listingPage, repositoryRoot), "utf8");
    assert.match(source, /robots: NOINDEX_ROBOTS/, listingPage);
  }
});

test("global noindex response header is removed only after production launch", async () => {
  const blocked = await loadTypeScriptModule("next.config.ts", {
    "./lib/seo-config": { INDEXING_ENABLED: false },
  });
  assert.deepEqual(await blocked.default.headers(), [
    {
      headers: [
        {
          key: "Content-Security-Policy",
          value: "frame-ancestors 'self'",
        },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ],
      source: "/:path*",
    },
    {
      headers: [
        {
          key: "Content-Security-Policy",
          value: "frame-ancestors https:",
        },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ],
      source: "/embed/store/:slug",
    },
  ]);

  const launched = await loadTypeScriptModule("next.config.ts", {
    "./lib/seo-config": { INDEXING_ENABLED: true },
  });
  assert.deepEqual(await launched.default.headers(), [
    {
      headers: [
        {
          key: "Content-Security-Policy",
          value: "frame-ancestors 'self'",
        },
      ],
      source: "/:path*",
    },
    {
      headers: [
        {
          key: "Content-Security-Policy",
          value: "frame-ancestors https:",
        },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ],
      source: "/embed/store/:slug",
    },
  ]);
});

test("homepage graph contains only the approved linked nodes", async () => {
  const structuredDataModule = await loadTypeScriptModule(
    "lib/homepage-structured-data.ts",
    {
      "@/lib/seo-config": {
        absoluteUrl: (path) =>
          new URL(path, `${PRODUCTION_ORIGIN}/`).toString(),
        PRODUCTION_ORIGIN,
      },
    },
  );
  const serialized = structuredDataModule.serializeJsonLd(
    structuredDataModule.HOMEPAGE_STRUCTURED_DATA,
  );
  const parsed = JSON.parse(serialized);

  assert.equal(parsed["@context"], "https://schema.org");
  assert.equal(parsed["@graph"].length, 2);

  const organization = parsed["@graph"].find(
    (node) => node["@type"] === "Organization",
  );
  const website = parsed["@graph"].find(
    (node) => node["@type"] === "WebSite",
  );

  assert.deepEqual(organization, {
    "@id": `${PRODUCTION_ORIGIN}/#organization`,
    "@type": "Organization",
    logo: `${PRODUCTION_ORIGIN}/branding/flockfront-logo-final.png`,
    name: "FlockFront",
    url: PRODUCTION_ORIGIN,
  });
  assert.deepEqual(website, {
    "@id": `${PRODUCTION_ORIGIN}/#website`,
    "@type": "WebSite",
    name: "FlockFront",
    publisher: { "@id": organization["@id"] },
    url: PRODUCTION_ORIGIN,
  });
  assert.equal(
    structuredDataModule.serializeJsonLd({ value: "</script>&\u2028" }),
    '{"value":"\\u003c/script\\u003e\\u0026\\u2028"}',
  );
});

test("sitemap deduplicates eligible public URLs and fails closed to static URLs", async () => {
  const rows = {
    public_storefronts: [
      { store_slug: "public-farm" },
      { store_slug: "public-farm" },
    ],
    public_storefront_inventory: [
      {
        seller_breed_profile_id: "breed-1",
        store_slug: "public-farm",
      },
    ],
    public_storefront_hatching_egg_inventory: [
      {
        hatching_egg_product_id: "eggs-1",
        store_slug: "public-farm",
      },
    ],
    public_storefront_equipment_inventory: [
      {
        equipment_inventory_item_id: "equipment-1",
        store_slug: "public-farm",
      },
    ],
    public_storefront_processed_poultry_inventory: [
      {
        processed_poultry_inventory_item_id: "poultry-1",
        store_slug: "public-farm",
      },
    ],
  };
  const sitemapModule = await loadSitemapModule(rows);
  const sitemap = await sitemapModule.default();
  const urls = sitemap.map((entry) => entry.url);

  assert.equal(urls.length, new Set(urls).size);
  assert.ok(urls.every((url) => url.startsWith(`${PRODUCTION_ORIGIN}/`)));
  assert.ok(urls.includes(`${PRODUCTION_ORIGIN}/store/public-farm`));
  assert.ok(
    urls.includes(`${PRODUCTION_ORIGIN}/store/public-farm/products/breed-1`),
  );
  assert.ok(
    urls.every(
      (url) =>
        !/[?]/.test(url) &&
        !/(admin|dashboard|login|onboarding|cart|checkout)/.test(url),
    ),
  );

  const failingModule = await loadSitemapModule(null);
  const fallback = await failingModule.default();
  assert.deepEqual(
    fallback.map((entry) => entry.url),
    [
      "/",
      "/about",
      "/acceptable-use",
      "/faq",
      "/pricing",
      "/privacy",
      "/terms",
    ].map((path) => new URL(path, `${PRODUCTION_ORIGIN}/`).toString()),
  );
});

async function loadSitemapModule(rows) {
  const publicSupabase = {
    from(table) {
      if (!rows) {
        return {
          select() {
            return rejectingQuery();
          },
        };
      }

      return {
        select() {
          return resolvedQuery(rows[table] ?? []);
        },
      };
    },
  };

  return loadTypeScriptModule("app/sitemap.ts", {
    "@/lib/public-supabase": { publicSupabase },
    "@/lib/seo-config": {
      absoluteUrl: (path) => new URL(path, `${PRODUCTION_ORIGIN}/`).toString(),
    },
  });
}

function resolvedQuery(data) {
  const result = Promise.resolve({ data, error: null });
  result.neq = () => result;
  return result;
}

function rejectingQuery() {
  const result = Promise.reject(new Error("public data unavailable"));
  result.neq = () => result;
  return result;
}

async function loadTypeScriptModule(relativePath, stubs) {
  const source = await readFile(new URL(relativePath, repositoryRoot), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: relativePath,
  }).outputText;
  const loadedModule = { exports: {} };
  const require = (specifier) => {
    if (specifier in stubs) return stubs[specifier];
    throw new Error(`Unexpected test import: ${specifier}`);
  };

  new Function("require", "module", "exports", compiled)(
    require,
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports;
}
