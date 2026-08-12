"use client";

import Image from "next/image";
import { formatBreedDisplayName } from "@/lib/breed-identity";
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  ImageIcon,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getCropImageStyle,
  PhotoCropEditor,
  type PhotoCropMetadata,
} from "../_components/photo-crop-editor";
import {
  sellerAcceptedImageTypes,
  validateSellerPhoto,
} from "../_components/seller-media-client";
import {
  getBreedInitials,
  toDisplayImageUrl,
  type BreedLibraryItem,
  type BreedSpecies,
} from "./breed-data";
import {
  createBlankCustomBreedDraft,
  CustomBreedForm,
  type CustomBreedDraft,
  validateCustomBreedDraft,
} from "./custom-breed-form";

type AddResult =
  | { breedProfileId: string; ok: true; warning?: string }
  | { message: string; ok: false };

type MobileAddBreedSheetProps = {
  existingBreedIds: Set<string>;
  libraryBreeds: BreedLibraryItem[];
  species: BreedSpecies[];
  speciesById: Map<string, string>;
  onAddLibraryBreed: (breed: BreedLibraryItem) => Promise<AddResult>;
  onClose: (addedCount: number) => void;
  onCreateCustomBreed: (
    draft: CustomBreedDraft,
    photos: { crop: PhotoCropMetadata; file: File }[],
  ) => Promise<AddResult>;
  onCustomCreated: (breedProfileId: string, warning?: string) => void;
  onLibraryDone: (addedCount: number) => void;
};

type MobileAddMode = "choose" | "custom" | "library";

