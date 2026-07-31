begin;

create extension if not exists pgtap with schema extensions;

select no_plan();
select set_config('request.jwt.claim.role', 'service_role', true);

select ok(
  (
    select bool_and(
      not has_function_privilege(
        'authenticated',
        signatures.signature,
        'EXECUTE'
      )
    )
    from (
      values
        ('public.enqueue_email_notification(uuid,uuid,text,text,text,text,jsonb,text)'),
        ('public.enqueue_email_notification(uuid,uuid,text,text,text,text,jsonb)'),
        ('public.claim_email_notifications_internal(uuid,boolean,integer,integer,interval)'),
        ('public.claim_phase_1_postmark_email_notifications(integer,integer,interval)'),
        ('public.claim_phase_1_postmark_email_notifications_for_order(uuid,integer,integer,interval)'),
        ('public.claim_email_notifications(integer,integer,interval)'),
        ('public.begin_email_notification_dispatch(uuid,uuid)'),
        ('public.mark_email_notification_sent(uuid,uuid)'),
        ('public.mark_email_notification_sent(uuid,uuid,text)'),
        ('public.mark_email_notification_failed(uuid,uuid,text,interval,integer)'),
        ('public.mark_email_notification_delivery_unknown(uuid,uuid,text,text)'),
        ('public.retry_email_notification(uuid,timestamptz,boolean)'),
        ('public.suppress_email_notification(uuid,text,integer)')
    ) as signatures(signature)
  ),
  'authenticated has no execute privilege on generic queue or raw worker overloads'
);

select ok(
  (
    select bool_and(
      has_function_privilege('service_role', signatures.signature, 'EXECUTE')
    )
    from (
      values
        ('public.enqueue_email_notification(uuid,uuid,text,text,text,text,jsonb,text)'),
        ('public.enqueue_email_notification(uuid,uuid,text,text,text,text,jsonb)'),
        ('public.claim_email_notifications_internal(uuid,boolean,integer,integer,interval)'),
        ('public.claim_phase_1_postmark_email_notifications(integer,integer,interval)'),
        ('public.claim_phase_1_postmark_email_notifications_for_order(uuid,integer,integer,interval)'),
        ('public.claim_email_notifications(integer,integer,interval)'),
        ('public.begin_email_notification_dispatch(uuid,uuid)'),
        ('public.mark_email_notification_sent(uuid,uuid)'),
        ('public.mark_email_notification_sent(uuid,uuid,text)'),
        ('public.mark_email_notification_failed(uuid,uuid,text,interval,integer)'),
        ('public.mark_email_notification_delivery_unknown(uuid,uuid,text,text)'),
        ('public.retry_email_notification(uuid,timestamptz,boolean)'),
        ('public.suppress_email_notification(uuid,text,integer)')
    ) as signatures(signature)
  ),
  'service_role retains execute privilege on required queue and worker primitives'
);

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
)
values
  (
    'b6000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'email-owner@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    ''
  ),
  (
    'b6000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'email-foreign@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    ''
  ),
  (
    'b6000000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'email-staff@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    ''
  ),
  (
    'b6000000-0000-4000-8000-000000000004',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'email-admin@example.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    ''
  );

insert into public.stores (
  id,
  owner_user_id,
  store_name,
  store_slug,
  store_status,
  storefront_mode,
  order_notification_email,
  communication_email,
  public_email
)
values
  (
    'b6000000-0000-4000-8000-000000000010',
    'b6000000-0000-4000-8000-000000000001',
    'Canonical Email Store',
    'canonical-email-store',
    'live',
    'hosted',
    'seller-orders@example.test',
    'seller-communication@example.test',
    'seller-public@example.test'
  ),
  (
    'b6000000-0000-4000-8000-000000000011',
    'b6000000-0000-4000-8000-000000000002',
    'Foreign Email Store',
    'foreign-email-store',
    'live',
    'hosted',
    null,
    'foreign-seller@example.test',
    null
  ),
  (
    'b6000000-0000-4000-8000-000000000012',
    'b6000000-0000-4000-8000-000000000001',
    'Missing Seller Recipient Store',
    'missing-seller-recipient-store',
    'live',
    'hosted',
    null,
    null,
    null
  );

