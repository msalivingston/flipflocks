begin;

create extension if not exists pgtap with schema extensions;

select plan(15);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'order_items'
      and column_name = 'inventory_debited_quantity'
      and is_nullable = 'YES'
  ),
  'inventory debit classification is nullable during the historical rollout'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.order_items'::regclass
      and conname = 'order_items_inventory_debited_quantity_range_check'
      and not convalidated
  ),
  'the debit range constraint is installed NOT VALID for live-data compatibility'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.order_items'::regclass
      and conname = 'order_items_restored_not_over_debited_check'
      and not convalidated
  ),
  'the restored-versus-debited constraint is installed NOT VALID'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.reconcile_order_inventory(uuid,text,jsonb)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.reconcile_order_inventory(uuid,text,jsonb)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.reconcile_order_inventory(uuid,text,jsonb)',
    'execute'
  ),
  'raw inventory reconciliation is owner-internal for all request roles'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.record_order_inventory_reconciliation(uuid,uuid,text,jsonb)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.record_order_inventory_reconciliation(uuid,uuid,text,jsonb)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.record_order_inventory_reconciliation(uuid,uuid,text,jsonb)',
    'execute'
  ),
  'raw inventory audit insertion is owner-internal'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.create_pay_at_pickup_order_v2(uuid,text,text,text,text,jsonb,text,text,text,text,text,text,text,text,text,text,text,text,text,inet,text,uuid,text,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.create_pay_at_pickup_order_v2(uuid,text,text,text,text,jsonb,text,text,text,text,text,text,text,text,text,text,text,text,text,inet,text,uuid,text,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.create_pay_at_pickup_order_v2(uuid,text,text,text,text,jsonb,text,text,text,text,text,text,text,text,text,text,text,text,text,inet,text,uuid,text,uuid)',
    'execute'
  ),
  'canonical public checkout creation remains service-role-only'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.seller_create_manual_order(uuid,text,jsonb,uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,numeric,numeric,boolean,boolean,uuid,text,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.seller_create_manual_order(uuid,text,jsonb,uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,numeric,numeric,boolean,boolean,uuid,text,uuid)',
    'execute'
  ),
  'manual order creation remains an authenticated seller action'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.seller_edit_order(uuid,jsonb,jsonb,uuid,text,text,text,text,text,text,text,uuid,text,uuid,text,numeric,text,text,text,text,text,text,numeric)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.seller_edit_order(uuid,jsonb,jsonb,uuid,text,text,text,text,text,text,text,uuid,text,uuid,text,numeric,text,text,text,text,text,text,numeric)',
    'execute'
  ),
  'order editing remains authenticated and is not anonymous'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.cancel_order(uuid,text,boolean,boolean)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.cancel_order(uuid,text,boolean,boolean)',
    'execute'
  ),
  'the current cancellation action remains authenticated'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.reinstate_order(uuid,text)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.reinstate_order(uuid,text)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.reinstate_order(uuid,text)',
    'execute'
  ),
  'reinstatement remains an authenticated seller/admin action only'
);

select ok(
  coalesce(
    (
      select bool_and(
        not has_function_privilege('anon', p.oid, 'execute')
        and not has_function_privilege('authenticated', p.oid, 'execute')
        and not has_function_privilege('service_role', p.oid, 'execute')
      )
      from pg_proc as p
      join pg_namespace as n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and (
          p.proname = 'create_pay_at_pickup_order'
          or (
            p.proname = 'create_pay_at_pickup_order_v2'
            and p.oid <> 'public.create_pay_at_pickup_order_v2(uuid,text,text,text,text,jsonb,text,text,text,text,text,text,text,text,text,text,text,text,text,inet,text,uuid,text,uuid)'::regprocedure
          )
        )
    ),
    true
  ),
  'every legacy checkout overload is retired from request roles'
);

select ok(
  coalesce(
    (
      select bool_and(
        not has_function_privilege('anon', p.oid, 'execute')
        and not has_function_privilege('authenticated', p.oid, 'execute')
        and not has_function_privilege('service_role', p.oid, 'execute')
      )
      from pg_proc as p
      join pg_namespace as n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'cancel_order'
        and p.oid <> 'public.cancel_order(uuid,text,boolean,boolean)'::regprocedure
    ),
    true
  ),
  'historical cancellation overloads are no longer request-role callable'
);

select ok(
  coalesce(
    (
      select bool_and(
        not has_function_privilege('anon', p.oid, 'execute')
        and not has_function_privilege('authenticated', p.oid, 'execute')
        and not has_function_privilege('service_role', p.oid, 'execute')
      )
      from pg_proc as p
      join pg_namespace as n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname like '%batch_d_internal'
    ),
    false
  ),
  'all retained Batch D persistence implementations are owner-internal'
);

select ok(
  (
    select proconfig @> array['search_path=public, pg_temp']::text[]
    from pg_proc
    where oid = 'public.reconcile_order_inventory(uuid,text,jsonb)'::regprocedure
  ),
  'the inventory reconciler has a fixed search path'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.order_events'::regclass
      and conname = 'order_events_event_type_check'
      and pg_get_constraintdef(oid) like '%order_inventory_reconciled%'
  ),
  'normalized inventory audit events are accepted by the event constraint'
);

select * from finish();

rollback;
