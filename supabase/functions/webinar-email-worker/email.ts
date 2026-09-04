import { deliverPostmarkMessage } from "../postmark-email-worker/delivery-state.ts";
import { adminNewSubscriberRecipientEmail } from "../postmark-email-worker/admin-new-subscriber.ts";

export const webinarAdminRecipientEmail = adminNewSubscriberRecipientEmail;

export type WebinarEmail = {
  queue_id: string;
  processing_token: string;
  registration_id: string;
  email_type:
    | "confirmation"
    | "reminder"
    | "admin_registration"
    | "admin_cancellation";
  first_name: string;
  last_name: string;
  email: string;
  webinar_title: string;
  starts_at: string;
  timezone: string;
  join_url: string;
  cancellation_token: string;
  registered_at: string;
  canceled_at: string | null;
  attempt_count: number;
};

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
}

function dateText(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeStyle: "short", timeZone: timezone }).format(new Date(value));
}

function cancellationUrl(token: string) {
  const siteUrl = (Deno.env.get("FLOCKFRONT_PUBLIC_SITE_URL") || "https://flockfront.com").replace(/\/$/, "");
  return `${siteUrl}/webinars/cancel/${encodeURIComponent(token)}`;
}

function renderAdminWebinarEmail(item: WebinarEmail) {
  const isCancellation = item.email_type === "admin_cancellation";
  if (isCancellation && !item.canceled_at) {
    throw new Error("Webinar registration cancellation time is unavailable.");
  }
  const subject = `${isCancellation ? "Webinar registration canceled" : "New webinar registration"}: ${item.webinar_title}`;
  const eventDate = dateText(item.starts_at, item.timezone);
  const activityAt = dateText(
    isCancellation ? item.canceled_at! : item.registered_at,
    item.timezone,
  );
  const activityLabel = isCancellation ? "Canceled at" : "Registered at";
  const facts: Array<[string, string]> = [
    ["Webinar", item.webinar_title],
    ["Webinar date/time", eventDate],
    ["Registrant", `${item.first_name} ${item.last_name}`],
    ["Registrant email", item.email],
    [activityLabel, activityAt],
  ];
  const html = [
    "<!doctype html><html><body>",
    `<h1>${escapeHtml(subject)}</h1>`,
    "<table>",
    ...facts.map(([label, value]) =>
      `<tr><th align="left">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`
    ),
    "</table>",
    "</body></html>",
  ].join("");
  const text = [subject, "", ...facts.map(([label, value]) => `${label}: ${value}`)].join("\n");
  return { subject, html, text };
}

export function renderWebinarEmail(item: WebinarEmail) {
  if (item.email_type === "admin_registration" || item.email_type === "admin_cancellation") {
    return renderAdminWebinarEmail(item);
  }

  const date = dateText(item.starts_at, item.timezone);
  const isReminder = item.email_type === "reminder";
  const subject = `${isReminder ? "Reminder" : "You’re registered"}: ${item.webinar_title}`;
  const intro = isReminder ? "Your FlockFront webinar starts soon." : "Thanks for registering for the FlockFront webinar.";
  const cancelLink = isReminder ? null : cancellationUrl(item.cancellation_token);
  const html = `<!doctype html><html><body style="margin:0;background:#fffaf1;color:#10281c;font-family:Arial,sans-serif;padding:24px 12px"><table role="presentation" width="100%" style="max-width:620px;margin:auto;background:#fff;border:1px solid #ded6c7;border-radius:12px"><tr><td style="height:5px;background:#246f38"></td></tr><tr><td style="padding:24px 30px"><img src="${escapeHtml((Deno.env.get("FLOCKFRONT_PUBLIC_SITE_URL") || "https://flockfront.com").replace(/\/$/, "") + "/branding/flockfront-logo-final.png")}" width="205" alt="FlockFront" style="max-width:100%;height:auto"><h1 style="color:#10281c;font-size:26px;line-height:1.15">${escapeHtml(item.webinar_title)}</h1><p style="font-size:16px;line-height:1.6">Hi ${escapeHtml(item.first_name)},</p><p style="font-size:16px;line-height:1.6">${intro}</p><p style="font-size:16px;line-height:1.6"><strong>Date and time:</strong><br>${escapeHtml(date)}</p><p><a href="${escapeHtml(item.join_url)}" style="display:inline-block;background:#246f38;color:#fff;padding:13px 20px;border-radius:7px;text-decoration:none;font-weight:700">Join the webinar</a></p><p style="font-size:14px;line-height:1.6;color:#514b42">If the button does not work, use this link:<br>${escapeHtml(item.join_url)}</p>${cancelLink ? `<p style="font-size:14px;line-height:1.6"><a href="${escapeHtml(cancelLink)}" style="color:#514b42;text-decoration:underline">Cancel registration</a></p>` : ""}<p style="font-size:15px;line-height:1.6">FlockFront<br>A better way to sell poultry.</p></td></tr></table></body></html>`;
  const text = [
    `${item.webinar_title}`,
    `Hi ${item.first_name},`,
    intro,
    `Date and time: ${date}`,
    `Join the webinar: ${item.join_url}`,
    ...(cancelLink ? [`Cancel registration: ${cancelLink}`] : []),
    "",
    "FlockFront",
    "A better way to sell poultry.",
  ].join("\n\n");
  return { subject, html, text };
}

export async function sendWebinarEmail(item: WebinarEmail, token: string) {
  const rendered = renderWebinarEmail(item);
  const recipient = item.email_type === "admin_registration" || item.email_type === "admin_cancellation"
    ? webinarAdminRecipientEmail
    : item.email;
  return deliverPostmarkMessage({
    endpoint: "https://api.postmarkapp.com/email",
    fetchImplementation: fetch,
    token,
    request: {
      From: Deno.env.get("POSTMARK_FROM_EMAIL") || "hello@flockfront.com",
      To: recipient,
      Subject: rendered.subject,
      HtmlBody: rendered.html,
      TextBody: rendered.text,
      MessageStream: Deno.env.get("POSTMARK_MESSAGE_STREAM") || "outbound",
      Tag: `webinar-${item.email_type}`,
      Metadata: { registration_id: item.registration_id, email_type: item.email_type },
    },
  });
}
