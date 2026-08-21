"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import type { AdminWebinarRow } from "../_lib/admin-types";
import { AdminCard, AdminErrorState, AdminPageHeader } from "./admin-ui";

const zones = ["America/Denver", "America/Chicago", "America/New_York", "America/Los_Angeles"];

export function AdminWebinarForm({ webinar }: { webinar?: AdminWebinarRow }) {
  const router = useRouter();
  const [title, setTitle] = useState(webinar?.title ?? "");
  const [slug, setSlug] = useState(webinar?.slug ?? "");
  const [description, setDescription] = useState(webinar?.short_description ?? "");
  const [startsAt, setStartsAt] = useState(webinar ? localInputValue(webinar.starts_at, webinar.timezone) : "");
  const [timezone, setTimezone] = useState(webinar?.timezone ?? "America/Denver");
  const [joinUrl, setJoinUrl] = useState(webinar?.join_url ?? "");
  const [status, setStatus] = useState<AdminWebinarRow["status"]>(webinar?.status ?? "draft");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault(); setError(null); setSaving(true);
    const cleanSlug = slug.trim().toLowerCase().replace(/\s+/g, "-");
    const payload = { title: title.trim(), slug: cleanSlug, short_description: description.trim(), starts_at: zonedDateTimeToIso(startsAt, timezone), timezone, join_url: joinUrl.trim(), status };
    const result = webinar
      ? await supabase.from("webinars").update(payload).eq("id", webinar.id).select().single()
      : await supabase.from("webinars").insert(payload).select().single();
    setSaving(false);
    if (result.error) { setError(result.error.message); return; }
    router.push(webinar ? `/admin/webinars/${webinar.id}` : `/admin/webinars/${result.data.id}`);
    router.refresh();
  }

  return <>
    <AdminPageHeader eyebrow="Webinars" title={webinar ? "Edit webinar" : "Create webinar"} description="Set up one reusable public registration page for this event." />
    <div className="mx-auto w-full max-w-3xl px-5 py-5 sm:px-7">
      {error ? <AdminErrorState message={error} /> : null}
      <AdminCard><form className="grid gap-4 p-5" onSubmit={save}>
        <Field label="Title" value={title} onChange={setTitle} required />
        <Field label="Slug" value={slug} onChange={setSlug} required pattern="[a-z0-9-]+" />
        <label className="grid gap-1 text-sm font-semibold text-stone-800">Short description<textarea className="min-h-24 rounded-md border border-stone-300 px-3 py-2 font-normal" value={description} onChange={(e) => setDescription(e.target.value)} required /></label>
        <div className="grid gap-4 sm:grid-cols-2"><Field label="Date and time" type="datetime-local" value={startsAt} onChange={setStartsAt} required /><label className="grid gap-1 text-sm font-semibold text-stone-800">Timezone<select className="rounded-md border border-stone-300 bg-white px-3 py-2 font-normal" value={timezone} onChange={(e) => setTimezone(e.target.value)}>{zones.map((zone) => <option key={zone}>{zone}</option>)}</select></label></div>
        <Field label="Zoom / join link" type="url" value={joinUrl} onChange={setJoinUrl} required />
        <label className="grid gap-1 text-sm font-semibold text-stone-800">Status<select className="rounded-md border border-stone-300 bg-white px-3 py-2 font-normal" value={status} onChange={(e) => setStatus(e.target.value as AdminWebinarRow["status"])}>{["draft", "open", "closed", "completed"].map((value) => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}</select></label>
        <div className="flex gap-3 pt-2"><button className="seller-primary-button" disabled={saving} type="submit">{saving ? "Saving…" : webinar ? "Save changes" : "Create webinar"}</button><button className="seller-secondary-button" type="button" onClick={() => router.back()}>Cancel</button></div>
      </form></AdminCard>
    </div>
  </>;
}

function Field({ label, value, onChange, type = "text", required, pattern }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean; pattern?: string }) { return <label className="grid gap-1 text-sm font-semibold text-stone-800">{label}<input className="rounded-md border border-stone-300 px-3 py-2 font-normal" type={type} value={value} onChange={(e) => onChange(e.target.value)} required={required} pattern={pattern} /></label>; }

function localInputValue(value: string, timezone: string) { const parts = new Intl.DateTimeFormat("sv-SE", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value)); const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ""; return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`; }
function zonedDateTimeToIso(value: string, timezone: string) { const naive = Date.parse(`${value}:00Z`); const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(naive)); const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0); const represented = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")); return new Date(naive - (represented - naive)).toISOString(); }