export function MobileAddBreedSheet({
  existingBreedIds,
  libraryBreeds,
  onAddLibraryBreed,
  onClose,
  onCreateCustomBreed,
  onCustomCreated,
  onLibraryDone,
  species,
  speciesById,
}: MobileAddBreedSheetProps) {
  const [mode, setMode] = useState<MobileAddMode>("choose");
  const [query, setQuery] = useState("");
  const [speciesFilter, setSpeciesFilter] = useState("all");
  const [addingBreedId, setAddingBreedId] = useState<string | null>(null);
  const [sessionAddedIds, setSessionAddedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [customDraft, setCustomDraft] = useState<CustomBreedDraft>(() =>
    createBlankCustomBreedDraft(species[0]?.id ?? ""),
  );
  const [isCreatingCustom, setIsCreatingCustom] = useState(false);
  const [customPhotos, setCustomPhotos] = useState<
    {
      clientId: string;
      crop: PhotoCropMetadata;
      file: File;
      previewUrl: string;
    }[]
  >([]);
  const [cropCandidate, setCropCandidate] = useState<{
    file: File;
    previewUrl: string;
    targetId: string | null;
  } | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoSourceTargetId, setPhotoSourceTargetId] = useState<string | null>(
    null,
  );
  const [isPhotoSourceOpen, setIsPhotoSourceOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const filteredBreeds = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return libraryBreeds
      .filter((breed) => {
        if (
          existingBreedIds.has(breed.id) &&
          !sessionAddedIds.has(breed.id)
        ) {
          return false;
        }
        if (speciesFilter !== "all" && breed.species_id !== speciesFilter) {
          return false;
        }
        if (!normalizedQuery) return true;
        return formatBreedDisplayName(breed.breed_name, breed.variety)
          .toLowerCase()
          .includes(normalizedQuery);
      })
      .slice(0, 40);
  }, [
    existingBreedIds,
    libraryBreeds,
    query,
    sessionAddedIds,
    speciesFilter,
  ]);

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    window.requestAnimationFrame(() => {
      sheetRef.current
        ?.querySelector<HTMLElement>("button:not([disabled])")
        ?.focus();
    });

    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSheet();
      return;
    }
    if (event.key !== "Tab") return;

    const focusableElements = Array.from(
      sheetRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
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

  function goBack() {
    setError(null);
    setMode("choose");
  }

  function closeSheet() {
    for (const photo of customPhotos) URL.revokeObjectURL(photo.previewUrl);
    if (cropCandidate) URL.revokeObjectURL(cropCandidate.previewUrl);
    onClose(sessionAddedIds.size);
  }

  async function addLibraryBreed(breed: BreedLibraryItem) {
    if (addingBreedId || sessionAddedIds.has(breed.id)) return;
    setAddingBreedId(breed.id);
    setError(null);

    const result = await onAddLibraryBreed(breed);
    setAddingBreedId(null);

    if (!result.ok) {
      setError(result.message);
      return;
    }

    setSessionAddedIds((current) => new Set(current).add(breed.id));
  }

  async function createCustomBreed() {
    if (isCreatingCustom) return;

    const validation = validateCustomBreedDraft({
      draft: customDraft,
      species,
    });

    if (!validation.ok) {
      setError(validation.message);
      return;
    }

    setIsCreatingCustom(true);
    setError(null);
    const result = await onCreateCustomBreed(
      validation.draft,
      customPhotos.map((photo) => ({
        crop: photo.crop,
        file: photo.file,
      })),
    );
    setIsCreatingCustom(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }

    for (const photo of customPhotos) URL.revokeObjectURL(photo.previewUrl);
    onCustomCreated(result.breedProfileId, result.warning);
  }

  function chooseCustomPhoto(file: File | undefined, targetId: string | null) {
    if (!file) return;
    const validationError = validateSellerPhoto(file);

    if (validationError) {
      setPhotoError(validationError.message);
      setIsPhotoSourceOpen(false);
      return;
    }

    setPhotoError(null);
    setCropCandidate({
      file,
      previewUrl: URL.createObjectURL(file),
      targetId,
    });
    setIsPhotoSourceOpen(false);
  }

  function openPhotoSource(targetId: string | null) {
    setPhotoSourceTargetId(targetId);
    setIsPhotoSourceOpen(true);
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end bg-stone-950/55 lg:hidden"
      onKeyDown={handleKeyDown}
    >
      <div
        aria-label="Add Breed"
        aria-modal="true"
        className="relative flex h-[calc(100dvh-1.5rem)] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl"
        ref={sheetRef}
        role="dialog"
      >
        <div className="shrink-0 border-b border-stone-200 bg-white px-4 pt-2">
          <div className="mx-auto h-1.5 w-12 rounded-full bg-stone-300" />
          <div className="grid min-h-16 grid-cols-[44px_1fr_44px] items-center">
            {mode === "choose" ? (
              <span aria-hidden="true" />
            ) : (
              <button
                aria-label="Back to Add Breed choices"
                className="inline-flex size-11 items-center justify-center rounded-full text-stone-800 focus:outline-none focus:ring-2 focus:ring-emerald-700/25"
                onClick={goBack}
                type="button"
              >
                <ChevronLeft aria-hidden="true" className="size-6" />
              </button>
            )}
            <h2 className="text-center text-xl font-bold text-stone-950">
              Add Breed
            </h2>
            <button
              aria-label="Close Add Breed"
              className="inline-flex size-11 items-center justify-center rounded-full text-stone-800 focus:outline-none focus:ring-2 focus:ring-emerald-700/25"
              onClick={closeSheet}
              type="button"
            >
              <X aria-hidden="true" className="size-6" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {mode === "choose" ? (
            <div className="p-5 pb-[calc(2rem+env(safe-area-inset-bottom))]">
              <p className="text-base leading-6 text-stone-700">
                Choose a common breed or create your own.
              </p>
              <div className="mt-5 grid gap-4">
                <button
                  className="grid min-h-40 grid-cols-[1fr_28px] items-center rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-left text-emerald-950 focus:outline-none focus:ring-2 focus:ring-emerald-800"
                  onClick={() => setMode("library")}
                  type="button"
                >
                  <span>
                    <Image
                      alt=""
                      height={32}
                      src="/glyphs/looking-glass.png"
                      width={32}
                    />
                    <span className="mt-4 block text-lg font-bold">
                      Choose from Breed Library
                    </span>
                    <span className="mt-2 block text-base leading-6">
                      Browse common breeds and add one to your store.
                    </span>
                  </span>
                  <ChevronRight aria-hidden="true" className="size-6" />
                </button>
                <button
                  className="grid min-h-40 grid-cols-[1fr_28px] items-center rounded-xl border border-amber-100 bg-[#fffaf0] p-5 text-left text-emerald-950 focus:outline-none focus:ring-2 focus:ring-emerald-800"
                  onClick={() => setMode("custom")}
                  type="button"
                >
                  <span>
                    <Image
                      alt=""
                      height={32}
                      src="/glyphs/pencil.png"
                      width={32}
                    />
                    <span className="mt-4 block text-lg font-bold">
                      Create Custom Breed
                    </span>
                    <span className="mt-2 block text-base leading-6">
                      Enter the breed information yourself.
                    </span>
                  </span>
                  <ChevronRight aria-hidden="true" className="size-6" />
                </button>
              </div>
            </div>
          ) : null}

          {mode === "library" ? (
            <div
              className={`p-4 ${
                sessionAddedIds.size > 0
                  ? "pb-[calc(7rem+env(safe-area-inset-bottom))]"
                  : "pb-[calc(2rem+env(safe-area-inset-bottom))]"
              }`}
            >
              <p className="text-base leading-6 text-stone-700">
                Choose a common breed from the Breed Library.
              </p>
              <label className="relative mt-4 block">
                <span className="sr-only">Search breeds</span>
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-stone-600"
                />
                <input
                  className="h-14 w-full rounded-lg border border-stone-300 bg-white pl-12 pr-4 text-base text-stone-950 shadow-sm placeholder:text-stone-500 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search breeds"
                  type="search"
                  value={query}
                />
              </label>
              <label className="mt-3 block max-w-56">
                <span className="sr-only">Filter by species</span>
                <select
                  aria-label="Filter by species"
                  className="h-12 w-full rounded-lg border border-stone-300 bg-white px-3 text-base font-bold text-emerald-950 shadow-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
                  onChange={(event) => setSpeciesFilter(event.target.value)}
                  value={speciesFilter}
                >
                  <option value="all">Species: All</option>
                  {species.map((item) => (
                    <option key={item.id} value={item.id}>
                      Species: {item.common_name}
                    </option>
                  ))}
                </select>
              </label>

              {error ? (
                <p
                  aria-live="assertive"
                  className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800"
                >
                  {error}
                </p>
              ) : null}

              {filteredBreeds.length === 0 ? (
                <div className="py-10 text-center">
                  <h3 className="text-base font-bold text-stone-950">
                    No matching breeds
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-stone-600">
                    Try a different search or species filter.
                  </p>
                </div>
              ) : (
                <div className="mt-4 space-y-2">
                  {filteredBreeds.map((breed) => {
                    const isAdded = sessionAddedIds.has(breed.id);
                    const isAdding = addingBreedId === breed.id;

                    return (
                      <div
                        className="flex min-h-[76px] items-center gap-3 rounded-lg border border-stone-200 bg-white px-3 py-2.5 shadow-sm"
                        key={breed.id}
                      >
                        <MobileLibraryThumbnail breed={breed} />
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate text-base font-bold text-stone-950">
                            {formatBreedDisplayName(breed.breed_name, breed.variety)}
                          </h3>
                          <p className="mt-1 text-sm font-medium text-stone-600">
                            {speciesById.get(breed.species_id) ?? "Species"}
                          </p>
                        </div>
                        <button
                          aria-label={
                            isAdded
                              ? `${formatBreedDisplayName(breed.breed_name, breed.variety)} was added to My Breeds`
                              : `Add ${formatBreedDisplayName(breed.breed_name, breed.variety)} to My Breeds`
                          }
                          className={`min-h-11 shrink-0 rounded-full border px-4 text-sm font-bold ${
                            isAdded
                              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                              : "border-emerald-200 bg-white text-emerald-900"
                          }`}
                          disabled={isAdded || isAdding || Boolean(addingBreedId)}
                          onClick={() => void addLibraryBreed(breed)}
                          type="button"
                        >
                          {isAdded ? "Added ✓" : isAdding ? "Adding" : "Add"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}

          {mode === "custom" ? (
            <div className="p-4 pb-[calc(9rem+env(safe-area-inset-bottom))]">
              <p className="text-base leading-6 text-stone-700">
                Create a custom breed.
              </p>
              {error ? (
                <p
                  aria-live="assertive"
                  className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800"
                >
                  {error}
                </p>
              ) : null}
              <div className="mt-5 grid gap-5">
                <CustomBreedForm
                  draft={customDraft}
                  disabled={isCreatingCustom}
                  layout="mobile"
                  onDraftChange={setCustomDraft}
                  species={species}
                />
                <div>
                  <p className="text-base font-bold text-stone-800">
                    Photos{" "}
                    <span className="font-medium text-stone-500">
                      ({customPhotos.length}/4 · optional)
                    </span>
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    {customPhotos.map((photo) => (
                      <div className="relative" key={photo.clientId}>
                        <button
                          aria-label="Change custom breed photo"
                          className="relative block aspect-square w-full overflow-hidden rounded-lg border border-emerald-200 bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-700/25"
                          onClick={() => openPhotoSource(photo.clientId)}
                          type="button"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            alt=""
                            className="h-full w-full object-cover"
                            src={photo.previewUrl}
                            style={getCropImageStyle(photo.crop)}
                          />
                        </button>
                      <button
                        aria-label="Remove selected custom breed photo"
                          className="absolute right-2 top-2 inline-flex size-11 items-center justify-center rounded-full border border-white/80 bg-white/95 text-red-700 shadow-sm"
                        onClick={() => {
                            URL.revokeObjectURL(photo.previewUrl);
                            setCustomPhotos((current) =>
                              current.filter(
                                (item) => item.clientId !== photo.clientId,
                              ),
                            );
                          setPhotoError(null);
                        }}
                        type="button"
                      >
                        <Trash2 aria-hidden="true" className="size-5" />
                      </button>
                      </div>
                    ))}
                    {customPhotos.length < 4 ? (
                      <button
                        aria-label="Add custom breed photo"
                        className="flex aspect-square flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 bg-stone-50 px-3 text-center text-base font-bold text-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-700/25"
                        onClick={() => openPhotoSource(null)}
                        type="button"
                      >
                        <Camera aria-hidden="true" className="size-7" />
                        <span className="mt-2">Add photo</span>
                        <span className="mt-1 text-sm font-medium text-stone-600">
                          JPG, PNG, or WebP
                        </span>
                      </button>
                    ) : null}
                  </div>
                  {photoError ? (
                    <p
                      aria-live="assertive"
                      className="mt-2 text-sm font-semibold text-red-700"
                    >
                      {photoError}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {mode === "library" && sessionAddedIds.size > 0 ? (
          <div className="absolute inset-x-0 bottom-0 border-t border-emerald-900/15 bg-white/95 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] backdrop-blur">
            <button
              className="min-h-14 w-full rounded-lg bg-emerald-800 px-5 text-lg font-bold text-white"
              onClick={() => onLibraryDone(sessionAddedIds.size)}
              type="button"
            >
              Done · {sessionAddedIds.size} added
            </button>
          </div>
        ) : null}

        {mode === "custom" ? (
          <div className="absolute inset-x-0 bottom-0 grid gap-2 border-t border-stone-200 bg-white/95 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] backdrop-blur">
            <button
              className="min-h-14 w-full rounded-lg bg-emerald-800 px-5 text-lg font-bold text-white disabled:opacity-60"
              disabled={isCreatingCustom}
              onClick={() => void createCustomBreed()}
              type="button"
            >
              {isCreatingCustom ? "Creating Breed" : "Create Breed"}
            </button>
            <button
              className="min-h-12 w-full rounded-lg border border-emerald-800 bg-white px-4 text-base font-bold text-emerald-900"
              disabled={isCreatingCustom}
              onClick={goBack}
              type="button"
            >
              Back
            </button>
          </div>
        ) : null}

        {isPhotoSourceOpen ? (
          <CustomPhotoSourceSheet
            cameraInputRef={cameraInputRef}
            libraryInputRef={libraryInputRef}
            onClose={() => setIsPhotoSourceOpen(false)}
            onChoose={(file) =>
              chooseCustomPhoto(file, photoSourceTargetId)
            }
          />
        ) : null}

        {cropCandidate ? (
          <PhotoCropEditor
            hideReset
            photo={{
              label: customDraft.name.trim() || "Custom breed photo",
              url: cropCandidate.previewUrl,
            }}
            saveLabel="Done"
            title="Crop photo"
            onCancel={() => {
              URL.revokeObjectURL(cropCandidate.previewUrl);
              setCropCandidate(null);
            }}
            onReset={() => undefined}
            onSave={(crop) => {
              const nextPhoto = {
                clientId: cropCandidate.targetId ?? crypto.randomUUID(),
                crop: { ...crop, aspect: 1 },
                file: cropCandidate.file,
                previewUrl: cropCandidate.previewUrl,
              };

              if (cropCandidate.targetId) {
                setCustomPhotos((current) =>
                  current.map((photo) => {
                    if (photo.clientId !== cropCandidate.targetId) return photo;
                    URL.revokeObjectURL(photo.previewUrl);
                    return nextPhoto;
                  }),
                );
              } else {
                setCustomPhotos((current) => [...current, nextPhoto]);
              }

              setCropCandidate(null);
              setPhotoError(null);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

function CustomPhotoSourceSheet({
  cameraInputRef,
  libraryInputRef,
  onChoose,
  onClose,
}: {
  cameraInputRef: React.RefObject<HTMLInputElement | null>;
  libraryInputRef: React.RefObject<HTMLInputElement | null>;
  onChoose: (file: File | undefined) => void;
  onClose: () => void;
}) {
  const sourceSheetRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    window.requestAnimationFrame(() => {
      sourceSheetRef.current
        ?.querySelector<HTMLButtonElement>("button")
        ?.focus();
    });

    return () => previousFocusRef.current?.focus();
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;

    const focusableElements = Array.from(
      sourceSheetRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled])",
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

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end bg-stone-950/45"
      onClick={onClose}
      onKeyDown={handleKeyDown}
      role="presentation"
    >
      <div
        aria-label="Choose photo source"
        aria-modal="true"
        className="w-full rounded-t-2xl bg-white px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        ref={sourceSheetRef}
        role="dialog"
      >
        <div className="mx-auto h-1.5 w-12 rounded-full bg-stone-300" />
        <h2 className="py-5 text-xl font-bold text-stone-950">Add photo</h2>
        <div className="divide-y divide-stone-200 border-y border-stone-200">
          <button
            className="flex min-h-16 w-full items-center gap-4 px-2 text-left text-lg font-semibold text-stone-950"
            onClick={() => cameraInputRef.current?.click()}
            type="button"
          >
            <Camera aria-hidden="true" className="size-6" />
            Take photo
          </button>
          <button
            className="flex min-h-16 w-full items-center gap-4 px-2 text-left text-lg font-semibold text-stone-950"
            onClick={() => libraryInputRef.current?.click()}
            type="button"
          >
            <ImageIcon aria-hidden="true" className="size-6" />
            Choose from library
          </button>
        </div>
        <input
          accept={sellerAcceptedImageTypes.join(",")}
          capture="environment"
          className="sr-only"
          onChange={(event) => {
            onChoose(event.target.files?.[0]);
            event.target.value = "";
          }}
          ref={cameraInputRef}
          type="file"
        />
        <input
          accept={sellerAcceptedImageTypes.join(",")}
          className="sr-only"
          onChange={(event) => {
            onChoose(event.target.files?.[0]);
            event.target.value = "";
          }}
          ref={libraryInputRef}
          type="file"
        />
        <button
          className="mt-5 min-h-12 w-full rounded-lg border border-stone-300 bg-white px-4 text-base font-bold text-emerald-900"
          onClick={onClose}
          type="button"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function MobileLibraryThumbnail({ breed }: { breed: BreedLibraryItem }) {
  const [hasImageError, setHasImageError] = useState(false);
  const imageUrl =
    !hasImageError && breed.image_url
      ? toDisplayImageUrl(breed.image_url)
      : "";

  if (!imageUrl) {
    return (
      <span
        aria-hidden="true"
        className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-base font-bold text-emerald-900"
      >
        {getBreedInitials(formatBreedDisplayName(breed.breed_name, breed.variety))}
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className="size-14 shrink-0 overflow-hidden rounded-lg bg-emerald-50"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt=""
        className="h-full w-full object-cover"
        onError={() => setHasImageError(true)}
        src={imageUrl}
      />
    </span>
  );
}
