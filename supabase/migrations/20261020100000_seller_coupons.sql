-- Shared seller coupons. No subscription gates, campaign system, or usage caps.
begin;

create table public.seller_coupons (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  code text not null check (code = upper(trim(code)) and code ~ '^[A-Z0-9][A-Z0-9_-]{0,39}$'),
  discount_type text not null check (discount_type in ('fixed', 'percent')),
  discount_value numeric(10,2) not null check (discount_value > 0 and discount_value <> 'NaN'::numeric),
  scope text not null default 'order' check (scope in ('order','products','breeds','categories')),
  targets jsonb not null default '[]'::jsonb check (jsonb_typeof(targets) = 'array'),
  minimum_purchase numeric(10,2) not null default 0 check (minimum_purchase >= 0 and minimum_purchase <> 'NaN'::numeric),
  expires_on date,
  once_per_customer boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, code),
  check (discount_type <> 'percent' or discount_value <= 100),
  check (scope = 'order' or jsonb_array_length(targets) > 0)
);

create table public.seller_coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  coupon_id uuid not null references public.seller_coupons(id),
  order_id uuid not null unique references public.orders(id),
  customer_email text not null check (customer_email = lower(trim(customer_email)) and customer_email <> ''),
  once_per_customer boolean not null,
  created_at timestamptz not null default now(),
  released_at timestamptz
);
create index seller_coupon_redemptions_customer on public.seller_coupon_redemptions(coupon_id, customer_email)
where released_at is null;
create unique index seller_coupon_one_use_per_email on public.seller_coupon_redemptions(coupon_id, customer_email)
where released_at is null and once_per_customer;

alter table public.seller_coupons enable row level security;
alter table public.seller_coupon_redemptions enable row level security;
revoke all on public.seller_coupons, public.seller_coupon_redemptions from public, anon, authenticated;
grant select on public.seller_coupons, public.seller_coupon_redemptions to authenticated;
grant all on public.seller_coupons, public.seller_coupon_redemptions to service_role;
create policy seller_coupons_owner_read on public.seller_coupons for select to authenticated using (public.owns_store(store_id));
create policy seller_coupon_redemptions_owner_read on public.seller_coupon_redemptions for select to authenticated using (public.owns_store(store_id));

alter table public.orders
  add column discount_snapshot jsonb,
  add column gross_subtotal_amount numeric(10,2),
  add column coupon_discount_amount numeric(10,2) not null default 0 check (coupon_discount_amount >= 0),
  add column manual_discount_amount numeric(10,2) not null default 0 check (manual_discount_amount >= 0);
alter table public.order_items
  add column gross_line_subtotal numeric(10,2),
  add column coupon_discount_amount numeric(10,2) not null default 0 check (coupon_discount_amount >= 0),
  add column manual_discount_amount numeric(10,2) not null default 0 check (manual_discount_amount >= 0);

