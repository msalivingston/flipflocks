import assert from "node:assert/strict";
import test from "node:test";

globalThis.Deno = {
  env: {
    get(name) {
      return name === "FLOCKFRONT_PUBLIC_SITE_URL" ? "https://www.flockfront.com" : undefined;
    },
  },
};

const { renderWebinarEmail, webinarAdminRecipientEmail } = await import(
  "../supabase/functions/webinar-email-worker/email.ts"
);

const baseEmail = {
  queue_id: "10000000-0000-4000-8000-000000000001",
  processing_token: "10000000-0000-4000-8000-000000000002",
  registration_id: "10000000-0000-4000-8000-000000000003",
  first_name: "Jamie",
  last_name: "Farmer",
  email: "jamie@example.test",
  webinar_title: "Selling Poultry Online",
  starts_at: "2026-09-04T00:00:00.000Z",
  timezone: "America/Denver",
  join_url: "https://example.test/join",
  cancellation_token: "10000000-0000-4000-8000-000000000004",
  registered_at: "2026-09-01T18:00:00.000Z",
  canceled_at: null,
  attempt_count: 1,
};

test("confirmation wording stays intact and adds only the cancellation action", () => {
  const rendered = renderWebinarEmail({ ...baseEmail, email_type: "confirmation" });
  assert.equal(rendered.subject, "You’re registered: Selling Poultry Online");
  assert.match(rendered.text, /Thanks for registering for the FlockFront webinar\./);
  assert.match(rendered.text, /Join the webinar: https:\/\/example\.test\/join/);
  assert.match(rendered.text, /Cancel registration: https:\/\/www\.flockfront\.com\/webinars\/cancel\/10000000-0000-4000-8000-000000000004/);
});

test("reminder wording stays intact and does not include cancellation copy", () => {
  const rendered = renderWebinarEmail({ ...baseEmail, email_type: "reminder" });
  assert.equal(rendered.subject, "Reminder: Selling Poultry Online");
  assert.match(rendered.text, /Your FlockFront webinar starts soon\./);
  assert.doesNotMatch(rendered.text, /Cancel registration/);
});

test("admin registration and cancellation notifications contain required facts", () => {
  assert.equal(webinarAdminRecipientEmail, "hello@flockfront.com");
  const registration = renderWebinarEmail({ ...baseEmail, email_type: "admin_registration" });
  assert.equal(registration.subject, "New webinar registration: Selling Poultry Online");
  assert.match(registration.text, /Registrant: Jamie Farmer/);
  assert.match(registration.text, /Registrant email: jamie@example\.test/);
  assert.match(registration.text, /Registered at:/);

  const cancellation = renderWebinarEmail({
    ...baseEmail,
    email_type: "admin_cancellation",
    canceled_at: "2026-09-03T20:00:00.000Z",
  });
  assert.equal(cancellation.subject, "Webinar registration canceled: Selling Poultry Online");
  assert.match(cancellation.text, /Canceled at:/);
});
