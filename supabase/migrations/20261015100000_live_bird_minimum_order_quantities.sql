-- Two store policies; bird groups are derived at checkout using database dates.
begin;

alter table public.stores
  add column minimum_chick_order_quantity integer not null default 0
    check (minimum_chick_order_quantity >= 0),
  add column minimum_started_adult_bird_order_quantity integer not null default 0
    check (minimum_started_adult_bird_order_quantity >= 0);

-- Keep the current context/settings contracts, including intervening migrations.
do $migration$
declare
  v_context text := replace(pg_get_functiondef('public.get_seller_context()'::regprocedure), chr(13), '');
  v_settings text := replace(pg_get_functiondef('public.seller_update_store_settings(uuid,jsonb)'::regprocedure), chr(13), '');
begin
  if position('custom_policies jsonb' in v_context) = 0
    or position('stores.custom_policies' in v_context) = 0
    or position('''custom_policies''' in v_settings) = 0
    or position('custom_policies = v_custom_policies,' in v_settings) = 0 then
    raise exception 'Minimum quantity settings patch does not match existing store contracts.';
  end if;
  v_context := replace(v_context, 'custom_policies jsonb',
    'custom_policies jsonb, minimum_chick_order_quantity integer, minimum_started_adult_bird_order_quantity integer');
  v_context := replace(v_context, 'stores.custom_policies',
    'stores.custom_policies, stores.minimum_chick_order_quantity, stores.minimum_started_adult_bird_order_quantity');
  v_settings := regexp_replace(v_settings, '''custom_policies''',
    '''custom_policies'', ''minimum_chick_order_quantity'', ''minimum_started_adult_bird_order_quantity''');
  v_settings := replace(v_settings, 'custom_policies = v_custom_policies,', $patch$
    custom_policies = v_custom_policies,
    minimum_chick_order_quantity = case when p_settings ? 'minimum_chick_order_quantity'
      then (p_settings ->> 'minimum_chick_order_quantity')::integer else stores.minimum_chick_order_quantity end,
    minimum_started_adult_bird_order_quantity = case when p_settings ? 'minimum_started_adult_bird_order_quantity'
      then (p_settings ->> 'minimum_started_adult_bird_order_quantity')::integer else stores.minimum_started_adult_bird_order_quantity end,
  $patch$);
  -- Integer casts and column constraints reject null, fractions and negatives.
  drop function public.get_seller_context();
  execute v_context;
  execute v_settings;
end;
$migration$;
revoke all on function public.get_seller_context() from public, anon, authenticated, service_role;
grant execute on function public.get_seller_context() to authenticated;