insert into public.user_roles (user_id, role, store_id)
values
  (
    'b6000000-0000-4000-8000-000000000001',
    'seller',
    'b6000000-0000-4000-8000-000000000010'
  ),
  (
    'b6000000-0000-4000-8000-000000000002',
    'seller',
    'b6000000-0000-4000-8000-000000000011'
  ),
  (
    'b6000000-0000-4000-8000-000000000003',
    'staff',
    'b6000000-0000-4000-8000-000000000010'
  ),
  (
    'b6000000-0000-4000-8000-000000000004',
    'admin',
    null
  );

insert into public.customers (
  id,
  store_id,
  email,
  first_name,
  last_name
)
values
  (
    'b6000000-0000-4000-8000-000000000020',
    'b6000000-0000-4000-8000-000000000010',
    'canonical-buyer@example.test',
    'Canonical',
    'Buyer'
  ),
  (
    'b6000000-0000-4000-8000-000000000021',
    'b6000000-0000-4000-8000-000000000011',
    'foreign-buyer@example.test',
    'Foreign',
    'Buyer'
  ),
  (
    'b6000000-0000-4000-8000-000000000022',
    'b6000000-0000-4000-8000-000000000012',
    'missing-recipient-buyer@example.test',
    'Missing',
    'Seller Recipient'
  );

insert into public.orders (
  id,
  store_id,
  customer_id,
  order_number,
  order_source,
  order_status,
  payment_method,
  payment_status,
  buyer_email_snapshot,
  buyer_first_name_snapshot,
  buyer_last_name_snapshot,
  subtotal_amount,
  total_amount
)
values
  (
    'b6000000-0000-4000-8000-000000000030',
    'b6000000-0000-4000-8000-000000000010',
    'b6000000-0000-4000-8000-000000000020',
    'EMAIL-OWNER-1',
    'seller_created',
    'open',
    'pay_at_pickup',
    'pay_at_pickup',
    'canonical-buyer@example.test',
    'Canonical',
    'Buyer',
    25.00,
    25.00
  ),
  (
    'b6000000-0000-4000-8000-000000000031',
    'b6000000-0000-4000-8000-000000000011',
    'b6000000-0000-4000-8000-000000000021',
    'EMAIL-FOREIGN-1',
    'seller_created',
    'open',
    'pay_at_pickup',
    'pay_at_pickup',
    'foreign-buyer@example.test',
    'Foreign',
    'Buyer',
    30.00,
    30.00
  ),
  (
    'b6000000-0000-4000-8000-000000000032',
    'b6000000-0000-4000-8000-000000000012',
    'b6000000-0000-4000-8000-000000000022',
    'EMAIL-MISSING-1',
    'seller_created',
    'open',
    'pay_at_pickup',
    'pay_at_pickup',
    'missing-recipient-buyer@example.test',
    'Missing',
    'Seller Recipient',
    40.00,
    40.00
  ),
  (
    'b6000000-0000-4000-8000-000000000033',
    'b6000000-0000-4000-8000-000000000010',
    'b6000000-0000-4000-8000-000000000020',
    'EMAIL-OWNER-2',
    'storefront',
    'open',
    'pay_at_pickup',
    'pay_at_pickup',
    'canonical-buyer@example.test',
    'Canonical',
    'Buyer',
    50.00,
    50.00
  ),
  (
    'b6000000-0000-4000-8000-000000000034',
    'b6000000-0000-4000-8000-000000000010',
    'b6000000-0000-4000-8000-000000000020',
    'EMAIL-OWNER-3',
    'storefront',
    'open',
    'pay_at_pickup',
    'pay_at_pickup',
    'canonical-buyer@example.test',
    'Canonical',
    'Buyer',
    60.00,
    60.00
  );

