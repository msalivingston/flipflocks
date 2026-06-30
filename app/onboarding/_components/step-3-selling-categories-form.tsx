"use client";

import Image from "next/image";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { LOCKED_PLAN_MESSAGES, normalizePlanId } from "@/lib/plan-capabilities";
import type { LockedPlanFeature } from "@/lib/plan-capabilities";

type Step3SellingCategoriesFormProps = {
  initialValues?: {
    equipmentSuppliesEnabled?: boolean | null;
    hatchingEggsEnabled?: boolean | null;
    processedPoultryEnabled?: boolean | null;
  };
  onChooseFullFlock: () => void;
  onBack: () => void;
  onComplete: () => void;
  planKey?: string | null;
};

type CategoryKey = "hatchingEggs" | "poultryProducts" | "equipmentSupplies";

type CategoryOption = {
  description: string;
  glyph: string;
  key: CategoryKey;
  lockedFeature: LockedPlanFeature;
  title: string;
};

const categoryOptions: CategoryOption[] = [
  {
    description: "Fertile eggs for incubation and hatching.",
    glyph: "/glyphs/egg-carton.png",
    key: "hatchingEggs",
    lockedFeature: "hatching_eggs",
    title: "Hatching eggs",
  },
  {
    description: "Eating eggs, processed poultry, and other farm food products.",
    glyph: "/glyphs/chicken-leg.png",
    key: "poultryProducts",
    lockedFeature: "processed_poultry",
    title: "Poultry products",
  },
  {
    description: "Coops, feeders, brooders, farm extras, and more.",
    glyph: "/glyphs/incubator.png",
    key: "equipmentSupplies",
    lockedFeature: "equipment_supplies",
    title: "Equipment or supplies",
  },
];

