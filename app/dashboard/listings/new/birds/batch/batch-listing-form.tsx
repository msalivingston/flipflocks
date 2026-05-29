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
import {
  calculateAdjustedUnitPrice,
  calculateAgeAtAvailabilityDays,
  formatAgeAtAvailability,
  type PriceAdjustmentDirection,
} from "../../../../_lib/listing-formatters";
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

type InventoryType =
  | "female"
  | "male"
  | "straight_run"
  | "unsexed"
  | "pair"
  | "trio"
  | "other";

type WorkflowStep = "batch" | "inventory" | "review";

type BatchFormState = {
  speciesId: string;
  hatchDate: string;
  availableDate: string;
  basePrice: string;
  autoPriceAdjustmentEnabled: boolean;
  priceAdjustmentDirection: PriceAdjustmentDirection;
  priceAdjustmentAmount: string;
  priceAdjustmentIntervalWeeks: string;
  priceAdjustmentMaxPrice: string;
  priceAdjustmentMinPrice: string;
  internalLabel: string;
  sellerNotes: string;
};

type InventoryRow = {
  id: string;
  breedChoice: string;
  inventoryType: InventoryType | "";
  customLabel: string;
  quantityAvailable: string;
  priceOverride: string;
  sellerNotes: string;
};

type CreateListingBatchResult = {
  listing_batch_id: string;
};

type UpsertBreedProfileResult = {
  seller_breed_profile_id: string;
};

type BatchSellerBreedProfileOption = SellerBreedProfileOption & {
  moderation_status: string;
};

type BreedProfileResolution =
  | {
      ok: true;
      profileId: string;
    }
  | {
      ok: false;
      message: string;
    };

const emptyBatchForm: BatchFormState = {
  speciesId: "",
  hatchDate: "",
  availableDate: "",
  basePrice: "",
  autoPriceAdjustmentEnabled: false,
  priceAdjustmentDirection: "increase",
  priceAdjustmentAmount: "",
  priceAdjustmentIntervalWeeks: "1",
  priceAdjustmentMaxPrice: "",
  priceAdjustmentMinPrice: "",
  internalLabel: "",
  sellerNotes: "",
};

const inventoryTypeOptions: { label: string; value: InventoryType }[] = [
  { label: "Female (pullet or hen)", value: "female" },
  { label: "Male (cockerel or rooster)", value: "male" },
  { label: "Straight run", value: "straight_run" },
  { label: "Unsexed", value: "unsexed" },
  { label: "Pair", value: "pair" },
  { label: "Trio", value: "trio" },
  { label: "Other", value: "other" },
];

const firstInventoryRow: InventoryRow = {
  id: "batch-row-1",
  breedChoice: "",
  inventoryType: "",
  customLabel: "",
  quantityAvailable: "",
  priceOverride: "",
  sellerNotes: "",
};

