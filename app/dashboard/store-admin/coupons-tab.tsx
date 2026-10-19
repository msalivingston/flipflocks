"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { couponCategories, type SellerCoupon, type CouponTarget } from "@/lib/coupons";
import { searchOrderInventory } from "../orders/_lib/order-inventory-search";
import type { InventorySearchRow } from "../orders/_lib/order-form-types";

const blank: Omit<SellerCoupon, "id"> = { code: "", discount_type: "fixed", discount_value: 10, scope: "order", targets: [], minimum_purchase: 0, expires_on: null, once_per_customer: false, is_active: true };
const inputClass = "mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm";
const buttonClass = "rounded-lg bg-emerald-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50";

export default function CouponsTab({ storeId }: { storeId: string }) {
  const [coupons, setCoupons] = useState<SellerCoupon[]>([]);
  const [draft, setDraft] = useState<(Omit<SellerCoupon, "id"> & { id?: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [products, setProducts] = useState<InventorySearchRow[]>([]);
  const [query, setQuery] = useState("");
  const [breeds, setBreeds] = useState<{ id: string; display_name: string }[]>([]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      supabase.from("seller_coupons").select("*").eq("store_id", storeId).order("created_at", { ascending: false }),
      supabase.from("seller_breed_profiles").select("id,display_name").eq("store_id", storeId).order("display_name"),
    ]).then(([rows, breedRows]) => {
      if (!active) return;
      setError(rows.error?.message ?? breedRows.error?.message ?? null);
      setCoupons((rows.data ?? []) as SellerCoupon[]); setBreeds(breedRows.data ?? []); setLoading(false);
    });
    return () => { active = false; };
  }, [storeId]);
  useEffect(() => {
    if (draft?.scope !== "products") return;
    let active = true;
    const timer = setTimeout(() => {
      void searchOrderInventory({ storeId, query, filter: "all", limit: 50 }).then(rows => {
        if (active) setProducts(rows);
      }).catch(e => { if (active) setError(e instanceof Error ? e.message : "Could not search products."); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [draft?.scope, query, storeId]);

  async function save(coupon: Omit<SellerCoupon, "id"> & { id?: string }) {
    setSaving(true); setError(null);
    try {
      const { error: saveError } = await supabase.rpc("seller_save_coupon", { p_store_id: storeId, p_coupon_id: coupon.id ?? null, p_coupon: coupon });
      if (saveError) { setError(saveError.code === "23505" ? "That coupon code already exists in your store." : saveError.code === "23514" ? "Check the coupon code, discount amount, and eligible selections." : saveError.message); return; }
      const { data, error: loadError } = await supabase.from("seller_coupons").select("*").eq("store_id", storeId).order("created_at", { ascending: false });
      if (loadError) { setError(loadError.message); return; }
      setCoupons((data ?? []) as SellerCoupon[]); setDraft(null);
    } finally { setSaving(false); }
  }
  function toggleTarget(target: CouponTarget) {
    if (!draft) return;
    const key = JSON.stringify(target);
    setDraft({ ...draft, targets: draft.targets.some(t => JSON.stringify(t) === key)
      ? draft.targets.filter(t => JSON.stringify(t) !== key) : [...draft.targets, target] });
  }
  const checked = (target: CouponTarget) => Boolean(draft?.targets.some(t => JSON.stringify(t) === JSON.stringify(target)));

  return <section aria-label="Coupons" className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-stone-200 p-5">
      <div><h2 className="text-xl font-semibold">Coupons</h2><p className="mt-1 text-sm text-stone-600">Create and manage discounts for your customers.</p></div>
      <button className={buttonClass} disabled={saving} onClick={() => { setDraft({ ...blank }); setError(null); }}>+ Create Coupon</button>
    </div>
    {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    <div className={`grid gap-5 ${draft ? "xl:grid-cols-[minmax(0,1fr)_360px]" : ""}`}>
      <div className="overflow-x-auto rounded-lg border border-stone-200">
        <table className="w-full text-left text-sm"><thead className="bg-stone-50"><tr>{["Code", "Discount", "Applies to", "Expires", "Status", "Actions"].map(label => <th key={label} className="px-4 py-3 font-semibold">{label}</th>)}</tr></thead>
          <tbody>{coupons.map(coupon => <tr key={coupon.id} className="border-t border-stone-200">
            <td className="px-4 py-4 font-semibold">{coupon.code}</td><td className="px-4 py-4">{coupon.discount_type === "fixed" ? `$${Number(coupon.discount_value).toFixed(2)} off` : `${coupon.discount_value}% off`}</td>
            <td className="px-4 py-4">{coupon.scope === "order" ? "Entire order" : `Selected ${coupon.scope}`}</td><td className="px-4 py-4">{coupon.expires_on ?? "None"}</td>
            <td className="px-4 py-4"><span className={`rounded-full px-3 py-1 ${coupon.is_active ? "bg-emerald-50 text-emerald-900" : "bg-stone-100 text-stone-600"}`}>{coupon.is_active ? "Active" : "Inactive"}</span></td>
            <td className="space-x-3 whitespace-nowrap px-4 py-4"><button className="font-semibold text-emerald-800" disabled={saving} onClick={() => { setDraft({ ...coupon }); setError(null); }}>Edit</button><button disabled={saving} onClick={() => void save({ ...coupon, is_active: !coupon.is_active })}>{coupon.is_active ? "Deactivate" : "Activate"}</button></td>
          </tr>)}</tbody></table>
        {loading ? <p className="p-5 text-sm">Loading coupons…</p> : !coupons.length ? <p className="p-5 text-sm text-stone-600">No coupons yet. Create a coupon to get started.</p> : null}
      </div>
      {draft ? <form className="space-y-4 rounded-lg border border-stone-200 p-5" onSubmit={event => { event.preventDefault(); void save(draft); }}>
        <h3 className="text-lg font-semibold">{draft.id ? "Edit Coupon" : "Create Coupon"}</h3>
        <label className="block text-sm font-semibold">Coupon code<input className={inputClass} value={draft.code} maxLength={40} pattern="[A-Za-z0-9][A-Za-z0-9_-]*" required onChange={e => setDraft({ ...draft, code: e.target.value.toUpperCase() })}/><span className="mt-1 block text-xs font-normal text-stone-500">The shared code customers enter at checkout.</span></label>
        <label className="block text-sm font-semibold">Discount type<select className={inputClass} value={draft.discount_type} onChange={e => setDraft({ ...draft, discount_type: e.target.value as SellerCoupon["discount_type"] })}><option value="fixed">Fixed amount ($)</option><option value="percent">Percentage (%)</option></select></label>
        <label className="block text-sm font-semibold">Discount amount<input className={inputClass} type="number" min="0.01" max={draft.discount_type === "percent" ? 100 : undefined} step="0.01" required value={draft.discount_value} onChange={e => setDraft({ ...draft, discount_value: Number(e.target.value) })}/></label>
        <label className="block text-sm font-semibold">Applies to<select className={inputClass} value={draft.scope} onChange={e => setDraft({ ...draft, scope: e.target.value as SellerCoupon["scope"], targets: [] })}><option value="order">Entire order</option><option value="products">Selected products</option><option value="breeds">Selected breeds</option><option value="categories">Selected categories</option></select></label>
        <p className="text-xs text-stone-500">Discounts apply to merchandise, before delivery and tax. Breed selection uses existing live-bird breed profiles; select products for other inventory.</p>
        {draft.scope === "products" ? <div className="space-y-2"><label className="block text-sm">Search products<input className={inputClass} value={query} onChange={e => setQuery(e.target.value)} placeholder="Breed or product name"/></label><p className="text-xs text-stone-500">Choose the specific chicks or hens eligible for a survey reward. Selected products stay selected when searching.</p><p className="text-xs">{draft.targets.length} selected</p><div className="max-h-60 space-y-2 overflow-y-auto">{products.map(item => {
          const target = { item_type: item.itemType, item_id: item.id };
          return <label key={`${item.itemType}:${item.id}`} className="flex gap-2 text-sm"><input type="checkbox" checked={checked(target)} onChange={() => toggleTarget(target)}/><span>{item.title} — {item.detailLabel}{item.available_date ? ` · ${item.available_date}` : ""}</span></label>;
        })}</div></div> : null}
        {draft.scope === "breeds" ? <fieldset className="max-h-60 space-y-2 overflow-y-auto"><legend className="mb-2 text-sm font-semibold">Eligible breeds</legend>{breeds.map(breed => <label key={breed.id} className="flex gap-2 text-sm"><input type="checkbox" checked={checked(breed.id)} onChange={() => toggleTarget(breed.id)}/>{breed.display_name}</label>)}</fieldset> : null}
        {draft.scope === "categories" ? <fieldset className="space-y-2"><legend className="mb-2 text-sm font-semibold">Eligible categories</legend>{couponCategories.map(category => <label key={category.value} className="flex gap-2 text-sm"><input type="checkbox" checked={checked(category.value)} onChange={() => toggleTarget(category.value)}/>{category.label}</label>)}</fieldset> : null}
        <label className="block text-sm font-semibold">Minimum purchase (optional)<input className={inputClass} type="number" min="0" step="0.01" value={draft.minimum_purchase || ""} onChange={e => setDraft({ ...draft, minimum_purchase: Number(e.target.value) })}/><span className="mt-1 block text-xs font-normal text-stone-500">Eligible merchandise before discounts; excludes delivery and tax.</span></label>
        <label className="block text-sm font-semibold">Expiration date (optional)<input className={inputClass} type="date" value={draft.expires_on ?? ""} onChange={e => setDraft({ ...draft, expires_on: e.target.value || null })}/><span className="text-xs font-normal text-stone-500">Valid through this date (UTC).</span></label>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={draft.once_per_customer} onChange={e => setDraft({ ...draft, once_per_customer: e.target.checked })}/>One use per customer email</label>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={draft.is_active} onChange={e => setDraft({ ...draft, is_active: e.target.checked })}/>Active</label>
        <div className="flex justify-end gap-3 border-t border-stone-200 pt-4"><button type="button" disabled={saving} onClick={() => setDraft(null)}>Cancel</button><button className={buttonClass} disabled={saving || (draft.scope !== "order" && !draft.targets.length)}>{saving ? "Saving…" : "Save Coupon"}</button></div>
      </form> : null}
    </div>
  </section>;
}