insert into public.order_events (
  id,
  store_id,
  order_id,
  actor_user_id,
  actor_type,
  event_type,
  from_order_status,
  to_order_status,
  from_payment_status,
  to_payment_status,
  note
)
values
  (
    'b6000000-0000-4000-8000-000000000040',
    'b6000000-0000-4000-8000-000000000010',
    'b6000000-0000-4000-8000-000000000030',
    'b6000000-0000-4000-8000-000000000001',
    'seller',
    'order_edited',
    'open',
    'open',
    'pay_at_pickup',
    'pay_at_pickup',
    'Order edited'
  ),
  (
    'b6000000-0000-4000-8000-000000000041',
    'b6000000-0000-4000-8000-000000000011',
    'b6000000-0000-4000-8000-000000000031',
    'b6000000-0000-4000-8000-000000000004',
    'admin',
    'order_edited',
    'open',
    'open',
    'pay_at_pickup',
    'pay_at_pickup',
    'Order edited'
  ),
  (
    'b6000000-0000-4000-8000-000000000042',
    'b6000000-0000-4000-8000-000000000012',
    'b6000000-0000-4000-8000-000000000032',
    'b6000000-0000-4000-8000-000000000001',
    'seller',
    'order_edited',
    'open',
    'open',
    'pay_at_pickup',
    'pay_at_pickup',
    'Order edited'
  );

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claim.sub',
  'b6000000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;

select throws_ok(
  $call$
    select public.enqueue_email_notification(
      'b6000000-0000-4000-8000-000000000010',
      'b6000000-0000-4000-8000-000000000030',
      'buyer_order_confirmation',
      'buyer',
      'attacker@example.test',
      'Attacker subject',
      '{"buyer_email":"attacker@example.test"}'::jsonb,
      'attacker-suffix'
    )
  $call$,
  '42501',
  'permission denied for function enqueue_email_notification',
  'authenticated cannot call the eight-argument generic queue overload'
);

select throws_ok(
  $call$
    select public.enqueue_email_notification(
      'b6000000-0000-4000-8000-000000000010',
      'b6000000-0000-4000-8000-000000000030',
      'buyer_order_confirmation',
      'buyer',
      'attacker@example.test',
      'Attacker subject',
      '{"buyer_email":"attacker@example.test"}'::jsonb
    )
  $call$,
  '42501',
  'permission denied for function enqueue_email_notification',
  'authenticated cannot call the seven-argument generic queue overload'
);

select throws_ok(
  $$select * from public.claim_phase_1_postmark_email_notifications(1, 5, interval '15 minutes')$$,
  '42501',
  'permission denied for function claim_phase_1_postmark_email_notifications',
  'authenticated cannot claim the Phase 1 worker queue'
);

select throws_ok(
  $$select * from public.claim_email_notifications(1, 5, interval '15 minutes')$$,
  '42501',
  'permission denied for function claim_email_notifications',
  'authenticated cannot claim the generic worker queue'
);

select throws_ok(
  $$select * from public.claim_email_notifications_internal(
    'b6000000-0000-4000-8000-000000000030',
    true,
    1,
    5,
    interval '15 minutes'
  )$$,
  '42501',
  'permission denied for function claim_email_notifications_internal',
  'authenticated cannot call the internal scoped claim primitive'
);

select throws_ok(
  $$select * from public.claim_phase_1_postmark_email_notifications_for_order(
    'b6000000-0000-4000-8000-000000000030',
    1,
    5,
    interval '15 minutes'
  )$$,
  '42501',
  'permission denied for function claim_phase_1_postmark_email_notifications_for_order',
  'authenticated cannot call the order-scoped raw claim primitive'
);

select throws_ok(
  $$select public.mark_email_notification_sent(gen_random_uuid(), gen_random_uuid())$$,
  '42501',
  'permission denied for function mark_email_notification_sent',
  'authenticated cannot call the two-argument sent acknowledgment'
);

select throws_ok(
  $$select public.mark_email_notification_sent(gen_random_uuid(), gen_random_uuid(), 'forged-provider-id')$$,
  '42501',
  'permission denied for function mark_email_notification_sent',
  'authenticated cannot call the provider-ID sent acknowledgment'
);

select throws_ok(
  $$select public.mark_email_notification_failed(gen_random_uuid(), gen_random_uuid(), 'forged', interval '1 minute', 5)$$,
  '42501',
  'permission denied for function mark_email_notification_failed',
  'authenticated cannot call the raw failure acknowledgment'
);

select throws_ok(
  $$select * from public.begin_email_notification_dispatch(gen_random_uuid(), gen_random_uuid())$$,
  '42501',
  'permission denied for function begin_email_notification_dispatch',
  'authenticated cannot start a raw provider dispatch attempt'
);

select throws_ok(
  $$select public.mark_email_notification_delivery_unknown(gen_random_uuid(), gen_random_uuid(), 'forged', null)$$,
  '42501',
  'permission denied for function mark_email_notification_delivery_unknown',
  'authenticated cannot assert an ambiguous provider outcome'
);

