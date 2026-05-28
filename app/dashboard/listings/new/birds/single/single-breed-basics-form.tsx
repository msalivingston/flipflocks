"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Dispatch, SetStateAction } from "react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSellerContext } from "../../../../_components/seller-context";
import {
  ErrorState,
  LoadingState,
  SellerCard,
  SellerPageHeader,
} from "../../../../_components/seller-ui";
import type {
  ReferenceBreed,
  ReferenceSpecies,
  SellerBreedProfileOption,
} from "../../../../_lib/seller-types";

type BreedChoice = {
  value: string;
  label: string;
  kind: "profile" | "breed";
  profileId?: string;
  breedId?: string;
};

type WorkflowStep = "basics" | "inventory" | "review";

type InventoryType =
  | "female"
  | "male"
  | "straight_run"
  | "unsexed"
  | "pair"
  | "trio"
  | "hatching_eggs"
  | "other";

type InventoryRow = {
  id: string;
  inventoryType: InventoryType | "";
  customLabel: string;
  quantityAvailable: string;
  priceOverride: string;
};

type FormState = {
  speciesId: string;
  breedChoice: string;
  originDate: string;
  availableDate: string;
  basePrice: string;
  internalLabel: string;
  publicDescription: string;
  sellerNotes: string;
};

const emptyFormState: FormState = {
  speciesId: "",
  breedChoice: "",
  originDate: "",
  availableDate: "",
  basePrice: "",
  internalLabel: "",
  publicDescription: "",
  sellerNotes: "",
};

const publicDescriptionMaxLength = 1000;

const inventoryTypeOptions: { label: string; value: InventoryType }[] = [
  { label: "Female (pullet or hen)", value: "female" },
  { label: "Male (cockerel or rooster)", value: "male" },
  { label: "Straight run", value: "straight_run" },
  { label: "Unsexed", value: "unsexed" },
  { label: "Pair", value: "pair" },
  { label: "Trio", value: "trio" },
  { label: "Hatching eggs", value: "hatching_eggs" },
  { label: "Other", value: "other" },
];

const firstInventoryRow: InventoryRow = {
  id: "inventory-row-1",
  inventoryType: "",
  customLabel: "",
  quantityAvailable: "",
  priceOverride: "",
};

/**
 * Runs the first complete Single Breed listing creation flow.
 *
 * The save step uses the existing seller-safe creation RPCs and creates the
 * listing as hidden so sellers can review it before any public launch flow.
 */
