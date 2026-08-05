import assert from "node:assert/strict";
import test from "node:test";

import {
  escapeHtml,
  runLocalCatalogVerificationForm,
} from "../scripts/stripe/local-catalog-key-form.mjs";

const restrictedKey = ["rk", "test", "LocalBrowserFixture"].join("_");
const results = [
  { label: "Coop monthly", stripePriceId: "price_fixture_one", status: "PASS", failureCode: null },
  { label: "Coop yearly", stripePriceId: "price_fixture_two", status: "PASS", failureCode: null },
  { label: "Market monthly", stripePriceId: "price_fixture_three", status: "PASS", failureCode: null },
  { label: "Market yearly", stripePriceId: "price_fixture_four", status: "PASS", failureCode: null },
];

function listeningPromise() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function expectClosed(url) {
  try {
    const response = await fetch(url, { cache: "no-store" });
    assert.ok([404, 410].includes(response.status));
  } catch (error) {
    assert.ok(error instanceof TypeError);
  }
}

test("local form binds to loopback and uses a random single-use token", async () => {
  const listening = listeningPromise();
  let openedUrl;
  let capturedKey;
  const runPromise = runLocalCatalogVerificationForm({
    onListening: listening.resolve,
    openBrowser: async (url) => { openedUrl = url; },
    runOperation: async (credentials, reportProgress) => {
      capturedKey = credentials.catalogReadKey;
      for (const result of results) reportProgress(result);
      return { passed: true, results };
    },
  });
  const info = await listening.promise;
  assert.equal(info.host, "127.0.0.1");
  assert.match(info.url, /^http:\/\/127\.0\.0\.1:\d+\/verify\/[a-f0-9]{64}$/);
  assert.equal(openedUrl, info.url);
  assert.doesNotMatch(info.url, new RegExp(restrictedKey));

  const formResponse = await fetch(info.url, { cache: "no-store" });
  const formHtml = await formResponse.text();
  assert.equal(formResponse.status, 200);
  assert.equal(formResponse.headers.get("cache-control"), "no-store");
  assert.equal(formResponse.headers.get("referrer-policy"), "no-referrer");
  assert.equal(formResponse.headers.get("x-content-type-options"), "nosniff");
  assert.match(formResponse.headers.get("content-security-policy"), /default-src 'none'/);
  assert.match(formHtml, /Verify FlockFront Stripe Catalog/);
  assert.match(formHtml, /Stripe restricted test key/);
  assert.match(formHtml, /type="password"/);
  assert.doesNotMatch(formHtml, /Supabase project URL|supabase_service_role_key/);
  assert.match(formHtml, /method="post"/);
  assert.doesNotMatch(formHtml, /https?:\/\/(?!127\.0\.0\.1)|<script|@font-face/i);

  const postResponse = await fetch(info.url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ stripe_key: restrictedKey }),
  });
  const resultHtml = await postResponse.text();
  const verification = await runPromise;
  assert.equal(postResponse.status, 200);
  assert.equal(capturedKey, restrictedKey);
  assert.equal(verification.passed, true);
  assert.equal((resultHtml.match(/>PASS</g) ?? []).length, 4);
  assert.match(resultHtml, /All four approved sandbox Prices passed/);
  assert.doesNotMatch(resultHtml, new RegExp(restrictedKey));
  await expectClosed(info.url);
});

test("apply form collects Stripe and Supabase credentials once without echoing them", async () => {
  const listening = listeningPromise();
  const serviceKey = ["service", "role", "LocalBrowserFixture"].join("_");
  const projectUrl = "https://projectfixture.supabase.co";
  let captured;
  let operationCalls = 0;
  const runPromise = runLocalCatalogVerificationForm({
    apply: true,
    onListening: listening.resolve,
    openBrowser: async () => {},
    runOperation: async (credentials, reportProgress) => {
      operationCalls += 1;
      captured = { ...credentials };
      for (const result of results) reportProgress(result);
      return { passed: true, applied: true, results };
    },
  });
  const info = await listening.promise;
  const formResponse = await fetch(info.url, { cache: "no-store" });
  const formHtml = await formResponse.text();
  assert.match(formHtml, /name="stripe_key" type="password"/);
  assert.match(formHtml, /name="supabase_url" type="url"/);
  assert.match(formHtml, /name="supabase_service_role_key" type="password"/);
  assert.doesNotMatch(formHtml, new RegExp(`${restrictedKey}|${serviceKey}|${projectUrl}`));

  const response = await fetch(info.url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      stripe_key: restrictedKey,
      supabase_url: projectUrl,
      supabase_service_role_key: serviceKey,
    }),
  });
  const html = await response.text();
  const result = await runPromise;
  assert.equal(result.applied, true);
  assert.equal(operationCalls, 1);
  assert.deepEqual(captured, {
    catalogReadKey: restrictedKey,
    supabaseUrl: projectUrl,
    supabaseServiceRoleKey: serviceKey,
  });
  assert.match(html, /passed and were registered/);
  assert.doesNotMatch(html, new RegExp(`${restrictedKey}|${serviceKey}|${projectUrl}`));
  await expectClosed(info.url);
});

