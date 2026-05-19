-- Group 1: Ownership and Access Foundation
-- Tables:
-- - stores
-- - user_roles
-- - seller_terms_acceptances
-- - seller_billing_status
-- - seller_onboarding_state
--
-- Canonical ownership model:
-- store_id -> stores.id -> stores.owner_user_id -> auth.uid()
--
-- First-admin bootstrap note:
-- The first platform admin user_roles row must be inserted through a trusted path,
-- such as the Supabase SQL editor or a service-role-only admin process.
-- Client users cannot grant themselves admin access under these RLS policies.
--
-- Application-level control note:
-- The schema includes store_status, admin_hold_reason, and ready_to_launch as stored fields.
-- Do not let ordinary client-side forms freely mutate these fields.
-- Recommended controls:
-- - store_status transitions should be performed by trusted server-side code after launch validation.
-- - admin_hold_reason should be changed only by platform admin workflows.
-- - ready_to_launch should be computed/validated by trusted server-side code before being stored.

create extension if not exists pgcrypto;

-- Shared updated_at trigger helper
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.stores (
  id uuid primary key default gen_random_uuid(),

  owner_user_id uuid not null references auth.users(id),

  store_name text not null,
  store_tagline text,
  store_slug text not null,

  store_status text not null default 'draft',
  storefront_mode text not null default 'hosted',

  public_city text,
  public_state text,
  public_country text not null default 'US',

  about_text text,
  pickup_policy text,
  cancellation_policy text,
  pickup_instructions text,

  public_email text,
  public_phone text,
  show_public_email boolean not null default false,
  show_public_phone boolean not null default false,

  website_url text,
  social_url text,

  npip_number text,
  show_npip boolean not null default false,

  admin_hold_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint stores_store_slug_unique unique (store_slug),

  constraint stores_store_status_check check (
    store_status in (
      'draft',
      'live',
      'paused',
      'dormant',
      'suspended',
      'canceled'
    )
  ),

  constraint stores_storefront_mode_check check (
    storefront_mode in (
      'hosted',
      'embedded',
      'private'
    )
  ),

  constraint stores_store_slug_format_check check (
    store_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  )
);

create index stores_owner_user_id_idx on public.stores(owner_user_id);
create index stores_store_status_idx on public.stores(store_status);
create index stores_storefront_mode_idx on public.stores(storefront_mode);
create index stores_status_mode_idx on public.stores(store_status, storefront_mode);

create trigger stores_set_updated_at
before update on public.stores
for each row
execute function public.set_updated_at();


create table public.user_roles (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references auth.users(id),
  role text not null,
  store_id uuid references public.stores(id),

  created_at timestamptz not null default now(),

  constraint user_roles_role_check check (
    role in ('seller', 'admin', 'staff')
  ),

  constraint user_roles_store_required_for_non_admin_check check (
    role = 'admin' or store_id is not null
  )
);

create index user_roles_user_id_idx on public.user_roles(user_id);
create index user_roles_store_id_idx on public.user_roles(store_id);
create index user_roles_user_role_idx on public.user_roles(user_id, role);
create index user_roles_store_role_idx on public.user_roles(store_id, role);

create unique index user_roles_scoped_unique_idx
on public.user_roles(user_id, role, store_id)
where store_id is not null;

create unique index user_roles_platform_unique_idx
on public.user_roles(user_id, role)
where store_id is null;


-- Security-definer helpers keep policies readable and avoid recursive RLS checks.
-- Platform admin means role = 'admin' and store_id is null.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = auth.uid()
      and role = 'admin'
      and store_id is null
  );
$$;

create or replace function public.owns_store(target_store_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.stores
    where id = target_store_id
      and owner_user_id = auth.uid()
  );
$$;


create table public.seller_terms_acceptances (
  id uuid primary key default gen_random_uuid(),

  store_id uuid not null references public.stores(id) on delete cascade,
  terms_version text not null,
  accepted_at timestamptz not null default now(),
  accepted_by_user_id uuid not null references auth.users(id),

  ip_address text,
  user_agent text
);

create index seller_terms_acceptances_store_id_idx
on public.seller_terms_acceptances(store_id);

create index seller_terms_acceptances_accepted_by_user_id_idx
on public.seller_terms_acceptances(accepted_by_user_id);

create index seller_terms_acceptances_store_terms_version_idx
on public.seller_terms_acceptances(store_id, terms_version);

create index seller_terms_acceptances_accepted_at_idx
on public.seller_terms_acceptances(accepted_at);


create table public.seller_billing_status (
  id uuid primary key default gen_random_uuid(),

  store_id uuid not null unique references public.stores(id) on delete cascade,

  stripe_customer_id text,
  stripe_subscription_id text,

  billing_plan text,
  subscription_status text not null default 'trialing',

  current_period_start timestamptz,
  current_period_end timestamptz,
  storefront_access_until timestamptz,
  trial_ends_at timestamptz,
  paused_at timestamptz,
  dormancy_started_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint seller_billing_status_billing_plan_check check (
    billing_plan is null
    or billing_plan in ('monthly', 'yearly', 'dormancy', 'comped')
  ),

  constraint seller_billing_status_subscription_status_check check (
    subscription_status in (
      'trialing',
      'active',
      'past_due',
      'dormant',
      'canceled',
      'comped',
      'suspended'
    )
  )
);