export function Step3SellingCategoriesForm({
  initialValues,
  onChooseFullFlock,
  onBack,
  onComplete,
  planKey,
}: Step3SellingCategoriesFormProps) {
  const normalizedPlan = normalizePlanId(planKey);
  const isSmallFlock = normalizedPlan === "small_flock";
  const [selectedCategories, setSelectedCategories] = useState<
    Record<CategoryKey, boolean>
  >({
    equipmentSupplies:
      !isSmallFlock && Boolean(initialValues?.equipmentSuppliesEnabled),
    hatchingEggs: !isSmallFlock && Boolean(initialValues?.hatchingEggsEnabled),
    poultryProducts:
      !isSmallFlock && Boolean(initialValues?.processedPoultryEnabled),
  });
  const [error, setError] = useState<string | null>(null);
  const [upgradeMessage, setUpgradeMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function toggleCategory(key: CategoryKey) {
    setUpgradeMessage(null);
    setSelectedCategories((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  function showLockedCategoryMessage(feature: LockedPlanFeature) {
    setUpgradeMessage(
      LOCKED_PLAN_MESSAGES[feature] || "This category is included with Full Flock.",
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError(null);
    setIsSubmitting(true);

    const { error: saveError } = await supabase.rpc(
      "seller_save_onboarding_categories",
      {
        p_categories: {
          equipment_supplies: isSmallFlock
            ? false
            : selectedCategories.equipmentSupplies,
          hatching_eggs: isSmallFlock ? false : selectedCategories.hatchingEggs,
          poultry_products: isSmallFlock
            ? false
            : selectedCategories.poultryProducts,
        },
      },
    );

    if (saveError) {
      setError(friendlyCategoryError(saveError.message));
      setIsSubmitting(false);
      return;
    }

    onComplete();
  }

  return (
    <section className="rounded-[0.95rem] bg-white px-5 py-5 shadow-[0_8px_24px_rgba(45,35,20,0.09)] ring-1 ring-stone-200/80 sm:px-6 sm:py-6 lg:px-7 lg:py-6">
      <h2 className="font-serif text-[1.45rem] font-semibold leading-tight text-stone-950 sm:text-[1.7rem]">
        Selling categories
      </h2>
      <p className="mt-2 text-sm font-medium leading-6 text-stone-600">
        {isSmallFlock
          ? "Small Flock includes live bird listings for single birds, pairs, and trios. Upgrade to Full Flock anytime to add hatching eggs, poultry products, equipment, flock/group listings, and Age-Based Pricing."
          : "Just choose what you expect to offer."}
      </p>

      <form className="mt-4 space-y-3" onSubmit={handleSubmit} noValidate>
        <AlwaysIncludedCard isSmallFlock={isSmallFlock} />

        {categoryOptions.map((option) => (
          <CategoryCard
            checked={!isSmallFlock && selectedCategories[option.key]}
            description={option.description}
            disabled={isSubmitting}
            glyph={option.glyph}
            isLocked={isSmallFlock}
            key={option.key}
            onLockedClick={() => showLockedCategoryMessage(option.lockedFeature)}
            onToggle={() => toggleCategory(option.key)}
            title={option.title}
          />
        ))}

        {upgradeMessage ? (
          <div className="rounded-lg border border-[#dbe8d8] bg-[#eff8ed] px-4 py-3">
            <p className="text-sm font-semibold leading-6 text-stone-700">
              {upgradeMessage}
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <button
                className="min-h-9 rounded-md bg-[#246f38] px-3 text-sm font-bold text-white transition hover:bg-[#1c5c2d] focus:outline-none focus:ring-2 focus:ring-[#246f38] focus:ring-offset-2"
                onClick={onChooseFullFlock}
                type="button"
              >
                Choose Full Flock
              </button>
              <button
                className="min-h-9 rounded-md border border-stone-300 bg-white px-3 text-sm font-bold text-stone-700 transition hover:border-[#246f38] hover:text-[#246f38] focus:outline-none focus:ring-2 focus:ring-[#246f38] focus:ring-offset-2"
                onClick={() => setUpgradeMessage(null)}
                type="button"
              >
                Stay with Small Flock
              </button>
            </div>
          </div>
        ) : null}

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
            type="submit"
          >
            {isSubmitting ? "Saving categories..." : "Save selling categories"}
          </button>
        </div>
      </form>
    </section>
  );
}

function AlwaysIncludedCard({ isSmallFlock }: { isSmallFlock: boolean }) {
  return (
    <div className="rounded-lg border border-[#b7d7b9] bg-[#eff8ed] px-4 py-3">
      <div className="flex items-start gap-3">
        <input
          checked
          className="mt-[0.875rem] size-4 shrink-0 accent-[#246f38]"
          disabled
          readOnly
          type="checkbox"
        />
        <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white shadow-sm">
          <Image src="/glyphs/hen.png" alt="" width={30} height={30} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-extrabold text-stone-950">Live birds</p>
          <p className="mt-1 text-sm font-medium leading-5 text-stone-600">
            Chicks, pullets, adult birds, breeding stock, and more.
          </p>
          <p className="mt-2 text-sm font-semibold leading-5 text-[#246f38]">
            {isSmallFlock
              ? "Included with Small Flock. Single birds, pairs, and trios are available."
              : "Included with Full Flock. You can also use flock/group listings."}
          </p>
        </div>
      </div>
    </div>
  );
}

function CategoryCard({
  checked,
  description,
  disabled,
  glyph,
  isLocked,
  onLockedClick,
  onToggle,
  title,
}: {
  checked: boolean;
  description: string;
  disabled: boolean;
  glyph: string;
  isLocked: boolean;
  onLockedClick: () => void;
  onToggle: () => void;
  title: string;
}) {
  const className = `block w-full rounded-lg border px-4 py-3 text-left transition ${
    checked
      ? "border-[#246f38] bg-[#eff8ed]"
      : isLocked
        ? "border-stone-200 bg-stone-50"
        : "border-stone-200 bg-white hover:border-[#b7d7b9] hover:bg-[#fffaf1]"
  } ${disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`;

  const content = (
    <span className="flex items-start gap-3">
      <input
        checked={checked}
        className="mt-[0.875rem] size-4 shrink-0 accent-[#246f38] disabled:accent-stone-300"
        disabled={disabled || isLocked}
        onChange={onToggle}
        type="checkbox"
      />
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#fffaf1] shadow-sm">
        <Image src={glyph} alt="" width={30} height={30} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-extrabold text-stone-950">
            {title}
          </span>
          {isLocked ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-wide text-stone-600 ring-1 ring-stone-200">
              <Image src="/glyphs/shield.png" alt="" width={13} height={13} />
              Full Flock
            </span>
          ) : null}
        </span>
        <span className="mt-1 block text-sm font-medium leading-5 text-stone-600">
          {description}
        </span>
        {isLocked ? (
          <span className="mt-2 block text-sm font-semibold leading-5 text-stone-500">
            Available on Full Flock
          </span>
        ) : null}
      </span>
    </span>
  );

  if (isLocked) {
    return (
      <button
        className={className}
        disabled={disabled}
        onClick={onLockedClick}
        type="button"
      >
        {content}
      </button>
    );
  }

  return (
    <label className={className}>
      {content}
    </label>
  );
}

function friendlyCategoryError(message: string) {
  if (message.toLowerCase().includes("farm basics")) {
    return "Please finish farm basics before choosing selling categories.";
  }

  if (message.toLowerCase().includes("plan")) {
    return "Please choose a plan before choosing selling categories.";
  }

  if (message.toLowerCase().includes("full flock")) {
    return "That category is included with Full Flock.";
  }

  return message || "We could not save your selling categories. Please try again.";
}
