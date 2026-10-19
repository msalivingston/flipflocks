"use client";

import { useEffect, useRef, useState } from "react";
import { publicSupabase } from "@/lib/public-supabase";
import { supabase } from "@/lib/supabase";
import { normalizeCouponCode, normalizeCouponEmail } from "@/lib/coupons";

export type CouponPreview = { code: string; amount: number; valid: boolean; checking: boolean; requestKey: string };
export function couponPreviewKey(code: string, email: string, items: unknown) {
  return JSON.stringify([normalizeCouponCode(code), normalizeCouponEmail(email), items]);
}

export function CouponEntry({ code, email, items, storeSlug, storeId, orderId, onCodeChange, onPreview }: {
  code: string; email: string; items: unknown[]; storeSlug?: string; storeId?: string; orderId?: string;
  onCodeChange: (code: string) => void; onPreview: (preview: CouponPreview) => void;
}) {
  const [result, setResult] = useState<{ key: string; message: string; status: "checking" | "success" | "error" } | null>(null);
  const requestId = useRef(0);
  const key = couponPreviewKey(code,email,items);
  useEffect(() => () => { requestId.current += 1; }, [key, storeId, storeSlug, orderId]);
  const currentResult = result?.key === key ? result : null;

  async function applyCoupon() {
    const normalized = normalizeCouponCode(code);
    const request = ++requestId.current;
    if (!normalized) return;
    if (!email.trim()) {
      onPreview({ code: normalized, amount: 0, valid: false, checking: false, requestKey: key });
      setResult({ key, status: "error", message: storeId ? "Enter the customer email before applying a coupon." : "Enter your email address before applying a coupon." });
      return;
    }
    setResult({ key, status: "checking", message: "Checking coupon…" });
    onPreview({ code: normalized, amount: 0, valid: false, checking: true, requestKey: key });
    try {
      const { data, error } = storeId
        ? await supabase.rpc("seller_preview_order_coupon", { p_store_id: storeId, p_items: items, p_coupon_code: normalized, p_customer_email: email, p_order_id: orderId ?? null })
        : await publicSupabase.rpc("preview_storefront_coupon", { p_store_slug: storeSlug, p_items: items, p_coupon_code: normalized, p_customer_email: email });
      if (request !== requestId.current) return;
      onPreview({ code: normalized, amount: error ? 0 : Number(data?.coupon_amount ?? 0), valid: !error, checking: false, requestKey: key });
      setResult({ key, status: error ? "error" : "success", message: error?.message ?? `Coupon applied: $${Number(data?.coupon_amount ?? 0).toFixed(2)} off.` });
    } catch {
      if (request !== requestId.current) return;
      onPreview({ code: normalized, amount: 0, valid: false, checking: false, requestKey: key });
      setResult({ key, status: "error", message: "Could not check the coupon. Please try again." });
    }
  }

  return <div className="space-y-1 text-sm"><label className="grid gap-1 font-semibold">Coupon code<input className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 font-normal" value={code} maxLength={40} autoComplete="off" onChange={e => onCodeChange(e.target.value.toUpperCase())} placeholder="Enter a coupon code"/></label>
    <button type="button" onClick={applyCoupon} disabled={!code.trim() || currentResult?.status === "checking"} className="mt-2 rounded-lg bg-emerald-800 px-4 py-2 font-semibold text-white hover:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-50">
      {currentResult?.status === "checking" ? "Applying…" : "Apply Coupon"}
    </button>
    {currentResult ? <p aria-live="polite" role={currentResult.status === "error" ? "alert" : "status"} className={`text-xs ${currentResult.status === "error" ? "text-red-700" : "text-emerald-800"}`}>{currentResult.message}</p> : code.trim() ? <p className="text-xs text-stone-600">Select Apply Coupon to check this code. Apply again if your email or order changes.</p> : null}
  </div>;
}