create index seller_billing_status_subscription_status_idx
on public.seller_billing_status(subscription_status);

create index seller_billing_status_billing_plan_idx
on public.seller_billing_status(billing_plan);

create index seller_billing_status_storefront_access_until_idx
on public.seller_billing_status(storefront_access_until);

create index seller_billing_status_stripe_customer_id_idx
on public.seller_billing_status(stripe_customer_id);

create index seller_billing_status_stripe_subscription_id_idx
on public.seller_billing_status(stripe_subscription_id);

create trigger seller_billing_status_set_updated_at
before update on public.seller_billing_status
for each row
execute function public.set_updated_at();


create table public.seller_onboarding_state (
  id uuid primary key default gen_random_uuid(),

  store_id uuid not null unique references public.stores(id) on delete cascade,

  profile_complete boolean not null default false,
  billing_complete boolean not null default false,
  terms_accepted boolean not null default false,
  first_listing_created boolean not null default false,
  ready_to_launch boolean not null default false,

  launched_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index seller_onboarding_state_ready_to_launch_idx
on public.seller_onboarding_state(ready_to_launch);

create index seller_onboarding_state_launched_at_idx
on public.seller_onboarding_state(launched_at);

create trigger seller_onboarding_state_set_updated_at
before update on public.seller_onboarding_state
for each row
execute function public.set_updated_at();


-- RLS
alter table public.stores enable row level security;
alter table public.user_roles enable row level security;
alter table public.seller_terms_acceptances enable row level security;
alter table public.seller_billing_status enable row level security;
alter table public.seller_onboarding_state enable row level security;


-- stores policies

create policy "Store owners can read own stores"
on public.stores
for select
to authenticated
using (
  owner_user_id = auth.uid()
  or public.is_admin()
);

create policy "Store owners can create own stores"
on public.stores
for insert
to authenticated
with check (
  owner_user_id = auth.uid()
  or public.is_admin()
);

create policy "Store owners can update own stores"
on public.stores
for update
to authenticated
using (
  owner_user_id = auth.uid()
  or public.is_admin()
)
with check (
  owner_user_id = auth.uid()
  or public.is_admin()
);

create policy "Admins can delete stores"
on public.stores
for delete
to authenticated
using (
  public.is_admin()
);


-- user_roles policies

create policy "Users can read own roles"
on public.user_roles
for select
to authenticated
using (
  user_id = auth.uid()
  or public.is_admin()
  or (
    store_id is not null
    and public.owns_store(store_id)
  )
);

create policy "Admins can insert roles"
on public.user_roles
for insert
to authenticated
with check (
  public.is_admin()
);

create policy "Admins can update roles"
on public.user_roles
for update
to authenticated
using (
  public.is_admin()
)
with check (
  public.is_admin()
);

create policy "Admins can delete roles"
on public.user_roles
for delete
to authenticated
using (
  public.is_admin()
);


-- seller_terms_acceptances policies

create policy "Store owners can read own terms acceptances"
on public.seller_terms_acceptances
for select
to authenticated
using (
  public.owns_store(store_id)
  or public.is_admin()
);

create policy "Store owners can create own terms acceptances"
on public.seller_terms_acceptances
for insert
to authenticated
with check (
  (
    public.owns_store(store_id)
    and accepted_by_user_id = auth.uid()
  )
  or public.is_admin()
);

create policy "Admins can update terms acceptances"
on public.seller_terms_acceptances
for update
to authenticated
using (
  public.is_admin()
)
with check (
  public.is_admin()
);

create policy "Admins can delete terms acceptances"
on public.seller_terms_acceptances
for delete
to authenticated
using (
  public.is_admin()
);


-- seller_billing_status policies

create policy "Store owners can read own billing status"
on public.seller_billing_status
for select
to authenticated
using (
  public.owns_store(store_id)
  or public.is_admin()
);

create policy "Admins can insert billing status"
on public.seller_billing_status
for insert
to authenticated
with check (
  public.is_admin()
);

create policy "Admins can update billing status"
on public.seller_billing_status
for update
to authenticated
using (
  public.is_admin()
)
with check (
  public.is_admin()
);

create policy "Admins can delete billing status"
on public.seller_billing_status
for delete
to authenticated
using (
  public.is_admin()
);


-- seller_onboarding_state policies

create policy "Store owners can read own onboarding state"
on public.seller_onboarding_state
for select
to authenticated
using (
  public.owns_store(store_id)
  or public.is_admin()
);

create policy "Store owners can create own onboarding state"
on public.seller_onboarding_state
for insert
to authenticated
with check (
  public.owns_store(store_id)
  or public.is_admin()
);

create policy "Store owners can update own onboarding state"
on public.seller_onboarding_state
for update
to authenticated
using (
  public.owns_store(store_id)
  or public.is_admin()
)
with check (
  public.owns_store(store_id)
  or public.is_admin()
);

create policy "Admins can delete onboarding state"
on public.seller_onboarding_state
for delete
to authenticated
using (
  public.is_admin()
);
