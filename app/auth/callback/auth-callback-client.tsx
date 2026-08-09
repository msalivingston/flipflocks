"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { OnboardingShell } from "@/app/onboarding/_components/onboarding-shell";
import {
  authCallbackError,
  hasBrowserAuthRecoverySignal,
  waitForBrowserAuthSession,
} from "@/lib/auth-email-verification";
import { supabase } from "@/lib/supabase";

type CallbackState = "checking" | "error";

export function AuthCallbackClient() {
  const router = useRouter();
  const [state, setState] = useState<CallbackState>("checking");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function recoverSession() {
      const linkError = authCallbackError(window.location);
      if (linkError) {
        if (!isMounted) return;
        setErrorMessage(linkError);
        setState("error");
        return;
      }

      const hasRecoverySignal = hasBrowserAuthRecoverySignal(window.location);
      const result = await waitForBrowserAuthSession(supabase.auth, {
        hasRecoverySignal,
      });
      if (!isMounted) return;

      if (result.error || !result.session) {
        setErrorMessage(
          hasRecoverySignal
            ? "This verification link has expired or has already been used. Request a new verification email and try again."
            : "This verification link is missing or malformed. Request a new verification email and try again.",
        );
        setState("error");
        return;
      }

      const { data, error } = await supabase.auth.getUser();
      if (!isMounted) return;
      if (error || !data.user) {
        setErrorMessage(
          "We could not verify this session. Request a new verification email and try again.",
        );
        setState("error");
        return;
      }

      router.replace("/onboarding");
    }

    void recoverSession();
    return () => {
      isMounted = false;
    };
  }, [router]);

  return (
    <OnboardingShell
      body={
        state === "checking"
          ? "We are securely finishing your account verification."
          : "The link could not be completed, but you can safely request another one."
      }
      compactOnMobile
      currentStep={1}
      headline={state === "checking" ? "Verifying your email" : "Verification link problem"}
      subhead={state === "checking" ? "One moment" : "Your account is safe"}
    >
      <section className="rounded-[0.95rem] bg-white px-4 py-5 shadow-[0_8px_24px_rgba(45,35,20,0.09)] ring-1 ring-stone-200/80 sm:px-6 sm:py-6 lg:px-8 lg:py-6">
        {state === "checking" ? (
          <div aria-live="polite" className="space-y-3">
            <h2 className="font-serif text-[1.55rem] font-semibold leading-tight text-stone-950 sm:text-[1.8rem]">
              Finishing verification
            </h2>
            <p className="rounded-lg border border-[#dbe8d8] bg-[#fffaf1] px-3 py-3 text-sm font-semibold leading-6 text-stone-700">
              Please keep this page open while FlockFront restores your secure session.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <h2 className="font-serif text-[1.55rem] font-semibold leading-tight text-stone-950 sm:text-[1.8rem]">
              We couldn&apos;t verify that link
            </h2>
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm font-semibold leading-6 text-amber-950" role="alert">
              {errorMessage}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Link
                className="flex min-h-12 items-center justify-center rounded-md bg-[#246f38] px-4 text-center text-base font-bold text-white shadow-sm transition hover:bg-[#1c5c2d] focus:outline-none focus:ring-2 focus:ring-[#246f38] focus:ring-offset-2 sm:min-h-10 sm:text-[15px]"
                href="/signup?resend=1"
              >
                Resend verification
              </Link>
              <Link
                className="flex min-h-12 items-center justify-center rounded-md border border-stone-300 bg-white px-4 text-center text-base font-bold text-[#1f6f38] shadow-sm transition hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-[#246f38] focus:ring-offset-2 sm:min-h-10 sm:text-[15px]"
                href="/login"
              >
                Sign in
              </Link>
            </div>
            <p className="text-center text-sm font-medium text-stone-600">
              Need to start over?{" "}
              <Link className="font-bold text-[#1f6f38] underline underline-offset-2" href="/signup">
                Return to signup
              </Link>
            </p>
          </div>
        )}
      </section>
    </OnboardingShell>
  );
}
