import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panel = readFileSync(
  new URL(
    "../app/dashboard/_components/stripe-connect-panel.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("card payment help stays inline and uses the approved seller guidance", () => {
  assert.match(panel, /<details[\s\S]*How card payments work[\s\S]*<\/details>/);
  assert.match(panel, /Set Up Credit Card Payments/);
  assert.match(
    panel,
    /FlockFront does\{" "\}[\s\S]*<strong>not<\/strong> take a percentage/,
  );
  assert.match(panel, /How to set up card payments/);
  assert.match(panel, /Already use Stripe\?/);
  assert.match(panel, /View Stripe.+current pricing and processing fees/);
  assert.match(panel, /View Stripe Pricing/);
  assert.equal(panel.match(/href="https:\/\/stripe\.com\/pricing"/g)?.length, 1);
  assert.equal(panel.match(/<StripePricingLink>/g)?.length, 2);
});

test("Stripe return shows a bounded pending state without reopening onboarding", () => {
  assert.match(panel, /get\("stripe"\) === "return"/);
  assert.match(panel, /RETURN_STATUS_RECHECK_INTERVAL_MS = 5_000/);
  assert.match(panel, /RETURN_STATUS_RECHECK_LIMIT = 6/);
  assert.match(
    panel,
    /Stripe is finishing your setup\. This can take a few minutes\. You do not need to complete setup again\. Refresh this page in a few minutes\./,
  );
  assert.match(panel, /isStripeReturnPending[\s\S]*Refresh status/);

  const returnEffect = panel.slice(
    panel.indexOf("useEffect(() =>"),
    panel.indexOf("async function openStripeSetup"),
  );
  assert.match(returnEffect, /checkStatus/);
  assert.doesNotMatch(returnEffect, /action:\s*"onboard"|openStripeSetup/);
});

test("existing setup and active-account actions remain available", () => {
  assert.match(
    panel,
    /state === "not_connected"[\s\S]*"Set up Stripe"[\s\S]*"Continue Stripe setup"/,
  );
  assert.match(panel, /action:\s*"onboard"/);
  assert.match(panel, /Open Stripe Dashboard/);
});

test("active card payments show a green ready status and seller reassurance", () => {
  assert.match(panel, /Card payments ready/);
  assert.match(
    panel,
    /Your connected Stripe account is ready\. Buyers can pay by card whenever Pay by Card is enabled and saved\./,
  );
  assert.match(
    panel,
    /state === "active"[\s\S]*bg-emerald-100 text-emerald-900/,
  );
  assert.match(panel, /state === "active"[\s\S]*bg-emerald-600/);
  assert.match(
    panel,
    /aria-hidden="true"[\s\S]*rounded-full[\s\S]*statusDotTone/,
  );
});