select throws_ok(
  $$select public.retry_email_notification(gen_random_uuid(), now(), true)$$,
  '42501',
  'permission denied for function retry_email_notification',
  'authenticated cannot call the raw retry primitive'
);

select throws_ok(
  $$select public.suppress_email_notification(gen_random_uuid(), 'forged', 5)$$,
  '42501',
  'permission denied for function suppress_email_notification',
  'authenticated cannot call the raw suppression primitive'
);

select lives_ok(
  $$select * from public.seller_enqueue_updated_order_email(
    'b6000000-0000-4000-8000-000000000030'
  )$$,
  'legitimate owner can enqueue an updated-order pair'
);

select results_eq(
  $test$
    select
      notifications.notification_type,
      notifications.recipient_email
    from public.email_notifications as notifications
    where notifications.order_id = 'b6000000-0000-4000-8000-000000000030'
      and notifications.notification_type in (
        'buyer_order_updated',
        'seller_order_updated_copy'
      )
    order by notifications.notification_type
  $test$,
  $expected$
    values
      ('buyer_order_updated'::text, 'canonical-buyer@example.test'::text),
      ('seller_order_updated_copy'::text, 'seller-orders@example.test'::text)
  $expected$,
  'updated-order pair uses canonical buyer and seller recipients'
);

select lives_ok(
  $$select * from public.seller_enqueue_updated_order_email(
    'b6000000-0000-4000-8000-000000000030',
    'first-browser-token'
  )$$,
  'safe compatibility update wrapper accepts an obsolete browser token'
);

select lives_ok(
  $$select * from public.seller_enqueue_updated_order_email(
    'b6000000-0000-4000-8000-000000000030',
    'different-browser-token'
  )$$,
  'changing the obsolete browser token still resolves to the same trusted event'
);

select is(
  (
    select count(*)
    from public.email_notifications as notifications
    where notifications.order_id = 'b6000000-0000-4000-8000-000000000030'
      and notifications.notification_type in (
        'buyer_order_updated',
        'seller_order_updated_copy'
      )
  ),
  2::bigint,
  'random browser tokens cannot bypass event deduplication'
);

select lives_ok(
  $$select * from public.seller_resend_order_confirmation(
    'b6000000-0000-4000-8000-000000000030'
  )$$,
  'legitimate owner can request a confirmation resend'
);

select throws_ok(
  $$select * from public.seller_resend_order_confirmation(
    'b6000000-0000-4000-8000-000000000030',
    'random-browser-bypass'
  )$$,
  'P0001',
  'Email request is temporarily unavailable.',
  'browser token cannot bypass the resend cooldown'
);

select ok(
  (
    select queued_notification_count > 0
    from public.seller_request_order_email_processing(
      'b6000000-0000-4000-8000-000000000030'
    )
  ),
  'legitimate owner can authorize an order-scoped worker kick'
);

select throws_ok(
  $$select * from public.seller_request_order_email_processing(
    'b6000000-0000-4000-8000-000000000030'
  )$$,
  'P0001',
  'Email processing request is temporarily unavailable.',
  'worker kick cooldown is enforced'
);

reset role;

select is(
  (
    select count(*)
    from public.email_notifications as notifications
    where notifications.order_id = 'b6000000-0000-4000-8000-000000000030'
      and notifications.notification_type = 'buyer_order_confirmation'
  ),
  1::bigint,
  'cooldown denial leaves one resend row'
);

select ok(
  not exists (
    select 1
    from public.email_notifications as notifications
    where notifications.recipient_email = 'attacker@example.test'
      or notifications.subject_snapshot = 'Attacker subject'
      or notifications.payload ->> 'buyer_email' = 'attacker@example.test'
  ),
  'seller cannot choose arbitrary recipient, subject, or payload identity'
);

update public.order_email_action_requests
set created_at = now() - interval '2 minutes'
where order_id = 'b6000000-0000-4000-8000-000000000030'
  and action_type = 'resend_confirmation';

set local role authenticated;

select lives_ok(
  $$select * from public.seller_resend_order_confirmation(
    'b6000000-0000-4000-8000-000000000030'
  )$$,
  'second resend inside the hour succeeds after cooldown'
);

reset role;

