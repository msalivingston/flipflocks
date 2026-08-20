import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

test("onboarding keeps phone required and uses the shared formatter without a length cap", () => {
  const source = readFileSync(
    resolve(import.meta.dirname, "step-2-farm-basics-form.tsx"),
    "utf8",
  );

  assert.match(source, /if \(!phone\.trim\(\)\)/);
  assert.match(source, /isPhoneInputValid\(phone, \{ required: true \}\)/);
  assert.match(source, /setPhone\(formatPhoneInput\(value\)\)/);
  assert.doesNotMatch(source, /maxLength=\{14\}/);
  assert.doesNotMatch(source, /slice\(0, 10\)/);
});
