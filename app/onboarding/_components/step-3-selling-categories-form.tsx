"use client";

import Image from "next/image";
import { useState } from "react";
import { supabase } from "@/lib/supabase";

type Step3SellingCategoriesFormProps = {
  initialValues?: {
    equipmentSuppliesEnabled?: boolean | null;
    hatchingEggsEnabled?: boolean | null;
    processedPoultryEnabled?: boolean | null;
  };
  onComplete: () => void;
};

type CategoryKey = "hatchingEggs" | "poultryProducts" | "equipmentSupplies";

type CategoryOption = {
  description: string;
  glyph: string;
  key: CategoryKey;
  title: string;
};

const categoryOptions: CategoryOption[] = [
  {
    description: "Fertile eggs for incubation and hatching.",
    glyph: "/glyphs/egg-carton.png",
    key: "hatchingEggs",
    title: "Hatching eggs",
  },
  {
    description: "Eating eggs, processed poultry, and other farm food products.",
    glyph: "/glyphs/chicken-leg.png",
    key: "poultryProducts",
    title: "Poultry products",
  },
  {
    description: "Coops, feeders, brooders, farm extras, and more.",
    glyph: "/glyphs/incubator.png",
    key: "equipmentSupplies",
    title: "Equipment or supplies",
  },
];

export function Step3SellingCategoriesForm({
  initialValues,
  onComplete,
}: Step3SellingCategoriesFormProps) {
  const [selectedCategories, setSelectedCategories] = useState<
    Record<CategoryKey, boolean>
  >({
    equipmentSupplies: Boolean(initialValues?.equipmentSuppliesEnabled),
    hatchingEggs: Boolean(initialValues?.hatchingEggsEnabled),
    poultryProducts: Boolean(initialValues?.processedPoultryEnabled),
  });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function toggleCategory(key: CategoryKey) {
    setSelectedCategories((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError(null);
    setIsSubmitting(true);

    const { error: saveError } = await supabase.rpc(
      "seller_save_onboarding_categories",
      {
        p_categories: {
          equipment_supplies: selectedCategories.equipmentSupplies,
          hatching_eggs: selectedCategories.hatchingEggs,
          poultry_products: selectedCategories.poultryProducts,
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
        Just choose what you expect to offer.
      </p>

      <form className="mt-4 space-y-3" onSubmit={handleSubmit} noValidate>
        <AlwaysIncludedCard />

        {categoryOptions.map((option) => (
          <CategoryCard
            checked={selectedCategories[option.key]}
            description={option.description}
            disabled={isSubmitting}
            glyph={option.glyph}
            key={option.key}
            onToggle={() => toggleCategory(option.key)}
            title={option.title}
          />
        ))}

        {error ? (
          <p
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        <button
          className="flex min-h-10 w-full items-center justify-center rounded-md bg-[#246f38] px-4 text-sm font-bold text-white shadow-sm transition hover:bg-[#1c5c2d] focus:outline-none focus:ring-2 focus:ring-[#246f38] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 sm:text-[15px]"
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting ? "Saving categories..." : "Save selling categories"}
        </button>
      </form>
    </section>
  );
}

function AlwaysIncludedCard() {
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
            Always included. You do not need to list live birds unless you want
            to.
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
  onToggle,
  title,
}: {
  checked: boolean;
  description: string;
  disabled: boolean;
  glyph: string;
  onToggle: () => void;
  title: string;
}) {
  return (
    <label
      className={`block rounded-lg border px-4 py-3 transition ${
        checked
          ? "border-[#246f38] bg-[#eff8ed]"
          : "border-stone-200 bg-white hover:border-[#b7d7b9] hover:bg-[#fffaf1]"
      } ${disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}
    >
      <span className="flex items-start gap-3">
        <input
          checked={checked}
          className="mt-[0.875rem] size-4 shrink-0 accent-[#246f38]"
          disabled={disabled}
          onChange={onToggle}
          type="checkbox"
        />
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#fffaf1] shadow-sm">
          <Image src={glyph} alt="" width={30} height={30} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-extrabold text-stone-950">
            {title}
          </span>
          <span className="mt-1 block text-sm font-medium leading-5 text-stone-600">
            {description}
          </span>
        </span>
      </span>
    </label>
  );
}

function friendlyCategoryError(message: string) {
  if (message.toLowerCase().includes("farm basics")) {
    return "Please finish farm basics before choosing selling categories.";
  }

  return message || "We could not save your selling categories. Please try again.";
}
