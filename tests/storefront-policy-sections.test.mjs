import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { buildStorefrontPolicySections } from "../app/store/[slug]/storefront-policies.ts";

const repositoryRoot = process.cwd();

function read(relativePath) {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

test("checkout and the public policies page share the current policy sections", () => {
  const checkout = read("app/store/[slug]/checkout/checkout-page.tsx");
  const policiesPage = read("app/store/[slug]/policies/page.tsx");

  assert.match(checkout, /buildStorefrontPolicySections/);
  assert.match(policiesPage, /buildStorefrontPolicySections/);
  assert.match(checkout, /<CheckoutPolicyContent policySections=\{checkoutPolicySections\}/);
});

test("custom policies and the pickup policy are included for checkout", () => {
  assert.deepEqual(
    buildStorefrontPolicySections({
      pickupPolicy: "Pickup is by appointment.",
      customPolicies: [
        {
          title: "Cancellation policy",
          body: "Cancellations are available up to 48 hours before pickup.",
        },
        {
          title: "Refund policy",
          body: "Refunds are reviewed case by case.",
        },
      ],
    }),
    [
      { title: "Pickup policy", body: "Pickup is by appointment." },
      {
        title: "Cancellation policy",
        body: "Cancellations are available up to 48 hours before pickup.",
      },
      {
        title: "Refund policy",
        body: "Refunds are reviewed case by case.",
      },
    ],
  );
});

test("legacy cancellation policy content remains visible when it is still distinct", () => {
  assert.deepEqual(
    buildStorefrontPolicySections({
      pickupPolicy: "Pickup is by appointment.",
      cancellationPolicy: "Legacy cancellation terms remain in effect.",
      customPolicies: [
        { title: "Refund policy", body: "Refunds are reviewed case by case." },
      ],
    }),
    [
      { title: "Pickup policy", body: "Pickup is by appointment." },
      {
        title: "Refund policy",
        body: "Refunds are reviewed case by case.",
      },
      {
        title: "Cancellation policy",
        body: "Legacy cancellation terms remain in effect.",
      },
    ],
  );
});

test("legacy cancellation content does not duplicate a current custom policy", () => {
  const sections = buildStorefrontPolicySections({
    cancellationPolicy: "Cancellations are available up to 48 hours before pickup.",
    customPolicies: [
      {
        title: "Cancellation policy",
        body: "  cancellations are available up to 48 hours before pickup.  ",
      },
    ],
  });

  assert.equal(sections.length, 1);
  assert.deepEqual(sections[0], {
    title: "Cancellation policy",
    body: "cancellations are available up to 48 hours before pickup.",
  });
});

test("stores without optional policies have no empty policy sections", () => {
  assert.deepEqual(
    buildStorefrontPolicySections({
      pickupPolicy: "Pickup is by appointment.",
      cancellationPolicy: "   ",
      customPolicies: [],
      otherPolicies: null,
    }),
    [{ title: "Pickup policy", body: "Pickup is by appointment." }],
  );
});
