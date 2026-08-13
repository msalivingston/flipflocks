import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolveBuyerPaymentAvailability } from "../lib/store-payment-methods.ts";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const migration = read(
  "supabase/migrations/20260820120000_store_payment_methods.sql",
);
const storeAdmin = read("app/dashboard/store-admin/store-admin.tsx");
const paymentTab = read(
  "app/dashboard/store-admin/payment-methods-tab.tsx",
);
const accountPage = read("app/dashboard/account/seller-account.tsx");
const stripePanel = read(
  "app/dashboard/_components/stripe-connect-panel.tsx",
);
const stripeAccount = read(
  "supabase/functions/stripe-connect-account/index.ts",
);
const stripeCheckout = read(
  "supabase/functions/stripe-connect-checkout/index.ts",
);
const saasCheckout = read("supabase/functions/stripe-saas-checkout/index.ts");

test("existing stores default to Pay at Pickup only", () => {
  assert.match(
    migration,
    /pay_at_pickup_enabled boolean not null default true/,
  );
  assert.match(
    migration,
    /card_payments_enabled boolean not null default false/,
  );
});

test("database and Store Admin both require at least one payment method", () => {
  assert.match(
    migration,
    /check \(pay_at_pickup_enabled or card_payments_enabled\)/,
  );
  assert.match(
    migration,
    /At least one payment method must be enabled\./,
  );
  assert.match(
    storeAdmin,
    /!form\.pay_at_pickup_enabled && !form\.card_payments_enabled/,
  );
  assert.match(
    paymentTab,
    /Select Pay at Pickup,[\s\S]*Pay by Card, or both before saving/,
  );
});

test("pickup-only, card-only, and dual-method checkout resolve explicitly", () => {
  assert.deepEqual(
    resolveBuyerPaymentAvailability({
      payAtPickupEnabled: true,
      cardPaymentsEnabled: false,
      cardPaymentsReady: false,
    }).availableMethods,
    ["pay_at_pickup"],
  );

  assert.deepEqual(
    resolveBuyerPaymentAvailability({
      payAtPickupEnabled: false,
      cardPaymentsEnabled: true,
      cardPaymentsReady: true,
    }).availableMethods,
    ["stripe_checkout"],
  );

  assert.deepEqual(
    resolveBuyerPaymentAvailability({
      payAtPickupEnabled: true,
      cardPaymentsEnabled: true,
      cardPaymentsReady: true,
    }).availableMethods,
    ["stripe_checkout", "pay_at_pickup"],
  );
});

test("card-only blocks while Stripe is unavailable and dual-method retains pickup", () => {
  const cardOnly = resolveBuyerPaymentAvailability({
    payAtPickupEnabled: false,
    cardPaymentsEnabled: true,
    cardPaymentsReady: false,
  });
  assert.equal(cardOnly.checkoutBlocked, true);
  assert.match(cardOnly.unavailableMessage, /does not offer Pay at Pickup/);

  const dualMethod = resolveBuyerPaymentAvailability({
    payAtPickupEnabled: true,
    cardPaymentsEnabled: true,
    cardPaymentsReady: false,
  });
  assert.equal(dualMethod.checkoutBlocked, false);
  assert.deepEqual(dualMethod.availableMethods, ["pay_at_pickup"]);
});

test("card selection does not create, delete, or disconnect a Stripe account", () => {
  const updateFunction = migration.slice(
    migration.indexOf("seller_update_payment_methods"),
    migration.indexOf("get_public_store_payment_methods"),
  );
  assert.doesNotMatch(
    updateFunction,
    /store_stripe_connections|stripe_account_id|delete from/,
  );
  assert.doesNotMatch(paymentTab, /disconnect/i);
  assert.match(stripePanel, /Turning Pay by Card off[\s\S]*does not disconnect/);
});

test("all seller accounts can start or resume Stripe setup", () => {
  assert.doesNotMatch(stripeAccount, /sunshine-mesa-farm/);
  assert.match(stripeAccount, /insert\(\{ store_id: store\.id, stripe_livemode: livemode \}\)/);
  assert.match(stripeAccount, /if \(!accountId\)/);
  assert.match(stripeAccount, /ff-connect-account:v2:/);
});

test("card checkout requires both seller selection and live Stripe readiness", () => {
  assert.match(
    stripeCheckout,
    /storefrontData\.card_payments_enabled !== true/,
  );
  assert.match(
    stripeCheckout,
    /card_payments === "active"[\s\S]*charges_enabled === true[\s\S]*payouts_enabled === true/,
  );
});

test("Stripe setup UI moved to Store Admin without an Account duplicate", () => {
  assert.match(paymentTab, /<StripeConnectPanel/);
  assert.doesNotMatch(accountPage, /StripeConnectPanel|Customer card payments/);
  assert.match(
    stripeAccount,
    /dashboard\/store-admin\?tab=payment-methods&stripe=return/,
  );
});

test("SaaS checkout remains subscription-only and separate", () => {
  assert.match(saasCheckout, /mode:\s*"subscription"/);
  assert.doesNotMatch(
    saasCheckout,
    /card_payments_enabled|pay_at_pickup_enabled|store_stripe_connections/,
  );
});
