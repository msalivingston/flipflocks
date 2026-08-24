import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const read = (file) => readFileSync(resolve(root, file), "utf8");
const migration = read("supabase/migrations/20260821170000_webinars.sql");

test("webinar schema enforces public registration boundaries and duplicate emails", () => {
  assert.match(migration, /create table public\.webinars/);
  assert.match(migration, /create table public\.webinar_registrations/);
  assert.match(migration, /unique \(webinar_id, email\)/);
  assert.match(migration, /where slug = lower\(btrim\(p_slug\)\) and status = 'open'/);
  assert.match(migration, /grant execute on function public\.register_for_webinar/);
  assert.match(migration, /revoke all on public\.webinar_registrations from anon, authenticated/);
});

test("webinar email queue is idempotent and reminder-gated", () => {
  assert.match(migration, /constraint webinar_email_queue_unique_type unique \(registration_id, email_type\)/);
  assert.match(migration, /email_type = 'confirmation' or/);
  assert.match(migration, /time >= time '10:00'/);
  assert.match(migration, /mark_webinar_email_sent/);
});

test("admin attendance and public registration surfaces exist", () => {
  assert.match(read("app/admin/_components/admin-app-shell.tsx"), /Webinars/);
  assert.match(read("app/admin/_components/admin-webinar-detail.tsx"), /attended/);
  assert.match(read("app/webinars/[slug]/registration-form.tsx"), /webinar-register/);
  assert.match(read("supabase/functions/webinar-register/index.ts"), /register_for_webinar/);
});

test("the admin webinar edit page loads through the authenticated browser client", () => {
  const editPage = read("app/admin/webinars/[webinarId]/edit/page.tsx");

  assert.match(editPage, /^"use client";/);
  assert.match(editPage, /useParams<\{ webinarId: string \}>\(\)/);
  assert.match(editPage, /supabase\.from\("webinars"\)\.select\("\*"\)\.eq\("id", webinarId\)\.single\(\)/);
  assert.doesNotMatch(editPage, /notFound/);
});
