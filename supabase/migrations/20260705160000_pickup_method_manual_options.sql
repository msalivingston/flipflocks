-- Store-level pickup method selection for the lightweight pickup flow.
-- This enables the existing store_pickup_options table in buyer checkout
-- without adding scheduling/window/capacity concepts.

alter table public.stores
add column if not exists pickup_method text not null default 'notes';

alter table public.stores
drop constraint if exists stores_pickup_method_check;

alter table public.stores
add constraint stores_pickup_method_check
check (pickup_method in ('notes', 'manual_options'));

comment on column public.stores.pickup_method is
'How buyers handle pickup at checkout. notes uses the freeform pickup note; manual_options lets buyers select an active store_pickup_options row.';

create or replace view public.seller_store_defaults
with (security_barrier = true)
as
select
  stores.id as store_id,
  stores.pickup_instructions,
  stores.pickup_location_text,
  stores.default_pickup_option_id,
  store_pickup_options.label as default_pickup_option_label,
  stores.communication_email,
  stores.order_notification_email,
  stores.currency,
  stores.updated_at,
  stores.pickup_method
from public.stores
left join public.store_pickup_options
  on store_pickup_options.id = stores.default_pickup_option_id
 and store_pickup_options.store_id = stores.id
where public.owns_store(stores.id)
   or public.is_admin();

comment on view public.seller_store_defaults is
'Seller-private defaults used to prefill seller workflows. This is intentionally narrow and avoids broad settings infrastructure.';

revoke all on public.seller_store_defaults from public;
grant select on public.seller_store_defaults to authenticated;

create or replace function public.seller_update_store_defaults(
  p_store_id uuid,
  p_defaults jsonb
)
returns setof public.seller_store_defaults
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed_keys text[] := array[
    'pickup_method',
    'pickup_instructions',
    'pickup_location_text',
    'default_pickup_option_id',
    'communication_email',
    'order_notification_email',
    'currency'
  ];
  v_unknown_keys text;
  v_default_pickup_option_id uuid;
  v_currency text;
  v_pickup_method text;
begin
  if not (
    public.owns_store(p_store_id)
    or public.is_admin()
  ) then
    raise exception 'Not authorized to update defaults for this store.';
  end if;

  if p_defaults is null
    or jsonb_typeof(p_defaults) <> 'object' then
    raise exception 'Defaults must be provided as an object.';
  end if;

  select string_agg(key, ', ' order by key)
  into v_unknown_keys
  from jsonb_object_keys(p_defaults) as key
  where key <> all (v_allowed_keys);

  if v_unknown_keys is not null then
    raise exception 'Unsupported store default fields: %', v_unknown_keys;
  end if;

  if p_defaults ? 'pickup_method' then
    v_pickup_method := nullif(trim(p_defaults ->> 'pickup_method'), '');

    if v_pickup_method not in ('notes', 'manual_options') then
      raise exception 'Pickup method must be notes or manual_options.';
    end if;
  end if;

  if p_defaults ? 'default_pickup_option_id'
    and nullif(trim(p_defaults ->> 'default_pickup_option_id'), '') is not null then
    v_default_pickup_option_id := (p_defaults ->> 'default_pickup_option_id')::uuid;

    if not exists (
      select 1
      from public.store_pickup_options
      where store_pickup_options.id = v_default_pickup_option_id
        and store_pickup_options.store_id = p_store_id
        and store_pickup_options.is_active = true
    ) then
      raise exception 'Default pickup option is not available for this store.';
    end if;
  end if;

  if p_defaults ? 'currency' then
    v_currency := lower(nullif(trim(p_defaults ->> 'currency'), ''));

    if v_currency is null
      or v_currency !~ '^[a-z]{3}$' then
      raise exception 'Currency must be a three-letter ISO code.';
    end if;
  end if;

  update public.stores
  set
    pickup_method = case
      when p_defaults ? 'pickup_method' then v_pickup_method
      else stores.pickup_method
    end,
    pickup_instructions = case
      when p_defaults ? 'pickup_instructions' then nullif(trim(p_defaults ->> 'pickup_instructions'), '')
      else stores.pickup_instructions
    end,
    pickup_location_text = case
      when p_defaults ? 'pickup_location_text' then nullif(trim(p_defaults ->> 'pickup_location_text'), '')
      else stores.pickup_location_text
    end,
    default_pickup_option_id = case
      when p_defaults ? 'default_pickup_option_id' then v_default_pickup_option_id
      else stores.default_pickup_option_id
    end,
    communication_email = case
      when p_defaults ? 'communication_email' then lower(nullif(trim(p_defaults ->> 'communication_email'), ''))
      else stores.communication_email
    end,
    order_notification_email = case
      when p_defaults ? 'order_notification_email' then lower(nullif(trim(p_defaults ->> 'order_notification_email'), ''))
      else stores.order_notification_email
    end,
    currency = case
      when p_defaults ? 'currency' then v_currency
      else stores.currency
    end
  where stores.id = p_store_id;

  return query
  select *
  from public.seller_store_defaults
  where seller_store_defaults.store_id = p_store_id;
