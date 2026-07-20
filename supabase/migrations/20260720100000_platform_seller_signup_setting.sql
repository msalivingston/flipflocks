-- Global platform setting for public seller signup entry points.
-- Defaults to enabled so existing signup behavior is preserved unless an
-- authenticated platform admin explicitly turns it off.

begin;

create table public.platform_settings (
  setting_key text primary key,
  boolean_value boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid references auth.users(id),

  constraint platform_settings_supported_keys_check check (
    setting_key in ('seller_signups_enabled')
  )
);

create trigger platform_settings_set_updated_at
before update on public.platform_settings
for each row
execute function public.set_updated_at();

alter table public.platform_settings enable row level security;

create policy "Platform admins can read platform settings"
on public.platform_settings
for select
to authenticated
using (public.is_platform_admin());

create policy "Platform admins can insert platform settings"
on public.platform_settings
for insert
to authenticated
with check (public.is_platform_admin());

create policy "Platform admins can update platform settings"
on public.platform_settings
for update
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

revoke all on public.platform_settings from anon;
grant select, insert, update on public.platform_settings to authenticated;

insert into public.platform_settings (setting_key, boolean_value)
values ('seller_signups_enabled', true)
on conflict (setting_key) do nothing;

create or replace function public.public_seller_signups_enabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select platform_settings.boolean_value
      from public.platform_settings
      where platform_settings.setting_key = 'seller_signups_enabled'
    ),
    true
  );
$$;

create or replace function public.admin_set_seller_signups_enabled(
  p_enabled boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Not authorized to update platform settings.';
  end if;

  if p_enabled is null then
    raise exception 'New seller signup setting is required.';
  end if;

  insert into public.platform_settings (
    setting_key,
    boolean_value,
    updated_by_user_id
  )
  values (
    'seller_signups_enabled',
    p_enabled,
    auth.uid()
  )
  on conflict (setting_key) do update
  set
    boolean_value = excluded.boolean_value,
    updated_by_user_id = excluded.updated_by_user_id;

  return p_enabled;
end;
$$;

comment on table public.platform_settings is
'Narrow platform-wide settings controlled by authenticated platform admins.';

comment on function public.public_seller_signups_enabled() is
'Public read helper for whether marketing-site seller signup CTAs should link to signup. Defaults true when unset.';

comment on function public.admin_set_seller_signups_enabled(boolean) is
'Platform-admin-only update helper for the public seller signup entry setting.';

revoke all on function public.public_seller_signups_enabled() from public;
revoke all on function public.admin_set_seller_signups_enabled(boolean) from public;

grant execute on function public.public_seller_signups_enabled() to anon, authenticated;
grant execute on function public.admin_set_seller_signups_enabled(boolean) to authenticated;

commit;
