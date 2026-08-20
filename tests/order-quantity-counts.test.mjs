import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

function source(path) {
  return readFileSync(resolve(root, path), "utf8");
}

test("orders dashboard formats the server-provided total quantity", () => {
  const ordersList = source("app/dashboard/orders/orders-list.tsx");

  assert.match(ordersList, /const itemCount = order\.total_item_quantity \?\? 0/);
  assert.match(ordersList, /itemCount === 1 \? "" : "s"/);
});

test("New Order heading derives its live count from active line quantities", () => {
  const calculations = source(
    "app/dashboard/orders/_lib/order-form-calculations.ts",
  );
  const editor = source(
    "app/dashboard/orders/_components/order-items-editor.tsx",
  );

  assert.match(calculations, /export function calculateOrderItemQuantity/);
  assert.match(
    calculations,
    /\.filter\(isActiveLine\)\s*\.reduce\(\(total, line\) => total \+ Number\(line\.quantity \|\| 0\), 0\)/s,
  );
  assert.match(editor, /calculateOrderItemQuantity\(lines\)/);
  assert.match(editor, /totalItemQuantity === 1 \? "" : "s"/);
});
