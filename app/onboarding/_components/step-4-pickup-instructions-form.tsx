"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

type ContactPreference = "email" | "phone" | "text";

type Step6PickupDetailsFormProps = {
  initialValues?: {
    buyerContactEmailEnabled?: boolean | null;
    buyerContactPhoneEnabled?: boolean | null;
    buyerContactTextEnabled?: boolean | null;
    pickupAddressLine1?: string | null;
    pickupAddressLine2?: string | null;
    pickupCity?: string | null;
    pickupPolicy?: string | null;
    pickupPostalCode?: string | null;
    pickupState?: string | null;
  };
  onBack: () => void;
  onComplete: (values: {
    buyerContactEmailEnabled: boolean;
    buyerContactPhoneEnabled: boolean;
    buyerContactTextEnabled: boolean;
    pickupAddressLine1: string;
    pickupAddressLine2: string | null;
    pickupCity: string;
    pickupPolicy: string;
    pickupPostalCode: string;
    pickupState: string;
  }) => void;
};

type Step6Errors = {
  contactPreferences?: string;
  form?: string;
  pickupAddressLine1?: string;
  pickupCity?: string;
  pickupPolicy?: string;
  pickupPostalCode?: string;
  pickupState?: string;
};

const defaultPickupPolicy =
  "All pickups are by appointment and need at least 24 hours advance notice. At pickup, please come prepared with appropriate transport for your birds. Pet carriers sized appropriately work well. If you bring cardboard boxes, please cut air holes in advance. Please do not bring plastic tubs unless they have appropriate ventilation. Younger birds should have something so they are not standing on slick surfaces.";

const contactOptions: Array<{ key: ContactPreference; label: string }> = [
  { key: "email", label: "Email" },
  { key: "text", label: "Text message" },
  { key: "phone", label: "Phone call" },
];

