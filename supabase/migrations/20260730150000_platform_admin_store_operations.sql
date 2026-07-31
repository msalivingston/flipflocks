-- Focused platform-admin operations for the existing store support detail page.
--
-- Sales semantics intentionally match the seller Reports page:
-- - recorded gross sales include every non-canceled order total;
-- - unpaid and pay-at-pickup orders are included;
-- - refunded orders remain part of gross recorded sales;
-- - refund amounts are not subtracted.
--
-- Plan changes in this phase are local administrative overrides. They are
-- rejected once a Stripe subscription id exists so future billing state cannot
-- silently diverge from the effective capability plan.

begin;

alter table public.admin_activity_events
drop constraint admin_activity_events_action_type_check;

alter table public.admin_activity_events
add constraint admin_activity_events_action_type_check check (
  action_type in (
    'store_suspended',
    'store_reactivated',
    'notification_retried',
    'notification_suppressed',
    'storefront_enabled',
    'storefront_disabled',
    'store_hold_placed',
    'store_hold_removed',
    'store_plan_changed',
    'store_internal_note_updated'
  )
);

create table public.admin_store_internal_notes (
  store_id uuid primary key references public.stores(id) on delete cascade,
  note text not null,
  updated_by_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint admin_store_internal_notes_note_not_empty_check check (
    length(trim(note)) > 0
  ),
  constraint admin_store_internal_notes_note_length_check check (
    length(note) <= 4000
  )
);

comment on table public.admin_store_internal_notes is
'One private platform-admin note per store. This table is never exposed through seller or public storefront projections.';

comment on column public.admin_store_internal_notes.note is
'Private platform support context. Note contents must not be copied into admin activity metadata.';

create trigger admin_store_internal_notes_set_updated_at
before update on public.admin_store_internal_notes
for each row
execute function public.set_updated_at();

alter table public.admin_store_internal_notes enable row level security;

create policy "Platform admins can read store internal notes"
on public.admin_store_internal_notes
for select
to authenticated
using (public.is_admin());

revoke all on public.admin_store_internal_notes from public;
grant select on public.admin_store_internal_notes to authenticated;


