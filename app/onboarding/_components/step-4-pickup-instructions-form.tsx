"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

type ContactPreference = "email" | "text" | "phone";

type Step4PickupPolicyFormProps = {
  initialValues?: {
    buyerContactEmailEnabled?: boolean | null;
    buyerContactPhoneEnabled?: boolean | null;
    buyerContactTextEnabled?: boolean | null;
    pickupPolicy?: string | null;
  };
  onBack: () => void;
  onComplete: () => void;
};

type Step4Errors = {
  pickupPolicy?: string;
  contactPreferences?: string;
  form?: string;
};

const defaultPickupPolicy =
  "All pickups are by appointment and need at least 24 hours advance notice. At pickup, please come prepared with appropriate transport for your birds. Pet carriers sized appropriately work well. If you bring cardboard boxes, please cut air holes in advance. Please do not bring plastic tubs unless they have appropriate ventilation. Younger birds should have something so they are not standing on slick surfaces.";

const contactOptions: Array<{
  key: ContactPreference;
  label: string;
}> = [
  { key: "email", label: "Email" },
  { key: "text", label: "Text message" },
  { key: "phone", label: "Phone call" },
];

export function Step4PickupPolicyForm({
  initialValues,
  onBack,
  onComplete,
}: Step4PickupPolicyFormProps) {
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
  const [errors, setErrors] = useState<Step4Errors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  function toggleContactPreference(key: ContactPreference) {
    setContactPreferences((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors = validateStep4({
      contactPreferences,
      pickupPolicy,
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
        pickup_policy: pickupPolicy.trim(),
        text_enabled: contactPreferences.text,
      },
    });

    if (error) {
      setErrors({ form: friendlyPickupError(error.message) });
      setIsSubmitting(false);
      return;
    }

    onComplete();
  }

  return (
    <section className="rounded-[0.95rem] bg-white px-4 py-5 shadow-[0_8px_24px_rgba(45,35,20,0.09)] ring-1 ring-stone-200/80 sm:px-6 sm:py-6 lg:px-7 lg:py-6">
      <h2 className="font-serif text-[1.45rem] font-semibold leading-tight text-stone-950 sm:text-[1.7rem]">
        Pickup policy
      </h2>

      <form className="mt-4 space-y-4" onSubmit={handleSubmit} noValidate>
        <div>
          <label
            className="text-sm font-bold text-stone-950 sm:text-[13px]"
            htmlFor="pickup-policy"
          >
            Default pickup policy *
          </label>
          <p className="mt-1 text-sm leading-5 text-stone-500 sm:text-xs">
            Shown to buyers at checkout and included in their order
            confirmation email.
          </p>
          <textarea
            aria-describedby={
              errors.pickupPolicy ? "pickup-policy-error" : undefined
            }
            aria-invalid={Boolean(errors.pickupPolicy)}
            className={`mt-1 min-h-[180px] w-full resize-y rounded-md border bg-white px-3 py-2 text-base font-medium leading-6 text-stone-950 shadow-sm outline-none transition placeholder:text-stone-400 focus:ring-2 focus:ring-[#246f38]/25 sm:text-[14px] ${
              errors.pickupPolicy
                ? "border-red-400 focus:border-red-500"
                : "border-stone-300 focus:border-[#246f38]"
            }`}
            id="pickup-policy"
            onChange={(event) => setPickupPolicy(event.target.value)}
            rows={8}
            value={pickupPolicy}
          />
          {errors.pickupPolicy ? (
            <p
              className="mt-1 text-xs font-semibold text-red-700 sm:text-[13px]"
              id="pickup-policy-error"
            >
              {errors.pickupPolicy}
            </p>
          ) : null}
        </div>

        <fieldset>
          <legend className="text-sm font-bold text-stone-950 sm:text-[13px]">
            How can buyers contact you after ordering? *
          </legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {contactOptions.map((option) => (
              <label
                className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-stone-200 px-3 text-sm font-semibold text-stone-700 transition has-checked:border-[#246f38] has-checked:bg-[#eff8ed] sm:min-h-10"
                key={option.key}
              >
                <input
                  checked={contactPreferences[option.key]}
                  className="size-4 accent-[#246f38]"
                  disabled={isSubmitting}
                  onChange={() => toggleContactPreference(option.key)}
                  type="checkbox"
                />
                {option.label}
              </label>
            ))}
          </div>
          {errors.contactPreferences ? (
            <p className="mt-1 text-xs font-semibold text-red-700 sm:text-[13px]">
              {errors.contactPreferences}
            </p>
          ) : null}
        </fieldset>

        <div className="rounded-lg border border-[#dbe8d8] bg-[#eff8ed] px-4 py-3">
          <p className="text-sm font-extrabold text-[#16572a]">
            You can customize more later
          </p>
          <p className="mt-1 text-sm font-medium leading-6 text-stone-700">
            After setup, you can add regular pickup windows, biosecurity
            details, payment instructions, refund policies, and other store
            policies from Store Admin on your dashboard.
          </p>
        </div>

        {errors.form ? (
          <p
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800"
            role="alert"
          >
            {errors.form}
          </p>
        ) : null}

        <div className="grid grid-cols-[0.42fr_1fr] gap-3">
          <button
            className="flex min-h-12 w-full items-center justify-center rounded-md border border-stone-300 bg-white px-4 text-base font-bold text-stone-700 shadow-sm transition hover:border-[#246f38] hover:text-[#246f38] focus:outline-none focus:ring-2 focus:ring-[#246f38] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 sm:min-h-10 sm:text-[15px]"
            disabled={isSubmitting}
            onClick={onBack}
            type="button"
          >
            Back
          </button>
          <button
            className="flex min-h-12 w-full items-center justify-center rounded-md bg-[#246f38] px-4 text-base font-bold text-white shadow-sm transition hover:bg-[#1c5c2d] focus:outline-none focus:ring-2 focus:ring-[#246f38] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 sm:min-h-10 sm:text-[15px]"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? "Saving pickup policy..." : "Continue"}
          </button>
        </div>
      </form>
    </section>
  );
}

function validateStep4({
  contactPreferences,
  pickupPolicy,
}: {
  contactPreferences: Record<ContactPreference, boolean>;
  pickupPolicy: string;
}) {
  const nextErrors: Step4Errors = {};

  if (!pickupPolicy.trim()) {
    nextErrors.pickupPolicy = "Enter a pickup policy.";
  }

  if (
    !contactPreferences.email &&
    !contactPreferences.text &&
    !contactPreferences.phone
  ) {
    nextErrors.contactPreferences = "Choose at least one contact method.";
  }

  return nextErrors;
}

function friendlyPickupError(message: string) {
  if (message.toLowerCase().includes("selling categories")) {
    return "Please finish selling categories before the pickup policy.";
  }

  return message || "We could not save your pickup policy. Please try again.";
}
