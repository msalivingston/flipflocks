begin;

create table public.live_bird_batch_requests (
  store_id uuid not null references public.stores(id) on delete cascade,
  request_key uuid not null,
  request_hash text not null,
  result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (store_id, request_key),
  constraint live_bird_batch_requests_hash_not_empty check (
    length(btrim(request_hash)) > 0
  ),
  constraint live_bird_batch_requests_result_completion_check check (
    (result is null and completed_at is null)
    or (result is not null and completed_at is not null)
  )
);

comment on table public.live_bird_batch_requests is
'Seller-private idempotency ledger for atomic Batch Add Live Birds requests. The saved result contains only seller inventory identifiers and request correlation tokens.';

alter table public.live_bird_batch_requests enable row level security;
revoke all on table public.live_bird_batch_requests from public, anon, authenticated;

create function public.seller_create_live_bird_batches(
  p_store_id uuid,
  p_request_key uuid,
  p_hatch_groups jsonb
)
returns table (
  ok boolean,
  replayed boolean,
  error_code text,
  error_message text,
  error_group_token text,
  error_row_token text,
  result jsonb
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $function$
declare
  v_request_hash text;
  v_existing public.live_bird_batch_requests%rowtype;
  v_group jsonb;
  v_breed_group jsonb;
  v_item jsonb;
  v_group_token text;
  v_row_token text;
  v_species_id uuid;
  v_profile_id uuid;
  v_hatch_date date;
  v_available_date date;
  v_base_price numeric;
  v_derived_base_price numeric;
  v_highest_price numeric;
  v_auto jsonb;
  v_auto_enabled boolean;
  v_direction text;
  v_amount numeric;
  v_interval integer;
  v_maximum numeric;
  v_minimum numeric;
  v_plan_key text;
  v_preflight record;
  v_all_breed_groups jsonb := '[]'::jsonb;
  v_rpc_breed_groups jsonb;
  v_rpc_items jsonb;
  v_created record;
  v_created_group jsonb;
  v_created_item jsonb;
  v_group_results jsonb := '[]'::jsonb;
  v_item_results jsonb := '[]'::jsonb;
  v_entry_count integer := 0;
  v_total_birds integer := 0;
  v_group_count integer := 0;
  v_result jsonb;
begin
  if auth.uid() is null then
    return query select false, false, 'authentication_required',
      'Sign in as a seller to add inventory.', null::text, null::text, null::jsonb;
    return;
  end if;

  if p_store_id is null or not public.owns_store(p_store_id) then
    return query select false, false, 'ownership_error',
      'You are not authorized to add inventory for this store.', null::text, null::text, null::jsonb;
    return;
  end if;

  if p_request_key is null then
    return query select false, false, 'invalid_request',
      'A request identity is required.', null::text, null::text, null::jsonb;
    return;
  end if;

  if p_hatch_groups is null
    or jsonb_typeof(p_hatch_groups) <> 'array'
    or jsonb_array_length(p_hatch_groups) = 0 then
    return query select false, false, 'invalid_request',
      'At least one hatch group is required.', null::text, null::text, null::jsonb;
    return;
  end if;

  if jsonb_array_length(p_hatch_groups) > 500 then
    return query select false, false, 'invalid_request',
      'A Batch Add request may contain at most 500 hatch groups.', null::text, null::text, null::jsonb;
    return;
  end if;

  if not public.store_has_active_entitlement(p_store_id) then
    return query select false, false, 'entitlement_required',
      'Active selling access is required.', null::text, null::text, null::jsonb;
    return;
  end if;

  -- Store serialization makes the aggregate plan preflight authoritative even
  -- when separate seller actions are attempting to publish at the same time.
  perform 1 from public.stores where stores.id = p_store_id for update;
  v_request_hash := encode(extensions.digest(p_hatch_groups::text, 'sha256'), 'hex');

  select * into v_existing
  from public.live_bird_batch_requests
  where live_bird_batch_requests.store_id = p_store_id
    and live_bird_batch_requests.request_key = p_request_key;

  if v_existing.store_id is not null then
    if v_existing.request_hash <> v_request_hash then
      return query select false, false, 'idempotency_conflict',
        'This request identity was already used for different Batch Add details.', null::text, null::text, null::jsonb;
      return;
    end if;
    if v_existing.result is not null then
      return query select true, true, null::text, null::text, null::text, null::text, v_existing.result;
      return;
    end if;
  end if;

  v_plan_key := public.get_store_plan_key(p_store_id);

  if exists (
    select 1
    from jsonb_array_elements(p_hatch_groups) as groups(value)
    where jsonb_typeof(groups.value) <> 'object'
       or nullif(btrim(groups.value ->> 'client_hatch_group_token'), '') is null
       or char_length(btrim(groups.value ->> 'client_hatch_group_token')) > 200
  ) then
    return query select false, false, 'group_validation_error',
      'Every hatch group needs a valid client token.', null::text, null::text, null::jsonb;
    return;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_hatch_groups) as groups(value)
    where jsonb_typeof(groups.value -> 'breed_groups') <> 'array'
  ) then
    return query select false, false, 'group_validation_error',
      'Every hatch group needs a breed group array.', null::text, null::text, null::jsonb;
    return;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_hatch_groups) as groups(value)
    cross join lateral jsonb_array_elements(groups.value -> 'breed_groups') as breed_groups(value)
    where jsonb_typeof(breed_groups.value) <> 'object'
       or jsonb_typeof(breed_groups.value -> 'inventory_items') <> 'array'
  ) then
    return query select false, false, 'group_validation_error',
      'Every breed group needs an inventory row array.', null::text, null::text, null::jsonb;
    return;
  end if;

  if (
    select count(*)
    from jsonb_array_elements(p_hatch_groups) as groups(value)
    cross join lateral jsonb_array_elements(groups.value -> 'breed_groups') as breed_groups(value)
    cross join lateral jsonb_array_elements(breed_groups.value -> 'inventory_items') as items(value)
  ) > 5000 then
    return query select false, false, 'invalid_request',
      'A Batch Add request may contain at most 5,000 inventory entries.', null::text, null::text, null::jsonb;
    return;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_hatch_groups) as groups(value)
    group by btrim(groups.value ->> 'client_hatch_group_token')
    having count(*) > 1
  ) then
    return query select false, false, 'group_validation_error',
      'Hatch group tokens must be unique.', null::text, null::text, null::jsonb;
    return;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_hatch_groups) as groups(value)
    cross join lateral jsonb_array_elements(groups.value -> 'breed_groups') as breed_groups(value)
    cross join lateral jsonb_array_elements(breed_groups.value -> 'inventory_items') as items(value)
    where nullif(btrim(items.value ->> 'client_row_token'), '') is not null
    group by btrim(items.value ->> 'client_row_token')
    having count(*) > 1
  ) then
    return query select false, false, 'row_validation_error',
      'Inventory row tokens must be unique across the request.', null::text, null::text, null::jsonb;
    return;
  end if;

  for v_group in
    select value from jsonb_array_elements(p_hatch_groups) as groups(value)
  loop
    v_group_token := btrim(v_group ->> 'client_hatch_group_token');

    if v_group ->> 'species_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      return query select false, false, 'group_validation_error',
        'Choose a supported species.', v_group_token, null::text, null::jsonb;
      return;
    end if;
    v_species_id := (v_group ->> 'species_id')::uuid;

    if not exists (
      select 1 from public.species
      where species.id = v_species_id
        and species.is_active = true
        and species.slug in (
          'chicken', 'duck', 'goose', 'turkey', 'guinea-fowl', 'quail',
          'pheasant', 'peafowl', 'pigeons-doves', 'emus-ostriches-rheas'
        )
    ) then
      return query select false, false, 'group_validation_error',
        'Choose an active species supported by Live Birds.', v_group_token, null::text, null::jsonb;
      return;
    end if;

    if v_group ->> 'hatch_date' !~ '^\d{4}-\d{2}-\d{2}$'
      or v_group ->> 'available_date' !~ '^\d{4}-\d{2}-\d{2}$' then
      return query select false, false, 'group_validation_error',
        'Enter valid hatch and available dates.', v_group_token, null::text, null::jsonb;
      return;
    end if;
    begin
      v_hatch_date := (v_group ->> 'hatch_date')::date;
      v_available_date := (v_group ->> 'available_date')::date;
    exception when others then
      return query select false, false, 'group_validation_error',
        'Enter valid hatch and available dates.', v_group_token, null::text, null::jsonb;
      return;
    end;
    if v_available_date < v_hatch_date then
      return query select false, false, 'group_validation_error',
        'Available date must be on or after hatch date.', v_group_token, null::text, null::jsonb;
      return;
    end if;

    if jsonb_typeof(v_group -> 'breed_groups') <> 'array'
      or jsonb_array_length(v_group -> 'breed_groups') = 0 then
      return query select false, false, 'group_validation_error',
        'Every hatch group needs at least one breed.', v_group_token, null::text, null::jsonb;
      return;
    end if;

    if exists (
      select 1
      from jsonb_array_elements(v_group -> 'breed_groups') as breed_groups(value)
      group by breed_groups.value ->> 'seller_breed_profile_id'
      having count(*) > 1
    ) then
      return query select false, false, 'breed_profile_error',
        'Each breed may appear only once as a grouping inside a hatch group.', v_group_token, null::text, null::jsonb;
      return;
    end if;

    v_derived_base_price := null;
    v_highest_price := null;
    for v_breed_group in
      select value from jsonb_array_elements(v_group -> 'breed_groups') as breed_groups(value)
    loop
      if v_breed_group ->> 'seller_breed_profile_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or jsonb_typeof(v_breed_group -> 'inventory_items') <> 'array'
        or jsonb_array_length(v_breed_group -> 'inventory_items') = 0 then
        return query select false, false, 'breed_profile_error',
          'Every breed group needs a valid Breed Library profile and inventory rows.', v_group_token, null::text, null::jsonb;
        return;
      end if;
      v_profile_id := (v_breed_group ->> 'seller_breed_profile_id')::uuid;
      select nullif(btrim(items.value ->> 'client_row_token'), '')
      into v_row_token
      from jsonb_array_elements(v_breed_group -> 'inventory_items') as items(value)
      limit 1;

      if not exists (
        select 1 from public.seller_breed_profiles
        where seller_breed_profiles.id = v_profile_id
          and seller_breed_profiles.store_id = p_store_id
          and seller_breed_profiles.species_id = v_species_id
          and seller_breed_profiles.visibility_status = 'active'
          and seller_breed_profiles.moderation_status = 'normal'
      ) then
        return query select false, false, 'breed_profile_error',
          'A selected breed is unavailable, archived, or belongs to another store or species.', v_group_token, v_row_token, null::jsonb;
        return;
      end if;

      if not exists (
        select 1 from public.seller_breed_profiles
        where seller_breed_profiles.id = v_profile_id
          and nullif(btrim(seller_breed_profiles.seller_description), '') is not null
      ) then
        return query select false, false, 'breed_profile_not_ready',
          'A selected breed needs buyer-ready description content in the Breed Library.', v_group_token, v_row_token, null::jsonb;
        return;
      end if;

      if not exists (
        select 1
        from public.media_links
        join public.media_assets
          on media_assets.id = media_links.media_asset_id
         and media_assets.store_id = media_links.store_id
        where media_links.store_id = p_store_id
          and media_links.entity_type = 'seller_breed_profile'
          and media_links.entity_id = v_profile_id
          and media_links.visibility_status = 'active'
          and media_assets.asset_status = 'active'
          and media_assets.moderation_status = 'approved'
      ) then
        return query select false, false, 'breed_profile_not_ready',
          'A selected breed needs an approved photo in the Breed Library.', v_group_token, v_row_token, null::jsonb;
        return;
      end if;

      for v_item in
        select value from jsonb_array_elements(v_breed_group -> 'inventory_items') as items(value)
      loop
        v_row_token := nullif(btrim(v_item ->> 'client_row_token'), '');
        if jsonb_typeof(v_item) <> 'object'
          or v_row_token is null
          or char_length(v_row_token) > 200 then
          return query select false, false, 'row_validation_error',
            'Every inventory row needs a valid client token.', v_group_token, v_row_token, null::jsonb;
          return;
        end if;

        if v_item ->> 'inventory_type' not in (
          'female', 'male', 'straight_run', 'unsexed', 'pair', 'trio', 'other'
        ) then
          return query select false, false, 'row_validation_error',
            'Choose a valid Sold As value.', v_group_token, v_row_token, null::jsonb;
          return;
        end if;
        if v_item ->> 'inventory_type' = 'other'
          and nullif(btrim(v_item ->> 'custom_inventory_label'), '') is null then
          return query select false, false, 'row_validation_error',
            'A custom label is required for this Sold As value.', v_group_token, v_row_token, null::jsonb;
          return;
        end if;
        if char_length(btrim(v_item ->> 'custom_inventory_label')) > 100 then
          return query select false, false, 'row_validation_error',
            'Custom inventory labels must be 100 characters or fewer.', v_group_token, v_row_token, null::jsonb;
          return;
        end if;

        if v_item ->> 'quantity_available' !~ '^[1-9][0-9]*$'
          or (v_item ->> 'quantity_available')::numeric > 2147483647 then
          return query select false, false, 'row_validation_error',
            'Quantity must be a positive whole number.', v_group_token, v_row_token, null::jsonb;
          return;
        end if;
        if v_item ->> 'starting_price' !~ '^[0-9]+(\.[0-9]{1,2})?$'
          or (v_item ->> 'starting_price')::numeric <= 0
          or (v_item ->> 'starting_price')::numeric > 99999999.99 then
          return query select false, false, 'row_validation_error',
            'Starting price must be positive and use no more than two decimals.', v_group_token, v_row_token, null::jsonb;
          return;
        end if;
        if char_length(btrim(v_item ->> 'barn_location')) > 200 then
          return query select false, false, 'row_validation_error',
            'Barn Location must be 200 characters or fewer.', v_group_token, v_row_token, null::jsonb;
          return;
        end if;
        if v_plan_key = 'small_flock' and v_item ->> 'inventory_type' = 'other' then
          return query select false, false, 'entitlement_required',
            'Flock and group listings are included with Market.', v_group_token, v_row_token, null::jsonb;
          return;
        end if;

        v_derived_base_price := least(
          coalesce(v_derived_base_price, (v_item ->> 'starting_price')::numeric),
          (v_item ->> 'starting_price')::numeric
        );
        v_highest_price := greatest(
          coalesce(v_highest_price, (v_item ->> 'starting_price')::numeric),
          (v_item ->> 'starting_price')::numeric
        );
        v_entry_count := v_entry_count + 1;
        v_total_birds := v_total_birds + (v_item ->> 'quantity_available')::integer;
      end loop;
    end loop;

    if v_group ->> 'base_price' !~ '^[0-9]+(\.[0-9]{1,2})?$' then
      return query select false, false, 'group_pricing_error',
        'Hatch group base price is invalid.', v_group_token, null::text, null::jsonb;
      return;
    end if;
    v_base_price := (v_group ->> 'base_price')::numeric;
    if v_base_price is distinct from v_derived_base_price then
      return query select false, false, 'group_pricing_error',
        'Hatch group base price must equal its lowest Starting Price.', v_group_token, null::text, null::jsonb;
      return;
    end if;

    v_auto := coalesce(v_group -> 'automatic_pricing', '{"enabled":false}'::jsonb);
    if jsonb_typeof(v_auto) <> 'object'
      or coalesce(v_auto ->> 'enabled', 'false') not in ('true', 'false') then
      return query select false, false, 'group_pricing_error',
        'Automatic Price Changes are invalid for this hatch group.', v_group_token, null::text, null::jsonb;
      return;
    end if;
    v_auto_enabled := coalesce((v_auto ->> 'enabled')::boolean, false);
    v_direction := nullif(btrim(v_auto ->> 'direction'), '');
    v_amount := case when v_auto ->> 'amount' ~ '^[0-9]+(\.[0-9]{1,2})?$' then (v_auto ->> 'amount')::numeric end;
    v_interval := case
      when v_auto ->> 'interval_weeks' ~ '^[1-9][0-9]*$'
        and (v_auto ->> 'interval_weeks')::numeric <= 2147483647
      then (v_auto ->> 'interval_weeks')::integer
    end;
    v_maximum := case when v_auto ->> 'maximum_price' ~ '^[0-9]+(\.[0-9]{1,2})?$' then (v_auto ->> 'maximum_price')::numeric end;
    v_minimum := case when v_auto ->> 'minimum_price' ~ '^[0-9]+(\.[0-9]{1,2})?$' then (v_auto ->> 'minimum_price')::numeric end;

    if v_auto_enabled and v_plan_key <> 'full_flock' then
      return query select false, false, 'entitlement_required',
        'Automatic Price Changes are included with Market.', v_group_token, null::text, null::jsonb;
      return;
    end if;
    if v_auto_enabled and (
      v_direction not in ('increase', 'decrease')
      or v_amount is null or v_amount <= 0 or v_amount > 99999999.99
      or v_interval is null or v_interval <= 0
      or (v_direction = 'increase' and (v_maximum is null or v_maximum <= v_highest_price or v_maximum > 99999999.99 or v_minimum is not null))
      or (v_direction = 'decrease' and (v_minimum is null or v_minimum >= v_derived_base_price or v_minimum > 99999999.99 or v_maximum is not null))
    ) then
      return query select false, false, 'group_pricing_error',
        'Automatic Price Changes are incomplete or invalid for this hatch group.', v_group_token, null::text, null::jsonb;
      return;
    end if;

    v_all_breed_groups := v_all_breed_groups || (v_group -> 'breed_groups');
    v_group_count := v_group_count + 1;
  end loop;

  select * into v_preflight
  from public.seller_preflight_live_bird_publication(
    p_store_id, v_all_breed_groups, null
  );
  if not v_preflight.can_publish then
    return query select false, false, 'plan_limit_exceeded',
      format(
        'This submission adds %s active bird units, but only %s remain on the current plan.',
        v_preflight.requested_bird_units,
        v_preflight.remaining_bird_units
      ), null::text, null::text, null::jsonb;
    return;
  end if;

  insert into public.live_bird_batch_requests (
    store_id, request_key, request_hash
  ) values (
    p_store_id, p_request_key, v_request_hash
  ) on conflict on constraint live_bird_batch_requests_pkey do nothing;

  for v_group in
    select value from jsonb_array_elements(p_hatch_groups) as groups(value)
  loop
    v_group_token := btrim(v_group ->> 'client_hatch_group_token');
    v_base_price := (v_group ->> 'base_price')::numeric;
    v_rpc_breed_groups := '[]'::jsonb;

    for v_breed_group in
      select value from jsonb_array_elements(v_group -> 'breed_groups') as breed_groups(value)
    loop
      v_rpc_items := '[]'::jsonb;
      for v_item in
        select value from jsonb_array_elements(v_breed_group -> 'inventory_items') as items(value)
      loop
        v_rpc_items := v_rpc_items || jsonb_build_array(jsonb_build_object(
          'client_row_token', btrim(v_item ->> 'client_row_token'),
          'inventory_type', v_item ->> 'inventory_type',
          'custom_inventory_label', nullif(btrim(v_item ->> 'custom_inventory_label'), ''),
          'quantity_available', (v_item ->> 'quantity_available')::integer,
          'price_override', case
            when (v_item ->> 'starting_price')::numeric = v_base_price then null
            else (v_item ->> 'starting_price')::numeric
          end,
          'barn_location', nullif(btrim(v_item ->> 'barn_location'), ''),
          'visibility_status', 'active'
        ));
      end loop;
      v_rpc_breed_groups := v_rpc_breed_groups || jsonb_build_array(jsonb_build_object(
        'seller_breed_profile_id', v_breed_group ->> 'seller_breed_profile_id',
        'inventory_items', v_rpc_items,
        'visibility_status', 'active'
      ));
    end loop;

    select * into v_created
    from public.seller_create_listing_batch_with_inventory(
      p_store_id,
      (v_group ->> 'species_id')::uuid,
      'live_animals',
      (v_group ->> 'hatch_date')::date,
      (v_group ->> 'available_date')::date,
      v_base_price,
      v_rpc_breed_groups,
      false, null, null, null, null, 'active'
    );

    v_auto := coalesce(v_group -> 'automatic_pricing', '{"enabled":false}'::jsonb);
    v_auto_enabled := coalesce((v_auto ->> 'enabled')::boolean, false);
    perform public.seller_set_listing_batch_price_adjustment(
      v_created.listing_batch_id,
      v_auto_enabled,
      case when v_auto_enabled then v_auto ->> 'direction' end,
      case when v_auto_enabled then (v_auto ->> 'amount')::numeric end,
      case when v_auto_enabled then (v_auto ->> 'interval_weeks')::integer end,
      case when v_auto_enabled and v_auto ->> 'direction' = 'increase'
        then (v_auto ->> 'maximum_price')::numeric end,
      case when v_auto_enabled and v_auto ->> 'direction' = 'decrease'
        then (v_auto ->> 'minimum_price')::numeric end
    );

    v_group_results := v_group_results || jsonb_build_array(jsonb_build_object(
      'client_hatch_group_token', v_group_token,
      'listing_batch_id', v_created.listing_batch_id
    ));

    for v_created_group in
      select value from jsonb_array_elements(v_created.breed_groups) as created_groups(value)
    loop
      for v_created_item in
        select value from jsonb_array_elements(v_created_group -> 'inventory_items') as created_items(value)
      loop
        v_item_results := v_item_results || jsonb_build_array(jsonb_build_object(
          'client_row_token', v_created_item ->> 'client_row_token',
          'inventory_item_id', v_created_item ->> 'id',
          'listing_batch_breed_id', v_created_item ->> 'listing_batch_breed_id',
          'listing_batch_id', v_created_item ->> 'listing_batch_id'
        ));
      end loop;
    end loop;
  end loop;

  v_result := jsonb_build_object(
    'entries_created', v_entry_count,
    'hatch_groups_created', v_group_count,
    'total_birds_added', v_total_birds,
    'hatch_groups', v_group_results,
    'inventory_items', v_item_results
  );

  update public.live_bird_batch_requests
  set result = v_result, completed_at = now()
  where live_bird_batch_requests.store_id = p_store_id
    and live_bird_batch_requests.request_key = p_request_key;

  return query select true, false, null::text, null::text, null::text, null::text, v_result;
end;
$function$;

comment on function public.seller_create_live_bird_batches(uuid, uuid, jsonb) is
'Atomically validates and publishes multiple seller-owned Live Birds hatch groups, preserves row/group correlation tokens, applies deterministic pricing and group pricing rules, and protects successful retries with a store-scoped idempotency key.';

revoke all on function public.seller_create_live_bird_batches(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.seller_create_live_bird_batches(uuid, uuid, jsonb)
  to authenticated;

commit;
