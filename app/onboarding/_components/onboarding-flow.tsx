"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { SellerContext } from "@/app/dashboard/_lib/seller-types";
import { OnboardingShell } from "./onboarding-shell";
import { Step2FarmBasicsForm } from "./step-2-farm-basics-form";
import { Step3SellingCategoriesForm } from "./step-3-selling-categories-form";
import { Step4PickupInstructionsForm } from "./step-4-pickup-instructions-form";

type OnboardingView =
  | "loading"
  | "redirecting"
  | "step2"
  | "step3"
  | "step4"
  | "step5";

type OnboardingProgress = {
  categories_complete: boolean | null;
  pickup_complete: boolean | null;
};

type StorePickupSettings = {
  buyer_contact_email_enabled: boolean | null;
  buyer_contact_phone_enabled: boolean | null;
  buyer_contact_text_enabled: boolean | null;
  pickup_instructions: string | null;
};

export function OnboardingFlow() {
  const router = useRouter();
  const [view, setView] = useState<OnboardingView>("loading");
  const [seller, setSeller] = useState<SellerContext | null>(null);
  const [pickupSettings, setPickupSettings] =
    useState<StorePickupSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadOnboardingState() {
      setError(null);

      try {
        if (!hasPersistedSupabaseSession()) {
          setView("redirecting");
          router.replace("/login");
          return;
        }

        const { data: sessionData, error: sessionError } = await withTimeout(
          supabase.auth.getSession(),
          8000,
        );

        if (!isMounted) return;

        if (sessionError) {
          setError(sessionError.message);
          setView("step2");
          return;
        }

        if (!sessionData.session) {
          setView("redirecting");
          router.replace("/login");
          return;
        }

        const { data: userData, error: userError } = await withTimeout(
          supabase.auth.getUser(),
          8000,
        );

        if (!isMounted) return;

        if (userError || !userData.user) {
          setView("redirecting");
          router.replace("/login");
          return;
        }

        const { data, error: contextError } = await withTimeout(
          supabase.rpc("get_seller_context"),
          8000,
        );

        if (!isMounted) return;

        if (contextError) {
          setError(friendlyOnboardingError(contextError.message));
          setView("step2");
          return;
        }

        const rows = Array.isArray(data) ? (data as SellerContext[]) : [];
        const primarySeller = rows[0] ?? null;

        setSeller(primarySeller);

        if (!primarySeller?.profile_complete) {
          setView("step2");
          return;
        }

        const { data: progress, error: progressError } = await withTimeout(
          supabase
            .from("seller_onboarding_state")
            .select("categories_complete, pickup_complete")
            .eq("store_id", primarySeller.store_id)
            .maybeSingle(),
          8000,
        );

        if (!isMounted) return;

        if (progressError) {
          setError(friendlyOnboardingError(progressError.message));
          setView("step3");
          return;
        }

        const onboardingProgress = progress as OnboardingProgress | null;

        if (!onboardingProgress?.categories_complete) {
          setView("step3");
          return;
        }

        const { data: pickupData, error: pickupError } = await withTimeout(
          supabase
            .from("stores")
            .select(
              "pickup_instructions, buyer_contact_email_enabled, buyer_contact_text_enabled, buyer_contact_phone_enabled",
            )
            .eq("id", primarySeller.store_id)
            .maybeSingle(),
          8000,
        );

        if (!isMounted) return;

        if (pickupError) {
          setError(friendlyOnboardingError(pickupError.message));
          setView("step4");
          return;
        }

        setPickupSettings((pickupData as StorePickupSettings | null) ?? null);
        setView(onboardingProgress.pickup_complete ? "step5" : "step4");
      } catch {
        if (!isMounted) return;
        setError("We could not load your onboarding setup. Please try again.");
        setView("step2");
      }
    }

    void loadOnboardingState();

    return () => {
      isMounted = false;
    };
  }, [router]);

  if (view === "loading" || view === "redirecting") {
    return (
      <OnboardingShell
        body="We are checking where to pick up your setup."
        currentStep={2}
        headline="Tell us about your farm"
        subhead="Share a few basics so customers can find and connect with you."
      >
        <section className="rounded-[0.95rem] bg-white px-5 py-5 shadow-[0_8px_24px_rgba(45,35,20,0.09)] ring-1 ring-stone-200/80 sm:px-6 sm:py-6 lg:px-7 lg:py-6">
          <p className="text-sm font-bold text-stone-600">
            {view === "redirecting" ? "Taking you to sign in..." : "Loading setup..."}
          </p>
        </section>
      </OnboardingShell>
    );
  }

  if (view === "step3") {
    return (
      <OnboardingShell
        body="Select all that apply. You can change this later."
        currentStep={3}
        headline="What do you plan to sell?"
        subhead="Choose the categories that fit your farm"
      >
        <div className="space-y-3">
          {error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
              {error}
            </p>
          ) : null}
          <Step3SellingCategoriesForm
            initialValues={{
              equipmentSuppliesEnabled: seller?.equipment_supplies_enabled,
              hatchingEggsEnabled: seller?.hatching_eggs_enabled,
              processedPoultryEnabled: seller?.processed_poultry_enabled,
            }}
            onComplete={() => setView("step4")}
          />
        </div>
      </OnboardingShell>
    );
  }

  if (view === "step4") {
    return (
      <OnboardingShell
        body="These instructions appear at checkout and again in the buyer's order confirmation email. You can edit them anytime."
        currentStep={4}
        headline="Set your pickup instructions"
        subhead="Make pickup clear from the start"
      >
        <div className="space-y-3">
          {error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
              {error}
            </p>
          ) : null}
          <Step4PickupInstructionsForm
            initialValues={{
              buyerContactEmailEnabled:
                pickupSettings?.buyer_contact_email_enabled,
              buyerContactPhoneEnabled:
                pickupSettings?.buyer_contact_phone_enabled,
              buyerContactTextEnabled: pickupSettings?.buyer_contact_text_enabled,
              pickupInstructions: pickupSettings?.pickup_instructions,
            }}
            onBack={() => {
              setError(null);
              setView("step3");
            }}
            onComplete={() => {
              setError(null);
              setView("step5");
            }}
          />
        </div>
      </OnboardingShell>
    );
  }

  if (view === "step5") {
    return (
      <OnboardingShell
        body="We will use your saved pickup settings as the foundation for plan access."
        currentStep={5}
        headline="Set up plan access"
        subhead="Next we will prepare your seller plan"
      >
        <Step5Placeholder />
      </OnboardingShell>
    );
  }

  return (
    <OnboardingShell
      body="We'll use this info to create your storefront and help customers know who you are and where you're located."
      currentStep={2}
      headline="Tell us about your farm"
      subhead="Share a few basics so customers can find and connect with you."
    >
      <div className="space-y-3">
        {error ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
            {error}
          </p>
        ) : null}
        <Step2FarmBasicsForm
          initialValues={{
            aboutText: seller?.about_text,
            city: seller?.public_city,
            phone: seller?.public_phone,
            state: seller?.public_state,
            storeName: seller?.store_name,
          }}
          onComplete={() => {
            setError(null);
            setView("step3");
          }}
        />
      </div>
    </OnboardingShell>
  );
}

