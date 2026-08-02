import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { StripeSaasError } from "../../supabase/functions/_shared/stripe-saas-runtime.mjs";

const execFileAsync = promisify(execFile);
const POWERSHELL_OPTIONS = Object.freeze({
  encoding: "utf8",
  timeout: 10_000,
  windowsHide: true,
  maxBuffer: 16_384,
});
const READ_ARGUMENTS = Object.freeze([
  "-NoProfile", "-NonInteractive", "-Command", "Get-Clipboard -Raw",
]);
const CLEAR_ARGUMENTS = Object.freeze([
  "-NoProfile", "-NonInteractive", "-Command", "Set-Clipboard -Value ([string]::Empty)",
]);

function clipboardError(code, message) {
  return new StripeSaasError(code, message);
}

export async function readWindowsClipboardRestrictedTestKey({
  platform = process.platform,
  runPowerShell = (argumentsList) => execFileAsync(
    "powershell.exe",
    argumentsList,
    POWERSHELL_OPTIONS,
  ),
} = {}) {
  if (platform !== "win32") {
    throw clipboardError(
      "STRIPE_SAAS_UTILITY_CLIPBOARD_UNSUPPORTED",
      "--key-from-clipboard is supported only on Windows.",
    );
  }

  let stdout;
  try {
    ({ stdout } = await runPowerShell(READ_ARGUMENTS));
  } catch {
    throw clipboardError(
      "STRIPE_SAAS_UTILITY_CLIPBOARD_READ_FAILED",
      "The Stripe restricted test key could not be read from the Windows clipboard.",
    );
  }

  // Clear immediately after capture, before validation or any provider activity.
  try {
    await runPowerShell(CLEAR_ARGUMENTS);
  } catch {
    throw clipboardError(
      "STRIPE_SAAS_UTILITY_CLIPBOARD_CLEAR_FAILED",
      "The Windows clipboard could not be cleared after reading the restricted key.",
    );
  }

  const catalogReadKey = String(stdout ?? "").replace(/(?:\r\n|\r|\n)/g, "").trim();
  if (!catalogReadKey) {
    throw clipboardError(
      "STRIPE_SAAS_UTILITY_CLIPBOARD_EMPTY",
      "The Windows clipboard did not contain a Stripe restricted test key.",
    );
  }
  if (!/^rk_test_[A-Za-z0-9]+$/.test(catalogReadKey)) {
    throw clipboardError(
      "STRIPE_SAAS_UTILITY_CLIPBOARD_KEY_INVALID",
      "The Windows clipboard did not contain a valid rk_test_ restricted key.",
    );
  }
  return catalogReadKey;
}