create function public.seller_save_coupon(p_store_id uuid, p_coupon jsonb, p_coupon_id uuid default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_scope text := p_coupon->>'scope'; v_target jsonb;
begin
  if not public.owns_store(p_store_id) then raise exception 'Store is not available.'; end if;
  if jsonb_typeof(p_coupon->'targets') <> 'array' then raise exception 'Choose eligible products, breeds, or categories.'; end if;
  for v_target in select value from jsonb_array_elements(p_coupon->'targets') loop
    if v_scope = 'products' and not coalesce((
      (v_target->>'item_type' = 'listing_inventory' and exists(select 1 from public.inventory_items where id=(v_target->>'item_id')::uuid and store_id=p_store_id)) or
      (v_target->>'item_type' = 'equipment_inventory' and exists(select 1 from public.equipment_inventory_items where id=(v_target->>'item_id')::uuid and store_id=p_store_id)) or
      (v_target->>'item_type' = 'processed_poultry_inventory' and exists(select 1 from public.processed_poultry_inventory_items where id=(v_target->>'item_id')::uuid and store_id=p_store_id)) or
      (v_target->>'item_type' = 'hatching_egg_inventory' and exists(select 1 from public.hatching_egg_inventory_items where id=(v_target->>'item_id')::uuid and store_id=p_store_id))
    ),false) then raise exception 'An eligible product does not belong to this store.';
    elsif v_scope = 'breeds' and not exists(select 1 from public.seller_breed_profiles where id=(v_target#>>'{}')::uuid and store_id=p_store_id) then
      raise exception 'An eligible breed does not belong to this store.';
    elsif v_scope = 'categories' and coalesce(v_target#>>'{}','') not in ('listing_inventory','equipment_inventory','processed_poultry_inventory','hatching_egg_inventory') then
      raise exception 'Choose a supported inventory category.';
    end if;
  end loop;
  if p_coupon_id is not null and not exists(select 1 from public.seller_coupons where id=p_coupon_id and store_id=p_store_id) then raise exception 'Coupon is not available.'; end if;
  insert into public.seller_coupons(id,store_id,code,discount_type,discount_value,scope,targets,minimum_purchase,expires_on,once_per_customer,is_active)
  values(coalesce(p_coupon_id,gen_random_uuid()),p_store_id,upper(trim(p_coupon->>'code')),p_coupon->>'discount_type',
    (p_coupon->>'discount_value')::numeric,v_scope,p_coupon->'targets',coalesce((p_coupon->>'minimum_purchase')::numeric,0),
    nullif(p_coupon->>'expires_on','')::date,coalesce((p_coupon->>'once_per_customer')::boolean,false),coalesce((p_coupon->>'is_active')::boolean,true))
  on conflict(id) do update set code=excluded.code,discount_type=excluded.discount_type,discount_value=excluded.discount_value,
    scope=excluded.scope,targets=excluded.targets,minimum_purchase=excluded.minimum_purchase,expires_on=excluded.expires_on,
    once_per_customer=excluded.once_per_customer,is_active=excluded.is_active,updated_at=now()
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.seller_save_coupon(uuid,jsonb,uuid) from public,anon;
grant execute on function public.seller_save_coupon(uuid,jsonb,uuid) to authenticated;

-- Input lines originate only from trusted locked checkout rows or saved orders.
create function public.coupon_line_eligible(p_coupon jsonb, p_line jsonb)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_type text := coalesce(p_line->>'item_type', p_line->>'order_item_source');
  v_id uuid;
  v_category text;
  v_breed uuid := nullif(p_line->>'seller_breed_profile_id','')::uuid;
begin
  if p_coupon is null then return false; end if;
  if p_line->>'inventory_item_id' is not null then v_type := 'listing_inventory'; v_id := (p_line->>'inventory_item_id')::uuid;
  elsif p_line->>'equipment_inventory_item_id' is not null then v_type := 'equipment_inventory'; v_id := (p_line->>'equipment_inventory_item_id')::uuid;
  elsif p_line->>'processed_poultry_inventory_item_id' is not null then v_type := 'processed_poultry_inventory'; v_id := (p_line->>'processed_poultry_inventory_item_id')::uuid;
  elsif p_line->>'hatching_egg_inventory_item_id' is not null then v_type := 'hatching_egg_inventory'; v_id := (p_line->>'hatching_egg_inventory_item_id')::uuid;
  else v_id := coalesce(nullif(p_line->>'item_id',''),nullif(p_line->>'source_id',''))::uuid;
  end if;
  if v_type = 'inventory' then v_type := 'listing_inventory'; end if;
  if v_type='listing_inventory' and v_breed is null then
    select b.seller_breed_profile_id into v_breed from public.inventory_items i join public.listing_batch_breeds b on b.id=i.listing_batch_breed_id where i.id=v_id;
  end if;
  v_category:=v_type;
  if v_type='listing_inventory' then
    if p_line->>'batch_type'='hatching_eggs' then v_category:='hatching_egg_inventory';
    elsif p_line->>'batch_type' is null and exists(
      select 1 from public.inventory_items i join public.listing_batches b on b.id=i.listing_batch_id
      where i.id=v_id and b.batch_type='hatching_eggs'
    ) then v_category:='hatching_egg_inventory'; end if;
  end if;
  return case p_coupon->>'scope'
    when 'order' then true
    when 'products' then (p_coupon->'targets') @> jsonb_build_array(jsonb_build_object('item_type',v_type,'item_id',v_id))
    when 'breeds' then (p_coupon->'targets') ? v_breed::text
    when 'categories' then (p_coupon->'targets') ? v_category
    else false end;
end;
$$;

create function public.calculate_order_discounts(
  p_store_id uuid, p_email text, p_lines jsonb, p_code text,
  p_manual_type text default 'fixed', p_manual_value numeric default 0,
  p_existing_order_id uuid default null, p_reservation_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_coupon jsonb; v_saved jsonb; v_gross numeric := 0; v_eligible numeric := 0;
  v_discount numeric := 0; v_manual numeric := 0; v_email text := lower(trim(p_email));
  v_line jsonb; v_amount numeric; v_id uuid;
begin
  if p_existing_order_id is not null then
    select discount_snapshot into v_saved from public.orders where id=p_existing_order_id and store_id=p_store_id;
  end if;
  if v_saved is not null and (p_code is null or upper(trim(p_code))=v_saved->'coupon'->>'code') then
    v_coupon := nullif(v_saved->'coupon','null'::jsonb);
    p_manual_type := coalesce(p_manual_type,v_saved->>'manual_type','fixed');
    p_manual_value := coalesce(p_manual_value,(v_saved->>'manual_value')::numeric,0);
  elsif nullif(trim(p_code),'') is not null then
    select to_jsonb(c) into v_coupon from public.seller_coupons c
    where c.store_id=p_store_id and c.code=upper(trim(p_code)) and c.is_active
      and (c.expires_on is null or c.expires_on >= (now() at time zone 'UTC')::date);
    if v_coupon is null then raise exception 'Coupon is invalid, inactive, or expired.'; end if;
  end if;
  if v_coupon is not null then
    if v_email is null or v_email='' then raise exception 'Enter a customer email to use a coupon.'; end if;
    v_id := (v_coupon->>'id')::uuid;
    -- Same lock is used for pickup, manual orders, card holds, and cancellation.
    perform pg_advisory_xact_lock(hashtextextended(v_id::text || ':' || v_email,0));
    if (v_coupon->>'once_per_customer')::boolean and (
      exists(select 1 from public.seller_coupon_redemptions r where r.coupon_id=v_id and r.customer_email=v_email and r.released_at is null and r.order_id is distinct from p_existing_order_id) or
      exists(select 1 from public.storefront_card_checkout_reservations r
        where r.id is distinct from p_reservation_id and r.store_id=p_store_id
          and r.order_snapshot->'discount_snapshot'->'coupon'->>'id'=v_id::text
          and lower(trim(r.order_snapshot->>'buyer_email'))=v_email)
    ) then raise exception 'This coupon has already been used or is reserved in another checkout for this email.'; end if;
  end if;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_amount := (v_line->>'line_subtotal')::numeric;
    if v_amount is null or v_amount<0 then raise exception 'Invalid merchandise amount.'; end if;
    v_gross := v_gross + v_amount;
    if public.coupon_line_eligible(v_coupon,v_line) then v_eligible:=v_eligible+v_amount; end if;
  end loop;
  if v_coupon is not null then
    if v_eligible<=0 then raise exception 'This coupon does not apply to the selected items.'; end if;
    if v_eligible < (v_coupon->>'minimum_purchase')::numeric then raise exception 'The eligible merchandise subtotal does not meet this coupon’s minimum purchase.'; end if;
    v_discount := least(v_eligible,round(case when v_coupon->>'discount_type'='percent'
      then v_eligible*(v_coupon->>'discount_value')::numeric/100 else (v_coupon->>'discount_value')::numeric end,2));
  end if;
  p_manual_value := coalesce(p_manual_value,0); p_manual_type:=coalesce(p_manual_type,'fixed');
  if p_manual_value='NaN'::numeric or p_manual_value<0 or p_manual_type not in ('fixed','percent') or (p_manual_type='percent' and p_manual_value>100) then raise exception 'Invalid manual discount.'; end if;
  v_manual := least(v_gross-v_discount,round(case when p_manual_type='percent' then (v_gross-v_discount)*p_manual_value/100 else p_manual_value end,2));
  return jsonb_build_object('coupon',v_coupon,'gross_subtotal',v_gross,'eligible_subtotal',v_eligible,
    'coupon_amount',v_discount,'manual_amount',v_manual,'manual_type',p_manual_type,'manual_value',p_manual_value,
    'net_subtotal',v_gross-v_discount-v_manual);
end;
$$;

create function public.attach_order_discounts(p_order_id uuid,p_pricing jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_order public.orders%rowtype; v_coupon jsonb:=nullif(p_pricing->'coupon','null'::jsonb);
begin
  if p_pricing is null or p_pricing='null'::jsonb then return; end if;
  select * into strict v_order from public.orders where id=p_order_id for update;
  update public.orders set discount_snapshot=p_pricing,gross_subtotal_amount=(p_pricing->>'gross_subtotal')::numeric,
    coupon_discount_amount=(p_pricing->>'coupon_amount')::numeric,manual_discount_amount=(p_pricing->>'manual_amount')::numeric
  where id=p_order_id;
  -- Cumulative rounding allocates every cent exactly, including quantities of 3.
  with bases as (
    select i.id,coalesce(i.inventory_item_id,i.equipment_inventory_item_id,i.processed_poultry_inventory_item_id,i.hatching_egg_inventory_item_id,i.id) as source_id,i.line_subtotal as gross,
      case when public.coupon_line_eligible(v_coupon,to_jsonb(i)) then i.line_subtotal else 0 end as eligible
    from public.order_items i where i.order_id=p_order_id
  ), coupon_parts as (
    select *, coalesce(round(sum(eligible) over(order by source_id,id)*(p_pricing->>'coupon_amount')::numeric/nullif((p_pricing->>'eligible_subtotal')::numeric,0),2),0)
      - coalesce(round((sum(eligible) over(order by source_id,id)-eligible)*(p_pricing->>'coupon_amount')::numeric/nullif((p_pricing->>'eligible_subtotal')::numeric,0),2),0) as coupon
    from bases
  ), parts as (
    select *,coalesce(round(sum(gross-coupon) over(order by source_id,id)*(p_pricing->>'manual_amount')::numeric/nullif((p_pricing->>'gross_subtotal')::numeric-(p_pricing->>'coupon_amount')::numeric,0),2),0)
      - coalesce(round((sum(gross-coupon) over(order by source_id,id)-(gross-coupon))*(p_pricing->>'manual_amount')::numeric/nullif((p_pricing->>'gross_subtotal')::numeric-(p_pricing->>'coupon_amount')::numeric,0),2),0) as manual
    from coupon_parts
  ) update public.order_items i set gross_line_subtotal=p.gross,coupon_discount_amount=p.coupon,manual_discount_amount=p.manual,line_subtotal=p.gross-p.coupon-p.manual from parts p where i.id=p.id;
  update public.seller_coupon_redemptions set released_at=now() where order_id=p_order_id and released_at is null;
  if v_coupon is not null then
    insert into public.seller_coupon_redemptions(store_id,coupon_id,order_id,customer_email,once_per_customer)
    values(v_order.store_id,(v_coupon->>'id')::uuid,p_order_id,lower(trim(v_order.buyer_email_snapshot)),(v_coupon->>'once_per_customer')::boolean)
    on conflict(order_id) do update set coupon_id=excluded.coupon_id,customer_email=excluded.customer_email,
      once_per_customer=excluded.once_per_customer,released_at=null;
  end if;
end;
$$;

create function public.release_canceled_order_coupon() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.order_status='canceled' and old.order_status is distinct from 'canceled' then
    update public.seller_coupon_redemptions set released_at=now() where order_id=new.id and released_at is null;
  end if;
  return new;
end;
$$;
create trigger release_canceled_order_coupon after update of order_status on public.orders for each row execute function public.release_canceled_order_coupon();

revoke all on function public.coupon_line_eligible(jsonb,jsonb),public.calculate_order_discounts(uuid,text,jsonb,text,text,numeric,uuid,uuid),public.attach_order_discounts(uuid,jsonb),public.release_canceled_order_coupon() from public,anon,authenticated;

commit;
