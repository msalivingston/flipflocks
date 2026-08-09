begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

select ok(
  to_regprocedure(
    'public.apply_verified_saas_plan_change_invoice_event(text,text,text,uuid,text,boolean,text,timestamptz,text,boolean,text,text,text,text,text,integer,timestamptz,timestamptz,text,text,text,text,bigint,bigint,bigint,bigint,timestamptz,timestamptz,timestamptz,timestamptz,integer,boolean,boolean,boolean,boolean,bigint,text,text,integer,text,text,text,text,text)'
  ) is not null,
  'the plan-change invoice event function retains its identity signature'
);

select ok(
  to_regprocedure(
    'public.apply_verified_saas_plan_change_subscription_event(text,text,uuid,text,boolean,text,timestamptz,text,text,boolean,text,text,text,text,timestamptz,timestamptz,boolean,integer,boolean,boolean,boolean,boolean,bigint,text,text,integer,text,text,text,text,text)'
  ) is not null,
  'the plan-change subscription event function retains its identity signature'
);

select is(
  pg_get_function_result(
    to_regprocedure(
      'public.apply_verified_saas_plan_change_invoice_event(text,text,text,uuid,text,boolean,text,timestamptz,text,boolean,text,text,text,text,text,integer,timestamptz,timestamptz,text,text,text,text,bigint,bigint,bigint,bigint,timestamptz,timestamptz,timestamptz,timestamptz,integer,boolean,boolean,boolean,boolean,bigint,text,text,integer,text,text,text,text,text)'
    )
  ),
  'TABLE(application_state text, store_id uuid, invoice_id uuid, paid_through_at timestamp with time zone, grace_ends_at timestamp with time zone, billing_complete boolean)',
  'the plan-change invoice event return contract is unchanged'
);

select is(
  pg_get_function_result(
    to_regprocedure(
      'public.apply_verified_saas_plan_change_subscription_event(text,text,uuid,text,boolean,text,timestamptz,text,text,boolean,text,text,text,text,timestamptz,timestamptz,boolean,integer,boolean,boolean,boolean,boolean,bigint,text,text,integer,text,text,text,text,text)'
    )
  ),
  'TABLE(application_state text, store_id uuid, subscription_status text, paid_through_at timestamp with time zone, grace_ends_at timestamp with time zone)',
  'the plan-change subscription event return contract is unchanged'
);

select ok(
  (
    select bool_and(
      procedure.prosecdef
      and procedure.provolatile = 'v'
      and not procedure.proisstrict
      and procedure.proparallel = 'u'
      and procedure.proconfig @> array['search_path=pg_catalog, public']::text[]
      and has_function_privilege('service_role', procedure.oid, 'execute')
      and not has_function_privilege('anon', procedure.oid, 'execute')
      and not has_function_privilege('authenticated', procedure.oid, 'execute')
    )
    from pg_proc as procedure
    where procedure.oid in (
      to_regprocedure(
        'public.apply_verified_saas_plan_change_invoice_event(text,text,text,uuid,text,boolean,text,timestamptz,text,boolean,text,text,text,text,text,integer,timestamptz,timestamptz,text,text,text,text,bigint,bigint,bigint,bigint,timestamptz,timestamptz,timestamptz,timestamptz,integer,boolean,boolean,boolean,boolean,bigint,text,text,integer,text,text,text,text,text)'
      ),
      to_regprocedure(
        'public.apply_verified_saas_plan_change_subscription_event(text,text,uuid,text,boolean,text,timestamptz,text,text,boolean,text,text,text,text,timestamptz,timestamptz,boolean,integer,boolean,boolean,boolean,boolean,bigint,text,text,integer,text,text,text,text,text)'
      )
    )
  ),
  'both corrected functions retain their attributes and service-role-only grants'
);