test("live form accepts only a live restricted key and labels the live catalog", async () => {
  const listening = listeningPromise();
  const liveKey = ["rk", "live", "LocalBrowserFixture"].join("_");
  let capturedKey;
  const runPromise = runLocalCatalogVerificationForm({
    keyMode: "live",
    onListening: listening.resolve,
    openBrowser: async () => {},
    runOperation: async (credentials, reportProgress) => {
      capturedKey = credentials.catalogReadKey;
      for (const result of results) reportProgress(result);
      return { passed: true, results };
    },
  });
  const info = await listening.promise;
  const formResponse = await fetch(info.url, { cache: "no-store" });
  const formHtml = await formResponse.text();
  assert.match(formHtml, /Stripe restricted live key/);
  assert.match(formHtml, /pattern="rk_live_\[A-Za-z0-9\]\+"/);
  assert.doesNotMatch(formHtml, new RegExp(liveKey));

  const response = await fetch(info.url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ stripe_key: liveKey }),
  });
  const html = await response.text();
  const result = await runPromise;
  assert.equal(response.status, 200);
  assert.equal(result.passed, true);
  assert.equal(capturedKey, liveKey);
  assert.match(html, /All four approved live Prices passed/);
  assert.doesNotMatch(html, new RegExp(liveKey));
  await expectClosed(info.url);
});

test("apply form rejects invalid Supabase credentials without invoking the operation", async () => {
  for (const [supabaseUrl, serviceKey, expectedCode] of [
    ["http://projectfixture.supabase.co", "service-role-fixture", "STRIPE_SAAS_LOCAL_FORM_SUPABASE_URL_INVALID"],
    ["https://projectfixture.supabase.co", "   ", "STRIPE_SAAS_LOCAL_FORM_SUPABASE_SERVICE_ROLE_KEY_MISSING"],
  ]) {
    const listening = listeningPromise();
    let operationCalls = 0;
    const outcomePromise = runLocalCatalogVerificationForm({
      apply: true,
      onListening: listening.resolve,
      openBrowser: async () => {},
      runOperation: async () => { operationCalls += 1; },
    }).then(() => null, (error) => error);
    const info = await listening.promise;
    const response = await fetch(info.url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        stripe_key: restrictedKey,
        supabase_url: supabaseUrl,
        supabase_service_role_key: serviceKey,
      }),
    });
    const html = await response.text();
    const error = await outcomePromise;
    assert.equal(response.status, 400);
    assert.equal(error.code, expectedCode);
    assert.equal(operationCalls, 0);
    assert.doesNotMatch(`${html} ${error.message}`, new RegExp(restrictedKey));
    if (supabaseUrl.trim()) assert.equal(`${html} ${error.message}`.includes(supabaseUrl.trim()), false);
    if (serviceKey.trim()) assert.doesNotMatch(`${html} ${error.message}`, new RegExp(serviceKey));
    await expectClosed(info.url);
  }
});

test("malformed key fails safely, invalidates the token, and closes the server", async () => {
  const listening = listeningPromise();
  const malformed = ["sk", "test", "MustNotLeak"].join("_");
  let verifyCalled = false;
  const outcomePromise = runLocalCatalogVerificationForm({
    onListening: listening.resolve,
    openBrowser: async () => {},
    runOperation: async () => { verifyCalled = true; throw new Error("unexpected"); },
  }).then(() => null, (error) => error);
  const info = await listening.promise;
  const response = await fetch(info.url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ stripe_key: malformed }),
  });
  const html = await response.text();
  const error = await outcomePromise;
  assert.equal(response.status, 400);
  assert.equal(error.code, "STRIPE_SAAS_LOCAL_FORM_KEY_INVALID");
  assert.equal(verifyCalled, false);
  assert.doesNotMatch(`${html} ${error.code} ${error.message}`, new RegExp(malformed));
  await expectClosed(info.url);
});

test("local form expires and closes without receiving a key", async () => {
  const listening = listeningPromise();
  let verifyCalled = false;
  const outcomePromise = runLocalCatalogVerificationForm({
    expirationMs: 25,
    onListening: listening.resolve,
    openBrowser: async () => {},
    runOperation: async () => { verifyCalled = true; throw new Error("unexpected"); },
  }).then(() => null, (error) => error);
  const info = await listening.promise;
  const error = await outcomePromise;
  assert.equal(error.code, "STRIPE_SAAS_LOCAL_FORM_EXPIRED");
  assert.equal(verifyCalled, false);
  await expectClosed(info.url);
});

test("HTML escaping covers form and result text boundaries", () => {
  assert.equal(escapeHtml(`<>&"'`), "&lt;&gt;&amp;&quot;&#39;");
});
