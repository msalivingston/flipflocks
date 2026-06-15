"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { supabase } from "@/lib/supabase";
import { useSellerContext } from "../_components/seller-context";
import {
  EmptyState,
  ErrorState,
  FilterControl,
  LoadingState,
  SellerCard,
} from "../_components/seller-ui";
import type { ListingPhotoItem } from "../listings/[listingBatchId]/listing-photos-section";
import {
  breedLibrarySelect,
  buildLibraryByBreedId,
  buildSpeciesNameById,
  getBreedInitials,
  getProfileDescription,
  groupProfilesBySpecies,
  pickFeaturedMedia,
  restoreCatalogDefaultPhotoBestEffort,
  sellerBreedProfileSelect,
  sellerMediaSelect,
  sortBreedLibrary,
  speciesSelect,
  toDisplayImageUrl,
  truncateText,
  type BreedLibraryItem,
  type BreedSpecies,
  type SellerBreedProfile,
} from "./breed-data";

type ActiveTab = "catalog" | "library";
type AddMode = "choose" | "library" | "custom";

type BreedProfileUpsertResult = {
  seller_breed_profile_id: string;
};

type AddBreedResult =
  | { ok: true; breedProfileId: string }
  | { ok: false; message: string };

type CustomBreedDraft = {
  description: string;
  name: string;
  speciesId: string;
};

type BreedUsageRow = {
  seller_breed_profile_id: string | null;
};

type RemoveDialogState =
  | { mode: "single"; profileId: string }
  | { mode: "bulk"; profileIds: string[] };

const breedHelperStorageKey = "flockfront:breeds-helper-expanded";
const breedHelperPreferenceEvent =
  "flockfront:breeds-helper-preference-change";

