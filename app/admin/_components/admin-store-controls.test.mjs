import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const controlsSource = readFileSync(
  new URL("./admin-store-controls.tsx", import.meta.url),
  "utf8",
);
const detailSource = readFileSync(
  new URL("./admin-store-detail.tsx", import.meta.url),
  "utf8",
);

test("store controls call only the intended narrow admin RPCs", () => {
  for (const rpcName of [
    "admin_set_storefront_enabled",
    "admin_set_store_hold",
    "admin_change_store_plan",
    "admin_update_store_internal_note",
  ]) {
    assert.match(controlsSource, new RegExp(`supabase\\.rpc\\("${rpcName}"`));
  }

  assert.doesNotMatch(controlsSource, /update_store_as_admin|\.from\("stores"\)/);
});

test("successful operations refresh support data", () => {
  assert.match(
    controlsSource,
    /if \(error\)[\s\S]*return false;[\s\S]*await onRefresh\(\);/,
  );
  assert.match(
    detailSource,
    /<AdminStoreControls[\s\S]*onRefresh=\{\(\) => loadStore\(\)\}/,
  );
});

test("restrictive controls retain confirmation and reason requirements", () => {
  assert.match(
    controlsSource,
    /dialog === "disable-storefront"[\s\S]*title="Disable this storefront\?"/,
  );
  assert.match(
    controlsSource,
    /dialog === "plan"[\s\S]*title=\{`Change plan to \$\{nextPlan\.displayName\}\?`\}/,
  );
  assert.match(
    controlsSource,
    /dialog === "hold"[\s\S]*confirmDisabled=\{!holdReason\.trim\(\)\}[\s\S]*required/,
  );
  assert.match(
    controlsSource,
    /if \(!holdReason\.trim\(\)\)[\s\S]*Enter a short reason/,
  );
});

test("internal notes are clearly private and activity-safe", () => {
  assert.match(
    controlsSource,
    /visible only in the platform-admin support area/,
  );
  assert.match(controlsSource, /never shown to the seller or public storefront/);
  assert.doesNotMatch(detailSource, /RecentOrdersTable|admin_platform_store_recent_orders/);
});
