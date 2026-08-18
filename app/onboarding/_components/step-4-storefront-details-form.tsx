"use client";

import { useState } from "react";
import {
  heroHeadlineMaxLength,
  heroSubheadingMaxLength,
  starterFarmDescription,
  starterHeroSubheading,
  starterHeroTagline,
} from "@/lib/storefront-hero-copy";
import { supabase } from "@/lib/supabase";

type StorefrontDetailsErrors = {
  aboutText?: string;
  form?: string;
  heroSubheading?: string;
  heroTagline?: string;
  logo?: string;
};

type StorefrontDetailsFormProps = {
  initialValues?: {
    aboutText?: string | null;
    heroSubheading?: string | null;
    heroTagline?: string | null;
    storeName?: string | null;
  };
  onBack: () => void;
  onComplete: (values: {
    aboutText: string;
    heroSubheading: string;
    heroTagline: string;
    locationDisplayPreference: "city_state";
  }) => void;
  storeId: string;
};

type UploadResponse = {
  error?: { code?: string; message?: string };
  media?: unknown;
};

type FunctionErrorContext = { context?: Response };

const acceptedLogoTypes = ["image/png", "image/jpeg", "image/webp"];
const maxLogoSizeBytes = 8 * 1024 * 1024;
const maxDescriptionWords = 250;

export function Step4StorefrontDetailsForm({
  initialValues,
  onBack,
  onComplete,
  storeId,
}: StorefrontDetailsFormProps) {
  const initialAboutText = initialValues?.aboutText ?? starterFarmDescription;
  const [heroTagline, setHeroTagline] = useState(
    initialValues?.heroTagline ?? starterHeroTagline,
  );
  const [heroSubheading, setHeroSubheading] = useState(
    initialValues?.heroSubheading ?? starterHeroSubheading,
  );
  const [aboutText, setAboutText] = useState(initialAboutText);
  const [useStarterDescription, setUseStarterDescription] = useState(
    initialValues?.aboutText == null || initialAboutText === starterFarmDescription,
  );
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<StorefrontDetailsErrors>({});
  const [warning, setWarning] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const descriptionWordCount = countWords(aboutText);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateStorefrontDetails({
      aboutText,
      heroSubheading,
      heroTagline,
    });

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setErrors({});
    setWarning(null);
    setIsSubmitting(true);

    const { error } = await supabase.rpc(
      "seller_save_onboarding_storefront_details",
      {
        p_details: {
          about_text: aboutText.trim(),
          hero_subheading: heroSubheading.trim(),
          location_display_preference: "city_state",
          store_tagline: heroTagline.trim(),
        },
      },
    );

    if (error) {
      setErrors({ form: friendlyDetailsError(error.message) });
      setIsSubmitting(false);
      return;
    }

    if (logoFile) {
      const uploadResult = await uploadStoreLogo({
        file: logoFile,
        storeId,
        storeName: initialValues?.storeName?.trim() || "Farm store",
      });
      if (!uploadResult.ok) {
        setWarning(
          uploadResult.message ??
            "Storefront details were saved, but the logo did not upload. Please try the logo again.",
        );
        setIsSubmitting(false);
        return;
      }
    }

    onComplete({
      aboutText: aboutText.trim(),
      heroSubheading: heroSubheading.trim(),
      heroTagline: heroTagline.trim(),
      locationDisplayPreference: "city_state",
    });
  }

  function handleStarterDescriptionChange(checked: boolean) {
    setUseStarterDescription(checked);
    if (checked && !aboutText.trim()) {
      setAboutText(starterFarmDescription);
    } else if (!checked && aboutText === starterFarmDescription) {
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
        Storefront details
      </h2>
      <p className="mt-2 text-sm font-medium leading-6 text-stone-600">
        Personalize the public introduction customers will see on your store.
      </p>
      <p className="mt-1.5 text-xs leading-5 text-stone-500">
        Planning to embed your storefront? These fields already have defaults,
        so you can click Next without customizing them.
      </p>

      <form className="mt-4 space-y-4" onSubmit={handleSubmit} noValidate>
        <fieldset className="space-y-3">
          <legend className="text-sm font-bold text-stone-950 sm:text-[13px]">
            Hero storefront text
          </legend>
          <Field
            error={errors.heroTagline}
            helperText="Your main storefront headline. Keep it short and welcoming."
            id="hero-tagline"
            label="Hero tagline *"
            maxLength={heroHeadlineMaxLength}
            onChange={setHeroTagline}
            value={heroTagline}
          />
          <Field
            error={errors.heroSubheading}
            helperText="A brief line telling customers what you offer and who it’s for. You can change this anytime."
            id="hero-subheading"
            label="Hero subline *"
            maxLength={heroSubheadingMaxLength}
            onChange={setHeroSubheading}
            value={heroSubheading}
          />
        </fieldset>

        <div className="border-t border-stone-200 pt-4">
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
            Use the saved starter description or edit it to sound like your farm.
            Keep it to 250 words or fewer.
          </p>
          <textarea
            aria-invalid={Boolean(errors.aboutText)}
            className={`mt-1 min-h-[168px] w-full resize-y rounded-md border bg-white px-3 py-2 text-sm font-medium leading-6 text-stone-950 shadow-sm outline-none transition focus:ring-2 focus:ring-[#246f38]/25 sm:text-[14px] ${
              errors.aboutText
                ? "border-red-400 focus:border-red-500"
                : "border-stone-300 focus:border-[#246f38]"
            }`}
            id="about-text"
            onChange={(event) => setAboutText(event.target.value)}
            rows={7}
            value={aboutText}
          />
          <div className="mt-1 flex items-center justify-between gap-3 text-sm text-stone-500 sm:text-xs">
            <p className={errors.aboutText ? "font-semibold text-red-700" : undefined}>
              {errors.aboutText ?? "Required."}
            </p>
            <p className={descriptionWordCount > maxDescriptionWords ? "font-semibold text-red-700" : undefined}>
              {descriptionWordCount}/{maxDescriptionWords} words
            </p>
          </div>
        </div>

        <div className="rounded-md border border-dashed border-stone-300 bg-[#fffaf1] px-3 py-2.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-bold text-stone-950 sm:text-[13px]">Farm logo</p>
              <p className="mt-0.5 text-sm text-stone-500 sm:text-xs">
                Optional. Upload a PNG, JPG, or WEBP logo for your storefront.
              </p>
              {logoFile ? (
                <p className="mt-1 text-xs font-semibold text-[#16572a]">Selected: {logoFile.name}</p>
              ) : null}
              {errors.logo ? (
                <p className="mt-1 text-xs font-semibold text-red-700">{errors.logo}</p>
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

        <p className="border-t border-stone-200 pt-4 text-sm leading-5 text-stone-500 sm:text-xs">
          Your storefront shows your city and state. Your street and pickup
          addresses stay private.
        </p>

        {errors.form ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800" role="alert">
            {errors.form}
          </p>
        ) : null}
        {warning ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900" role="alert">
            {warning}
          </p>
        ) : null}

        <div className="grid grid-cols-[0.42fr_1fr] gap-3">
          <button
            className="flex min-h-12 items-center justify-center rounded-md border border-stone-300 bg-white px-4 text-base font-bold text-stone-700"
            disabled={isSubmitting}
            onClick={onBack}
            type="button"
          >
            Back
          </button>
          <button
            className="flex min-h-12 items-center justify-center rounded-md bg-[#246f38] px-4 text-base font-bold text-white disabled:opacity-70"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? "Saving storefront details..." : "Save storefront details"}
          </button>
        </div>
      </form>
    </section>
  );
}

