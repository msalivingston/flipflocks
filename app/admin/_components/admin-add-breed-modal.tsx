"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { BreedSpecies } from "@/app/dashboard/breeds/breed-data";
import {
  createBlankCustomBreedDraft,
  CustomBreedForm,
  type CustomBreedDraft,
  validateCustomBreedDraft,
} from "@/app/dashboard/breeds/custom-breed-form";

type CreatedCatalogBreed = {
  breed_id: string;
  breed_slug: string;
};

export function AdminAddBreedModal({
  initialDraft,
  mode = "create",
  onClose,
  species,
}: {
  initialDraft?: CustomBreedDraft;
  mode?: "create" | "duplicate";
  onClose: () => void;
  species: BreedSpecies[];
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const varietyInputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<CustomBreedDraft>(() =>
    initialDraft
      ? { ...initialDraft }
      : createBlankCustomBreedDraft(species[0]?.id ?? ""),
  );
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const isDuplicate = mode === "duplicate";
  const modalTitle = isDuplicate ? "Duplicate Breed" : "Create Breed";

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    window.requestAnimationFrame(() => {
      if (isDuplicate) {
        varietyInputRef.current?.focus();
        return;
      }
      dialogRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    });

    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, [isDuplicate]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !isCreating) {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;

    const focusableElements = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
      ) ?? [],
    );
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    if (!firstElement || !lastElement) return;

    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  }

  async function createBreed(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isCreating) return;

    const validation = validateCustomBreedDraft({
      draft,
      requireChickenBreedCategory: true,
      species,
    });

    if (!validation.ok) {
      setError(validation.message);
      return;
    }

    setIsCreating(true);
    setError(null);

    const { data, error: createError } = await supabase.rpc(
      "admin_create_catalog_breed",
      {
        p_annual_egg_production:
          validation.draft.annualEggProduction || null,
        p_breed_name: validation.draft.name,
        p_category: validation.draft.breedCategory || null,
        p_description: validation.draft.description || null,
        p_egg_color: validation.draft.eggColor || null,
        p_species_id: validation.draft.speciesId,
        p_variety: validation.draft.variety || null,
      },
    );

    if (createError) {
      setError(
        createError.code === "23505"
          ? "This breed and variety already exist for this species."
          : createError.message,
      );
      setIsCreating(false);
      return;
    }

    const rows = (data ?? []) as CreatedCatalogBreed[];
    const createdBreed = rows[0];

    if (!createdBreed?.breed_id) {
      setError("Breed was created, but its catalog record could not be opened.");
      setIsCreating(false);
      return;
    }

    router.push(`/admin/breeds/${createdBreed.breed_id}`);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/60 px-3 py-4 sm:items-center"
      onKeyDown={handleKeyDown}
    >
      <div
        aria-labelledby="admin-add-breed-title"
        aria-modal="true"
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
        ref={dialogRef}
        role="dialog"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-stone-200 px-5 py-4">
          <div>
            <h2 className="text-xl font-semibold text-stone-950" id="admin-add-breed-title">
              {modalTitle}
            </h2>
            <p className="mt-1 text-sm leading-6 text-stone-600">
              {isDuplicate
                ? "Use this breed as a starting point for a new global catalog record. Its catalog photo will not be copied."
                : "Add a canonical breed to FlockFront's global Breed Catalog. You can add its catalog photo after creation."}
            </p>
          </div>
          <button
            aria-label={`Close ${modalTitle}`}
            className="rounded-md px-2 py-1 text-2xl leading-none text-stone-500 hover:bg-stone-100 hover:text-stone-950"
            disabled={isCreating}
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>

        <form className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-5" onSubmit={createBreed}>
          {error ? (
            <p
              aria-live="assertive"
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800"
            >
              {error}
            </p>
          ) : null}

          <CustomBreedForm
            chickenBreedCategoryRequired
            descriptionLabel="Catalog description"
            descriptionPlaceholder="Add the default catalog description."
            disabled={isCreating}
            draft={draft}
            onDraftChange={setDraft}
            species={species}
            varietyInputRef={varietyInputRef}
          />

          <div className="flex flex-col-reverse gap-2 border-t border-stone-200 pt-4 sm:flex-row sm:justify-end">
            <button
              className="seller-secondary-button"
              disabled={isCreating}
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className="seller-primary-button"
              disabled={isCreating}
              type="submit"
            >
              {isCreating
                ? isDuplicate
                  ? "Creating Duplicate"
                  : "Creating Breed"
                : isDuplicate
                  ? "Create Duplicate"
                  : "Create Breed"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
