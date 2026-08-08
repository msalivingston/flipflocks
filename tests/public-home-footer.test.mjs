import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = readFileSync(
  resolve(process.cwd(), "app/page.tsx"),
  "utf8",
);

test("public home footer includes the requested copyright without operator text", () => {
  assert.match(source, /© 2026 FlockFront\. All rights reserved\./);
  assert.doesNotMatch(source, /FlockFront is operated by Sunshine Mesa Farm LLC\./);
});

test("public home footer links to all legal pages through the shared legal routes", () => {
  assert.match(source, /import \{ legalRoutes \} from "@\/lib\/legal"/);
  assert.match(source, /href=\{legalRoutes\.terms\}/);
  assert.match(source, /href=\{legalRoutes\.privacy\}/);
  assert.match(source, /href=\{legalRoutes\.acceptableUse\}/);
  assert.match(source, /aria-label="Legal navigation"/);
  assert.match(source, /aria-hidden="true">•<\/span>/g);
});

test("public home footer keeps explicit visible focus treatment on legal links", () => {
  const legalNav = source.slice(source.indexOf('aria-label="Legal navigation"'));

  assert.match(legalNav, /focus-visible:outline-2/);
  assert.match(legalNav, /Terms/);
  assert.match(legalNav, /Privacy/);
  assert.match(legalNav, /Acceptable Use/);
});
