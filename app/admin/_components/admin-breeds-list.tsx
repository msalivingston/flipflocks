"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { AdminCatalogBreedListRow } from "../_lib/admin-types";
import {
  AdminAccessState,
  AdminCard,
  AdminErrorState,
  AdminLoadingState,
  AdminPageHeader,
  AdminStatusBadge,
  isAdminAuthorizationError,
} from "./admin-ui";

type ImageFilter = "all" | "missing" | "has";

export function AdminBreedsList({
  initialImageFilter = "all",
}: {
  initialImageFilter?: ImageFilter;
}) {
  const [breeds, setBreeds] = useState<AdminCatalogBreedListRow[]>([]);
  const [query, setQuery] = useState("");
  const [speciesFilter, setSpeciesFilter] = useState("all");
  const [imageFilter, setImageFilter] =
    useState<ImageFilter>(initialImageFilter);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadBreeds() {
      setIsLoading(true);
      setError(null);

      const { data: userData, error: userError } = await supabase.auth.getUser();

      if (!isMounted) return;

      if (userError || !userData.user) {
        setError("Sign in with a platform admin account to view this area.");
        setIsLoading(false);
        return;
      }

      const { data, error: breedsError } = await supabase.rpc(
        "admin_catalog_breed_list",
      );

      if (!isMounted) return;

      if (breedsError) {
        setError(breedsError.message);
        setIsLoading(false);
        return;
      }

      setBreeds((data ?? []) as AdminCatalogBreedListRow[]);
      setIsLoading(false);
    }

    void loadBreeds();

    return () => {
      isMounted = false;
    };
  }, []);

  const speciesOptions = useMemo(() => {
    const options = new Map<string, string>();

    for (const breed of breeds) {
      options.set(breed.species_slug, breed.species_name);
    }

    return Array.from(options, ([slug, name]) => ({ name, slug })).sort(
      (first, second) => first.name.localeCompare(second.name),
    );
  }, [breeds]);

  const filteredBreeds = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return breeds
      .filter((breed) => {
        const matchesQuery =
          !normalizedQuery ||
          breed.breed_name.toLowerCase().includes(normalizedQuery) ||
          breed.breed_slug.toLowerCase().includes(normalizedQuery);
        const matchesSpecies =
          speciesFilter === "all" || breed.species_slug === speciesFilter;
        const matchesImage =
          imageFilter === "all" ||
          (imageFilter === "missing" && !breed.has_image) ||
          (imageFilter === "has" && breed.has_image);

        return matchesQuery && matchesSpecies && matchesImage;
      })
      .toSorted((first, second) =>
        first.breed_name.localeCompare(second.breed_name, undefined, {
          sensitivity: "base",
        }),
      );
  }, [breeds, imageFilter, query, speciesFilter]);

  const missingCount = breeds.filter((breed) => !breed.has_image).length;
  const hasImageCount = breeds.length - missingCount;

  return (
    <>
      <AdminPageHeader
        eyebrow="Platform Admin"
        title="Breed Catalog Images"
        description="Upload and replace default catalog breed images. Seller-uploaded images are not changed."
      />

      <div className="mx-auto grid w-full max-w-7xl gap-5 px-5 py-5 sm:px-7">
        {isLoading ? <AdminLoadingState label="Loading breeds" /> : null}

        {!isLoading && error ? (
          isAdminAuthorizationError(error) ? (
            <AdminAccessState message={error} />
          ) : (
            <AdminErrorState message={error} />
          )
        ) : null}

        {!isLoading && !error ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <QueueCard label="Missing Images" value={missingCount} />
              <QueueCard label="Has Image" value={hasImageCount} />
              <QueueCard label="Total Breeds" value={breeds.length} />
            </div>

            <AdminCard>
              <div className="grid gap-4 p-4 lg:grid-cols-[1fr_auto] lg:items-end">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_14rem_13rem]">
                  <label className="grid gap-1 text-sm font-semibold text-stone-700">
                    Search
                    <input
                      className="min-h-10 rounded-md border border-stone-300 bg-white px-3 text-sm font-medium text-stone-950 shadow-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
                      placeholder="Breed name or slug"
                      type="search"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </label>

                  <label className="grid gap-1 text-sm font-semibold text-stone-700">
                    Species
                    <select
                      className="min-h-10 rounded-md border border-stone-300 bg-white px-3 text-sm font-medium text-stone-950 shadow-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
                      value={speciesFilter}
                      onChange={(event) => setSpeciesFilter(event.target.value)}
                    >
                      <option value="all">All species</option>
                      {speciesOptions.map((species) => (
                        <option key={species.slug} value={species.slug}>
                          {species.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="grid gap-1 text-sm font-semibold text-stone-700">
                    Image status
                    <select
                      className="min-h-10 rounded-md border border-stone-300 bg-white px-3 text-sm font-medium text-stone-950 shadow-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
                      value={imageFilter}
                      onChange={(event) =>
                        setImageFilter(event.target.value as ImageFilter)
                      }
                    >
                      <option value="all">All breeds</option>
                      <option value="missing">Missing image only</option>
                      <option value="has">Has image only</option>
                    </select>
                  </label>
                </div>

                <button
                  className="seller-primary-button"
                  type="button"
                  onClick={() => setImageFilter("missing")}
                >
                  Missing images
                </button>
              </div>
            </AdminCard>

            <div className="grid gap-3">
              {filteredBreeds.length > 0 ? (
                filteredBreeds.map((breed) => (
                  <BreedQueueRow breed={breed} key={breed.breed_id} />
                ))
              ) : (
                <AdminCard>
                  <p className="p-5 text-sm font-semibold text-stone-600">
                    No breeds match these filters.
                  </p>
                </AdminCard>
              )}
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}

function BreedQueueRow({ breed }: { breed: AdminCatalogBreedListRow }) {
  return (
    <AdminCard>
      <article className="grid gap-4 p-4 md:grid-cols-[5rem_1fr_auto] md:items-center">
        <BreedThumbnail breed={breed} />

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              className="truncate text-base font-bold text-stone-950 hover:text-emerald-900"
              href={`/admin/breeds/${breed.breed_id}`}
            >
              {breed.breed_name}
            </Link>
            <AdminStatusBadge
              value={breed.has_image ? "Has image" : "Missing image"}
            />
          </div>
          <p className="mt-1 text-sm font-semibold text-stone-500">
            {breed.species_name} / {breed.breed_slug}
          </p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold text-stone-600">
            {breed.bird_type ? (
              <span className="rounded bg-stone-100 px-2 py-1 capitalize">
                {breed.bird_type.replaceAll("_", " ")}
              </span>
            ) : null}
            {breed.egg_color ? (
              <span className="rounded bg-stone-100 px-2 py-1">
                {breed.egg_color}
              </span>
            ) : null}
          </div>
        </div>

        <Link
          className="seller-small-button justify-center"
          href={`/admin/breeds/${breed.breed_id}`}
        >
          Open
        </Link>
      </article>
    </AdminCard>
  );
}

function BreedThumbnail({ breed }: { breed: AdminCatalogBreedListRow }) {
  const [failed, setFailed] = useState(false);
  const imageSrc = toCatalogImageSrc(breed.image_url);

  if (!imageSrc || failed) {
    return (
      <div className="flex aspect-square w-20 items-center justify-center rounded-lg border border-dashed border-stone-300 bg-stone-50 text-center text-xs font-bold text-stone-500">
        Missing
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt={`${breed.breed_name} catalog`}
      className="aspect-square w-20 rounded-lg border border-stone-200 object-cover"
      src={imageSrc}
      onError={() => setFailed(true)}
    />
  );
}

function QueueCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-[0.08em] text-stone-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold text-stone-950">{value}</p>
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