export function Step6PickupDetailsForm({
  initialValues,
  onBack,
  onComplete,
}: Step6PickupDetailsFormProps) {
  const [pickupAddressLine1, setPickupAddressLine1] = useState(
    initialValues?.pickupAddressLine1 ?? "",
  );
  const [pickupAddressLine2, setPickupAddressLine2] = useState(
    initialValues?.pickupAddressLine2 ?? "",
  );
  const [pickupCity, setPickupCity] = useState(initialValues?.pickupCity ?? "");
  const [pickupState, setPickupState] = useState(initialValues?.pickupState ?? "");
  const [pickupPostalCode, setPickupPostalCode] = useState(
    initialValues?.pickupPostalCode ?? "",
  );
  const [pickupPolicy, setPickupPolicy] = useState(
    initialValues?.pickupPolicy ?? defaultPickupPolicy,
  );
  const [contactPreferences, setContactPreferences] = useState<
    Record<ContactPreference, boolean>
  >({
    email: initialValues?.buyerContactEmailEnabled ?? true,
    phone: Boolean(initialValues?.buyerContactPhoneEnabled),
    text: Boolean(initialValues?.buyerContactTextEnabled),
  });
  const [errors, setErrors] = useState<Step6Errors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  function toggleContactPreference(key: ContactPreference) {
    setContactPreferences((current) => ({ ...current, [key]: !current[key] }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validatePickupDetails({
      contactPreferences,
      pickupAddressLine1,
      pickupCity,
      pickupPolicy,
      pickupPostalCode,
      pickupState,
    });
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setErrors({});
    setIsSubmitting(true);
    const { error } = await supabase.rpc("seller_save_onboarding_pickup", {
      p_pickup: {
        email_enabled: contactPreferences.email,
        phone_enabled: contactPreferences.phone,
        pickup_address_line1: pickupAddressLine1.trim(),
        pickup_address_line2: pickupAddressLine2.trim() || null,
        pickup_city: pickupCity.trim(),
        pickup_country: "US",
        pickup_policy: pickupPolicy.trim(),
        pickup_postal_code: pickupPostalCode.trim(),
        pickup_state: pickupState.trim(),
        text_enabled: contactPreferences.text,
      },
    });

    if (error) {
      setErrors({ form: friendlyPickupError(error.message) });
      setIsSubmitting(false);
      return;
    }
    onComplete({
      buyerContactEmailEnabled: contactPreferences.email,
      buyerContactPhoneEnabled: contactPreferences.phone,
      buyerContactTextEnabled: contactPreferences.text,
      pickupAddressLine1: pickupAddressLine1.trim(),
      pickupAddressLine2: pickupAddressLine2.trim() || null,
      pickupCity: pickupCity.trim(),
      pickupPolicy: pickupPolicy.trim(),
      pickupPostalCode: pickupPostalCode.trim(),
      pickupState: pickupState.trim().toUpperCase(),
    });
  }

  return (
    <section className="rounded-[0.95rem] bg-white px-4 py-5 shadow-[0_8px_24px_rgba(45,35,20,0.09)] ring-1 ring-stone-200/80 sm:px-6 sm:py-6 lg:px-7 lg:py-6">
      <h2 className="font-serif text-[1.45rem] font-semibold leading-tight text-stone-950 sm:text-[1.7rem]">
        Pickup details
      </h2>

      <form className="mt-4 space-y-4" onSubmit={handleSubmit} noValidate>
        <fieldset className="space-y-3">
          <legend className="text-sm font-bold text-stone-950 sm:text-[13px]">
            Pickup address
          </legend>
          <p className="-mt-2 text-sm leading-5 text-stone-500 sm:text-xs">
            Your full pickup address is not shown on your public storefront.
            Buyers receive it through the appropriate order-confirmation flow.
          </p>
          <Field
            autoComplete="shipping address-line1"
            error={errors.pickupAddressLine1}
            id="pickup-address-line1"
            label="Address line 1 *"
            onChange={setPickupAddressLine1}
            value={pickupAddressLine1}
          />
          <Field
            autoComplete="shipping address-line2"
            id="pickup-address-line2"
            label="Address line 2"
            onChange={setPickupAddressLine2}
            value={pickupAddressLine2}
          />
          <div className="grid gap-3 sm:grid-cols-[1fr_0.55fr_0.7fr]">
            <Field
              autoComplete="shipping address-level2"
              error={errors.pickupCity}
              id="pickup-city"
              label="City *"
              onChange={setPickupCity}
              value={pickupCity}
            />
            <Field
              autoComplete="shipping address-level1"
              error={errors.pickupState}
              id="pickup-state"
              label="State *"
              maxLength={2}
              onChange={setPickupState}
              value={pickupState}
            />
            <Field
              autoComplete="shipping postal-code"
              error={errors.pickupPostalCode}
              id="pickup-postal-code"
              label="ZIP code *"
              onChange={setPickupPostalCode}
              value={pickupPostalCode}
            />
          </div>
        </fieldset>

        <div className="border-t border-stone-200 pt-4">
          <label className="text-sm font-bold text-stone-950 sm:text-[13px]" htmlFor="pickup-policy">
            Default pickup policy *
          </label>
          <p className="mt-1 text-sm leading-5 text-stone-500 sm:text-xs">
            Shown to buyers at checkout and included in their order confirmation.
          </p>
          <textarea
            aria-invalid={Boolean(errors.pickupPolicy)}
            className={`mt-1 min-h-40 w-full resize-y rounded-md border bg-white px-3 py-2 text-sm font-medium leading-6 text-stone-950 shadow-sm outline-none focus:ring-2 focus:ring-[#246f38]/25 ${errors.pickupPolicy ? "border-red-400" : "border-stone-300"}`}
            id="pickup-policy"
            onChange={(event) => setPickupPolicy(event.target.value)}
            rows={7}
            value={pickupPolicy}
          />
          {errors.pickupPolicy ? (
            <p className="mt-1 text-xs font-semibold text-red-700">{errors.pickupPolicy}</p>
          ) : null}
        </div>

        <fieldset className="border-t border-stone-200 pt-4">
          <legend className="text-sm font-bold text-stone-950 sm:text-[13px]">
            How may buyers contact you? *
          </legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {contactOptions.map((option) => (
              <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-stone-200 px-3 text-sm font-semibold text-stone-700 has-checked:border-[#246f38] has-checked:bg-[#eff8ed]" key={option.key}>
                <input
                  checked={contactPreferences[option.key]}
                  className="size-4 accent-[#246f38]"
                  onChange={() => toggleContactPreference(option.key)}
                  type="checkbox"
                />
                {option.label}
              </label>
            ))}
          </div>
          {errors.contactPreferences ? (
            <p className="mt-1 text-xs font-semibold text-red-700">{errors.contactPreferences}</p>
          ) : null}
        </fieldset>

        {errors.form ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800" role="alert">
            {errors.form}
          </p>
        ) : null}

        <div className="grid grid-cols-[0.42fr_1fr] gap-3">
          <button className="flex min-h-12 items-center justify-center rounded-md border border-stone-300 bg-white px-4 text-base font-bold text-stone-700" disabled={isSubmitting} onClick={onBack} type="button">
            Back
          </button>
          <button className="flex min-h-12 items-center justify-center rounded-md bg-[#246f38] px-4 text-base font-bold text-white disabled:opacity-70" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Saving pickup details..." : "Save pickup details"}
          </button>
        </div>
      </form>
    </section>
  );
}

function Field({
  autoComplete,
  error,
  id,
  label,
  maxLength,
  onChange,
  value,
}: {
  autoComplete?: string;
  error?: string;
  id: string;
  label: string;
  maxLength?: number;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <div>
      <label className="text-sm font-bold text-stone-950 sm:text-[13px]" htmlFor={id}>{label}</label>
      <input
        aria-invalid={Boolean(error)}
        autoComplete={autoComplete}
        className={`mt-1 min-h-12 w-full rounded-md border bg-white px-3 text-base font-medium text-stone-950 shadow-sm outline-none focus:ring-2 focus:ring-[#246f38]/25 sm:min-h-10 sm:text-[14px] ${error ? "border-red-400" : "border-stone-300"}`}
        id={id}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
      {error ? <p className="mt-1 text-xs font-semibold text-red-700">{error}</p> : null}
    </div>
  );
}

function validatePickupDetails({
  contactPreferences,
  pickupAddressLine1,
  pickupCity,
  pickupPolicy,
  pickupPostalCode,
  pickupState,
}: {
  contactPreferences: Record<ContactPreference, boolean>;
  pickupAddressLine1: string;
  pickupCity: string;
  pickupPolicy: string;
  pickupPostalCode: string;
  pickupState: string;
}) {
  const nextErrors: Step6Errors = {};
  if (!pickupAddressLine1.trim()) nextErrors.pickupAddressLine1 = "Enter your pickup address.";
  if (!pickupCity.trim()) nextErrors.pickupCity = "Enter your pickup city.";
  if (!pickupState.trim()) nextErrors.pickupState = "Enter your pickup state.";
  if (!pickupPostalCode.trim()) nextErrors.pickupPostalCode = "Enter your pickup ZIP code.";
  if (!pickupPolicy.trim()) nextErrors.pickupPolicy = "Enter a pickup policy.";
  if (!Object.values(contactPreferences).some(Boolean)) {
    nextErrors.contactPreferences =
      "Choose at least one contact method to display on your storefront.";
  }
  return nextErrors;
}

function friendlyPickupError(message: string) {
  return message || "We could not save your pickup details. Please try again.";
}