export function BreedsManagement() {
  const { seller } = useSellerContext();
  const router = useRouter();
  const storeId = seller?.store_id ?? "";
  const [activeTab, setActiveTab] = useState<ActiveTab>("catalog");
  const [species, setSpecies] = useState<BreedSpecies[]>([]);
  const [libraryBreeds, setLibraryBreeds] = useState<BreedLibraryItem[]>([]);
  const [profiles, setProfiles] = useState<SellerBreedProfile[]>([]);
  const [mediaItems, setMediaItems] = useState<ListingPhotoItem[]>([]);
  const [usedProfileIds, setUsedProfileIds] = useState<Set<string>>(new Set());
  const [selectedProfileIds, setSelectedProfileIds] = useState<Set<string>>(
    new Set(),
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [addingBreedId, setAddingBreedId] = useState<string | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  const [usageLoadError, setUsageLoadError] = useState<string | null>(null);
  const [removeDialog, setRemoveDialog] = useState<RemoveDialogState | null>(
    null,
  );
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    function openAddModal() {
      setIsModalOpen(true);
    }

    const trigger = document.querySelector("[data-breeds-add-trigger]");
    trigger?.addEventListener("click", openAddModal);

    return () => {
      trigger?.removeEventListener("click", openAddModal);
    };
  }, []);

  useEffect(() => {
    if (!storeId) return;

    let isMounted = true;

    async function loadBreeds() {
      setIsLoading(true);
      setLoadError(null);
      setUsageLoadError(null);

      const [speciesResult, breedResult, profileResult] = await Promise.all([
        supabase
          .from("species")
          .select(speciesSelect)
          .eq("is_active", true)
          .order("sort_order", { ascending: true })
          .order("common_name", { ascending: true })
          .returns<BreedSpecies[]>(),
        supabase
          .from("breeds")
          .select(breedLibrarySelect)
          .eq("is_active", true)
          .order("sort_order", { ascending: true })
          .order("breed_name", { ascending: true })
          .returns<BreedLibraryItem[]>(),
        supabase
          .from("seller_breed_profiles")
          .select(sellerBreedProfileSelect)
          .eq("store_id", storeId)
          .neq("visibility_status", "archived")
          .eq("moderation_status", "normal")
          .order("display_name", { ascending: true })
          .returns<SellerBreedProfile[]>(),
      ]);

      if (!isMounted) return;

      const firstError =
        speciesResult.error ?? breedResult.error ?? profileResult.error;

      if (firstError) {
        setLoadError(firstError.message);
        setIsLoading(false);
        return;
      }

      const nextProfiles = profileResult.data ?? [];

      setSpecies(speciesResult.data ?? []);
      setLibraryBreeds(breedResult.data ?? []);
      setProfiles(nextProfiles);

      if (nextProfiles.length === 0) {
        setMediaItems([]);
        setUsedProfileIds(new Set());
        setIsLoading(false);
        return;
      }

      const profileIds = nextProfiles.map((profile) => profile.id);
      const [usageResult, mediaResult] = await Promise.all([
        supabase
          .from("seller_inventory_management")
          .select("seller_breed_profile_id")
          .eq("store_id", storeId)
          .in("seller_breed_profile_id", profileIds)
          .neq("inventory_visibility_status", "archived")
          .neq("listing_batch_visibility_status", "archived")
          .returns<BreedUsageRow[]>(),
        supabase
          .from("seller_media_management")
          .select(sellerMediaSelect)
          .eq("store_id", storeId)
          .eq("entity_type", "seller_breed_profile")
          .in("entity_id", profileIds)
          .returns<ListingPhotoItem[]>(),
      ]);

      if (!isMounted) return;

      if (mediaResult.error) {
        console.warn("breed thumbnails could not be loaded", {
          message: mediaResult.error.message,
        });
        setMediaItems([]);
      } else {
        setMediaItems(mediaResult.data ?? []);
      }

      if (usageResult.error) {
        setUsageLoadError(usageResult.error.message);
        setUsedProfileIds(new Set());
        setIsLoading(false);
        return;
      }

      setUsedProfileIds(
        new Set(
          (usageResult.data ?? [])
            .map((item) => item.seller_breed_profile_id)
            .filter((value): value is string => Boolean(value)),
        ),
      );
      setIsLoading(false);
    }

    void loadBreeds();

    return () => {
      isMounted = false;
    };
  }, [reloadKey, storeId]);

  const libraryByBreedId = useMemo(
    () => buildLibraryByBreedId(libraryBreeds),
    [libraryBreeds],
  );
  const sortedLibraryBreeds = useMemo(
    () => sortBreedLibrary(libraryBreeds, species),
    [libraryBreeds, species],
  );
  const speciesById = useMemo(() => buildSpeciesNameById(species), [species]);
  const groups = useMemo(
    () => groupProfilesBySpecies(profiles, species),
    [profiles, species],
  );
  const visibleProfiles = useMemo(
    () => groups.flatMap((group) => group.profiles),
    [groups],
  );
  const profileById = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile])),
    [profiles],
  );
  const mediaByProfileId = useMemo(() => {
    const groupedMedia = new Map<string, ListingPhotoItem[]>();

    for (const item of mediaItems) {
      groupedMedia.set(item.entity_id, [
        ...(groupedMedia.get(item.entity_id) ?? []),
        item,
      ]);
    }

    return groupedMedia;
  }, [mediaItems]);
  const existingBreedIds = useMemo(
    () =>
      new Set(
        profiles
          .map((profile) => profile.breed_id)
          .filter((value): value is string => Boolean(value)),
      ),
    [profiles],
  );

  async function addLibraryBreed(breed: BreedLibraryItem): Promise<AddBreedResult> {
    const { data, error } = await supabase.rpc("seller_upsert_breed_profile", {
      p_breed_id: breed.id,
      p_custom_breed_name: null,
      p_display_name: breed.breed_name,
      p_seller_breed_profile_id: null,
      p_seller_description: breed.description,
      p_seller_notes: null,
      p_species_id: breed.species_id,
      p_store_id: storeId,
      p_visibility_status: "active",
    });

    if (error) return { ok: false, message: error.message };

    const upsertResult = data as
      | BreedProfileUpsertResult
      | BreedProfileUpsertResult[]
      | null;
    const breedProfileId = Array.isArray(upsertResult)
      ? upsertResult[0]?.seller_breed_profile_id
      : upsertResult?.seller_breed_profile_id;

    if (!breedProfileId) {
      return {
        ok: false,
        message: "Breed was added, but the new breed profile could not be opened.",
      };
    }

    if (breed.image_url) {
      const photoResult =
        await restoreCatalogDefaultPhotoBestEffort(breedProfileId);

      if (!photoResult.ok) {
        console.warn("default breed photo was not added automatically", {
          breedId: breed.id,
          message: photoResult.message,
          sellerBreedProfileId: breedProfileId,
        });
      }
    }

    return { ok: true, breedProfileId };
  }

  async function addLibraryBreedInPlace(breed: BreedLibraryItem) {
    if (addingBreedId || existingBreedIds.has(breed.id)) return;

    setAddingBreedId(breed.id);
    setActionError(null);

    const result = await addLibraryBreed(breed);

    if (!result.ok) {
      setActionError(result.message);
      setAddingBreedId(null);
      return;
    }

    setAddingBreedId(null);
    setReloadKey((current) => current + 1);
  }

  async function addCustomBreed(draft: CustomBreedDraft): Promise<AddBreedResult> {
    const { data, error } = await supabase.rpc("seller_upsert_breed_profile", {
      p_breed_id: null,
      p_custom_breed_name: draft.name,
      p_display_name: draft.name,
      p_seller_breed_profile_id: null,
      p_seller_description: draft.description || null,
      p_seller_notes: null,
      p_species_id: draft.speciesId,
      p_store_id: storeId,
      p_visibility_status: "active",
    });

    if (error) return { ok: false, message: error.message };

    const upsertResult = data as
      | BreedProfileUpsertResult
      | BreedProfileUpsertResult[]
      | null;
    const breedProfileId = Array.isArray(upsertResult)
      ? upsertResult[0]?.seller_breed_profile_id
      : upsertResult?.seller_breed_profile_id;

    if (!breedProfileId) {
      return {
        ok: false,
        message: "Breed was created, but the new breed profile could not be opened.",
      };
    }

    return { ok: true, breedProfileId };
  }

  function toggleProfileSelection(profileId: string) {
    setSelectedProfileIds((current) => {
      const nextSelectedProfileIds = new Set(current);

      if (nextSelectedProfileIds.has(profileId)) {
        nextSelectedProfileIds.delete(profileId);
      } else {
        nextSelectedProfileIds.add(profileId);
      }

      return nextSelectedProfileIds;
    });
  }

  function toggleAllVisibleProfiles() {
    setSelectedProfileIds((current) => {
      const visibleProfileIds = visibleProfiles.map((profile) => profile.id);
      const hasSelectedAllVisibleProfiles = visibleProfileIds.every((profileId) =>
        current.has(profileId),
      );

      if (hasSelectedAllVisibleProfiles) {
        return new Set(
          Array.from(current).filter(
            (profileId) => !visibleProfileIds.includes(profileId),
          ),
        );
      }

      return new Set([...Array.from(current), ...visibleProfileIds]);
    });
  }

  function clearSelection() {
    setSelectedProfileIds(new Set());
  }

  function openSingleRemoveDialog(profileId: string) {
    setRemoveDialog({ mode: "single", profileId });
  }

  function openBulkRemoveDialog() {
    if (selectedProfileIds.size === 0) return;

    setRemoveDialog({
      mode: "bulk",
      profileIds: Array.from(selectedProfileIds),
    });
  }

  async function removeBreedProfiles(profileIds: string[]) {
    if (isRemoving || usageLoadError) return;

    const removableProfiles = profileIds
      .map((profileId) => profileById.get(profileId))
      .filter((profile): profile is SellerBreedProfile => Boolean(profile))
      .filter((profile) => !usedProfileIds.has(profile.id));

    if (removableProfiles.length === 0) {
      setRemoveDialog(null);
      setActionError(
        "This breed is used in existing inventory or listings and cannot be removed yet.",
      );
      return;
    }

    setIsRemoving(true);
    setActionError(null);
    setSuccessMessage(null);

    for (const profile of removableProfiles) {
      const { error } = await supabase.rpc("seller_upsert_breed_profile", {
        p_breed_id: profile.breed_id,
        p_custom_breed_name: profile.custom_breed_name,
        p_display_name: profile.display_name,
        p_seller_breed_profile_id: profile.id,
        p_seller_description: profile.seller_description,
        p_seller_notes: profile.seller_notes,
        p_species_id: profile.species_id,
        p_store_id: storeId,
        p_visibility_status: "archived",
      });

      if (error) {
        setActionError(error.message);
        setIsRemoving(false);
        return;
      }
    }

    const removedProfileIds = new Set(removableProfiles.map((profile) => profile.id));

    setProfiles((current) =>
      current.filter((profile) => !removedProfileIds.has(profile.id)),
    );
    setMediaItems((current) =>
      current.filter((item) => !removedProfileIds.has(item.entity_id)),
    );
    setSelectedProfileIds(new Set());
    setRemoveDialog(null);
    setIsRemoving(false);
    setSuccessMessage(
      removableProfiles.length === 1
        ? "Breed removed from your Breed Catalog."
        : `${removableProfiles.length} breeds removed from your Breed Catalog.`,
    );
  }

  if (isLoading) return <LoadingState label="Loading breeds" />;

  if (loadError) {
    return (
      <ErrorState
        message={loadError}
        action={
          <button
            className="seller-secondary-button"
            onClick={() => setReloadKey((current) => current + 1)}
            type="button"
          >
            Reload breeds
          </button>
        }
      />
    );
  }

  return (
    <>
      <div className="space-y-3">
        <BreedLibraryHelper />

        <BreedTabs activeTab={activeTab} onChange={setActiveTab} />

        {actionError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
            {actionError}
          </div>
        ) : null}
        {successMessage ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">
            {successMessage}
          </div>
        ) : null}

        {activeTab === "catalog" ? (
          <BreedCatalogPanel
            groups={groups}
            libraryByBreedId={libraryByBreedId}
            mediaByProfileId={mediaByProfileId}
            profiles={profiles}
            selectedProfileIds={selectedProfileIds}
            usageLoadError={usageLoadError}
            usedProfileIds={usedProfileIds}
            onAddBreed={() => setIsModalOpen(true)}
            onClearSelection={clearSelection}
            onOpenBulkRemove={openBulkRemoveDialog}
            onOpenSingleRemove={openSingleRemoveDialog}
            onToggleAllVisible={toggleAllVisibleProfiles}
            onToggleProfileSelection={toggleProfileSelection}
          />
        ) : (
          <BreedLibraryPanel
            addingBreedId={addingBreedId}
            existingBreedIds={existingBreedIds}
            libraryBreeds={sortedLibraryBreeds}
            species={species}
            speciesById={speciesById}
            onAdd={(breed) => void addLibraryBreedInPlace(breed)}
          />
        )}
      </div>

      {isModalOpen ? (
        <AddBreedModal
          libraryBreeds={sortedLibraryBreeds}
          profiles={profiles}
          species={species}
          speciesById={speciesById}
          onAddCustomBreed={addCustomBreed}
          onAddLibraryBreed={addLibraryBreed}
          onClose={() => setIsModalOpen(false)}
          onAdded={(breedProfileId) => {
            setIsModalOpen(false);
            setReloadKey((current) => current + 1);
            router.push(`/dashboard/breeds/${breedProfileId}`);
          }}
        />
      ) : null}

      {removeDialog ? (
        <RemoveBreedDialog
          dialog={removeDialog}
          isRemoving={isRemoving}
          profileById={profileById}
          usageLoadError={usageLoadError}
          usedProfileIds={usedProfileIds}
          onClose={() => setRemoveDialog(null)}
          onConfirm={(profileIds) => void removeBreedProfiles(profileIds)}
        />
      ) : null}
    </>
  );
}