function Step5Placeholder() {
  return (
    <section className="rounded-[0.95rem] bg-white px-5 py-6 shadow-[0_8px_24px_rgba(45,35,20,0.09)] ring-1 ring-stone-200/80 sm:px-7 sm:py-7 lg:px-8 lg:py-7">
      <p className="text-sm font-extrabold uppercase text-[#28713a]">
        Step 5 coming next
      </p>
      <h2 className="mt-3 font-serif text-[1.75rem] font-semibold leading-tight text-stone-950 sm:text-[2rem]">
        Pickup instructions saved.
      </h2>
      <p className="mt-3 text-base font-semibold leading-7 text-stone-700">
        Next we&apos;ll set up your plan access.
      </p>
      <p className="mt-4 text-sm leading-6 text-stone-500">
        Trial access and final review will be added in the next onboarding
        passes.
      </p>
    </section>
  );
}

function friendlyOnboardingError(message: string) {
  if (message.toLowerCase().includes("function")) {
    return "We could not load your seller setup tools. Please make sure the latest Supabase migrations have been applied.";
  }

  return message || "We could not load your onboarding setup. Please try again.";
}

function hasPersistedSupabaseSession() {
  if (typeof window === "undefined") return true;

  try {
    return Object.keys(window.localStorage).some(
      (key) => key.startsWith("sb-") && key.endsWith("-auth-token"),
    );
  } catch {
    return true;
  }
}

async function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error("Request timed out."));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