update public.order_email_action_requests
set created_at = now() - interval '2 minutes'
where order_id = 'b6000000-0000-4000-8000-000000000030'
  and action_type = 'resend_confirmation';

set local role authenticated;

select lives_ok(
  $$select * from public.seller_resend_order_confirmation(
    'b6000000-0000-4000-8000-000000000030'
  )$$,
  'third resend inside the hour succeeds'
);

reset role;

update public.order_email_action_requests
set created_at = now() - interval '2 minutes'
where order_id = 'b6000000-0000-4000-8000-000000000030'
  and action_type = 'resend_confirmation';

set local role authenticated;

select throws_ok(
  $$select * from public.seller_resend_order_confirmation(
    'b6000000-0000-4000-8000-000000000030'
  )$$,
  'P0001',
  'Email request limit reached.',
  'fourth resend inside one hour is denied'
);

reset role;

insert into public.order_email_action_requests (
  store_id,
  order_id,
  actor_user_id,
  action_type,
  created_at
)
select
  'b6000000-0000-4000-8000-000000000010',
  'b6000000-0000-4000-8000-000000000033',
  'b6000000-0000-4000-8000-000000000001',
  'resend_confirmation',
  now() - interval '2 minutes'
from generate_series(1, 17);

set local role authenticated;

select throws_ok(
  $$select * from public.seller_resend_order_confirmation(
    'b6000000-0000-4000-8000-000000000033'
  )$$,
  'P0001',
  'Email request limit reached.',
  'store-wide daily resend limit is enforced'
);

select throws_ok(
  $$select * from public.seller_enqueue_updated_order_email(
    'b6000000-0000-4000-8000-000000000031'
  )$$,
  'P0001',
  'Order is not available.',
  'foreign tenant cannot enqueue order emails'
);

select throws_ok(
  $$select * from public.seller_request_order_email_processing(
    'b6000000-0000-4000-8000-000000000031'
  )$$,
  'P0001',
  'Order is not available.',
  'foreign tenant cannot kick another order worker scope'
);

reset role;
select set_config(
  'request.jwt.claim.sub',
  'b6000000-0000-4000-8000-000000000003',
  true
);
set local role authenticated;

select throws_ok(
  $$select * from public.seller_enqueue_updated_order_email(
    'b6000000-0000-4000-8000-000000000030'
  )$$,
  'P0001',
  'Order is not available.',
  'staff is consistently denied because current store authority is owner-only'
);

reset role;
select set_config(
  'request.jwt.claim.sub',
  'b6000000-0000-4000-8000-000000000004',
  true
);
set local role authenticated;

select lives_ok(
  $$select * from public.seller_enqueue_updated_order_email(
    'b6000000-0000-4000-8000-000000000031'
  )$$,
  'platform administrator can use the narrow update action with actual identity'
);

reset role;

select is(
  (
    select actor_user_id
    from public.order_email_action_requests
    where order_event_id = 'b6000000-0000-4000-8000-000000000041'
  ),
  'b6000000-0000-4000-8000-000000000004'::uuid,
  'platform administrator action audit records the real authenticated admin'
);

select set_config('request.jwt.claim.role', 'anon', true);
set local role anon;

select throws_ok(
  $$select * from public.seller_resend_order_confirmation(
    'b6000000-0000-4000-8000-000000000030'
  )$$,
  '42501',
  'permission denied for function seller_resend_order_confirmation',
  'anonymous cannot call the narrow resend action'
);

reset role;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claim.sub',
  'b6000000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;

select results_eq(
  $test$
    select *
    from public.seller_enqueue_updated_order_email(
      'b6000000-0000-4000-8000-000000000032'
    )
  $test$,
  $expected$
    values (false, false)
  $expected$,
  'missing canonical seller recipient creates no partial update pair'
);

reset role;

select is(
  (
    select count(*)
    from public.email_notifications
    where order_id = 'b6000000-0000-4000-8000-000000000032'
  ),
  0::bigint,
  'missing canonical recipient leaves no sendable queue row'
);

select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;

select lives_ok(
  $call$
    select public.enqueue_email_notification(
      'b6000000-0000-4000-8000-000000000010',
      'b6000000-0000-4000-8000-000000000033',
      'buyer_order_received',
      'buyer',
      'ignored@example.test',
      'Ignored subject',
      '{"buyer_email":"ignored@example.test"}'::jsonb
    )
  $call$,
  'trusted checkout/manual primitive enqueues the buyer order-created row'
);