function Field({
  error,
  helperText,
  id,
  label,
  maxLength,
  onChange,
  value,
}: {
  error?: string;
  helperText: string;
  id: string;
  label: string;
  maxLength: number;
  onChange: (value: string) => void;
  value: string;
}) {
  const descriptionId = `${id}-${error ? "error" : "help"}`;
  return (
    <div>
      <label className="text-sm font-bold text-stone-950 sm:text-[13px]" htmlFor={id}>{label}</label>
      <input
        aria-describedby={descriptionId}
        aria-invalid={Boolean(error)}
        className={`mt-1 min-h-12 w-full rounded-md border bg-white px-3 text-base font-medium text-stone-950 shadow-sm outline-none focus:ring-2 focus:ring-[#246f38]/25 sm:min-h-10 sm:text-[14px] ${error ? "border-red-400" : "border-stone-300"}`}
        id={id}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
      <p className={`mt-1 text-sm sm:text-xs ${error ? "font-semibold text-red-700" : "text-stone-500"}`} id={descriptionId}>
        {error ?? helperText}
      </p>
    </div>
  );
}

function validateStorefrontDetails({
  aboutText,
  heroSubheading,
  heroTagline,
}: {
  aboutText: string;
  heroSubheading: string;
  heroTagline: string;
}) {
  const nextErrors: StorefrontDetailsErrors = {};
  if (!heroTagline.trim()) nextErrors.heroTagline = "Enter your hero tagline.";
  else if (heroTagline.length > heroHeadlineMaxLength) {
    nextErrors.heroTagline = `Keep your hero tagline to ${heroHeadlineMaxLength} characters or fewer.`;
  }
  if (!heroSubheading.trim()) nextErrors.heroSubheading = "Enter your hero subline.";
  else if (heroSubheading.length > heroSubheadingMaxLength) {
    nextErrors.heroSubheading = `Keep your hero subline to ${heroSubheadingMaxLength} characters or fewer.`;
  }
  if (!aboutText.trim()) nextErrors.aboutText = "Enter a farm description.";
  else if (countWords(aboutText) > maxDescriptionWords) {
    nextErrors.aboutText = "Keep your farm description to 250 words or fewer.";
  }
  return nextErrors;
}

function friendlyDetailsError(message: string) {
  return message || "We could not save your storefront details. Please try again.";
}

function validateLogoFile(file: File) {
  if (!acceptedLogoTypes.includes(file.type)) return "Upload a PNG, JPG, JPEG, or WEBP image.";
  if (file.size > maxLogoSizeBytes) return "Logo image must be 8 MB or smaller.";
  return null;
}

function countWords(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
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
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (sessionError || !accessToken) {
    return { ok: false, message: "Storefront details were saved. Please sign in again to upload your logo." };
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
    { body: formData, headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (error || data?.error) {
    const uploadError = await readFunctionError(error);
    return {
      ok: false,
      message: mapUploadErrorToSellerMessage(data?.error?.code ?? uploadError?.code),
    };
  }
  return { ok: true, message: null };
}

async function readFunctionError(uploadError: unknown) {
  const response = (uploadError as FunctionErrorContext | null)?.context;
  if (!response) return null;
  try {
    const body = (await response.clone().json()) as UploadResponse;
    return { code: body.error?.code };
  } catch {
    return null;
  }
}

function mapUploadErrorToSellerMessage(code?: string) {
  switch (code) {
    case "unsupported_media_type":
      return "Storefront details were saved. Upload a PNG, JPG, JPEG, or WEBP logo.";
    case "file_too_large":
      return "Storefront details were saved. Logo image must be 8 MB or smaller.";
    case "unauthorized":
      return "Storefront details were saved. Please sign in again to upload your logo.";
    default:
      return "Storefront details were saved, but the logo did not upload. Please try again.";
  }
}
