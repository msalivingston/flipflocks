"use client";

import { useEffect, useState } from "react";
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
  const [message, setMessage] = useState<string | null>(null);
  const key = couponPreviewKey(code,email,items);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      const normalized = normalizeCouponCode(code);
      if (!normalized) { onPreview({ code: "", amount: 0, valid: true, checking: false, requestKey: key }); setMessage(null); return; }
      if (!email.trim()) { onPreview({ code: normalized, amount: 0, valid: false, checking: false, requestKey: key }); setMessage("Enter the customer email to check this coupon."); return; }
      onPreview({ code: normalized, amount: 0, valid: false, checking: true, requestKey: key });
      const { data, error } = storeId
        ? await supabase.rpc("seller_preview_order_coupon", { p_store_id: storeId, p_items: items, p_coupon_code: normalized, p_customer_email: email, p_order_id: orderId ?? null })
        : await publicSupabase.rpc("preview_storefront_coupon", { p_store_slug: storeSlug, p_items: items, p_coupon_code: normalized, p_customer_email: email });
      if (!active) return;
      onPreview({ code: normalized, amount: error ? 0 : Number(data?.coupon_amount ?? 0), valid: !error, checking: false, requestKey: key });
      setMessage(error?.message ?? `Coupon applied: $${Number(data?.coupon_amount ?? 0).toFixed(2)} off.`);
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  // key captures the complete priced intent; callback setters are stable.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, storeId, storeSlug, orderId, onPreview]);

  return <div className="space-y-1 text-sm"><label className="grid gap-1 font-semibold">Coupon code<input className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 font-normal" value={code} maxLength={40} autoComplete="off" onChange={e => onCodeChange(e.target.value.toUpperCase())} placeholder="Enter a coupon code"/></label>
    {message ? <p aria-live="polite" className="text-xs text-stone-600">{message}</p> : null}
  </div>;
}