select lives_ok(
  $call$
    select public.enqueue_email_notification(
      'b6000000-0000-4000-8000-000000000010',
      'b6000000-0000-4000-8000-000000000033',
      'seller_new_order_received',
      'seller',
      'ignored@example.test',
      'Ignored subject',
      '{"store_id":"00000000-0000-0000-0000-000000000000"}'::jsonb
    )
  $call$,
  'trusted checkout/manual primitive enqueues the seller order-created row'
);

select lives_ok(
  $call$
    select public.enqueue_email_notification(
      'b6000000-0000-4000-8000-000000000010',
      'b6000000-0000-4000-8000-000000000033',
      'buyer_order_received',
      'buyer',
      'different@example.test',
      'Different subject',
      '{"buyer_email":"different@example.test"}'::jsonb
    )
  $call$,
  'order-created retry is idempotent'
);

select throws_ok(
  $call$
    select public.enqueue_email_notification(
      'b6000000-0000-4000-8000-000000000010',
      'b6000000-0000-4000-8000-000000000033',
      'unsupported_notification',
      'buyer',
      null,
      null,
      '{}'::jsonb
    )
  $call$,
  'P0001',
  'Invalid email notification type.',
  'unsupported notification types are rejected by the trusted primitive'
);

reset role;

select results_eq(
  $test$
    select notification_type, recipient_email
    from public.email_notifications
    where order_id = 'b6000000-0000-4000-8000-000000000033'
    order by notification_type
  $test$,
  $expected$
    values
      ('buyer_order_confirmation'::text, 'canonical-buyer@example.test'::text),
      ('seller_new_order'::text, 'seller-orders@example.test'::text)
  $expected$,
  'one order-created event creates exactly the fixed canonical pair'
);

insert into public.email_notifications (
  id,
  store_id,
  order_id,
  dedupe_key,
  recipient_type,
  recipient_email,
  notification_type,
  notification_status,
  subject_snapshot,
  payload
)
values (
  'b6000000-0000-4000-8000-000000000050',
  'b6000000-0000-4000-8000-000000000010',
  'b6000000-0000-4000-8000-000000000034',
  'buyer_order_confirmation:order:b6000000-0000-4000-8000-000000000034',
  'buyer',
  'noncanonical@example.test',
  'buyer_order_confirmation',
  'pending',
  'Noncanonical',
  '{}'::jsonb
);

set local role service_role;

select is(
  (
    select count(*)
    from public.claim_phase_1_postmark_email_notifications_for_order(
      'b6000000-0000-4000-8000-000000000034',
      10,
      5,
      interval '15 minutes'
    )
  ),
  0::bigint,
  'noncanonical queued rows are not sendable'
);

select is(
  (
    select count(*)
    from public.claim_phase_1_postmark_email_notifications_for_order(
      'b6000000-0000-4000-8000-000000000033',
      10,
      5,
      interval '15 minutes'
    )
  ),
  2::bigint,
  'seller-scoped worker claim returns only the requested order fixed pair'
);

select is(
  (
    select count(*)
    from public.claim_phase_1_postmark_email_notifications_for_order(
      'b6000000-0000-4000-8000-000000000033',
      10,
      5,
      interval '15 minutes'
    )
  ),
  0::bigint,
  'a second claim cannot double-claim processing rows'
);

select throws_ok(
  $call$
    select public.mark_email_notification_sent(
      (
        select id
        from public.email_notifications
        where order_id = 'b6000000-0000-4000-8000-000000000033'
        order by id
        limit 1
      ),
      gen_random_uuid(),
      'wrong-token-message'
    )
  $call$,
  'P0001',
  'Processing notification claim was not found.',
  'wrong processing token cannot acknowledge a notification'
);

select lives_ok(
  $call$
    select *
    from public.begin_email_notification_dispatch(
      (
        select id
        from public.email_notifications
        where order_id = 'b6000000-0000-4000-8000-000000000033'
        order by id
        limit 1
      ),
      (
        select processing_token
        from public.email_notifications
        where order_id = 'b6000000-0000-4000-8000-000000000033'
        order by id
        limit 1
      )
    )
  $call$,
  'dispatch attempt marker is persisted before provider delivery'
);

