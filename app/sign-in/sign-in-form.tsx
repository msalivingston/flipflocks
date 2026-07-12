"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { isCurrentUserPlatformAdmin } from "@/app/admin/_lib/admin-auth";
import type { SellerContext } from "@/app/dashboard/_lib/seller-types";

type OnboardingState = {
  onboarding_complete: boolean | null;
};

export function SignInForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextError = validateSignIn({ email, password });

    if (nextError) {
      setError(nextError);
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

    const nextPath = await getPostSignInPath();
    router.replace(nextPath);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#fffaf1] px-4 py-8 text-[#10281c] sm:px-6">
      <section className="w-full max-w-[460px] rounded-2xl border border-[#e8deca] bg-white px-5 py-7 shadow-[0_18px_48px_rgba(66,49,24,0.08)] sm:px-8 sm:py-8">
        <div className="text-center">
          <Link
            href="/"
            className="mx-auto inline-flex rounded-md focus:outline-none focus:ring-2 focus:ring-[#246f38] focus:ring-offset-4"
          >
            <Image
              src="/branding/flockfront-logo.png"
              alt="FlockFront"
              width={210}
              height={70}
              priority
              className="h-auto w-[188px] mix-blend-multiply sm:w-[210px]"
            />
          </Link>
          <h1 className="mt-5 font-serif text-3xl font-semibold leading-tight text-stone-950 sm:text-[2.15rem]">
            Welcome back
          </h1>
          <p className="mt-2 text-base font-medium leading-7 text-stone-600">
            Sign in to manage your flock, inventory, orders, and storefront.
          </p>
        </div>

        <form className="mt-6 space-y-4" onSubmit={handleLogin} noValidate>
          <div>
            <label
              className="text-sm font-bold text-stone-950"
              htmlFor="sign-in-email"
            >
              Email
            </label>
            <input
              autoComplete="email"
              className="mt-1 min-h-12 w-full rounded-lg border border-stone-300 bg-white px-3 text-base font-medium text-stone-950 shadow-sm outline-none transition placeholder:text-stone-400 focus:border-[#246f38] focus:ring-2 focus:ring-[#246f38]/25"
              disabled={isSubmitting}
              id="sign-in-email"
              inputMode="email"
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              value={email}
            />
          </div>

          <div>
            <div className="flex items-center justify-between gap-3">
              <label
                className="text-sm font-bold text-stone-950"
                htmlFor="sign-in-password"
              >
                Password
              </label>
              <Link
                className="text-sm font-bold text-[#246f38] underline-offset-4 hover:underline"
                href="#"
              >
                Forgot password?
              </Link>
            </div>
            <input
              autoComplete="current-password"
              className="mt-1 min-h-12 w-full rounded-lg border border-stone-300 bg-white px-3 text-base font-medium text-stone-950 shadow-sm outline-none transition placeholder:text-stone-400 focus:border-[#246f38] focus:ring-2 focus:ring-[#246f38]/25"
              disabled={isSubmitting}
              id="sign-in-password"
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              value={password}
            />
          </div>

          {error ? (
            <p
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold leading-6 text-red-800"
              role="alert"
            >
              {error}
            </p>
          ) : null}

          <button
            className="flex min-h-12 w-full items-center justify-center rounded-lg bg-[#246f38] px-5 text-base font-bold text-white shadow-sm transition hover:bg-[#1c5c2d] focus:outline-none focus:ring-2 focus:ring-[#246f38] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <div className="mt-6 border-t border-stone-200 pt-5 text-center">
          <p className="text-sm font-medium text-stone-600">
            New to FlockFront?{" "}
            <Link
              className="font-bold text-[#246f38] underline-offset-4 hover:underline"
              href="/signup"
            >
              Create your farm storefront
            </Link>
          </p>
          <p className="mt-4 text-xs font-medium leading-5 text-stone-500">
            Built for small poultry farms, hatcheries, and local pickup sales.
          </p>
        </div>
      </section>
    </main>
  );
}

function validateSignIn({
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

async function getPostSignInPath() {
  const { data, error } = await supabase.rpc("get_seller_context");
  const isPlatformAdmin = await isCurrentUserPlatformAdmin();

  if (error) {
    if (isPlatformAdmin) return "/admin";
    return "/onboarding";
  }

  const rows = Array.isArray(data) ? (data as SellerContext[]) : [];
  const primarySeller = rows[0] ?? null;

  if (!primarySeller && isPlatformAdmin) {
    return "/admin";
  }

  if (!primarySeller?.store_id || !primarySeller.profile_complete) {
    return "/onboarding";
  }

  if (
    primarySeller.ready_to_launch ||
    primarySeller.first_listing_created ||
    primarySeller.launched_at
  ) {
    return "/dashboard";
  }

  const { data: onboardingState, error: onboardingError } = await supabase
    .from("seller_onboarding_state")
    .select("onboarding_complete")
    .eq("store_id", primarySeller.store_id)
    .maybeSingle<OnboardingState>();

  if (onboardingError) {
    return "/onboarding";
  }

  return onboardingState?.onboarding_complete ? "/dashboard" : "/onboarding";
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
