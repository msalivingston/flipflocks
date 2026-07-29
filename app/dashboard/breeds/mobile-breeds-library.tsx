"use client";

import {
  Camera,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Funnel,
  ImageIcon,
  MoreHorizontal,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
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
import type { ListingPhotoItem } from "../listings/[listingBatchId]/listing-photos-section";
import {
  getBreedInitials,
  getProfileDescription,
  pickFeaturedMedia,
  toDisplayImageUrl,
  type BreedLibraryItem,
  type BreedSpecies,
  type SellerBreedProfile,
} from "./breed-data";

type MobileBreedsLibraryProps = {
  actionError: string | null;
  autoExpandProfileId: string | null;
  catalogQuery: string;
  catalogSpeciesFilter: string;
  hasActiveCatalogFilters: boolean;
  libraryByBreedId: Map<string, BreedLibraryItem>;
  mediaByProfileId: Map<string, ListingPhotoItem[]>;
  profiles: SellerBreedProfile[];
  selectedProfileIds: Set<string>;
  species: BreedSpecies[];
  speciesById: Map<string, string>;
  successMessage: string | null;
  usageLoadError: string | null;
  visibleProfiles: SellerBreedProfile[];
  onAddBreed: () => void;
  onClearSelection: () => void;
  onOpenBulkRemove: () => void;
  onOpenSingleRemove: (profileId: string) => void;
  onResetCatalogFilters: () => void;
  onSaveBreedChanges: (
    profileId: string,
    description: string,
    photoChange:
      | { kind: "none" }
      | {
          additions: { crop: PhotoCropMetadata; file: File }[];
          kind: "update";
          removedMediaLinkIds: string[];
        },
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
  onSetCatalogQuery: (value: string) => void;
  onSetCatalogSpeciesFilter: (value: string) => void;
  onToggleAllVisible: () => void;
  onToggleProfileSelection: (profileId: string) => void;
};

export function MobileBreedsLibrary({
  actionError,
  autoExpandProfileId,
  catalogQuery,
  catalogSpeciesFilter,
  hasActiveCatalogFilters,
  libraryByBreedId,
  mediaByProfileId,
  onAddBreed,
  onClearSelection,
  onOpenBulkRemove,
  onOpenSingleRemove,
  onResetCatalogFilters,
  onSaveBreedChanges,
  onSetCatalogQuery,
  onSetCatalogSpeciesFilter,
  onToggleAllVisible,
  onToggleProfileSelection,
  profiles,
  selectedProfileIds,
  species,
  speciesById,
  successMessage,
  usageLoadError,
  visibleProfiles,
}: MobileBreedsLibraryProps) {
  const [expandedProfileId, setExpandedProfileId] = useState<string | null>(null);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isManageMode, setIsManageMode] = useState(false);
  const [actionProfileId, setActionProfileId] = useState<string | null>(null);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [isSavingChanges, setIsSavingChanges] = useState(false);
  const [savedDescriptionProfileId, setSavedDescriptionProfileId] = useState<
    string | null
  >(null);
  const [photoSheetTarget, setPhotoSheetTarget] = useState<{
    profileId: string;
    targetId: string;
    targetKind: "add" | "draft" | "saved";
  } | null>(null);
  const [removePhotoTarget, setRemovePhotoTarget] = useState<{
    id: string;
    kind: "draft" | "saved";
  } | null>(null);
  const [photoDrafts, setPhotoDrafts] = useState<
    {
      clientId: string;
      crop: PhotoCropMetadata;
      file: File;
      previewUrl: string;
    }[]
  >([]);
  const [removedPhotoIds, setRemovedPhotoIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [cropCandidate, setCropCandidate] = useState<{
    file: File;
    previewUrl: string;
    targetId: string;
    targetKind: "add" | "draft" | "saved";
  } | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [isDiscardDialogOpen, setIsDiscardDialogOpen] = useState(false);
  const pendingActionRef = useRef<(() => void) | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const lastAutoExpandedProfileIdRef = useRef<string | null>(null);
  const speciesCount = useMemo(
    () => new Set(profiles.map((profile) => profile.species_id)).size,
    [profiles],
  );
  const actionProfile = actionProfileId
    ? profiles.find((profile) => profile.id === actionProfileId) ?? null
    : null;
  const photoSheetProfile = photoSheetTarget
    ? profiles.find((profile) => profile.id === photoSheetTarget.profileId) ??
      null
    : null;
  const allVisibleSelected =
    visibleProfiles.length > 0 &&
    visibleProfiles.every((profile) => selectedProfileIds.has(profile.id));
  const expandedProfile = expandedProfileId
    ? profiles.find((profile) => profile.id === expandedProfileId) ?? null
    : null;
  const savedExpandedDescription = expandedProfile
    ? getProfileDescription(expandedProfile, libraryByBreedId)
    : "";
  const hasUnsavedChanges =
    Boolean(expandedProfile) &&
    (descriptionDraft.trim() !== savedExpandedDescription.trim() ||
      photoDrafts.length > 0 ||
      removedPhotoIds.size > 0);

  useEffect(() => {
    function warnBeforeLeaving(event: BeforeUnloadEvent) {
      if (!hasUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (
      !autoExpandProfileId ||
      lastAutoExpandedProfileIdRef.current === autoExpandProfileId
    ) {
      return;
    }

    const profile = profiles.find((item) => item.id === autoExpandProfileId);
    if (!profile) return;

    lastAutoExpandedProfileIdRef.current = autoExpandProfileId;
    setDescriptionDraft(getProfileDescription(profile, libraryByBreedId));
    setDescriptionError(null);
    setSavedDescriptionProfileId(null);
    setExpandedProfileId(profile.id);

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        document
          .getElementById(`mobile-breed-${profile.id}-details`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });
  }, [autoExpandProfileId, libraryByBreedId, profiles]);

  useEffect(() => {
    function guardInternalNavigation(event: MouseEvent) {
      if (!hasUnsavedChanges || event.defaultPrevented) return;

      const target =
        event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(target instanceof HTMLAnchorElement)) return;
      if (target.target === "_blank" || target.hasAttribute("download")) return;

      const destination = new URL(target.href, window.location.href);
      if (destination.href === window.location.href) return;

      event.preventDefault();
      pendingActionRef.current = () => window.location.assign(destination.href);
      setIsDiscardDialogOpen(true);
    }

    document.addEventListener("click", guardInternalNavigation, true);
    return () =>
      document.removeEventListener("click", guardInternalNavigation, true);
  }, [hasUnsavedChanges]);

  function clearDraftState() {
    for (const draft of photoDrafts) URL.revokeObjectURL(draft.previewUrl);
    setDescriptionDraft("");
    setDescriptionError(null);
    setSavedDescriptionProfileId(null);
    setPhotoDrafts([]);
    setRemovedPhotoIds(new Set());
    setPhotoError(null);
  }

  function runAfterDirtyCheck(action: () => void) {
    if (!hasUnsavedChanges) {
      action();
      return;
    }

    pendingActionRef.current = action;
    setIsDiscardDialogOpen(true);
  }

  function openProfile(profile: SellerBreedProfile, description: string) {
    clearDraftState();
    setDescriptionDraft(description);
    setExpandedProfileId(profile.id);
  }

  function toggleManageMode() {
    runAfterDirtyCheck(() => {
      clearDraftState();
      setExpandedProfileId(null);
      setActionProfileId(null);
      onClearSelection();
      setIsManageMode((current) => !current);
    });
  }

  async function saveChanges(profileId: string) {
    if (isSavingChanges) return;

    setIsSavingChanges(true);
    setDescriptionError(null);
    setPhotoError(null);
    setSavedDescriptionProfileId(null);

    const result = await onSaveBreedChanges(
      profileId,
      descriptionDraft,
      photoDrafts.length > 0 || removedPhotoIds.size > 0
        ? {
            additions: photoDrafts.map((draft) => ({
              crop: draft.crop,
              file: draft.file,
            })),
            kind: "update",
            removedMediaLinkIds: Array.from(removedPhotoIds),
          }
        : { kind: "none" },
    );

    setIsSavingChanges(false);

    if (!result.ok) {
      setDescriptionError(result.message);
      return;
    }

    for (const draft of photoDrafts) URL.revokeObjectURL(draft.previewUrl);
    setPhotoDrafts([]);
    setRemovedPhotoIds(new Set());
    setSavedDescriptionProfileId(profileId);
  }

  function choosePhoto(file: File | undefined) {
    if (!file) return;

    const validationError = validateSellerPhoto(file);
    if (validationError) {
      setPhotoError(validationError.message);
      setPhotoSheetTarget(null);
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    if (!photoSheetTarget) return;
    setPhotoSheetTarget(null);
    setCropCandidate({
      file,
      previewUrl,
      targetId: photoSheetTarget.targetId,
      targetKind: photoSheetTarget.targetKind,
    });
    setPhotoError(null);
  }

  return (
    <section className="space-y-4 pb-28 lg:hidden" aria-label="My Breeds">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight text-stone-950">
            My Breeds
          </h1>
          <p className="mt-1 text-base font-medium text-stone-700">
            {formatCount(profiles.length, "breed")} ·{" "}
            {formatCount(speciesCount, "species", "species")}
          </p>
        </div>
        <button
          aria-pressed={isManageMode}
          className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-4 text-base font-bold text-stone-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-700/25"
          onClick={toggleManageMode}
          type="button"
        >
          {isManageMode ? "Cancel" : "Manage"}
          {!isManageMode ? (
            <ChevronDown aria-hidden="true" className="size-4" />
          ) : null}
        </button>
      </div>

      <button
        className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-lg bg-emerald-800 px-5 text-lg font-bold text-white shadow-sm transition hover:bg-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-800 focus:ring-offset-2"
        onClick={() => runAfterDirtyCheck(onAddBreed)}
        type="button"
      >
        <span aria-hidden="true" className="text-2xl leading-none">
          +
        </span>
        Add Breed
      </button>

      {actionError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-base font-semibold text-red-800">
          {actionError}
        </div>
      ) : null}
      {successMessage ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-base font-semibold text-emerald-900">
          {successMessage}
        </div>
      ) : null}

      {profiles.length > 0 ? (
        <>
          <label className="relative block">
            <span className="sr-only">Search my breeds</span>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-stone-700"
            />
            <input
              className="h-14 w-full rounded-lg border border-stone-300 bg-white pl-12 pr-4 text-base font-medium text-stone-950 shadow-sm placeholder:text-stone-500 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
              onChange={(event) => onSetCatalogQuery(event.target.value)}
              placeholder="Search my breeds"
              type="search"
              value={catalogQuery}
            />
          </label>

          <label className="relative block max-w-xs">
            <span className="sr-only">Filter by species</span>
            <Funnel
              aria-hidden="true"
              className="pointer-events-none absolute left-4 top-1/2 z-10 size-5 -translate-y-1/2 text-emerald-800"
            />
            <select
              aria-label="Filter by species"
              className={`h-12 w-full rounded-lg border bg-white pl-12 pr-4 text-base font-bold text-stone-900 shadow-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 ${
                catalogSpeciesFilter !== "all"
                  ? "border-emerald-700 bg-emerald-50"
                  : "border-stone-300"
              }`}
              onChange={(event) =>
                onSetCatalogSpeciesFilter(event.target.value)
              }
              value={catalogSpeciesFilter}
            >
              <option value="all">All species</option>
              {species.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.common_name}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-amber-100 bg-[#fffaf0]">
        <button
          aria-controls="mobile-breed-library-help"
          aria-expanded={isHelpOpen}
          className="flex min-h-14 w-full items-center gap-3 px-4 text-left text-base font-bold text-stone-950 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-emerald-700/20"
          onClick={() => setIsHelpOpen((current) => !current)}
          type="button"
        >
          <CircleHelp
            aria-hidden="true"
            className="size-5 shrink-0 text-emerald-800"
          />
          <span className="min-w-0 flex-1">
            How does the Breed Library work?
          </span>
          <ChevronDown
            aria-hidden="true"
            className={`size-5 shrink-0 transition-transform ${
              isHelpOpen ? "rotate-180" : ""
            }`}
          />
        </button>
        {isHelpOpen ? (
          <div
            className="space-y-2 border-t border-amber-100 px-4 py-4 text-base leading-6 text-stone-700"
            id="mobile-breed-library-help"
          >
            <p>My Breeds contains the breeds you currently use in your store.</p>
            <p>Add Breed lets you choose breeds from the full catalog.</p>
            <p>
              You can customize breed descriptions and photos for your
              storefront.
            </p>
            <p>
              Your listing forms will continue to support the automatic breed
              workflow.
            </p>
          </div>
        ) : null}
      </div>

      {isManageMode ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3">
          <label className="flex min-h-11 items-center gap-3 text-base font-bold text-emerald-950">
            <input
              aria-label="Select all visible breeds"
              checked={allVisibleSelected}
              className="size-6 rounded border-stone-300 text-emerald-800 focus:ring-emerald-800"
              disabled={visibleProfiles.length === 0}
              onChange={onToggleAllVisible}
              type="checkbox"
            />
            Select All
          </label>
          <span className="text-sm font-semibold text-emerald-900">
            {selectedProfileIds.size} selected
          </span>
        </div>
      ) : null}

      {profiles.length === 0 ? (
        <div className="rounded-lg border border-stone-200 bg-white px-5 py-8 text-center">
          <h2 className="text-lg font-bold text-stone-950">No breeds yet</h2>
          <p className="mt-2 text-base leading-6 text-stone-600">
            Add a common breed from the catalog or create a custom breed for
            your store.
          </p>
        </div>
      ) : visibleProfiles.length === 0 ? (
        <div className="rounded-lg border border-stone-200 bg-white px-5 py-8 text-center">
          <h2 className="text-lg font-bold text-stone-950">
            No breeds match
          </h2>
          <p className="mt-2 text-base leading-6 text-stone-600">
            Try a different search or species filter.
          </p>
          {hasActiveCatalogFilters ? (
            <button
              className="mt-4 min-h-11 rounded-lg border border-stone-300 bg-white px-4 text-base font-bold text-emerald-900"
              onClick={onResetCatalogFilters}
              type="button"
            >
              Reset filters
            </button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2">
          {visibleProfiles.map((profile) => {
            const description = getProfileDescription(profile, libraryByBreedId);
            const imageUrls = getMobileBreedImageUrls(
              profile,
              libraryByBreedId,
              mediaByProfileId,
            );
            const savedPhotos = (mediaByProfileId.get(profile.id) ?? []).filter(
              (item) => !removedPhotoIds.has(item.media_link_id),
            );
            const visiblePhotoCount = savedPhotos.length + photoDrafts.length;
            const isExpanded = expandedProfileId === profile.id;
            const isSelected = selectedProfileIds.has(profile.id);
            const speciesName =
              speciesById.get(profile.species_id) ?? "Species";

            if (isManageMode) {
              return (
                <label
                  className={`flex min-h-[76px] cursor-pointer items-center gap-3 rounded-lg border bg-white px-3 py-2.5 shadow-sm ${
                    isSelected
                      ? "border-emerald-700 bg-emerald-50"
                      : "border-stone-200"
                  }`}
                  key={profile.id}
                >
                  <input
                    aria-label={`Select ${profile.display_name}`}
                    checked={isSelected}
                    className="size-6 shrink-0 rounded border-stone-300 text-emerald-800 focus:ring-emerald-800"
                    onChange={() => onToggleProfileSelection(profile.id)}
                    type="checkbox"
                  />
                  <MobileBreedThumbnail
                    imageUrls={imageUrls}
                    name={profile.display_name}
                  />
                  <BreedRowText
                    description={description}
                    name={profile.display_name}
                    speciesName={speciesName}
                  />
                </label>
              );
            }

            return (
              <article
                className={`overflow-hidden rounded-lg border bg-white shadow-sm ${
                  isExpanded ? "border-emerald-700" : "border-stone-200"
                }`}
                key={profile.id}
              >
                <button
                  aria-controls={`mobile-breed-${profile.id}-details`}
                  aria-expanded={isExpanded}
                  className="flex min-h-[76px] w-full items-center gap-3 px-3 py-2.5 text-left focus:outline-none focus:ring-2 focus:ring-inset focus:ring-emerald-700/20"
                  onClick={() =>
                    runAfterDirtyCheck(() => {
                      if (isExpanded) {
                        clearDraftState();
                        setExpandedProfileId(null);
                      } else {
                        openProfile(profile, description);
                      }
                    })
                  }
                  type="button"
                >
                  <MobileBreedThumbnail
                    imageUrls={imageUrls}
                    name={profile.display_name}
                  />
                  <BreedRowText
                    description={description}
                    name={profile.display_name}
                    speciesName={speciesName}
                  />
                  <ChevronRight
                    aria-hidden="true"
                    className={`size-5 shrink-0 text-stone-900 transition-transform ${
                      isExpanded ? "-rotate-90" : ""
                    }`}
                  />
                </button>
                {isExpanded ? (
                  <div
                    className="border-t border-stone-100 px-4 pb-4 pt-3"
                    id={`mobile-breed-${profile.id}-details`}
                  >
                    <label className="grid gap-2 text-base font-bold text-stone-800">
                      Storefront description
                      <textarea
                        aria-label={`Storefront description for ${profile.display_name}`}
                        className="min-h-32 w-full resize-y rounded-lg border border-stone-300 bg-white px-3 py-3 text-base font-normal leading-6 text-stone-950 shadow-sm placeholder:text-stone-500 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
                        maxLength={1000}
                        onChange={(event) => {
                          setDescriptionDraft(event.target.value);
                          setDescriptionError(null);
                          setSavedDescriptionProfileId(null);
                        }}
                        placeholder="Add the description buyers should see."
                        value={descriptionDraft}
                      />
                    </label>
                    <div className="mt-2 flex items-start justify-between gap-3">
                      <div aria-live="polite" className="min-w-0 flex-1">
                        {descriptionError ? (
                          <p className="text-sm font-semibold text-red-700">
                            {descriptionError}
                          </p>
                        ) : savedDescriptionProfileId === profile.id ? (
                          <p className="text-sm font-semibold text-emerald-800">
                            Breed updated
                          </p>
                        ) : null}
                      </div>
                      <span className="shrink-0 text-sm font-medium text-stone-500">
                        {descriptionDraft.length}/1000
                      </span>
                    </div>
                    <div className="mt-4">
                      <p className="text-base font-bold text-stone-800">
                        Photos{" "}
                        <span className="font-medium text-stone-500">
                          ({visiblePhotoCount}/4)
                        </span>
                      </p>
                      <div className="mt-2 grid grid-cols-2 gap-3">
                        {savedPhotos.map((photo) => (
                          <button
                            aria-label={`Change photo for ${profile.display_name}`}
                            className="relative aspect-square overflow-hidden rounded-lg border border-stone-200 bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-700/25"
                            key={photo.media_link_id}
                            onClick={() =>
                              setPhotoSheetTarget({
                                profileId: profile.id,
                                targetId: photo.media_link_id,
                                targetKind: "saved",
                              })
                            }
                            type="button"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              alt=""
                              className="h-full w-full object-cover"
                              src={toDisplayImageUrl(photo.public_url)}
                              style={getCropImageStyle(photo.crop_metadata)}
                            />
                          </button>
                        ))}
                        {photoDrafts.map((draft) => (
                          <button
                            aria-label={`Change unsaved photo for ${profile.display_name}`}
                            className="relative aspect-square overflow-hidden rounded-lg border border-emerald-300 bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-700/25"
                            key={draft.clientId}
                            onClick={() =>
                              setPhotoSheetTarget({
                                profileId: profile.id,
                                targetId: draft.clientId,
                                targetKind: "draft",
                              })
                            }
                            type="button"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              alt=""
                              className="h-full w-full object-cover"
                              src={draft.previewUrl}
                              style={getCropImageStyle(draft.crop)}
                            />
                            <span className="absolute bottom-2 left-2 rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-900">
                              Unsaved
                            </span>
                          </button>
                        ))}
                        {visiblePhotoCount < 4 ? (
                        <button
                            aria-label={`Add photo for ${profile.display_name}`}
                            className="flex aspect-square flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 bg-stone-50 px-3 text-center text-base font-bold text-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-700/25"
                            onClick={() =>
                              setPhotoSheetTarget({
                                profileId: profile.id,
                                targetId: "add",
                                targetKind: "add",
                              })
                            }
                          type="button"
                        >
                          <Camera aria-hidden="true" className="size-6" />
                            <span className="mt-2">Add photo</span>
                        </button>
                        ) : null}
                        {isSavingChanges &&
                        (photoDrafts.length > 0 ||
                          removedPhotoIds.size > 0) ? (
                          <p
                            aria-live="polite"
                            className="col-span-2 text-sm font-bold text-emerald-900"
                          >
                            Uploading photos
                          </p>
                        ) : null}
                      </div>
                      {photoError ? (
                        <p
                          aria-live="polite"
                          className="mt-2 text-sm font-semibold text-red-700"
                        >
                          {photoError}
                        </p>
                      ) : null}
                      {photoDrafts.length > 0 || removedPhotoIds.size > 0 ? (
                        <p className="mt-2 text-sm font-semibold text-amber-800">
                          Photo changes will be applied when you save.
                        </p>
                      ) : null}
                    </div>
                    <div className="mt-4 grid grid-cols-[minmax(0,1fr)_48px] gap-2">
                      <button
                        className="min-h-12 rounded-lg bg-emerald-800 px-4 text-base font-bold text-white disabled:opacity-50"
                        disabled={isSavingChanges || !hasUnsavedChanges}
                        onClick={() => void saveChanges(profile.id)}
                        type="button"
                      >
                        {isSavingChanges ? "Saving changes" : "Save changes"}
                      </button>
                      <button
                        aria-label={`More actions for ${profile.display_name}`}
                        className="inline-flex min-h-12 items-center justify-center rounded-lg border border-stone-300 bg-white text-stone-950 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
                        onClick={() => setActionProfileId(profile.id)}
                        type="button"
                      >
                        <MoreHorizontal aria-hidden="true" className="size-6" />
                      </button>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      {isManageMode && selectedProfileIds.size > 0 ? (
        <div className="fixed inset-x-0 bottom-[5.75rem] z-40 border-t border-emerald-900/20 bg-white/95 px-4 py-3 shadow-[0_-8px_24px_rgba(0,0,0,0.12)] backdrop-blur lg:hidden">
          <div className="mx-auto flex max-w-lg items-center gap-3">
            <p className="min-w-0 flex-1 text-base font-bold text-emerald-950">
              {formatCount(selectedProfileIds.size, "breed")} selected
            </p>
            <button
              className="min-h-11 rounded-lg border border-red-300 bg-white px-4 text-base font-bold text-red-700 disabled:opacity-50"
              disabled={Boolean(usageLoadError)}
              onClick={onOpenBulkRemove}
              type="button"
            >
              Remove
            </button>
            <button
              aria-label="Clear breed selection"
              className="inline-flex size-11 items-center justify-center rounded-lg border border-stone-300 bg-white text-stone-800"
              onClick={onClearSelection}
              type="button"
            >
              <X aria-hidden="true" className="size-5" />
            </button>
          </div>
        </div>
      ) : null}

      {actionProfile ? (
        <MobileBottomSheet
          label={`Actions for ${actionProfile.display_name}`}
          title={actionProfile.display_name}
          onClose={() => setActionProfileId(null)}
        >
          <div className="divide-y divide-stone-200">
            <button
              className="flex min-h-14 w-full items-center px-2 text-left text-lg font-semibold text-red-700 disabled:opacity-50"
              disabled={Boolean(usageLoadError)}
              onClick={() => {
                setActionProfileId(null);
                onOpenSingleRemove(actionProfile.id);
              }}
              type="button"
            >
              Remove from my breeds
            </button>
          </div>
          <button
            className="mt-5 min-h-12 w-full rounded-lg border border-stone-300 bg-white px-4 text-base font-bold text-emerald-900"
            onClick={() => setActionProfileId(null)}
            type="button"
          >
            Cancel
          </button>
        </MobileBottomSheet>
      ) : null}

      {photoSheetProfile ? (
        <MobileBottomSheet
          label={`Photo options for ${photoSheetProfile.display_name}`}
          title={`Photo for ${photoSheetProfile.display_name}`}
          onClose={() => setPhotoSheetTarget(null)}
        >
          {photoSheetTarget?.targetKind !== "add" ? (
            <div className="mb-3">
              <MobileBreedThumbnail
                imageUrls={
                  photoSheetTarget?.targetKind === "draft"
                    ? [
                        photoDrafts.find(
                          (draft) =>
                            draft.clientId === photoSheetTarget.targetId,
                        )?.previewUrl ?? "",
                      ]
                    : [
                        (mediaByProfileId.get(photoSheetProfile.id) ?? []).find(
                          (photo) =>
                            photo.media_link_id === photoSheetTarget?.targetId,
                        )?.public_url ?? "",
                      ]
                }
                name={photoSheetProfile.display_name}
              />
            </div>
          ) : null}
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
            {photoSheetTarget?.targetKind !== "add" ? (
              <button
                className="flex min-h-16 w-full items-center gap-4 px-2 text-left text-lg font-semibold text-red-700"
                onClick={() => {
                  if (
                    !photoSheetTarget ||
                    photoSheetTarget.targetKind === "add"
                  ) {
                    return;
                  }
                  setPhotoSheetTarget(null);
                  setRemovePhotoTarget({
                    id: photoSheetTarget.targetId,
                    kind: photoSheetTarget.targetKind,
                  });
                }}
                type="button"
              >
                <Trash2 aria-hidden="true" className="size-6" />
                Remove photo
              </button>
            ) : null}
          </div>
          <input
            accept={sellerAcceptedImageTypes.join(",")}
            capture="environment"
            className="sr-only"
            onChange={(event) => {
              choosePhoto(event.target.files?.[0]);
              event.target.value = "";
            }}
            ref={cameraInputRef}
            type="file"
          />
          <input
            accept={sellerAcceptedImageTypes.join(",")}
            className="sr-only"
            onChange={(event) => {
              choosePhoto(event.target.files?.[0]);
              event.target.value = "";
            }}
            ref={libraryInputRef}
            type="file"
          />
          <button
            className="mt-5 min-h-12 w-full rounded-lg border border-stone-300 bg-white px-4 text-base font-bold text-emerald-900"
            onClick={() => setPhotoSheetTarget(null)}
            type="button"
          >
            Cancel
          </button>
        </MobileBottomSheet>
      ) : null}

      {cropCandidate && expandedProfile ? (
        <PhotoCropEditor
          hideReset
          photo={{
            label: expandedProfile.display_name,
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
            const nextDraft = {
              clientId:
                cropCandidate.targetKind === "draft"
                  ? cropCandidate.targetId
                  : crypto.randomUUID(),
              crop: { ...crop, aspect: 1 },
              file: cropCandidate.file,
              previewUrl: cropCandidate.previewUrl,
            };

            if (cropCandidate.targetKind === "draft") {
              setPhotoDrafts((current) =>
                current.map((draft) => {
                  if (draft.clientId !== cropCandidate.targetId) return draft;
                  URL.revokeObjectURL(draft.previewUrl);
                  return nextDraft;
                }),
              );
            } else {
              setPhotoDrafts((current) => [...current, nextDraft]);
            }

            if (cropCandidate.targetKind === "saved") {
              setRemovedPhotoIds(
                (current) => new Set(current).add(cropCandidate.targetId),
              );
            }

            setCropCandidate(null);
            setPhotoError(null);
            setSavedDescriptionProfileId(null);
          }}
        />
      ) : null}

      {removePhotoTarget ? (
        <MobileConfirmationDialog
          confirmLabel="Remove photo"
          destructive
          title="Remove photo?"
          onCancel={() => setRemovePhotoTarget(null)}
          onConfirm={() => {
            if (removePhotoTarget.kind === "draft") {
              setPhotoDrafts((current) =>
                current.filter((draft) => {
                  if (draft.clientId !== removePhotoTarget.id) return true;
                  URL.revokeObjectURL(draft.previewUrl);
                  return false;
                }),
              );
            } else {
              setRemovedPhotoIds(
                (current) => new Set(current).add(removePhotoTarget.id),
              );
            }
            setPhotoError(null);
            setSavedDescriptionProfileId(null);
            setRemovePhotoTarget(null);
          }}
        >
          This photo will stop appearing for this breed after you save changes.
        </MobileConfirmationDialog>
      ) : null}

      {isDiscardDialogOpen ? (
        <MobileConfirmationDialog
          confirmLabel="Discard changes"
          destructive
          title="Discard unsaved changes?"
          onCancel={() => {
            pendingActionRef.current = null;
            setIsDiscardDialogOpen(false);
          }}
          onConfirm={() => {
            const action = pendingActionRef.current;
            pendingActionRef.current = null;
            setIsDiscardDialogOpen(false);
            clearDraftState();
            action?.();
          }}
        >
          Your description or photo changes have not been saved.
        </MobileConfirmationDialog>
      ) : null}
    </section>
  );
}

function BreedRowText({
  description,
  name,
  speciesName,
}: {
  description: string;
  name: string;
  speciesName: string;
}) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-base font-bold text-stone-950">
        {name}
      </span>
      <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 text-sm font-medium text-stone-700">
        <span>{speciesName}</span>
        <span aria-hidden="true">·</span>
        <span className="font-semibold text-emerald-800">
          {description ? "Description added" : "Add description"}
        </span>
      </span>
    </span>
  );
}

function MobileBreedThumbnail({
  imageUrls,
  name,
}: {
  imageUrls: string[];
  name: string;
}) {
  const [failedImageUrls, setFailedImageUrls] = useState<Set<string>>(
    () => new Set(),
  );
  const displayImageUrl =
    imageUrls
      .map((imageUrl) => toDisplayImageUrl(imageUrl))
      .find((imageUrl) => imageUrl && !failedImageUrls.has(imageUrl)) ?? "";

  if (!displayImageUrl) {
    return (
      <span
        aria-hidden="true"
        className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-base font-bold text-emerald-900"
      >
        {getBreedInitials(name)}
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className="size-14 shrink-0 overflow-hidden rounded-lg bg-emerald-50 ring-1 ring-emerald-100"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt=""
        className="h-full w-full object-cover"
        onError={() =>
          setFailedImageUrls((current) => new Set(current).add(displayImageUrl))
        }
        src={displayImageUrl}
      />
    </span>
  );
}

function MobileBottomSheet({
  children,
  label,
  onClose,
  title,
}: {
  children: ReactNode;
  label: string;
  onClose: () => void;
  title: string;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => {
      sheetRef.current
        ?.querySelector<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled])',
        )
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
      onClose();
      return;
    }

    if (event.key !== "Tab") return;

    const focusableElements = Array.from(
      sheetRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );

    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

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
      className="fixed inset-0 z-[70] flex items-end bg-stone-950/45 lg:hidden"
      onClick={onClose}
      onKeyDown={handleKeyDown}
      role="presentation"
    >
      <div
        aria-label={label}
        aria-modal="true"
        className="max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl bg-white px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        ref={sheetRef}
        role="dialog"
      >
        <div className="mx-auto h-1.5 w-12 rounded-full bg-stone-300" />
        <div className="flex min-h-14 items-center justify-between gap-4">
          <h2 className="text-xl font-bold text-stone-950">{title}</h2>
          <button
            aria-label={`Close ${title}`}
            className="inline-flex size-11 items-center justify-center rounded-full text-stone-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function MobileConfirmationDialog({
  children,
  confirmLabel,
  destructive = false,
  onCancel,
  onConfirm,
  title,
}: {
  children: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
}) {
  return (
    <MobileBottomSheet label={title} title={title} onClose={onCancel}>
      <p className="text-base leading-6 text-stone-700">{children}</p>
      <div className="mt-5 grid gap-2">
        <button
          className={`min-h-12 rounded-lg px-4 text-base font-bold text-white ${
            destructive ? "bg-red-700" : "bg-emerald-800"
          }`}
          onClick={onConfirm}
          type="button"
        >
          {confirmLabel}
        </button>
        <button
          className="min-h-12 rounded-lg border border-stone-300 bg-white px-4 text-base font-bold text-emerald-900"
          onClick={onCancel}
          type="button"
        >
          Keep editing
        </button>
      </div>
    </MobileBottomSheet>
  );
}

function getMobileBreedImageUrls(
  profile: SellerBreedProfile,
  libraryByBreedId: Map<string, BreedLibraryItem>,
  mediaByProfileId: Map<string, ListingPhotoItem[]>,
) {
  const featuredMedia = pickFeaturedMedia(mediaByProfileId.get(profile.id) ?? []);
  const libraryImageUrl = profile.breed_id
    ? libraryByBreedId.get(profile.breed_id)?.image_url
    : null;

  return [
    featuredMedia?.source_image_url,
    featuredMedia?.public_url,
    libraryImageUrl,
  ].filter((imageUrl): imageUrl is string => Boolean(imageUrl));
}

function formatCount(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}
