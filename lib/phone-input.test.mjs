import assert from "node:assert/strict";
import test from "node:test";

import {
  formatPhoneInput,
  getNanpPhoneDigits,
  isInternationalPhoneInput,
  isPhoneInputValid,
} from "./phone-input.ts";

test("formats progressive NANP typing", () => {
  const examples = [
    ["9", "9"],
    ["970", "970"],
    ["9707", "970-7"],
    ["970765", "970-765"],
    ["9707658", "970-765-8"],
    ["9707658099", "970-765-8099"],
  ];

  for (const [input, expected] of examples) {
    assert.equal(formatPhoneInput(input), expected);
  }
});

test("backspacing keeps progressive formatting stable", () => {
  let value = formatPhoneInput("9707658099");
  value = formatPhoneInput(value.slice(0, -1));
  assert.equal(value, "970-765-809");
  value = formatPhoneInput(value.slice(0, -1));
  assert.equal(value, "970-765-80");
});

test("normalizes common pasted NANP formats", () => {
  assert.equal(formatPhoneInput("9707658099"), "970-765-8099");
  assert.equal(formatPhoneInput("(970) 765-8099"), "970-765-8099");
  assert.equal(formatPhoneInput("970.765.8099"), "970-765-8099");
  assert.equal(formatPhoneInput("1-970-765-8099"), "970-765-8099");
  assert.equal(formatPhoneInput("+1 970-765-8099"), "970-765-8099");
});

test("does not silently truncate overlong NANP input", () => {
  const formatted = formatPhoneInput("970765809912");
  assert.equal(formatted, "970-765-8099 12");
  assert.equal(getNanpPhoneDigits(formatted), "970765809912");
  assert.equal(isPhoneInputValid(formatted), false);
});

test("preserves non-+1 international intent", () => {
  const international = "+44 20 7946 0958";
  assert.equal(isInternationalPhoneInput(international), true);
  assert.equal(formatPhoneInput(international), international);
  assert.equal(isPhoneInputValid(international), true);
});

test("supports optional customer and required onboarding phone rules", () => {
  assert.equal(isPhoneInputValid(""), true);
  assert.equal(isPhoneInputValid("", { required: true }), false);
  assert.equal(isPhoneInputValid("970-765-8099", { required: true }), true);
  assert.equal(isPhoneInputValid("+44 20 7946 0958", { required: true }), true);
});
