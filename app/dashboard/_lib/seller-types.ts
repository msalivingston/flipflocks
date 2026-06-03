export type SellerContext = {
  store_id: string;
  store_name: string;
  store_tagline: string | null;
  store_slug: string;
  store_status: string;
  storefront_mode: string;
  storefront_enabled: boolean;
  is_publicly_available: boolean;
  public_city: string | null;
  public_state: string | null;
  public_country: string | null;
  about_text: string | null;
  pickup_policy: string | null;
  cancellation_policy: string | null;
  other_policies: string | null;
  pickup_instructions: string | null;
  public_email: string | null;
  public_phone: string | null;
  show_public_email: boolean;
  show_public_phone: boolean;
  website_url: string | null;
  social_url: string | null;
  npip_number: string | null;
  show_npip: boolean;
  order_notification_email: string | null;
  billing_plan: string | null;
  subscription_status: string | null;
  storefront_access_until: string | null;
  trial_ends_at: string | null;
  profile_complete: boolean;
  billing_complete: boolean;
  terms_accepted: boolean;
  first_listing_created: boolean;
  ready_to_launch: boolean;
  launched_at: string | null;
  role: string | null;
  is_admin: boolean;
};

export type SellerDashboardHome = {
  store_id: string;
  store_name: string;
  store_slug: string;
  storefront_enabled: boolean;
  store_status: string;
  storefront_mode: string;
  is_publicly_available: boolean;
  unavailable_reason_code: string | null;
  active_listing_count: number | null;
  sold_out_listing_count: number | null;
  total_active_inventory_quantity: number | null;
  pending_open_order_count: number | null;
  fulfilled_order_count: number | null;
  canceled_order_count: number | null;
  oldest_order_requiring_action_at: string | null;
  pending_refund_count: number | null;
  failed_refund_count: number | null;
  failed_notification_count: number | null;
  pending_notification_count: number | null;
  upcoming_pickup_order_count: number | null;
};

export type SellerOrderSummary = {
  order_id: string;
  order_number: string;
  order_status: string;
  payment_status: string | null;
  created_at: string;
  buyer_first_name_snapshot: string | null;
  buyer_last_name_snapshot: string | null;
  buyer_email_snapshot: string | null;
  buyer_phone_snapshot: string | null;
  total_amount: number | null;
  item_count: number | null;
  total_item_quantity: number | null;
  pickup_option_label_snapshot: string | null;
};

export type SellerInventoryRow = {
  inventory_item_id: string;
  listing_batch_id: string;
  species_name: string;
  species_slug: string;
  breed_display_name: string;
  origin_date: string | null;
  available_date: string;
  base_price: number | null;
  quantity_available: number | null;
  inventory_type: string;
  custom_inventory_label: string | null;
  effective_unit_price: number | null;
  listing_batch_visibility_status: string;
  listing_batch_moderation_status: string;
  inventory_visibility_status: string;
  inventory_moderation_status: string;
  operational_availability_status: string;
  inventory_updated_at: string | null;
};

export type SellerInventoryManagementRow = SellerInventoryRow & {
  store_id: string;
  listing_batch_breed_id: string;
  inventory_item_id: string;
  species_id: string;
  species_slug: string;
  seller_breed_profile_id: string;
  batch_type: string;
  origin_date: string | null;
  age_at_availability_days: number | null;
  auto_price_increase_enabled: boolean | null;
  auto_price_increase_amount: number | null;
  auto_price_increase_max_price: number | null;
  auto_price_adjustment_enabled: boolean | null;
  price_adjustment_direction: string | null;
  price_adjustment_amount: number | null;
  price_adjustment_interval_weeks: number | null;
  price_adjustment_max_price: number | null;
  price_adjustment_min_price: number | null;
  internal_batch_label: string | null;
  listing_batch_moderation_status: string;
  listing_batch_breed_sort_order: number | null;
  listing_batch_breed_visibility_status: string;
  listing_batch_breed_moderation_status: string;
  inventory_type: string;
  custom_inventory_label: string | null;
  price_override: number | null;
  inventory_item_sort_order: number | null;
  inventory_moderation_status: string;
  inventory_seller_notes: string | null;
  listing_batch_breed_seller_notes: string | null;
  listing_batch_seller_notes: string | null;
  listing_batch_updated_at: string | null;
};

export type ReferenceSpecies = {
  id: string;
  common_name: string;
  slug: string;
  sort_order: number | null;
};

export type ReferenceBreed = {
  id: string;
  species_id: string;
  breed_name: string;
  breed_slug: string;
  sort_order: number | null;
};

export type ReferenceBreedAlias = {
  breed_id: string;
  alias: string;
};

export type SellerBreedProfileOption = {
  id: string;
  species_id: string;
  breed_id: string | null;
  custom_breed_name: string | null;
  display_name: string;
  seller_description: string | null;
  seller_notes: string | null;
  visibility_status: string;
};
