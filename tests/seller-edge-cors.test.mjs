import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  knownFlockFrontBrowserOrigins,
  resolveFlockFrontCors,
} from "../supabase/functions/_shared/cors.ts";

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("shared seller CORS permits only exact known and configured origins", () => {
  for (const origin of [
    "https://www.flockfront.com",
    "https://flockfront.com",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://preview.flockfront.test",
  ]) {
    const policy = resolveFlockFrontCors(origin, {
      configuredOrigin: "https://preview.flockfront.test",
    });

    assert.equal(policy.originAllowed, true);
    assert.equal(policy.headers["Access-Control-Allow-Origin"], origin);
    assert.equal(policy.headers.Vary, "Origin");
  }

  assert.deepEqual(knownFlockFrontBrowserOrigins, [
    "https://www.flockfront.com",
    "https://flockfront.com",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ]);
});

test("shared seller CORS rejects arbitrary, wildcard, and lookalike origins", () => {
  for (const origin of [
    "https://evil.example",
    "https://www.flockfront.com.evil.example",
    "http://localhost:3001",
  ]) {
    const policy = resolveFlockFrontCors(origin, {
      configuredOrigin: "*",
    });

    assert.equal(policy.originAllowed, false);
    assert.equal(policy.headers["Access-Control-Allow-Origin"], undefined);
  }
});

test("seller store launch uses shared CORS without changing auth or launch authority", () => {
  const launch = read("supabase/functions/seller-store-launch/index.ts");

  assert.match(launch, /resolveFlockFrontCors/);
  assert.match(launch, /!corsPolicy\.originAllowed/);
  assert.match(launch, /"origin_not_allowed"/);
  assert.match(launch, /req\.headers\.get\("Authorization"\)/);
  assert.match(launch, /userClient\.auth\.getUser\(\)/);
  assert.match(launch, /serviceClient\.rpc\("trusted_launch_store"/);
  assert.match(launch, /p_actor_user_id: user\.id/);
  assert.doesNotMatch(launch, /Access-Control-Allow-Origin[\s\S]*?\*/);
});

test("the trusted launch RPC still enforces service role, owner, and readiness", () => {
  const launchMigration = read(
    "supabase/migrations/20260602120000_store_launch_workflow.sql",
  );

  assert.match(launchMigration, /auth\.role\(\)[\s\S]*?service_role/);
  assert.match(launchMigration, /v_store\.owner_user_id <> p_actor_user_id/);
  assert.match(launchMigration, /evaluate_store_launch_readiness\(p_store_id, p_actor_user_id\)/);
  assert.match(launchMigration, /grant execute on function public\.trusted_launch_store[\s\S]*?to service_role/);
});

test("the matching authenticated manual email entrypoint also uses shared CORS", () => {
  const kick = read("supabase/functions/manual-order-email-kick/index.ts");

  assert.match(kick, /resolveFlockFrontCors/);
  assert.match(kick, /!corsPolicy\.originAllowed/);
  assert.match(kick, /"origin_not_allowed"/);
  assert.match(kick, /createManualOrderEmailKickHandler/);
});

test("worker-only and billing-specific origin policies remain outside this change", () => {
  const worker = read("supabase/functions/postmark-email-worker/index.ts");
  const checkout = read("supabase/functions/stripe-saas-checkout/handler.ts");
  const portal = read("supabase/functions/stripe-saas-portal/handler.ts");
  const subscription = read(
    "supabase/functions/stripe-saas-subscription-action/handler.ts",
  );

  assert.match(worker, /FLIPFLOCKS_PUBLIC_API_ORIGIN/);
  assert.match(checkout, /origin_not_allowed/);
  assert.match(portal, /origin_not_allowed/);
  assert.match(subscription, /origin_not_allowed/);
});
