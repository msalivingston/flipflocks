begin;

create extension if not exists pgtap with schema extensions;
select plan(4);

select ok(
  position(
    'assert_live_bird_minimum_order_quantities'
    in (
      select pg_get_functiondef(procedures.oid)
    from pg_proc as procedures
    join pg_namespace as namespaces on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'public'
      and procedures.proname = 'seller_create_manual_order'
    limit 1
    )
  ) = 0,
  'seller manual order creation bypasses live-bird minimums'
);

select ok(
  position(
    'assert_live_bird_minimum_order_quantities'
    in (
      select pg_get_functiondef(procedures.oid)
    from pg_proc as procedures
    join pg_namespace as namespaces on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'public'
      and procedures.proname = 'seller_edit_order'
    limit 1
    )
  ) = 0,
  'seller order editing bypasses live-bird minimums'
);

select ok(
  position(
    'assert_live_bird_minimum_order_quantities'
    in (
      select pg_get_functiondef(procedures.oid)
    from pg_proc as procedures
    join pg_namespace as namespaces on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'public'
      and procedures.proname = 'create_pay_at_pickup_order_v2_batch_d_internal'
    limit 1
    )
  ) > 0,
  'customer pay-at-pickup checkout retains live-bird minimum enforcement'
);

select ok(
  position(
    'assert_live_bird_minimum_order_quantities'
    in (
      select pg_get_functiondef(procedures.oid)
    from pg_proc as procedures
    join pg_namespace as namespaces on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'public'
      and procedures.proname = 'reserve_storefront_card_checkout'
    limit 1
    )
  ) > 0,
  'customer card checkout retains live-bird minimum enforcement'
);

select * from finish();
rollback;
