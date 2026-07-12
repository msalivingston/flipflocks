"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { isCurrentUserPlatformAdmin } from "../_lib/admin-auth";

const adminOnlyMessage = "This login is for platform administrators only.";

export function AdminLoginForm({ initialError }: { initialError?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const validationError = validateAdminSignIn({ email, password });
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setIsSubmitting(true);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      setError(friendlySignInError(signInError.message));
      setIsSubmitting(false);
      return;
    }

    const isAdmin = await isCurrentUserPlatformAdmin();

    if (!isAdmin) {
      await supabase.auth.signOut();
      setError(adminOnlyMessage);
      setIsSubmitting(false);
      return;
    }

    router.replace("/admin");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f3f4f1] px-4 py-8 text-stone-950 sm:px-6">
      <section className="w-full max-w-[460px] rounded-lg border border-stone-300 bg-white px-5 py-7 shadow-[0_18px_48px_rgba(31,41,36,0.12)] sm:px-8 sm:py-8">
        <div className="text-center">
          <Link
            href="/"
            className="mx-auto inline-flex rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-900 focus:ring-offset-4"
          >
            <Image
              src="/branding/flockfront-logo.png"
              alt="FlockFront"
              width={196}
              height={65}
              priority
              className="h-auto w-[176px] mix-blend-multiply sm:w-[196px]"
            />
          </Link>
          <p className="mt-5 text-xs font-bold uppercase tracking-[0.14em] text-emerald-900">
            FlockFront Platform Admin
          </p>
          <h1 className="mt-2 text-2xl font-bold leading-tight text-stone-950 sm:text-3xl">
            Admin sign in
          </h1>
        </div>

        <form className="mt-6 space-y-4" onSubmit={handleLogin} noValidate>
          <div>
            <label
              className="text-sm font-bold text-stone-950"
              htmlFor="admin-sign-in-email"
            >
              Email
            </label>
            <input
              autoComplete="email"
              className="mt-1 min-h-12 w-full rounded-md border border-stone-300 bg-white px-3 text-base font-medium text-stone-950 shadow-sm outline-none transition placeholder:text-stone-400 focus:border-emerald-900 focus:ring-2 focus:ring-emerald-900/20"
              disabled={isSubmitting}
              id="admin-sign-in-email"
              inputMode="email"
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              value={email}
            />
          </div>

          <div>
            <label
              className="text-sm font-bold text-stone-950"
              htmlFor="admin-sign-in-password"
            >
              Password
            </label>
            <input
              autoComplete="current-password"
              className="mt-1 min-h-12 w-full rounded-md border border-stone-300 bg-white px-3 text-base font-medium text-stone-950 shadow-sm outline-none transition placeholder:text-stone-400 focus:border-emerald-900 focus:ring-2 focus:ring-emerald-900/20"
              disabled={isSubmitting}
              id="admin-sign-in-password"
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              value={password}
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
            className="flex min-h-12 w-full items-center justify-center rounded-md bg-emerald-950 px-5 text-base font-bold text-white shadow-sm transition hover:bg-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-950 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? "Signing in..." : "Sign in as platform admin"}
          </button>
        </form>

        <div className="mt-6 border-t border-stone-200 pt-5 text-center">
          <Link
            className="text-sm font-bold text-emerald-900 underline-offset-4 hover:underline"
            href="/login"
          >
            Seller login
          </Link>
        </div>
      </section>
    </main>
  );
}

function validateAdminSignIn({
  email,
  password,
}: {
  email: string;
  password: string;
}) {
  if (!email.trim()) return "Enter your email address.";
  if (!email.includes("@")) return "Enter a valid email address.";
  if (!password) return "Enter your password.";

  return null;
}

function friendlySignInError(message: string) {
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes("invalid login credentials")) {
    return "We could not sign you in with that email and password.";
  }

  if (lowerMessage.includes("email not confirmed")) {
    return "Please confirm your email address before signing in.";
  }

  return message || "We could not sign you in. Please try again.";
}
