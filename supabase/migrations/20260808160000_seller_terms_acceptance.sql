-- Production seller Terms acceptance and onboarding progress preservation.

begin;

create unique index if not exists seller_terms_acceptances_store_user_version_uidx
on public.seller_terms_acceptances (
  store_id,
  accepted_by_user_id,
  terms_version
);

-- Acceptance is append-only and can only be created through the trusted RPC.
-- This prevents a browser client from choosing its own version, user, or time.
drop policy if exists "Store owners can create own terms acceptances"
  on public.seller_terms_acceptances;
drop policy if exists "Admins can update terms acceptances"
  on public.seller_terms_acceptances;
drop policy if exists "Admins can delete terms acceptances"
  on public.seller_terms_acceptances;

revoke insert, update, delete on public.seller_terms_acceptances
  from anon, authenticated;

create or replace function public.current_seller_terms_version()
returns text
language sql
immutable
security definer
set search_path = pg_catalog
as $function$
  select '2026-08-08'::text;
$function$;

comment on function public.current_seller_terms_version() is
'Server-controlled version of the Seller Terms currently presented for acceptance.';

revoke all on function public.current_seller_terms_version()
  from public, anon, authenticated, service_role;

create or replace function public.seller_accept_current_terms(
  p_store_id uuid
)
returns table (
  store_id uuid,
  accepted_by_user_id uuid,
  terms_version text,
  accepted_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
#variable_conflict use_column
declare
  v_user_id uuid := auth.uid();
  v_store_id uuid;
  v_terms_version text := public.current_seller_terms_version();
  v_acceptance public.seller_terms_acceptances%rowtype;
begin
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'AUTHENTICATION_REQUIRED';
  end if;

  if p_store_id is null then
    raise exception using
      errcode = '22023',
      message = 'STORE_ID_REQUIRED';
  end if;

  select stores.id
  into v_store_id
  from public.stores
  where stores.id = p_store_id
    and stores.owner_user_id = v_user_id;

  if v_store_id is null then
    raise exception using
      errcode = '42501',
      message = 'STORE_NOT_FOUND_OR_NOT_OWNER';
  end if;

  insert into public.seller_terms_acceptances (
    store_id,
    terms_version,
    accepted_by_user_id
  )
  values (
    v_store_id,
    v_terms_version,
    v_user_id
  )
  on conflict (store_id, accepted_by_user_id, terms_version) do nothing
  returning * into v_acceptance;

  if v_acceptance.id is null then
    select acceptances.*
    into v_acceptance
    from public.seller_terms_acceptances as acceptances
    where acceptances.store_id = v_store_id
      and acceptances.accepted_by_user_id = v_user_id
      and acceptances.terms_version = v_terms_version;
  end if;

  return query
  select
    v_acceptance.store_id,
    v_acceptance.accepted_by_user_id,
    v_acceptance.terms_version,
    v_acceptance.accepted_at;
end;
$function$;

comment on function public.seller_accept_current_terms(uuid) is
'Records the authenticated store owner acceptance of the server-controlled current Seller Terms. Retries return the existing immutable acceptance.';

revoke all on function public.seller_accept_current_terms(uuid)
  from public, anon, service_role;
grant execute on function public.seller_accept_current_terms(uuid)
  to authenticated;

-- Completing onboarding must be backed by the authoritative legal record.
create or replace function public.seller_complete_onboarding()
returns table (
  store_id uuid,
  onboarding_complete boolean,
  onboarding_completed_at timestamptz,
  next_path text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_store public.stores%rowtype;
  v_completed_at timestamptz := now();
begin
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'AUTHENTICATION_REQUIRED';
  end if;

  select stores.*
  into v_store
  from public.stores
  left join public.user_roles
    on user_roles.store_id = stores.id
   and user_roles.user_id = v_user_id
   and user_roles.role in ('seller', 'staff')
  where stores.owner_user_id = v_user_id
     or user_roles.store_id = stores.id
  order by stores.created_at asc
  limit 1
  for update of stores;

  if v_store.id is null then
    raise exception 'Complete farm basics before finishing onboarding.';
  end if;

  if not exists (
    select 1
    from public.seller_onboarding_state
    where seller_onboarding_state.store_id = v_store.id
      and seller_onboarding_state.profile_complete = true
      and seller_onboarding_state.categories_complete = true
      and seller_onboarding_state.pickup_complete = true
      and seller_onboarding_state.billing_complete = true
  ) then
    raise exception 'Complete all onboarding steps before finishing.';
  end if;

  if not exists (
    select 1
    from public.seller_terms_acceptances
    where seller_terms_acceptances.store_id = v_store.id
      and seller_terms_acceptances.accepted_by_user_id = v_store.owner_user_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'SELLER_TERMS_ACCEPTANCE_REQUIRED';
  end if;

  update public.seller_onboarding_state
  set
    onboarding_complete = true,
    onboarding_completed_at = coalesce(
      seller_onboarding_state.onboarding_completed_at,
      v_completed_at
    ),
    updated_at = now()
  where seller_onboarding_state.store_id = v_store.id
  returning seller_onboarding_state.onboarding_completed_at
  into v_completed_at;

  if not found then
    raise exception 'Onboarding state could not be found.';
  end if;

  return query
  select
    v_store.id,
    true,
    v_completed_at,
    '/dashboard'::text;
end;
$function$;

comment on function public.seller_complete_onboarding() is
'Completes seller onboarding only after setup and authoritative Seller Terms acceptance, without changing store publication, billing, Stripe state, inventory, or listings.';

revoke all on function public.seller_complete_onboarding()
  from public, anon;
grant execute on function public.seller_complete_onboarding()
  to authenticated;

-- The Step 2 bootstrap is also used to edit an existing draft store. Preserve
-- every later onboarding flag in that path and initialize defaults only when
-- the onboarding row does not exist.
do $rewrite$
declare
  v_definition text;
  v_rewritten text;
  v_old text := $old$
  update public.seller_onboarding_state as sos
  set
    profile_complete = true,
    billing_complete = false,
    terms_accepted = false,
    first_listing_created = false,
    ready_to_launch = false,
    updated_at = now()
  where sos.store_id = v_store.id;
$old$;
  v_new text := $new$
  update public.seller_onboarding_state as sos
  set
    profile_complete = true,
    updated_at = now()
  where sos.store_id = v_store.id;
$new$;
begin
  select pg_get_functiondef(
    'public.seller_bootstrap_store_from_onboarding(jsonb)'::regprocedure
  )
  into v_definition;

  v_rewritten := replace(v_definition, v_old, v_new);
  if v_rewritten = v_definition then
    raise exception 'Could not replace the onboarding progress reset.';
  end if;

  execute v_rewritten;
end;
$rewrite$;

revoke all on function public.seller_bootstrap_store_from_onboarding(jsonb)
  from public, anon;
grant execute on function public.seller_bootstrap_store_from_onboarding(jsonb)
  to authenticated;

commit;
