"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  clearStoredPasswordResetReturnPath,
  getStoredPasswordResetReturnPath,
} from "@/app/_components/password-reset-request";
import { supabase } from "@/lib/supabase";

type ResetState = "checking" | "ready" | "expired" | "success";

export function ResetPasswordForm() {
  const [resetState, setResetState] = useState<ResetState>("checking");
  const [returnPath, setReturnPath] = useState<"/admin/login" | "/login">(
    "/login",
  );
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let isMounted = true;
    let recoveryEventReceived = false;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (!isMounted) return;

      if (event === "PASSWORD_RECOVERY") {
        recoveryEventReceived = true;
        setResetState("ready");
      }
    });

    async function checkRecoverySession() {
      const { data } = await supabase.auth.getSession();
      if (!isMounted || recoveryEventReceived) return;

      setReturnPath(getStoredPasswordResetReturnPath());

      if (data.session && hasRecoveryUrlSignal()) {
        setResetState("ready");
        return;
      }

      window.setTimeout(async () => {
        if (!isMounted || recoveryEventReceived) return;

        const { data: retryData } = await supabase.auth.getSession();
        if (!isMounted || recoveryEventReceived) return;

        setResetState(
          retryData.session && hasRecoveryUrlSignal() ? "ready" : "expired",
        );
      }, 900);
    }

    void checkRecoverySession();

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const validationError = validatePasswordReset({
      confirmPassword,
      password,
    });

    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setIsSubmitting(true);

    const { error: updateError } = await supabase.auth.updateUser({
      password,
    });

    if (updateError) {
      setError(friendlyUpdateError(updateError.message));
      setIsSubmitting(false);
      return;
    }

    await supabase.auth.signOut();
    clearStoredPasswordResetReturnPath();
    setResetState("success");
    setIsSubmitting(false);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#fffaf1] px-4 py-8 text-stone-950 sm:px-6">
      <section className="w-full max-w-[460px] rounded-lg border border-stone-200 bg-white px-5 py-7 shadow-[0_18px_48px_rgba(66,49,24,0.08)] sm:px-8 sm:py-8">
        <div className="text-center">
          <Link
            href="/"
            className="mx-auto inline-flex rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-800 focus:ring-offset-4"
          >
            <Image
              src="/branding/flockfront-logo-final.png"
              alt="FlockFront"
              width={196}
              height={65}
              priority
              className="h-auto w-[176px] mix-blend-multiply sm:w-[196px]"
            />
          </Link>
          <h1 className="mt-5 text-2xl font-bold leading-tight text-stone-950 sm:text-3xl">
            Reset your password
          </h1>
        </div>

        {resetState === "checking" ? (
          <p className="mt-6 rounded-md border border-stone-200 bg-stone-50 px-3 py-3 text-sm font-semibold text-stone-600">
            Checking your reset link...
          </p>
        ) : null}

        {resetState === "expired" ? (
          <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm leading-6 text-amber-950">
            <p className="font-semibold">
              This password reset link is missing or expired.
            </p>
            <Link
              className="mt-2 inline-block font-bold text-amber-950 underline-offset-4 hover:underline"
              href={returnPath}
            >
              Request another reset link
            </Link>
          </div>
        ) : null}

        {resetState === "success" ? (
          <div className="mt-6 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm leading-6 text-emerald-950">
            <p className="font-semibold">Your password has been updated.</p>
            <Link
              className="mt-2 inline-block font-bold text-emerald-950 underline-offset-4 hover:underline"
              href={returnPath}
            >
              Return to sign in
            </Link>
          </div>
        ) : null}

        {resetState === "ready" ? (
          <form className="mt-6 space-y-4" onSubmit={handleSubmit} noValidate>
            <div>
              <label
                className="text-sm font-bold text-stone-950"
                htmlFor="new-password"
              >
                New password
              </label>
              <input
                autoComplete="new-password"
                className="mt-1 min-h-12 w-full rounded-md border border-stone-300 bg-white px-3 text-base font-medium text-stone-950 shadow-sm outline-none transition placeholder:text-stone-400 focus:border-emerald-800 focus:ring-2 focus:ring-emerald-800/20"
                disabled={isSubmitting}
                id="new-password"
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                value={password}
              />
            </div>

            <div>
              <label
                className="text-sm font-bold text-stone-950"
                htmlFor="confirm-new-password"
              >
                Confirm new password
              </label>
              <input
                autoComplete="new-password"
                className="mt-1 min-h-12 w-full rounded-md border border-stone-300 bg-white px-3 text-base font-medium text-stone-950 shadow-sm outline-none transition placeholder:text-stone-400 focus:border-emerald-800 focus:ring-2 focus:ring-emerald-800/20"
                disabled={isSubmitting}
                id="confirm-new-password"
                onChange={(event) => setConfirmPassword(event.target.value)}
                type="password"
                value={confirmPassword}
              />
            </div>

            {error ? (
              <p
                className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold leading-6 text-red-800"
                role="alert"
              >
                {error}
              </p>
            ) : null}

            <button
              className="flex min-h-12 w-full items-center justify-center rounded-md bg-emerald-900 px-5 text-base font-bold text-white shadow-sm transition hover:bg-emerald-950 focus:outline-none focus:ring-2 focus:ring-emerald-900 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
              disabled={isSubmitting}
              type="submit"
            >
              {isSubmitting ? "Updating password..." : "Update password"}
            </button>
          </form>
        ) : null}
      </section>
    </main>
  );
}

function hasRecoveryUrlSignal() {
  if (typeof window === "undefined") return false;

  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const searchParams = new URLSearchParams(window.location.search);

  return (
    hashParams.get("type") === "recovery" ||
    searchParams.get("type") === "recovery" ||
    searchParams.has("code")
  );
}

function validatePasswordReset({
  confirmPassword,
  password,
}: {
  confirmPassword: string;
  password: string;
}) {
  if (!password) return "Enter a new password.";
  if (password.length < 8) return "Use at least 8 characters.";
  if (password !== confirmPassword) return "Passwords do not match.";

  return null;
}

function friendlyUpdateError(message: string) {
  const normalized = message.toLowerCase();

  if (normalized.includes("expired") || normalized.includes("session")) {
    return "This reset session has expired. Please request another reset link.";
  }

  if (normalized.includes("password")) {
    return "That password could not be saved. Please choose a different password.";
  }

  return message || "We could not update your password. Please try again.";
}