create or replace function public.admin_platform_store_operations_summary(
  p_store_id uuid
)
returns table (
  store_id uuid,
  plan_key text,
  billing_plan text,
  has_linked_stripe_subscription boolean,
  internal_note text,
  recorded_gross_sales numeric,
  total_order_count bigint,
  open_order_count bigint,
  fulfilled_order_count bigint,
  canceled_order_count bigint,
  refunded_order_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized to view platform admin data.';
  end if;

  if p_store_id is null then
    raise exception 'Store is required.';
  end if;

  if not exists (
    select 1
    from public.stores
    where stores.id = p_store_id
  ) then
    raise exception 'Store is not available.';
  end if;

  return query
  select
    stores.id,
    public.get_store_plan_key(stores.id),
    seller_billing_status.billing_plan,
    seller_billing_status.stripe_subscription_id is not null,
    admin_store_internal_notes.note,
    coalesce(order_summary.recorded_gross_sales, 0)::numeric(12, 2),
    coalesce(order_summary.total_order_count, 0),
    coalesce(order_summary.open_order_count, 0),
    coalesce(order_summary.fulfilled_order_count, 0),
    coalesce(order_summary.canceled_order_count, 0),
    coalesce(order_summary.refunded_order_count, 0)
  from public.stores
  left join public.seller_billing_status
    on seller_billing_status.store_id = stores.id
  left join public.admin_store_internal_notes
    on admin_store_internal_notes.store_id = stores.id
  left join lateral (
    select
      coalesce(
        sum(orders.total_amount) filter (
          where orders.order_status <> 'canceled'
        ),
        0
      ) as recorded_gross_sales,
      count(*) as total_order_count,
      count(*) filter (
        where orders.order_status in ('pending', 'open')
      ) as open_order_count,
      count(*) filter (
        where orders.order_status = 'fulfilled'
      ) as fulfilled_order_count,
      count(*) filter (
        where orders.order_status = 'canceled'
      ) as canceled_order_count,
      count(*) filter (
        where orders.payment_status = 'refunded'
      ) as refunded_order_count
    from public.orders
    where orders.store_id = stores.id
  ) as order_summary on true
  where stores.id = p_store_id;
end;
$$;


create or replace function public.admin_set_storefront_enabled(
  p_store_id uuid,
  p_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store public.stores%rowtype;
  v_previous_enabled boolean;
begin
  if not public.is_admin() then
    raise exception 'Not authorized to perform admin operations.';
  end if;

  if p_store_id is null then
    raise exception 'Store is required.';
  end if;

  if p_enabled is null then
    raise exception 'Storefront enabled state is required.';
  end if;

  select *
  into v_store
  from public.stores
  where stores.id = p_store_id
  for update;

  if v_store.id is null then
    raise exception 'Store is not available.';
  end if;

  v_previous_enabled := v_store.storefront_enabled;

  update public.stores
  set storefront_enabled = p_enabled
  where stores.id = v_store.id;

  insert into public.admin_activity_events (
    actor_user_id,
    action_type,
    target_store_id,
    metadata
  )
  values (
    auth.uid(),
    case when p_enabled then 'storefront_enabled' else 'storefront_disabled' end,
    v_store.id,
    jsonb_build_object(
      'previous_value', v_previous_enabled,
      'new_value', p_enabled
    )
  );
end;
$$;


create or replace function public.admin_set_store_hold(
  p_store_id uuid,
  p_on_hold boolean,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store public.stores%rowtype;
  v_reason text;
  v_previous_reason text;
begin
  if not public.is_admin() then
    raise exception 'Not authorized to perform admin operations.';
  end if;

  if p_store_id is null then
    raise exception 'Store is required.';
  end if;

  if p_on_hold is null then
    raise exception 'Hold state is required.';
  end if;

  v_reason := nullif(trim(p_reason), '');

  if p_on_hold and v_reason is null then
    raise exception 'A reason is required to place a store on hold.';
  end if;

  if v_reason is not null and length(v_reason) > 500 then
    raise exception 'Hold reason must be 500 characters or fewer.';
  end if;

  select *
  into v_store
  from public.stores
  where stores.id = p_store_id
  for update;

  if v_store.id is null then
    raise exception 'Store is not available.';
  end if;

  v_previous_reason := v_store.admin_hold_reason;

  update public.stores
  set admin_hold_reason = case when p_on_hold then v_reason else null end
  where stores.id = v_store.id;

  insert into public.admin_activity_events (
    actor_user_id,
    action_type,
    target_store_id,
    reason,
    metadata
  )
  values (
    auth.uid(),
    case when p_on_hold then 'store_hold_placed' else 'store_hold_removed' end,
    v_store.id,
    case when p_on_hold then v_reason else null end,
    jsonb_build_object(
      'previous_value', v_previous_reason,
      'new_value', case when p_on_hold then v_reason else null end
    )
  );
end;
$$;


create or replace function public.admin_change_store_plan(
  p_store_id uuid,
  p_plan_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store public.stores%rowtype;
  v_billing public.seller_billing_status%rowtype;
  v_previous_plan_key text;
  v_inventory record;
begin
  if not public.is_admin() then
    raise exception 'Not authorized to perform admin operations.';
  end if;

  if p_store_id is null then
    raise exception 'Store is required.';
  end if;

  if p_plan_key is null
    or p_plan_key not in ('small_flock', 'full_flock') then
    raise exception 'Plan must be small_flock or full_flock.';
  end if;

  select *
  into v_store
  from public.stores
  where stores.id = p_store_id
  for update;

  if v_store.id is null then
    raise exception 'Store is not available.';
  end if;

  select *
  into v_billing
  from public.seller_billing_status
  where seller_billing_status.store_id = v_store.id
  for update;

  if v_billing.stripe_subscription_id is not null then
    raise exception 'This store has a linked Stripe subscription. Change its plan through the billing integration.';
  end if;

  v_previous_plan_key := public.get_store_plan_key(v_store.id);

  if v_billing.id is null then
    insert into public.seller_billing_status (
      store_id,
      plan_key
    )
    values (
      v_store.id,
      p_plan_key
    );
  else
    update public.seller_billing_status
    set plan_key = p_plan_key
    where seller_billing_status.store_id = v_store.id;
  end if;

  -- Reuse the shared capability authority after changing the effective plan.
  -- Any exception rolls the plan update and activity insert back together.
  perform public.assert_store_plan_allows_store_modules(
    v_store.id,
    v_store.hatching_eggs_enabled,
    v_store.equipment_supplies_enabled,
    v_store.processed_poultry_enabled
  );

  for v_inventory in
    select
      inventory_items.id as inventory_item_id,
      inventory_items.listing_batch_id,
      listing_batches.batch_type,
      inventory_items.inventory_type,
      inventory_items.custom_inventory_label,
      inventory_items.quantity_available,
      inventory_items.visibility_status
    from public.inventory_items
    join public.listing_batches
      on listing_batches.id = inventory_items.listing_batch_id
    where inventory_items.store_id = v_store.id
      and inventory_items.visibility_status = 'active'
  loop
    perform public.assert_store_plan_allows_inventory_item(
      v_store.id,
      v_inventory.listing_batch_id,
      v_inventory.batch_type,
      v_inventory.inventory_type,
      v_inventory.custom_inventory_label,
      v_inventory.quantity_available,
      v_inventory.visibility_status,
      v_inventory.inventory_item_id
    );
  end loop;

  insert into public.admin_activity_events (
    actor_user_id,
    action_type,
    target_store_id,
    metadata
  )
  values (
    auth.uid(),
    'store_plan_changed',
    v_store.id,
    jsonb_build_object(
      'previous_value', v_previous_plan_key,
      'new_value', p_plan_key,
      'change_mode', 'pre_stripe_admin_override'
    )
  );
end;
$$;


create or replace function public.admin_update_store_internal_note(
  p_store_id uuid,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_note text;
  v_previous_note text;
begin
  if not public.is_admin() then
    raise exception 'Not authorized to perform admin operations.';
  end if;

  if p_store_id is null then
    raise exception 'Store is required.';
  end if;

  if not exists (
    select 1
    from public.stores
    where stores.id = p_store_id
    for update
  ) then
    raise exception 'Store is not available.';
  end if;

  v_note := nullif(trim(p_note), '');

  if v_note is not null and length(v_note) > 4000 then
    raise exception 'Internal note must be 4000 characters or fewer.';
  end if;

  select admin_store_internal_notes.note
  into v_previous_note
  from public.admin_store_internal_notes
  where admin_store_internal_notes.store_id = p_store_id
  for update;

  if v_note is null then
    delete from public.admin_store_internal_notes
    where admin_store_internal_notes.store_id = p_store_id;
  else
    insert into public.admin_store_internal_notes (
      store_id,
      note,
      updated_by_user_id
    )
    values (
      p_store_id,
      v_note,
      auth.uid()
    )
    on conflict (store_id) do update
    set
      note = excluded.note,
      updated_by_user_id = excluded.updated_by_user_id;
  end if;

  insert into public.admin_activity_events (
    actor_user_id,
    action_type,
    target_store_id,
    metadata
  )
  values (
    auth.uid(),
    'store_internal_note_updated',
    p_store_id,
    jsonb_build_object(
      'had_note_before', v_previous_note is not null,
      'has_note_after', v_note is not null
    )
  );
end;
$$;


comment on function public.admin_platform_store_operations_summary(uuid) is
'Platform-admin-only operational summary for one store. Recorded gross sales match seller Reports by summing non-canceled order totals without payment or refund adjustments.';

comment on function public.admin_set_storefront_enabled(uuid, boolean) is
'Narrow audited platform-admin operation that changes only stores.storefront_enabled.';

comment on function public.admin_set_store_hold(uuid, boolean, text) is
'Narrow audited platform-admin operation that changes only stores.admin_hold_reason. A nonempty reason is required when placing a hold.';

comment on function public.admin_change_store_plan(uuid, text) is
'Pre-Stripe audited platform-admin plan override. Rejects linked Stripe subscriptions and reuses shared plan capability guards before committing.';

comment on function public.admin_update_store_internal_note(uuid, text) is
'Narrow audited platform-admin operation for the private one-note-per-store support note. Activity metadata never contains note text.';

revoke all on function public.admin_platform_store_operations_summary(uuid) from public;
revoke all on function public.admin_set_storefront_enabled(uuid, boolean) from public;
revoke all on function public.admin_set_store_hold(uuid, boolean, text) from public;
revoke all on function public.admin_change_store_plan(uuid, text) from public;
revoke all on function public.admin_update_store_internal_note(uuid, text) from public;

grant execute on function public.admin_platform_store_operations_summary(uuid) to authenticated;
grant execute on function public.admin_set_storefront_enabled(uuid, boolean) to authenticated;
grant execute on function public.admin_set_store_hold(uuid, boolean, text) to authenticated;
grant execute on function public.admin_change_store_plan(uuid, text) to authenticated;
grant execute on function public.admin_update_store_internal_note(uuid, text) to authenticated;

commit;
