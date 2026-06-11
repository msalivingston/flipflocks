export type AdminStoreListRow = {
  store_id: string;
  owner_user_id: string;
  owner_email: string | null;
  store_name: string;
  store_slug: string;
  store_status: string;
  storefront_mode: string;
  storefront_enabled: boolean;
  admin_hold_reason: string | null;
  hatching_eggs_enabled: boolean;
  equipment_supplies_enabled: boolean;
  processed_poultry_enabled: boolean;
  listing_batch_count: number;
  inventory_item_count: number;
  total_inventory_quantity: number;
  customer_count: number;
  equipment_item_count: number;
  processed_poultry_item_count: number;
  open_order_count: number;
  canceled_order_count: number;
  fulfilled_order_count: number;
  pending_refund_count: number;
  failed_notification_count: number;
  created_at: string | null;
  updated_at: string | null;
};

export type AdminStoreDetailRow = AdminStoreListRow & {
  admin_suspended_at: string | null;
  admin_suspended_by_user_id: string | null;
  admin_reactivated_at: string | null;
  admin_reactivated_by_user_id: string | null;
  admin_suspension_previous_store_status: string | null;
};

export type AdminActivityRow = {
  admin_activity_event_id: string;
  actor_user_id: string | null;
  action_type: string;
  target_store_id: string | null;
  target_order_id: string | null;
  target_refund_id: string | null;
  target_notification_id: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type AdminRecentOrderRow = {
  order_id: string;
  order_number: string;
  order_status: string;
  payment_method: string | null;
  payment_status: string | null;
  total_amount: number | null;
  item_count: number;
  refund_count: number;
  buyer_email_snapshot: string | null;
  buyer_phone_snapshot: string | null;
  created_at: string;
  updated_at: string | null;
};

export type AdminCatalogBreedListRow = {
  breed_id: string;
  species_id: string;
  species_name: string;
  species_slug: string;
  breed_name: string;
  breed_slug: string;
  image_url: string | null;
  has_image: boolean;
  category: string | null;
  bird_type: string | null;
  egg_color: string | null;
  annual_egg_production: string | null;
  image_prompt: string | null;
  is_active: boolean;
  sort_order: number;
  updated_at: string | null;
};

export type AdminCatalogBreedDetailRow = AdminCatalogBreedListRow & {
  description: string | null;
};
