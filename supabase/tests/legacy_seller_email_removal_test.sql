begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

select hasnt_column(
  'public',
  'stores',
  'communication_email',
  'stores.communication_email is removed'
);

select hasnt_column(
  'public',
  'stores',
  'order_notification_email',
  'stores.order_notification_email is removed'
);

select has_column(
  'public',
  'stores',
  'public_email',
  'stores.public_email remains available'
);

select has_column(
  'public',
  'stores',
  'show_public_email',
  'stores.show_public_email remains available'
);

select is_empty(
  $$
    select constraints.oid
    from pg_constraint as constraints
    where constraints.conrelid = 'public.stores'::regclass
      and constraints.conname in (
        'stores_communication_email_not_empty_check',
        'stores_order_notification_email_not_empty_check'
      )
  $$,
  'obsolete legacy email constraints are removed'
);

select is_empty(
  $$
    select procedures.oid
    from pg_proc as procedures
    join pg_namespace as namespaces
      on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'public'
      and (
        procedures.prosrc ilike '%communication_email%'
        or procedures.prosrc ilike '%order_notification_email%'
      )
  $$,
  'no active public function references either removed column'
);

select is_empty(
  $$
    select viewname
    from pg_views
    where schemaname = 'public'
      and (
        definition ilike '%communication_email%'
        or definition ilike '%order_notification_email%'
      )
  $$,
  'no active public view references either removed column'
);

select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'seller_store_defaults'
      and column_name in ('communication_email', 'order_notification_email')
  ),
  0,
  'seller_store_defaults no longer exposes either removed column'
);

select ok(
  position(
    'order_notification_email' in
    pg_get_function_result('public.get_seller_context()'::regprocedure)
  ) = 0,
  'get_seller_context no longer returns the legacy notification field'
);

select ok(
  position(
    'order_notification_email' in
    pg_get_function_result(
      'public.seller_update_store_settings(uuid,jsonb)'::regprocedure
    )
  ) = 0,
  'seller_update_store_settings no longer returns the legacy notification field'
);

select ok(
  (
    select count(*) = 4
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
      and procedures.prosrc like '%null::text%'
  ),
  'current order and manual-order functions retain their queue call without a legacy recipient field'
);

select matches(
  pg_get_functiondef('public.get_public_storefront_home(text)'::regprocedure),
  'target_store\.public_email',
  'public storefront home still reads public_email'
);

select matches(
  pg_get_functiondef('public.get_public_storefront_home(text)'::regprocedure),
  'target_store\.show_public_email',
  'public storefront home still reads show_public_email'
);

select * from finish();

rollback;
