import assert from "node:assert/strict";
import test from "node:test";

import { formatBirdAgeInDays } from "../lib/bird-age.ts";

test("bird ages stay in weeks through 26 weeks and switch to whole months after", () => {
  assert.equal(formatBirdAgeInDays(24 * 7), "24 weeks");
  assert.equal(formatBirdAgeInDays(26 * 7), "26 weeks");
  assert.equal(formatBirdAgeInDays(27 * 7), "6 months");
  assert.equal(formatBirdAgeInDays(31 * 7), "7 months");
  assert.equal(formatBirdAgeInDays(52 * 7), "12 months");
});

test("bird age formatting preserves singular wording and supported display variants", () => {
  assert.equal(formatBirdAgeInDays(1), "1 day");
  assert.equal(formatBirdAgeInDays(7), "1 week");
  assert.equal(formatBirdAgeInDays(27 * 7, { includeOld: true }), "6 months old");
  assert.equal(
    formatBirdAgeInDays(15, { includeRemainingDays: true }),
    "2 weeks + 1 day",
  );
  assert.equal(
    formatBirdAgeInDays(8, { minimumDaysForWeeks: 14 }),
    "8 days",
  );
});

test("bird age formatting handles hatch-day labels and invalid ages", () => {
  assert.equal(formatBirdAgeInDays(0, { zeroLabel: "Hatch day" }), "Hatch day");
  assert.equal(formatBirdAgeInDays(-1), null);
  assert.equal(formatBirdAgeInDays(Number.NaN), null);
  assert.equal(formatBirdAgeInDays(null), null);
});
