import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const fontModuleUrl = new URL(
  "../app/store/[slug]/storefront-fonts.ts",
  import.meta.url,
);
const fontDirectoryUrl = new URL(
  "../app/store/[slug]/fonts/",
  import.meta.url,
);

const expectedFiles = [
  "dm-sans-400.ttf",
  "fraunces-400.ttf",
  "fraunces-700.ttf",
  "inter-400.ttf",
  "libre-caslon-text-400.ttf",
  "libre-caslon-text-700.ttf",
  "lora-400.ttf",
  "lora-700.ttf",
  "montserrat-400.ttf",
  "montserrat-700.ttf",
  "nunito-sans-400.ttf",
  "oswald-400.ttf",
  "oswald-600.ttf",
  "roboto-slab-400.ttf",
  "roboto-slab-700.ttf",
  "source-sans-3-400.ttf",
];

test("storefront typography is fully local and retains its CSS-variable contract", async () => {
  const source = await readFile(fontModuleUrl, "utf8");

  assert.match(source, /from "next\/font\/local"/);
  assert.doesNotMatch(source, /next\/font\/google/);
  for (const variable of [
    "--font-source-sans-3",
    "--font-libre-caslon-text",
    "--font-lora",
    "--font-nunito-sans",
    "--font-oswald",
    "--font-roboto-slab",
    "--font-dm-sans",
    "--font-fraunces",
    "--font-montserrat",
    "--font-inter",
  ]) {
    assert.match(source, new RegExp(variable));
  }
});

test("every referenced local font asset and license notice is present", async () => {
  await Promise.all([
    ...expectedFiles.map(async (file) => await access(new URL(file, fontDirectoryUrl))),
    access(new URL("LICENSES.md", fontDirectoryUrl)),
  ]);
});
