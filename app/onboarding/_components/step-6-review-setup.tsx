"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Step6ReviewSetupProps = {
  onBack: () => void;
  storeId: string;
};

type StoreReview = {
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
  location_display_preference: string | null;
  pickup_instructions: string | null;
  processed_poultry_enabled: boolean | null;
  public_city: string | null;
  public_state: string | null;
  store_name: string | null;
};

type BillingReview = {
  applied_promo_code: string | null;
  billing_plan: string | null;
  subscription_status: string | null;
  trial_ends_at: string | null;
};

type ReviewData = {
  billing: BillingReview | null;
  store: StoreReview | null;
};

export function Step6ReviewSetup({ onBack, storeId }: Step6ReviewSetupProps) {
  const router = useRouter();
  const [reviewData, setReviewData] = useState<ReviewData>({
    billing: null,
    store: null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFullDescription, setShowFullDescription] = useState(false);
  const [showFullPickupInstructions, setShowFullPickupInstructions] =
    useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadReview() {
      setIsLoading(true);
      setError(null);

      try {
        const [storeResult, billingResult] = await withTimeout(
          Promise.all([
            supabase
              .from("stores")
              .select(
                "store_name, about_text, public_city, public_state, billing_address_line1, billing_city, billing_state, billing_postal_code, location_display_preference, hatching_eggs_enabled, processed_poultry_enabled, equipment_supplies_enabled, pickup_instructions, buyer_contact_email_enabled, buyer_contact_text_enabled, buyer_contact_phone_enabled",
              )
              .eq("id", storeId)
              .maybeSingle<StoreReview>(),
            supabase
              .from("seller_billing_status")
              .select(
                "billing_plan, subscription_status, trial_ends_at, applied_promo_code",
              )
              .eq("store_id", storeId)
              .maybeSingle<BillingReview>(),
          ]),
          8000,
        );

        if (!isMounted) return;

        const firstError = storeResult.error ?? billingResult.error;

        if (firstError) {
          setError(friendlyReviewError(firstError.message));
          return;
        }

        setReviewData({
          billing: billingResult.data ?? null,
          store: storeResult.data ?? null,
        });
      } catch (loadError) {
        if (!isMounted) return;

        const message =
          loadError instanceof Error
            ? loadError.message
            : "We could not load your saved setup.";
        setError(friendlyReviewError(message));
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadReview();

    return () => {
      isMounted = false;
    };
  }, [storeId]);

  const categories = useMemo(
    () => getSelectedCategories(reviewData.store),
    [reviewData.store],
  );
  const contactMethods = useMemo(
    () => getContactMethods(reviewData.store),
    [reviewData.store],
  );

  async function finishOnboarding() {
    setError(null);
    setIsSubmitting(true);

    const { error: finishError } = await supabase.rpc(
      "seller_complete_onboarding",
    );

    if (finishError) {
      setError(friendlyReviewError(finishError.message));
      setIsSubmitting(false);
      return;
    }

    router.push("/dashboard");
  }

  if (isLoading) {
    return (
      <section className="rounded-[0.95rem] bg-white px-5 py-5 shadow-[0_8px_24px_rgba(45,35,20,0.09)] ring-1 ring-stone-200/80 sm:px-6 sm:py-6 lg:px-7 lg:py-6">
        <p className="text-sm font-bold text-stone-600">
          Loading your saved setup...
        </p>
      </section>
    );
  }

  const store = reviewData.store;
  const billing = reviewData.billing;
  const description = store?.about_text?.trim() ?? "";
  const descriptionIsLong = description.length > 260;
  const displayedDescription =
    descriptionIsLong && !showFullDescription
      ? `${description.slice(0, 260).trim()}...`
      : description;
  const pickupInstructions = store?.pickup_instructions?.trim() ?? "";
  const pickupInstructionsIsLong = pickupInstructions.length > 260;
  const displayedPickupInstructions =
    pickupInstructionsIsLong && !showFullPickupInstructions
      ? `${pickupInstructions.slice(0, 260).trim()}...`
      : pickupInstructions;

  return (
    <section className="rounded-[0.95rem] bg-white px-5 py-5 shadow-[0_8px_24px_rgba(45,35,20,0.09)] ring-1 ring-stone-200/80 sm:px-6 sm:py-6 lg:px-7 lg:py-6">
      <h2 className="font-serif text-[1.45rem] font-semibold leading-tight text-stone-950 sm:text-[1.7rem]">
        Review your setup
      </h2>

      <div className="mt-4 space-y-3">
        <ReviewSection title="Store">
          <ReviewRow label="Farm/store name" value={store?.store_name} />
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-stone-500">
              Farm description
            </p>
            <p className="mt-1 whitespace-pre-line text-sm font-medium leading-6 text-stone-700">
              {displayedDescription || "No farm description saved."}
            </p>
            {descriptionIsLong ? (
              <button
                className="mt-1 text-sm font-bold text-[#246f38] underline-offset-4 hover:underline"
                onClick={() => setShowFullDescription((current) => !current)}
                type="button"
              >
                {showFullDescription ? "View less" : "View more"}
              </button>
            ) : null}
          </div>
          <ReviewRow
            label="Location shown to buyers"
            value={formatBuyerLocation(store)}
          />
        </ReviewSection>

        <ReviewSection title="What you'll sell">
          {categories.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {categories.map((category) => (
                <span
                  className="inline-flex items-center gap-2 rounded-full bg-[#eff8ed] px-3 py-1 text-sm font-bold text-[#246f38] ring-1 ring-[#dbe8d8]"
                  key={category.label}
                >
                  <Image src={category.glyph} alt="" width={20} height={20} />
                  {category.label}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm font-medium leading-6 text-stone-700">
              No selling categories selected yet. You can enable them later from
              Store Admin.
            </p>
          )}
        </ReviewSection>

        <ReviewSection title="Pickup">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-stone-500">
              Pickup instructions
            </p>
            <p className="mt-1 whitespace-pre-line text-sm font-medium leading-6 text-stone-700">
              {displayedPickupInstructions || "No pickup instructions saved."}
            </p>
            {pickupInstructionsIsLong ? (
              <button
                className="mt-1 text-sm font-bold text-[#246f38] underline-offset-4 hover:underline"
                onClick={() =>
                  setShowFullPickupInstructions((current) => !current)
                }
                type="button"
              >
                {showFullPickupInstructions ? "View less" : "View more"}
              </button>
            ) : null}
          </div>
          <ReviewRow
            label="Buyer contact preferences"
            value={
              contactMethods.length > 0 ? contactMethods.join(", ") : "None"
            }
          />
        </ReviewSection>

        <ReviewSection title="Plan access">
          <ReviewRow label="Plan" value="FlockFront Seller Plan" />
          <ReviewRow label="Access" value={formatPlanAccess(billing)} />
          {billing?.applied_promo_code ? (
            <ReviewRow
              label="Promo code"
              value={billing.applied_promo_code.toUpperCase()}
            />
          ) : null}
        </ReviewSection>

        <div className="rounded-lg border border-[#dbe8d8] bg-[#eff8ed] px-4 py-3">
          <p className="text-sm font-medium leading-6 text-stone-700">
            You can edit your store details, pickup windows, biosecurity
            details, payment instructions, refund policies, and other store
            policies from Store Admin on your dashboard.
          </p>
        </div>

        {error ? (
          <p
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-[0.42fr_1fr]">
          <button
            className="flex min-h-10 w-full items-center justify-center rounded-md border border-stone-300 bg-white px-4 text-sm font-bold text-stone-700 shadow-sm transition hover:border-[#246f38] hover:text-[#246f38] focus:outline-none focus:ring-2 focus:ring-[#246f38] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 sm:text-[15px]"
            disabled={isSubmitting}
            onClick={onBack}
            type="button"
          >
            Back
          </button>
          <button
            className="flex min-h-10 w-full items-center justify-center rounded-md bg-[#246f38] px-4 text-sm font-bold text-white shadow-sm transition hover:bg-[#1c5c2d] focus:outline-none focus:ring-2 focus:ring-[#246f38] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 sm:text-[15px]"
            disabled={isSubmitting}
            onClick={finishOnboarding}
            type="button"
          >
            {isSubmitting ? "Opening dashboard..." : "Start building my store"}
          </button>
        </div>
      </div>
    </section>
  );
}

function ReviewSection({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <section className="rounded-lg border border-stone-200 bg-[#fffaf1] px-4 py-3">
      <h3 className="font-serif text-lg font-semibold text-stone-950">
        {title}
      </h3>
      <div className="mt-2 space-y-2">{children}</div>
    </section>
  );
}

function ReviewRow({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide text-stone-500">
        {label}
      </p>
      <p className="mt-1 text-sm font-bold leading-5 text-stone-800">
        {value || "Not saved"}
      </p>
    </div>
  );
}

function getSelectedCategories(store: StoreReview | null) {
  if (!store) return [];

  const categories = [{ glyph: "/glyphs/hen.png", label: "Live birds" }];

  if (store.hatching_eggs_enabled) {
    categories.push({
      glyph: "/glyphs/egg-carton.png",
      label: "Hatching eggs",
    });
  }

  if (store.processed_poultry_enabled) {
    categories.push({
      glyph: "/glyphs/chicken-leg.png",
      label: "Poultry products",
    });
  }

  if (store.equipment_supplies_enabled) {
    categories.push({
      glyph: "/glyphs/incubator.png",
      label: "Equipment or supplies",
    });
  }

  return categories;
}

function getContactMethods(store: StoreReview | null) {
  if (!store) return [];

  const methods: string[] = [];

  if (store.buyer_contact_email_enabled) methods.push("Email");
  if (store.buyer_contact_text_enabled) methods.push("Text message");
  if (store.buyer_contact_phone_enabled) methods.push("Phone call");

  return methods;
}

function formatBuyerLocation(store: StoreReview | null) {
  if (!store) return "Not saved";

  if (store.location_display_preference === "manual") {
    return "You'll add pickup location details manually";
  }

  if (store.location_display_preference === "full_address") {
    return [
      store.billing_address_line1,
      store.billing_city,
      store.billing_state,
      store.billing_postal_code,
    ]
      .filter(Boolean)
      .join(", ");
  }

  return [store.public_city, store.public_state].filter(Boolean).join(", ");
}

function formatPlanAccess(billing: BillingReview | null) {
  if (!billing) return "Not saved";

  if (
    billing.subscription_status === "comped" ||
    billing.billing_plan === "comped"
  ) {
    return "Beta access applied, no payment required during beta";
  }

  return "7-day free trial, then $29/month";
}

function friendlyReviewError(message: string) {
  if (message.toLowerCase().includes("timed out")) {
    return "We could not load your saved setup. Please refresh and try again.";
  }

  if (message.toLowerCase().includes("function")) {
    return "We could not load the latest onboarding tools. Please make sure the latest Supabase migrations have been applied.";
  }

  return message || "We could not finish onboarding. Please try again.";
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
