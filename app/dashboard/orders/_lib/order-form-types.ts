export type ListingInventoryRow = {
  inventory_item_id: string;
  listing_batch_id: string;
  breed_display_name: string;
  batch_type: string;
  inventory_type: string;
  custom_inventory_label: string | null;
  origin_date: string | null;
  available_date: string;
  quantity_available: number | null;
  effective_unit_price: number | null;
  inventory_visibility_status: string;
  inventory_moderation_status: string;
  listing_batch_visibility_status: string;
  listing_batch_moderation_status: string;
  operational_availability_status: string;
};

export type EquipmentInventoryRow = {
  equipment_inventory_item_id: string;
  item_name: string;
  category: string;
  condition: string | null;
  quantity_available: number;
  price: number;
  visibility_status: string;
  moderation_status: string;
  operational_availability_status: string;
};

export type ProcessedPoultryInventoryRow = {
  processed_poultry_inventory_item_id: string;
  product_name: string;
  poultry_type: string;
  product_type: string;
  package_size: string | null;
  quantity_available: number;
  price: number;
  visibility_status: string;
  moderation_status: string;
  operational_availability_status: string;
};

export type InventoryItemType =
  | "listing_inventory"
  | "equipment_inventory"
  | "processed_poultry_inventory";

export type BrowseInventoryFilter =
  | "all"
  | "poultry"
  | "hatching_eggs"
  | "processed_poultry"
  | "equipment";

export type InventoryCategory = Exclude<BrowseInventoryFilter, "all">;

export type InventorySearchRow = {
  id: string;
  itemType: InventoryItemType;
  title: string;
  category: InventoryCategory;
  detailLabel: string;
  quantity_available: number;
  effective_unit_price: number;
  operational_availability_status: string;
  allowInventoryOverride: boolean;
};

export type OrderLine = {
  type: "inventory" | "custom";
  id: string;
  orderItemId?: string;
  inventoryItemId: string;
  inventoryItemType: InventoryItemType | "";
  customItemName: string;
  customItemDescription: string;
  savedItemCategory?: InventoryCategory;
  savedItemDetail?: string;
  savedItemName?: string;
  search: string;
  quantity: string;
  unitPrice: string;
};

export type DiscountType = "fixed" | "percent";

export type FulfillmentMethod = "pickup" | "delivery";

export type PickupMethod = "notes" | "manual_options";

export type StoreDefaults = {
  pickup_method: PickupMethod | null;
  delivery_enabled: boolean | null;
};

export type PickupOption = {
  id: string;
  label: string;
  description: string | null;
};

export type DeliveryOption = {
  id: string;
  name: string;
  price_amount: number | null;
};

export type DeliveryAddress = {
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};
