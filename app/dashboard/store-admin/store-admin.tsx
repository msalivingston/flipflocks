"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getPlanCapabilities,
  type LockedPlanFeature,
} from "@/lib/plan-capabilities";
import { supabase } from "@/lib/supabase";
import { PlanUpgradeDialog } from "../_components/plan-upgrade-prompt";
import { useSellerContext } from "../_components/seller-context";
import {
  ErrorState,
  LoadingState,
  SellerPageHeader,
} from "../_components/seller-ui";
import {
  getCropImageStyle,
  normalizeCrop,
  type PhotoCropMetadata,
} from "../_components/photo-crop-editor";
import {
  cx,
  getMobileStorefrontHeroCropStyle,
  getStorefrontThemeStyle,
  storefrontButtonClass,
  storefrontHeroFrame,
  storefrontHeroMobilePreviewTypography,
  storefrontHeroTypography,
} from "@/app/store/[slug]/storefront-ui";
import {
  defaultStorefrontTheme,
  getStorefrontFontPair,
  isValidStorefrontHexColor,
  normalizeStorefrontFontPair,
  normalizeStorefrontHexColor,
  storefrontFontPairs,
  storefrontFontVariablesClass,
  type StorefrontFontPairId,
} from "@/app/store/[slug]/storefront-fonts";
import {
  type DeliveryOptionDraft,
} from "./delivery-options-section";
import type { PickupDeliveryTabProps } from "./pickup-delivery-tab";
import type { PoliciesTabProps } from "./policies-tab";

const DynamicPickupDeliveryTab = dynamic<PickupDeliveryTabProps>(
  () => import("./pickup-delivery-tab"),
  { loading: () => null, ssr: false },
);

const DynamicPoliciesTab = dynamic<PoliciesTabProps>(
  () => import("./policies-tab"),
  { loading: () => null, ssr: false },
);

type StoreAdminForm = {
  store_name: string;
  store_slug: string;
  store_tagline: string;
  hero_subheading: string;
  storefront_font_pair: StorefrontFontPairId;
  storefront_heading_color: string;
  storefront_text_color: string;
  storefront_top_menu_color: string;
  public_city: string;
  public_state: string;
  public_country: string;
  about_text: string;
  website_url: string;
  npip_number: string;
  show_npip: boolean;
  public_email: string;
  show_public_email: boolean;
  public_phone: string;
  show_public_phone: boolean;
  communication_email: string;
  pickup_method: "notes" | "manual_options";
  pickup_location_text: string;
  pickup_instructions: string;
  pickup_address_line1: string;
  pickup_address_line2: string;
  pickup_city: string;
  pickup_state: string;
  pickup_postal_code: string;
  pickup_country: string;
  default_pickup_option_id: string;
  delivery_enabled: boolean;
  pickup_policy: string;
  cancellation_policy: string;
  other_policies: string;
  custom_policies: CustomPolicyDraft[];
  order_notification_email: string;
  storefront_enabled: boolean;
  hatching_eggs_enabled: boolean;
  equipment_supplies_enabled: boolean;
  processed_poultry_enabled: boolean;
};

type StoreAdminFieldUpdater = <TKey extends keyof StoreAdminForm>(
  key: TKey,
  value: StoreAdminForm[TKey],
) => void;

type CustomPolicyDraft = {
  id: string;
  title: string;
  body: string;
};

type StoreDefaults = {
  store_id: string;
  pickup_method: "notes" | "manual_options" | null;
  pickup_instructions: string | null;
  pickup_location_text: string | null;
  pickup_address_line1: string | null;
  pickup_address_line2: string | null;
  pickup_city: string | null;
  pickup_state: string | null;
  pickup_postal_code: string | null;
  pickup_country: string | null;
  default_pickup_option_id: string | null;
  default_pickup_option_label: string | null;
  delivery_enabled: boolean | null;
  communication_email: string | null;
  order_notification_email: string | null;
  currency: string | null;
};

type PickupOption = {
  id: string;
  store_id: string;
  label: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
};

type PickupOptionDraft = {
  id: string;
  label: string;
  description: string;
  sort_order: number;
  is_active: boolean;
  isNew?: boolean;
};

type DeliveryOption = {
  id: string;
  store_id: string;
  name: string;
  price_amount: number | string;
  sort_order: number;
  is_active: boolean;
};

type StoreMediaItem = {
  media_asset_id: string;
  media_link_id: string;
  store_id: string;
  entity_type: string;
  entity_id: string;
  display_context: "logo" | "hero" | "gallery" | string;
  public_url: string;
  alt_text: string | null;
  caption: string | null;
  sort_order: number | null;
  is_featured: boolean;
  crop_metadata?: PhotoCropMetadata | null;
  moderation_status: string;
  asset_status: string;
  visibility_status: string;
  original_filename: string | null;
  content_type: string;
  file_size_bytes: number;
  width_px: number | null;
  height_px: number | null;
  source_type?: string | null;
  source_image_url?: string | null;
  hero_layout?: string | null;
  draft_file?: File;
  draft_status?: "new" | "remove";
  preview_url?: string;
};

type StoreMediaRole = "logo" | "hero" | "about";

type HeroLibraryImage = {
  label: string;
  path: string;
};

type UploadResponse = {
  media?: StoreMediaItem | null;
  error?: {
    code?: string;
    message?: string;
  };
};

type SaveState = "idle" | "saved" | "error";

type StoreSetupTab =
  | "storefront"
  | "photos"
  | "what-you-sell"
  | "pickup"
  | "policies";

type ModulePreferenceField =
  | "hatching_eggs_enabled"
  | "processed_poultry_enabled"
  | "equipment_supplies_enabled";

type ModuleDisableDialogState = {
  field: ModulePreferenceField;
  message: string;
  title: string;
};

type LaunchReadinessItem = {
  item_type: "required" | "warning";
  item_key: string;
  label: string;
  passed: boolean;
  message: string;
  action: string;
  detail_count: number | null;
};

type StoreLaunchResponse = {
  launched?: boolean;
  store?: {
    store_id: string;
    store_status: string;
    storefront_enabled: boolean;
    is_publicly_available: boolean;
    launched_at: string | null;
  } | null;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
};

type SellerLaunchItem = {
  key: string;
  label: string;
  passed: boolean;
  action: string;
};

const unsavedWarning =
  "You have unsaved Store Admin changes. Save or discard before leaving.";

const STORE_MEDIA_SELECT =
  "media_asset_id, media_link_id, store_id, entity_type, entity_id, display_context, public_url, alt_text, caption, sort_order, is_featured, crop_metadata, hero_layout, moderation_status, asset_status, visibility_status, original_filename, content_type, file_size_bytes, width_px, height_px, source_type, source_image_url";

const acceptedStoreImageTypes = ["image/jpeg", "image/png", "image/webp"];
const maxStoreImageSizeBytes = 8 * 1024 * 1024;
const heroHeadlineMaxLength = 45;
const heroSubheadingMaxLength = 90;
const farmStoryMaxLength = 2500;
const defaultPickupPolicy =
  "All pickups are by appointment and need at least 24 hours advance notice. At pickup, please come prepared with appropriate transport for your birds. Pet carriers sized appropriately work well. If you bring cardboard boxes, please cut air holes in advance. Please do not bring plastic tubs unless they have appropriate ventilation. Younger birds should have something so they are not standing on slick surfaces.";
const starterFarmDescription = `Weâ€™re a local farm offering poultry and farm goods for backyard flock owners, homesteaders, and small farms.

For many people, raising poultry is about more than eggs or meat. Itâ€™s about knowing where your food comes from, building a flock that fits your home, teaching kids responsibility, adding beauty and life to the yard, and enjoying the daily rhythm of caring for animals.

Our birds and products change with the season, the hatch, and the natural pace of farm life. Depending on whatâ€™s available, you may find chicks, started birds, laying hens, hatching eggs, eating eggs, poultry products, supplies, equipment, or other farm goods listed here.

Buying from a small poultry farm keeps things local, supports the people doing the daily work, and gives you a closer connection to where your birds and farm products are coming from.

Check our current listings to see whatâ€™s ready now. Thank you for supporting small farms, local food, and backyard flocks.`;

const normalizedStarterFarmDescription = starterFarmDescription
  .replaceAll("Ã¢â‚¬â„¢", "'")
  .replaceAll("â€™", "'")
  .replaceAll("â€˜", "'");
const readOnlyFieldStyle: CSSProperties = {
  backgroundColor: "#e7e5e4",
  borderColor: "#a8a29e",
  color: "#57534e",
};

const heroLayoutOptions: Array<{
  label: string;
  value: HeroLayout;
}> = [
  {
    label: "Full Width Photo",
    value: "full",
  },
  {
    label: "Left Fade",
    value: "right",
  },
];

const heroLibraryImages: HeroLibraryImage[] = [
  { label: "Sunlit pasture flock", path: "/storefront-heroes/sunlit-pasture-flock.png" },
  { label: "Barnyard golden hour", path: "/storefront-heroes/barnyard-golden-hour.png" },
  { label: "Open field chickens", path: "/storefront-heroes/open-field-chickens.png" },
  { label: "Mountain farm flock", path: "/storefront-heroes/mountain-farm-flock.png" },
  { label: "Coop pathway morning", path: "/storefront-heroes/coop-pathway-morning.png" },
  { label: "Pasture hens wide", path: "/storefront-heroes/pasture-hens-wide.png" },
  { label: "Farmhouse flock sunset", path: "/storefront-heroes/farmhouse-flock-sunset.png" },
  { label: "Green meadow chickens", path: "/storefront-heroes/green-meadow-chickens.png" },
  { label: "Country barn flock", path: "/storefront-heroes/country-barn-flock.png" },
  { label: "Fence line poultry", path: "/storefront-heroes/fence-line-poultry.png" },
  { label: "Orchard hens", path: "/storefront-heroes/orchard-hens.png" },
  { label: "Prairie coop flock", path: "/storefront-heroes/prairie-coop-flock.png" },
  { label: "Homestead chickens", path: "/storefront-heroes/homestead-chickens.png" },
  { label: "Rolling hills flock", path: "/storefront-heroes/rolling-hills-flock.png" },
  { label: "Warm coop yard", path: "/storefront-heroes/warm-coop-yard.png" },
  { label: "Family farm pasture", path: "/storefront-heroes/family-farm-pasture.png" },
  { label: "Wide farmstead flock", path: "/storefront-heroes/wide-farmstead-flock.png" },
  { label: "Quiet country coop", path: "/storefront-heroes/quiet-country-coop.png" },
];

const storeSetupTabs: Array<{ id: StoreSetupTab; label: string }> = [
  { id: "storefront", label: "Storefront" },
  { id: "photos", label: "Images" },
  { id: "what-you-sell", label: "What You Sell" },
  { id: "pickup", label: "Pickup/Delivery" },
  { id: "policies", label: "Policies" },
];

const blankForm: StoreAdminForm = {
  store_name: "",
  store_slug: "",
  store_tagline: "",
  hero_subheading: "",
  storefront_font_pair: defaultStorefrontTheme.fontPair,
  storefront_heading_color: defaultStorefrontTheme.headingColor,
  storefront_text_color: defaultStorefrontTheme.textColor,
  storefront_top_menu_color: defaultStorefrontTheme.topMenuColor,
  public_city: "",
  public_state: "",
  public_country: "US",
  about_text: "",
  website_url: "",
  npip_number: "",
  show_npip: false,
  public_email: "",
  show_public_email: false,
  public_phone: "",
  show_public_phone: false,
  communication_email: "",
  pickup_method: "notes",
  pickup_location_text: "",
  pickup_instructions: "",
  pickup_address_line1: "",
  pickup_address_line2: "",
  pickup_city: "",
  pickup_state: "",
  pickup_postal_code: "",
  pickup_country: "US",
  default_pickup_option_id: "",
  delivery_enabled: false,
  pickup_policy: "",
  cancellation_policy: "",
  other_policies: "",
  custom_policies: [],
  order_notification_email: "",
  storefront_enabled: false,
  hatching_eggs_enabled: false,
  equipment_supplies_enabled: false,
  processed_poultry_enabled: false,
};

