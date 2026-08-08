import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = readFileSync(
  resolve(process.cwd(), "supabase/functions/seller-media-upload/index.ts"),
  "utf8",
);
const sharedCors = readFileSync(
  resolve(process.cwd(), "supabase/functions/_shared/cors.ts"),
  "utf8",
);

test("seller media upload allows only known browser origins", () => {
  assert.match(source, /import \{ resolveFlockFrontCors \} from "\.\.\/_shared\/cors\.ts"/);
  assert.match(sharedCors, /"https:\/\/www\.flockfront\.com"/);
  assert.match(sharedCors, /"http:\/\/localhost:3000"/);
  assert.match(sharedCors, /allowedOrigins\.has\(requestOrigin\)/);
  assert.doesNotMatch(sharedCors, /startsWith|localhost:\*/);
  assert.doesNotMatch(source, /"Access-Control-Allow-Origin"\s*:\s*"\*"/);
});

test("seller media upload varies responses by Origin and rejects foreign origins", () => {
  assert.match(sharedCors, /"Vary": "Origin"/);
  assert.match(sharedCors, /headers\["Access-Control-Allow-Origin"\] = requestOrigin/);
  assert.match(
    source,
    /!corsPolicy\.originAllowed[\s\S]*?"origin_not_allowed"[\s\S]*?403/,
  );
  assert.match(source, /headers: responseHeaders/);
  assert.match(source, /jsonResponse\([\s\S]*?200, responseHeaders\)/);
});
