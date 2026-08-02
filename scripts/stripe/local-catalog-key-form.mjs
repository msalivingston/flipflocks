import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { promisify } from "node:util";

import { StripeSaasError } from "../../supabase/functions/_shared/stripe-saas-runtime.mjs";

const execFileAsync = promisify(execFile);
const LOOPBACK_HOST = "127.0.0.1";
const DEFAULT_EXPIRATION_MS = 2 * 60 * 1000;
const MAX_BODY_BYTES = 16 * 1024;

const SECURITY_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Content-Type": "text/html; charset=utf-8",
});

function formError(code, message) {
  return new StripeSaasError(code, message);
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function pageStart(title) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font-family:system-ui,sans-serif;max-width:760px;margin:48px auto;padding:0 20px;color:#172016}main{border:1px solid #ccd5ca;border-radius:12px;padding:24px}label{display:block;font-weight:650;margin:20px 0 8px}input{box-sizing:border-box;width:100%;font:inherit;padding:10px}button{font:inherit;font-weight:650;margin-top:16px;padding:10px 18px}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{text-align:left;padding:8px;border-bottom:1px solid #dfe5dd}.pass{color:#176b32}.fail{color:#a32626}</style></head><body><main><h1>${escapeHtml(title)}</h1>`;
}

function formPage(pathname, apply) {
  const applyFields = apply
    ? '<label for="supabase-url">Supabase project URL</label><input id="supabase-url" name="supabase_url" type="url" required inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://project-ref.supabase.co"><label for="supabase-service-role-key">Supabase service-role key</label><input id="supabase-service-role-key" name="supabase_service_role_key" type="password" required autocomplete="off" spellcheck="false">'
    : "";
  const action = apply ? "Verify and register" : "Verify";
  const purpose = apply
    ? "verify and register the four approved sandbox Prices"
    : "verify the four approved sandbox Prices";
  return `${pageStart("Verify FlockFront Stripe Catalog")}<p>Enter the restricted Stripe test key to ${purpose}.</p><p>The submitted values remain on this computer, are held only in memory, and are not saved.</p><form method="post" action="${escapeHtml(pathname)}" autocomplete="off"><label for="stripe-key">Stripe restricted test key</label><input id="stripe-key" name="stripe_key" type="password" required pattern="rk_test_[A-Za-z0-9]+" autocomplete="off" spellcheck="false">${applyFields}<button type="submit">${action}</button></form></main></body></html>`;
}

function errorPage(message) {
  return `${pageStart("Verification could not start")}<p>${escapeHtml(message)}</p><p>Close this tab and run the command again.</p></main></body></html>`;
}

function progressStart() {
  return `${pageStart("Verify FlockFront Stripe Catalog")}<p>Verification in progress…</p><table><thead><tr><th>Catalog entry</th><th>Stripe Price</th><th>Result</th></tr></thead><tbody>`;
}

function progressRow(result) {
  const status = result.status === "PASS" ? "PASS" : `FAIL (${result.failureCode})`;
  const className = result.status === "PASS" ? "pass" : "fail";
  return `<tr><td>${escapeHtml(result.label)}</td><td>${escapeHtml(result.stripePriceId)}</td><td class="${className}">${escapeHtml(status)}</td></tr>`;
}

function progressEnd(result, apply) {
  const message = result.passed
    ? (apply && result.applied
      ? "All four approved sandbox Prices passed and were registered."
      : "All four approved sandbox Prices passed.")
    : "One or more approved sandbox Prices failed. Nothing was registered.";
  return `</tbody></table><p><strong>${escapeHtml(message)}</strong></p><p>You may close this tab.</p></main></body></html>`;
}

export function validateSupabaseProjectUrl(value) {
  const supplied = String(value ?? "").trim();
  let parsed;
  try {
    parsed = new URL(supplied);
  } catch {
    throw formError(
      "STRIPE_SAAS_LOCAL_FORM_SUPABASE_URL_INVALID",
      "Enter a valid HTTPS Supabase project URL.",
    );
  }
  if (parsed.protocol !== "https:"
    || !/^[a-z0-9][a-z0-9-]*\.supabase\.co$/i.test(parsed.hostname)
    || parsed.username
    || parsed.password
    || parsed.port
    || (parsed.pathname !== "/" && parsed.pathname !== "")
    || parsed.search
    || parsed.hash) {
    throw formError(
      "STRIPE_SAAS_LOCAL_FORM_SUPABASE_URL_INVALID",
      "Enter a valid HTTPS Supabase project URL.",
    );
  }
  return parsed.origin;
}

async function readRequestBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      throw formError(
        "STRIPE_SAAS_LOCAL_FORM_BODY_TOO_LARGE",
        "The local verification form submission was too large.",
      );
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function openDefaultBrowser(url, {
  platform = process.platform,
  execute = (file, argumentsList, options) => execFileAsync(file, argumentsList, options),
} = {}) {
  const options = { windowsHide: true, timeout: 10_000 };
  if (platform === "win32") {
    await execute("rundll32.exe", ["url.dll,FileProtocolHandler", url], options);
    return;
  }
  if (platform === "darwin") {
    await execute("open", [url], options);
    return;
  }
  await execute("xdg-open", [url], options);
}