export function StoreAdmin() {
  const { seller, reload } = useSellerContext();
  const plan = getPlanCapabilities(seller?.plan_key);
  const [lockedFeature, setLockedFeature] = useState<LockedPlanFeature | null>(
    null,
  );
  const [form, setForm] = useState<StoreAdminForm>(blankForm);
  const [initialForm, setInitialForm] = useState<StoreAdminForm>(blankForm);
  const [pickupOptions, setPickupOptions] = useState<PickupOptionDraft[]>([]);
  const [initialPickupOptions, setInitialPickupOptions] = useState<
    PickupOptionDraft[]
  >([]);
  const [deliveryOptions, setDeliveryOptions] = useState<DeliveryOptionDraft[]>(
    [],
  );
  const [initialDeliveryOptions, setInitialDeliveryOptions] = useState<
    DeliveryOptionDraft[]
  >([]);
  const [deliveryValidationMessage, setDeliveryValidationMessage] = useState<
    string | null
  >(null);
  const [storeMediaItems, setStoreMediaItems] = useState<StoreMediaItem[]>([]);
  const [initialStoreMediaItems, setInitialStoreMediaItems] = useState<
    StoreMediaItem[]
  >([]);
  const [isMediaUploading, setIsMediaUploading] = useState<StoreMediaRole | null>(
    null,
  );
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [readinessItems, setReadinessItems] = useState<LaunchReadinessItem[]>(
    [],
  );
  const [readinessError, setReadinessError] = useState<string | null>(null);
  const [isReadinessLoading, setIsReadinessLoading] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const [activeTab, setActiveTab] = useState<StoreSetupTab>("storefront");
  const [moduleDisableDialog, setModuleDisableDialog] =
    useState<ModuleDisableDialogState | null>(null);
  const pendingPickupOptionFocusId = useRef<string | null>(null);
  const customPolicyRowRefs = useRef(new Map<string, HTMLElement>());
  const customPolicyDragChangedRef = useRef(false);
  const [draggingCustomPolicyId, setDraggingCustomPolicyId] = useState<
    string | null
  >(null);
  const [customPolicyDragPreview, setCustomPolicyDragPreview] = useState<{
    label: string;
    width: number;
    x: number;
    y: number;
  } | null>(null);
  const [pendingNavigationUrl, setPendingNavigationUrl] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (saveMessage !== "Changes discarded.") return;

    const timeoutId = window.setTimeout(() => {
      setSaveMessage(null);
      setSaveState("idle");
    }, 3500);

    return () => window.clearTimeout(timeoutId);
  }, [saveMessage]);

  useEffect(() => {
    let isMounted = true;

    async function loadStoreAdmin() {
      if (!seller) return;

      setIsLoading(true);
      setLoadError(null);
      setSaveMessage(null);
      setSaveState("idle");

      const [
        defaultsResult,
        pickupOptionsResult,
        deliveryOptionsResult,
        readinessResult,
        mediaResult,
      ] = await Promise.all([
          supabase
            .from("seller_store_defaults")
            .select(
              "store_id, pickup_method, pickup_instructions, pickup_location_text, pickup_address_line1, pickup_address_line2, pickup_city, pickup_state, pickup_postal_code, pickup_country, default_pickup_option_id, default_pickup_option_label, delivery_enabled, communication_email, order_notification_email, currency",
            )
            .eq("store_id", seller.store_id)
            .maybeSingle()
            .returns<StoreDefaults>(),
          supabase
            .from("store_pickup_options")
            .select("id, store_id, label, description, sort_order, is_active")
            .eq("store_id", seller.store_id)
            .order("sort_order", { ascending: true })
            .order("label", { ascending: true })
            .returns<PickupOption[]>(),
          supabase
            .from("store_delivery_options")
            .select("id, store_id, name, price_amount, sort_order, is_active")
            .eq("store_id", seller.store_id)
            .order("sort_order", { ascending: true })
            .order("name", { ascending: true })
            .returns<DeliveryOption[]>(),
          supabase.rpc("seller_get_store_launch_readiness", {
            p_store_id: seller.store_id,
          }),
          supabase
            .from("seller_media_management")
            .select(STORE_MEDIA_SELECT)
            .eq("store_id", seller.store_id)
            .eq("entity_type", "store")
            .eq("entity_id", seller.store_id)
            .in("display_context", ["logo", "hero", "gallery"])
            .eq("visibility_status", "active")
            .eq("asset_status", "active")
            .eq("moderation_status", "approved")
            .order("is_featured", { ascending: false })
            .order("sort_order", { ascending: true })
            .returns<StoreMediaItem[]>(),
        ]);

      if (!isMounted) return;

      const firstError =
        defaultsResult.error ??
        pickupOptionsResult.error ??
        deliveryOptionsResult.error ??
        mediaResult.error;

      if (firstError) {
        setLoadError(firstError.message);
        setIsLoading(false);
        return;
      }

      const defaults = defaultsResult.data;
      const nextForm = buildInitialForm(seller, defaults);
      const nextPickupOptions = (pickupOptionsResult.data ?? []).map(
        toPickupOptionDraft,
      );
      const nextDeliveryOptions = (deliveryOptionsResult.data ?? []).map(
        toDeliveryOptionDraft,
      );

      setForm(nextForm);
      setInitialForm(nextForm);
      setPickupOptions(nextPickupOptions);
      setInitialPickupOptions(nextPickupOptions);
      setDeliveryOptions(nextDeliveryOptions);
      setInitialDeliveryOptions(nextDeliveryOptions);
      setDeliveryValidationMessage(null);
      setStoreMediaItems(sortStoreMedia(mediaResult.data ?? []));
      setInitialStoreMediaItems(sortStoreMedia(mediaResult.data ?? []));
      setReadinessItems(
        readinessResult.error
          ? []
          : ((readinessResult.data ?? []) as LaunchReadinessItem[]),
      );
      setReadinessError(readinessResult.error?.message ?? null);
      setIsLoading(false);
    }

    void loadStoreAdmin();

    return () => {
      isMounted = false;
    };
  }, [seller]);

  const storeUrl = useMemo(
    () =>
      typeof window === "undefined"
        ? `/store/${form.store_slug}`
        : `${window.location.origin}/store/${form.store_slug}`,
    [form.store_slug],
  );

  const hasUnsavedChanges = useMemo(
    () =>
      JSON.stringify(form) !== JSON.stringify(initialForm) ||
      JSON.stringify(normalizePickupOptionDrafts(pickupOptions)) !==
        JSON.stringify(normalizePickupOptionDrafts(initialPickupOptions)) ||
      JSON.stringify(normalizeDeliveryOptionDrafts(deliveryOptions)) !==
        JSON.stringify(normalizeDeliveryOptionDrafts(initialDeliveryOptions)) ||
      JSON.stringify(toMediaDirtySignature(storeMediaItems)) !==
        JSON.stringify(toMediaDirtySignature(initialStoreMediaItems)),
    [
      form,
      deliveryOptions,
      initialForm,
      initialDeliveryOptions,
      initialPickupOptions,
      initialStoreMediaItems,
      pickupOptions,
      storeMediaItems,
    ],
  );

  const openUnsavedNavigationDialog = useCallback((nextUrl: string) => {
    setPendingNavigationUrl(nextUrl);
  }, [setPendingNavigationUrl]);

  useUnsavedWarning(hasUnsavedChanges, openUnsavedNavigationDialog);

  function updateField<TKey extends keyof StoreAdminForm>(
    key: TKey,
    value: StoreAdminForm[TKey],
  ) {
    setSaveState("idle");
    setSaveMessage(null);
    if (key === "delivery_enabled") setDeliveryValidationMessage(null);
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateDeliveryOptions(nextOptions: DeliveryOptionDraft[]) {
    setSaveState("idle");
    setSaveMessage(null);
    setDeliveryValidationMessage(null);
    setDeliveryOptions(nextOptions);
  }

  async function reloadStoreMedia() {
    if (!seller) return;

    const result = await loadStoreMediaItems();

    if (result.ok) {
      setStoreMediaItems(result.mediaItems);
      return;
    }

    setMediaError(result.message);
  }

  async function loadStoreMediaItems(): Promise<
    | { ok: true; mediaItems: StoreMediaItem[] }
    | { ok: false; message: string }
  > {
    if (!seller) {
      return { ok: true, mediaItems: [] };
    }

    const { data, error } = await supabase
      .from("seller_media_management")
      .select(STORE_MEDIA_SELECT)
      .eq("store_id", seller.store_id)
      .eq("entity_type", "store")
      .eq("entity_id", seller.store_id)
      .in("display_context", ["logo", "hero", "gallery"])
      .eq("visibility_status", "active")
      .eq("asset_status", "active")
      .eq("moderation_status", "approved")
      .order("is_featured", { ascending: false })
      .order("sort_order", { ascending: true })
      .returns<StoreMediaItem[]>();

    if (error) {
      return { ok: false, message: error.message };
    }

    return { ok: true, mediaItems: sortStoreMedia(data ?? []) };
  }

  async function uploadStoreMedia(role: StoreMediaRole, files: FileList | null) {
    if (!seller || !files || files.length === 0) return;

    const file = files[0];
    const validationError = validateStoreMediaFile(file);

    setMediaError(null);

    if (validationError) {
      setMediaError(validationError);
      return;
    }

    if (role === "hero") {
      const previewUrl = URL.createObjectURL(file);
      const draftMedia: StoreMediaItem = {
        media_asset_id: `draft-asset-${crypto.randomUUID()}`,
        media_link_id: `draft-link-${crypto.randomUUID()}`,
        store_id: seller.store_id,
        entity_type: "store",
        entity_id: seller.store_id,
        display_context: "hero",
        public_url: previewUrl,
        alt_text: `${form.store_name || seller.store_name} farm photo`,
        caption: null,
        sort_order: 0,
        is_featured: true,
        crop_metadata: null,
        moderation_status: "approved",
        asset_status: "active",
        visibility_status: "active",
        original_filename: file.name,
        content_type: file.type,
        file_size_bytes: file.size,
        width_px: null,
        height_px: null,
        hero_layout: getStoreMediaByRole(storeMediaItems, "hero")?.hero_layout ?? "full",
        draft_file: file,
        draft_status: "new",
        preview_url: previewUrl,
      };
      const draftWithCrop = {
        ...draftMedia,
        crop_metadata: buildHeroInitialCrop(draftMedia),
      };

      setSaveState("idle");
      setSaveMessage(null);
      setStoreMediaItems((current) =>
        sortStoreMedia([
          ...current.filter((item) => item.display_context !== "hero"),
          draftWithCrop,
        ]),
      );
      return;
    }

    setIsMediaUploading(role);

    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;

    if (sessionError || !accessToken) {
      setMediaError("Please sign in again and try uploading the photo.");
      setIsMediaUploading(null);
      return;
    }

    const displayContext = role === "about" ? "gallery" : role;
    const replacedMediaItems = storeMediaItems.filter(
      (item) =>
        item.display_context === displayContext &&
        item.visibility_status === "active",
    );
    const formData = new FormData();
    formData.append("file", file);
    formData.append("store_id", seller.store_id);
    formData.append("entity_type", "store");
    formData.append("entity_id", seller.store_id);
    formData.append("display_context", displayContext);
    formData.append("sort_order", "0");
    formData.append("is_featured", String(role !== "about"));
    formData.append(
      "alt_text",
      role === "logo"
        ? `${form.store_name || seller.store_name} logo`
        : `${form.store_name || seller.store_name} farm photo`,
    );

    const { data, error: uploadError } =
      await supabase.functions.invoke<UploadResponse>("seller-media-upload", {
        body: formData,
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

    if (uploadError || data?.error || !data?.media) {
      setMediaError(
        data?.error?.message || uploadError?.message || "Photo upload failed.",
      );
      setIsMediaUploading(null);
      return;
    }

    const uploadedMedia = data.media as StoreMediaItem;
    const mediaWithCrop =
      role === "about"
        ? {
            ...uploadedMedia,
            crop_metadata: buildAboutInitialCrop(uploadedMedia),
          }
        : uploadedMedia;

    if (role === "about") {
      const cropResult = await persistMediaCrop(
        uploadedMedia.media_link_id,
        mediaWithCrop.crop_metadata ?? null,
        "The photo position",
      );

      if (!cropResult.ok) {
        setMediaError(cropResult.message);
      }
    }

    const archiveError = await archiveReplacedStoreMedia(
      replacedMediaItems,
      uploadedMedia.media_link_id,
    );

    if (archiveError) {
      setMediaError(archiveError);
    }

    setStoreMediaItems((current) =>
      sortStoreMedia([
        ...current.filter((item) =>
          role === "about"
            ? item.display_context !== "gallery"
            : item.display_context !== role,
        ),
        mediaWithCrop,
      ]),
    );
    setIsMediaUploading(null);
    void reloadStoreMedia();
  }

  async function archiveReplacedStoreMedia(
    replacedMediaItems: StoreMediaItem[],
    uploadedMediaLinkId: string,
  ) {
    for (const item of replacedMediaItems) {
      if (item.media_link_id === uploadedMediaLinkId) continue;

      const { error } = await supabase.rpc("seller_archive_media_link", {
        p_media_link_id: item.media_link_id,
      });

      if (error) {
        return "The previous photo was not replaced. Please try removing it and uploading again.";
      }
    }

    return null;
  }

  async function selectHeroLibraryImage(image: HeroLibraryImage) {
    if (!seller) return;

    setMediaError(null);
    setSaveState("idle");
    setSaveMessage(null);

    const currentHero = getStoreMediaByRole(storeMediaItems, "hero");
    const draftMedia: StoreMediaItem = {
      media_asset_id: `draft-asset-${crypto.randomUUID()}`,
      media_link_id: `draft-link-${crypto.randomUUID()}`,
      store_id: seller?.store_id ?? "",
      entity_type: "store",
      entity_id: seller?.store_id ?? "",
      display_context: "hero",
      public_url: image.path,
      alt_text: `${form.store_name || seller?.store_name || "Store"} farm hero image`,
      caption: null,
      sort_order: 0,
      is_featured: true,
      crop_metadata: null,
      moderation_status: "approved",
      asset_status: "active",
      visibility_status: "active",
      original_filename: image.path.split("/").at(-1) ?? null,
      content_type: "image/png",
      file_size_bytes: 0,
      width_px: null,
      height_px: null,
      source_type: "storefront_hero_library",
      source_image_url: image.path,
      hero_layout: currentHero?.hero_layout ?? "full",
      draft_status: "new",
    };
    const draftWithCrop = {
      ...draftMedia,
      crop_metadata: buildHeroInitialCrop(draftMedia),
    };

    setStoreMediaItems((current) =>
      sortStoreMedia([
        ...current.filter((item) => item.display_context !== "hero"),
        draftWithCrop,
      ]),
    );
  }

  async function removeStoreMedia(item: StoreMediaItem | null) {
    if (!item) return;

    setMediaError(null);

    if (item.display_context === "hero") {
      setSaveState("idle");
      setSaveMessage(null);
      setStoreMediaItems((current) =>
        sortStoreMedia(
          current.map((media) =>
            media.media_link_id === item.media_link_id
              ? { ...media, draft_status: "remove" }
              : media,
          ),
        ),
      );
      return;
    }

    const { error } = await supabase.rpc("seller_archive_media_link", {
      p_media_link_id: item.media_link_id,
    });

    if (error) {
      setMediaError("The photo was not removed. Please try again.");
      return;
    }

    setStoreMediaItems((current) =>
      current.filter((media) => media.media_link_id !== item.media_link_id),
    );
    void reloadStoreMedia();
  }

  function saveHeroCrop(crop: PhotoCropMetadata | null) {
    const hero = getStoreMediaByRole(storeMediaItems, "hero");

    if (!hero) return;

    setSaveState("idle");
    setSaveMessage(null);
    setStoreMediaItems((current) =>
      current.map((item) =>
        item.media_link_id === hero.media_link_id
          ? { ...item, crop_metadata: crop }
          : item,
      ),
    );
  }

  function saveAboutCrop(crop: PhotoCropMetadata | null) {
    const about = getStoreMediaByRole(storeMediaItems, "about");

    if (!about) return;

    setSaveState("idle");
    setSaveMessage(null);
    setStoreMediaItems((current) =>
      current.map((item) =>
        item.media_link_id === about.media_link_id
          ? { ...item, crop_metadata: crop }
          : item,
      ),
    );
  }

  function saveHeroLayout(layout: HeroLayout) {
    const hero = getStoreMediaByRole(storeMediaItems, "hero");

    if (!hero) return;

    setSaveState("idle");
    setSaveMessage(null);
    setStoreMediaItems((current) =>
      current.map((item) =>
        item.media_link_id === hero.media_link_id
          ? { ...item, hero_layout: layout }
          : item,
      ),
    );
  }

  async function saveStoreMediaChanges(): Promise<
    | { ok: true; mediaItems: StoreMediaItem[] }
    | { ok: false; message: string }
  > {
    const initialHero = getStoreMediaByRole(initialStoreMediaItems, "hero");
    const currentHero = findStoreMediaByContext(storeMediaItems, "hero");
    const initialAbout = getStoreMediaByRole(initialStoreMediaItems, "about");
    const currentAbout = findStoreMediaByContext(storeMediaItems, "gallery");

    if (currentHero?.draft_status === "remove") {
      if (initialHero) {
        const { error } = await supabase.rpc("seller_archive_media_link", {
          p_media_link_id: initialHero.media_link_id,
        });

        if (error) {
          return {
            ok: false,
            message: "The hero image was not removed. Please try again.",
          };
        }
      }
    } else if (currentHero?.draft_status === "new") {
      const savedHero = currentHero.draft_file
        ? await uploadDraftHeroMedia(currentHero)
        : await selectDraftHeroLibraryImage(currentHero);

      if (!savedHero.ok) return savedHero;

      const cropResult = await persistMediaCrop(
        savedHero.media.media_link_id,
        currentHero.crop_metadata ?? buildHeroInitialCrop(currentHero),
        "The hero image position",
      );

      if (!cropResult.ok) return cropResult;

      const layoutResult = await persistHeroLayout(
        savedHero.media.media_link_id,
        normalizeHeroLayout(currentHero.hero_layout),
      );

      if (!layoutResult.ok) return layoutResult;
    } else if (currentHero && initialHero) {
      if (
        JSON.stringify(normalizeCrop(currentHero.crop_metadata)) !==
        JSON.stringify(normalizeCrop(initialHero.crop_metadata))
      ) {
        const cropResult = await persistMediaCrop(
          currentHero.media_link_id,
          currentHero.crop_metadata ?? null,
          "The hero image position",
        );

        if (!cropResult.ok) return cropResult;
      }

      if (
        normalizeHeroLayout(currentHero.hero_layout) !==
        normalizeHeroLayout(initialHero.hero_layout)
      ) {
        const layoutResult = await persistHeroLayout(
          currentHero.media_link_id,
          normalizeHeroLayout(currentHero.hero_layout),
        );

        if (!layoutResult.ok) return layoutResult;
      }
    }

    if (
      currentAbout &&
      initialAbout &&
      JSON.stringify(normalizeCrop(currentAbout.crop_metadata)) !==
        JSON.stringify(normalizeCrop(initialAbout.crop_metadata))
    ) {
      const cropResult = await persistMediaCrop(
        currentAbout.media_link_id,
        currentAbout.crop_metadata ?? null,
        "The About photo position",
      );

      if (!cropResult.ok) return cropResult;
    }

    const refreshedMedia = await loadStoreMediaItems();

    if (!refreshedMedia.ok) return refreshedMedia;

    return { ok: true, mediaItems: refreshedMedia.mediaItems };
  }

  async function uploadDraftHeroMedia(media: StoreMediaItem): Promise<
    | { ok: true; media: StoreMediaItem }
    | { ok: false; message: string }
  > {
    if (!seller || !media.draft_file) {
      return { ok: false, message: "The hero image was not ready to upload." };
    }

    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;

    if (sessionError || !accessToken) {
      return {
        ok: false,
        message: "Please sign in again and try uploading the photo.",
      };
    }

    const formData = new FormData();
    formData.append("file", media.draft_file);
    formData.append("store_id", seller.store_id);
    formData.append("entity_type", "store");
    formData.append("entity_id", seller.store_id);
    formData.append("display_context", "hero");
    formData.append("sort_order", "0");
    formData.append("is_featured", "true");
    formData.append(
      "alt_text",
      media.alt_text ?? `${form.store_name || seller.store_name} farm photo`,
    );

    const { data, error } =
      await supabase.functions.invoke<UploadResponse>("seller-media-upload", {
        body: formData,
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

    if (error || data?.error || !data?.media) {
      return {
        ok: false,
        message: data?.error?.message || error?.message || "Photo upload failed.",
      };
    }

    return { ok: true, media: data.media as StoreMediaItem };
  }

  async function selectDraftHeroLibraryImage(media: StoreMediaItem): Promise<
    | { ok: true; media: StoreMediaItem }
    | { ok: false; message: string }
  > {
    if (!seller || !media.source_image_url) {
      return { ok: false, message: "The stock hero image was not ready to save." };
    }

    const { data, error } = await supabase.rpc("seller_select_store_hero_library", {
      p_store_id: seller.store_id,
      p_source_image_url: media.source_image_url,
      p_alt_text:
        media.alt_text ?? `${form.store_name || seller.store_name} farm hero image`,
    });

    if (error) {
      return {
        ok: false,
        message: "The stock hero image was not saved. Please try again.",
      };
    }

    const selected = Array.isArray(data)
      ? (data[0] as StoreMediaItem | undefined)
      : (data as StoreMediaItem | null);

    if (!selected) {
      return {
        ok: false,
        message: "The stock hero image was not saved. Please try again.",
      };
    }

    return { ok: true, media: selected };
  }

  async function persistMediaCrop(
    mediaLinkId: string,
    crop: PhotoCropMetadata | null,
    label = "The photo position",
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const { error } = await supabase.rpc("seller_update_media_crop", {
      p_crop_metadata: crop,
      p_media_link_id: mediaLinkId,
    });

    if (error) {
      return {
        ok: false,
        message: `${label} was not saved. Please try again.`,
      };
    }

    return { ok: true };
  }

  async function persistHeroLayout(
    mediaLinkId: string,
    layout: HeroLayout,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const { error } = await supabase.rpc("seller_update_store_hero_layout", {
      p_hero_layout: layout,
      p_media_link_id: mediaLinkId,
    });

    if (error) {
      return {
        ok: false,
        message: "The hero image layout was not saved. Please try again.",
      };
    }

    return { ok: true };
  }

  function addCustomPolicy() {
    if (form.custom_policies.length >= 4) return;

    updateField("custom_policies", [
      ...form.custom_policies,
      {
        id: `custom-policy-${crypto.randomUUID()}`,
        title: "",
        body: "",
      },
    ]);
  }

  function updateCustomPolicy(
    policyId: string,
    updates: Partial<CustomPolicyDraft>,
  ) {
    updateField(
      "custom_policies",
      form.custom_policies.map((policy) =>
        policy.id === policyId ? { ...policy, ...updates } : policy,
      ),
    );
  }

  function removeCustomPolicy(policyId: string) {
    updateField(
      "custom_policies",
      form.custom_policies.filter((policy) => policy.id !== policyId),
    );
  }

  function reorderCustomPolicyToTarget(policyId: string, targetId: string) {
    setSaveState("idle");
    setSaveMessage(null);
    setForm((current) => {
      const fromIndex = current.custom_policies.findIndex(
        (policy) => policy.id === policyId,
      );
      const toIndex = current.custom_policies.findIndex(
        (policy) => policy.id === targetId,
      );

      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
        return current;
      }

      const nextPolicies = [...current.custom_policies];
      const [movedPolicy] = nextPolicies.splice(fromIndex, 1);
      nextPolicies.splice(toIndex, 0, movedPolicy);

      return {
        ...current,
        custom_policies: nextPolicies,
      };
    });
  }

  function beginCustomPolicyDrag(
    policyId: string,
    event: React.PointerEvent<HTMLButtonElement>,
  ) {
    const row = customPolicyRowRefs.current.get(policyId);
    const rect = row?.getBoundingClientRect();
    const policy = form.custom_policies.find((item) => item.id === policyId);

    event.currentTarget.setPointerCapture(event.pointerId);
    customPolicyDragChangedRef.current = false;
    setCustomPolicyDragPreview({
      label: policy?.title.trim() || "Custom policy",
      width: Math.min(rect?.width ?? 300, 560),
      x: event.clientX + 12,
      y: event.clientY + 12,
    });
    setDraggingCustomPolicyId(policyId);
  }

  function moveCustomPolicyDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (!draggingCustomPolicyId) return;

    setCustomPolicyDragPreview((current) =>
      current
        ? {
            ...current,
            x: event.clientX + 12,
            y: event.clientY + 12,
          }
        : current,
    );

    const targetId = findCustomPolicyIdAtPoint(event.clientX, event.clientY);

    if (!targetId || targetId === draggingCustomPolicyId) return;

    customPolicyDragChangedRef.current = true;
    reorderCustomPolicyToTarget(draggingCustomPolicyId, targetId);
  }

  function endCustomPolicyDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (!draggingCustomPolicyId) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (customPolicyDragChangedRef.current) {
      setSaveState("idle");
      setSaveMessage(null);
    }

    customPolicyDragChangedRef.current = false;
    setCustomPolicyDragPreview(null);
    setDraggingCustomPolicyId(null);
  }

  function findCustomPolicyIdAtPoint(clientX: number, clientY: number) {
    for (const policy of form.custom_policies) {
      const row = customPolicyRowRefs.current.get(policy.id);
      if (!row) continue;

      const rect = row.getBoundingClientRect();

      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        return policy.id;
      }
    }

    return null;
  }

  function registerCustomPolicyRow(
    policyId: string,
    element: HTMLElement | null,
  ) {
    if (element) {
      customPolicyRowRefs.current.set(policyId, element);
    } else {
      customPolicyRowRefs.current.delete(policyId);
    }
  }

  function updateModulePreference(
    field: ModulePreferenceField,
    value: boolean,
  ) {
    if (!value && form[field]) {
      const warningByField: Record<
        ModulePreferenceField,
        { message: string; title: string }
      > = {
        hatching_eggs_enabled: {
          message:
            "Turning off Hatching Eggs will hide hatching egg listings from your public storefront. Your inventory will be saved, and you can turn this back on later.",
          title: "Turn off Hatching Eggs?",
        },
        processed_poultry_enabled: {
          message:
            "Turning off Processed Poultry will hide processed poultry items from your public storefront. Your inventory will be saved, and you can turn this back on later.",
          title: "Turn off Processed Poultry?",
        },
        equipment_supplies_enabled: {
          message:
            "Turning off Equipment & Supplies will hide those items from your public storefront. Your inventory will be saved, and you can turn this back on later.",
          title: "Turn off Equipment & Supplies?",
        },
      };

      setModuleDisableDialog({
        field,
        ...warningByField[field],
      });
      return;
    }

    updateField(field, value);
  }

  function confirmModuleDisable() {
    if (!moduleDisableDialog) return;

    updateField(moduleDisableDialog.field, false);
    setModuleDisableDialog(null);
  }

  function continuePendingNavigation() {
    if (!pendingNavigationUrl) return;

    window.location.href = pendingNavigationUrl;
  }

  function updatePickupOption(
    optionId: string,
    updates: Partial<PickupOptionDraft>,
  ) {
    setSaveState("idle");
    setSaveMessage(null);
    setPickupOptions((current) =>
      current.map((option) =>
        option.id === optionId ? { ...option, ...updates } : option,
      ),
    );
  }

  function sortPickupOptions(options: PickupOptionDraft[]) {
    return [...options].sort(
      (first, second) =>
        (first.sort_order ?? 0) - (second.sort_order ?? 0) ||
        first.label.localeCompare(second.label),
    );
  }

  function getVisiblePickupOptions(options: PickupOptionDraft[]) {
    return sortPickupOptions(options).filter((option) => option.is_active);
  }

  function normalizePickupOptionsForSave(options: PickupOptionDraft[]) {
    const visibleOptions = getVisiblePickupOptions(options);
    const visibleSortOrderById = new Map(
      visibleOptions.map((option, index) => [option.id, index]),
    );
    let inactiveSortOrder = visibleOptions.length;

    return sortPickupOptions(options).map((option) => {
      if (option.is_active) {
        return {
          ...option,
          sort_order: visibleSortOrderById.get(option.id) ?? option.sort_order,
        };
      }

      const sortOrder = inactiveSortOrder;
      inactiveSortOrder += 1;

      return {
        ...option,
        sort_order: sortOrder,
      };
    });
  }

  function removePickupOption(optionId: string) {
    setSaveState("idle");
    setSaveMessage(null);
    setPickupOptions((current) =>
      current
        .filter((option) => !(option.id === optionId && option.isNew))
        .map((option) =>
          option.id === optionId ? { ...option, is_active: false } : option,
        ),
    );
    if (form.default_pickup_option_id === optionId) {
      updateField("default_pickup_option_id", "");
    }
  }

  function reorderPickupOptions(orderedIds: string[]) {
    setSaveState("idle");
    setSaveMessage(null);
    setPickupOptions((current) => {
      const sortOrderById = new Map(
        orderedIds.map((optionId, index) => [optionId, index]),
      );
      const nextInactiveSortOrder = orderedIds.length;

      return sortPickupOptions(
        current.map((option) => ({
          ...option,
          sort_order: option.is_active
            ? (sortOrderById.get(option.id) ?? option.sort_order)
            : Math.max(option.sort_order, nextInactiveSortOrder),
        })),
      );
    });
  }

  function addPickupOption() {
    const tempId = `new-${crypto.randomUUID()}`;

    pendingPickupOptionFocusId.current = tempId;
    setSaveState("idle");
    setSaveMessage(null);
    setPickupOptions((current) => [
      ...current,
      {
        id: tempId,
        label: "",
        description: "",
        sort_order: getVisiblePickupOptions(current).length,
        is_active: true,
        isNew: true,
      },
    ]);
  }

  function handlePickupOptionInputRef(
    optionId: string,
    element: HTMLInputElement | null,
  ) {
    if (!element || pendingPickupOptionFocusId.current !== optionId) return;

    element.focus();
    pendingPickupOptionFocusId.current = null;
  }

  function discardChanges() {
    setForm(initialForm);
    setPickupOptions(initialPickupOptions);
    setDeliveryOptions(initialDeliveryOptions);
    setStoreMediaItems(initialStoreMediaItems);
    pendingPickupOptionFocusId.current = null;
    setDeliveryValidationMessage(null);
    setSaveState("idle");
    setSaveMessage("Changes discarded.");
  }

  function restoreDefaultStory() {
    const hasCustomStory =
      form.about_text.trim() &&
      form.about_text.trim() !== normalizedStarterFarmDescription.trim();

    if (
      hasCustomStory &&
      !window.confirm("Replace your current farm story with the default story?")
    ) {
      return;
    }

    updateField("about_text", normalizedStarterFarmDescription);
  }

  function restoreDefaultPickupPolicy() {
    const hasCustomPolicy =
      form.pickup_policy.trim() &&
      form.pickup_policy.trim() !== defaultPickupPolicy.trim();

    if (
      hasCustomPolicy &&
      !window.confirm(
        "Replace your current pickup policy with the default pickup policy?",
      )
    ) {
      return;
    }

    updateField("pickup_policy", defaultPickupPolicy);
  }

  async function reloadReadiness() {
    if (!seller) return;

    setIsReadinessLoading(true);
    setReadinessError(null);

    const { data, error } = await supabase.rpc(
      "seller_get_store_launch_readiness",
      {
        p_store_id: seller.store_id,
      },
    );

    if (error) {
      setReadinessItems([]);
      setReadinessError(error.message);
    } else {
      setReadinessItems((data ?? []) as LaunchReadinessItem[]);
    }

    setIsReadinessLoading(false);
  }

  async function saveChanges() {
    if (!seller) return;

    const validationMessage = validateForm(form, pickupOptions, activeTab);
    const nextDeliveryValidationMessage = validateDeliveryOptions(
      deliveryOptions,
    );

    if (validationMessage || nextDeliveryValidationMessage) {
      setSaveState("error");
      setDeliveryValidationMessage(nextDeliveryValidationMessage);
      setSaveMessage(validationMessage ?? nextDeliveryValidationMessage);
      return;
    }

    setIsSaving(true);
    setSaveState("idle");
    setSaveMessage(null);

    const idMap = new Map<string, string>();
    const persistedOptions: PickupOptionDraft[] = [];
    const persistedDeliveryOptions: DeliveryOptionDraft[] = [];
    const normalizedCustomPolicies = normalizeCustomPoliciesForSave(
      form.custom_policies,
    );

    for (const option of normalizePickupOptionsForSave(pickupOptions)) {
      const normalizedOption = {
        ...option,
        label: option.label.trim(),
        description: option.description.trim(),
      };

      if (!normalizedOption.label && option.isNew) continue;

      if (option.isNew) {
        const { data, error } = await supabase.rpc(
          "seller_create_pickup_option",
          {
            p_store_id: seller.store_id,
            p_label: normalizedOption.label,
            p_description: normalizedOption.description || null,
            p_sort_order: normalizedOption.sort_order,
            p_is_active: normalizedOption.is_active,
          },
        );

        if (error) {
          setIsSaving(false);
          setSaveState("error");
          setSaveMessage(error.message);
          return;
        }

        const created = data as PickupOption;
        idMap.set(option.id, created.id);
        persistedOptions.push(toPickupOptionDraft(created));
      } else {
        const { data, error } = await supabase.rpc(
          "seller_update_pickup_option",
          {
            p_pickup_option_id: option.id,
            p_label: normalizedOption.label,
            p_description: normalizedOption.description || null,
            p_sort_order: normalizedOption.sort_order,
            p_is_active: normalizedOption.is_active,
          },
        );

        if (error) {
          setIsSaving(false);
          setSaveState("error");
          setSaveMessage(error.message);
          return;
        }

        persistedOptions.push(toPickupOptionDraft(data as PickupOption));
      }
    }

    for (const option of normalizeDeliveryOptionsForSave(deliveryOptions)) {
      const normalizedOption = {
        ...option,
        name: option.name.trim(),
        price: option.price.trim(),
      };
      const isBlankNewOption =
        option.isNew && !normalizedOption.name && !normalizedOption.price;

      if (isBlankNewOption) continue;

      const priceAmount = Number(normalizedOption.price);

      if (option.isNew) {
        const { data, error } = await supabase.rpc(
          "seller_create_delivery_option",
          {
            p_store_id: seller.store_id,
            p_name: normalizedOption.name,
            p_price_amount: priceAmount,
            p_sort_order: normalizedOption.sort_order,
            p_is_active: normalizedOption.is_active,
          },
        );

        if (error) {
          setIsSaving(false);
          setSaveState("error");
          setSaveMessage(error.message);
          return;
        }

        persistedDeliveryOptions.push(
          toDeliveryOptionDraft(data as DeliveryOption),
        );
      } else {
        const { data, error } = await supabase.rpc(
          "seller_update_delivery_option",
          {
            p_delivery_option_id: option.id,
            p_name: normalizedOption.name,
            p_price_amount: priceAmount,
            p_sort_order: normalizedOption.sort_order,
            p_is_active: normalizedOption.is_active,
          },
        );

        if (error) {
          setIsSaving(false);
          setSaveState("error");
          setSaveMessage(error.message);
          return;
        }

        persistedDeliveryOptions.push(
          toDeliveryOptionDraft(data as DeliveryOption),
        );
      }
    }

    const selectedDefaultId =
      idMap.get(form.default_pickup_option_id) ?? form.default_pickup_option_id;

    const settingsPayload = {
      store_name: form.store_name,
      store_slug: form.store_slug,
      store_tagline: form.store_tagline,
      hero_subheading: form.hero_subheading,
      storefront_font_pair: form.storefront_font_pair,
      storefront_heading_color: form.storefront_heading_color,
      storefront_text_color: form.storefront_text_color,
      storefront_top_menu_color: form.storefront_top_menu_color,
      public_city: form.public_city,
      public_state: form.public_state,
      public_country: form.public_country,
      about_text: form.about_text,
      website_url: form.website_url,
      npip_number: form.npip_number,
      show_npip: form.show_npip,
      public_email: form.public_email,
      public_phone: form.public_phone,
      show_public_email: form.show_public_email,
      show_public_phone: form.show_public_phone,
      pickup_policy: form.pickup_policy,
      cancellation_policy: form.cancellation_policy,
      other_policies: form.other_policies,
      custom_policies: normalizedCustomPolicies,
      storefront_enabled: form.storefront_enabled,
      hatching_eggs_enabled: form.hatching_eggs_enabled,
      equipment_supplies_enabled: form.equipment_supplies_enabled,
      processed_poultry_enabled: form.processed_poultry_enabled,
    };

    const defaultsPayload = {
      pickup_method: form.pickup_method,
      pickup_location_text: form.pickup_location_text,
      pickup_instructions: form.pickup_instructions,
      pickup_address_line1: form.pickup_address_line1,
      pickup_address_line2: form.pickup_address_line2,
      pickup_city: form.pickup_city,
      pickup_state: form.pickup_state,
      pickup_postal_code: form.pickup_postal_code,
      pickup_country: form.pickup_country,
      default_pickup_option_id: selectedDefaultId || null,
      communication_email: form.communication_email,
      order_notification_email: form.order_notification_email,
    };

    const settingsResult = await supabase.rpc("seller_update_store_settings", {
      p_store_id: seller.store_id,
      p_settings: settingsPayload,
    });

    if (settingsResult.error) {
      setIsSaving(false);
      setSaveState("error");
      setSaveMessage(settingsResult.error.message);
      return;
    }

    const defaultsResult = await supabase.rpc("seller_update_store_defaults", {
      p_store_id: seller.store_id,
      p_defaults: defaultsPayload,
    });

    if (defaultsResult.error) {
      setIsSaving(false);
      setSaveState("error");
      setSaveMessage(defaultsResult.error.message);
      return;
    }

    const deliveryEnabledResult = await supabase.rpc(
      "seller_update_delivery_enabled",
      {
        p_store_id: seller.store_id,
        p_delivery_enabled: form.delivery_enabled,
      },
    );

    if (deliveryEnabledResult.error) {
      setIsSaving(false);
      setSaveState("error");
      setSaveMessage(deliveryEnabledResult.error.message);
      return;
    }

    const mediaSaveResult = await saveStoreMediaChanges();

    if (!mediaSaveResult.ok) {
      setIsSaving(false);
      setSaveState("error");
      setSaveMessage(mediaSaveResult.message);
      return;
    }

    const savedForm = {
      ...form,
      store_name: form.store_name.trim(),
      store_slug: form.store_slug.trim().toLowerCase(),
      store_tagline: form.store_tagline.trim(),
      hero_subheading: form.hero_subheading.trim(),
      storefront_font_pair: normalizeStorefrontFontPair(
        form.storefront_font_pair,
      ),
      storefront_heading_color: normalizeStorefrontHexColor(
        form.storefront_heading_color,
        defaultStorefrontTheme.headingColor,
      ),
      storefront_text_color: normalizeStorefrontHexColor(
        form.storefront_text_color,
        defaultStorefrontTheme.textColor,
      ),
      storefront_top_menu_color: normalizeStorefrontHexColor(
        form.storefront_top_menu_color,
        defaultStorefrontTheme.topMenuColor,
      ),
      public_city: form.public_city.trim(),
      public_state: form.public_state.trim(),
      public_country: form.public_country.trim().toUpperCase() || "US",
      about_text: form.about_text.trim(),
      website_url: form.website_url.trim(),
      npip_number: form.npip_number.trim(),
      public_email: form.public_email.trim().toLowerCase(),
      public_phone: form.public_phone.trim(),
      communication_email: form.communication_email.trim().toLowerCase(),
      pickup_location_text: form.pickup_location_text.trim(),
      pickup_instructions: form.pickup_instructions.trim(),
      pickup_address_line1: form.pickup_address_line1.trim(),
      pickup_address_line2: form.pickup_address_line2.trim(),
      pickup_city: form.pickup_city.trim(),
      pickup_state: form.pickup_state.trim().toUpperCase(),
      pickup_postal_code: form.pickup_postal_code.trim(),
      pickup_country: form.pickup_country.trim().toUpperCase() || "US",
      default_pickup_option_id: selectedDefaultId || "",
      delivery_enabled: form.delivery_enabled,
      pickup_policy: form.pickup_policy.trim(),
      cancellation_policy: form.cancellation_policy.trim(),
      other_policies: form.other_policies.trim(),
      custom_policies: normalizedCustomPolicies.map((policy) => ({
        id: `custom-policy-${crypto.randomUUID()}`,
        ...policy,
      })),
      order_notification_email: form.order_notification_email
        .trim()
        .toLowerCase(),
      hatching_eggs_enabled: form.hatching_eggs_enabled,
      equipment_supplies_enabled: form.equipment_supplies_enabled,
      processed_poultry_enabled: form.processed_poultry_enabled,
    };
    const sortedOptions = persistedOptions.sort(
      (first, second) =>
        first.sort_order - second.sort_order ||
        first.label.localeCompare(second.label),
    );
    const sortedDeliveryOptions = sortDeliveryOptions(persistedDeliveryOptions);

    setForm(savedForm);
    setInitialForm(savedForm);
    setPickupOptions(sortedOptions);
    setInitialPickupOptions(sortedOptions);
    setDeliveryOptions(sortedDeliveryOptions);
    setInitialDeliveryOptions(sortedDeliveryOptions);
    setDeliveryValidationMessage(null);
    setStoreMediaItems(mediaSaveResult.mediaItems);
    setInitialStoreMediaItems(mediaSaveResult.mediaItems);
    setIsSaving(false);
    setSaveState("saved");
    setSaveMessage("Store Admin saved.");
    await reloadReadiness();
  }

  async function launchStore() {
    if (!seller) return;

    setSaveState("idle");
    setSaveMessage(null);

    if (hasUnsavedChanges) {
      setSaveState("error");
      setSaveMessage("Save or discard Store Admin changes before launching.");
      return;
    }

    const launchSummary = buildLaunchSummary(readinessItems, form);
    const missingRequired = launchSummary.requiredItems.filter(
      (item) => !item.passed,
    );

    if (missingRequired.length > 0 || launchSummary.platformReviewNeeded) {
      setSaveState("error");
      setSaveMessage("Complete required launch items before launching.");
      return;
    }

    const shouldLaunch = window.confirm(
      "Launch this store now? This changes the store lifecycle to live, but does not enable the public storefront.",
    );

    if (!shouldLaunch) return;

    setIsLaunching(true);

    const { data, error } = await supabase.functions.invoke<StoreLaunchResponse>(
      "seller-store-launch",
      {
        body: {
          store_id: seller.store_id,
        },
      },
    );

    if (error || data?.error) {
      setIsLaunching(false);
      setSaveState("error");
      setSaveMessage(
        data?.error?.message ??
          error?.message ??
          "The store could not be launched.",
      );
      await reloadReadiness();
      return;
    }

    setIsLaunching(false);
    setSaveState("saved");
    setSaveMessage(
      "Store launched. Use storefront visibility to decide when customers can see it.",
    );
    await reloadReadiness();
    reload();
  }

  if (isLoading) {
    return (
      <>
        <SellerPageHeader
          title="Store Setup"
          description="Manage your store setup, public details, pickup information, policies, notifications, and storefront preview."
        />
        <div className="mx-auto w-full max-w-7xl px-5 py-5 sm:px-7">
          <LoadingState label="Loading Store Setup" />
        </div>
      </>
    );
  }

  if (loadError || !seller) {
    return (
      <>
        <SellerPageHeader title="Store Setup" />
        <div className="mx-auto w-full max-w-7xl px-5 py-5 sm:px-7">
          <ErrorState
            message={loadError ?? "Store Setup could not be loaded."}
          />
        </div>
      </>
    );
  }

  const launchSummary = buildLaunchSummary(readinessItems, form);
  const sellerRequiredItems = launchSummary.requiredItems;
  const sellerWarningItems = launchSummary.warningItems;
  const platformReviewNeeded = launchSummary.platformReviewNeeded;
  const missingRequiredCount = sellerRequiredItems.filter(
    (item) => !item.passed,
  ).length;
  const launchAllowed =
    seller.store_status === "draft" &&
    missingRequiredCount === 0 &&
    !platformReviewNeeded &&
    !hasUnsavedChanges &&
    !isLaunching;
  const isStoreLive = seller.store_status === "live";
  const isVisibleToCustomers = seller.is_publicly_available;
  const previewStoreUrl = isVisibleToCustomers
    ? `/store/${form.store_slug}`
    : `/store/${form.store_slug}?preview=1`;

  return (
    <>
      <SellerPageHeader
        eyebrow={seller.store_name}
        title="Store Setup"
        description="Manage your public storefront setup, pickup flow, policies, and preview link."
        action={
          <div className="flex flex-wrap gap-2">
            <Link
              className="seller-primary-button"
              href={previewStoreUrl}
              target="_blank"
            >
              Preview Store
            </Link>
            <button
              className="seller-secondary-button"
              disabled={!hasUnsavedChanges || isSaving}
              onClick={discardChanges}
              type="button"
            >
              Discard Changes
            </button>
            <button
              className="inline-flex min-h-10 items-center justify-center rounded-md bg-stone-950 px-4 text-sm font-semibold text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-400"
              disabled={!hasUnsavedChanges || isSaving}
              onClick={saveChanges}
              type="button"
            >
              {isSaving ? "Saving..." : "Save"}
            </button>
          </div>
        }
      />

      <div
        className={`mx-auto grid w-full max-w-7xl gap-5 px-5 py-5 sm:px-7 ${
          hasUnsavedChanges ? "pb-32 sm:pb-28" : ""
        }`}
      >
        {saveMessage ? (
          <StoreSetupAlert tone={saveState === "error" ? "error" : "success"}>
            {saveMessage}
          </StoreSetupAlert>
        ) : null}

        <div className="grid gap-0">
          <StoreSetupTabs
            activeTab={activeTab}
            onChange={setActiveTab}
          />
          <div className="rounded-b-xl rounded-tr-xl border border-stone-200 bg-white p-5 shadow-sm">
            {activeTab === "storefront" ? (
              <StorefrontTab
                form={form}
                hasUnsavedChanges={hasUnsavedChanges}
                isLaunching={isLaunching}
                isReadinessLoading={isReadinessLoading}
                isStoreLive={isStoreLive}
                isVisibleToCustomers={isVisibleToCustomers}
                launchAllowed={launchAllowed}
                onLaunch={() => void launchStore()}
                onRestoreDefaultStory={() => restoreDefaultStory()}
                onUpdateField={updateField}
                platformReviewNeeded={platformReviewNeeded}
                readinessError={readinessError}
                requiredItems={sellerRequiredItems}
                sellerStatus={seller.store_status}
                storeUrl={storeUrl}
                warningItems={sellerWarningItems}
              />
            ) : null}

            {activeTab === "photos" ? (
              <PhotosTab
                aboutPhoto={getStoreMediaByRole(storeMediaItems, "about")}
                heroImage={getStoreMediaByRole(storeMediaItems, "hero")}
                isUploading={isMediaUploading}
                logo={getStoreMediaByRole(storeMediaItems, "logo")}
                mediaError={mediaError}
                onRemove={removeStoreMedia}
                onSaveAboutCrop={(crop) => void saveAboutCrop(crop)}
                onSaveHeroCrop={(crop) => void saveHeroCrop(crop)}
                onSaveHeroLayout={(layout) => void saveHeroLayout(layout)}
                onSelectHeroLibrary={(image) => void selectHeroLibraryImage(image)}
                onUpload={(role, files) => void uploadStoreMedia(role, files)}
                storeName={form.store_name || "Your farm"}
                tagline={form.store_tagline}
                heroSubheading={form.hero_subheading}
                theme={{
                  fontPair: form.storefront_font_pair,
                  headingColor: form.storefront_heading_color,
                  textColor: form.storefront_text_color,
                  topMenuColor: form.storefront_top_menu_color,
                }}
              />
            ) : null}

            {activeTab === "what-you-sell" ? (
            <SettingsSection
              description="Start with the products you sell now. You can turn on more options later if they're included in your plan."
              title="What You Sell"
            >
              <div className="grid gap-3">
                <ModuleOptionCard
                  description="Chicks, pullets, started birds, breeding groups, and other live poultry."
                  glyph="/glyphs/hen.png"
                  state="always"
                  status="Always included"
                  title="Live Birds"
                />
                <ModuleOptionCard
                  action={
                    plan.hatchingEggsEnabled ? (
                      <ModuleToggle
                        checked={form.hatching_eggs_enabled}
                        onChange={(value) =>
                          updateModulePreference("hatching_eggs_enabled", value)
                        }
                      />
                    ) : (
                      <LockedModuleAction
                        onClick={() => setLockedFeature("hatching_eggs")}
                      />
                    )
                  }
                  description="Let customers order breed-based hatching eggs for local pickup."
                  glyph="/glyphs/egg-carton.png"
                  state={
                    !plan.hatchingEggsEnabled
                      ? "locked"
                      : form.hatching_eggs_enabled
                        ? "enabled"
                        : "disabled"
                  }
                  status={
                    !plan.hatchingEggsEnabled
                      ? "Not included in your current plan."
                      : undefined
                  }
                  title="Hatching Eggs"
                />
                <ModuleOptionCard
                  action={
                    plan.processedPoultryEnabled ? (
                      <ModuleToggle
                        checked={form.processed_poultry_enabled}
                        onChange={(value) =>
                          updateModulePreference(
                            "processed_poultry_enabled",
                            value,
                          )
                        }
                      />
                    ) : (
                      <LockedModuleAction
                        onClick={() => setLockedFeature("processed_poultry")}
                      />
                    )
                  }
                  description="Sell simple local-pickup poultry products by item, quantity, and price."
                  glyph="/glyphs/chicken-leg.png"
                  state={
                    !plan.processedPoultryEnabled
                      ? "locked"
                      : form.processed_poultry_enabled
                        ? "enabled"
                        : "disabled"
                  }
                  status={
                    !plan.processedPoultryEnabled
                      ? "Not included in your current plan."
                      : undefined
                  }
                  title="Processed Poultry"
                />
                <ModuleOptionCard
                  action={
                    plan.equipmentSuppliesEnabled ? (
                      <ModuleToggle
                        checked={form.equipment_supplies_enabled}
                        onChange={(value) =>
                          updateModulePreference(
                            "equipment_supplies_enabled",
                            value,
                          )
                        }
                      />
                    ) : (
                      <LockedModuleAction
                        onClick={() => setLockedFeature("equipment_supplies")}
                      />
                    )
                  }
                  description="Sell basic farm equipment, supplies, and reusable farm items."
                  glyph="/glyphs/incubator.png"
                  state={
                    !plan.equipmentSuppliesEnabled
                      ? "locked"
                      : form.equipment_supplies_enabled
                        ? "enabled"
                        : "disabled"
                  }
                  status={
                    !plan.equipmentSuppliesEnabled
                      ? "Not included in your current plan."
                      : undefined
                  }
                  title="Equipment & Supplies"
                />
              </div>
              <p className="rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-2 text-xs font-medium leading-5 text-emerald-900">
                You can change these anytime. Updates may take a few minutes to
                appear on your storefront.
              </p>
            </SettingsSection>
            ) : null}

            {activeTab === "pickup" ? (
              <DynamicPickupDeliveryTab
                AccordionSection={StoreSetupAccordionSection}
                StorefrontNote={StorefrontNote}
                TextField={TextField}
                deliveryOptions={deliveryOptions}
                deliveryValidationMessage={deliveryValidationMessage}
                form={form}
                getVisibleDeliveryOptions={getVisibleDeliveryOptions}
                getVisiblePickupOptions={getVisiblePickupOptions}
                handlePickupOptionInputRef={handlePickupOptionInputRef}
                onAddPickupOption={addPickupOption}
                onDeliveryEnabledChange={(enabled) =>
                  updateField("delivery_enabled", enabled)
                }
                onDeliveryOptionsChange={updateDeliveryOptions}
                onPickupAddressFieldChange={updateField}
                onPickupLocationTextChange={(value) =>
                  updateField("pickup_location_text", value)
                }
                onPickupMethodChange={(method) =>
                  updateField("pickup_method", method)
                }
                onPickupOptionLabelChange={(optionId, label) =>
                  updatePickupOption(optionId, { label })
                }
                onRemovePickupOption={removePickupOption}
                onReorderPickupOptions={reorderPickupOptions}
                pickupOptions={pickupOptions}
              />
            ) : null}

            {activeTab === "policies" ? (
              <DynamicPoliciesTab
                AccordionSection={StoreSetupAccordionSection}
                StorefrontNote={StorefrontNote}
                TextAreaField={TextAreaField}
                customPolicyDragPreview={customPolicyDragPreview}
                customPolicies={form.custom_policies}
                draggingCustomPolicyId={draggingCustomPolicyId}
                onAddCustomPolicy={addCustomPolicy}
                onBeginCustomPolicyDrag={beginCustomPolicyDrag}
                onEndCustomPolicyDrag={endCustomPolicyDrag}
                onMoveCustomPolicyDrag={moveCustomPolicyDrag}
                onPickupPolicyChange={(value) =>
                  updateField("pickup_policy", value)
                }
                onRestoreDefaultPickupPolicy={restoreDefaultPickupPolicy}
                onRegisterCustomPolicyRow={registerCustomPolicyRow}
                onRemoveCustomPolicy={removeCustomPolicy}
                onUpdateCustomPolicy={updateCustomPolicy}
                pickupPolicy={form.pickup_policy}
              />
            ) : null}

          </div>
        </div>
      </div>
      {lockedFeature ? (
        <PlanUpgradeDialog
          feature={lockedFeature}
          onClose={() => setLockedFeature(null)}
        />
      ) : null}
      {moduleDisableDialog ? (
        <ModuleDisableDialog
          message={moduleDisableDialog.message}
          onCancel={() => setModuleDisableDialog(null)}
          onConfirm={confirmModuleDisable}
          title={moduleDisableDialog.title}
        />
      ) : null}
      {pendingNavigationUrl ? (
        <UnsavedChangesDialog
          onCancel={() => setPendingNavigationUrl(null)}
          onConfirm={continuePendingNavigation}
        />
      ) : null}
      {hasUnsavedChanges ? (
        <StickySaveBar
          isSaving={isSaving}
          onDiscard={discardChanges}
          onSave={saveChanges}
        />
      ) : null}
    </>
  );
}

