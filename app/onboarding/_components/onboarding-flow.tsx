"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isCurrentUserPlatformAdmin } from "@/app/admin/_lib/admin-auth";
import type { SellerContext } from "@/app/dashboard/_lib/seller-types";
import {
  hasBrowserAuthRecoverySignal,
  waitForBrowserAuthSession,
} from "@/lib/auth-email-verification";
import { supabase } from "@/lib/supabase";
import { OnboardingShell } from "./onboarding-shell";
import { Step2FarmBasicsForm } from "./step-2-farm-basics-form";
import { Step3SellingCategoriesForm } from "./step-3-selling-categories-form";
import { Step6PickupDetailsForm } from "./step-4-pickup-instructions-form";
import { Step4StorefrontDetailsForm } from "./step-4-storefront-details-form";
import { Step5PlanAccessForm } from "./step-5-plan-access-form";
import { Step6ReviewSetup } from "./step-6-review-setup";

type OnboardingView =
  | "loading"
  | "redirecting"
  | "step2"
  | "step3"
  | "step4"
  | "step5"
  | "step6"
  | "step7";

type OnboardingProgress = {
  billing_complete: boolean | null;
  categories_complete: boolean | null;
  onboarding_complete: boolean | null;
  pickup_complete: boolean | null;
  storefront_details_complete: boolean | null;
};

type OnboardingStore = {
  about_text: string | null;
  billing_address_line1: string | null;
  billing_city: string | null;
  billing_postal_code: string | null;
  billing_state: string | null;
  buyer_contact_email_enabled: boolean | null;
  buyer_contact_phone_enabled: boolean | null;
  buyer_contact_text_enabled: boolean | null;
  equipment_supplies_enabled: boolean | null;
  hatching_eggs_enabled: boolean | null;
  hero_subheading: string | null;
  location_display_preference: string | null;
  pickup_address_line1: string | null;
  pickup_address_line2: string | null;
  pickup_city: string | null;
  pickup_policy: string | null;
  pickup_postal_code: string | null;
  pickup_state: string | null;
  processed_poultry_enabled: boolean | null;
  public_phone: string | null;
  store_name: string | null;
  store_tagline: string | null;
};

