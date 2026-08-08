"use client";

import { useState } from "react";
import {
  heroHeadlineMaxLength,
  heroSubheadingMaxLength,
} from "@/lib/storefront-hero-copy";
import { supabase } from "@/lib/supabase";

type Step2Errors = {
  phone?: string;
  billingAddress?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  pickupAddressLine1?: string;
  pickupCity?: string;
  pickupState?: string;
  pickupPostalCode?: string;
  heroTagline?: string;
  heroSubheading?: string;
  storeName?: string;
  aboutText?: string;
  locationDisplayPreference?: string;
  form?: string;
  logo?: string;
};

type LocationDisplayPreference = "full_address" | "city_state" | "manual";

type BootstrapStoreResponse = {
  store_id: string;
  store_name: string;
  store_slug: string;
  profile_complete: boolean;
  next_step: number;
};

type UploadResponse = {
  media?: unknown;
  error?: {
    code?: string;
    message?: string;
  };
};

type FunctionErrorContext = {
  context?: Response;
};

type Step2FormProps = {
  initialValues?: {
    phone?: string | null;
    city?: string | null;
    state?: string | null;
    storeName?: string | null;
    aboutText?: string | null;
    heroTagline?: string | null;
    heroSubheading?: string | null;
  };
  onComplete: (store: { storeId: string; storeName: string | null }) => void;
};

const starterFarmDescription = `We’re a local farm offering poultry and farm goods for backyard flock owners, homesteaders, and small farms.

For many people, raising poultry is about more than eggs or meat. It’s about knowing where your food comes from, building a flock that fits your home, teaching kids responsibility, adding beauty and life to the yard, and enjoying the daily rhythm of caring for animals.

Our birds and products change with the season, the hatch, and the natural pace of farm life. Depending on what’s available, you may find chicks, started birds, laying hens, hatching eggs, eating eggs, poultry products, supplies, equipment, or other farm goods listed here.

Buying from a small poultry farm keeps things local, supports the people doing the daily work, and gives you a closer connection to where your birds and farm products are coming from.

Check our current listings to see what’s ready now. Thank you for supporting small farms, local food, and backyard flocks.`;

const acceptedLogoTypes = ["image/png", "image/jpeg", "image/webp"];
const maxLogoSizeBytes = 8 * 1024 * 1024;
const maxDescriptionWords = 250;

