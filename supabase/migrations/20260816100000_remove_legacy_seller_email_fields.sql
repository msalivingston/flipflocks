begin;

-- Batch 1 made auth.users.email authoritative for transactional routing. The
-- remaining order functions still pass the retired store column into an RPC
-- argument that now resolves recipients server-side. Preserve every other
-- part of those functions while replacing only that dead argument.
do $migration$
declare
  v_definition text;
  v_defaults_definition text;
  v_context_definition text;
  v_settings_definition text;
  v_function record;
begin
  for v_function in
    select procedures.oid, procedures.proname
    from pg_proc as procedures
    join pg_namespace as namespaces
      on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'public'
      and procedures.proname in (
        'cancel_order_batch_d_internal',
        'create_pay_at_pickup_order',
        'create_pay_at_pickup_order_v2_batch_d_internal',
        'seller_create_manual_order_batch_d_internal'
      )
      and procedures.prosrc like '%v_store.order_notification_email%'
  loop
    v_definition := pg_get_functiondef(v_function.oid);

    if length(v_definition) - length(replace(
      v_definition,
      'v_store.order_notification_email',
      ''
    )) <> length('v_store.order_notification_email') then
      raise exception
        'Expected one legacy recipient argument in public.%.',
        v_function.proname;
    end if;

    execute replace(
      v_definition,
      'v_store.order_notification_email',
      'null::text'
    );
  end loop;

  if (
    select count(*)
    from pg_proc as procedures
    join pg_namespace as namespaces
      on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'public'
      and procedures.proname in (
        'cancel_order_batch_d_internal',
        'create_pay_at_pickup_order',
        'create_pay_at_pickup_order_v2_batch_d_internal',
        'seller_create_manual_order_batch_d_internal'
      )
      and procedures.prosrc like '%v_store.order_notification_email%'
  ) <> 0 then
    raise exception 'Legacy order recipient arguments were not fully removed.';
  end if;

  select pg_get_functiondef(
    'public.seller_update_store_defaults(uuid,jsonb)'::regprocedure
  ) into v_defaults_definition;
  select pg_get_functiondef(
    'public.get_seller_context()'::regprocedure
  ) into v_context_definition;
  select pg_get_functiondef(
    'public.seller_update_store_settings(uuid,jsonb)'::regprocedure
  ) into v_settings_definition;

  -- Remove the two accepted defaults keys and their update assignments.
  v_defaults_definition := regexp_replace(
    v_defaults_definition,
    E'[[:space:]]*''communication_email'',[[:space:]]*',
    E'\n',
    'g'
  );
  v_defaults_definition := regexp_replace(
    v_defaults_definition,
    E'[[:space:]]*''order_notification_email'',[[:space:]]*',
    E'\n',
    'g'
  );
  v_defaults_definition := regexp_replace(
    v_defaults_definition,
    E'[[:space:]]*communication_email = case[[:space:]]+when p_defaults \\? ''communication_email''[[:space:]]+then lower\\(nullif\\(trim\\(p_defaults ->> ''communication_email''\\), ''''\\)\\)[[:space:]]+else stores\\.communication_email[[:space:]]+end,',
    '',
    'g'
  );
  v_defaults_definition := regexp_replace(
    v_defaults_definition,
    E'[[:space:]]*order_notification_email = case[[:space:]]+when p_defaults \\? ''order_notification_email''[[:space:]]+then lower\\(nullif\\(trim\\(p_defaults ->> ''order_notification_email''\\), ''''\\)\\)[[:space:]]+else stores\\.order_notification_email[[:space:]]+end,',
    '',
    'g'
  );

  -- get_seller_context and seller_update_store_settings expose a named table
  -- contract, so both must be dropped and recreated with the field removed.
  v_context_definition := replace(
    v_context_definition,
    ', order_notification_email text,',
    ','
  );
  v_context_definition := regexp_replace(
    v_context_definition,
    E'[[:space:]]*stores\\.order_notification_email,',
    E'\n',
    'g'
  );

  v_settings_definition := replace(
    v_settings_definition,
    ', order_notification_email text,',
    ','
  );
  v_settings_definition := regexp_replace(
    v_settings_definition,
    E'[[:space:]]*''order_notification_email'',[[:space:]]*',
    E'\n',
    'g'
  );
  v_settings_definition := regexp_replace(
    v_settings_definition,
    E'[[:space:]]*order_notification_email = case[[:space:]]+when p_settings \\? ''order_notification_email''[[:space:]]+then lower\\(nullif\\(trim\\(p_settings ->> ''order_notification_email''\\), ''''\\)\\)[[:space:]]+else stores\\.order_notification_email[[:space:]]+end',
    '',
    'g'
  );
  v_settings_definition := regexp_replace(
    v_settings_definition,
    E'end,[[:space:]]+where stores\\.id',
    E'end\n  where stores.id',
    'g'
  );
  v_settings_definition := regexp_replace(
    v_settings_definition,
    E'[[:space:]]*v_store\\.order_notification_email,',
    E'\n',
    'g'
  );

  if v_defaults_definition ~ 'communication_email|order_notification_email'
    or v_context_definition ~ 'communication_email|order_notification_email'
    or v_settings_definition ~ 'communication_email|order_notification_email'
  then
    raise exception 'A rebuilt seller contract still references a legacy email field.';
  end if;

  drop function public.seller_update_store_defaults(uuid, jsonb);
  drop view public.seller_store_defaults;
  drop function public.get_seller_context();
  drop function public.seller_update_store_settings(uuid, jsonb);

  alter table public.stores
    drop constraint if exists stores_communication_email_not_empty_check,
    drop constraint if exists stores_order_notification_email_not_empty_check;

  alter table public.stores
    drop column communication_email,
    drop column order_notification_email;

  execute $view$
    create view public.seller_store_defaults
    with (security_barrier = true)
    as
    select
      stores.id as store_id,
      stores.pickup_location_text,
      stores.default_pickup_option_id,
      store_pickup_options.label as default_pickup_option_label,
      stores.currency,
      stores.updated_at,
      stores.pickup_method,
      stores.delivery_enabled,
      stores.pickup_address_line1,
      stores.pickup_address_line2,
      stores.pickup_city,
      stores.pickup_state,
      stores.pickup_postal_code,
      stores.pickup_country
    from public.stores
    left join public.store_pickup_options
      on store_pickup_options.id = stores.default_pickup_option_id
     and store_pickup_options.store_id = stores.id
    where public.owns_store(stores.id) or public.is_admin()
  $view$;

  execute v_context_definition;
  execute v_settings_definition;
  execute v_defaults_definition;

  if exists (
    select 1
    from pg_proc as procedures
    join pg_namespace as namespaces
      on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'public'
      and (
        procedures.prosrc ilike '%communication_email%'
        or procedures.prosrc ilike '%order_notification_email%'
      )
  ) or exists (
    select 1
    from pg_views
    where schemaname = 'public'
      and (
        definition ilike '%communication_email%'
        or definition ilike '%order_notification_email%'
      )
  ) then
    raise exception 'An active public function or view still references a legacy email field.';
  end if;
end;
$migration$;

comment on view public.seller_store_defaults is
'Seller-private pickup, delivery, and currency defaults used to prefill seller workflows.';

comment on function public.get_seller_context() is
'Seller dashboard bootstrap context. Returns only stores the current user owns or has scoped seller/staff membership for; platform admin status alone does not grant seller dashboard context.';

comment on function public.seller_update_store_settings(uuid, jsonb) is
'Seller/admin RPC for updating seller-editable storefront settings. Transactional seller email routing is not configurable here.';

comment on function public.seller_update_store_defaults(uuid, jsonb) is
'Updates seller-owned pickup, delivery, and currency defaults. Transactional seller email routing is not configurable here.';

revoke all on public.seller_store_defaults from public;
grant select on public.seller_store_defaults to authenticated;

revoke all on function public.get_seller_context()
  from public, anon, authenticated, service_role;
grant execute on function public.get_seller_context() to authenticated;

revoke all on function public.seller_update_store_settings(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.seller_update_store_settings(uuid, jsonb)
  to authenticated;

revoke all on function public.seller_update_store_defaults(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.seller_update_store_defaults(uuid, jsonb)
  to authenticated;

commit;