select ok(
  pg_get_functiondef(
    to_regprocedure(
      'public.apply_verified_saas_plan_change_invoice_event(text,text,text,uuid,text,boolean,text,timestamptz,text,boolean,text,text,text,text,text,integer,timestamptz,timestamptz,text,text,text,text,bigint,bigint,bigint,bigint,timestamptz,timestamptz,timestamptz,timestamptz,integer,boolean,boolean,boolean,boolean,bigint,text,text,integer,text,text,text,text,text)'
    )
  ) ~ 'select[[:space:]]+billing_status\.paid_through_at[[:space:]]+from[[:space:]]+public\.seller_billing_status[[:space:]]+as[[:space:]]+billing_status[[:space:]]+where[[:space:]]+billing_status\.store_id[[:space:]]*=[[:space:]]*v_enrollment\.store_id'
  and pg_get_functiondef(
    to_regprocedure(
      'public.apply_verified_saas_plan_change_invoice_event(text,text,text,uuid,text,boolean,text,timestamptz,text,boolean,text,text,text,text,text,integer,timestamptz,timestamptz,text,text,text,text,bigint,bigint,bigint,bigint,timestamptz,timestamptz,timestamptz,timestamptz,integer,boolean,boolean,boolean,boolean,bigint,text,text,integer,text,text,text,text,text)'
    )
  ) ~ 'select[[:space:]]+billing_status\.grace_ends_at[[:space:]]+from[[:space:]]+public\.seller_billing_status[[:space:]]+as[[:space:]]+billing_status[[:space:]]+where[[:space:]]+billing_status\.store_id[[:space:]]*=[[:space:]]*v_enrollment\.store_id'
  and pg_get_functiondef(
    to_regprocedure(
      'public.apply_verified_saas_plan_change_invoice_event(text,text,text,uuid,text,boolean,text,timestamptz,text,boolean,text,text,text,text,text,integer,timestamptz,timestamptz,text,text,text,text,bigint,bigint,bigint,bigint,timestamptz,timestamptz,timestamptz,timestamptz,integer,boolean,boolean,boolean,boolean,bigint,text,text,integer,text,text,text,text,text)'
    )
  ) ~ 'select[[:space:]]+onboarding_state\.billing_complete[[:space:]]+from[[:space:]]+public\.seller_onboarding_state[[:space:]]+as[[:space:]]+onboarding_state[[:space:]]+where[[:space:]]+onboarding_state\.store_id[[:space:]]*=[[:space:]]*v_enrollment\.store_id',
  'the invoice terminal return query qualifies all three colliding source columns'
);

select ok(
  pg_get_functiondef(
    to_regprocedure(
      'public.apply_verified_saas_plan_change_subscription_event(text,text,uuid,text,boolean,text,timestamptz,text,text,boolean,text,text,text,text,timestamptz,timestamptz,boolean,integer,boolean,boolean,boolean,boolean,bigint,text,text,integer,text,text,text,text,text)'
    )
  ) ~ 'select[[:space:]]+billing_status\.paid_through_at[[:space:]]+from[[:space:]]+public\.seller_billing_status[[:space:]]+as[[:space:]]+billing_status[[:space:]]+where[[:space:]]+billing_status\.store_id[[:space:]]*=[[:space:]]*v_enrollment\.store_id'
  and pg_get_functiondef(
    to_regprocedure(
      'public.apply_verified_saas_plan_change_subscription_event(text,text,uuid,text,boolean,text,timestamptz,text,text,boolean,text,text,text,text,timestamptz,timestamptz,boolean,integer,boolean,boolean,boolean,boolean,bigint,text,text,integer,text,text,text,text,text)'
    )
  ) ~ 'select[[:space:]]+billing_status\.grace_ends_at[[:space:]]+from[[:space:]]+public\.seller_billing_status[[:space:]]+as[[:space:]]+billing_status[[:space:]]+where[[:space:]]+billing_status\.store_id[[:space:]]*=[[:space:]]*v_enrollment\.store_id',
  'the subscription terminal return query qualifies both colliding source columns'
);

select ok(
  not pg_get_functiondef(
    to_regprocedure(
      'public.apply_verified_saas_plan_change_invoice_event(text,text,text,uuid,text,boolean,text,timestamptz,text,boolean,text,text,text,text,text,integer,timestamptz,timestamptz,text,text,text,text,bigint,bigint,bigint,bigint,timestamptz,timestamptz,timestamptz,timestamptz,integer,boolean,boolean,boolean,boolean,bigint,text,text,integer,text,text,text,text,text)'
    )
  ) ~ 'select[[:space:]]+(paid_through_at|grace_ends_at|billing_complete)[[:space:]]+from'
  and not pg_get_functiondef(
    to_regprocedure(
      'public.apply_verified_saas_plan_change_subscription_event(text,text,uuid,text,boolean,text,timestamptz,text,text,boolean,text,text,text,text,timestamptz,timestamptz,boolean,integer,boolean,boolean,boolean,boolean,bigint,text,text,integer,text,text,text,text,text)'
    )
  ) ~ 'select[[:space:]]+(paid_through_at|grace_ends_at)[[:space:]]+from',
  'neither corrected terminal return query retains a bare colliding source column'
);

select * from finish();

rollback;
