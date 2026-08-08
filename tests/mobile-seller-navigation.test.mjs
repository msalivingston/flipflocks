import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readShell = () =>
  readFile(
    new URL("../app/dashboard/_components/seller-app-shell.tsx", import.meta.url),
    "utf8",
  );

test("mobile seller navigation restores the pre-Step-6 scrolling quick bar", async () => {
  const source = await readShell();

  assert.match(
    source,
    /const mobileSellerNavItems = \[\.\.\.sellerNavItems, sellerAccountNavItem\]/,
  );
  assert.match(source, /overflow-x-auto/);
  assert.match(source, /<MobileSellerNavLinks items=\{mobileSellerNavItems\} \/>/);
  assert.match(source, /flex gap-1/);
  assert.match(source, /min-w-\[4\.55rem\]/);
  assert.doesNotMatch(source, /mobileQuickNavItems/);

  for (const label of [
    "Dashboard",
    "Orders",
    "Inventory",
    "Customers",
    "Breeds",
    "Reports",
    "Store Admin",
    "Account",
    "Contact support",
    "Sign out",
  ]) {
    assert.match(source, new RegExp(label.replace(/[&]/g, "\\$&")));
  }
});

test("mobile seller menu is accessible and closes on navigation or Escape", async () => {
  const source = await readShell();

  assert.match(source, /aria-controls="mobile-seller-menu"/);
  assert.match(source, /aria-expanded=\{isMobileMenuOpen\}/);
  assert.match(source, /aria-label=\{isMobileMenuOpen \? "Close seller menu" : "Open seller menu"\}/);
  assert.match(source, /role="dialog"/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /setMobileMenuPathname\(null\)/);
  assert.match(source, /mobileMenuPathname === pathname/);
  assert.match(source, /onClick=\{onClose\}/);
  assert.match(source, /function isSellerNavItemActive/);
  assert.match(source, /<MobileMenuLink item=\{sellerAddInventoryNavItem\}/);
});
