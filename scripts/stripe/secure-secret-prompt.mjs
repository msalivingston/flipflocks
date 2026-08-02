import { StripeSaasError } from "../../supabase/functions/_shared/stripe-saas-runtime.mjs";

const PROMPT = "Paste Stripe restricted test key: ";

function promptError(code, message) {
  return new StripeSaasError(code, message);
}

// Reads one terminal line without echoing any input. The secret is retained only
// in this function's process memory and is never copied to argv, env, or disk.
export function readHiddenTerminalLine({
  input = process.stdin,
  output = process.stderr,
  prompt = PROMPT,
} = {}) {
  if (!input?.isTTY || typeof input.setRawMode !== "function" || !output?.isTTY) {
    return Promise.reject(promptError(
      "STRIPE_SAAS_UTILITY_INTERACTIVE_KEY_REQUIRED",
      "STRIPE_SAAS_CATALOG_READ_KEY is missing and no interactive terminal is available.",
    ));
  }

  return new Promise((resolve, reject) => {
    const priorRawMode = Boolean(input.isRaw);
    const wasPaused = typeof input.isPaused === "function" ? input.isPaused() : false;
    let value = "";
    let settled = false;
    let rawModeChanged = false;

    const cleanup = () => {
      input.removeListener("data", onData);
      input.removeListener("error", onError);
      input.removeListener("end", onEnd);
      if (rawModeChanged) {
        try { input.setRawMode(priorRawMode); } catch { /* terminal is already closing */ }
      }
      if (wasPaused && typeof input.pause === "function") input.pause();
      try { output.write("\n"); } catch { /* output is already closing */ }
    };

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(result);
    };

    function onError() {
      finish(promptError(
        "STRIPE_SAAS_UTILITY_SECRET_INPUT_FAILED",
        "The restricted key could not be read from the terminal.",
      ));
    }

    function onEnd() {
      finish(promptError(
        "STRIPE_SAAS_UTILITY_SECRET_INPUT_ENDED",
        "Terminal input ended before a restricted key was received.",
      ));
    }

    function onData(chunk) {
      for (const character of String(chunk)) {
        if (character === "\u0003") {
          finish(promptError(
            "STRIPE_SAAS_UTILITY_SECRET_INPUT_INTERRUPTED",
            "Restricted-key entry was canceled.",
          ));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish(null, value);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = Array.from(value).slice(0, -1).join("");
          continue;
        }
        value += character;
      }
    }

    try {
      output.write(prompt);
      input.setRawMode(true);
      rawModeChanged = true;
      input.on("data", onData);
      input.once("error", onError);
      input.once("end", onEnd);
      if (typeof input.resume === "function") input.resume();
    } catch {
      finish(promptError(
        "STRIPE_SAAS_UTILITY_SECRET_INPUT_FAILED",
        "The restricted key prompt could not initialize the terminal.",
      ));
    }
  });
}

export function promptForStripeRestrictedTestKey(options) {
  return readHiddenTerminalLine(options);
}