export function Step2FarmBasicsForm({
  initialValues,
  onComplete,
}: Step2FormProps) {
  const [phone, setPhone] = useState(formatPhoneNumber(initialValues?.phone ?? ""));
  const [billingAddress, setBillingAddress] = useState("");
  const [city, setCity] = useState(initialValues?.city ?? "");
  const [state, setState] = useState(initialValues?.state ?? "");
  const [postalCode, setPostalCode] = useState("");
  const [pickupAddressLine1, setPickupAddressLine1] = useState("");
  const [pickupAddressLine2, setPickupAddressLine2] = useState("");
  const [pickupCity, setPickupCity] = useState("");
  const [pickupState, setPickupState] = useState("");
  const [pickupPostalCode, setPickupPostalCode] = useState("");
  const [storeName, setStoreName] = useState(initialValues?.storeName ?? "");
  const [heroTagline, setHeroTagline] = useState(
    initialValues?.heroTagline ?? "",
  );
  const [heroSubheading, setHeroSubheading] = useState(
    initialValues?.heroSubheading ?? "",
  );
  const [useStarterDescription, setUseStarterDescription] = useState(
    !initialValues?.aboutText,
  );
  const [aboutText, setAboutText] = useState(
    initialValues?.aboutText ?? starterFarmDescription,
  );
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [locationDisplayPreference, setLocationDisplayPreference] =
    useState<LocationDisplayPreference>("city_state");
  const [errors, setErrors] = useState<Step2Errors>({});
  const [warning, setWarning] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const descriptionWordCount = countWords(aboutText);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors = validateStep2({
      phone,
      billingAddress,
      city,
      state,
      postalCode,
      pickupAddressLine1,
      pickupCity,
      pickupState,
      pickupPostalCode,
      storeName,
      heroTagline,
      heroSubheading,
      aboutText,
      locationDisplayPreference,
    });

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setIsSubmitting(true);
    setErrors({});
    setWarning(null);

    const { data, error } = await supabase.rpc(
      "seller_bootstrap_store_from_onboarding",
      {
        p_profile: {
          phone: phone.trim(),
          billing_address_line1: billingAddress.trim(),
          billing_city: city.trim(),
          billing_state: state.trim(),
          billing_postal_code: postalCode.trim(),
          billing_country: "US",
          public_city: city.trim(),
          public_state: state.trim(),
          store_name: storeName.trim(),
          store_tagline: heroTagline.trim(),
          hero_subheading: heroSubheading.trim(),
          pickup_address_line1: pickupAddressLine1.trim(),
          pickup_address_line2: pickupAddressLine2.trim() || null,
          pickup_city: pickupCity.trim(),
          pickup_state: pickupState.trim(),
          pickup_postal_code: pickupPostalCode.trim(),
          pickup_country: "US",
          about_text: aboutText.trim() || null,
          location_display_preference: locationDisplayPreference,
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
        form: "Farm details were saved, but we could not confirm the store setup. Please refresh and try again.",
      });
      setIsSubmitting(false);
      return;
    }

    if (logoFile) {
      const uploadResult = await uploadStoreLogo({
        file: logoFile,
        storeId,
        storeName: storeName.trim(),
      });

      if (!uploadResult.ok) {
        setWarning(
          uploadResult.message ??
            "Farm details were saved, but the logo did not upload. Please try the logo again.",
        );
        setIsSubmitting(false);
        return;
      }
    }

    onComplete({
      storeId,
      storeName: rows[0]?.store_name ?? storeName.trim(),
    });
  }

  function handleStarterDescriptionChange(checked: boolean) {
    setUseStarterDescription(checked);

    if (checked && !aboutText.trim()) {
      setAboutText(starterFarmDescription);
      return;
    }

    if (!checked && aboutText === starterFarmDescription) {
      setAboutText("");
    }
  }

  function handleLogoFileChange(fileList: FileList | null) {
    const file = fileList?.[0] ?? null;

    if (!file) {
      setLogoFile(null);
      setErrors((current) => ({ ...current, logo: undefined }));
      return;
    }

    const validationError = validateLogoFile(file);

    if (validationError) {
      setLogoFile(null);
      setErrors((current) => ({ ...current, logo: validationError }));
      return;
    }

    setLogoFile(file);
    setErrors((current) => ({ ...current, logo: undefined }));
  }

  return (
    <section className="rounded-[0.95rem] bg-white px-4 py-5 shadow-[0_8px_24px_rgba(45,35,20,0.09)] ring-1 ring-stone-200/80 sm:px-6 sm:py-6 lg:px-7 lg:py-5">
      <h2 className="font-serif text-[1.45rem] font-semibold leading-tight text-stone-950 sm:text-[1.7rem]">
        Farm &amp; storefront information
      </h2>

      <form className="mt-3 space-y-3" onSubmit={handleSubmit} noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            autoComplete="tel"
            error={errors.phone}
            helperText="Use a 10-digit US phone number."
            id="phone"
            label="Phone number *"
            maxLength={14}
            onChange={(value) => setPhone(formatPhoneNumber(value))}
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
            Used for billing only. It is not visible to buyers.
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
              id="city"
              label="City *"
              onChange={setCity}
              value={city}
            />
            <Field
              autoComplete="address-level1"
              error={errors.state}
              id="state"
              label="State *"
              maxLength={2}
              onChange={setState}
              value={state}
            />
            <Field
              autoComplete="postal-code"
              error={errors.postalCode}
              id="postal-code"
              label="ZIP code *"
              onChange={setPostalCode}
              value={postalCode}
            />
          </div>
        </fieldset>

        <fieldset className="space-y-3 border-t border-stone-200 pt-4">
          <legend className="text-sm font-bold text-stone-950 sm:text-[13px]">
            Hero storefront text
          </legend>
          <p className="-mt-2 text-sm leading-5 text-stone-500 sm:text-xs">
            This text appears in the main hero area of your storefront.
          </p>
          <Field
            error={errors.heroTagline}
            id="hero-tagline"
            label="Hero tagline *"
            maxLength={heroHeadlineMaxLength}
            onChange={setHeroTagline}
            value={heroTagline}
          />
          <Field
            error={errors.heroSubheading}
            id="hero-subheading"
            label="Hero subline *"
            maxLength={heroSubheadingMaxLength}
            onChange={setHeroSubheading}
            value={heroSubheading}
          />
        </fieldset>

        <fieldset className="space-y-3 border-t border-stone-200 pt-4">
          <legend className="text-sm font-bold text-stone-950 sm:text-[13px]">
            Pickup address
          </legend>
          <p className="-mt-2 text-sm leading-5 text-stone-500 sm:text-xs">
            Your full pickup address is not shown on your public storefront. Buyers receive it in their order confirmation after purchase.
          </p>
          <Field
            autoComplete="shipping street-address"
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
          <Field
            autoComplete="shipping country"
            id="pickup-country"
            label="Country"
            onChange={() => undefined}
            readOnly
            value="United States"
          />
        </fieldset>

        <div>
          <label className="flex items-center gap-2 rounded-md border border-[#dbe8d8] bg-[#eff8ed] px-3 py-2 text-sm font-bold text-[#16572a]">
            <input
              checked={useStarterDescription}
              className="size-4 accent-[#246f38]"
              onChange={(event) =>
                handleStarterDescriptionChange(event.target.checked)
              }
              type="checkbox"
            />
            Use FlockFront&apos;s starter farm description
          </label>
          <label
            className="mt-3 block text-sm font-bold text-stone-950 sm:text-[13px]"
            htmlFor="about-text"
          >
            Farm description *
          </label>
          <p className="mt-1 text-sm leading-5 text-stone-500 sm:text-xs">
            Use our starter description or edit it to sound like your farm. This
            appears on your storefront. Keep it to 250 words or fewer.
          </p>
          <textarea
            className={`mt-1 min-h-[168px] w-full resize-y rounded-md border bg-white px-3 py-2 text-sm font-medium leading-6 text-stone-950 shadow-sm outline-none transition placeholder:text-stone-400 focus:ring-2 focus:ring-[#246f38]/25 sm:text-[14px] ${
              errors.aboutText
                ? "border-red-400 focus:border-red-500"
                : "border-stone-300 focus:border-[#246f38]"
            }`}
            id="about-text"
            onChange={(event) => setAboutText(event.target.value)}
            placeholder="Example: Small family flock in western Colorado raising friendly backyard layers, hatching eggs, and seasonal chicks."
            rows={7}
            value={aboutText}
          />
          <div className="mt-1 flex items-center justify-between gap-3 text-sm text-stone-500 sm:text-xs">
            {errors.aboutText ? (
              <p className="font-semibold text-red-700">{errors.aboutText}</p>
            ) : (
              <p>Required.</p>
            )}
            <p
              className={
                descriptionWordCount > maxDescriptionWords
                  ? "font-semibold text-red-700"
                  : undefined
              }
            >
              {descriptionWordCount}/{maxDescriptionWords} words
            </p>
          </div>
        </div>

        <div className="rounded-md border border-dashed border-stone-300 bg-[#fffaf1] px-3 py-2.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-bold text-stone-950 sm:text-[13px]">
                Farm logo
              </p>
              <p className="mt-0.5 text-sm text-stone-500 sm:text-xs">
                Optional. Upload your farm logo for your storefront.
              </p>
              {logoFile ? (
                <p className="mt-1 text-xs font-semibold text-[#16572a]">
                  Selected: {logoFile.name}
                </p>
              ) : null}
              {errors.logo ? (
                <p className="mt-1 text-xs font-semibold text-red-700">
                  {errors.logo}
                </p>
              ) : null}
            </div>
            <label className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md border border-stone-300 bg-white px-3 text-sm font-bold text-stone-700 transition hover:border-[#246f38] hover:text-[#246f38] sm:min-h-9 sm:text-xs">
              Choose logo
              <input
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                disabled={isSubmitting}
                onChange={(event) => handleLogoFileChange(event.target.files)}
                type="file"
              />
            </label>
          </div>
        </div>

        <fieldset>
          <legend className="text-sm font-bold text-stone-950 sm:text-[13px]">
            Location display preference *
          </legend>
          <div className="mt-2 grid gap-2">
            <RadioOption
              checked={locationDisplayPreference === "full_address"}
              label="Show full address"
              name="location-display-preference"
              onChange={() => setLocationDisplayPreference("full_address")}
              value="full_address"
            />
            <RadioOption
              checked={locationDisplayPreference === "city_state"}
              label="Show city + state only"
              name="location-display-preference"
              onChange={() => setLocationDisplayPreference("city_state")}
              value="city_state"
            />
            <RadioOption
              checked={locationDisplayPreference === "manual"}
              label="I'll add pickup location details manually"
              name="location-display-preference"
              onChange={() => setLocationDisplayPreference("manual")}
              value="manual"
            />
          </div>
          {errors.locationDisplayPreference ? (
            <p className="mt-1 text-xs font-semibold text-red-700 sm:text-[13px]">
              {errors.locationDisplayPreference}
            </p>
          ) : null}
        </fieldset>

        {errors.form ? (
          <p
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800"
            role="alert"
          >
            {errors.form}
          </p>
        ) : null}

        {warning ? (
          <p
            className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900"
            role="alert"
          >
            {warning}
          </p>
        ) : null}

        <button
          className="flex min-h-12 w-full items-center justify-center rounded-md bg-[#246f38] px-4 text-base font-bold text-white shadow-sm transition hover:bg-[#1c5c2d] focus:outline-none focus:ring-2 focus:ring-[#246f38] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 sm:min-h-10 sm:text-[15px]"
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting
            ? logoFile
              ? "Saving details and logo..."
              : "Saving farm details..."
            : "Save farm details"}
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
  readOnly?: boolean;
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
  readOnly,
  type = "text",
  value,
}: FieldProps) {
  const errorId = `${id}-error`;

  return (
    <div>
      <label className="text-sm font-bold text-stone-950 sm:text-[13px]" htmlFor={id}>
        {label}
      </label>
      <input
        aria-describedby={error ? errorId : undefined}
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
        readOnly={readOnly}
        type={type}
        value={value}
      />
      {helperText && !error ? (
        <p className="mt-1 text-sm text-stone-500 sm:text-xs">{helperText}</p>
      ) : null}
      {error ? (
        <p className="mt-1 text-xs font-semibold text-red-700 sm:text-[13px]" id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

type RadioOptionProps = {
  checked: boolean;
  label: string;
  name: string;
  onChange: () => void;
  value: LocationDisplayPreference;
};

function RadioOption({
  checked,
  label,
  name,
  onChange,
  value,
}: RadioOptionProps) {
  return (
    <label className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md border border-stone-200 px-3 text-sm font-semibold text-stone-700 transition has-checked:border-[#246f38] has-checked:bg-[#eff8ed]">
      <input
        checked={checked}
        className="size-4 accent-[#246f38]"
        name={name}
        onChange={onChange}
        type="radio"
        value={value}
      />
      {label}
    </label>
  );
}

function validateStep2({
  phone,
  billingAddress,
  city,
  state,
  postalCode,
  pickupAddressLine1,
  pickupCity,
  pickupState,
  pickupPostalCode,
  storeName,
  heroTagline,
  heroSubheading,
  aboutText,
  locationDisplayPreference,
}: {
  phone: string;
  billingAddress: string;
  city: string;
  state: string;
  postalCode: string;
  pickupAddressLine1: string;
  pickupCity: string;
  pickupState: string;
  pickupPostalCode: string;
  storeName: string;
  heroTagline: string;
  heroSubheading: string;
  aboutText: string;
  locationDisplayPreference: LocationDisplayPreference | "";
}) {
  const nextErrors: Step2Errors = {};

  if (!phone.trim()) {
    nextErrors.phone = "Enter your phone number.";
  } else if (getUsPhoneDigits(phone).length !== 10) {
    nextErrors.phone = "Enter a 10-digit US phone number.";
  }
  if (!billingAddress.trim()) {
    nextErrors.billingAddress = "Enter your billing address.";
  }
  if (!city.trim()) nextErrors.city = "Enter your city.";
  if (!state.trim()) nextErrors.state = "Enter your state.";
  if (!postalCode.trim()) nextErrors.postalCode = "Enter your ZIP code.";
  if (!pickupAddressLine1.trim()) {
    nextErrors.pickupAddressLine1 = "Enter your pickup address.";
  }
  if (!pickupCity.trim()) nextErrors.pickupCity = "Enter your pickup city.";
  if (!pickupState.trim()) nextErrors.pickupState = "Enter your pickup state.";
  if (!pickupPostalCode.trim()) {
    nextErrors.pickupPostalCode = "Enter your pickup ZIP code.";
  }
  if (!storeName.trim()) {
    nextErrors.storeName = "Enter your farm or seller name.";
  }
  if (!heroTagline.trim()) {
    nextErrors.heroTagline = "Enter your hero tagline.";
  } else if (heroTagline.length > heroHeadlineMaxLength) {
    nextErrors.heroTagline = `Keep your hero tagline to ${heroHeadlineMaxLength} characters or fewer.`;
  }
  if (!heroSubheading.trim()) {
    nextErrors.heroSubheading = "Enter your hero subline.";
  } else if (heroSubheading.length > heroSubheadingMaxLength) {
    nextErrors.heroSubheading = `Keep your hero subline to ${heroSubheadingMaxLength} characters or fewer.`;
  }
  if (!aboutText.trim()) {
    nextErrors.aboutText = "Enter a farm description.";
  } else if (countWords(aboutText) > maxDescriptionWords) {
    nextErrors.aboutText = "Keep your farm description to 250 words or fewer.";
  }
  if (!locationDisplayPreference) {
    nextErrors.locationDisplayPreference = "Choose a location display option.";
  }

  return nextErrors;
}

function friendlyRpcError(message: string) {
  if (message.toLowerCase().includes("duplicate")) {
    return "That store name is already in use. Try adding your town or farm initials.";
  }

  return message || "We could not save your farm details. Please try again.";
}

function validateLogoFile(file: File) {
  if (!acceptedLogoTypes.includes(file.type)) {
    return "Upload a PNG, JPG, JPEG, or WEBP image.";
  }

  if (file.size > maxLogoSizeBytes) {
    return "Logo image must be 8 MB or smaller.";
  }

  return null;
}

function countWords(value: string) {
  const trimmed = value.trim();

  if (!trimmed) return 0;

  return trimmed.split(/\s+/).length;
}

function getUsPhoneDigits(value: string) {
  const digits = value.replace(/\D/g, "");

  if (digits.length === 11 && digits.startsWith("1")) {
    return digits.slice(1);
  }

  return digits.slice(0, 10);
}

function formatPhoneNumber(value: string) {
  const digits = getUsPhoneDigits(value);

  if (digits.length <= 3) return digits;

  if (digits.length <= 6) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  }

  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

async function uploadStoreLogo({
  file,
  storeId,
  storeName,
}: {
  file: File;
  storeId: string;
  storeName: string;
}) {
  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;

  if (sessionError || !accessToken) {
    return {
      ok: false,
      message: "Farm details were saved. Please sign in again to upload your logo.",
    };
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("store_id", storeId);
  formData.append("entity_type", "store");
  formData.append("entity_id", storeId);
  formData.append("display_context", "logo");
  formData.append("alt_text", `${storeName} logo`);
  formData.append("sort_order", "0");
  formData.append("is_featured", "true");

  const { data, error } = await supabase.functions.invoke<UploadResponse>(
    "seller-media-upload",
    {
      body: formData,
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (error || data?.error) {
    const uploadError = await readFunctionError(error);

    return {
      ok: false,
      message: mapUploadErrorToSellerMessage(
        data?.error?.code ?? uploadError?.code,
      ),
    };
  }

  return { ok: true, message: null };
}

async function readFunctionError(uploadError: unknown) {
  const response = (uploadError as FunctionErrorContext | null)?.context;

  if (!response) return null;

  try {
    const body = (await response.clone().json()) as UploadResponse;

    return {
      code: body.error?.code,
      message: body.error?.message,
      status: response.status,
    };
  } catch {
    return null;
  }
}

function mapUploadErrorToSellerMessage(code?: string) {
  switch (code) {
    case "unsupported_media_type":
      return "Farm details were saved. Upload a PNG, JPG, JPEG, or WEBP logo.";
    case "file_too_large":
      return "Farm details were saved. Logo image must be 8 MB or smaller.";
    case "unauthorized":
      return "Farm details were saved. Please sign in again to upload your logo.";
    case "invalid_image":
      return "Farm details were saved. That logo image could not be validated.";
    default:
      return "Farm details were saved, but the logo did not upload. Please try the logo again.";
  }
}
