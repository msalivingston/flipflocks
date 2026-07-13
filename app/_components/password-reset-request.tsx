"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

type PasswordResetSource = "admin" | "seller";

const returnPathStorageKey = "flockfront-password-reset-return-path";
const trustedReturnPaths: Record<PasswordResetSource, "/admin/login" | "/login"> =
  {
    admin: "/admin/login",
    seller: "/login",
  };

export function PasswordResetRequest({
  currentEmail,
  source,
  tone = "seller",
}: {
  currentEmail: string;
  source: PasswordResetSource;
  tone?: "admin" | "seller";
}) {
  const [fallbackEmail, setFallbackEmail] = useState("");
  const [showEmailField, setShowEmailField] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  async function sendResetEmail() {
    const email = (currentEmail.trim() || fallbackEmail.trim()).toLowerCase();

    setMessage(null);
    setError(null);

    if (!email) {
      setShowEmailField(true);
      setError("Enter your email address to request a password reset.");
      return;
    }

    if (!email.includes("@")) {
      setShowEmailField(true);
      setError("Enter a valid email address.");
      return;
    }

    setIsSending(true);

    try {
      window.localStorage.setItem(returnPathStorageKey, trustedReturnPaths[source]);
    } catch {
      // The reset still works if local storage is unavailable.
    }

    const redirectTo = `${window.location.origin}/reset-password`;

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email,
      {
        redirectTo,
      },
    );

    if (resetError) {
      setError(friendlyResetError(resetError.message));
      setIsSending(false);
      return;
    }

    setMessage("Check your email for a password reset link.");
    setShowEmailField(false);
    setIsSending(false);
  }

  return (
    <div className="grid gap-2">
      <button
        className={`w-fit text-sm font-bold underline-offset-4 hover:underline ${
          tone === "admin" ? "text-emerald-900" : "text-[#246f38]"
        }`}
        disabled={isSending}
        onClick={() => void sendResetEmail()}
        type="button"
      >
        {isSending ? "Sending reset link..." : "Forgot password?"}
      </button>

      {showEmailField && !currentEmail.trim() ? (
        <div className="grid gap-2">
          <label
            className="text-xs font-bold text-stone-700"
            htmlFor={`${source}-reset-email`}
          >
            Email address
          </label>
          <input
            autoComplete="email"
            className="min-h-10 rounded-md border border-stone-300 bg-white px-3 text-sm font-medium text-stone-950 shadow-sm outline-none transition placeholder:text-stone-400 focus:border-emerald-800 focus:ring-2 focus:ring-emerald-800/20"
            id={`${source}-reset-email`}
            inputMode="email"
            onChange={(event) => setFallbackEmail(event.target.value)}
            type="email"
            value={fallbackEmail}
          />
          <button
            className="seller-small-button w-fit"
            disabled={isSending}
            onClick={() => void sendResetEmail()}
            type="button"
          >
            Send reset link
          </button>
        </div>
      ) : null}

      {message ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold leading-6 text-emerald-900">
          {message}
        </p>
      ) : null}

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold leading-6 text-red-800">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function getStoredPasswordResetReturnPath() {
  if (typeof window === "undefined") return "/login";

  try {
    const storedPath = window.localStorage.getItem(returnPathStorageKey);
    if (storedPath === "/admin/login" || storedPath === "/login") {
      return storedPath;
    }
  } catch {
    return "/login";
  }

  return "/login";
}

export function clearStoredPasswordResetReturnPath() {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.removeItem(returnPathStorageKey);
  } catch {
    // Nothing to clear.
  }
}

function friendlyResetError(message: string) {
  const normalized = message.toLowerCase();

  if (normalized.includes("rate limit") || normalized.includes("too many")) {
    return "Too many reset requests. Please wait a bit and try again.";
  }

  if (normalized.includes("invalid")) {
    return "We could not send a reset link. Please check the email address and try again.";
  }

  return message || "We could not send a reset link. Please try again.";
}
