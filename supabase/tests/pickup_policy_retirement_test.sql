begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

select has_column(
  'public',
  'stores',
  'pickup_policy',
  'stores retains pickup_policy'
);

select hasnt_column(
  'public',
  'stores',
  'pickup_instructions',
  'stores no longer has pickup_instructions'
);

select has_column(
  'public',
  'stores',
  'pickup_location_text',
  'stores retains pickup_location_text'
);

select has_column(
  'public',
  'stores',
  'pickup_address_line1',
  'stores retains pickup address fields'
);

select has_column(
  'public',
  'orders',
  'pickup_note',
  'orders retains pickup_note'
);

select has_column(
  'public',
  'orders',
  'buyer_notes',
  'orders retains buyer_notes'
);

select has_column(
  'public',
  'public_storefronts',
  'pickup_policy',
  'public_storefronts exposes pickup_policy'
);

select hasnt_column(
  'public',
  'public_storefronts',
  'pickup_instructions',
  'public_storefronts does not expose pickup_instructions'
);

select hasnt_column(
  'public',
  'public_storefront_home',
  'pickup_instructions',
  'public_storefront_home does not expose pickup_instructions'
);

select hasnt_column(
  'public',
  'public_storefront_item_detail',
  'pickup_instructions',
  'public_storefront_item_detail does not expose pickup_instructions'
);

select hasnt_column(
  'public',
  'seller_store_defaults',
  'pickup_instructions',
  'seller_store_defaults does not expose pickup_instructions'
);

select ok(
  position(
    'pickup_instructions' in
    pg_get_functiondef('public.get_seller_context()'::regprocedure)
  ) = 0,
  'get_seller_context omits pickup_instructions'
);

select ok(
  position(
    'pickup_instructions' in
    pg_get_functiondef(
      'public.seller_update_store_settings(uuid,jsonb)'::regprocedure
    )
  ) = 0,
  'seller_update_store_settings rejects the retired input'
);

select ok(
  position(
    'pickup_instructions' in
    pg_get_functiondef(
      'public.seller_update_store_defaults(uuid,jsonb)'::regprocedure
    )
  ) = 0,
  'seller_update_store_defaults rejects the retired input'
);

select ok(
  position(
    'pickup_instructions' in
    pg_get_functiondef(
      'public.seller_save_onboarding_pickup(jsonb)'::regprocedure
    )
  ) = 0,
  'seller onboarding saves pickup_policy only'
);

select ok(
  position(
    'pickup_policy_present' in
    pg_get_functiondef(
      'public.evaluate_store_launch_readiness(uuid,uuid)'::regprocedure
    )
  ) > 0,
  'launch readiness checks pickup_policy'
);

select ok(
  position(
    'pickup_instructions' in
    pg_get_functiondef(
      'public.get_public_storefront_home(text)'::regprocedure
    )
  ) = 0,
  'public storefront RPC omits pickup_instructions'
);

select ok(
  position(
    'pickup_instructions' in
    pg_get_functiondef(
      'public.get_seller_storefront_home_preview(text)'::regprocedure
    )
  ) = 0,
  'seller storefront preview omits pickup_instructions'
);

select * from finish();

rollback;