-- Normalize at each database entry point as well as at the Edge boundary.
-- Seller persistence retains its existing 'inventory'/inventory_item_id format;
-- checkout and all minimum calculations use listing_inventory/item_id.
create function public.normalize_order_inventory_items(p_items jsonb, p_seller_items boolean default false)
returns jsonb language plpgsql immutable
set search_path = pg_catalog, public
as $function$
declare
  v_item jsonb;
  v_result jsonb := '[]'::jsonb;
  v_type text;
  v_current_id text;
  v_legacy_id text;
  v_id uuid;
  v_quantity integer;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Order items must be an array.';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Each checkout item must be an object.';
    end if;
    v_current_id := v_item ->> 'item_id';
    v_legacy_id := v_item ->> 'inventory_item_id';
    v_type := coalesce(v_item ->> 'item_type',
      case when v_legacy_id is not null or p_seller_items then 'listing_inventory' end);
    if p_seller_items and v_type = 'inventory' then v_type := 'listing_inventory'; end if;
    if (v_legacy_id is not null and v_type <> 'listing_inventory')
      or (v_current_id is not null and v_legacy_id is not null and lower(v_current_id) <> lower(v_legacy_id))
      or (v_item ->> 'inventory_item_type' is not null
        and v_item ->> 'inventory_item_type' <> v_type) then
      raise exception 'Conflicting or ambiguous inventory identifiers.';
    end if;
    if v_type is null or v_type not in ('listing_inventory','equipment_inventory','processed_poultry_inventory','hatching_egg_inventory') then
      if not (p_seller_items and v_type = 'custom' and v_current_id is null and v_legacy_id is null) then
        raise exception 'Each checkout item must include a valid item type, item ID, and positive quantity.';
      end if;
    end if;
    if (v_current_id is not null and v_current_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
      or (v_legacy_id is not null and v_legacy_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
      or (v_type <> 'custom' and coalesce(v_current_id,v_legacy_id) is null) then
      raise exception 'Each checkout item must include a valid item type, item ID, and positive quantity.';
    end if;
    if coalesce(v_item ->> 'quantity','') !~ '^[0-9]+$'
      or length(v_item ->> 'quantity') > 10 then
      raise exception 'Each checkout item quantity must be a positive integer.';
    end if;
    if (v_item ->> 'quantity')::bigint not between 1 and 2147483647 then
      raise exception 'Each checkout item quantity must be a positive integer.';
    end if;
    v_id := coalesce(v_current_id,v_legacy_id)::uuid;
    v_quantity := (v_item ->> 'quantity')::integer;
    if p_seller_items then
      v_result := v_result || jsonb_build_array(
        (v_item - 'item_id' - 'inventory_item_id') || jsonb_build_object(
          'item_type', case when v_type='listing_inventory' then 'inventory' else v_type end,
          case when v_type='listing_inventory' then 'inventory_item_id' else 'item_id' end, v_id,
          'quantity', v_quantity));
    else
      v_result := v_result || jsonb_build_array(jsonb_build_object('item_type',v_type,'item_id',v_id,'quantity',v_quantity));
    end if;
  end loop;
  return v_result;
end;
$function$;
revoke all on function public.normalize_order_inventory_items(jsonb,boolean) from public, anon, authenticated, service_role;

-- Private evaluator shared by preflight and locked creation/editing paths.
-- Input is the existing checkout/manual item format; never trust a client age.
create function public.live_bird_minimum_order_shortages(p_store_id uuid, p_items jsonb)
returns table (bird_group text, minimum_quantity integer, quantity bigint, additional_quantity bigint, message text)
language sql stable security definer
set search_path = pg_catalog, public
as $function$
  with birds as (
    select (greatest(current_date, batch.available_date) - batch.origin_date) as age_days,
      (item ->> 'quantity')::bigint as quantity
    from jsonb_array_elements(p_items) item
    join public.inventory_items inventory
      on inventory.id = (item ->> 'item_id')::uuid
      and inventory.store_id = p_store_id
    join public.listing_batches batch on batch.id = inventory.listing_batch_id and batch.store_id = p_store_id
    where item ->> 'item_type' = 'listing_inventory'
      and batch.batch_type = 'live_animals' and inventory.inventory_type <> 'hatching_eggs'
  ), totals as (
    select coalesce(sum(quantity) filter (where age_days < 14), 0) as chicks,
      coalesce(sum(quantity) filter (where age_days >= 14), 0) as started_adults
    from birds
  ), requirements as (
    select 'chicks'::text as bird_group, 'Chicks'::text as label,
      store.minimum_chick_order_quantity as minimum_quantity, totals.chicks as quantity
    from public.stores store cross join totals where store.id = p_store_id
    union all
    select 'started_adult_birds', 'Started & Adult Birds',
      store.minimum_started_adult_bird_order_quantity, totals.started_adults
    from public.stores store cross join totals where store.id = p_store_id
  )
  select bird_group, minimum_quantity, quantity, minimum_quantity - quantity,
    format('This store requires at least %s %s per order. You have %s. Add %s more %s to continue.',
      minimum_quantity, label, quantity, minimum_quantity - quantity,
      case when bird_group = 'chicks' then 'chicks' else 'Started & Adult Birds' end)
  from requirements where minimum_quantity > 0 and quantity > 0 and quantity < minimum_quantity;
$function$;
revoke all on function public.live_bird_minimum_order_shortages(uuid,jsonb) from public, anon, authenticated, service_role;

create function public.assert_live_bird_minimum_order_quantities(p_store_id uuid, p_items jsonb)
returns void language plpgsql security definer
set search_path = pg_catalog, public
as $function$
declare
  v_message text;
begin
  -- Serialize with policy and hatch/ready-date edits until the order commits.
  perform 1 from public.stores where id = p_store_id for share;
  if not exists (select 1 from public.stores where id = p_store_id
    and (minimum_chick_order_quantity > 0 or minimum_started_adult_bird_order_quantity > 0)) then
    return;
  end if;
  perform 1 from public.listing_batches batch
  where batch.store_id = p_store_id and batch.id in (
    select inventory.listing_batch_id from jsonb_array_elements(p_items) item
    join public.inventory_items inventory
      on inventory.id = (item ->> 'item_id')::uuid
      and inventory.store_id = p_store_id
    where item ->> 'item_type' = 'listing_inventory'
  ) order by batch.id for share;
  if exists (
    select 1 from jsonb_array_elements(p_items) item
    join public.inventory_items inventory
      on inventory.id = (item ->> 'item_id')::uuid
      and inventory.store_id = p_store_id
    join public.listing_batches batch on batch.id = inventory.listing_batch_id
    where item ->> 'item_type' = 'listing_inventory'
      and batch.batch_type = 'live_animals' and inventory.inventory_type <> 'hatching_eggs'
      and (batch.origin_date is null or batch.available_date is null or batch.available_date < batch.origin_date)
  ) then
    raise exception using errcode = 'P0001', message = 'Bird hatch or availability date is missing or invalid. Please contact the seller.';
  end if;
  select string_agg(shortage.message, E'\n' order by shortage.bird_group) into v_message
  from public.live_bird_minimum_order_shortages(p_store_id, p_items) shortage;
  if v_message is not null then
    raise exception using errcode = 'P0001', message = v_message, detail = 'live_bird_minimum_not_met';
  end if;
end;
$function$;
revoke all on function public.assert_live_bird_minimum_order_quantities(uuid,jsonb) from public, anon, authenticated, service_role;

-- Preserve all existing summary behavior (including Hatching Eggs). The safe
-- summary supplies validated item IDs/quantities before the evaluator runs.
do $migration$
declare
  v_body text;
begin
  select regexp_replace(replace(prosrc, chr(13), ''), ';[[:space:]]*$', '') into v_body
  from pg_proc where oid = 'public.get_public_checkout_summary(text,jsonb)'::regprocedure;
  v_body := regexp_replace(v_body, '\mp_items\M', '(select items from canonical_input)', 'g');
  execute $definition$
    create or replace function public.get_public_checkout_summary(p_store_slug text, p_items jsonb)
    returns table (store_id uuid, store_slug text, is_checkout_available boolean, message text,
      item_count integer, total_quantity integer, subtotal_amount numeric(10,2), items jsonb)
    language sql stable security definer set search_path = pg_catalog, public as $summary$
    with canonical_input as materialized (
      select public.normalize_order_inventory_items(p_items, false) as items
    ), existing_summary as ($definition$ || v_body || $definition$
    )
    select summary.store_id, summary.store_slug,
      summary.is_checkout_available and shortage.message is null,
      coalesce(summary.message, shortage.message), summary.item_count, summary.total_quantity,
      summary.subtotal_amount, summary.items
    from existing_summary summary
    left join lateral (
      select string_agg(s.message, E'\n' order by s.bird_group) as message
      from public.live_bird_minimum_order_shortages(summary.store_id,
        (select coalesce(jsonb_agg(jsonb_build_object('item_type', item ->> 'item_type',
          'item_id', item ->> 'item_id', 'quantity', item -> 'requested_quantity')), '[]'::jsonb)
         from jsonb_array_elements(summary.items) item)) s
    ) shortage on true;
    $summary$;
  $definition$;
end;
$migration$;

-- Add enforcement to the existing validated/locked functions. Abort migration
-- on a changed anchor rather than silently leaving a checkout path unprotected.
do $migration$
declare
  v_name text;
  v_oid oid;
  v_definition text;
  v_anchor text;
  v_call text;
begin
  for v_name, v_anchor, v_call in values
    ('create_pay_at_pickup_order_v2_batch_d_internal',
      '  select coalesce(sum(loi.line_subtotal), 0)::numeric(10, 2)',
      '  perform public.assert_live_bird_minimum_order_quantities(p_store_id, (select coalesce(jsonb_agg(jsonb_build_object(''item_type'', item_type, ''item_id'', item_id, ''quantity'', requested_quantity)), ''[]''::jsonb) from pg_temp.locked_order_items));'),
    ('reserve_storefront_card_checkout',
      '  select coalesce(sum(line_subtotal),0)::numeric(10,2) into v_subtotal',
      '  perform public.assert_live_bird_minimum_order_quantities(p_store_id, (select coalesce(jsonb_agg(jsonb_build_object(''item_type'', item_type, ''item_id'', item_id, ''quantity'', requested_quantity)), ''[]''::jsonb) from pg_temp.card_locked_items));'),
    ('seller_create_manual_order',
      '  -- The established creator owns source eligibility, snapshots, customers,',
      '  perform public.assert_live_bird_minimum_order_quantities(p_store_id, (select coalesce(jsonb_agg(jsonb_build_object(''item_type'', item_type, ''item_id'', source_id, ''quantity'', requested_quantity)), ''[]''::jsonb) from pg_temp.seller_manual_quantity_sources));'),
    ('seller_edit_order',
      '  create temporary table pg_temp.seller_quantity_edit_changes on commit drop as',
      '  perform public.assert_live_bird_minimum_order_quantities(v_order.store_id, (select coalesce(jsonb_agg(jsonb_build_object(''item_type'', item_type, ''item_id'', source_id, ''quantity'', quantity)), ''[]''::jsonb) from pg_temp.seller_quantity_edit_requested));')
  loop
    select p.oid, replace(pg_get_functiondef(p.oid), chr(13), '') into v_oid, v_definition
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = v_name;
    if v_oid is null or position(v_anchor in v_definition) = 0 or position(E'\nbegin\n' in v_definition) = 0 then
      raise exception 'Minimum quantity enforcement anchor missing in %.', v_name;
    end if;
    v_definition := replace(v_definition, E'\nbegin\n',
      E'\nbegin\n  p_items := public.normalize_order_inventory_items(p_items, '
      || case when v_name in ('seller_create_manual_order','seller_edit_order') then 'true' else 'false' end || E');\n');
    execute replace(v_definition, v_anchor, v_call || E'\n\n' || v_anchor);
  end loop;
end;
$migration$;

-- Existing reservations settle from their captured snapshots and are purposely
-- not revalidated against policies or dates that changed after reservation.
commit;
