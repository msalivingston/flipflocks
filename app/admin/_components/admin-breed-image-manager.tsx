"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  catalogBirdTypeOptions,
  eggColorOptions,
} from "@/lib/chicken-metadata-options";
import { supabase } from "@/lib/supabase";
import type {
  AdminCatalogBreedDetailRow,
  AdminCatalogBreedListRow,
} from "../_lib/admin-types";
import {
  AdminAccessState,
  AdminCard,
  AdminErrorState,
  AdminLoadingState,
  AdminPageHeader,
  AdminStatusBadge,
  isAdminAuthorizationError,
} from "./admin-ui";

type UploadResponse = {
  breed?: {
    id: string;
    image_url: string | null;
  };
  error?: {
    code?: string;
    message?: string;
  };
  image?: {
    image_url: string;
  };
  message?: string;
};

type CatalogDetailsForm = {
  annual_egg_production: string;
  bird_type: string;
  category: string;
  description: string;
  egg_color: string;
  image_prompt: string;
};

export function AdminBreedImageManager({ breedId }: { breedId: string }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [breed, setBreed] = useState<AdminCatalogBreedDetailRow | null>(null);
  const [missingBreeds, setMissingBreeds] = useState<AdminCatalogBreedListRow[]>(
    [],
  );
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [manualImageUrl, setManualImageUrl] = useState("");
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [detailsForm, setDetailsForm] = useState<CatalogDetailsForm>(
    emptyDetailsForm,
  );
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [detailsMessage, setDetailsMessage] = useState<string | null>(null);
  const [isSavingDetails, setIsSavingDetails] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadBreed() {
      setIsLoading(true);
      setError(null);
      setMessage(null);
      setImageLoadFailed(false);

      const { data: userData, error: userError } = await supabase.auth.getUser();

      if (!isMounted) return;

      if (userError || !userData.user) {
        setError("Sign in with a platform admin account to view this area.");
        setIsLoading(false);
        return;
      }

      const [detailResult, listResult] = await Promise.all([
        supabase.rpc("admin_catalog_breed_detail", {
          p_breed_id: breedId,
        }),
        supabase.rpc("admin_catalog_breed_list"),
      ]);

      if (!isMounted) return;

      const firstError = detailResult.error ?? listResult.error;

      if (firstError) {
        setError(firstError.message);
        setIsLoading(false);
        return;
      }

      const rows = (detailResult.data ?? []) as AdminCatalogBreedDetailRow[];
      const currentBreed = rows[0] ?? null;
      const breedList = (listResult.data ?? []) as AdminCatalogBreedListRow[];

      setBreed(currentBreed);
      setManualImageUrl(currentBreed?.image_url ?? "");
      setDetailsForm(toDetailsForm(currentBreed));
      setMissingBreeds(breedList.filter((item) => !item.has_image));
      setIsLoading(false);
    }

    void loadBreed();

    return () => {
      isMounted = false;
    };
  }, [breedId]);

  const selectedPreviewUrl = useMemo(() => {
    if (!selectedFile) return "";

    return URL.createObjectURL(selectedFile);
  }, [selectedFile]);

  useEffect(
    () => () => {
      if (selectedPreviewUrl) URL.revokeObjectURL(selectedPreviewUrl);
    },
    [selectedPreviewUrl],
  );

  const currentImageSrc = toCatalogImageSrc(breed?.image_url);
  const previewSrc = selectedPreviewUrl || currentImageSrc;
  const nextMissingBreed = missingBreeds.find((item) => item.breed_id !== breedId);

  function handleFile(file: File | undefined) {
    if (!file) return;

    setSelectedFile(file);
    setMessage(`${file.name} selected. Preview is ready.`);
    setError(null);
    setImageLoadFailed(false);
  }

  async function saveImage({ goNext }: { goNext: boolean }) {
    if (!breed) return;

    if (!selectedFile && manualImageUrl.trim() === (breed.image_url ?? "")) {
      setError("Choose an image or update the advanced image URL before saving.");
      return;
    }

    setIsSaving(true);
    setError(null);
    setMessage(null);

    if (selectedFile) {
      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;

      if (sessionError || !accessToken) {
        setError("Please sign in again before uploading.");
        setIsSaving(false);
        return;
      }

      const formData = new FormData();
      formData.append("breed_id", breed.breed_id);
      formData.append("file", selectedFile);

      const { data, error: uploadError } =
        await supabase.functions.invoke<UploadResponse>(
          "admin-catalog-breed-image-upload",
          {
            body: formData,
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          },
        );

      if (uploadError || data?.error) {
        setError(data?.error?.message ?? uploadError?.message ?? "Upload failed.");
        setIsSaving(false);
        return;
      }

      completeSave(data?.image?.image_url ?? data?.breed?.image_url ?? "", goNext);
      return;
    }

    const { data, error: updateError } = await supabase.rpc(
      "admin_update_catalog_breed_image_url",
      {
        p_breed_id: breed.breed_id,
        p_image_url: manualImageUrl,
      },
    );

    if (updateError) {
      setError(updateError.message);
      setIsSaving(false);
      return;
    }

    const updatedRows = (data ?? []) as AdminCatalogBreedDetailRow[];
    completeSave(updatedRows[0]?.image_url ?? manualImageUrl, goNext);
  }

  function completeSave(nextImageUrl: string, goNext: boolean) {
    if (!breed) return;

    const updatedBreed = {
      ...breed,
      has_image: Boolean(nextImageUrl.trim()),
      image_url: nextImageUrl || null,
    };

    setBreed(updatedBreed);
    setManualImageUrl(nextImageUrl);
    setSelectedFile(null);
    setIsSaving(false);
    setMessage("Catalog image saved.");

    if (goNext) {
      if (nextMissingBreed) {
        router.replace(`/admin/breeds/${nextMissingBreed.breed_id}`);
      } else {
        router.replace("/admin/breeds?image=missing");
      }
    }
  }

  async function saveCatalogDetails() {
    if (!breed) return;

    setIsSavingDetails(true);
    setDetailsError(null);
    setDetailsMessage(null);

    const { data, error: updateError } = await supabase.rpc(
      "admin_update_catalog_breed_details",
      {
        p_annual_egg_production: detailsForm.annual_egg_production,
        p_bird_type: detailsForm.bird_type,
        p_breed_id: breed.breed_id,
        p_category: detailsForm.category,
        p_description: detailsForm.description,
        p_egg_color: detailsForm.egg_color,
        p_image_prompt: detailsForm.image_prompt,
      },
    );

    if (updateError) {
      setDetailsError(updateError.message);
      setIsSavingDetails(false);
      return;
    }

    const updatedRows = (data ?? []) as AdminCatalogBreedDetailRow[];
    const updatedBreed = updatedRows[0];

    if (updatedBreed) {
      setBreed(updatedBreed);
      setDetailsForm(toDetailsForm(updatedBreed));
    }

    setDetailsMessage("Catalog details saved.");
    setIsSavingDetails(false);
  }

  return (
    <>
      <AdminPageHeader
        eyebrow="Platform Admin"
        title={breed?.breed_name ?? "Breed Image"}
        description="Upload or replace the default catalog image for this breed. Seller-uploaded images are not changed."
        action={
          <Link className="seller-secondary-button" href="/admin/breeds">
            Back to Breeds
          </Link>
        }
      />

      <div className="mx-auto grid w-full max-w-5xl gap-5 px-5 py-5 sm:px-7">
        {isLoading ? <AdminLoadingState label="Loading breed" /> : null}

        {!isLoading && error && !breed ? (
          isAdminAuthorizationError(error) ? (
            <AdminAccessState message={error} />
          ) : (
            <AdminErrorState message={error} />
          )
        ) : null}

        {!isLoading && !error && !breed ? (
          <AdminErrorState message="No breed was returned." title="Breed not found" />
        ) : null}

        {!isLoading && breed ? (
          <>
            <AdminCard>
              <div className="grid gap-4 p-5 md:grid-cols-[1fr_auto] md:items-start">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-bold text-stone-950">
                      {breed.breed_name}
                    </h2>
                    <AdminStatusBadge
                      value={breed.has_image ? "Has image" : "Missing image"}
                    />
                  </div>
                  <p className="mt-2 text-sm font-semibold text-stone-500">
                    {breed.species_name} / {breed.breed_slug}
                  </p>
                  <p className="mt-3 max-w-3xl text-sm leading-6 text-stone-600">
                    Replacing this catalog image changes the default image used
                    for future restore-default-photo actions. Existing
                    seller-uploaded images are not changed.
                  </p>
                </div>
                <div className="text-sm font-semibold text-stone-600">
                  {nextMissingBreed
                    ? `Next missing: ${nextMissingBreed.breed_name}`
                    : "No other missing image queued"}
                </div>
              </div>
            </AdminCard>

            <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
              <AdminCard>
                <div className="p-5">
                  <h2 className="text-lg font-bold text-stone-950">Preview</h2>
                  <div className="mt-4 overflow-hidden rounded-lg border border-stone-200 bg-stone-50">
                    {previewSrc && !imageLoadFailed ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        alt={`${breed.breed_name} catalog preview`}
                        className="aspect-square w-full object-cover"
                        src={previewSrc}
                        onError={() => setImageLoadFailed(true)}
                      />
                    ) : (
                      <div className="flex aspect-square items-center justify-center p-6 text-center text-sm font-semibold text-stone-500">
                        {breed.image_url
                          ? "Image did not load"
                          : "No catalog image yet"}
                      </div>
                    )}
                  </div>
                </div>
              </AdminCard>

              <AdminCard>
                <div className="grid gap-4 p-5">
                  <div>
                    <h2 className="text-lg font-bold text-stone-950">
                      Upload Image
                    </h2>
                    <p className="mt-1 text-sm leading-6 text-stone-600">
                      JPG, PNG, or WebP. Max 8 MB.
                    </p>
                  </div>

                  <button
                    className={`grid min-h-52 place-items-center rounded-lg border-2 border-dashed p-6 text-center transition ${
                      isDragging
                        ? "border-emerald-700 bg-emerald-50"
                        : "border-stone-300 bg-stone-50 hover:border-emerald-700 hover:bg-emerald-50"
                    }`}
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    onDragEnter={(event) => {
                      event.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={(event) => {
                      event.preventDefault();
                      setIsDragging(false);
                      handleFile(event.dataTransfer.files[0]);
                    }}
                  >
                    <span>
                      <span className="block text-base font-bold text-stone-950">
                        Drop image here or choose a file
                      </span>
                      <span className="mt-2 block text-sm text-stone-600">
                        Preview appears immediately after selection.
                      </span>
                    </span>
                  </button>

                  <input
                    ref={fileInputRef}
                    className="sr-only"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(event) => handleFile(event.target.files?.[0])}
                  />

                  <details className="rounded-lg border border-stone-200 bg-stone-50 p-4">
                    <summary className="cursor-pointer text-sm font-bold text-stone-800">
                      Advanced: manual image URL
                    </summary>
                    <label className="mt-3 grid gap-1 text-sm font-semibold text-stone-700">
                      Image URL or storage path
                      <input
                        className="min-h-10 rounded-md border border-stone-300 bg-white px-3 text-sm font-medium text-stone-950 shadow-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
                        value={manualImageUrl}
                        onChange={(event) => {
                          setManualImageUrl(event.target.value);
                          setSelectedFile(null);
                          setImageLoadFailed(false);
                        }}
                      />
                    </label>
                  </details>

                  {message ? (
                    <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-900">
                      {message}
                    </p>
                  ) : null}
                  {error ? (
                    <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
                      {error}
                    </p>
                  ) : null}

                  <div className="flex flex-wrap gap-2">
                    <button
                      className="seller-primary-button"
                      disabled={isSaving}
                      type="button"
                      onClick={() => void saveImage({ goNext: true })}
                    >
                      {isSaving ? "Saving" : "Save & Next Missing"}
                    </button>
                    <button
                      className="seller-secondary-button"
                      disabled={isSaving}
                      type="button"
                      onClick={() => void saveImage({ goNext: false })}
                    >
                      Save
                    </button>
                  </div>
                </div>
              </AdminCard>
            </div>

            <AdminCard>
              <div className="grid gap-5 p-5">
                <div>
                  <h2 className="text-lg font-bold text-stone-950">
                    Catalog Details
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-stone-600">
                    Edit platform catalog text and chicken metadata. This does
                    not edit seller breed profiles.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <ReadOnlyFact label="Breed Name" value={breed.breed_name} />
                  <ReadOnlyFact label="Breed Slug" value={breed.breed_slug} />
                  <ReadOnlyFact label="Species" value={breed.species_name} />
                </div>

                <label className="grid gap-1 text-sm font-semibold text-stone-700">
                  Description
                  <textarea
                    className="min-h-32 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-medium leading-6 text-stone-950 shadow-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
                    value={detailsForm.description}
                    onChange={(event) =>
                      setDetailsForm((current) => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                  />
                </label>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="grid gap-1 text-sm font-semibold text-stone-700">
                    Category
                    <input
                      className="min-h-10 rounded-md border border-stone-300 bg-white px-3 text-sm font-medium text-stone-950 shadow-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
                      value={detailsForm.category}
                      onChange={(event) =>
                        setDetailsForm((current) => ({
                          ...current,
                          category: event.target.value,
                        }))
                      }
                    />
                  </label>

                  <label className="grid gap-1 text-sm font-semibold text-stone-700">
                    Bird Type
                    <select
                      className="min-h-10 rounded-md border border-stone-300 bg-white px-3 text-sm font-medium text-stone-950 shadow-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
                      value={detailsForm.bird_type}
                      onChange={(event) =>
                        setDetailsForm((current) => ({
                          ...current,
                          bird_type: event.target.value,
                        }))
                      }
                    >
                      <option value="">Not set</option>
                      {catalogBirdTypeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="grid gap-1 text-sm font-semibold text-stone-700">
                    Egg Color
                    <select
                      className="min-h-10 rounded-md border border-stone-300 bg-white px-3 text-sm font-medium text-stone-950 shadow-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
                      value={detailsForm.egg_color}
                      onChange={(event) =>
                        setDetailsForm((current) => ({
                          ...current,
                          egg_color: event.target.value,
                        }))
                      }
                    >
                      <option value="">Not set</option>
                      {eggColorOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="grid gap-1 text-sm font-semibold text-stone-700">
                    Annual Egg Production
                    <select
                      className="min-h-10 rounded-md border border-stone-300 bg-white px-3 text-sm font-medium text-stone-950 shadow-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
                      value={detailsForm.annual_egg_production}
                      onChange={(event) =>
                        setDetailsForm((current) => ({
                          ...current,
                          annual_egg_production: event.target.value,
                        }))
                      }
                    >
                      <option value="">Not set</option>
                      <option value="under_150">Under 150</option>
                      <option value="150_200">150-200</option>
                      <option value="200_250">200-250</option>
                      <option value="250_300">250-300</option>
                      <option value="over_300">Over 300</option>
                    </select>
                  </label>
                </div>

                <label className="grid gap-1 text-sm font-semibold text-stone-700">
                  Image Prompt
                  <textarea
                    className="min-h-24 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-medium leading-6 text-stone-950 shadow-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
                    value={detailsForm.image_prompt}
                    onChange={(event) =>
                      setDetailsForm((current) => ({
                        ...current,
                        image_prompt: event.target.value,
                      }))
                    }
                  />
                </label>

                {detailsMessage ? (
                  <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-900">
                    {detailsMessage}
                  </p>
                ) : null}
                {detailsError ? (
                  <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
                    {detailsError}
                  </p>
                ) : null}

                <div>
                  <button
                    className="seller-secondary-button"
                    disabled={isSavingDetails}
                    type="button"
                    onClick={() => void saveCatalogDetails()}
                  >
                    {isSavingDetails ? "Saving Details" : "Save Catalog Details"}
                  </button>
                </div>
              </div>
            </AdminCard>
          </>
        ) : null}
      </div>
    </>
  );
}

const emptyDetailsForm: CatalogDetailsForm = {
  annual_egg_production: "",
  bird_type: "",
  category: "",
  description: "",
  egg_color: "",
  image_prompt: "",
};

function toDetailsForm(
  breed: AdminCatalogBreedDetailRow | null,
): CatalogDetailsForm {
  if (!breed) return emptyDetailsForm;

  return {
    annual_egg_production: breed.annual_egg_production ?? "",
    bird_type: breed.bird_type ?? "",
    category: breed.category ?? "",
    description: breed.description ?? "",
    egg_color: breed.egg_color ?? "",
    image_prompt: breed.image_prompt ?? "",
  };
}

function ReadOnlyFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
      <p className="text-xs font-bold uppercase tracking-[0.08em] text-stone-500">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-stone-950">{value}</p>
    </div>
  );
}

function toCatalogImageSrc(value: string | null | undefined) {
  const imageUrl = value?.trim();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");

  if (!imageUrl) return "";
  if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
    return imageUrl;
  }
  if (imageUrl.startsWith("/storage/v1/object/public/") && supabaseUrl) {
    return `${supabaseUrl}${imageUrl}`;
  }
  if (imageUrl.startsWith("/")) return imageUrl;
  if (supabaseUrl) return `${supabaseUrl}/storage/v1/object/public/${imageUrl}`;

  return `/storage/v1/object/public/${imageUrl}`;
}
