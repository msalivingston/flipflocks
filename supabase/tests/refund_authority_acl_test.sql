begin;

create extension if not exists pgtap with schema extensions;

select plan(17);

select ok(
  (
    select column_default is null
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'order_refunds'
      and column_name = 'refund_status'
  ),
  'refund status has no implicit succeeded default'
);

select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'order_refunds'
      and column_name in (
        'currency_code',
        'payment_provider_event_id',
        'stripe_checkout_session_id',
        'stripe_payment_intent_id',
        'stripe_account_id',
        'stripe_livemode'
      )
  ),
  6,
  'future provider refunds have explicit currency, event, session, intent, account, and mode bindings'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.order_refunds'::regclass
      and conname = 'order_refunds_offline_authority_check'
      and not convalidated
  ),
  'offline/provider consistency is installed NOT VALID for historical compatibility'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.order_refunds'::regclass
      and conname = 'order_refunds_stripe_binding_check'
      and not convalidated
  ),
  'Stripe binding consistency is installed NOT VALID'
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
        and p.proname = 'seller_record_refund'
    ),
    true
  ),
  'every generic seller refund overload is unavailable to request roles'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.seller_record_offline_refund(uuid,text,numeric,text,text,text)',
    'execute'
  )
  and not exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.oid = 'public.seller_record_offline_refund(uuid,text,numeric,text,text,text)'::regprocedure
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.seller_record_offline_refund(uuid,text,numeric,text,text,text)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.seller_record_offline_refund(uuid,text,numeric,text,text,text)',
    'execute'
  ),
  'the narrow offline action is authenticated-only'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.record_stripe_refund_result(uuid,uuid,text,text,text,timestamptz)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.record_stripe_refund_result(uuid,uuid,text,text,text,timestamptz)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.record_stripe_refund_result(uuid,uuid,text,text,text,timestamptz)',
    'execute'
  ),
  'the retained Stripe result boundary is service-role-only'
);

select ok(
  coalesce(
    (
      select bool_and(
        not has_function_privilege('anon', p.oid, 'execute')
        and not has_function_privilege('authenticated', p.oid, 'execute')
        and (
          p.oid = 'public.record_stripe_refund_result(uuid,uuid,text,text,text,timestamptz)'::regprocedure
          or not has_function_privilege('service_role', p.oid, 'execute')
        )
      )
      from pg_proc as p
      join pg_namespace as n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'record_stripe_refund_result'
    ),
    false
  ),
  'historical Stripe result overloads remain unavailable'
);

select ok(
  not has_table_privilege('anon', 'public.order_refunds', 'insert')
  and not has_table_privilege('anon', 'public.order_refunds', 'update')
  and not has_table_privilege('authenticated', 'public.order_refunds', 'insert')
  and not has_table_privilege('authenticated', 'public.order_refunds', 'update'),
  'browser roles cannot write the refund ledger directly'
);

select ok(
  (
    select proconfig @> array['search_path=public, extensions, pg_temp']::text[]
    from pg_proc
    where oid = 'public.seller_record_offline_refund(uuid,text,numeric,text,text,text)'::regprocedure
  ),
  'the offline action has a fixed search path'
);

select ok(
  to_regprocedure('extensions.digest(text,text)') is not null
  and pg_get_functiondef(
    'public.seller_record_offline_refund(uuid,text,numeric,text,text,text)'::regprocedure
  ) like '%digest(%',
  'the offline idempotency hash resolves through the extensions pgcrypto schema'
);

select ok(
  pg_get_functiondef(
    'public.seller_record_offline_refund(uuid,text,numeric,text,text,text)'::regprocedure
  ) like '%v_actor_user_id uuid := auth.uid()%'
  and pg_get_functiondef(
    'public.seller_record_offline_refund(uuid,text,numeric,text,text,text)'::regprocedure
  ) like '%for update%',
  'the offline action derives the actor and locks database state'
);

select ok(
  pg_get_functiondef(
    'public.seller_record_offline_refund(uuid,text,numeric,text,text,text)'::regprocedure
  ) like '%v_order.currency_code%'
  and pg_get_functiondef(
    'public.seller_record_offline_refund(uuid,text,numeric,text,text,text)'::regprocedure
  ) not like '%p_currency%',
  'offline currency is derived from the order'
);

select ok(
  pg_get_functiondef(
    'public.record_stripe_refund_result(uuid,uuid,text,text,text,timestamptz)'::regprocedure
  ) like '%auth.role()%service_role%'
  and pg_get_functiondef(
    'public.record_stripe_refund_result(uuid,uuid,text,text,text,timestamptz)'::regprocedure
  ) like '%Stripe refund reconciliation is disabled%',
  'the service provider boundary has an internal assertion and fails closed'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'order_refunds'
      and indexname = 'order_refunds_payment_provider_event_unique_idx'
  ),
  'a provider event can bind to at most one refund'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'order_refunds'
      and indexname = 'order_refunds_provider_refund_id_unique_idx'
  ),
  'provider refund identifiers remain unique'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.order_refunds'::regclass
      and conname = 'order_refunds_payment_provider_event_fk'
      and not convalidated
  ),
  'provider event binding uses a historical-compatible foreign key'
);

select * from finish();

rollback;