export function OnboardingFlow({ checkoutCanceled = false }: { checkoutCanceled?: boolean }) {
  const router = useRouter();
  const [view, setView] = useState<OnboardingView>("loading");
  const [seller, setSeller] = useState<SellerContext | null>(null);
  const [store, setStore] = useState<OnboardingStore | null>(null);
  const [onboardingStoreId, setOnboardingStoreId] = useState<string | null>(null);
  const [selectedPlanKey, setSelectedPlanKey] = useState<string | null>(null);
  const [selectedBillingPlan, setSelectedBillingPlan] = useState<string | null>(null);
  const [billingComplete, setBillingComplete] = useState(false);
  const [categoriesComplete, setCategoriesComplete] = useState(false);
  const [returnToReview, setReturnToReview] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadOnboardingState() {
      setError(null);
      try {
        const sessionResult = await waitForBrowserAuthSession(supabase.auth, {
          hasRecoverySignal: hasBrowserAuthRecoverySignal(window.location),
        });
        if (!isMounted) return;
        if (sessionResult.error || !sessionResult.session) {
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
        if (!primarySeller && (await isCurrentUserPlatformAdmin())) {
          setView("redirecting");
          router.replace("/admin");
          return;
        }

        setSeller(primarySeller);
        setOnboardingStoreId(primarySeller?.store_id ?? null);
        setSelectedPlanKey(
          primarySeller?.effective_plan_key ?? primarySeller?.requested_plan_key ?? null,
        );
        setSelectedBillingPlan(
          primarySeller?.requested_billing_cadence ??
            primarySeller?.effective_billing_cadence ??
            null,
        );

        if (!primarySeller?.store_id) {
          setView("step2");
          return;
        }

        const [progressResult, storeResult] = await withTimeout(
          Promise.all([
            supabase
              .from("seller_onboarding_state")
              .select(
                "billing_complete, categories_complete, onboarding_complete, pickup_complete, storefront_details_complete",
              )
              .eq("store_id", primarySeller.store_id)
              .maybeSingle<OnboardingProgress>(),
            supabase
              .from("stores")
              .select(
                "store_name, public_phone, billing_address_line1, billing_city, billing_state, billing_postal_code, store_tagline, hero_subheading, about_text, location_display_preference, hatching_eggs_enabled, equipment_supplies_enabled, processed_poultry_enabled, pickup_address_line1, pickup_address_line2, pickup_city, pickup_state, pickup_postal_code, pickup_policy, buyer_contact_email_enabled, buyer_contact_text_enabled, buyer_contact_phone_enabled",
              )
              .eq("id", primarySeller.store_id)
              .maybeSingle<OnboardingStore>(),
          ]),
          8000,
        );
        if (!isMounted) return;
        const loadError = progressResult.error ?? storeResult.error;
        if (loadError) {
          setError(friendlyOnboardingError(loadError.message));
          setView(primarySeller.profile_complete ? "step3" : "step2");
          return;
        }

        const progress = progressResult.data;
        setStore(storeResult.data ?? null);
        setBillingComplete(Boolean(progress?.billing_complete));
        setCategoriesComplete(Boolean(progress?.categories_complete));

        if (progress?.onboarding_complete) {
          setView("redirecting");
          router.replace("/dashboard");
        } else if (!primarySeller.profile_complete) {
          setView("step2");
        } else if (!progress?.billing_complete) {
          setView("step3");
        } else if (!progress.storefront_details_complete) {
          setView("step4");
        } else if (!progress.categories_complete) {
          setView("step5");
        } else if (!progress.pickup_complete) {
          setView("step6");
        } else {
          setView("step7");
        }
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
        compactOnMobile
        currentStep={2}
        headline="Set up your farm store"
        subhead="Loading your saved progress"
      >
        <StatusCard text={view === "redirecting" ? "Taking you to the right place..." : "Loading setup..."} />
      </OnboardingShell>
    );
  }

  if (view === "step3") {
    return (
      <OnboardingShell
        body="Try FlockFront free for 7 days. Choose the plan and billing schedule that fit how you sell."
        compactOnMobile
        currentStep={3}
        headline="Choose your plan"
        subhead="Plan and payment"
      >
        <div className="space-y-3">
          <ErrorMessage message={error} />
          {checkoutCanceled ? (
            <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-950" role="status">
              Checkout was not completed. Your plan selection is still saved, and no billing access was changed.
            </p>
          ) : null}
          <Step5PlanAccessForm
            initialBillingPlan={selectedBillingPlan ?? seller?.requested_billing_cadence ?? seller?.effective_billing_cadence}
            initialPlanKey={selectedPlanKey ?? seller?.requested_plan_key ?? seller?.effective_plan_key}
            onBack={() => setView("step2")}
            onComplete={(planKey, billingPlan) => {
              setSelectedPlanKey(planKey);
              setSelectedBillingPlan(billingPlan);
              setBillingComplete(true);
              setView("step4");
            }}
          />
        </div>
      </OnboardingShell>
    );
  }

  if (view === "step4") {
    return (
      <OnboardingShell
        body="Use the starter copy or personalize the introduction customers will see."
        compactOnMobile
        currentStep={4}
        headline="Shape your storefront"
        subhead="Storefront details"
      >
        <div className="space-y-3">
          <ErrorMessage message={error} />
          {seller?.store_id || onboardingStoreId ? (
            <Step4StorefrontDetailsForm
              initialValues={{
                aboutText: store?.about_text ?? seller?.about_text,
                heroSubheading: store?.hero_subheading ?? seller?.hero_subheading,
                heroTagline: store?.store_tagline ?? seller?.store_tagline,
                storeName: store?.store_name ?? seller?.store_name,
              }}
              onBack={() => {
                if (returnToReview) {
                  setReturnToReview(false);
                  setView("step7");
                } else {
                  setView("step2");
                }
              }}
              onComplete={(values) => {
                setStore((current) => ({
                  ...(current ?? emptyOnboardingStore()),
                  about_text: values.aboutText,
                  hero_subheading: values.heroSubheading,
                  location_display_preference:
                    values.locationDisplayPreference,
                  store_tagline: values.heroTagline,
                }));
                if (returnToReview) {
                  setReturnToReview(false);
                  setView("step7");
                } else {
                  setView("step5");
                }
              }}
              storeId={(seller?.store_id ?? onboardingStoreId) as string}
            />
          ) : <StatusCard text="Loading your private draft store..." />}
        </div>
      </OnboardingShell>
    );
  }

  if (view === "step5") {
    return (
      <OnboardingShell
        body="Select the modules that fit your farm. You can change optional Market modules later."
        compactOnMobile
        currentStep={5}
        headline="What do you plan to sell?"
        subhead="Selling categories"
      >
        <div className="space-y-3">
          <ErrorMessage message={error} />
          <Step3SellingCategoriesForm
            categoriesComplete={categoriesComplete}
            initialValues={{
              equipmentSuppliesEnabled: store?.equipment_supplies_enabled ?? seller?.equipment_supplies_enabled,
              hatchingEggsEnabled: store?.hatching_eggs_enabled ?? seller?.hatching_eggs_enabled,
              processedPoultryEnabled: store?.processed_poultry_enabled ?? seller?.processed_poultry_enabled,
            }}
            onBack={() => {
              if (returnToReview) {
                setReturnToReview(false);
                setView("step7");
              } else {
                setView("step4");
              }
            }}
            onComplete={(values) => {
              setCategoriesComplete(true);
              setStore((current) => ({
                ...(current ?? emptyOnboardingStore()),
                equipment_supplies_enabled:
                  values.equipmentSuppliesEnabled,
                hatching_eggs_enabled: values.hatchingEggsEnabled,
                processed_poultry_enabled:
                  values.processedPoultryEnabled,
              }));
              if (returnToReview) {
                setReturnToReview(false);
                setView("step7");
              } else {
                setView("step6");
              }
            }}
            planKey={seller?.effective_plan_key ?? selectedPlanKey ?? seller?.requested_plan_key}
          />
        </div>
      </OnboardingShell>
    );
  }

  if (view === "step6") {
    return (
      <OnboardingShell
        body="Save the private pickup address and the instructions buyers receive with their order."
        compactOnMobile
        currentStep={6}
        headline="Plan for pickup"
        subhead="Pickup details"
      >
        <div className="space-y-3">
          <ErrorMessage message={error} />
          <Step6PickupDetailsForm
            initialValues={{
              buyerContactEmailEnabled: store?.buyer_contact_email_enabled,
              buyerContactPhoneEnabled: store?.buyer_contact_phone_enabled,
              buyerContactTextEnabled: store?.buyer_contact_text_enabled,
              pickupAddressLine1: store?.pickup_address_line1,
              pickupAddressLine2: store?.pickup_address_line2,
              pickupCity: store?.pickup_city,
              pickupPolicy: store?.pickup_policy,
              pickupPostalCode: store?.pickup_postal_code,
              pickupState: store?.pickup_state,
            }}
            onBack={() => {
              if (returnToReview) {
                setReturnToReview(false);
                setView("step7");
              } else {
                setView("step5");
              }
            }}
            onComplete={(values) => {
              setStore((current) => ({
                ...(current ?? emptyOnboardingStore()),
                buyer_contact_email_enabled:
                  values.buyerContactEmailEnabled,
                buyer_contact_phone_enabled:
                  values.buyerContactPhoneEnabled,
                buyer_contact_text_enabled:
                  values.buyerContactTextEnabled,
                pickup_address_line1: values.pickupAddressLine1,
                pickup_address_line2: values.pickupAddressLine2,
                pickup_city: values.pickupCity,
                pickup_policy: values.pickupPolicy,
                pickup_postal_code: values.pickupPostalCode,
                pickup_state: values.pickupState,
              }));
              if (returnToReview) setReturnToReview(false);
              setView("step7");
            }}
          />
        </div>
      </OnboardingShell>
    );
  }

  if (view === "step7") {
    return (
      <OnboardingShell
        body="Review your setup. Then accept the current Seller Terms and continue to your dashboard."
        compactOnMobile
        currentStep={7}
        headline="You’re ready to start"
        subhead="Review and finish"
      >
        {seller?.store_id || onboardingStoreId ? (
          <Step6ReviewSetup
            onBack={() => setView("step6")}
            onEditStep={(step) => {
              setReturnToReview(true);
              setView(`step${step}` as OnboardingView);
            }}
            storeId={(seller?.store_id ?? onboardingStoreId) as string}
          />
        ) : <StatusCard text="Loading your saved setup..." />}
      </OnboardingShell>
    );
  }

  return (
    <OnboardingShell
      body="Enter only the essentials needed to create your private draft store."
      compactOnMobile
      currentStep={2}
      headline="Tell us the basics"
      subhead="Farm basics"
    >
      <div className="space-y-3">
        <ErrorMessage message={error} />
        <Step2FarmBasicsForm
          initialValues={{
            billingAddress: store?.billing_address_line1,
            city: store?.billing_city,
            phone: store?.public_phone ?? seller?.public_phone,
            postalCode: store?.billing_postal_code,
            state: store?.billing_state,
            storeName: store?.store_name ?? seller?.store_name,
          }}
          onComplete={(savedStore) => {
            setOnboardingStoreId(savedStore.storeId);
            setStore((current) => ({
              ...(current ?? emptyOnboardingStore()),
              billing_address_line1: savedStore.billingAddress,
              billing_city: savedStore.billingCity,
              billing_postal_code: savedStore.billingPostalCode,
              billing_state: savedStore.billingState,
              public_phone: savedStore.phone,
              store_name: savedStore.storeName,
            }));
            if (returnToReview) {
              setReturnToReview(false);
              setView("step7");
            } else {
              setView(billingComplete ? "step4" : "step3");
            }
          }}
        />
      </div>
    </OnboardingShell>
  );
}

function ErrorMessage({ message }: { message: string | null }) {
  return message ? (
    <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
      {message}
    </p>
  ) : null;
}

function StatusCard({ text }: { text: string }) {
  return (
    <section className="rounded-[0.95rem] bg-white px-5 py-5 shadow-[0_8px_24px_rgba(45,35,20,0.09)] ring-1 ring-stone-200/80">
      <p className="text-sm font-bold text-stone-600">{text}</p>
    </section>
  );
}

function emptyOnboardingStore(): OnboardingStore {
  return {
    about_text: null,
    billing_address_line1: null,
    billing_city: null,
    billing_postal_code: null,
    billing_state: null,
    buyer_contact_email_enabled: null,
    buyer_contact_phone_enabled: null,
    buyer_contact_text_enabled: null,
    equipment_supplies_enabled: false,
    hatching_eggs_enabled: false,
    hero_subheading: null,
    location_display_preference: "city_state",
    pickup_address_line1: null,
    pickup_address_line2: null,
    pickup_city: null,
    pickup_policy: null,
    pickup_postal_code: null,
    pickup_state: null,
    processed_poultry_enabled: false,
    public_phone: null,
    store_name: null,
    store_tagline: null,
  };
}

function friendlyOnboardingError(message: string) {
  if (message.toLowerCase().includes("function") || message.includes("storefront_details_complete")) {
    return "We could not load the latest onboarding tools. Please make sure the latest Supabase migrations have been applied.";
  }
  return message || "We could not load your onboarding setup. Please try again.";
}

async function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("Request timed out.")), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
