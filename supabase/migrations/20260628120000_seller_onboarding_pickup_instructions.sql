-- Seller onboarding Step 4: pickup instructions and buyer contact preferences.

begin;

alter table public.stores
add column if not exists buyer_contact_email_enabled boolean not null default true,
add column if not exists buyer_contact_text_enabled boolean not null default false,
add column if not exists buyer_contact_phone_enabled boolean not null default false;

comment on column public.stores.buyer_contact_email_enabled is
'Seller preference for showing email as an after-order buyer contact method.';

comment on column public.stores.buyer_contact_text_enabled is
'Seller preference for showing text message as an after-order buyer contact method.';

comment on column public.stores.buyer_contact_phone_enabled is
'Seller preference for showing phone call as an after-order buyer contact method.';

alter table public.seller_onboarding_state
add column if not exists pickup_complete boolean not null default false;

comment on column public.seller_onboarding_state.pickup_complete is
'True once the seller has saved pickup instructions during onboarding Step 4.';

drop function if exists public.seller_save_onboarding_pickup(jsonb);

create or replace function public.seller_save_onboarding_pickup(
  p_pickup jsonb
)
returns table (
  store_id uuid,
  pickup_complete boolean,
  next_step integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_store public.stores%rowtype;
  v_pickup_instructions text;
  v_email_enabled boolean;
  v_text_enabled boolean;
  v_phone_enabled boolean;
begin
  if v_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  if p_pickup is null or jsonb_typeof(p_pickup) <> 'object' then
    raise exception 'Pickup details must be provided.';
  end if;

  v_pickup_instructions := nullif(trim(p_pickup ->> 'pickup_instructions'), '');
  v_email_enabled := coalesce((p_pickup ->> 'email_enabled')::boolean, false);
  v_text_enabled := coalesce((p_pickup ->> 'text_enabled')::boolean, false);
  v_phone_enabled := coalesce((p_pickup ->> 'phone_enabled')::boolean, false);

  if v_pickup_instructions is null then
    raise exception 'Pickup instructions are required.';
  end if;

  if not (v_email_enabled or v_text_enabled or v_phone_enabled) then
    raise exception 'Choose at least one buyer contact method.';
  end if;

  select s.*
  into v_store
  from public.stores as s
  left join public.user_roles as ur
    on ur.store_id = s.id
   and ur.user_id = v_user_id
   and ur.role in ('seller', 'staff')
  where s.owner_user_id = v_user_id
     or ur.store_id = s.id
  order by s.created_at asc
  limit 1
  for update of s;

  if v_store.id is null then
    raise exception 'Complete farm basics before saving pickup instructions.';
  end if;

  if not exists (
    select 1
    from public.seller_onboarding_state as sos
    where sos.store_id = v_store.id
      and sos.profile_complete = true
      and sos.categories_complete = true
  ) then
    raise exception 'Complete selling categories before saving pickup instructions.';
  end if;

  update public.stores as s
  set
    pickup_instructions = v_pickup_instructions,
    buyer_contact_email_enabled = v_email_enabled,
    buyer_contact_text_enabled = v_text_enabled,
    buyer_contact_phone_enabled = v_phone_enabled,
    show_public_phone = (v_text_enabled or v_phone_enabled),
    updated_at = now()
  where s.id = v_store.id
  returning s.* into v_store;

  update public.seller_onboarding_state as sos
  set
    pickup_complete = true,
    updated_at = now()
  where sos.store_id = v_store.id;

  if not found then
    insert into public.seller_onboarding_state (
      store_id,
      profile_complete,
      categories_complete,
      pickup_complete,
      billing_complete,
      terms_accepted,
      first_listing_created,
      ready_to_launch
    )
    values (
      v_store.id,
      true,
      true,
      true,
      false,
      false,
      false,
      false
    );
  end if;

  return query
  select
    v_store.id,
    true,
    5;
end;
$$;

comment on function public.seller_save_onboarding_pickup(jsonb) is
'Trusted seller onboarding Step 4 pickup save. Updates pickup instructions and buyer contact preferences without activating storefront or creating billing records.';

revoke all on function public.seller_save_onboarding_pickup(jsonb) from public;
grant execute on function public.seller_save_onboarding_pickup(jsonb) to authenticated;

commit;
