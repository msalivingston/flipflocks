import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const read = (file) => readFileSync(resolve(root, file), "utf8");
const baseMigration = read("supabase/migrations/20260821170000_webinars.sql");
const lifecycleMigration = read("supabase/migrations/20260903180000_webinar_email_lifecycle.sql");
const migration = `${baseMigration}\n${lifecycleMigration}`;

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
  assert.match(lifecycleMigration, /\(v_registration_id, 'confirmation'\),\s*\(v_registration_id, 'reminder'\),\s*\(v_registration_id, 'admin_registration'\)/);
  assert.match(lifecycleMigration, /r\.canceled_at is null/);
  assert.match(lifecycleMigration, /email_type = 'reminder'[\s\S]*status in \('pending', 'failed', 'processing'\)/);
  assert.match(lifecycleMigration, /mark_webinar_email_delivery_unknown/);
  assert.match(read("supabase/functions/webinar-email-worker/index.ts"), /delivery_unknown/);
  assert.match(lifecycleMigration, /p_email_type is null and q\.email_type in \('confirmation', 'reminder'\)/);
  assert.match(read("supabase/functions/webinar-email-worker/index.ts"), /\[null, "admin_registration", "admin_cancellation"\]/);
});

test("webinar cancellation uses a dedicated token and preserves history", () => {
  assert.match(lifecycleMigration, /cancellation_token uuid not null default gen_random_uuid\(\)/);
  assert.match(lifecycleMigration, /set canceled_at = v_canceled_at/);
  assert.doesNotMatch(lifecycleMigration, /delete from public\.webinar_registrations/);
  assert.match(lifecycleMigration, /'already_canceled'::text/);
  assert.match(lifecycleMigration, /on conflict on constraint webinar_email_queue_unique_type do nothing/);
  assert.match(read("app/webinars/cancel/[token]/page.tsx"), /get_public_webinar_cancellation/);
  assert.match(read("supabase/functions/webinar-registration-cancel/index.ts"), /cancel_webinar_registration/);
});

test("webinar cron uses a public URL and a Vault-held worker secret", () => {
  assert.match(lifecycleMigration, /https:\/\/ymbnnipiohoccwpltkkj\.supabase\.co\/functions\/v1\/webinar-email-worker/);
  assert.match(lifecycleMigration, /vault\.decrypted_secrets[\s\S]*flockfront_webinar_worker_secret/);
  assert.doesNotMatch(lifecycleMigration, /SUPABASE_SERVICE_ROLE_KEY/);
});

test("admin attendance and public registration surfaces exist", () => {
  assert.match(read("app/admin/_components/admin-app-shell.tsx"), /Webinars/);
  assert.match(read("app/admin/_components/admin-webinar-detail.tsx"), /attended/);
  assert.match(read("app/webinars/[slug]/registration-form.tsx"), /webinar-register/);
  assert.match(read("supabase/functions/webinar-register/index.ts"), /register_for_webinar/);
  assert.match(read("supabase/functions/webinar-register/index.ts"), /\["confirmation", "admin_registration"\]/);
});

test("the admin webinar edit page loads through the authenticated browser client", () => {
  const editPage = read("app/admin/webinars/[webinarId]/edit/page.tsx");

  assert.match(editPage, /^"use client";/);
  assert.match(editPage, /useParams<\{ webinarId: string \}>\(\)/);
  assert.match(editPage, /supabase\.from\("webinars"\)\.select\("\*"\)\.eq\("id", webinarId\)\.single\(\)/);
  assert.doesNotMatch(editPage, /notFound/);
});