export async function runLocalCatalogVerificationForm({
  apply = false,
  runOperation,
  openBrowser = openDefaultBrowser,
  expirationMs = DEFAULT_EXPIRATION_MS,
  randomBytesFn = randomBytes,
  createServerFn = createServer,
  onListening = () => {},
}) {
  const token = randomBytesFn(32).toString("hex");
  let activePath = `/verify/${token}`;
  let consumed = false;
  let server;
  let expiration;

  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(expiration);
      if (error) reject(error);
      else resolve(result);
    };
    const closeServer = () => {
      if (server?.listening) server.close();
    };

    server = createServerFn(async (request, response) => {
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      const address = server.address();
      const expectedHost = `${LOOPBACK_HOST}:${address.port}`;
      if (request.headers.host !== expectedHost || pathname !== activePath) {
        response.writeHead(404, SECURITY_HEADERS);
        response.end(errorPage("This local verification link is invalid or expired."));
        return;
      }
      if (request.method === "GET" && !consumed) {
        response.writeHead(200, SECURITY_HEADERS);
        response.end(formPage(activePath, apply));
        return;
      }
      if (request.method !== "POST") {
        response.writeHead(405, { ...SECURITY_HEADERS, Allow: "GET, POST" });
        response.end(errorPage("Only the local verification form may submit the key."));
        return;
      }
      if (consumed) {
        response.writeHead(410, SECURITY_HEADERS);
        response.end(errorPage("This local verification form has already been used."));
        return;
      }

      consumed = true;
      activePath = null;
      clearTimeout(expiration);
      closeServer();

      const credentials = {
        catalogReadKey: null,
        supabaseUrl: null,
        supabaseServiceRoleKey: null,
      };
      try {
        if (!request.headers["content-type"]?.startsWith("application/x-www-form-urlencoded")) {
          throw formError(
            "STRIPE_SAAS_LOCAL_FORM_CONTENT_TYPE_INVALID",
            "The local verification form submission type was invalid.",
          );
        }
        const body = await readRequestBody(request);
        const values = new URLSearchParams(body);
        credentials.catalogReadKey = (values.get("stripe_key") ?? "").trim();
        if (!/^rk_test_[A-Za-z0-9]+$/.test(credentials.catalogReadKey)) {
          throw formError(
            "STRIPE_SAAS_LOCAL_FORM_KEY_INVALID",
            "The submitted value was not a valid Stripe restricted test key.",
          );
        }
        if (apply) {
          credentials.supabaseUrl = validateSupabaseProjectUrl(values.get("supabase_url"));
          credentials.supabaseServiceRoleKey = (values.get("supabase_service_role_key") ?? "").trim();
          if (!credentials.supabaseServiceRoleKey) {
            throw formError(
              "STRIPE_SAAS_LOCAL_FORM_SUPABASE_SERVICE_ROLE_KEY_MISSING",
              "A Supabase service-role key is required for apply mode.",
            );
          }
        }
      } catch (error) {
        const safeError = error instanceof StripeSaasError
          ? error
          : formError("STRIPE_SAAS_LOCAL_FORM_SUBMISSION_INVALID", "The local verification form submission was invalid.");
        response.writeHead(400, SECURITY_HEADERS);
        response.end(errorPage(safeError.message));
        settle(safeError);
        return;
      }

      response.writeHead(200, SECURITY_HEADERS);
      response.write(progressStart());
      try {
        const result = await runOperation(credentials, (entryResult) => {
          response.write(progressRow(entryResult));
        });
        response.end(progressEnd(result, apply));
        settle(null, result);
      } catch {
        const error = formError(
          "STRIPE_SAAS_LOCAL_FORM_VERIFICATION_FAILED",
          "Catalog verification could not be completed.",
        );
        response.end(progressEnd({ passed: false }, apply));
        settle(error);
      } finally {
        credentials.catalogReadKey = null;
        credentials.supabaseUrl = null;
        credentials.supabaseServiceRoleKey = null;
      }
    });

    server.once("error", () => {
      closeServer();
      settle(formError(
        "STRIPE_SAAS_LOCAL_FORM_SERVER_FAILED",
        "The temporary local verification server could not start.",
      ));
    });
    server.listen(0, LOOPBACK_HOST, async () => {
      const address = server.address();
      const url = `http://${LOOPBACK_HOST}:${address.port}${activePath}`;
      onListening(Object.freeze({ host: LOOPBACK_HOST, port: address.port, token, url }));
      expiration = setTimeout(() => {
        activePath = null;
        closeServer();
        settle(formError(
          "STRIPE_SAAS_LOCAL_FORM_EXPIRED",
          "The temporary local verification form expired.",
        ));
      }, expirationMs);
      try {
        await openBrowser(url);
      } catch {
        activePath = null;
        closeServer();
        settle(formError(
          "STRIPE_SAAS_LOCAL_FORM_BROWSER_FAILED",
          "The default browser could not be opened for local catalog verification.",
        ));
      }
    });
  });
}
