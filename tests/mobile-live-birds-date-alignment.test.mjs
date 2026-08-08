import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("mobile live-bird date labels are vertically centered", async () => {
  const source = await readFile(
    new URL(
      "../app/dashboard/inventory/add-v2/live-birds/HatchInformationCard.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(source, /max-sm:min-h-12 max-sm:items-center/);
  assert.doesNotMatch(source, /max-sm:min-h-12 max-sm:items-end/);
});