export function SingleBreedBasicsForm() {
  const { seller } = useSellerContext();
  const router = useRouter();
  const storeId = seller?.store_id ?? "";
  const [species, setSpecies] = useState<ReferenceSpecies[]>([]);
  const [breeds, setBreeds] = useState<ReferenceBreed[]>([]);
  const [sellerProfiles, setSellerProfiles] = useState<
    SellerBreedProfileOption[]
  >([]);
  const [form, setForm] = useState<FormState>(emptyFormState);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [inventoryRows, setInventoryRows] = useState<InventoryRow[]>([
    firstInventoryRow,
  ]);
  const [step, setStep] = useState<WorkflowStep>("basics");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!storeId) return;

    let isMounted = true;

    async function loadReferenceData() {
      setIsLoading(true);
      setError(null);

      const [speciesResult, breedResult, profileResult] = await Promise.all([
        supabase
          .from("species")
          .select("id, common_name, slug, sort_order")
          .eq("is_active", true)
          .order("sort_order", { ascending: true })
          .order("common_name", { ascending: true }),
        supabase
          .from("breeds")
          .select("id, species_id, breed_name, breed_slug, sort_order")
          .eq("is_active", true)
          .order("sort_order", { ascending: true })
          .order("breed_name", { ascending: true }),
        supabase
          .from("seller_breed_profiles")
          .select(
            "id, species_id, breed_id, custom_breed_name, display_name, seller_description, seller_notes, visibility_status",
          )
          .eq("store_id", storeId)
          .eq("visibility_status", "active")
          .eq("moderation_status", "normal")
          .order("display_name", { ascending: true }),
      ]);

      if (!isMounted) return;

      const loadError =
        speciesResult.error ?? breedResult.error ?? profileResult.error;

      if (loadError) {
        setError(loadError.message);
        setIsLoading(false);
        return;
      }

      const loadedSpecies = (speciesResult.data ?? []) as ReferenceSpecies[];
      const loadedBreeds = (breedResult.data ?? []) as ReferenceBreed[];
      const loadedProfiles = (profileResult.data ??
        []) as SellerBreedProfileOption[];
      const defaultSpecies =
        loadedSpecies.find((item) => item.slug === "chicken") ??
        loadedSpecies[0] ??
        null;

      setSpecies(loadedSpecies);
      setBreeds(loadedBreeds);
      setSellerProfiles(loadedProfiles);
      setForm((current) => ({
        ...current,
        speciesId: current.speciesId || defaultSpecies?.id || "",
      }));
      setIsLoading(false);
    }

    void loadReferenceData();

    return () => {
      isMounted = false;
    };
  }, [storeId]);

  const selectedSpecies = species.find((item) => item.id === form.speciesId);

  const breedChoices = useMemo(
    () => buildBreedChoices(form.speciesId, breeds, sellerProfiles),
    [form.speciesId, breeds, sellerProfiles],
  );

  function updateField<TKey extends keyof FormState>(
    key: TKey,
    value: FormState[TKey],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
    setValidationErrors([]);
    setSaveError(null);
  }

  function handleBreedChoiceChange(value: string) {
    const selectedProfile = sellerProfiles.find(
      (profile) => `profile:${profile.id}` === value,
    );

    setForm((current) => ({
      ...current,
      breedChoice: value,
      publicDescription: selectedProfile?.seller_description ?? "",
    }));
    setValidationErrors([]);
    setSaveError(null);
  }

  function handleBasicsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors = validateForm(form);
    setValidationErrors(nextErrors);

    if (nextErrors.length === 0) {
      setStep("inventory");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function handleInventorySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors = validateInventory(inventoryRows);
    setValidationErrors(nextErrors);

    if (nextErrors.length === 0) {
      setStep("review");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  async function handleSave() {
    if (!seller) return;

    const basicsErrors = validateForm(form);
    const inventoryErrors = validateInventory(inventoryRows);
    const selectedBreedChoice = breedChoices.find(
      (choice) => choice.value === form.breedChoice,
    );

    if (!selectedBreedChoice) {
      basicsErrors.push("Choose a breed.");
    }

    const nextErrors = [...basicsErrors, ...inventoryErrors];
    setValidationErrors(nextErrors);

    if (nextErrors.length > 0 || !selectedBreedChoice) return;

    setIsSaving(true);
    setSaveError(null);

    const sellerBreedProfileId =
      await upsertSellerBreedProfileForListing(
        seller.store_id,
        form.speciesId,
        selectedBreedChoice,
        sellerProfiles,
        form.publicDescription,
      );

    if (!sellerBreedProfileId) {
      setSaveError(
        "The breed could not be prepared for this store. Please try again.",
      );
      setIsSaving(false);
      return;
    }

    const batchType = getBatchType(inventoryRows);
    const createResult = await supabase.rpc(
      "seller_create_listing_batch_with_inventory",
      {
        p_store_id: seller.store_id,
        p_species_id: form.speciesId,
        p_batch_type: batchType,
        p_origin_date:
          batchType === "hatching_eggs" ? form.availableDate : form.originDate,
        p_available_date: form.availableDate,
        p_base_price: Number(form.basePrice),
        p_breed_groups: [
          {
            seller_breed_profile_id: sellerBreedProfileId,
            sort_order: 0,
            visibility_status: "active",
            inventory_items: buildInventoryPayload(inventoryRows),
          },
        ],
        p_auto_price_increase_enabled: false,
        p_auto_price_increase_amount: null,
        p_auto_price_increase_max_price: null,
        p_internal_batch_label: form.internalLabel.trim() || null,
        p_seller_notes: form.sellerNotes.trim() || null,
        p_visibility_status: "hidden",
      },
    );

    if (createResult.error) {
      setSaveError(createResult.error.message);
      setIsSaving(false);
      return;
    }

    window.sessionStorage.setItem(
      "flipflocksListingCreatedMessage",
      "Listing saved privately. It is hidden until you choose to publish it.",
    );
    router.push("/dashboard/listings");
  }

  if (isLoading) {
    return (
      <>
        <Header />
        <main className="mx-auto w-full max-w-4xl px-5 py-5 sm:px-7">
          <LoadingState label="Loading listing setup" />
        </main>
      </>
    );
  }

  if (error) {
    return (
      <>
        <Header />
        <main className="mx-auto w-full max-w-4xl px-5 py-5 sm:px-7">
          <ErrorState
            title="Listing setup could not load"
            message="Refresh the page and try again. If this keeps happening, the breed list may need attention."
          />
        </main>
      </>
    );
  }

  return (
    <>
      <Header />

      <main className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-5 py-5 sm:px-7">
        <StepIndicator step={step} />

        {step === "basics" ? (
          <SellerCard className="p-5">
            <form className="grid gap-5" onSubmit={handleBasicsSubmit}>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-1 text-sm font-semibold text-stone-700">
                  Species
                  <select
                    className="seller-form-field"
                    value={form.speciesId}
                    onChange={(event) => {
                      setForm((current) => ({
                        ...current,
                        speciesId: event.target.value,
                        breedChoice: "",
                      }));
                      setValidationErrors([]);
                      setSaveError(null);
                    }}
                  >
                    <option value="">Choose species</option>
                    {species.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.common_name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-1 text-sm font-semibold text-stone-700">
                  Breed
                  <select
                    className="seller-form-field"
                    value={form.breedChoice}
                    onChange={(event) => handleBreedChoiceChange(event.target.value)}
                    disabled={!form.speciesId}
                  >
                    <option value="">Choose breed</option>
                    {breedChoices.map((choice) => (
                      <option key={choice.value} value={choice.value}>
                        {choice.label}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs font-normal leading-5 text-stone-500">
                    Existing farm breed names appear first when you have them.
                  </span>
                </label>
              </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-1 text-sm font-semibold text-stone-700">
                Hatch or origin date
                <input
                  className="seller-form-field"
                  type="date"
                  value={form.originDate}
                  onChange={(event) =>
                    updateField("originDate", event.target.value)
                  }
                />
                <span className="text-xs font-normal leading-5 text-stone-500">
                  Use the hatch date for chicks or the date you want age counted
                  from.
                </span>
              </label>

              <label className="grid gap-1 text-sm font-semibold text-stone-700">
                Available for pickup
                <input
                  className="seller-form-field"
                  type="date"
                  value={form.availableDate}
                  onChange={(event) =>
                    updateField("availableDate", event.target.value)
                  }
                />
              </label>
            </div>

            <label className="grid gap-1 text-sm font-semibold text-stone-700">
              Base price
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-stone-500">
                  $
                </span>
                <input
                  className="seller-form-field pl-7"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  type="number"
                  value={form.basePrice}
                  onChange={(event) =>
                    updateField("basePrice", event.target.value)
                  }
                />
              </div>
              <span className="text-xs font-normal leading-5 text-stone-500">
                Age-based pricing will be handled in the pricing step so the
                rule is clear before anything is published.
              </span>
            </label>

            <label className="grid gap-1 text-sm font-semibold text-stone-700">
              Internal label
              <input
                className="seller-form-field"
                maxLength={120}
                placeholder="Example: May 12 lavender pullets"
                type="text"
                value={form.internalLabel}
                onChange={(event) =>
                  updateField("internalLabel", event.target.value)
                }
              />
              <span className="text-xs font-normal leading-5 text-stone-500">
                This is just for you. Buyers will not see it.
              </span>
            </label>

            <label className="grid gap-1 text-sm font-semibold text-stone-700">
              Public description
              <textarea
                className="seller-form-field min-h-32 resize-y py-3"
                maxLength={publicDescriptionMaxLength}
                placeholder="Example: Friendly started pullets from our spring hatch, raised on pasture with regular handling."
                value={form.publicDescription}
                onChange={(event) =>
                  updateField("publicDescription", event.target.value)
                }
              />
              <span className="text-xs font-normal leading-5 text-stone-500">
                This is what buyers will see on your listing. Optional for now.
              </span>
            </label>

            <label className="grid gap-1 text-sm font-semibold text-stone-700">
              Seller notes
              <textarea
                className="seller-form-field min-h-28 resize-y py-3"
                placeholder="Private reminders like brooder group, source pen, or follow-up notes."
                value={form.sellerNotes}
                onChange={(event) =>
                  updateField("sellerNotes", event.target.value)
                }
              />
            </label>

            {validationErrors.length > 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                <h2 className="text-sm font-semibold text-amber-950">
                  A few basics need attention
                </h2>
                <ul className="mt-2 grid gap-1 text-sm leading-6 text-amber-800">
                  {validationErrors.map((item) => (
                    <li key={item}>- {item}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="flex flex-col gap-3 border-t border-stone-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm leading-6 text-stone-600">
                Next you will add the bird groups buyers can choose from.
              </p>
              <button
                className="inline-flex min-h-11 items-center justify-center rounded-md bg-stone-950 px-5 text-sm font-semibold text-white transition hover:bg-stone-800 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
                type="submit"
              >
                Continue to Bird Groups
              </button>
            </div>
            </form>
          </SellerCard>
        ) : null}

        {step === "inventory" ? (
          <InventoryStep
            inventoryRows={inventoryRows}
            setInventoryRows={setInventoryRows}
            validationErrors={validationErrors}
            onBack={() => {
              setValidationErrors([]);
              setStep("basics");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            onSubmit={handleInventorySubmit}
          />
        ) : null}

        {step === "review" ? (
          <ReviewStep
            breedChoice={breedChoices.find(
              (choice) => choice.value === form.breedChoice,
            )}
            form={form}
            inventoryRows={inventoryRows}
            isSaving={isSaving}
            saveError={saveError}
            speciesName={selectedSpecies?.common_name ?? "Selected species"}
            onBack={() => {
              setValidationErrors([]);
              setSaveError(null);
              setStep("inventory");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            onSave={handleSave}
          />
        ) : null}
      </main>
    </>
  );
}

function Header() {
  return (
    <SellerPageHeader
      eyebrow="Bird Listing"
      title="Single Breed Basics"
      description="Add the basics, choose what bird groups you have, and review everything before saving privately."
      action={
        <Link
          className="seller-secondary-button"
          href="/dashboard/listings/new/birds"
        >
          Back to Bird Options
        </Link>
      }
    />
  );
}

function StepIndicator({ step }: { step: WorkflowStep }) {
  const steps: { label: string; value: WorkflowStep }[] = [
    { label: "Basics", value: "basics" },
    { label: "Bird groups", value: "inventory" },
    { label: "Review", value: "review" },
  ];

  return (
    <ol className="grid grid-cols-3 gap-2 rounded-lg border border-stone-200 bg-white p-2 text-center text-xs font-semibold text-stone-600 shadow-sm">
      {steps.map((item, index) => {
        const isActive = item.value === step;

        return (
          <li
            key={item.value}
            className={`rounded-md px-2 py-2 ${
              isActive ? "bg-emerald-800 text-white" : "bg-stone-50"
            }`}
          >
            {index + 1}. {item.label}
          </li>
        );
      })}
    </ol>
  );
}

function InventoryStep({
  inventoryRows,
  onBack,
  onSubmit,
  setInventoryRows,
  validationErrors,
}: {
  inventoryRows: InventoryRow[];
  onBack: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  setInventoryRows: Dispatch<SetStateAction<InventoryRow[]>>;
  validationErrors: string[];
}) {
  function updateRow(rowId: string, updates: Partial<InventoryRow>) {
    setInventoryRows((current) =>
      current.map((row) => (row.id === rowId ? { ...row, ...updates } : row)),
    );
  }

  function addRow() {
    setInventoryRows((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        inventoryType: "",
        customLabel: "",
        quantityAvailable: "",
        priceOverride: "",
      },
    ]);
  }

  function removeRow(rowId: string) {
    setInventoryRows((current) =>
      current.length === 1
        ? current
        : current.filter((row) => row.id !== rowId),
    );
  }

  return (
    <SellerCard className="p-5">
      <form className="grid gap-5" onSubmit={onSubmit}>
        <div>
          <h2 className="text-xl font-semibold text-stone-950">
            Bird groups
          </h2>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            Add what you have available, like pullets, cockerels, straight run
            chicks, or hatching eggs.
          </p>
        </div>

        <div className="grid gap-4">
          {inventoryRows.map((row, index) => (
            <div
              key={row.id}
              className="rounded-lg border border-stone-200 bg-stone-50 p-4"
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <h3 className="font-semibold text-stone-950">
                  Group {index + 1}
                </h3>
                <button
                  className="seller-small-button"
                  disabled={inventoryRows.length === 1}
                  onClick={() => removeRow(row.id)}
                  type="button"
                >
                  Remove
                </button>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-1 text-sm font-semibold text-stone-700">
                  Bird type
                  <select
                    className="seller-form-field"
                    value={row.inventoryType}
                    onChange={(event) =>
                      updateRow(row.id, {
                        inventoryType: event.target.value as InventoryType | "",
                        customLabel:
                          event.target.value === "other" ? row.customLabel : "",
                      })
                    }
                  >
                    <option value="">Choose bird type</option>
                    {inventoryTypeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-1 text-sm font-semibold text-stone-700">
                  How many are available?
                  <input
                    className="seller-form-field"
                    inputMode="numeric"
                    min="1"
                    step="1"
                    type="number"
                    value={row.quantityAvailable}
                    onChange={(event) =>
                      updateRow(row.id, {
                        quantityAvailable: event.target.value,
                      })
                    }
                  />
                </label>
              </div>

              {row.inventoryType === "other" ? (
                <label className="mt-4 grid gap-1 text-sm font-semibold text-stone-700">
                  Name this group
                  <input
                    className="seller-form-field"
                    placeholder="Example: Started pullets"
                    value={row.customLabel}
                    onChange={(event) =>
                      updateRow(row.id, { customLabel: event.target.value })
                    }
                  />
                  <span className="text-xs font-normal leading-5 text-stone-500">
                    Use the words buyers will recognize for this group.
                  </span>
                </label>
              ) : null}

              <label className="mt-4 grid gap-1 text-sm font-semibold text-stone-700">
                Optional custom price
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-stone-500">
                    $
                  </span>
                  <input
                    className="seller-form-field pl-7"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    type="number"
                    value={row.priceOverride}
                    onChange={(event) =>
                      updateRow(row.id, { priceOverride: event.target.value })
                    }
                  />
                </div>
                <span className="text-xs font-normal leading-5 text-stone-500">
                  Leave blank if this group uses the listing base price. Add a
                  custom price when pullets, cockerels, or eggs should be priced
                  differently.
                </span>
              </label>
            </div>
          ))}
        </div>

        <button className="seller-secondary-button w-full" onClick={addRow} type="button">
          Add Another Bird Group
        </button>

        {validationErrors.length > 0 ? (
          <ValidationMessage errors={validationErrors} />
        ) : null}

        <div className="flex flex-col gap-3 border-t border-stone-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <button className="seller-secondary-button" onClick={onBack} type="button">
          Back to Basics
          </button>
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-stone-950 px-5 text-sm font-semibold text-white transition hover:bg-stone-800 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
            type="submit"
          >
            Review Listing
          </button>
        </div>
      </form>
    </SellerCard>
  );
}

function ReviewStep({
  breedChoice,
  form,
  inventoryRows,
  isSaving,
  onBack,
  onSave,
  saveError,
  speciesName,
}: {
  breedChoice: BreedChoice | undefined;
  form: FormState;
  inventoryRows: InventoryRow[];
  isSaving: boolean;
  onBack: () => void;
  onSave: () => void;
  saveError: string | null;
  speciesName: string;
}) {
  return (
    <SellerCard className="p-5">
      <p className="text-sm font-semibold uppercase tracking-[0.08em] text-emerald-800">
        Review
      </p>
      <h2 className="mt-2 text-xl font-semibold text-stone-950">
        Save this listing privately?
      </h2>
      <p className="mt-2 text-sm leading-6 text-stone-600">
        The listing will stay hidden from buyers until you choose to publish it.
      </p>

      <dl className="mt-5 grid gap-3 rounded-lg border border-stone-200 bg-stone-50 p-4 text-sm sm:grid-cols-2">
        <ReviewItem label="Species" value={speciesName} />
        <ReviewItem label="Breed" value={breedChoice?.label ?? "Selected"} />
        <ReviewItem label="Hatch/origin date" value={formatDate(form.originDate)} />
        <ReviewItem label="Available date" value={formatDate(form.availableDate)} />
        <ReviewItem label="Base price" value={formatCurrency(form.basePrice)} />
        <ReviewItem
          label="Internal label"
          value={form.internalLabel.trim() || "No internal label"}
        />
        <ReviewItem
          label="Public description"
          value={form.publicDescription.trim() || "No public description"}
        />
      </dl>

      <div className="mt-5">
        <h3 className="text-base font-semibold text-stone-950">Bird groups</h3>
        <div className="mt-3 grid gap-3">
          {inventoryRows.map((row) => (
            <div
              key={row.id}
              className="rounded-lg border border-stone-200 bg-white p-4 text-sm"
            >
              <p className="font-semibold text-stone-950">
                {formatInventoryType(row)}
              </p>
              <p className="mt-1 text-stone-600">
                Available: {row.quantityAvailable}
              </p>
              <p className="mt-1 text-stone-600">
                Price for this group:{" "}
                {row.priceOverride.trim()
                  ? formatCurrency(row.priceOverride)
                  : "Uses base price"}
              </p>
            </div>
          ))}
        </div>
      </div>

      {saveError ? (
        <ErrorState
          title="Listing was not saved"
          message="Please try again. If it keeps happening, the listing details may need attention."
        />
      ) : null}

      <div className="mt-5 flex flex-col gap-3 border-t border-stone-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <button className="seller-secondary-button" onClick={onBack} type="button">
          Back to Bird Groups
        </button>
        <button
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-stone-950 px-5 text-sm font-semibold text-white transition hover:bg-stone-800 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 disabled:cursor-wait disabled:opacity-70"
          disabled={isSaving}
          onClick={onSave}
          type="button"
        >
          {isSaving ? "Saving" : "Save Private Listing"}
        </button>
      </div>
    </SellerCard>
  );
}

function ReviewItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-semibold text-stone-600">{label}</dt>
      <dd className="mt-1 font-semibold text-stone-950">{value}</dd>
    </div>
  );
}

function buildBreedChoices(
  speciesId: string,
  breeds: ReferenceBreed[],
  sellerProfiles: SellerBreedProfileOption[],
) {
  if (!speciesId) return [];

  const profilesForSpecies = sellerProfiles.filter(
    (profile) => profile.species_id === speciesId,
  );
  const profiledBreedIds = new Set(
    profilesForSpecies
      .map((profile) => profile.breed_id)
      .filter((breedId): breedId is string => Boolean(breedId)),
  );
  const catalogBreeds = breeds.filter(
    (breed) =>
      breed.species_id === speciesId && !profiledBreedIds.has(breed.id),
  );

  return [
    ...profilesForSpecies.map((profile) => ({
      value: `profile:${profile.id}`,
      label: profile.display_name,
      kind: "profile" as const,
      profileId: profile.id,
    })),
    ...catalogBreeds.map((breed) => ({
      value: `breed:${breed.id}`,
      label: breed.breed_name,
      kind: "breed" as const,
      breedId: breed.id,
    })),
  ];
}

function validateForm(form: FormState) {
  const errors: string[] = [];

  if (!form.speciesId) errors.push("Choose a species.");
  if (!form.breedChoice) errors.push("Choose a breed.");
  if (!form.originDate) errors.push("Add a hatch or origin date.");
  if (!form.availableDate) errors.push("Add the pickup availability date.");

  if (form.originDate && form.availableDate && form.availableDate < form.originDate) {
    errors.push("Available date cannot be before the hatch or origin date.");
  }

  if (!form.basePrice.trim()) {
    errors.push("Add a base price.");
  } else if (!isValidMoney(form.basePrice)) {
    errors.push("Use a valid price with no more than two decimal places.");
  }

  if (form.publicDescription.trim().length > publicDescriptionMaxLength) {
    errors.push(
      `Public description must be ${publicDescriptionMaxLength} characters or less.`,
    );
  }

  return errors;
}

function validateInventory(rows: InventoryRow[]) {
  const errors: string[] = [];
  const selectedTypes = rows
    .map((row) => row.inventoryType)
    .filter((type): type is InventoryType => Boolean(type));
  const uniqueTypes = new Set(selectedTypes);
  const hasHatchingEggs = selectedTypes.includes("hatching_eggs");
  const hasLiveBirdTypes = selectedTypes.some((type) => type !== "hatching_eggs");

  if (rows.length === 0) errors.push("Add at least one bird group.");

  rows.forEach((row, index) => {
    const rowLabel = `Group ${index + 1}`;

    if (!row.inventoryType) errors.push(`${rowLabel}: choose a bird type.`);

    if (row.inventoryType === "other" && !row.customLabel.trim()) {
      errors.push(`${rowLabel}: name this group when using Other.`);
    }

    if (!isPositiveWholeNumber(row.quantityAvailable)) {
      errors.push(`${rowLabel}: quantity must be a whole number of 1 or more.`);
    }

    if (row.priceOverride.trim() && !isValidMoney(row.priceOverride)) {
      errors.push(`${rowLabel}: optional custom price must be a valid price.`);
    }
  });

  if (selectedTypes.length !== uniqueTypes.size) {
    errors.push("Use each bird type only once for this listing.");
  }

  if (hasHatchingEggs && hasLiveBirdTypes) {
    errors.push("Hatching eggs need their own listing separate from live birds.");
  }

  return errors;
}

async function upsertSellerBreedProfileForListing(
  storeId: string,
  speciesId: string,
  breedChoice: BreedChoice,
  sellerProfiles: SellerBreedProfileOption[],
  publicDescription: string,
) {
  const existingProfile =
    breedChoice.kind === "profile"
      ? sellerProfiles.find((profile) => profile.id === breedChoice.profileId)
      : null;

  if (breedChoice.kind === "profile" && !existingProfile) return null;
  if (breedChoice.kind === "breed" && !breedChoice.breedId) return null;

  const { data, error } = await supabase.rpc("seller_upsert_breed_profile", {
    p_store_id: storeId,
    p_species_id: speciesId,
    p_breed_id:
      breedChoice.kind === "profile"
        ? existingProfile?.breed_id ?? null
        : breedChoice.breedId,
    p_custom_breed_name:
      breedChoice.kind === "profile"
        ? existingProfile?.custom_breed_name ?? null
        : null,
    p_display_name: breedChoice.label,
    p_seller_description: publicDescription.trim() || null,
    p_seller_notes: existingProfile?.seller_notes ?? null,
    p_visibility_status: "active",
    p_seller_breed_profile_id:
      breedChoice.kind === "profile" ? breedChoice.profileId : null,
  });

  if (error) return null;

  const rows = Array.isArray(data)
    ? (data as { seller_breed_profile_id: string }[])
    : [];

  return rows[0]?.seller_breed_profile_id ?? null;
}

function buildInventoryPayload(rows: InventoryRow[]) {
  return rows.map((row, index) => ({
    inventory_type: row.inventoryType,
    custom_inventory_label:
      row.inventoryType === "other" ? row.customLabel.trim() : null,
    quantity_available: Number(row.quantityAvailable),
    price_override: row.priceOverride.trim() || null,
    sort_order: index,
    visibility_status: "active",
  }));
}

function getBatchType(rows: InventoryRow[]) {
  return rows.some((row) => row.inventoryType === "hatching_eggs")
    ? "hatching_eggs"
    : "live_animals";
}

function isValidMoney(value: string) {
  return /^\d+(\.\d{1,2})?$/.test(value.trim());
}

function isPositiveWholeNumber(value: string) {
  return /^[1-9]\d*$/.test(value.trim());
}

function ValidationMessage({ errors }: { errors: string[] }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <h2 className="text-sm font-semibold text-amber-950">
        A few details need attention
      </h2>
      <ul className="mt-2 grid gap-1 text-sm leading-6 text-amber-800">
        {errors.map((item) => (
          <li key={item}>- {item}</li>
        ))}
      </ul>
    </div>
  );
}

function formatInventoryType(row: InventoryRow) {
  if (row.inventoryType === "other") {
    return row.customLabel.trim() || "Other";
  }

  return (
    inventoryTypeOptions.find((option) => option.value === row.inventoryType)
      ?.label ?? "Inventory row"
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function formatCurrency(value: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value));
}