select lives_ok(
  $call$
    select public.mark_email_notification_sent(
      (
        select id
        from public.email_notifications
        where order_id = 'b6000000-0000-4000-8000-000000000033'
        order by id
        limit 1
      ),
      (
        select processing_token
        from public.email_notifications
        where order_id = 'b6000000-0000-4000-8000-000000000033'
        order by id
        limit 1
      ),
      'provider-message-success'
    )
  $call$,
  'successful provider acceptance can be finalized'
);

select is(
  (
    select provider_message_id
    from public.email_notifications
    where order_id = 'b6000000-0000-4000-8000-000000000033'
      and notification_status = 'sent'
  ),
  'provider-message-success'::text,
  'successful send stores provider MessageID'
);

select lives_ok(
  $call$
    select *
    from public.begin_email_notification_dispatch(
      (
        select id
        from public.email_notifications
        where order_id = 'b6000000-0000-4000-8000-000000000033'
          and notification_status = 'processing'
        limit 1
      ),
      (
        select processing_token
        from public.email_notifications
        where order_id = 'b6000000-0000-4000-8000-000000000033'
          and notification_status = 'processing'
        limit 1
      )
    )
  $call$,
  'second notification also receives a durable dispatch marker'
);

select lives_ok(
  $call$
    select public.mark_email_notification_delivery_unknown(
      (
        select id
        from public.email_notifications
        where order_id = 'b6000000-0000-4000-8000-000000000033'
          and notification_status = 'dispatching'
        limit 1
      ),
      (
        select processing_token
        from public.email_notifications
        where order_id = 'b6000000-0000-4000-8000-000000000033'
          and notification_status = 'dispatching'
        limit 1
      ),
      'Provider acceptance could not be determined.',
      null
    )
  $call$,
  'ambiguous provider acceptance becomes delivery_unknown'
);

select is(
  (
    select count(*)
    from public.claim_phase_1_postmark_email_notifications_for_order(
      'b6000000-0000-4000-8000-000000000033',
      10,
      5,
      interval '15 minutes'
    )
  ),
  0::bigint,
  'delivery_unknown is not automatically resent'
);

select throws_ok(
  $call$
    select public.retry_email_notification(
      (
        select id
        from public.email_notifications
        where order_id = 'b6000000-0000-4000-8000-000000000033'
          and notification_status = 'delivery_unknown'
      ),
      now(),
      false
    )
  $call$,
  'P0001',
  'Retryable notification was not found.',
  'raw retry policy cannot reset delivery_unknown'
);

select is(
  (
    select count(*)
    from public.claim_phase_1_postmark_email_notifications_for_order(
      'b6000000-0000-4000-8000-000000000030',
      1,
      5,
      interval '15 minutes'
    )
  ),
  1::bigint,
  'a canonical owner notification can be claimed for rejection testing'
);

select lives_ok(
  $call$
    select *
    from public.begin_email_notification_dispatch(
      (
        select id
        from public.email_notifications
        where order_id = 'b6000000-0000-4000-8000-000000000030'
          and notification_status = 'processing'
        limit 1
      ),
      (
        select processing_token
        from public.email_notifications
        where order_id = 'b6000000-0000-4000-8000-000000000030'
          and notification_status = 'processing'
        limit 1
      )
    )
  $call$,
  'known-rejection notification receives a dispatch marker'
);

select lives_ok(
  $call$
    select public.mark_email_notification_failed(
      (
        select id
        from public.email_notifications
        where order_id = 'b6000000-0000-4000-8000-000000000030'
          and notification_status = 'dispatching'
        limit 1
      ),
      (
        select processing_token
        from public.email_notifications
        where order_id = 'b6000000-0000-4000-8000-000000000030'
          and notification_status = 'dispatching'
        limit 1
      ),
      'Known provider rejection.',
      interval '5 minutes',
      5
    )
  $call$,
  'known provider rejection transitions to failed retry policy'
);

select ok(
  exists (
    select 1
    from public.email_notifications
    where order_id = 'b6000000-0000-4000-8000-000000000030'
      and notification_status = 'failed'
      and next_attempt_at > now()
      and next_attempt_at < 'infinity'::timestamptz
  ),
  'known provider rejection remains eligible for policy-controlled retry'
);

reset role;

select * from finish();

rollback;