function BreedLibraryHelper() {
  const isExpanded = useSyncExternalStore(
    subscribeBreedHelperPreference,
    readBreedHelperExpandedSnapshot,
    () => true,
  );
  const rows = [
    {
      glyph: "/glyphs/clipboard.png",
      text: "The Breed Library is a big list of common breeds.",
    },
    {
      glyph: "/glyphs/storefront.png",
      text: "Your Breed Catalog is the list you use in your store.",
    },
    {
      glyph: "/glyphs/pencil.png",
      text: "You can add breeds from the library or create your own, then give them a name and description.",
    },
  ];

  function toggleExpanded() {
    writeBreedHelperPreference(!isExpanded);
  }

  if (!isExpanded) {
    return (
      <SellerCard className="overflow-hidden border-emerald-100 bg-[#f6f8ee]">
        <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
          <div className="flex min-w-0 gap-3">
            <Image
              src="/dashboard/breed-library-hero.png"
              alt=""
              width={512}
              height={512}
              className="size-14 shrink-0 object-contain sm:size-16"
              sizes="64px"
            />
            <div className="min-w-0">
              <h2 className="text-base font-bold text-emerald-950">
                What is your Breed Library?
              </h2>
              <p className="mt-1 max-w-3xl text-sm leading-5 text-stone-800">
                Your Breed Library is where you can choose common breeds to add
                to your store.
              </p>
            </div>
          </div>
          <button
            aria-controls="breed-library-helper-details"
            aria-expanded={false}
            className="seller-small-button shrink-0 rounded-md px-3"
            onClick={toggleExpanded}
            type="button"
          >
            Show more v
          </button>
        </div>
      </SellerCard>
    );
  }

  return (
    <SellerCard className="overflow-hidden border-emerald-100 bg-[#f6f8ee]">
      <div
        className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-center"
        id="breed-library-helper-details"
      >
        <div className="mx-auto w-full max-w-[180px] lg:max-w-[220px]">
          <Image
            src="/dashboard/breed-library-hero.png"
            alt=""
            width={512}
            height={512}
            className="h-auto w-full"
            sizes="(max-width: 1024px) 180px, 220px"
          />
        </div>

        <div className="relative min-w-0 lg:pr-28">
          <button
            aria-controls="breed-library-helper-details"
            aria-expanded={true}
            className="seller-small-button mb-3 rounded-md px-3 lg:absolute lg:right-0 lg:top-0 lg:mb-0"
            onClick={toggleExpanded}
            type="button"
          >
            Show less ^
          </button>
          <div>
            <h2 className="text-base font-bold text-emerald-950">
              What is your Breed Library?
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-950">
              Your Breed Library is where you can choose common breeds to add to
              your store.
            </p>
            <div className="mt-3 space-y-2">
              {rows.map((row) => (
                <div key={row.text} className="flex gap-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-100">
                    <Image src={row.glyph} alt="" width={15} height={15} />
                  </span>
                  <p className="text-sm leading-5 text-stone-800">{row.text}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 flex gap-2 text-sm font-bold leading-5 text-emerald-900">
              <Image
                src="/glyphs/heart.png"
                alt=""
                width={15}
                height={15}
                className="mt-0.5 size-4 shrink-0"
              />
              This helps keep your listings clear and easy for buyers to
              understand.
            </p>
          </div>
        </div>
      </div>
    </SellerCard>
  );
}

function BreedTabs({
  activeTab,
  onChange,
}: {
  activeTab: ActiveTab;
  onChange: (value: ActiveTab) => void;
}) {
  const tabs = [
    {
      glyph: "/glyphs/clipboard.png",
      id: "catalog",
      label: "Breed Catalog",
      subtitle: "Breeds in your store",
    },
    {
      glyph: "/glyphs/looking-glass.png",
      id: "library",
      label: "Breed Library",
      subtitle: "Browse and add breeds",
    },
  ] satisfies {
    glyph: string;
    id: ActiveTab;
    label: string;
    subtitle: string;
  }[];

  return (
    <div
      aria-label="Breed page sections"
      className="grid gap-2 sm:grid-cols-2"
      role="tablist"
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;

        return (
          <button
            key={tab.id}
            aria-controls={`${tab.id}-panel`}
            aria-selected={isActive}
            className={`relative flex min-h-16 items-center gap-3 overflow-hidden rounded-lg border px-4 py-3 text-left transition focus:outline-none focus:ring-2 focus:ring-emerald-800 focus:ring-offset-2 ${
              isActive
                ? "border-emerald-700 bg-emerald-50 text-emerald-950 shadow-sm"
                : "border-stone-200 bg-[#fffaf0] text-emerald-950 hover:border-emerald-800"
            }`}
            id={`${tab.id}-tab`}
            role="tab"
            type="button"
            onClick={() => onChange(tab.id)}
          >
            {isActive ? (
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 w-1.5 bg-emerald-800"
              />
            ) : null}
            <span
              className={`flex size-9 shrink-0 items-center justify-center rounded-full ${
                isActive ? "bg-white" : "bg-emerald-100"
              }`}
            >
              <Image src={tab.glyph} alt="" width={20} height={20} />
            </span>
            <span>
              <span className="block text-sm font-bold">{tab.label}</span>
              <span
                className={`mt-0.5 block text-xs ${
                  isActive ? "text-emerald-800" : "text-emerald-800"
                }`}
              >
                {tab.subtitle}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function BreedCatalogPanel({
  groups,
  libraryByBreedId,
  mediaByProfileId,
  onAddBreed,
  onClearSelection,
  onOpenBulkRemove,
  onOpenSingleRemove,
  onToggleAllVisible,
  onToggleProfileSelection,
  profiles,
  selectedProfileIds,
  usageLoadError,
  usedProfileIds,
}: {
  groups: ReturnType<typeof groupProfilesBySpecies>;
  libraryByBreedId: Map<string, BreedLibraryItem>;
  mediaByProfileId: Map<string, ListingPhotoItem[]>;
  onAddBreed: () => void;
  onClearSelection: () => void;
  onOpenBulkRemove: () => void;
  onOpenSingleRemove: (profileId: string) => void;
  onToggleAllVisible: () => void;
  onToggleProfileSelection: (profileId: string) => void;
  profiles: SellerBreedProfile[];
  selectedProfileIds: Set<string>;
  usageLoadError: string | null;
  usedProfileIds: Set<string>;
}) {
  const visibleProfiles = groups.flatMap((group) => group.profiles);
  const selectedCount = selectedProfileIds.size;
  const hasVisibleProfiles = visibleProfiles.length > 0;
  const isAllVisibleSelected =
    hasVisibleProfiles &&
    visibleProfiles.every((profile) => selectedProfileIds.has(profile.id));

  return (
    <section
      aria-labelledby="catalog-tab"
      className="space-y-2"
      id="catalog-panel"
      role="tabpanel"
      tabIndex={0}
    >
      <SellerCard className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-stone-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-50">
              <Image src="/glyphs/hen.png" alt="" width={20} height={20} />
            </span>
            <div>
              <h2 className="text-base font-bold text-stone-950">
                {profiles.length} Breeds in your catalog
              </h2>
              <p className="mt-0.5 text-sm leading-5 text-stone-600">
                These are the breeds you use across your inventory and listings.
              </p>
            </div>
          </div>
          <button
            className="seller-secondary-button w-full sm:w-auto"
            onClick={onAddBreed}
            type="button"
          >
            Add Breed
          </button>
        </div>

        {profiles.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="Your Breed Catalog is empty"
              description="Choose breeds from the Breed Library or create a custom breed for your store."
              action={
                <button
                  className="seller-primary-button"
                  onClick={onAddBreed}
                  type="button"
                >
                  Add Breed
                </button>
              }
            />
          </div>
        ) : (
          <>
            <div className="border-b border-stone-100 px-3 py-2 sm:px-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <label className="flex items-center gap-2 text-xs font-bold text-stone-700">
                  <input
                    aria-label="Select all visible breeds"
                    checked={isAllVisibleSelected}
                    className="size-4 rounded border-stone-300 text-emerald-800 focus:ring-emerald-800"
                    type="checkbox"
                    onChange={onToggleAllVisible}
                  />
                  Select all
                </label>

                {selectedCount > 0 ? (
                  <div
                    aria-live="polite"
                    className="flex flex-col gap-2 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm sm:flex-row sm:items-center"
                  >
                    <span className="font-bold text-emerald-950">
                      {selectedCount} selected
                    </span>
                    <button
                      className="seller-small-button min-h-8 rounded-md border-red-200 px-3 text-red-700 hover:bg-red-50"
                      disabled={Boolean(usageLoadError)}
                      onClick={onOpenBulkRemove}
                      type="button"
                    >
                      Remove selected
                    </button>
                    <button
                      className="seller-small-button min-h-8 rounded-md px-3"
                      onClick={onClearSelection}
                      type="button"
                    >
                      Clear selection
                    </button>
                  </div>
                ) : null}
              </div>
              {usageLoadError ? (
                <p className="mt-2 text-xs font-semibold text-amber-800">
                  Breed usage could not load, so removal is temporarily disabled.
                </p>
              ) : null}
            </div>
            <div className="divide-y divide-stone-100 px-3 sm:px-4">
            {groups.flatMap((group) =>
              group.profiles.map((profile) => (
                <BreedCatalogRow
                  key={profile.id}
                  description={getProfileDescription(profile, libraryByBreedId)}
                  imageUrls={getBreedProfileImageUrls(
                    profile,
                    libraryByBreedId,
                    mediaByProfileId,
                  )}
                  isSelected={selectedProfileIds.has(profile.id)}
                  isUsed={usedProfileIds.has(profile.id)}
                  profile={profile}
                  usageLoadError={usageLoadError}
                  onOpenRemove={() => onOpenSingleRemove(profile.id)}
                  onToggleSelection={() => onToggleProfileSelection(profile.id)}
                />
              )),
            )}
            </div>
          </>
        )}
      </SellerCard>

      <div className="grid gap-2 rounded-lg border border-stone-200 bg-[#fffaf0] px-4 py-2.5 text-xs font-bold text-emerald-950 sm:grid-cols-2">
        <SummaryItem glyph="/glyphs/hen.png" label={`${profiles.length} Breeds`} />
        <SummaryItem glyph="/glyphs/egg-carton.png" label={`${groups.length} Species`} />
      </div>
    </section>
  );
}

function BreedCatalogRow({
  description,
  imageUrls,
  isSelected,
  isUsed,
  onOpenRemove,
  onToggleSelection,
  profile,
  usageLoadError,
}: {
  description: string;
  imageUrls: string[];
  isSelected: boolean;
  isUsed: boolean;
  onOpenRemove: () => void;
  onToggleSelection: () => void;
  profile: SellerBreedProfile;
  usageLoadError: string | null;
}) {
  return (
    <div className="grid gap-2 py-2.5 sm:grid-cols-[28px_44px_minmax(0,1fr)_auto_auto] sm:items-center">
      <label className="flex items-center sm:justify-center">
        <span className="sr-only">Select {profile.display_name}</span>
        <input
          aria-label={`Select ${profile.display_name}`}
          checked={isSelected}
          className="size-4 rounded border-stone-300 text-emerald-800 focus:ring-emerald-800"
          type="checkbox"
          onChange={onToggleSelection}
        />
      </label>
      <BreedThumbnail imageUrls={imageUrls} name={profile.display_name} />
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-stone-950">
          {profile.display_name}
        </h3>
        <p className="mt-0.5 max-w-2xl text-sm leading-5 text-stone-600">
          {description ? truncateText(description, 150) : "No description added yet."}
        </p>
      </div>
      <Link
        className="seller-small-button min-h-9 w-full rounded-md px-4 sm:w-auto"
        href={`/dashboard/breeds/${profile.id}`}
      >
        Edit
      </Link>
      <button
        className="seller-small-button min-h-9 w-full rounded-md border-red-200 px-4 text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        disabled={Boolean(usageLoadError)}
        title={
          isUsed
            ? "This breed is used in existing inventory or listings and cannot be removed yet."
            : undefined
        }
        type="button"
        onClick={onOpenRemove}
      >
        Remove
      </button>
    </div>
  );
}

function BreedLibraryPanel({
  addingBreedId,
  existingBreedIds,
  libraryBreeds,
  onAdd,
  species,
  speciesById,
}: {
  addingBreedId: string | null;
  existingBreedIds: Set<string>;
  libraryBreeds: BreedLibraryItem[];
  onAdd: (breed: BreedLibraryItem) => void;
  species: BreedSpecies[];
  speciesById: Map<string, string>;
}) {
  const [query, setQuery] = useState("");
  const [speciesFilter, setSpeciesFilter] = useState("all");
  const hasSearchQuery = query.trim().length > 0;
  const hasSpeciesFilter = speciesFilter !== "all";
  const filteredBreeds = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return libraryBreeds
      .filter((breed) => {
        if (speciesFilter !== "all" && breed.species_id !== speciesFilter) {
          return false;
        }

        if (!normalizedQuery) return true;

        return breed.breed_name.toLowerCase().includes(normalizedQuery);
      })
      .slice(0, 40);
  }, [libraryBreeds, query, speciesFilter]);
  const emptyTitle = hasSpeciesFilter
    ? "No library breeds found for this species."
    : "No breeds found.";
  const emptyDescription = hasSearchQuery
    ? "Try a different search or create a custom breed."
    : "Try a different species or create a custom breed.";

  return (
    <section
      aria-labelledby="library-tab"
      className="space-y-2"
      id="library-panel"
      role="tabpanel"
      tabIndex={0}
    >
      <SellerCard className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-stone-200 bg-white px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-50">
              <Image src="/glyphs/looking-glass.png" alt="" width={20} height={20} />
            </span>
            <div>
              <h2 className="text-base font-bold text-stone-950">
                Breed Library
              </h2>
              <p className="mt-0.5 text-sm leading-5 text-stone-600">
                Browse common breeds and add the ones you want in your Breed
                Catalog.
              </p>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-[minmax(220px,360px)_190px]">
            <label className="min-w-0">
              <span className="sr-only">Search breeds</span>
              <input
                className="seller-form-field min-h-9 px-3 text-sm"
                placeholder="Search by breed name"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <label>
              <span className="sr-only">Filter by species</span>
              <select
                aria-label="Filter by species"
                className="min-h-9 w-full rounded-md border border-stone-300 bg-white px-3 text-sm font-medium text-stone-950 shadow-sm focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
                value={speciesFilter}
                onChange={(event) => setSpeciesFilter(event.target.value)}
              >
                <option value="all">All Species</option>
                {species.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.common_name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {filteredBreeds.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title={emptyTitle}
              description={emptyDescription}
            />
          </div>
        ) : (
          <div className="grid gap-2.5 bg-stone-50/40 p-3 sm:grid-cols-2 2xl:grid-cols-3">
            {filteredBreeds.map((breed) => {
              const isAdded = existingBreedIds.has(breed.id);
              const speciesName = speciesById.get(breed.species_id) ?? "Species";

              return (
                <article
                  key={breed.id}
                  className="flex min-h-32 flex-col rounded-lg border border-stone-200 bg-white p-3 shadow-sm"
                >
                  <div className="flex items-start gap-2.5">
                    <BreedThumbnail
                      imageUrls={breed.image_url ? [breed.image_url] : []}
                      name={breed.breed_name}
                      size="small"
                    />
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-stone-950">
                        {breed.breed_name}
                      </h3>
                      <p className="mt-0.5 text-xs font-medium text-emerald-800">
                        {speciesName}
                      </p>
                    </div>
                  </div>
                  <p className="mt-2 flex-1 text-sm leading-5 text-stone-600">
                    {breed.description
                      ? truncateText(breed.description, 110)
                      : "No default description yet."}
                  </p>
                  <div className="mt-3 flex justify-start sm:justify-end">
                    <button
                      aria-label={
                        isAdded
                          ? `${breed.breed_name} is already in your Breed Catalog`
                          : `Add ${breed.breed_name} to catalog`
                      }
                      className={
                        isAdded
                          ? "seller-small-button min-h-8 w-full cursor-default rounded-md px-3 text-stone-600 opacity-75 sm:w-auto"
                          : "seller-small-button min-h-8 w-full rounded-md border-emerald-200 px-3 text-emerald-900 hover:bg-emerald-50 sm:w-auto"
                      }
                      disabled={isAdded || addingBreedId === breed.id}
                      onClick={() => onAdd(breed)}
                      type="button"
                    >
                      {isAdded
                        ? "Already in Catalog"
                        : addingBreedId === breed.id
                          ? "Adding"
                          : "Add to Catalog"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </SellerCard>
    </section>
  );
}

function RemoveBreedDialog({
  dialog,
  isRemoving,
  onClose,
  onConfirm,
  profileById,
  usageLoadError,
  usedProfileIds,
}: {
  dialog: RemoveDialogState;
  isRemoving: boolean;
  onClose: () => void;
  onConfirm: (profileIds: string[]) => void;
  profileById: Map<string, SellerBreedProfile>;
  usageLoadError: string | null;
  usedProfileIds: Set<string>;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusedElementRef = useRef<HTMLElement | null>(null);
  const profiles =
    dialog.mode === "single"
      ? [profileById.get(dialog.profileId)].filter(
          (profile): profile is SellerBreedProfile => Boolean(profile),
        )
      : dialog.profileIds
          .map((profileId) => profileById.get(profileId))
          .filter((profile): profile is SellerBreedProfile => Boolean(profile));
  const blockedProfiles = profiles.filter((profile) =>
    usedProfileIds.has(profile.id),
  );
  const removableProfiles = usageLoadError
    ? []
    : profiles.filter((profile) => !usedProfileIds.has(profile.id));
  const isBulk = dialog.mode === "bulk";
  const title = isBulk ? "Remove selected breeds?" : "Remove breed from catalog?";
  const descriptionId = "remove-breed-dialog-description";
  const titleId = "remove-breed-dialog-title";
  const canConfirm = removableProfiles.length > 0 && !usageLoadError;

  useEffect(() => {
    previousFocusedElementRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const cancelButton =
      dialogRef.current?.querySelector<HTMLButtonElement>(
        "[data-dialog-cancel]",
      );
    cancelButton?.focus();

    return () => {
      previousFocusedElementRef.current?.focus();
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
      dialogRef.current?.querySelectorAll<HTMLElement>(
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
      className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/60 px-3 py-4 sm:items-center"
      onKeyDown={handleKeyDown}
    >
      <div
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="w-full max-w-lg rounded-lg bg-white shadow-xl"
        ref={dialogRef}
        role="dialog"
      >
        <div className="border-b border-stone-200 px-5 py-4">
          <h2 className="text-lg font-bold text-stone-950" id={titleId}>
            {title}
          </h2>
          <div
            className="mt-2 space-y-2 text-sm leading-6 text-stone-700"
            id={descriptionId}
          >
            {usageLoadError ? (
              <p>
                Breed usage could not load, so removal is temporarily disabled.
                Please try again in a moment.
              </p>
            ) : isBulk ? (
              <>
                <p>
                  You are about to remove {removableProfiles.length}{" "}
                  {removableProfiles.length === 1 ? "breed" : "breeds"} from
                  your Breed Catalog. They will no longer be available for new
                  inventory or listings.
                </p>
                {blockedProfiles.length > 0 ? (
                  <p className="font-semibold text-amber-800">
                    {blockedProfiles.length} selected{" "}
                    {blockedProfiles.length === 1 ? "breed is" : "breeds are"}{" "}
                    currently used in your store and cannot be removed yet.
                    Removing the safe breeds will leave{" "}
                    {blockedProfiles.length === 1 ? "it" : "them"} in your
                    catalog.
                  </p>
                ) : null}
              </>
            ) : blockedProfiles.length > 0 ? (
              <>
                <p>
                  This breed is currently used in your store. Removing it may
                  affect existing inventory or listings.
                </p>
                <p className="font-semibold text-amber-800">
                  This breed is used in existing inventory or listings and
                  cannot be removed yet.
                </p>
              </>
            ) : (
              <p>
                This removes the breed from your Breed Catalog. It will no
                longer be available for new inventory or listings.
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 px-5 py-4 sm:flex-row sm:justify-end">
          <button
            className="seller-secondary-button"
            data-dialog-cancel
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          {canConfirm ? (
            <button
              className="seller-secondary-button border-red-300 text-red-700 hover:bg-red-50"
              disabled={isRemoving}
              onClick={() =>
                onConfirm(removableProfiles.map((profile) => profile.id))
              }
              type="button"
            >
              {isRemoving
                ? "Removing"
                : isBulk
                  ? "Remove Selected Breeds"
                  : "Remove Breed"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AddBreedModal({
  libraryBreeds,
  onAddCustomBreed,
  onAddLibraryBreed,
  onAdded,
  onClose,
  profiles,
  species,
  speciesById,
}: {
  libraryBreeds: BreedLibraryItem[];
  onAddCustomBreed: (draft: CustomBreedDraft) => Promise<AddBreedResult>;
  onAddLibraryBreed: (breed: BreedLibraryItem) => Promise<AddBreedResult>;
  onAdded: (breedProfileId: string) => void;
  onClose: () => void;
  profiles: SellerBreedProfile[];
  species: BreedSpecies[];
  speciesById: Map<string, string>;
}) {
  const [mode, setMode] = useState<AddMode>("choose");
  const [query, setQuery] = useState("");
  const [speciesFilter, setSpeciesFilter] = useState("all");
  const [addingBreedId, setAddingBreedId] = useState<string | null>(null);
  const [customDraft, setCustomDraft] = useState<CustomBreedDraft>({
    description: "",
    name: "",
    speciesId: species[0]?.id ?? "",
  });
  const [isCreatingCustom, setIsCreatingCustom] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const existingBreedIds = useMemo(
    () =>
      new Set(
        profiles
          .map((profile) => profile.breed_id)
          .filter((value): value is string => Boolean(value)),
      ),
    [profiles],
  );
  const filteredBreeds = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return libraryBreeds
      .filter((breed) => {
        if (existingBreedIds.has(breed.id)) return false;
        if (speciesFilter !== "all" && breed.species_id !== speciesFilter) {
          return false;
        }
        if (!normalizedQuery) return true;

        return breed.breed_name.toLowerCase().includes(normalizedQuery);
      })
      .slice(0, 20);
  }, [existingBreedIds, libraryBreeds, query, speciesFilter]);

  async function addBreed(breed: BreedLibraryItem) {
    if (addingBreedId) return;

    setAddingBreedId(breed.id);
    setError(null);

    const result = await onAddLibraryBreed(breed);

    if (!result.ok) {
      setError(result.message);
      setAddingBreedId(null);
      return;
    }

    setAddingBreedId(null);
    onAdded(result.breedProfileId);
  }

  async function createCustomBreed() {
    if (isCreatingCustom) return;

    const nextDraft = {
      ...customDraft,
      description: customDraft.description.trim(),
      name: customDraft.name.trim(),
    };

    if (!nextDraft.name) {
      setError("Add a breed name.");
      return;
    }

    if (!nextDraft.speciesId) {
      setError("Choose a species.");
      return;
    }

    setIsCreatingCustom(true);
    setError(null);

    const result = await onAddCustomBreed(nextDraft);

    if (!result.ok) {
      setError(result.message);
      setIsCreatingCustom(false);
      return;
    }

    setIsCreatingCustom(false);
    onAdded(result.breedProfileId);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/60 px-3 py-4 sm:items-center">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-stone-200 px-5 py-4">
          <div>
            <h2 className="text-xl font-semibold text-stone-950">Add Breed</h2>
            <p className="mt-1 text-sm leading-6 text-stone-600">
              Choose a common breed from the Breed Library or create a custom
              breed for your Breed Catalog.
            </p>
          </div>
          <button
            aria-label="Close Add Breed"
            className="rounded-md px-2 py-1 text-2xl leading-none text-stone-500 hover:bg-stone-100 hover:text-stone-950"
            onClick={onClose}
            type="button"
          >
            x
          </button>
        </div>

        {error ? (
          <div className="px-5 pt-4">
            <ErrorState title="Breed was not added" message={error} />
          </div>
        ) : null}

        {mode === "choose" ? (
          <div className="grid gap-3 p-5 sm:grid-cols-2">
            <button
              className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-left text-emerald-950 transition hover:border-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-800"
              onClick={() => setMode("library")}
              type="button"
            >
              <Image src="/glyphs/looking-glass.png" alt="" width={32} height={32} />
              <span className="mt-4 block text-lg font-bold">
                Choose from Breed Library
              </span>
              <span className="mt-2 block text-sm leading-6 text-emerald-900">
                Browse common breeds and add one to your store.
              </span>
            </button>
            <button
              className="rounded-lg border border-stone-200 bg-[#fffaf0] p-5 text-left text-emerald-950 transition hover:border-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-800"
              onClick={() => setMode("custom")}
              type="button"
            >
              <Image src="/glyphs/pencil.png" alt="" width={32} height={32} />
              <span className="mt-4 block text-lg font-bold">
                Create Custom Breed
              </span>
              <span className="mt-2 block text-sm leading-6 text-emerald-900">
                Add a breed name and description yourself.
              </span>
            </button>
          </div>
        ) : null}

        {mode === "library" ? (
          <>
            <div className="grid gap-3 border-b border-stone-200 px-5 py-4 sm:grid-cols-[1fr_220px]">
              <label className="grid gap-1 text-sm font-semibold text-stone-700">
                Search breeds
                <input
                  className="seller-form-field"
                  placeholder="Search breeds by name"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <FilterControl
                label="Species"
                options={[
                  { label: "All Species", value: "all" },
                  ...species.map((item) => ({
                    label: item.common_name,
                    value: item.id,
                  })),
                ]}
                value={speciesFilter}
                onChange={setSpeciesFilter}
              />
            </div>

            <div className="max-h-[54vh] overflow-y-auto px-5">
              {filteredBreeds.length === 0 ? (
                <div className="py-8 text-center">
                  <h3 className="font-semibold text-stone-950">
                    No matching breeds
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-stone-600">
                    Try a different search or species filter.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-stone-100">
                  {filteredBreeds.map((breed) => (
                    <div
                      key={breed.id}
                      className="grid gap-3 py-4 sm:grid-cols-[56px_minmax(150px,0.8fr)_minmax(0,1fr)_auto] sm:items-center"
                    >
                      <BreedThumbnail
                        imageUrls={breed.image_url ? [breed.image_url] : []}
                        name={breed.breed_name}
                        size="small"
                      />
                      <div>
                        <h3 className="font-semibold text-stone-950">
                          {breed.breed_name}
                        </h3>
                        <p className="mt-1 text-sm text-stone-600">
                          {speciesById.get(breed.species_id) ?? "Species"}
                        </p>
                      </div>
                      <p className="text-sm leading-6 text-stone-600">
                        {breed.description
                          ? truncateText(breed.description, 120)
                          : "No default description yet."}
                      </p>
                      <button
                        className="seller-secondary-button"
                        disabled={addingBreedId === breed.id}
                        onClick={() => void addBreed(breed)}
                        type="button"
                      >
                        {addingBreedId === breed.id ? "Adding" : "Add to Catalog"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : null}

        {mode === "custom" ? (
          <div className="grid gap-4 p-5">
            <FilterControl
              label="Species"
              options={species.map((item) => ({
                label: item.common_name,
                value: item.id,
              }))}
              value={customDraft.speciesId}
              onChange={(value) =>
                setCustomDraft((current) => ({ ...current, speciesId: value }))
              }
            />
            <label className="grid gap-1 text-sm font-semibold text-stone-700">
              Breed name
              <input
                className="seller-form-field"
                placeholder="Example: Blue Splash Olive Egger"
                value={customDraft.name}
                onChange={(event) =>
                  setCustomDraft((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-stone-700">
              Description
              <textarea
                className="seller-form-field min-h-28 resize-y py-3"
                placeholder="Add the description buyers should see."
                value={customDraft.description}
                onChange={(event) =>
                  setCustomDraft((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
              />
            </label>
            <button
              className="seller-primary-button w-full sm:w-fit"
              disabled={isCreatingCustom}
              onClick={() => void createCustomBreed()}
              type="button"
            >
              {isCreatingCustom ? "Creating" : "Create Custom Breed"}
            </button>
          </div>
        ) : null}

        {mode !== "choose" ? (
          <div className="border-t border-stone-200 bg-stone-50 px-5 py-4">
            <button
              className="seller-small-button"
              onClick={() => {
                setError(null);
                setMode("choose");
              }}
              type="button"
            >
              Back to choices
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function BreedThumbnail({
  imageUrls,
  name,
  size = "default",
}: {
  imageUrls: string[];
  name: string;
  size?: "default" | "small";
}) {
  const [failedImageUrls, setFailedImageUrls] = useState<Set<string>>(
    () => new Set(),
  );
  const displayImageUrl =
    imageUrls
      .map((imageUrl) => toDisplayImageUrl(imageUrl))
      .find((imageUrl) => imageUrl && !failedImageUrls.has(imageUrl)) ?? "";
  const dimensions = size === "small" ? "size-9" : "size-10";

  if (!displayImageUrl) {
    return <InitialsTile name={name} size={size} />;
  }

  return (
    <div
      aria-hidden="true"
      className={`${dimensions} shrink-0 overflow-hidden rounded-md bg-emerald-50 ring-1 ring-emerald-100`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt=""
        className="h-full w-full object-cover"
        src={displayImageUrl}
        onError={() => {
          setFailedImageUrls((current) => new Set(current).add(displayImageUrl));
        }}
      />
    </div>
  );
}

function InitialsTile({
  name,
  size = "default",
}: {
  name: string;
  size?: "default" | "small";
}) {
  const dimensions = size === "small" ? "size-9" : "size-10";

  return (
    <div
      aria-hidden="true"
      className={`${dimensions} flex shrink-0 items-center justify-center rounded-md bg-emerald-50 text-xs font-bold text-emerald-900`}
    >
      {getBreedInitials(name)}
    </div>
  );
}

function getBreedProfileImageUrls(
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

function SummaryItem({ glyph, label }: { glyph: string; label: string }) {
  return (
    <span className="flex items-center justify-center gap-2 sm:justify-start">
      <Image src={glyph} alt="" width={18} height={18} />
      {label}
    </span>
  );
}

function readBreedHelperPreference() {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage.getItem(breedHelperStorageKey);
  } catch {
    return null;
  }
}

function readBreedHelperExpandedSnapshot() {
  return readBreedHelperPreference() !== "false";
}

function writeBreedHelperPreference(isExpanded: boolean) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(breedHelperStorageKey, String(isExpanded));
    window.dispatchEvent(new Event(breedHelperPreferenceEvent));
  } catch {
    return;
  }
}

function subscribeBreedHelperPreference(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};

  function handleStorage(event: StorageEvent) {
    if (event.key === breedHelperStorageKey) {
      onStoreChange();
    }
  }

  window.addEventListener("storage", handleStorage);
  window.addEventListener(breedHelperPreferenceEvent, onStoreChange);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(breedHelperPreferenceEvent, onStoreChange);
  };
}