end;
$$;

comment on function public.seller_update_store_defaults(uuid, jsonb) is
'Trusted seller defaults update helper. Allows pickup method, pickup text defaults, default pickup option, communication/order email, and currency.';

revoke all on function public.seller_update_store_defaults(uuid, jsonb) from public;
grant execute on function public.seller_update_store_defaults(uuid, jsonb) to authenticated;

create or replace view public.public_storefront_pickup_options
with (security_barrier = true)
as
select
  store_pickup_options.store_id,
  stores.store_slug,
  store_pickup_options.id as pickup_option_id,
  store_pickup_options.label,
  store_pickup_options.description,
  store_pickup_options.sort_order
from public.store_pickup_options
join public.stores
  on stores.id = store_pickup_options.store_id
where stores.storefront_enabled = true
  and stores.store_status = 'live'
  and stores.storefront_mode in ('hosted', 'embedded')
  and stores.admin_hold_reason is null
  and stores.pickup_method = 'manual_options'
  and store_pickup_options.is_active = true;

comment on view public.public_storefront_pickup_options is
'Buyer-facing active pickup options for stores using the manual_options pickup method.';

grant select on public.public_storefront_pickup_options to anon, authenticated;

drop function if exists public.get_public_storefront_home(text);

create or replace function public.get_public_storefront_home(
  p_store_slug text
)
returns table (
  store_id uuid,
  store_slug text,
  store_name text,
  store_tagline text,
  public_city text,
  public_state text,
  public_country text,
  about_text text,
  pickup_policy text,
  cancellation_policy text,
  pickup_instructions text,
  pickup_method text,
  public_email text,
  public_phone text,
  website_url text,
  social_url text,
  npip_number text,
  hero_image_url text,
  hero_image_alt_text text,
  logo_image_url text,
  logo_image_alt_text text,
  public_inventory_item_count bigint,
  ready_now_item_count bigint,
  reserve_now_item_count bigint,
  sold_out_item_count bigint,
  total_quantity_available bigint,
  next_available_date date,
  has_public_inventory boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with storefront_status as (
    select *
    from public.get_storefront_public_status(p_store_slug)
  ),
  target_store as (
    select stores.*
    from public.stores
    join storefront_status
      on storefront_status.store_slug = stores.store_slug
    where storefront_status.store_exists = true
      and storefront_status.is_publicly_available = true
  ),
  public_inventory as (
    select
      public_storefront_inventory.quantity_available,
      public_storefront_inventory.available_date,
      public_storefront_inventory.buyer_availability_code
    from target_store
    join public.public_storefront_inventory
      on public_storefront_inventory.store_id = target_store.id
  ),
  inventory_summary as (
    select
      count(*) as public_inventory_item_count,
      count(*) filter (
        where public_inventory.buyer_availability_code = 'ready_now'
      ) as ready_now_item_count,
      count(*) filter (
        where public_inventory.buyer_availability_code = 'reserve_now'
      ) as reserve_now_item_count,
      count(*) filter (
        where public_inventory.buyer_availability_code = 'sold_out'
      ) as sold_out_item_count,
      coalesce(sum(public_inventory.quantity_available), 0)::bigint as total_quantity_available,
      min(public_inventory.available_date) filter (
        where public_inventory.quantity_available > 0
      ) as next_available_date
    from public_inventory
  )
  select
    target_store.id as store_id,
    target_store.store_slug,
    target_store.store_name,
    target_store.store_tagline,
    target_store.public_city,
    target_store.public_state,
    target_store.public_country,
    target_store.about_text,
    target_store.pickup_policy,
    target_store.cancellation_policy,
    target_store.pickup_instructions,
    target_store.pickup_method,
    case
      when target_store.show_public_email then target_store.public_email
      else null
    end as public_email,
    case
      when target_store.show_public_phone then target_store.public_phone
      else null
    end as public_phone,
    target_store.website_url,
    target_store.social_url,
    case
      when target_store.show_npip then target_store.npip_number
      else null
    end as npip_number,
    hero_media.image_url as hero_image_url,
    hero_media.alt_text as hero_image_alt_text,
    logo_media.image_url as logo_image_url,
    logo_media.alt_text as logo_image_alt_text,
    coalesce(inventory_summary.public_inventory_item_count, 0),
    coalesce(inventory_summary.ready_now_item_count, 0),
    coalesce(inventory_summary.reserve_now_item_count, 0),
    coalesce(inventory_summary.sold_out_item_count, 0),
    coalesce(inventory_summary.total_quantity_available, 0),
    inventory_summary.next_available_date,
    coalesce(inventory_summary.public_inventory_item_count, 0) > 0
  from target_store
  cross join inventory_summary
  left join lateral (
    select
      '/storage/v1/object/public/' || media_assets.bucket_name || '/' || media_assets.storage_path as image_url,
      coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text
    from public.media_links
    join public.media_assets
      on media_assets.id = media_links.media_asset_id
     and media_assets.store_id = media_links.store_id
    where media_links.store_id = target_store.id
      and media_links.entity_type = 'store'
      and media_links.entity_id = target_store.id
      and media_links.display_context = 'hero'
      and media_links.visibility_status = 'active'
      and media_assets.asset_status = 'active'
      and media_assets.moderation_status = 'approved'
    order by media_links.is_featured desc, media_links.sort_order, media_links.created_at
    limit 1
  ) as hero_media on true
  left join lateral (
    select
      '/storage/v1/object/public/' || media_assets.bucket_name || '/' || media_assets.storage_path as image_url,
      coalesce(media_links.alt_text_override, media_assets.alt_text) as alt_text
    from public.media_links
    join public.media_assets
      on media_assets.id = media_links.media_asset_id
     and media_assets.store_id = media_links.store_id
    where media_links.store_id = target_store.id
      and media_links.entity_type = 'store'
      and media_links.entity_id = target_store.id
      and media_links.display_context = 'logo'
      and media_links.visibility_status = 'active'
      and media_assets.asset_status = 'active'
      and media_assets.moderation_status = 'approved'
    order by media_links.is_featured desc, media_links.sort_order, media_links.created_at
    limit 1
  ) as logo_media on true;
$$;

comment on function public.get_public_storefront_home(text) is
'Slug-scoped public storefront home payload. Uses get_storefront_public_status for public availability, respects disabled public selling modules in inventory summary counts, includes pickup_method, and returns only public-safe storefront fields.';

revoke all on function public.get_public_storefront_home(text) from public;
grant execute on function public.get_public_storefront_home(text) to anon, authenticated;
