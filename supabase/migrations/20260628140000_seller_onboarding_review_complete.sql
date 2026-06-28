-- Seller onboarding Step 6: review and complete onboarding without launching.

begin;

alter table public.seller_onboarding_state
add column if not exists onboarding_complete boolean not null default false,
add column if not exists onboarding_completed_at timestamptz;

comment on column public.seller_onboarding_state.onboarding_complete is
'True once the seller has finished the six-step onboarding flow. This does not publish or launch the storefront.';

comment on column public.seller_onboarding_state.onboarding_completed_at is
'Timestamp when the seller finished the six-step onboarding flow.';

create index if not exists seller_onboarding_state_onboarding_complete_idx
on public.seller_onboarding_state(onboarding_complete);

drop function if exists public.seller_complete_onboarding();

create or replace function public.seller_complete_onboarding()
returns table (
  store_id uuid,
  onboarding_complete boolean,
  onboarding_completed_at timestamptz,
  next_path text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_store public.stores%rowtype;
  v_completed_at timestamptz := now();
begin
  if v_user_id is null then
    raise exception 'Authentication is required.';
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
    raise exception 'Complete farm basics before finishing onboarding.';
  end if;

  if not exists (
    select 1
    from public.seller_onboarding_state as sos
    where sos.store_id = v_store.id
      and sos.profile_complete = true
      and sos.categories_complete = true
      and sos.pickup_complete = true
      and sos.billing_complete = true
  ) then
    raise exception 'Complete all onboarding steps before finishing.';
  end if;

  update public.seller_onboarding_state as sos
  set
    onboarding_complete = true,
    onboarding_completed_at = coalesce(sos.onboarding_completed_at, v_completed_at),
    updated_at = now()
  where sos.store_id = v_store.id
  returning sos.onboarding_completed_at into v_completed_at;

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
$$;

comment on function public.seller_complete_onboarding() is
'Trusted seller onboarding Step 6 completion. Marks onboarding complete without changing store_status, storefront_enabled, Stripe state, inventory, or listings.';

revoke all on function public.seller_complete_onboarding() from public;
grant execute on function public.seller_complete_onboarding() to authenticated;

commit;