function StoreSetupTabs({
  activeTab,
  onChange,
}: {
  activeTab: StoreSetupTab;
  onChange: (tab: StoreSetupTab) => void;
}) {
  return (
    <div
      aria-label="Store setup sections"
      className="flex gap-1 overflow-x-auto border-b border-stone-200 pl-px [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="tablist"
    >
      {storeSetupTabs.map((tab) => {
        const isActive = activeTab === tab.id;

        return (
          <button
            aria-selected={isActive}
            className={`relative mb-[-1px] min-h-11 shrink-0 rounded-t-lg border px-4 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-inset focus:ring-emerald-700 ${
              isActive
                ? "border-stone-200 border-b-white bg-white text-stone-950 shadow-[0_-1px_0_rgba(0,0,0,0.02)]"
                : "border-transparent bg-stone-100/70 text-stone-600 hover:bg-white hover:text-stone-950"
            }`}
            key={tab.id}
            onClick={() => onChange(tab.id)}
            role="tab"
            type="button"
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function StoreSetupAlert({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "error" | "success" | "warning";
}) {
  const toneClass =
    tone === "error"
      ? "border-red-200 bg-red-50 text-red-800"
      : tone === "success"
        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
        : "border-amber-200 bg-amber-50 text-amber-900";

  return (
    <div className={`rounded-lg border px-4 py-3 text-sm font-semibold ${toneClass}`}>
      {children}
    </div>
  );
}

function StickySaveBar({
  isSaving,
  onDiscard,
  onSave,
}: {
  isSaving: boolean;
  onDiscard: () => void;
  onSave: () => void;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-amber-200 bg-white/95 px-4 py-3 shadow-[0_-12px_30px_rgba(41,37,36,0.12)] backdrop-blur sm:px-7">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-semibold text-stone-900">
          You have unsaved changes.
        </p>
        <div className="grid gap-2 sm:flex sm:items-center">
          <button
            className="seller-secondary-button bg-white"
            disabled={isSaving}
            onClick={onDiscard}
            type="button"
          >
            Discard
          </button>
          <button
            className="seller-primary-button"
            disabled={isSaving}
            onClick={onSave}
            type="button"
          >
            {isSaving ? "Saving..." : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function StorefrontTab({
  form,
  hasUnsavedChanges,
  isLaunching,
  isReadinessLoading,
  isStoreLive,
  isVisibleToCustomers,
  launchAllowed,
  onLaunch,
  onRestoreDefaultStory,
  onUpdateField,
  platformReviewNeeded,
  readinessError,
  requiredItems,
  sellerStatus,
  storeUrl,
  warningItems,
}: {
  form: StoreAdminForm;
  hasUnsavedChanges: boolean;
  isLaunching: boolean;
  isReadinessLoading: boolean;
  isStoreLive: boolean;
  isVisibleToCustomers: boolean;
  launchAllowed: boolean;
  onLaunch: () => void;
  onRestoreDefaultStory: () => void;
  onUpdateField: StoreAdminFieldUpdater;
  platformReviewNeeded: boolean;
  readinessError: string | null;
  requiredItems: SellerLaunchItem[];
  sellerStatus: string;
  storeUrl: string;
  warningItems: SellerLaunchItem[];
}) {
  const contactEmail = getStorefrontContactEmail(form);
  const selectedStorefrontVisible = Boolean(form.storefront_enabled);
  const hasPendingVisibilityChange =
    isStoreLive && selectedStorefrontVisible !== isVisibleToCustomers;
  const [openSection, setOpenSection] =
    useState<StorefrontAccordionId | "none">("none");
  const [showHeroExamples, setShowHeroExamples] = useState(false);
  const selectedFontPair = getStorefrontFontPair(form.storefront_font_pair);
  const aboutCharacterCount = form.about_text.length;
  const hasAboutText = form.about_text.trim().length > 0;
  const isStorefrontLiveForCustomers = isStoreLive && selectedStorefrontVisible;
  const statusSummary = isStoreLive
    ? selectedStorefrontVisible
      ? "Storefront is live · Customers can view your store and place orders."
      : "Storefront is hidden · Customers cannot view your store or place orders."
    : "Storefront is not live · Complete launch requirements before customers can view it.";

  return (
    <div className="grid gap-3">
      <StoreSetupAccordionSection
        glyph="/glyphs/checkmark.png"
        id="status"
        isOpen={openSection === "status"}
        onToggle={(id) => setOpenSection(id as StorefrontAccordionId | "none")}
        showStatusDot
        statusDotTone={isStorefrontLiveForCustomers ? "green" : "red"}
        summary={<span className="truncate">{statusSummary}</span>}
        title="Store status"
      >
        {isStoreLive ? (
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <StorefrontStatusPanel
                hasPendingVisibilityChange={hasPendingVisibilityChange}
                isVisibleToCustomers={selectedStorefrontVisible}
              />
              <button
                className="seller-secondary-button min-w-32 rounded-md bg-white"
                onClick={() =>
                  onUpdateField("storefront_enabled", !selectedStorefrontVisible)
                }
                type="button"
              >
                {selectedStorefrontVisible ? "Hide Store" : "Show Store"}
              </button>
            </div>
            {hasPendingVisibilityChange ? (
              <StoreSetupAlert tone="warning">
                Save changes to{" "}
                {selectedStorefrontVisible ? "show" : "hide"} this store for
                customers.
              </StoreSetupAlert>
            ) : null}
            <ReadOnlyCopyField
              helper="This is how customers find your store. Your URL is created from your store name."
              label="Public store URL"
              value={storeUrl}
            />
          </div>
        ) : (
          <LaunchStoreCardContent
            hasUnsavedChanges={hasUnsavedChanges}
            isLaunching={isLaunching}
            isReadinessLoading={isReadinessLoading}
            launchAllowed={launchAllowed}
            onLaunch={onLaunch}
            platformReviewNeeded={platformReviewNeeded}
            readinessError={readinessError}
            requiredItems={requiredItems}
            sellerStatus={sellerStatus}
            warningItems={warningItems}
          />
        )}
      </StoreSetupAccordionSection>

      <StoreSetupAccordionSection
        glyph="/glyphs/storefront.png"
        id="information"
        isOpen={openSection === "information"}
        onToggle={(id) => setOpenSection(id as StorefrontAccordionId | "none")}
        summary={
          <>
            <span className="truncate">
              {form.store_name || "Store name not set"} ·{" "}
              {[form.public_city, form.public_state].filter(Boolean).join(", ") ||
                "Location not set"}
            </span>
            <span className="truncate">
              Headline: {form.store_tagline || "Not set"} · Subheading:{" "}
              {form.hero_subheading || "Not set"}
            </span>
          </>
        }
        title="Store information"
      >
        <div className="grid gap-3 md:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <TextField
            label="Store name"
            onChange={(value) => onUpdateField("store_name", value)}
            required
            value={form.store_name}
          />
          <TextField
            label="City"
            onChange={(value) => onUpdateField("public_city", value)}
            required
            value={form.public_city}
          />
          <TextField
            label="State"
            onChange={(value) => onUpdateField("public_state", value)}
            required
            value={form.public_state}
          />
        </div>
        <StorefrontNote>
          Your store URL is created automatically from your store name.
        </StorefrontNote>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <TextField
              helper="Short headline shown over your main storefront photo. Keep it brief so it fits on mobile and desktop."
              label="Hero headline"
              maxLength={heroHeadlineMaxLength}
              onChange={(value) => onUpdateField("store_tagline", value)}
              placeholder="Started pullets in western Colorado"
              required
              showCounter
              value={form.store_tagline}
            />
          </div>
          <div className="grid gap-2">
            <TextField
              helper="One short supporting line under your headline. Tell buyers what they can expect or do next."
              label="Hero subheading"
              maxLength={heroSubheadingMaxLength}
              onChange={(value) => onUpdateField("hero_subheading", value)}
              placeholder="Browse current availability and request pickup at checkout."
              required
              showCounter
              value={form.hero_subheading}
            />
          </div>
        </div>
        <div className="grid gap-2">
          <button
            className="w-fit text-sm font-semibold text-emerald-800 transition hover:text-emerald-950 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
            onClick={() => setShowHeroExamples((value) => !value)}
            type="button"
          >
            {showHeroExamples ? "Hide examples" : "View examples"}
          </button>
          {showHeroExamples ? (
            <div className="grid gap-3 rounded-md border border-stone-200 bg-stone-50/70 p-3 md:grid-cols-2">
              <FieldExamples
                examples={[
                  "Started pullets in western Colorado",
                  "Local chicks and hatching eggs",
                  "Pasture-raised poultry",
                ]}
              />
              <FieldExamples
                examples={[
                  "Local pickup in Hotchkiss with new birds added seasonally.",
                  "Healthy chicks, pullets, and hatching eggs from our family farm.",
                ]}
              />
            </div>
          ) : null}
        </div>
        <StorefrontNote>
          Preview and adjust your hero image on the{" "}
          <span className="font-bold text-emerald-900">Images tab</span>.
        </StorefrontNote>
      </StoreSetupAccordionSection>

      <StoreSetupAccordionSection
        glyph="/glyphs/open-book.png"
        id="about"
        isOpen={openSection === "about"}
        onToggle={(id) => setOpenSection(id as StorefrontAccordionId | "none")}
        summary={
          <span className="truncate">
            {aboutCharacterCount} characters ·{" "}
            {hasAboutText
              ? "About page content added"
              : "About page content empty"}
          </span>
        }
        title="About your farm"
      >
        <TextAreaField
          label="Farm story"
          maxLength={farmStoryMaxLength}
          onChange={(value) => onUpdateField("about_text", value)}
          required
          rows={6}
          showCounter
          value={form.about_text}
        />
        <div className="flex justify-end">
          <button
            className="seller-secondary-button min-w-44 rounded-md bg-white"
            type="button"
            onClick={onRestoreDefaultStory}
          >
            Restore default story
          </button>
        </div>
      </StoreSetupAccordionSection>

      <StoreSetupAccordionSection
        glyph="/glyphs/paint-palette.png"
        id="appearance"
        isOpen={openSection === "appearance"}
        onToggle={(id) => setOpenSection(id as StorefrontAccordionId | "none")}
        summary={
          <span className="truncate">
            {selectedFontPair.label} font style · Primary color:{" "}
            {form.storefront_heading_color.toUpperCase()} · Top menu color:{" "}
            {form.storefront_top_menu_color.toUpperCase()}
          </span>
        }
        title="Appearance"
      >
        <StoreAppearanceSection form={form} onUpdateField={onUpdateField} />
      </StoreSetupAccordionSection>

      <StoreSetupAccordionSection
        glyph="/glyphs/checkmark.png"
        id="business"
        isOpen={openSection === "business"}
        onToggle={(id) => setOpenSection(id as StorefrontAccordionId | "none")}
        summary={
          <span className="truncate">
            NPIP number: {form.npip_number.trim() || "Not provided"} · Contact
            email: {contactEmail}
          </span>
        }
        title="Business details"
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="grid gap-3 content-start">
            <TextField
              label="NPIP number"
              onChange={(value) => onUpdateField("npip_number", value)}
              optional
              value={form.npip_number}
            />
            <ToggleField
              checked={form.show_npip}
              label="Show NPIP number on my storefront"
              onChange={(value) => onUpdateField("show_npip", value)}
            />
            <StorefrontNote>
              NPIP is optional. Add your number if you participate in the NPIP
              program.
            </StorefrontNote>
          </div>
          <div className="grid gap-3 content-start">
            <ReadOnlyField label="Contact email" value={contactEmail} />
            <StorefrontNote>
              This email is managed from your Account page.
              <br />
              <Link className="font-bold text-emerald-900" href="/dashboard/account">
                Go to Account settings
              </Link>
            </StorefrontNote>
          </div>
        </div>
      </StoreSetupAccordionSection>
    </div>
  );
}

type StorefrontAccordionId =
  | "status"
  | "information"
  | "appearance"
  | "about"
  | "business";

type ImagesAccordionId = "logo" | "hero" | "about-photo";
type PickupDeliveryAccordionId = "pickup" | "delivery";
type PoliciesAccordionId = "pickup-policy" | "custom-policies";
type StoreSetupAccordionId =
  | StorefrontAccordionId
  | ImagesAccordionId
  | PickupDeliveryAccordionId
  | PoliciesAccordionId;

function StoreSetupAccordionSection({
  badge,
  children,
  glyph,
  id,
  isOpen,
  onToggle,
  showStatusDot = false,
  statusDotTone = "green",
  summary,
  thumbnailAlt = "",
  thumbnailSrc,
  title,
}: {
  badge?: React.ReactNode;
  children: React.ReactNode;
  glyph: string;
  id: StoreSetupAccordionId;
  isOpen: boolean;
  onToggle: (id: StoreSetupAccordionId | "none") => void;
  showStatusDot?: boolean;
  statusDotTone?: "green" | "red";
  summary: React.ReactNode;
  thumbnailAlt?: string;
  thumbnailSrc?: string | null;
  title: string;
}) {
  const panelId = `store-setup-${id}-panel`;
  const buttonId = `store-setup-${id}-button`;

  return (
    <section className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-[0_1px_2px_rgba(41,37,36,0.04)]">
      <button
        aria-controls={panelId}
        aria-expanded={isOpen}
        className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-3 text-left transition hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-emerald-700 sm:px-5"
        id={buttonId}
        onClick={() => onToggle(isOpen ? "none" : id)}
        type="button"
      >
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-50"
        >
          <Image alt="" className="object-contain" height={22} src={glyph} width={22} />
        </span>
        <span className="grid min-w-0 gap-1">
          <span className="flex min-w-0 items-center gap-3">
            {showStatusDot ? (
              <span
                className={`size-3 shrink-0 rounded-full ${
                  statusDotTone === "green" ? "bg-emerald-500" : "bg-red-500"
                }`}
              />
            ) : null}
            <span className="truncate text-base font-semibold text-stone-950">
              {title}
            </span>
            {badge ? <span className="shrink-0">{badge}</span> : null}
          </span>
          <span className="grid min-w-0 gap-0.5 text-sm font-medium leading-5 text-stone-600">
            {summary}
          </span>
        </span>
        {thumbnailSrc ? (
          <span className="relative block size-10 shrink-0 overflow-hidden rounded-md border border-stone-200 bg-stone-50 sm:size-12">
            <Image
              alt={thumbnailAlt}
              className="object-cover"
              fill
              sizes="48px"
              src={thumbnailSrc}
              unoptimized
            />
          </span>
        ) : null}
        <span
          aria-hidden="true"
          className="flex size-8 items-center justify-center text-stone-700"
        >
          <svg
            className={`size-5 transition-transform ${isOpen ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
          >
            <path
              d="M6 9l6 6 6-6"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
            />
          </svg>
        </span>
      </button>
      {isOpen ? (
        <div
          aria-labelledby={buttonId}
          className="grid gap-4 border-t border-stone-200 px-4 py-4 sm:px-5"
          id={panelId}
          role="region"
        >
          {children}
        </div>
      ) : null}
    </section>
  );
}

function StoreAppearanceSection({
  form,
  onUpdateField,
}: {
  form: StoreAdminForm;
  onUpdateField: StoreAdminFieldUpdater;
}) {
  const headlinePreview =
    form.store_tagline.trim() || "Started pullets in western Colorado";
  const subheadingPreview =
    form.hero_subheading.trim() ||
    "Browse current availability and request pickup at checkout.";

  function resetToDefault() {
    onUpdateField("storefront_font_pair", defaultStorefrontTheme.fontPair);
    onUpdateField("storefront_heading_color", defaultStorefrontTheme.headingColor);
    onUpdateField("storefront_text_color", defaultStorefrontTheme.textColor);
    onUpdateField("storefront_top_menu_color", defaultStorefrontTheme.topMenuColor);
  }

  return (
    <div className={cx(storefrontFontVariablesClass, "grid gap-5")}>
      <section className="grid gap-3">
        <h3 className="text-sm font-semibold text-stone-950">Font style</h3>
        <div className="grid gap-2.5 md:grid-cols-2">
          {storefrontFontPairs.map((pair) => {
            const isSelected = pair.id === form.storefront_font_pair;

            return (
              <button
                aria-pressed={isSelected}
                className={`grid min-h-32 gap-2.5 rounded-md border p-3 text-left transition focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 ${
                  isSelected
                    ? "border-emerald-700 bg-emerald-50/70 ring-1 ring-emerald-700"
                    : "border-stone-200 bg-white hover:border-emerald-300 hover:bg-stone-50"
                }`}
                key={pair.id}
                onClick={() => onUpdateField("storefront_font_pair", pair.id)}
                type="button"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-stone-950">
                      {pair.label}
                    </p>
                    <p className="mt-0.5 truncate text-[0.7rem] font-medium leading-4 text-stone-500">
                      {pair.headingFontLabel} / {pair.bodyFontLabel}
                    </p>
                  </div>
                  {isSelected ? (
                    <span className="rounded-full bg-emerald-700 px-2 py-0.5 text-[0.68rem] font-bold text-white">
                      Selected
                    </span>
                  ) : null}
                </div>
                <div className="grid gap-1.5">
                  <p
                    className="line-clamp-2 text-[1.25rem] font-normal leading-[1.12] text-stone-950"
                    style={{
                      fontFamily: pair.headingFontVariable,
                    }}
                  >
                    {headlinePreview}
                  </p>
                  <p
                    className="line-clamp-2 text-sm leading-5 text-stone-700"
                    style={{ fontFamily: pair.bodyFontVariable }}
                  >
                    {subheadingPreview}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="grid gap-3">
        <div className="grid gap-3 lg:grid-cols-3">
          <ColorSettingField
            key={`heading-${form.storefront_heading_color}`}
            helper="Headings, buttons, links, and glyphs."
            label="Primary color"
            onChange={(value) =>
              onUpdateField("storefront_heading_color", value)
            }
            value={form.storefront_heading_color}
          />
          <ColorSettingField
            key={`text-${form.storefront_text_color}`}
            label="Text color"
            onChange={(value) => onUpdateField("storefront_text_color", value)}
            value={form.storefront_text_color}
          />
          <ColorSettingField
            key={`top-menu-${form.storefront_top_menu_color}`}
            label="Top menu color"
            onChange={(value) =>
              onUpdateField("storefront_top_menu_color", value)
            }
            value={form.storefront_top_menu_color}
          />
        </div>
      </section>

      <div className="flex justify-end">
        <button
          className="seller-secondary-button min-w-36 rounded-md bg-white"
          onClick={resetToDefault}
          type="button"
        >
          Reset to default
        </button>
      </div>
    </div>
  );
}

function ColorSettingField({
  helper,
  label,
  onChange,
  value,
}: {
  helper?: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const normalizedValue = isValidStorefrontHexColor(value)
    ? value.toLowerCase()
    : "#000000";
  const [draft, setDraft] = useState(value);
  const isDraftValid = isValidStorefrontHexColor(draft);

  function updateFromText(nextValue: string) {
    const prefixedValue = nextValue.startsWith("#") ? nextValue : `#${nextValue}`;
    setDraft(prefixedValue);

    if (isValidStorefrontHexColor(prefixedValue)) {
      onChange(prefixedValue.toLowerCase());
    }
  }

  return (
    <label className="grid gap-1.5 text-sm font-semibold text-stone-800">
      <span>
        {label}
        {helper ? (
          <span className="mt-0.5 block text-xs font-medium leading-4 text-stone-500">
            {helper}
          </span>
        ) : null}
      </span>
      <span className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-2">
        <input
          aria-label={`${label} picker`}
          className="h-11 w-full rounded-md border border-stone-300 bg-white p-1 shadow-sm"
          onChange={(event) => onChange(event.target.value.toLowerCase())}
          type="color"
          value={normalizedValue}
        />
        <input
          aria-invalid={!isDraftValid}
          className={`seller-form-field seller-compact-field font-mono uppercase ${
            isDraftValid ? "" : "border-red-300 focus:border-red-500"
          }`}
          maxLength={7}
          onBlur={() => setDraft(value)}
          onChange={(event) => updateFromText(event.target.value)}
          spellCheck={false}
          value={draft}
        />
      </span>
      {!isDraftValid ? (
        <span className="text-xs font-semibold text-red-700">
          Use a 6-digit hex value.
        </span>
      ) : null}
    </label>
  );
}

function PhotosTab({
  aboutPhoto,
  heroSubheading,
  heroImage,
  isUploading,
  logo,
  mediaError,
  onRemove,
  onSaveAboutCrop,
  onSaveHeroCrop,
  onSaveHeroLayout,
  onSelectHeroLibrary,
  onUpload,
  storeName,
  tagline,
  theme,
}: {
  aboutPhoto: StoreMediaItem | null;
  heroSubheading: string;
  heroImage: StoreMediaItem | null;
  isUploading: StoreMediaRole | null;
  logo: StoreMediaItem | null;
  mediaError: string | null;
  onRemove: (item: StoreMediaItem | null) => void;
  onSaveAboutCrop: (crop: PhotoCropMetadata | null) => void;
  onSaveHeroCrop: (crop: PhotoCropMetadata | null) => void;
  onSaveHeroLayout: (layout: HeroLayout) => void;
  onSelectHeroLibrary: (image: HeroLibraryImage) => void;
  onUpload: (role: StoreMediaRole, files: FileList | null) => void;
  storeName: string;
  tagline: string;
  theme: {
    fontPair: StorefrontFontPairId;
    headingColor: string;
    textColor: string;
    topMenuColor: string;
  };
}) {
  const [openSection, setOpenSection] =
    useState<ImagesAccordionId | "none">("none");
  const heroLayout = normalizeHeroLayout(heroImage?.hero_layout);
  const heroLayoutLabel =
    heroLayoutOptions.find((option) => option.value === heroLayout)?.label ??
    "Full Width Photo";
  const heroPositionSummary = heroImage
    ? isDefaultHeroPosition(heroImage)
      ? "Default position"
      : "Custom position"
    : "Default position";
  const heroImageSummary = heroImage ? "Image added" : "Default stock image";

  return (
    <div className="grid gap-3">
      {mediaError ? (
        <StoreSetupAlert tone="error">
          {mediaError}
        </StoreSetupAlert>
      ) : null}

      <StoreSetupAccordionSection
        glyph="/glyphs/camera.png"
        id="logo"
        isOpen={openSection === "logo"}
        onToggle={(id) => setOpenSection(id as ImagesAccordionId | "none")}
        summary={
          <span className="truncate">
            {logo ? "Logo added" : "No logo uploaded"}
          </span>
        }
        thumbnailAlt={logo?.alt_text || "Store logo"}
        thumbnailSrc={logo ? toStoreAdminImageUrl(logo.public_url) : null}
        title="Logo"
      >
        <LogoPhotoSection
          isUploading={isUploading === "logo"}
          logo={logo}
          onRemove={() => onRemove(logo)}
          onUpload={(files) => onUpload("logo", files)}
        />
      </StoreSetupAccordionSection>

      <StoreSetupAccordionSection
        badge={<RequiredBadge />}
        glyph="/glyphs/farmhouse.png"
        id="hero"
        isOpen={openSection === "hero"}
        onToggle={(id) => setOpenSection(id as ImagesAccordionId | "none")}
        summary={
          <span className="truncate">
            {heroImageSummary} · {heroLayoutLabel} · {heroPositionSummary}
          </span>
        }
        thumbnailAlt={heroImage?.alt_text || "Hero image"}
        thumbnailSrc={
          heroImage
            ? toStoreAdminMediaImageUrl(heroImage)
            : null
        }
        title="Hero image"
      >
        <HeroPhotoSection
          key={heroImage?.media_link_id ?? "default-hero"}
          heroImage={heroImage}
          isUploading={isUploading === "hero"}
          onRemove={() => onRemove(heroImage)}
          onSaveCrop={onSaveHeroCrop}
          onSaveLayout={onSaveHeroLayout}
          onSelectLibrary={onSelectHeroLibrary}
          onUpload={(files) => onUpload("hero", files)}
          storeName={storeName}
          tagline={tagline}
          heroSubheading={heroSubheading}
          theme={theme}
        />
      </StoreSetupAccordionSection>

      <StoreSetupAccordionSection
        badge={<OptionalBadge />}
        glyph="/glyphs/person.png"
        id="about-photo"
        isOpen={openSection === "about-photo"}
        onToggle={(id) => setOpenSection(id as ImagesAccordionId | "none")}
        summary={
          <span className="truncate">
            {aboutPhoto ? "Photo added" : "No photo uploaded"}
          </span>
        }
        thumbnailAlt={aboutPhoto?.alt_text || "About photo"}
        thumbnailSrc={
          aboutPhoto ? toStoreAdminMediaImageUrl(aboutPhoto) : null
        }
        title="About photo"
      >
        <AboutPhotoSection
          key={aboutPhoto?.media_link_id ?? "about-photo-empty"}
          aboutPhoto={aboutPhoto}
          isUploading={isUploading === "about"}
          onRemove={() => onRemove(aboutPhoto)}
          onSaveCrop={onSaveAboutCrop}
          onUpload={(files) => onUpload("about", files)}
        />
      </StoreSetupAccordionSection>
    </div>
  );
}

function LogoPhotoSection({
  isUploading,
  logo,
  onRemove,
  onUpload,
}: {
  isUploading: boolean;
  logo: StoreMediaItem | null;
  onRemove: () => void;
  onUpload: (files: FileList | null) => void;
}) {
  return (
    <section className="grid gap-3">
      <div>
        <p className="text-sm leading-5 text-stone-600">
          Your logo appears in the top left of your storefront.
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex size-28 items-center justify-center overflow-hidden rounded-lg border border-stone-200 bg-stone-50">
          {logo ? (
            <Image
              alt={logo.alt_text || "Store logo"}
              className="h-full w-full object-contain"
              height={128}
              src={toStoreAdminImageUrl(logo.public_url)}
              unoptimized
              width={128}
            />
          ) : (
            <Image alt="" height={48} src="/branding/logo-no-words-final.png" width={48} />
          )}
        </div>
        <div className="grid gap-2 sm:min-w-56">
          <UploadButton
            isUploading={isUploading}
            label="Upload new logo"
            onUpload={onUpload}
          />
          {logo ? (
            <button
              className="seller-secondary-button border-red-200 text-red-700 hover:bg-red-50"
              type="button"
              onClick={onRemove}
            >
              Remove logo
            </button>
          ) : null}
          <p className="text-xs font-medium leading-4 text-stone-500">
            Recommended: square image, JPG or PNG, at least 512x512.
          </p>
        </div>
      </div>
    </section>
  );
}

type HeroLayout = "full" | "right";

const aboutPhotoFrame = {
  aspectRatio: 1.58,
  setupPreviewScale: 0.68,
  setupPreviewClass:
    "relative aspect-[1.58/1] w-full max-w-[24.5rem] touch-none overflow-hidden rounded-lg border border-stone-200 bg-stone-50",
};

function HeroPhotoSection({
  heroSubheading,
  heroImage,
  isUploading,
  onRemove,
  onSaveCrop,
  onSaveLayout,
  onSelectLibrary,
  onUpload,
  storeName,
  tagline,
  theme,
}: {
  heroSubheading: string;
  heroImage: StoreMediaItem | null;
  isUploading: boolean;
  onRemove: () => void;
  onSaveCrop: (crop: PhotoCropMetadata | null) => void;
  onSaveLayout: (layout: HeroLayout) => void;
  onSelectLibrary: (image: HeroLibraryImage) => void;
  onUpload: (files: FileList | null) => void;
  storeName: string;
  tagline: string;
  theme: {
    fontPair: StorefrontFontPairId;
    headingColor: string;
    textColor: string;
    topMenuColor: string;
  };
}) {
  const [layout, setLayout] = useState<HeroLayout>(
    normalizeHeroLayout(heroImage?.hero_layout),
  );
  const [showTips, setShowTips] = useState(false);
  const [draftCrop, setDraftCrop] = useState<PhotoCropMetadata>(
    buildHeroInitialCrop(heroImage),
  );
  const dragStartRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
  } | null>(null);

  function updateDraftCrop(updates: Partial<PhotoCropMetadata>) {
    const nextCrop = { ...draftCrop, ...updates };
    setDraftCrop(nextCrop);
    return nextCrop;
  }

  function commitCrop(crop = draftCrop) {
    if (heroImage) onSaveCrop(crop);
  }

  function chooseLayout(nextLayout: HeroLayout) {
    setLayout(nextLayout);
    if (heroImage) onSaveLayout(nextLayout);
  }

  function beginDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!heroImage) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: draftCrop.x,
      y: draftCrop.y,
    };
  }

  function moveImage(event: React.PointerEvent<HTMLDivElement>) {
    const start = dragStartRef.current;

    if (!start || start.pointerId !== event.pointerId) return;

    setDraftCrop({
      x: Math.round(
        start.x +
          (event.clientX - start.startX) / storefrontHeroFrame.setupPreviewScale,
      ),
      y: Math.round(
        start.y +
          (event.clientY - start.startY) / storefrontHeroFrame.setupPreviewScale,
      ),
      aspect: draftCrop.aspect,
      zoom: draftCrop.zoom,
      rotation: draftCrop.rotation,
    });
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (dragStartRef.current?.pointerId === event.pointerId) {
      dragStartRef.current = null;
      commitCrop();
    }
  }

  const defaultLibraryImage = heroLibraryImages[0];
  const imageUrl = heroImage
    ? toStoreAdminMediaImageUrl(heroImage)
    : defaultLibraryImage.path;
  const selectedLibraryPath =
    heroImage?.source_type === "storefront_hero_library"
      ? heroImage.source_image_url ?? heroImage.public_url
      : null;
  const themeStyle = getStorefrontThemeStyle(theme);
  const heroTitle = tagline || storeName;
  const previewSubheading = previewStoreText(heroSubheading);

  return (
    <section className="grid gap-3">
      <div className="grid gap-2">
        <p className="text-sm leading-5 text-stone-600">
          This wide image appears at the top of your storefront behind your title
          and intro text.
        </p>
        <button
          className="w-fit text-sm font-semibold text-emerald-800 transition hover:text-emerald-950 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
          onClick={() => setShowTips((value) => !value)}
          type="button"
        >
          {showTips ? "Hide image tips" : "Image tips"}
        </button>
        {showTips ? (
          <TipsPanel
            title="Hero image tips"
            tips={[
              "Text appears on the left side of your storefront hero.",
              "Wide landscape photos work better than close-ups.",
              "Choose from the library or upload your own.",
            ]}
          />
        ) : null}
      </div>

      <div className="grid gap-3">
        <div className="grid gap-2">
          <div>
            <p className="text-sm font-semibold text-stone-800">Hero layout</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {heroLayoutOptions.map((option) => (
                <button
                  className={`rounded-lg border px-3 py-2 text-left transition focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 ${
                    layout === option.value
                      ? "border-emerald-700 bg-emerald-50 text-emerald-950"
                      : "border-stone-200 bg-white text-stone-700 hover:bg-stone-50"
                  }`}
                  key={option.value}
                  type="button"
                  onClick={() => chooseLayout(option.value)}
                >
                  <span className="block text-sm font-semibold">
                    {option.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-2">
            <p className="text-sm font-semibold text-stone-800">
              Desktop Hero Preview
            </p>
            <div
              className={storefrontHeroFrame.setupPreviewClass}
              onPointerCancel={endDrag}
              onPointerDown={beginDrag}
              onPointerMove={moveImage}
              onPointerUp={endDrag}
            >
              <div
                className={cx(
                  storefrontFontVariablesClass,
                  "buyer-storefront absolute left-0 top-0 h-[calc(100%/var(--hero-preview-scale))] w-[calc(100%/var(--hero-preview-scale))] origin-top-left scale-[var(--hero-preview-scale)]",
                )}
                style={
                  {
                    ...themeStyle,
                    "--hero-preview-scale": storefrontHeroFrame.setupPreviewScale,
                  } as CSSProperties
                }
              >
                <HeroPreviewBackdrop
                  crop={draftCrop}
                  imageAlt={heroImage?.alt_text || "Storefront hero preview"}
                  imageUrl={imageUrl}
                  layout={layout}
                  mode="desktop"
                  useCrop={Boolean(heroImage)}
                />
                <HeroPreviewContent
                  heroSubheading={previewSubheading}
                  heroTitle={heroTitle}
                  layout={layout}
                  mode="desktop"
                />
              </div>
              {heroImage ? (
                <div className="absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-full bg-stone-950/70 px-3 py-1 text-xs font-semibold text-white">
                  Drag to reposition
                </div>
              ) : null}
            </div>
          </div>

          <div className="grid gap-2">
            <div className="grid gap-2">
              <label className="grid gap-1 text-sm font-semibold text-stone-700">
                Zoom
                <input
                  className="accent-emerald-800"
                  disabled={!heroImage}
                  max="3"
                  min="0.5"
                  step="0.05"
                  type="range"
                  value={draftCrop.zoom}
                  onChange={(event) =>
                    updateDraftCrop({ zoom: Number(event.target.value) })
                  }
                  onKeyUp={() => commitCrop()}
                  onPointerUp={() => commitCrop()}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <UploadButton
                  isUploading={isUploading}
                  label="Upload new image"
                  onUpload={onUpload}
                />
                <LibraryMenu
                  isBusy={isUploading}
                  selectedPath={selectedLibraryPath}
                  onSelect={onSelectLibrary}
                />
                {heroImage ? (
                  <>
                    <button
                      className="seller-secondary-button"
                      type="button"
                      onClick={() => {
                        const resetCrop = buildHeroDefaultCrop(heroImage);
                        setDraftCrop(resetCrop);
                        onSaveCrop(resetCrop);
                      }}
                    >
                      Reset
                    </button>
                    <button
                      className="seller-secondary-button border-red-200 text-red-700 hover:bg-red-50"
                      type="button"
                      onClick={onRemove}
                    >
                      Remove image
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          </div>

          <div className="grid gap-2 pt-1">
            <p className="text-sm font-semibold text-stone-800">
              Mobile Hero Preview
            </p>
            <div
              className={cx(
                storefrontFontVariablesClass,
                "buyer-storefront relative mx-auto h-[13.35rem] w-full max-w-[390px] overflow-hidden rounded-lg bg-white shadow-sm [container-type:inline-size]",
              )}
              style={themeStyle}
            >
              <HeroPreviewBackdrop
                crop={draftCrop}
                imageAlt={heroImage?.alt_text || "Storefront hero preview"}
                imageUrl={imageUrl}
                layout={layout}
                mode="mobile"
                useCrop={Boolean(heroImage)}
              />
              <HeroPreviewContent
                heroSubheading={previewSubheading}
                heroTitle={heroTitle}
                layout={layout}
                mode="mobile"
              />
            </div>
          </div>
        </div>

      </div>
    </section>
  );
}

function HeroPreviewBackdrop({
  crop,
  imageAlt,
  imageUrl,
  layout,
  mode,
  useCrop,
}: {
  crop: PhotoCropMetadata;
  imageAlt: string;
  imageUrl: string;
  layout: HeroLayout;
  mode: "desktop" | "mobile";
  useCrop: boolean;
}) {
  const isMobile = mode === "mobile";
  const imageStyle = useCrop
    ? isMobile
      ? getMobileStorefrontHeroCropStyle(crop)
      : getCropImageStyle(crop)
    : undefined;

  return (
    <>
      {layout === "right" ? (
        <Image
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full scale-110 select-none object-cover blur-2xl saturate-110"
          draggable={false}
          fill
          sizes={isMobile ? "390px" : "(max-width: 1280px) 100vw, 760px"}
          src={imageUrl}
          style={{
            filter: "blur(26px) brightness(0.62) saturate(1.12)",
          }}
          unoptimized
        />
      ) : null}
      <Image
        alt={imageAlt}
        className={cx(
          "absolute inset-0 h-full w-full select-none object-center",
          isMobile ? "object-cover" : "object-contain",
        )}
        draggable={false}
        fill
        sizes={isMobile ? "390px" : "(max-width: 1280px) 100vw, 760px"}
        src={imageUrl}
        style={{
          ...imageStyle,
          transformOrigin: "center center",
          ...(!isMobile && layout === "right"
            ? {
                WebkitMaskImage:
                  "linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.2) 18%, black 34%, black 100%)",
                maskImage:
                  "linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.2) 18%, black 34%, black 100%)",
              }
            : {}),
        }}
        unoptimized
      />
      {isMobile ? (
        <div
          className={cx(
            "pointer-events-none absolute inset-0 z-[1]",
            layout === "right"
              ? "bg-[linear-gradient(90deg,rgba(28,25,23,0.8)_0%,rgba(28,25,23,0.64)_42%,rgba(28,25,23,0.28)_78%,rgba(28,25,23,0.08)_100%)]"
              : "bg-[linear-gradient(90deg,rgba(28,25,23,0.8)_0%,rgba(28,25,23,0.64)_42%,rgba(28,25,23,0.3)_74%,rgba(28,25,23,0.08)_100%)]",
          )}
        />
      ) : (
        <HeroFade layout={layout} />
      )}
    </>
  );
}

function HeroPreviewContent({
  heroSubheading,
  heroTitle,
  layout,
  mode,
}: {
  heroSubheading: string;
  heroTitle: string;
  layout: HeroLayout;
  mode: "desktop" | "mobile";
}) {
  const isMobile = mode === "mobile";
  const heroTextColor = isMobile
    ? "text-white"
    : layout === "right"
      ? "text-white"
      : "text-black";
  const typography = isMobile
    ? storefrontHeroMobilePreviewTypography
    : storefrontHeroTypography;

  return (
    <div className="relative z-10 mx-auto h-full max-w-[70rem] px-4 sm:px-7">
      <div
        className={cx(
          "flex h-full flex-col justify-center [text-shadow:0_1px_10px_rgba(0,0,0,0.42)]",
          isMobile
            ? "max-w-[16.5rem] gap-2.5"
            : "max-w-[36rem] gap-4 [text-shadow:none]",
          heroTextColor,
        )}
      >
        <div>
          <p className={cx(typography.eyebrow, heroTextColor)}>
            Local farm storefront
          </p>
          <h4
            className={cx(
              typography.title,
              "-mb-2 line-clamp-2 pb-2",
              heroTextColor,
            )}
          >
            {heroTitle}
          </h4>
          <p
            className={cx(
              typography.body,
              "line-clamp-2",
              heroTextColor,
            )}
          >
            {heroSubheading}
          </p>
        </div>
        <span
          className={storefrontButtonClass({
            className: cx(
              "mt-1 w-fit min-h-10 px-5 text-base sm:mt-3 sm:min-h-12 sm:px-6 sm:text-xl",
              isMobile ? "" : "lg:min-h-[3.25rem] lg:px-7 lg:!text-[1.45rem]",
            ),
          })}
        >
          Shop
        </span>
      </div>
    </div>
  );
}

function LibraryMenu({
  isBusy,
  onSelect,
  selectedPath,
}: {
  isBusy: boolean;
  onSelect: (image: HeroLibraryImage) => void;
  selectedPath: string | null;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const titleId = useId();

  useEffect(() => {
    if (!isOpen) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }

    window.addEventListener("keydown", closeOnEscape);

    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isOpen]);

  return (
    <>
      <button
        className="seller-secondary-button flex items-center justify-center gap-2"
        disabled={isBusy}
        type="button"
        onClick={() => setIsOpen(true)}
      >
        <Image alt="" height={16} src="/glyphs/farmhouse.png" width={16} />
        Choose a stock photo
      </button>

      {isOpen ? (
        <div
          aria-labelledby={titleId}
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/45 p-4"
          role="dialog"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsOpen(false);
          }}
        >
          <div className="grid max-h-[min(44rem,calc(100vh-2rem))] w-full max-w-5xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-stone-200 px-5 py-4">
              <div>
                <h4
                  className="text-base font-semibold text-stone-950"
                  id={titleId}
                >
                  Choose a stock photo
                </h4>
                <p className="mt-1 text-sm text-stone-600">
                  Pick a hero image for your storefront preview.
                </p>
              </div>
              <button
                className="seller-secondary-button px-3"
                type="button"
                onClick={() => setIsOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="grid min-h-0 gap-3 overflow-y-auto p-4 sm:grid-cols-2 lg:grid-cols-3">
              {heroLibraryImages.map((image) => {
                const isSelected = selectedPath === image.path;

                return (
                  <button
                    aria-label={`Choose ${image.label}`}
                    className={`rounded-lg border p-2 transition hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2 ${
                      isSelected
                        ? "border-emerald-700 bg-emerald-50"
                        : "border-stone-200 bg-white"
                    }`}
                    disabled={isBusy}
                    key={image.path}
                    type="button"
                    onClick={() => {
                      onSelect(image);
                      setIsOpen(false);
                    }}
                  >
                    <span className="relative block aspect-[7/3] w-full overflow-hidden rounded-md bg-stone-100">
                      <Image
                        alt=""
                        className="object-cover"
                        fill
                        sizes="(max-width: 1024px) 50vw, 300px"
                        src={image.path}
                      />
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function AboutPhotoSection({
  aboutPhoto,
  isUploading,
  onRemove,
  onSaveCrop,
  onUpload,
}: {
  aboutPhoto: StoreMediaItem | null;
  isUploading: boolean;
  onRemove: () => void;
  onSaveCrop: (crop: PhotoCropMetadata | null) => void;
  onUpload: (files: FileList | null) => void;
}) {
  const [draftCrop, setDraftCrop] = useState<PhotoCropMetadata>(
    buildAboutInitialCrop(aboutPhoto),
  );
  const [showTips, setShowTips] = useState(false);
  const dragStartRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
  } | null>(null);

  function updateDraftCrop(updates: Partial<PhotoCropMetadata>) {
    const nextCrop = { ...draftCrop, ...updates };
    setDraftCrop(nextCrop);
    return nextCrop;
  }

  function commitCrop(crop = draftCrop) {
    if (aboutPhoto) onSaveCrop({ ...crop, aspect: aboutPhotoFrame.aspectRatio });
  }

  function beginDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!aboutPhoto) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: draftCrop.x,
      y: draftCrop.y,
    };
  }

  function moveImage(event: React.PointerEvent<HTMLDivElement>) {
    const start = dragStartRef.current;

    if (!start || start.pointerId !== event.pointerId) return;

    setDraftCrop({
      x: Math.round(
        start.x +
          (event.clientX - start.startX) / aboutPhotoFrame.setupPreviewScale,
      ),
      y: Math.round(
        start.y +
          (event.clientY - start.startY) / aboutPhotoFrame.setupPreviewScale,
      ),
      aspect: aboutPhotoFrame.aspectRatio,
      zoom: draftCrop.zoom,
      rotation: draftCrop.rotation,
    });
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (dragStartRef.current?.pointerId === event.pointerId) {
      dragStartRef.current = null;
      commitCrop();
    }
  }

  return (
    <section className="grid gap-3">
      <div className="grid gap-2">
        <p className="text-sm leading-5 text-stone-600">
          Shown with your farm story on the About section of your storefront.
        </p>
        <button
          className="w-fit text-sm font-semibold text-emerald-800 transition hover:text-emerald-950 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
          onClick={() => setShowTips((value) => !value)}
          type="button"
        >
          {showTips ? "Hide image tips" : "Image tips"}
        </button>
        {showTips ? (
          <TipsPanel
            title="About photo tips"
            tips={[
              "Use a medium image, not a banner.",
              "Great for you, your family, your flock, coop, chicks, or farm details.",
              "This appears alongside your farm story.",
            ]}
          />
        ) : null}
      </div>

      <div className="grid gap-3">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div
            className={aboutPhotoFrame.setupPreviewClass}
            onPointerCancel={endDrag}
            onPointerDown={beginDrag}
            onPointerMove={moveImage}
            onPointerUp={endDrag}
          >
            {aboutPhoto ? (
              <>
                <div
                  className="absolute left-0 top-0 h-[calc(100%/var(--about-preview-scale))] w-[calc(100%/var(--about-preview-scale))] origin-top-left scale-[var(--about-preview-scale)]"
                  style={
                    {
                      "--about-preview-scale":
                        aboutPhotoFrame.setupPreviewScale,
                    } as CSSProperties
                  }
                >
                  <Image
                    alt={aboutPhoto.alt_text || "About photo"}
                    className="absolute inset-0 h-full w-full select-none object-contain object-center"
                    draggable={false}
                    fill
                    sizes="576px"
                    src={toStoreAdminMediaImageUrl(aboutPhoto)}
                    style={getCropImageStyle(draftCrop)}
                    unoptimized
                  />
                </div>
                <div className="absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full bg-stone-950/70 px-3 py-1 text-xs font-semibold text-white">
                  Drag to reposition
                </div>
              </>
            ) : (
              <div className="flex h-full items-center justify-center text-sm font-semibold text-stone-500">
                No about photo yet
              </div>
            )}
          </div>

          <div className="grid h-fit gap-2 sm:min-w-56">
            <UploadButton
              isUploading={isUploading}
              label="Upload new photo"
              onUpload={onUpload}
            />
            {aboutPhoto ? (
              <>
                <label className="grid gap-1 text-sm font-semibold text-stone-700">
                  Zoom
                  <input
                    className="accent-emerald-800"
                    max="3"
                    min="0.5"
                    step="0.05"
                    type="range"
                    value={draftCrop.zoom}
                    onChange={(event) =>
                      updateDraftCrop({ zoom: Number(event.target.value) })
                    }
                    onKeyUp={() => commitCrop()}
                    onPointerUp={() => commitCrop()}
                  />
                </label>
                <button
                  className="seller-secondary-button"
                  type="button"
                  onClick={() => {
                    const resetCrop = buildAboutDefaultCrop(aboutPhoto);
                    setDraftCrop(resetCrop);
                    onSaveCrop(resetCrop);
                  }}
                >
                  Reset
                </button>
                <button
                  className="seller-secondary-button border-red-200 text-red-700 hover:bg-red-50"
                  type="button"
                  onClick={onRemove}
                >
                  Remove photo
                </button>
              </>
            ) : null}
            <p className="text-xs font-medium leading-4 text-stone-500">
              Recommended: landscape image, JPG or PNG, at least 1200px wide.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function UploadButton({
  isUploading,
  label,
  onUpload,
}: {
  isUploading: boolean;
  label: string;
  onUpload: (files: FileList | null) => void;
}) {
  const inputId = useIdForUpload(label);

  return (
    <label
      className={`seller-secondary-button inline-flex cursor-pointer items-center justify-center gap-2 ${
        isUploading ? "pointer-events-none opacity-70" : ""
      }`}
      htmlFor={inputId}
    >
      <Image alt="" height={16} src="/glyphs/camera.png" width={16} />
      {isUploading ? "Uploading..." : label}
      <input
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        id={inputId}
        type="file"
        onChange={(event) => {
          onUpload(event.target.files);
          event.target.value = "";
        }}
      />
    </label>
  );
}

function OptionalBadge() {
  return (
    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-100">
      Optional
    </span>
  );
}

function RequiredBadge() {
  return (
    <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-700 ring-1 ring-stone-200">
      Required
    </span>
  );
}

function TipsPanel({
  tips,
  title,
}: {
  tips: string[];
  title: string;
}) {
  return (
    <aside className="rounded-md border border-stone-200 bg-stone-50/70 p-3 text-stone-700">
      <h4 className="text-sm font-semibold text-stone-950">{title}</h4>
      <ul className="mt-2 grid gap-1.5 text-sm font-medium leading-[1.25]">
        {tips.map((tip) => (
          <li className="flex gap-2" key={tip}>
            <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-current" />
            <span>{tip}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function HeroFade({ layout }: { layout: HeroLayout }) {
  if (layout === "full") return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-10 bg-[linear-gradient(90deg,rgba(28,25,23,0.46)_0%,rgba(28,25,23,0.34)_36%,rgba(28,25,23,0.04)_72%)]" />
  );
}

function normalizeHeroLayout(value: string | null | undefined): HeroLayout {
  return value === "right" ? "right" : "full";
}

function isDefaultHeroPosition(media: StoreMediaItem | null | undefined) {
  if (!media?.crop_metadata) return true;

  return (
    JSON.stringify(normalizeCrop(media.crop_metadata)) ===
    JSON.stringify(normalizeCrop(buildHeroDefaultCrop(media)))
  );
}

function buildHeroInitialCrop(media: StoreMediaItem | null | undefined) {
  if (media?.crop_metadata) {
    const normalized = normalizeCrop(media.crop_metadata);

    return {
      ...normalized,
      aspect: storefrontHeroFrame.aspectRatio,
      zoom: Math.max(normalized.zoom, getHeroCoverZoom(media)),
    };
  }

  return buildHeroDefaultCrop(media);
}

function buildHeroDefaultCrop(media: StoreMediaItem | null | undefined) {
  return {
    ...normalizeCrop(null),
    aspect: storefrontHeroFrame.aspectRatio,
    zoom: getHeroCoverZoom(media),
  };
}

function getHeroCoverZoom(media: StoreMediaItem | null | undefined) {
  const fallbackZoom = 1.35;
  const width = media?.width_px ?? 0;
  const height = media?.height_px ?? 0;

  if (width <= 0 || height <= 0) return fallbackZoom;

  const imageRatio = width / height;
  const frameRatio = storefrontHeroFrame.aspectRatio;
  const zoom = Math.max(1, imageRatio / frameRatio, frameRatio / imageRatio);

  return Math.round(zoom * 100) / 100;
}

function buildAboutInitialCrop(media: StoreMediaItem | null | undefined) {
  if (media?.crop_metadata) {
    const normalized = normalizeCrop(media.crop_metadata);

    return {
      ...normalized,
      aspect: aboutPhotoFrame.aspectRatio,
      zoom: Math.max(normalized.zoom, getAboutCoverZoom(media)),
    };
  }

  return buildAboutDefaultCrop(media);
}

function buildAboutDefaultCrop(media: StoreMediaItem | null | undefined) {
  return {
    ...normalizeCrop(null),
    aspect: aboutPhotoFrame.aspectRatio,
    zoom: getAboutCoverZoom(media),
  };
}

function getAboutCoverZoom(media: StoreMediaItem | null | undefined) {
  const fallbackZoom = 1;
  const width = media?.width_px ?? 0;
  const height = media?.height_px ?? 0;

  if (width <= 0 || height <= 0) return fallbackZoom;

  const imageRatio = width / height;
  const frameRatio = aboutPhotoFrame.aspectRatio;
  const zoom = Math.max(1, imageRatio / frameRatio, frameRatio / imageRatio);

  return Math.round(zoom * 100) / 100;
}

function previewStoreText(value: string, maxLength = heroSubheadingMaxLength) {
  const trimmed = value.trim();

  if (!trimmed) return "Healthy birds from our family farm to yours.";

  return trimmed.length > maxLength
    ? `${trimmed.slice(0, maxLength - 3).trim()}...`
    : trimmed;
}

function getStorefrontContactEmail(form: StoreAdminForm) {
  return (
    form.public_email.trim() ||
    form.order_notification_email.trim() ||
    form.communication_email.trim() ||
    "No contact email set"
  );
}

function useIdForUpload(label: string) {
  const id = useId();
  return `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${id}`;
}

function SettingsSection({
  children,
  description,
  title,
}: {
  children: React.ReactNode;
  description: string;
  title: string;
}) {
  return (
    <section className="grid gap-4 border-b border-stone-200 pb-6 last:border-b-0 last:pb-0">
      <div>
        <h2 className="text-lg font-semibold text-stone-950">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-stone-600">
          {description}
        </p>
      </div>
      <div className="grid gap-4">{children}</div>
    </section>
  );
}

function StorefrontStatusPanel({
  hasPendingVisibilityChange,
  isVisibleToCustomers,
}: {
  hasPendingVisibilityChange: boolean;
  isVisibleToCustomers: boolean;
}) {
  const title = hasPendingVisibilityChange
    ? isVisibleToCustomers
      ? "Storefront will be shown"
      : "Storefront will be hidden"
    : isVisibleToCustomers
      ? "Storefront is live"
      : "Storefront is hidden";
  const description = hasPendingVisibilityChange
    ? "This change will apply after you save."
    : isVisibleToCustomers
      ? "Customers can view your store and place orders."
      : "Customers cannot view your store until you show it again.";

  return (
    <div
      className="flex min-h-14 items-center gap-3 rounded-md border border-stone-200 bg-stone-50/60 px-3 py-2"
    >
      <span
        className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
          isVisibleToCustomers ? "bg-emerald-700" : "bg-red-600"
        }`}
      >
        <Image
          alt=""
          className="object-contain"
          height={16}
          src="/glyphs/checkmark.png"
          width={16}
        />
      </span>
      <div>
        <p className="text-sm font-semibold text-stone-950">
          {title}
        </p>
        <p className="mt-0.5 text-xs font-medium leading-4 text-stone-600">
          {description}
        </p>
      </div>
    </div>
  );
}

function FieldExamples({ examples }: { examples: string[] }) {
  return (
    <div className="text-xs font-medium leading-4 text-stone-600">
      <p className="font-semibold text-stone-700">Examples:</p>
      <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
        {examples.map((example) => (
          <li key={example}>{example}</li>
        ))}
      </ul>
    </div>
  );
}

function StorefrontNote({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <p className="text-xs font-medium leading-5 text-stone-500">
      {children}
    </p>
  );
}

function ModuleOptionCard({
  action,
  description,
  glyph,
  state,
  status,
  title,
}: {
  action?: React.ReactNode;
  description: string;
  glyph: string;
  state: "always" | "enabled" | "disabled" | "locked";
  status?: string;
  title: string;
}) {
  const isLocked = state === "locked";
  const isAlways = state === "always";

  return (
    <div
      className={`grid gap-2.5 rounded-lg border p-2.5 transition sm:grid-cols-[minmax(0,1fr)_13.5rem] sm:items-center ${
        isAlways
          ? "border-emerald-100 bg-emerald-50/40"
          : isLocked
            ? "border-stone-200 bg-stone-50"
            : "border-stone-200 bg-white"
      }`}
    >
      <div className="flex min-w-0 gap-2.5">
        <span
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-stone-100 ring-1 ring-stone-200"
        >
          <Image
            alt=""
            className="object-contain"
            height={28}
            src={glyph}
            width={28}
          />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-stone-950">{title}</h3>
          </div>
          <p className="mt-0.5 text-sm leading-5 text-stone-600">
            {description}
          </p>
        </div>
      </div>

      <div className="grid gap-2 border-stone-200 sm:border-l sm:pl-3">
        <div className="flex items-center justify-end gap-3">
          {status ? (
            state === "always" ? (
              <div className="flex items-center gap-2">
                <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-emerald-700 text-xs font-bold text-emerald-800">
                  &#10003;
                </span>
                <p className="text-sm font-semibold leading-5 text-stone-800">
                  {status}
                </p>
              </div>
            ) : (
              <p
                className={`text-sm font-semibold leading-5 ${
                  isLocked ? "text-stone-600" : "text-stone-800"
                }`}
              >
                {status}
              </p>
            )
          ) : null}
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      </div>
    </div>
  );
}

function ModuleToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-stone-700">
      <span>{checked ? "Enabled" : "Disabled"}</span>
      <span
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
          checked ? "bg-emerald-700" : "bg-stone-300"
        }`}
      >
        <input
          checked={Boolean(checked)}
          className="sr-only"
          onChange={(event) => onChange(event.target.checked)}
          type="checkbox"
        />
        <span
          className={`absolute size-5 rounded-full bg-white shadow-sm transition ${
            checked ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </span>
    </label>
  );
}

function ModuleDisableDialog({
  message,
  onCancel,
  onConfirm,
  title,
}: {
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
}) {
  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/45 px-4 py-6"
      role="dialog"
    >
      <div className="w-full max-w-md rounded-xl border border-stone-200 bg-white p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-amber-200 bg-amber-50 text-lg font-bold text-amber-800"
          >
            !
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold leading-6 text-stone-950">
              {title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-stone-700">
              {message}
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            className="seller-secondary-button"
            type="button"
            onClick={onCancel}
          >
            Keep showing it
          </button>
          <button
            className="seller-primary-button"
            type="button"
            onClick={onConfirm}
          >
            Turn off
          </button>
        </div>
      </div>
    </div>
  );
}

function UnsavedChangesDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/45 px-4 py-6"
      role="dialog"
    >
      <div className="w-full max-w-md rounded-xl border border-stone-200 bg-white p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-amber-200 bg-amber-50 text-lg font-bold text-amber-800"
          >
            !
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold leading-6 text-stone-950">
              Save changes before leaving?
            </h2>
            <p className="mt-2 text-sm leading-6 text-stone-700">
              You have unsaved Store Setup changes. Save or discard your changes
              before leaving this page.
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            className="seller-secondary-button"
            type="button"
            onClick={onConfirm}
          >
            Leave without saving
          </button>
          <button
            className="seller-primary-button"
            type="button"
            onClick={onCancel}
          >
            Stay here
          </button>
        </div>
      </div>
    </div>
  );
}

function LockedModuleAction({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="inline-flex min-h-8 items-center rounded-md border border-stone-300 bg-white px-2.5 text-xs font-semibold text-emerald-900 transition hover:border-emerald-700 hover:text-emerald-950 focus:outline-none focus:ring-2 focus:ring-emerald-700 focus:ring-offset-2"
      type="button"
      onClick={onClick}
    >
      View plans
    </button>
  );
}

function LaunchStoreCardContent({
  hasUnsavedChanges,
  isLaunching,
  isReadinessLoading,
  launchAllowed,
  onLaunch,
  platformReviewNeeded,
  readinessError,
  requiredItems,
  sellerStatus,
  warningItems,
}: {
  hasUnsavedChanges: boolean;
  isLaunching: boolean;
  isReadinessLoading: boolean;
  launchAllowed: boolean;
  onLaunch: () => void;
  platformReviewNeeded: boolean;
  readinessError: string | null;
  requiredItems: SellerLaunchItem[];
  sellerStatus: string;
  warningItems: SellerLaunchItem[];
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-start">
      <div className="grid gap-4">
        <div>
          <h2 className="text-xl font-semibold text-stone-950">
            Launch your store
          </h2>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            Before customers can view your store, finish the required setup
            items below.
          </p>
        </div>

        {readinessError ? (
          <StoreSetupAlert tone="error">
            Readiness could not be checked. Please try again.
          </StoreSetupAlert>
        ) : null}

        {platformReviewNeeded ? (
          <StoreSetupAlert tone="warning">
            Something needs platform review before this store can launch.
            Contact support or an admin.
          </StoreSetupAlert>
        ) : null}

        {sellerStatus !== "draft" ? (
          <StoreSetupAlert tone="warning">
            This store cannot be launched from its current status.
          </StoreSetupAlert>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {requiredItems.map((item) => (
            <SellerReadinessRow item={item} key={item.key} />
          ))}
        </div>

        {warningItems.some((item) => !item.passed) ? (
          <div className="grid gap-2 border-t border-stone-200 pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              Optional polish
            </p>
            <div className="flex flex-wrap gap-2">
              {warningItems
                .filter((item) => !item.passed)
                .map((item) => (
                  <span
                    className="rounded-md bg-stone-100 px-3 py-2 text-xs font-medium text-stone-600"
                    key={item.key}
                  >
                    {item.action}
                  </span>
                ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="grid gap-2 lg:min-w-52">
        <button
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-stone-950 px-5 text-sm font-semibold text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-400"
          disabled={!launchAllowed}
          onClick={onLaunch}
          type="button"
        >
          {isLaunching ? "Launching..." : "Launch Store"}
        </button>
        {hasUnsavedChanges ? (
          <p className="text-xs font-medium leading-5 text-amber-800">
            Save or discard Store Admin changes before launching.
          </p>
        ) : null}
        {isReadinessLoading ? (
          <p className="text-xs font-medium leading-5 text-stone-500">
            Checking setup...
          </p>
        ) : null}
      </div>
    </div>
  );
}

function SellerReadinessRow({ item }: { item: SellerLaunchItem }) {
  return (
    <div
      className={`rounded-lg border px-3 py-3 ${
        item.passed
          ? "border-emerald-100 bg-emerald-50/70"
          : "border-stone-200 bg-stone-50"
      }`}
    >
      <p className="text-sm font-semibold text-stone-950">
        <span
          className={
            item.passed
              ? "mr-2 text-emerald-700"
              : "mr-2 text-stone-400"
          }
        >
          {item.passed ? "\u2713" : "\u25cb"}
        </span>
        {item.label}
      </p>
      {!item.passed ? (
        <p className="mt-1 text-xs font-medium leading-5 text-stone-600">
          {item.action}
        </p>
      ) : null}
    </div>
  );
}

function TextField({
  helper,
  label,
  maxLength,
  onChange,
  optional = false,
  placeholder,
  required = false,
  showCounter = false,
  type = "text",
  value,
}: {
  helper?: string;
  label: string;
  maxLength?: number;
  onChange: (value: string) => void;
  optional?: boolean;
  placeholder?: string;
  required?: boolean;
  showCounter?: boolean;
  type?: "text" | "number";
  value: string;
}) {
  return (
    <label className="grid gap-1 text-sm font-semibold text-stone-700">
      <span className="flex items-center justify-between gap-3">
        <span>
          {label}
          {required ? <span className="ml-1 text-red-600">*</span> : null}
          {optional ? (
            <span className="ml-1 font-medium text-stone-500">(optional)</span>
          ) : null}
        </span>
        {showCounter && maxLength ? (
          <span className="text-xs font-medium text-stone-500">
            {value.length} / {maxLength}
          </span>
        ) : null}
      </span>
      <input
        className="seller-form-field"
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        type={type}
        value={value}
      />
      {helper ? (
        <span className="text-xs font-medium leading-5 text-stone-500">
          {helper}
        </span>
      ) : null}
    </label>
  );
}

function TextAreaField({
  compact = false,
  helper,
  label,
  maxLength,
  onChange,
  placeholder,
  required = false,
  rows = 4,
  showCounter = false,
  value,
}: {
  compact?: boolean;
  helper?: string;
  label: string;
  maxLength?: number;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  rows?: number;
  showCounter?: boolean;
  value: string;
}) {
  return (
    <label className="grid gap-1 text-sm font-semibold text-stone-700">
      <span className="flex items-center justify-between gap-3">
        <span>
          {label}
          {required ? <span className="ml-1 text-red-600">*</span> : null}
        </span>
        {showCounter && maxLength ? (
          <span className="text-xs font-medium text-stone-500">
            {value.length} / {maxLength}
          </span>
        ) : null}
      </span>
      <textarea
        className={`seller-form-field resize-y py-3 ${
          compact ? "min-h-20" : "min-h-28"
        }`}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        rows={rows}
        value={value}
      />
      {helper ? (
        <span className="text-xs font-medium leading-5 text-stone-500">
          {helper}
        </span>
      ) : null}
    </label>
  );
}

function ReadOnlyField({
  helper,
  label,
  value,
}: {
  helper?: string;
  label: string;
  value: string;
}) {
  return (
    <label className="grid gap-1 text-sm font-semibold text-stone-700">
      {label}
      <input
        aria-readonly="true"
        className="seller-form-field cursor-not-allowed shadow-none"
        readOnly
        style={readOnlyFieldStyle}
        value={value}
      />
      {helper ? (
        <span className="text-xs font-medium leading-5 text-stone-500">
          {helper}
        </span>
      ) : null}
    </label>
  );
}

function ReadOnlyCopyField({
  helper,
  label,
  value,
}: {
  helper?: string;
  label: string;
  value: string;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");

  async function copyValue() {
    if (!value || typeof navigator === "undefined") return;

    await navigator.clipboard.writeText(value);
    setCopyState("copied");
    window.setTimeout(() => setCopyState("idle"), 1500);
  }

  return (
    <div className="grid gap-1 text-sm font-semibold text-stone-700">
      <span>{label}</span>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <input
          aria-readonly="true"
          className="seller-form-field cursor-not-allowed shadow-none"
          readOnly
          style={readOnlyFieldStyle}
          value={value}
        />
        <button className="seller-secondary-button" type="button" onClick={copyValue}>
          {copyState === "copied" ? "Copied" : "Copy"}
        </button>
      </div>
      {helper ? (
        <span className="text-xs font-medium leading-5 text-stone-500">
          {helper}
        </span>
      ) : null}
    </div>
  );
}

function ToggleField({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="inline-flex min-h-11 items-center gap-3 rounded-md border border-stone-200 bg-white px-3 text-sm font-semibold text-stone-700 shadow-sm">
      <input
        checked={Boolean(checked)}
        className="h-4 w-4 accent-emerald-800"
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      {label}
    </label>
  );
}

function buildInitialForm(
  seller: NonNullable<ReturnType<typeof useSellerContext>["seller"]>,
  defaults?: StoreDefaults | null,
): StoreAdminForm {
  return {
    store_name: seller.store_name ?? "",
    store_slug: seller.store_slug ?? "",
    store_tagline: seller.store_tagline ?? "",
    hero_subheading:
      seller.hero_subheading ??
      "Browse current availability and request pickup at checkout.",
    storefront_font_pair: normalizeStorefrontFontPair(
      seller.storefront_font_pair,
    ),
    storefront_heading_color: normalizeStorefrontHexColor(
      seller.storefront_heading_color,
      defaultStorefrontTheme.headingColor,
    ),
    storefront_text_color: normalizeStorefrontHexColor(
      seller.storefront_text_color,
      defaultStorefrontTheme.textColor,
    ),
    storefront_top_menu_color: normalizeStorefrontHexColor(
      seller.storefront_top_menu_color,
      defaultStorefrontTheme.topMenuColor,
    ),
    public_city: seller.public_city ?? "",
    public_state: seller.public_state ?? "",
    public_country: seller.public_country ?? "US",
    about_text: seller.about_text ?? "",
    website_url: seller.website_url ?? "",
    npip_number: seller.npip_number ?? "",
    show_npip: seller.show_npip,
    public_email: seller.public_email ?? "",
    show_public_email: seller.show_public_email,
    public_phone: seller.public_phone ?? "",
    show_public_phone: seller.show_public_phone,
    communication_email: defaults?.communication_email ?? "",
    pickup_method:
      defaults?.pickup_method === "manual_options" ? "manual_options" : "notes",
    pickup_location_text: defaults?.pickup_location_text ?? "",
    pickup_instructions:
      defaults?.pickup_instructions ?? seller.pickup_instructions ?? "",
    pickup_address_line1: defaults?.pickup_address_line1 ?? "",
    pickup_address_line2: defaults?.pickup_address_line2 ?? "",
    pickup_city: defaults?.pickup_city ?? "",
    pickup_state: defaults?.pickup_state ?? "",
    pickup_postal_code: defaults?.pickup_postal_code ?? "",
    pickup_country: defaults?.pickup_country ?? "US",
    default_pickup_option_id: defaults?.default_pickup_option_id ?? "",
    delivery_enabled: Boolean(defaults?.delivery_enabled),
    pickup_policy: seller.pickup_policy ?? "",
    cancellation_policy: seller.cancellation_policy ?? "",
    other_policies: seller.other_policies ?? "",
    custom_policies: toCustomPolicyDrafts(seller.custom_policies),
    order_notification_email:
      defaults?.order_notification_email ?? seller.order_notification_email ?? "",
    storefront_enabled: Boolean(seller.storefront_enabled),
    hatching_eggs_enabled: Boolean(seller.hatching_eggs_enabled),
    equipment_supplies_enabled: Boolean(seller.equipment_supplies_enabled),
    processed_poultry_enabled: Boolean(seller.processed_poultry_enabled),
  };
}

function toPickupOptionDraft(option: PickupOption): PickupOptionDraft {
  return {
    id: option.id,
    label: option.label,
    description: option.description ?? "",
    sort_order: option.sort_order,
    is_active: option.is_active,
  };
}

function toDeliveryOptionDraft(option: DeliveryOption): DeliveryOptionDraft {
  return {
    id: option.id,
    name: option.name,
    price: formatDeliveryPrice(option.price_amount),
    sort_order: option.sort_order,
    is_active: option.is_active,
  };
}

function normalizePickupOptionDrafts(options: PickupOptionDraft[]) {
  return options.map((option) => ({
    id: option.id,
    label: option.label.trim(),
    description: option.description.trim(),
    sort_order: option.sort_order,
    is_active: option.is_active,
    isNew: option.isNew ?? false,
  }));
}

function sortDeliveryOptions(options: DeliveryOptionDraft[]) {
  return [...options].sort((first, second) => first.sort_order - second.sort_order || first.name.localeCompare(second.name));
}

function getVisibleDeliveryOptions(options: DeliveryOptionDraft[]) {
  return sortDeliveryOptions(options).filter((option) => option.is_active);
}

function normalizeDeliveryOptionsForSave(options: DeliveryOptionDraft[]) {
  const visibleOptions = getVisibleDeliveryOptions(options);
  const visibleSortOrderById = new Map(
    visibleOptions.map((option, index) => [option.id, index]),
  );
  let inactiveSortOrder = visibleOptions.length;

  return sortDeliveryOptions(options).map((option) => {
    if (option.is_active) {
      return {
        ...option,
        sort_order: visibleSortOrderById.get(option.id) ?? option.sort_order,
      };
    }

    const sortOrder = inactiveSortOrder;
    inactiveSortOrder += 1;

    return { ...option, sort_order: sortOrder };
  });
}

function normalizeDeliveryOptionDrafts(options: DeliveryOptionDraft[]) {
  return options.map((option) => ({
    id: option.id,
    name: option.name.trim(),
    price: option.price.trim(),
    sort_order: option.sort_order,
    is_active: option.is_active,
    isNew: option.isNew ?? false,
  }));
}

function formatDeliveryPrice(value: number | string) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue.toFixed(2) : "";
}

function toCustomPolicyDrafts(value: unknown): CustomPolicyDraft[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((policy) => {
      if (!policy || typeof policy !== "object") return null;

      const record = policy as Record<string, unknown>;
      const title = typeof record.title === "string" ? record.title : "";
      const body = typeof record.body === "string" ? record.body : "";

      if (!title.trim() && !body.trim()) return null;

      return {
        id: `custom-policy-${crypto.randomUUID()}`,
        title,
        body,
      };
    })
    .filter((policy): policy is CustomPolicyDraft => Boolean(policy))
    .slice(0, 4);
}

function normalizeCustomPoliciesForSave(policies: CustomPolicyDraft[]) {
  return policies
    .map((policy) => ({
      title: policy.title.trim(),
      body: policy.body.trim(),
    }))
    .filter((policy) => policy.title || policy.body)
    .slice(0, 4);
}

function getStoreMediaByRole(
  items: StoreMediaItem[],
  role: StoreMediaRole,
): StoreMediaItem | null {
  const context = role === "about" ? "gallery" : role;

  return (
    sortStoreMedia(items).find(
      (item) =>
        item.display_context === context &&
        item.draft_status !== "remove" &&
        item.visibility_status === "active" &&
        item.asset_status === "active" &&
        item.moderation_status === "approved",
    ) ?? null
  );
}

function findStoreMediaByContext(
  items: StoreMediaItem[],
  context: "hero" | "logo" | "gallery",
) {
  return (
    sortStoreMedia(items).find((item) => item.display_context === context) ??
    null
  );
}

function toMediaDirtySignature(items: StoreMediaItem[]) {
  return sortStoreMedia(items).map((item) => ({
    context: item.display_context,
    crop: item.crop_metadata ?? null,
    draftStatus: item.draft_status ?? null,
    filename: item.draft_file?.name ?? item.original_filename ?? null,
    heroLayout: item.hero_layout ?? null,
    id: item.media_link_id,
    publicUrl: item.preview_url ?? item.public_url,
    sourceImageUrl: item.source_image_url ?? null,
    sourceType: item.source_type ?? null,
  }));
}

function sortStoreMedia(items: StoreMediaItem[]) {
  return [...items].sort((first, second) => {
    const contextCompare = mediaContextWeight(first.display_context) - mediaContextWeight(second.display_context);

    if (contextCompare !== 0) return contextCompare;

    if (first.is_featured !== second.is_featured) {
      return first.is_featured ? -1 : 1;
    }

    const firstSort = first.sort_order ?? 0;
    const secondSort = second.sort_order ?? 0;

    if (firstSort !== secondSort) return firstSort - secondSort;

    return first.media_link_id.localeCompare(second.media_link_id);
  });
}

function mediaContextWeight(context: string) {
  if (context === "logo") return 0;
  if (context === "hero") return 1;
  if (context === "gallery") return 2;
  return 3;
}

function validateStoreMediaFile(file: File) {
  if (!acceptedStoreImageTypes.includes(file.type)) {
    return "Use a JPG, PNG, or WebP photo.";
  }

  if (file.size <= 0 || file.size > maxStoreImageSizeBytes) {
    return "Use a photo under 8 MB.";
  }

  return null;
}

function toStoreAdminImageUrl(publicUrl: string) {
  if (publicUrl.startsWith("http")) return publicUrl;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (publicUrl.startsWith("/") && supabaseUrl) {
    return `${supabaseUrl}${publicUrl}`;
  }

  return publicUrl;
}

function toStoreAdminMediaImageUrl(media: StoreMediaItem) {
  if (media.preview_url) return media.preview_url;

  if (
    media.source_type === "storefront_hero_library" &&
    media.source_image_url
  ) {
    return media.source_image_url;
  }

  return toStoreAdminImageUrl(media.public_url);
}

function buildLaunchSummary(
  readinessItems: LaunchReadinessItem[],
  form: StoreAdminForm,
) {
  const readiness = new Map(
    readinessItems.map((item) => [item.item_key, item]),
  );
  const isReady = (key: string) => readiness.get(key)?.passed === true;
  const hasPickupPolicy = Boolean(form.pickup_policy.trim());
  const platformReviewNeeded = [
    "store_exists",
    "seller_owns_store",
    "no_admin_hold",
  ].some((key) => readiness.has(key) && !isReady(key));
  const storeStatusBlocked =
    readiness.has("store_status_draft") && !isReady("store_status_draft");
  const requiredItems: SellerLaunchItem[] = [
    {
      key: "store-profile",
      label: "Store profile",
      passed: isReady("store_name_present") && isReady("store_slug_present"),
      action: "Add your store name and store URL.",
    },
    {
      key: "location",
      label: "Location",
      passed: isReady("location_present"),
      action: "Add your city and state.",
    },
    {
      key: "pickup-policy",
      label: "Pickup policy",
      passed: hasPickupPolicy,
      action: "Add pickup policy in Policies.",
    },
    {
      key: "billing-terms",
      label: "Billing and terms",
      passed: isReady("terms_accepted") && isReady("billing_access_active"),
      action: "Finish billing and seller terms.",
    },
    {
      key: "available-inventory",
      label: "Available inventory",
      passed: isReady("saleable_inventory"),
      action: "Publish at least one listing with available quantity.",
    },
  ];
  const warningItems: SellerLaunchItem[] = [
    {
      key: "store-image",
      label: "Store image",
      passed: isReady("store_image_present"),
      action: "Add a logo or store image.",
    },
    {
      key: "about-section",
      label: "About section",
      passed: isReady("about_text_present"),
      action: "Add an about section.",
    },
    {
      key: "public-email",
      label: "Public email",
      passed: isReady("public_email_present"),
      action: "Add a public email.",
    },
    {
      key: "inventory-quantity",
      label: "Inventory quantity",
      passed: isReady("inventory_quantity"),
      action: "Add more available quantity when you can.",
    },
  ];

  return {
    platformReviewNeeded: platformReviewNeeded || storeStatusBlocked,
    requiredItems,
    warningItems,
  };
}

function validateForm(
  form: StoreAdminForm,
  pickupOptions: PickupOptionDraft[],
  activeTab: StoreSetupTab,
) {
  if (!form.store_name.trim()) return "Store name is required.";
  if (!form.public_city.trim()) return "City is required.";
  if (!form.public_state.trim()) return "State is required.";
  if (!form.store_tagline.trim()) return "Hero headline is required.";
  if (form.store_tagline.trim().length > heroHeadlineMaxLength) {
    return `Hero headline must be ${heroHeadlineMaxLength} characters or fewer.`;
  }
  if (!form.hero_subheading.trim()) return "Hero subheading is required.";
  if (form.hero_subheading.trim().length > heroSubheadingMaxLength) {
    return `Hero subheading must be ${heroSubheadingMaxLength} characters or fewer.`;
  }
  if (
    !storefrontFontPairs.some((pair) => pair.id === form.storefront_font_pair)
  ) {
    return "Choose a valid storefront font style.";
  }
  if (!isValidStorefrontHexColor(form.storefront_heading_color)) {
    return "Primary color needs a valid 6-digit hex value.";
  }
  if (!isValidStorefrontHexColor(form.storefront_text_color)) {
    return "Text color needs a valid 6-digit hex value.";
  }
  if (!isValidStorefrontHexColor(form.storefront_top_menu_color)) {
    return "Top menu color needs a valid 6-digit hex value.";
  }
  if (!form.about_text.trim()) return "Farm story is required.";
  if (form.about_text.trim().length > farmStoryMaxLength) {
    return `Farm story must be ${farmStoryMaxLength} characters or fewer.`;
  }
  if (activeTab === "pickup") {
    if (!form.pickup_address_line1.trim()) {
      return "Pickup address needs a street address.";
    }
    if (!form.pickup_city.trim()) return "Pickup address needs a city.";
    if (!form.pickup_state.trim()) return "Pickup address needs a state.";
    if (!form.pickup_postal_code.trim()) {
      return "Pickup address needs a ZIP code.";
    }
  }

  for (const option of pickupOptions) {
    if (option.is_active && !option.isNew && !option.label.trim()) {
      return "Each visible pickup choice needs a label.";
    }
  }

  for (const policy of form.custom_policies) {
    const hasTitle = Boolean(policy.title.trim());
    const hasBody = Boolean(policy.body.trim());

    if (hasTitle && !hasBody) {
      return "Each custom policy with a title needs policy text.";
    }

    if (hasBody && !hasTitle) {
      return "Each custom policy with text needs a title.";
    }
  }

  return null;
}

function validateDeliveryOptions(options: DeliveryOptionDraft[]) {
  for (const option of options) {
    if (!option.is_active) continue;

    const hasName = Boolean(option.name.trim());
    const hasPrice = Boolean(option.price.trim());

    if (option.isNew && !hasName && !hasPrice) continue;
    if (!hasName) return "Each delivery option needs a name.";
    if (!hasPrice) return "Each delivery option needs a price.";

    const price = Number(option.price.trim());

    if (!Number.isFinite(price)) {
      return "Delivery price must be a valid amount.";
    }

    if (price < 0) {
      return "Delivery price cannot be negative.";
    }
  }

  return null;
}

function useUnsavedWarning(
  hasUnsavedChanges: boolean,
  onBlockedNavigation: (nextUrl: string) => void,
) {
  useEffect(() => {
    if (!hasUnsavedChanges) return;

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = unsavedWarning;
      return unsavedWarning;
    }

    function handleLinkClick(event: MouseEvent) {
      const target = event.target;

      if (!(target instanceof Element)) return;

      const link = target.closest("a[href]");

      if (!(link instanceof HTMLAnchorElement)) return;
      if (link.target && link.target !== "_self") return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      const nextUrl = new URL(link.href);

      if (nextUrl.href === window.location.href) return;

      event.preventDefault();
      event.stopPropagation();
      onBlockedNavigation(nextUrl.href);
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleLinkClick, true);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleLinkClick, true);
    };
  }, [hasUnsavedChanges, onBlockedNavigation]);
}