export function BatchListingForm() {
  const { seller } = useSellerContext();
  const router = useRouter();
  const storeId = seller?.store_id ?? "";
  const [species, setSpecies] = useState<ReferenceSpecies[]>([]);
  const [breeds, setBreeds] = useState<ReferenceBreed[]>([]);
  const [sellerProfiles, setSellerProfiles] = useState<
    SellerBreedProfileOption[]
  >([]);
  const [allSellerProfiles, setAllSellerProfiles] = useState<
    BatchSellerBreedProfileOption[]
  >([]);
  const [form, setForm] = useState<BatchFormState>(emptyBatchForm);
  const [rows, setRows] = useState<InventoryRow[]>([firstInventoryRow]);
  const [step, setStep] = useState<WorkflowStep>("batch");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
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
            "id, species_id, breed_id, custom_breed_name, display_name, seller_description, seller_notes, visibility_status, moderation_status",
          )
          .eq("store_id", storeId)
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
      const loadedSellerProfiles = (profileResult.data ??
        []) as BatchSellerBreedProfileOption[];
      const defaultSpecies =
        loadedSpecies.find((item) => item.slug === "chicken") ??
        loadedSpecies[0] ??
        null;

      setSpecies(loadedSpecies);
      setBreeds((breedResult.data ?? []) as ReferenceBreed[]);
      setAllSellerProfiles(loadedSellerProfiles);
      setSellerProfiles(
        loadedSellerProfiles.filter(
          (profile) => profile.visibility_status === "active",
        ),
      );
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
    [breeds, form.speciesId, sellerProfiles],
  );
  const derivedAgeDays = calculateAgeAtAvailabilityDays(
    form.hatchDate,
    form.availableDate,
  );

  function updateField<TKey extends keyof BatchFormState>(
    key: TKey,
    value: BatchFormState[TKey],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
    setValidationErrors([]);
    setSaveError(null);
  }

  function handleBatchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors = validateBatchForm(form);
    setValidationErrors(nextErrors);

    if (nextErrors.length === 0) {
      setStep("inventory");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function handleInventorySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors = validateInventoryRows(rows, breedChoices);
    setValidationErrors(nextErrors);

    if (nextErrors.length === 0) {
      setStep("review");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  async function handleSave() {
    if (!seller) return;

    const nextErrors = [
      ...validateBatchForm(form),
      ...validateInventoryRows(rows, breedChoices),
    ];
    setValidationErrors(nextErrors);

    if (nextErrors.length > 0) return;

    setIsSaving(true);
    setSaveError(null);

    const profileIdsByChoice = new Map<string, string>();

    for (const breedChoiceValue of uniqueSorted(
      rows.map((row) => row.breedChoice),
    )) {
      const breedChoice = breedChoices.find(
        (choice) => choice.value === breedChoiceValue,
      );

      if (!breedChoice) {
        setSaveError("One of the selected breeds could not be found.");
        setIsSaving(false);
        return;
      }

      const profileResolution = await resolveSellerBreedProfileForListing(
        seller.store_id,
        form.speciesId,
        breedChoice,
        sellerProfiles,
        allSellerProfiles,
      );

      if (!profileResolution.ok) {
        console.warn("Batch listing breed preparation failed", {
          breedChoice,
          reason: profileResolution.message,
        });
        setSaveError(
          `${breedChoice.label} could not be prepared for this store. Please try again.`,
        );
        setIsSaving(false);
        return;
      }

      profileIdsByChoice.set(breedChoice.value, profileResolution.profileId);
    }

    const breedGroupsPayload = buildBreedGroupsPayload(rows, profileIdsByChoice);

    if (process.env.NODE_ENV !== "production") {
      console.debug("Batch listing create payload", {
        speciesId: form.speciesId,
        hatchDate: form.hatchDate,
        availableDate: form.availableDate,
        breedGroups: breedGroupsPayload,
      });
    }

    const createResult = await supabase.rpc(
      "seller_create_listing_batch_with_inventory",
      {
        p_store_id: seller.store_id,
        p_species_id: form.speciesId,
        p_batch_type: "live_animals",
        p_origin_date: form.hatchDate,
        p_available_date: form.availableDate,
        p_base_price: Number(form.basePrice),
        p_breed_groups: breedGroupsPayload,
        p_auto_price_increase_enabled: false,
        p_auto_price_increase_amount: null,
        p_auto_price_increase_max_price: null,
        p_internal_batch_label: form.internalLabel.trim() || null,
        p_seller_notes: form.sellerNotes.trim() || null,
        p_visibility_status: "hidden",
      },
    );

    if (createResult.error) {
      console.warn("Batch listing create failed", {
        error: createResult.error,
        breedGroupsPayload,
      });
      setSaveError(createResult.error.message);
      setIsSaving(false);
      return;
    }

    const createdRows = Array.isArray(createResult.data)
      ? (createResult.data as CreateListingBatchResult[])
      : [];
    const listingBatchId = createdRows[0]?.listing_batch_id;

    if (listingBatchId) {
      const priceAdjustmentResult = await supabase.rpc(
        "seller_set_listing_batch_price_adjustment",
        buildPriceAdjustmentPayload(listingBatchId, form),
      );

      if (priceAdjustmentResult.error) {
        setSaveError(priceAdjustmentResult.error.message);
        setIsSaving(false);
        return;
      }
    }

    window.sessionStorage.setItem(
      "flipflocksListingCreatedMessage",
      "Batch listing saved privately. It is hidden until you choose to publish it.",
    );

    if (listingBatchId) {
      router.push(`/dashboard/listings/${listingBatchId}`);
    } else {
      router.push("/dashboard/listings");
    }
  }

  if (isLoading) {
    return (
      <>
        <Header />
        <main className="mx-auto w-full max-w-4xl px-5 py-5 sm:px-7">
          <LoadingState label="Loading batch listing setup" />
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
            title="Batch listing setup could not load"
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

        {step === "batch" ? (
          <BatchStep
            ageDays={derivedAgeDays}
            form={form}
            species={species}
            validationErrors={validationErrors}
            onSubmit={handleBatchSubmit}
            updateField={updateField}
            onSpeciesChange={(speciesId) => {
              setForm((current) => ({ ...current, speciesId }));
              setRows((current) =>
                current.map((row) => ({ ...row, breedChoice: "" })),
              );
              setValidationErrors([]);
              setSaveError(null);
            }}
          />
        ) : null}

        {step === "inventory" ? (
          <InventoryStep
            breedChoices={breedChoices}
            rows={rows}
            setRows={setRows}
            validationErrors={validationErrors}
            onBack={() => {
              setValidationErrors([]);
              setStep("batch");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            onSubmit={handleInventorySubmit}
          />
        ) : null}

        {step === "review" ? (
          <ReviewStep
            ageDays={derivedAgeDays}
            breedChoices={breedChoices}
            form={form}
            isSaving={isSaving}
            rows={rows}
            saveError={saveError}
            speciesName={selectedSpecies?.common_name ?? "Selected species"}
            validationErrors={validationErrors}
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
      title="Batch / Mixed Group"
      description="Create one hatch group with multiple breeds, bird types, quantities, and optional row pricing."
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
    { label: "Batch", value: "batch" },
    { label: "Inventory", value: "inventory" },
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

function BatchStep({
  ageDays,
  form,
  onSpeciesChange,
  onSubmit,
  species,
  updateField,
  validationErrors,
}: {
  ageDays: number | null;
  form: BatchFormState;
  onSpeciesChange: (speciesId: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  species: ReferenceSpecies[];
  updateField: <TKey extends keyof BatchFormState>(
    key: TKey,
    value: BatchFormState[TKey],
  ) => void;
  validationErrors: string[];
}) {
  return (
    <SellerCard className="p-5">
      <form className="grid gap-5" onSubmit={onSubmit}>
        <div>
          <h2 className="text-xl font-semibold text-stone-950">
            Batch information
          </h2>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            Add the shared hatch group details first. Age is derived from hatch
            and available dates.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-1 text-sm font-semibold text-stone-700">
            Species
            <select
              className="seller-form-field"
              value={form.speciesId}
              onChange={(event) => onSpeciesChange(event.target.value)}
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
            Batch / listing name
            <input
              className="seller-form-field"
              maxLength={120}
              placeholder="Example: May hatch mixed pullets"
              value={form.internalLabel}
              onChange={(event) =>
                updateField("internalLabel", event.target.value)
              }
            />
            <span className="text-xs font-normal leading-5 text-stone-500">
              This names the batch in your seller tools.
            </span>
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-1 text-sm font-semibold text-stone-700">
            Hatch date
            <input
              className="seller-form-field"
              type="date"
              value={form.hatchDate}
              onChange={(event) => updateField("hatchDate", event.target.value)}
            />
          </label>

          <label className="grid gap-1 text-sm font-semibold text-stone-700">
            Available date
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

        <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-900">
          <span className="font-semibold">Derived age:</span>{" "}
          {formatAgeAtAvailability(ageDays)}
        </div>

        <label className="grid gap-1 text-sm font-semibold text-stone-700">
          Default price per bird
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
              onChange={(event) => updateField("basePrice", event.target.value)}
            />
          </div>
          <span className="text-xs font-normal leading-5 text-stone-500">
            Rows can override this price when a breed or bird type should cost
            more or less.
          </span>
        </label>

        <fieldset className="grid gap-3 rounded-lg border border-stone-200 bg-stone-50 p-4">
          <label className="flex items-start gap-3 text-sm font-semibold text-stone-800">
            <input
              checked={form.autoPriceAdjustmentEnabled}
              className="mt-1 h-4 w-4 rounded border-stone-300 text-emerald-800 focus:ring-emerald-700"
              type="checkbox"
              onChange={(event) =>
                updateField("autoPriceAdjustmentEnabled", event.target.checked)
              }
            />
            <span>
              Automatically adjust this batch price after the available date
            </span>
          </label>

          {form.autoPriceAdjustmentEnabled ? (
            <div className="grid gap-3">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-1 text-sm font-semibold text-stone-700">
                  Direction
                  <select
                    className="seller-form-field"
                    value={form.priceAdjustmentDirection}
                    onChange={(event) => {
                      updateField(
                        "priceAdjustmentDirection",
                        event.target.value as PriceAdjustmentDirection,
                      );
                      updateField("priceAdjustmentMaxPrice", "");
                      updateField("priceAdjustmentMinPrice", "");
                    }}
                  >
                    <option value="increase">Increase</option>
                    <option value="decrease">Decrease</option>
                  </select>
                </label>

                <label className="grid gap-1 text-sm font-semibold text-stone-700">
                  Every
                  <div className="flex items-center gap-2">
                    <input
                      className="seller-form-field"
                      inputMode="numeric"
                      min="1"
                      step="1"
                      type="number"
                      value={form.priceAdjustmentIntervalWeeks}
                      onChange={(event) =>
                        updateField(
                          "priceAdjustmentIntervalWeeks",
                          event.target.value,
                        )
                      }
                    />
                    <span className="text-sm font-normal text-stone-600">
                      week(s)
                    </span>
                  </div>
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-1 text-sm font-semibold text-stone-700">
                  Amount
                  <MoneyInput
                    value={form.priceAdjustmentAmount}
                    onChange={(value) =>
                      updateField("priceAdjustmentAmount", value)
                    }
                  />
                </label>

                {form.priceAdjustmentDirection === "increase" ? (
                  <label className="grid gap-1 text-sm font-semibold text-stone-700">
                    Maximum price
                    <MoneyInput
                      value={form.priceAdjustmentMaxPrice}
                      onChange={(value) =>
                        updateField("priceAdjustmentMaxPrice", value)
                      }
                    />
                  </label>
                ) : (
                  <label className="grid gap-1 text-sm font-semibold text-stone-700">
                    Minimum price
                    <MoneyInput
                      value={form.priceAdjustmentMinPrice}
                      onChange={(value) =>
                        updateField("priceAdjustmentMinPrice", value)
                      }
                    />
                  </label>
                )}
              </div>

              <div className="rounded-md border border-emerald-100 bg-white px-3 py-2 text-sm leading-6 text-stone-700">
                Current default price preview:{" "}
                <span className="font-semibold text-stone-950">
                  {formatCurrencyNumber(
                    calculateAdjustedUnitPrice(Number(form.basePrice), {
                      enabled: form.autoPriceAdjustmentEnabled,
                      direction: form.priceAdjustmentDirection,
                      amount: Number(form.priceAdjustmentAmount),
                      intervalWeeks: Number(form.priceAdjustmentIntervalWeeks),
                      maxPrice: form.priceAdjustmentMaxPrice.trim()
                        ? Number(form.priceAdjustmentMaxPrice)
                        : null,
                      minPrice: form.priceAdjustmentMinPrice.trim()
                        ? Number(form.priceAdjustmentMinPrice)
                        : null,
                      availableDate: form.availableDate,
                    }),
                  )}
                </span>
              </div>
            </div>
          ) : null}
        </fieldset>

        <label className="grid gap-1 text-sm font-semibold text-stone-700">
          Batch notes
          <textarea
            className="seller-form-field min-h-28 resize-y py-3"
            placeholder="Private reminders like brooder group, source pen, vaccination, or handling notes."
            value={form.sellerNotes}
            onChange={(event) => updateField("sellerNotes", event.target.value)}
          />
        </label>

        {validationErrors.length > 0 ? (
          <ValidationMessage errors={validationErrors} />
        ) : null}

        <div className="flex flex-col gap-3 border-t border-stone-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm leading-6 text-stone-600">
            Next you will add each breed and inventory type in this hatch group.
          </p>
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-stone-950 px-5 text-sm font-semibold text-white transition hover:bg-stone-800 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
            type="submit"
          >
            Continue to Inventory
          </button>
        </div>
      </form>
    </SellerCard>
  );
}

function InventoryStep({
  breedChoices,
  onBack,
  onSubmit,
  rows,
  setRows,
  validationErrors,
}: {
  breedChoices: BreedChoice[];
  onBack: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  rows: InventoryRow[];
  setRows: Dispatch<SetStateAction<InventoryRow[]>>;
  validationErrors: string[];
}) {
  function updateRow(rowId: string, updates: Partial<InventoryRow>) {
    setRows((current) =>
      current.map((row) => (row.id === rowId ? { ...row, ...updates } : row)),
    );
  }

  function addRow() {
    setRows((current) => [
      ...current,
      {
        ...firstInventoryRow,
        id: crypto.randomUUID(),
      },
    ]);
  }

  function removeRow(rowId: string) {
    setRows((current) => current.filter((row) => row.id !== rowId));
  }

  return (
    <SellerCard className="p-5">
      <form className="grid gap-5" onSubmit={onSubmit}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-stone-950">
              Inventory rows
            </h2>
            <p className="mt-1 text-sm leading-6 text-stone-600">
              Add each breed and bird type available from this shared batch.
            </p>
          </div>
          <button className="seller-secondary-button" onClick={addRow} type="button">
            Add Row
          </button>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 px-4 py-6 text-center text-sm leading-6 text-stone-600">
            No inventory rows yet. Add at least one breed row before saving.
          </div>
        ) : null}

        <div className="grid gap-4">
          {rows.map((row, index) => (
            <div
              key={row.id}
              className="rounded-lg border border-stone-200 bg-stone-50 p-4"
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <h3 className="font-semibold text-stone-950">
                  Row {index + 1}
                </h3>
                <button
                  className="seller-small-button"
                  onClick={() => removeRow(row.id)}
                  type="button"
                >
                  Remove
                </button>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-1 text-sm font-semibold text-stone-700">
                  Breed
                  <select
                    className="seller-form-field"
                    value={row.breedChoice}
                    onChange={(event) =>
                      updateRow(row.id, { breedChoice: event.target.value })
                    }
                  >
                    <option value="">Choose breed</option>
                    {breedChoices.map((choice) => (
                      <option key={choice.value} value={choice.value}>
                        {choice.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-1 text-sm font-semibold text-stone-700">
                  Inventory type
                  <select
                    className="seller-form-field"
                    value={row.inventoryType}
                    onChange={(event) =>
                      updateRow(row.id, {
                        inventoryType: event.target.value as
                          | InventoryType
                          | "",
                        customLabel:
                          event.target.value === "other" ? row.customLabel : "",
                      })
                    }
                  >
                    <option value="">Choose type</option>
                    {inventoryTypeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {row.inventoryType === "other" ? (
                <label className="mt-4 grid gap-1 text-sm font-semibold text-stone-700">
                  Name this type
                  <input
                    className="seller-form-field"
                    placeholder="Example: Started pullets"
                    value={row.customLabel}
                    onChange={(event) =>
                      updateRow(row.id, { customLabel: event.target.value })
                    }
                  />
                </label>
              ) : null}

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="grid gap-1 text-sm font-semibold text-stone-700">
                  Quantity
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

                <label className="grid gap-1 text-sm font-semibold text-stone-700">
                  Optional row price
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
                </label>
              </div>

              <label className="mt-4 grid gap-1 text-sm font-semibold text-stone-700">
                Row notes
                <textarea
                  className="seller-form-field min-h-20 resize-y py-3"
                  placeholder="Optional private notes for this row."
                  value={row.sellerNotes}
                  onChange={(event) =>
                    updateRow(row.id, { sellerNotes: event.target.value })
                  }
                />
              </label>
            </div>
          ))}
        </div>

        {validationErrors.length > 0 ? (
          <ValidationMessage errors={validationErrors} />
        ) : null}

        <div className="flex flex-col gap-3 border-t border-stone-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <button className="seller-secondary-button" onClick={onBack} type="button">
            Back to Batch
          </button>
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-stone-950 px-5 text-sm font-semibold text-white transition hover:bg-stone-800 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
            type="submit"
          >
            Review Batch
          </button>
        </div>
      </form>
    </SellerCard>
  );
}

function ReviewStep({
  ageDays,
  breedChoices,
  form,
  isSaving,
  onBack,
  onSave,
  rows,
  saveError,
  speciesName,
  validationErrors,
}: {
  ageDays: number | null;
  breedChoices: BreedChoice[];
  form: BatchFormState;
  isSaving: boolean;
  onBack: () => void;
  onSave: () => void;
  rows: InventoryRow[];
  saveError: string | null;
  speciesName: string;
  validationErrors: string[];
}) {
  return (
    <SellerCard className="p-5">
      <p className="text-sm font-semibold uppercase tracking-[0.08em] text-emerald-800">
        Review
      </p>
      <h2 className="mt-2 text-xl font-semibold text-stone-950">
        Save this batch privately?
      </h2>
      <p className="mt-2 text-sm leading-6 text-stone-600">
        The batch will stay hidden from buyers until you review and publish it.
      </p>

      <dl className="mt-5 grid gap-3 rounded-lg border border-stone-200 bg-stone-50 p-4 text-sm sm:grid-cols-2">
        <ReviewItem label="Species" value={speciesName} />
        <ReviewItem
          label="Batch name"
          value={form.internalLabel.trim() || "No batch name"}
        />
        <ReviewItem label="Hatch date" value={formatDate(form.hatchDate)} />
        <ReviewItem
          label="Available date"
          value={formatDate(form.availableDate)}
        />
        <ReviewItem
          label="Derived age"
          value={formatAgeAtAvailability(ageDays)}
        />
        <ReviewItem
          label="Default price"
          value={formatCurrency(form.basePrice)}
        />
        <ReviewItem
          label="Price adjustment"
          value={formatPriceAdjustmentSummary(form)}
        />
      </dl>

      <div className="mt-5">
        <h3 className="text-base font-semibold text-stone-950">
          Inventory ({rows.length} row{rows.length === 1 ? "" : "s"})
        </h3>
        <div className="mt-3 grid gap-3">
          {rows.map((row) => (
            <div
              key={row.id}
              className="rounded-lg border border-stone-200 bg-white p-4 text-sm"
            >
              <p className="font-semibold text-stone-950">
                {getBreedLabel(row.breedChoice, breedChoices)}
              </p>
              <p className="mt-1 text-stone-600">
                {formatInventoryType(row)} - Quantity:{" "}
                <span className="font-semibold text-stone-950">
                  {row.quantityAvailable}
                </span>
              </p>
              <p className="mt-1 text-stone-600">
                Row price:{" "}
                {row.priceOverride.trim()
                  ? formatCurrency(row.priceOverride)
                  : "Uses default price"}
              </p>
            </div>
          ))}
        </div>
      </div>

      {validationErrors.length > 0 ? (
        <ValidationMessage errors={validationErrors} />
      ) : null}

      {saveError ? (
        <ErrorState
          title="Batch listing was not saved"
          message={saveError}
        />
      ) : null}

      <div className="mt-5 flex flex-col gap-3 border-t border-stone-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <button className="seller-secondary-button" onClick={onBack} type="button">
          Back to Inventory
        </button>
        <button
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-stone-950 px-5 text-sm font-semibold text-white transition hover:bg-stone-800 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 disabled:cursor-wait disabled:opacity-70"
          disabled={isSaving}
          onClick={onSave}
          type="button"
        >
          {isSaving ? "Saving" : "Save Private Batch"}
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

function validateBatchForm(form: BatchFormState) {
  const errors: string[] = [];

  if (!form.speciesId) errors.push("Choose a species.");
  if (!form.hatchDate) errors.push("Add a hatch date.");
  if (!form.availableDate) errors.push("Add an available date.");

  if (
    form.hatchDate &&
    form.availableDate &&
    form.availableDate < form.hatchDate
  ) {
    errors.push("Available date cannot be before the hatch date.");
  }

  if (!form.basePrice.trim()) {
    errors.push("Add a default price.");
  } else if (!isValidMoney(form.basePrice)) {
    errors.push("Default price must be a valid price.");
  }

  errors.push(...validatePriceAdjustmentFields(form));

  return errors;
}

function validateInventoryRows(
  rows: InventoryRow[],
  breedChoices: BreedChoice[],
) {
  const errors: string[] = [];
  const rowKeys = new Set<string>();

  if (rows.length === 0) errors.push("Add at least one inventory row.");

  rows.forEach((row, index) => {
    const rowLabel = `Row ${index + 1}`;
    const breedChoice = breedChoices.find(
      (choice) => choice.value === row.breedChoice,
    );

    if (!row.breedChoice || !breedChoice) errors.push(`${rowLabel}: choose a breed.`);
    if (!row.inventoryType) errors.push(`${rowLabel}: choose an inventory type.`);

    if (row.inventoryType === "other" && !row.customLabel.trim()) {
      errors.push(`${rowLabel}: name this type when using Other.`);
    }

    if (!isPositiveWholeNumber(row.quantityAvailable)) {
      errors.push(`${rowLabel}: quantity must be a whole number of 1 or more.`);
    }

    if (row.priceOverride.trim() && !isValidMoney(row.priceOverride)) {
      errors.push(`${rowLabel}: optional row price must be a valid price.`);
    }

    if (row.breedChoice && row.inventoryType) {
      const rowKey = `${row.breedChoice}:${row.inventoryType}`;

      if (rowKeys.has(rowKey)) {
        errors.push(
          `${rowLabel}: this breed already has that inventory type in the batch.`,
        );
      }

      rowKeys.add(rowKey);
    }
  });

  return errors;
}

function validatePriceAdjustmentFields(form: BatchFormState) {
  const errors: string[] = [];

  if (!form.autoPriceAdjustmentEnabled) return errors;

  if (!isValidPositiveMoney(form.priceAdjustmentAmount)) {
    errors.push("Price adjustment amount must be greater than zero.");
  }

  if (!isPositiveWholeNumber(form.priceAdjustmentIntervalWeeks)) {
    errors.push("Price adjustment interval must be one week or more.");
  }

  if (
    form.priceAdjustmentDirection === "increase" &&
    form.priceAdjustmentMaxPrice.trim() &&
    !isValidMoney(form.priceAdjustmentMaxPrice)
  ) {
    errors.push("Maximum price must be a valid price.");
  }

  if (
    form.priceAdjustmentDirection === "decrease" &&
    form.priceAdjustmentMinPrice.trim() &&
    !isValidMoney(form.priceAdjustmentMinPrice)
  ) {
    errors.push("Minimum price must be a valid price.");
  }

  return errors;
}

async function resolveSellerBreedProfileForListing(
  storeId: string,
  speciesId: string,
  breedChoice: BreedChoice,
  sellerProfiles: SellerBreedProfileOption[],
  allSellerProfiles: BatchSellerBreedProfileOption[],
): Promise<BreedProfileResolution> {
  const existingProfile =
    breedChoice.kind === "profile"
      ? sellerProfiles.find((profile) => profile.id === breedChoice.profileId)
      : null;

  if (breedChoice.kind === "profile") {
    if (!existingProfile) {
      return {
        ok: false,
        message: "Selected seller breed profile was not loaded.",
      };
    }

    if (existingProfile.species_id !== speciesId) {
      return {
        ok: false,
        message: "Selected seller breed profile does not match species.",
      };
    }

    return { ok: true, profileId: existingProfile.id };
  }

  if (!breedChoice.breedId) {
    return {
      ok: false,
      message: "Selected catalog breed did not include a breed id.",
    };
  }

  const existingCatalogProfile = allSellerProfiles.find(
    (profile) =>
      profile.species_id === speciesId &&
      profile.breed_id === breedChoice.breedId,
  );

  if (existingCatalogProfile) {
    return { ok: true, profileId: existingCatalogProfile.id };
  }

  const { data, error } = await supabase.rpc("seller_upsert_breed_profile", {
    p_store_id: storeId,
    p_species_id: speciesId,
    p_breed_id: breedChoice.breedId,
    p_custom_breed_name: null,
    p_display_name: breedChoice.label,
    p_seller_description: null,
    p_seller_notes: null,
    p_visibility_status: "active",
    p_seller_breed_profile_id: null,
  });

  if (error) {
    return { ok: false, message: error.message };
  }

  const profileRows = Array.isArray(data)
    ? (data as UpsertBreedProfileResult[])
    : [];

  const profileId = profileRows[0]?.seller_breed_profile_id;

  if (!profileId) {
    return {
      ok: false,
      message: "Breed profile RPC returned no profile id.",
    };
  }

  return { ok: true, profileId };
}

function buildBreedGroupsPayload(
  rows: InventoryRow[],
  profileIdsByChoice: Map<string, string>,
) {
  const rowsByBreedChoice = new Map<string, InventoryRow[]>();

  rows.forEach((row) => {
    rowsByBreedChoice.set(row.breedChoice, [
      ...(rowsByBreedChoice.get(row.breedChoice) ?? []),
      row,
    ]);
  });

  return Array.from(rowsByBreedChoice.entries()).map(
    ([breedChoice, breedRows], breedIndex) => ({
      seller_breed_profile_id: profileIdsByChoice.get(breedChoice),
      sort_order: breedIndex,
      visibility_status: "active",
      inventory_items: breedRows.map((row, rowIndex) =>
        buildInventoryItemPayload(row, rowIndex),
      ),
    }),
  );
}

function buildInventoryItemPayload(row: InventoryRow, sortOrder: number) {
  const inventoryType = row.inventoryType;

  if (!inventoryType) {
    throw new Error("Inventory type is required before building save payload.");
  }

  return {
    inventory_type: inventoryType,
    custom_inventory_label:
      inventoryType === "other" ? row.customLabel.trim() : null,
    quantity_available: Number(row.quantityAvailable),
    price_override: row.priceOverride.trim() || null,
    sort_order: sortOrder,
    visibility_status: "active",
    seller_notes: row.sellerNotes.trim() || null,
  };
}

function buildPriceAdjustmentPayload(
  listingBatchId: string,
  form: BatchFormState,
) {
  return {
    p_listing_batch_id: listingBatchId,
    p_auto_price_adjustment_enabled: form.autoPriceAdjustmentEnabled,
    p_price_adjustment_direction: form.autoPriceAdjustmentEnabled
      ? form.priceAdjustmentDirection
      : null,
    p_price_adjustment_amount: form.autoPriceAdjustmentEnabled
      ? Number(form.priceAdjustmentAmount)
      : null,
    p_price_adjustment_interval_weeks: form.autoPriceAdjustmentEnabled
      ? Number(form.priceAdjustmentIntervalWeeks)
      : null,
    p_price_adjustment_max_price:
      form.autoPriceAdjustmentEnabled &&
      form.priceAdjustmentDirection === "increase" &&
      form.priceAdjustmentMaxPrice.trim()
        ? Number(form.priceAdjustmentMaxPrice)
        : null,
    p_price_adjustment_min_price:
      form.autoPriceAdjustmentEnabled &&
      form.priceAdjustmentDirection === "decrease" &&
      form.priceAdjustmentMinPrice.trim()
        ? Number(form.priceAdjustmentMinPrice)
        : null,
  };
}

function getBreedLabel(value: string, breedChoices: BreedChoice[]) {
  return (
    breedChoices.find((choice) => choice.value === value)?.label ??
    "Selected breed"
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

function isValidMoney(value: string) {
  return /^\d+(\.\d{1,2})?$/.test(value.trim());
}

function isValidPositiveMoney(value: string) {
  return isValidMoney(value) && Number(value) > 0;
}

function isPositiveWholeNumber(value: string) {
  return /^[1-9]\d*$/.test(value.trim());
}

function formatDate(value: string) {
  if (!value) return "Not set";

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
  }).format(Number(value || 0));
}

function formatCurrencyNumber(value: number | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value ?? 0);
}

function formatPriceAdjustmentSummary(form: BatchFormState) {
  if (!form.autoPriceAdjustmentEnabled) return "No automatic adjustment";

  const direction =
    form.priceAdjustmentDirection === "increase" ? "Increase" : "Decrease";
  const cap =
    form.priceAdjustmentDirection === "increase"
      ? form.priceAdjustmentMaxPrice.trim()
        ? `, max ${formatCurrency(form.priceAdjustmentMaxPrice)}`
        : ""
      : form.priceAdjustmentMinPrice.trim()
        ? `, min ${formatCurrency(form.priceAdjustmentMinPrice)}`
        : "";

  return `${direction} ${formatCurrency(
    form.priceAdjustmentAmount,
  )} every ${form.priceAdjustmentIntervalWeeks || "?"} week${
    form.priceAdjustmentIntervalWeeks === "1" ? "" : "s"
  } after available date${cap}`;
}

function MoneyInput({
  onChange,
  value,
}: {
  onChange: (value: string) => void;
  value: string;
}) {
  return (
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
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
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
