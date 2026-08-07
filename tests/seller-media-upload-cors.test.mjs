import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = readFileSync(
  resolve(process.cwd(), "supabase/functions/seller-media-upload/index.ts"),
  "utf8",
);

test("seller media upload allows only known browser origins", () => {
  const allowlist = source.slice(
    source.indexOf("const allowedCorsOrigins"),
    source.indexOf("const corsHeaders"),
  );

  assert.match(allowlist, /"https:\/\/www\.flockfront\.com"/);
  assert.match(allowlist, /"http:\/\/localhost:3000"/);
  assert.match(allowlist, /configuredCorsOrigin/);
  assert.doesNotMatch(allowlist, /startsWith|localhost:\*|127\.0\.0\.1/);
  assert.doesNotMatch(source, /"Access-Control-Allow-Origin"\s*:\s*"\*"/);
});

test("seller media upload varies responses by Origin and rejects foreign origins", () => {
  assert.match(source, /"Vary": "Origin"/);
  assert.match(
    source,
    /requestOrigin && allowedCorsOrigins\.has\(requestOrigin\)[\s\S]*?"Access-Control-Allow-Origin": requestOrigin/,
  );
  assert.match(
    source,
    /requestOrigin && !allowedCorsOrigins\.has\(requestOrigin\)[\s\S]*?"origin_not_allowed"[\s\S]*?403/,
  );
  assert.match(source, /headers: responseHeaders/);
  assert.match(source, /jsonResponse\([\s\S]*?200, responseHeaders\)/);
});
