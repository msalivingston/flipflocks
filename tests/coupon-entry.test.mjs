import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import * as coupons from "../lib/coupons.ts";

function setup(rpc = async () => ({ data: { coupon_amount: 10 }, error: null }), overrides = {}) {
  const slots = [], effects = [], calls = [], previews = [];
  let cursor = 0, effectCursor = 0;
  const client = { rpc: async (...args) => { calls.push(args); return rpc(...args); } };
  const stubs = {
    react: {
      useState: initial => {
        const index = cursor++;
        if (!(index in slots)) slots[index] = initial;
        return [slots[index], value => { slots[index] = value; }];
      },
      useRef: initial => {
        const index = cursor++;
        if (!(index in slots)) slots[index] = { current: initial };
        return slots[index];
      },
      useEffect: (effect, deps) => {
        const index = effectCursor++;
        if (!effects[index] || deps.some((value, i) => value !== effects[index].deps[i])) {
          effects[index]?.cleanup?.();
          effects[index] = { deps, cleanup: effect() };
        }
      },
    },
    "react/jsx-runtime": jsxRuntime,
    "@/lib/supabase": { supabase: client },
    "@/lib/public-supabase": { publicSupabase: client },
    "@/lib/coupons": coupons,
  };
  const compiled = ts.transpileModule(readFileSync(new URL("../app/_components/coupon-entry.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    assert.ok(stubs[name], name);
    return stubs[name];
  }, loaded, loaded.exports);
  const props = { code: "SURVEY10", email: "buyer@example.test", items: [{ item_id: "bird", quantity: 10 }], storeSlug: "test-store", onCodeChange: () => {}, onPreview: value => previews.push(value), ...overrides };
  const nodes = node => node && typeof node === "object" ? [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)] : [];
  const render = (updates = {}) => {
    Object.assign(props, updates);
    cursor = 0;
    effectCursor = 0;
    return nodes(loaded.exports.CouponEntry(props));
  };
  const button = tree => tree.find(node => node.type === "button");
  return { render, button, calls, previews, props };
}

test("coupon waits for Apply Coupon, then shows success without submitting its parent form", async () => {
  const ui = setup();
  const tree = ui.render();
  assert.equal(ui.calls.length, 0);
  assert.equal(ui.button(tree).props.children, "Apply Coupon");
  assert.equal(ui.button(tree).props.type, "button");
  const pending = ui.button(tree).props.onClick();
  assert.equal(ui.button(ui.render()).props.disabled, true);
  await pending;
  assert.equal(ui.calls.length, 1);
  assert.equal(ui.calls[0][0], "preview_storefront_coupon");
  assert.equal(ui.previews.at(-1).amount, 10);
  assert.equal(ui.previews.at(-1).valid, true);
  assert.ok(ui.render().some(node => node.props?.role === "status" && node.props.children === "Coupon applied: $10.00 off."));
});

test("missing email and rejected codes show errors, and clearing the code disables Apply", async () => {
  const ui = setup(async () => ({ data: null, error: { message: "This coupon has already been used." } }), { email: "" });
  await ui.button(ui.render()).props.onClick();
  assert.equal(ui.calls.length, 0);
  assert.ok(ui.render().some(node => node.props?.role === "alert" && node.props.children.includes("email")));
  await ui.button(ui.render({ email: "buyer@example.test" })).props.onClick();
  assert.equal(ui.previews.at(-1).valid, false);
  assert.ok(ui.render().some(node => node.props?.role === "alert" && node.props.children === "This coupon has already been used."));
  assert.equal(ui.button(ui.render({ code: "" })).props.disabled, true);
});

test("email, cart, or code changes require Apply again and ignore stale responses", async () => {
  let finish;
  const ui = setup(() => new Promise(resolve => { finish = resolve; }));
  const pending = ui.button(ui.render()).props.onClick();
  ui.render({ email: "different@example.test" });
  finish({ data: { coupon_amount: 10 }, error: null });
  await pending;
  assert.equal(ui.previews.some(preview => preview.valid), false);
  assert.equal(ui.calls.length, 1);
  assert.equal(ui.button(ui.render()).props.disabled, false);
  ui.render({ items: [{ item_id: "bird", quantity: 20 }], code: "OTHER10" });
  assert.equal(ui.calls.length, 1, "changing the priced intent never auto-applies");
});

test("seller entry keeps the owner-only preview and request failures permit retry", async () => {
  const ui = setup(async () => { throw new Error("network unavailable"); }, { storeId: "seller-store", orderId: "existing-order" });
  await ui.button(ui.render()).props.onClick();
  assert.equal(ui.calls[0][0], "seller_preview_order_coupon");
  assert.equal(ui.calls[0][1].p_order_id, "existing-order");
  assert.equal(ui.previews.at(-1).checking, false);
  assert.ok(ui.render().some(node => node.props?.role === "alert" && node.props.children.includes("try again")));
  assert.equal(ui.button(ui.render()).props.disabled, false);
});
