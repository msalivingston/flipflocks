"use client";

import { useState } from "react";
import { formatPhoneInput, isPhoneInputValid } from "@/lib/phone-input";
import { supabase } from "@/lib/supabase";

type Step2Errors = {
  billingAddress?: string;
  city?: string;
  form?: string;
  phone?: string;
  postalCode?: string;
  state?: string;
  storeName?: string;
};

type BootstrapStoreResponse = {
  next_step: number;
  profile_complete: boolean;
  store_id: string;
  store_name: string;
  store_slug: string;
};

type Step2FormProps = {
  initialValues?: {
    billingAddress?: string | null;
    city?: string | null;
    phone?: string | null;
    postalCode?: string | null;
    state?: string | null;
    storeName?: string | null;
  };
  onComplete: (store: {
    billingAddress: string;
    billingCity: string;
    billingPostalCode: string;
    billingState: string;
    phone: string;
    storeId: string;
    storeName: string | null;
  }) => void;
};

export function Step2FarmBasicsForm({
  initialValues,
  onComplete,
}: Step2FormProps) {
  const [phone, setPhone] = useState(
    formatPhoneInput(initialValues?.phone ?? ""),
  );
  const [billingAddress, setBillingAddress] = useState(
    initialValues?.billingAddress ?? "",
  );
  const [city, setCity] = useState(initialValues?.city ?? "");
  const [state, setState] = useState(initialValues?.state ?? "");
  const [postalCode, setPostalCode] = useState(initialValues?.postalCode ?? "");
  const [storeName, setStoreName] = useState(initialValues?.storeName ?? "");
  const [errors, setErrors] = useState<Step2Errors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateFarmBasics({
      billingAddress,
      city,
      phone,
      postalCode,
      state,
      storeName,
    });

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setIsSubmitting(true);
    setErrors({});

    const { data, error } = await supabase.rpc(
      "seller_bootstrap_store_from_onboarding",
      {
        p_profile: {
          billing_address_line1: billingAddress.trim(),
          billing_city: city.trim(),
          billing_country: "US",
          billing_postal_code: postalCode.trim(),
          billing_state: state.trim(),
          phone: phone.trim(),
          store_name: storeName.trim(),
        },
      },
    );

    if (error) {
      setErrors({ form: friendlyRpcError(error.message) });
      setIsSubmitting(false);
      return;
    }

    const rows = Array.isArray(data) ? (data as BootstrapStoreResponse[]) : [];
    const storeId = rows[0]?.store_id;

    if (!storeId) {
      setErrors({
        form: "Farm basics were saved, but we could not confirm the store setup. Please refresh and try again.",
      });
      setIsSubmitting(false);
      return;
    }

    onComplete({
      billingAddress: billingAddress.trim(),
      billingCity: city.trim(),
      billingPostalCode: postalCode.trim(),
      billingState: state.trim().toUpperCase(),
      phone: phone.trim(),
      storeId,
      storeName: rows[0]?.store_name ?? storeName.trim(),
    });
  }

  return (
    <section className="rounded-[0.95rem] bg-white px-4 py-5 shadow-[0_8px_24px_rgba(45,35,20,0.09)] ring-1 ring-stone-200/80 sm:px-6 sm:py-6 lg:px-7 lg:py-5">
      <h2 className="font-serif text-[1.45rem] font-semibold leading-tight text-stone-950 sm:text-[1.7rem]">
        Farm basics
      </h2>
      <p className="mt-2 text-sm font-medium leading-6 text-stone-600">
        Start with the essentials needed to create your private draft store and
        continue to plan selection.
      </p>

      <form className="mt-4 space-y-4" onSubmit={handleSubmit} noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            autoComplete="tel"
            error={errors.phone}
            helperText="Use a 10-digit US/Canada number, or begin an international number with +."
            id="phone"
            label="Phone number *"
            onChange={(value) => setPhone(formatPhoneInput(value))}
            type="tel"
            value={phone}
          />
          <Field
            autoComplete="organization"
            error={errors.storeName}
            helperText="This will be your storefront name."
            id="store-name"
            label="Farm or seller name *"
            onChange={setStoreName}
            value={storeName}
          />
        </div>

        <fieldset className="space-y-3 border-t border-stone-200 pt-4">
          <legend className="text-sm font-bold text-stone-950 sm:text-[13px]">
            Billing address
          </legend>
          <p className="-mt-2 text-sm leading-5 text-stone-500 sm:text-xs">
            Used for billing only. It is not used as your pickup address and is
            not visible to buyers.
          </p>
          <Field
            autoComplete="street-address"
            error={errors.billingAddress}
            id="billing-address"
            label="Billing address *"
            onChange={setBillingAddress}
            value={billingAddress}
          />
          <div className="grid gap-3 sm:grid-cols-[1fr_0.55fr_0.7fr]">
            <Field
              autoComplete="address-level2"
              error={errors.city}
              id="billing-city"
              label="City *"
              onChange={setCity}
              value={city}
            />
            <Field
              autoComplete="address-level1"
              error={errors.state}
              id="billing-state"
              label="State *"
              maxLength={2}
              onChange={setState}
              value={state}
            />
            <Field
              autoComplete="postal-code"
              error={errors.postalCode}
              id="billing-postal-code"
              label="ZIP code *"
              onChange={setPostalCode}
              value={postalCode}
            />
          </div>
        </fieldset>

        {errors.form ? (
          <p
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800"
            role="alert"
          >
            {errors.form}
          </p>
        ) : null}

        <button
          className="flex min-h-12 w-full items-center justify-center rounded-md bg-[#246f38] px-4 text-base font-bold text-white shadow-sm transition hover:bg-[#1c5c2d] focus:outline-none focus:ring-2 focus:ring-[#246f38] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 sm:min-h-10 sm:text-[15px]"
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting ? "Saving farm basics..." : "Continue to plans"}
        </button>
      </form>
    </section>
  );
}

type FieldProps = {
  autoComplete?: string;
  error?: string;
  helperText?: string;
  id: string;
  label: string;
  maxLength?: number;
  onChange: (value: string) => void;
  type?: "tel" | "text";
  value: string;
};

function Field({
  autoComplete,
  error,
  helperText,
  id,
  label,
  maxLength,
  onChange,
  type = "text",
  value,
}: FieldProps) {
  const errorId = `${id}-error`;
  const helperId = `${id}-helper`;

  return (
    <div>
      <label className="text-sm font-bold text-stone-950 sm:text-[13px]" htmlFor={id}>
        {label}
      </label>
      <input
        aria-describedby={error ? errorId : helperText ? helperId : undefined}
        aria-invalid={Boolean(error)}
        autoComplete={autoComplete}
        className={`mt-1 min-h-12 w-full rounded-md border bg-white px-3 text-base font-medium text-stone-950 shadow-sm outline-none transition placeholder:text-stone-400 focus:ring-2 focus:ring-[#246f38]/25 sm:min-h-10 sm:text-[14px] ${
          error
            ? "border-red-400 focus:border-red-500"
            : "border-stone-300 focus:border-[#246f38]"
        }`}
        id={id}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        type={type}
        value={value}
      />
      {helperText && !error ? (
        <p className="mt-1 text-sm text-stone-500 sm:text-xs" id={helperId}>
          {helperText}
        </p>
      ) : null}
      {error ? (
        <p className="mt-1 text-xs font-semibold text-red-700 sm:text-[13px]" id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

function validateFarmBasics({
  billingAddress,
  city,
  phone,
  postalCode,
  state,
  storeName,
}: {
  billingAddress: string;
  city: string;
  phone: string;
  postalCode: string;
  state: string;
  storeName: string;
}) {
  const nextErrors: Step2Errors = {};

  if (!phone.trim()) {
    nextErrors.phone = "Enter your phone number.";
  } else if (!isPhoneInputValid(phone, { required: true })) {
    nextErrors.phone =
      "Enter a 10-digit US/Canada phone number or begin an international number with +.";
  }
  if (!storeName.trim()) nextErrors.storeName = "Enter your farm or seller name.";
  if (!billingAddress.trim()) nextErrors.billingAddress = "Enter your billing address.";
  if (!city.trim()) nextErrors.city = "Enter your billing city.";
  if (!state.trim()) nextErrors.state = "Enter your billing state.";
  if (!postalCode.trim()) nextErrors.postalCode = "Enter your billing ZIP code.";

  return nextErrors;
}

function friendlyRpcError(message: string) {
  if (message.toLowerCase().includes("duplicate")) {
    return "That store name is already in use. Try adding your town or farm initials.";
  }
  return message || "We could not save your farm basics. Please try again.";
}
