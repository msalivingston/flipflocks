begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select set_config('request.jwt.claim.role', 'service_role', true);

select ok(not has_table_privilege('anon', 'public.inventory_items', 'select'), 'anon has no base inventory read grant');
select ok(not has_table_privilege('anon', 'public.inventory_items', 'truncate'), 'anon cannot truncate inventory');
select ok(not has_table_privilege('authenticated', 'public.inventory_items', 'truncate'), 'authenticated cannot truncate inventory');
select ok(has_table_privilege('authenticated', 'public.inventory_items', 'select'), 'seller read grant retained');
select ok(has_table_privilege('authenticated', 'public.inventory_items', 'update'), 'admin RLS-protected DML retained');
select ok(not has_schema_privilege('anon', 'private', 'usage'), 'private helper schema is not accessible anonymously');
select ok(not exists (
  select 1 from pg_rewrite r join pg_depend d on d.objid = r.oid
  where r.ev_class = 'public.public_storefronts'::regclass
    and d.refobjid = 'auth.users'::regclass
), 'public_storefronts has no direct auth.users dependency');

insert into auth.users(id, email, raw_app_meta_data, raw_user_meta_data)
values ('b9000000-0000-4000-8000-000000000001', 'privacy-owner@example.test', '{}', '{}'),
       ('b9000000-0000-4000-8000-000000000002', 'privacy-other@example.test', '{}', '{}');
insert into public.stores(id, owner_user_id, store_name, store_slug, hero_subheading)
values ('b9000000-0000-4000-8000-000000000010', 'b9000000-0000-4000-8000-000000000001', 'Privacy Farm', 'privacy-farm', 'Fresh from our farm');
insert into public.seller_billing_status(store_id,plan_key,billing_plan,subscription_status,storefront_access_until,billing_state_authority,comp_granted_by_user_id,comp_grant_reason,comp_granted_at,comp_access_until)
values ('b9000000-0000-4000-8000-000000000010','full_flock','comped','comped',now()+interval '30 days','admin_comp','b9000000-0000-4000-8000-000000000001','Security fixture',now(),now()+interval '30 days');
select is((select show_public_email from public.stores where store_slug='privacy-farm'), false, 'new owner email starts private');
select is((select buyer_contact_email_enabled from public.stores where store_slug='privacy-farm'), false, 'new onboarding email choice starts unchecked');
select lives_ok($$update public.stores set show_public_email=false, show_public_phone=false where store_slug='privacy-farm'$$, 'draft may hide both contacts');
select throws_ok($$update public.stores set store_status='live', storefront_enabled=true where store_slug='privacy-farm'$$,
  'P0001', 'Choose at least one contact method to display on your published storefront: account email or a saved phone number.', 'publishing without contact rejected');
select throws_ok($$update public.stores set store_status='live', storefront_enabled=true, show_public_phone=true where store_slug='privacy-farm'$$,
  'P0001', 'Choose at least one contact method to display on your published storefront: account email or a saved phone number.', 'empty public phone cannot satisfy publishing');
update public.stores set store_status='live', storefront_enabled=true, show_public_email=true where store_slug='privacy-farm';
insert into public.seller_breed_profiles(id, store_id, species_id, custom_breed_name, normalized_custom_breed_name, display_name, visibility_status, moderation_status)
select 'b9000000-0000-4000-8000-000000000020', 'b9000000-0000-4000-8000-000000000010', id, 'Privacy Rock','privacy rock','Privacy Rock','active','normal' from public.species where slug='chicken';

select set_config('request.jwt.claim.sub', 'b9000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
create temporary table security_listing as
select * from public.seller_create_listing_batch_with_inventory(
  'b9000000-0000-4000-8000-000000000010', (select id from public.species where slug='chicken'),
  'live_animals',current_date-30,current_date,25,
  jsonb_build_array(jsonb_build_object('seller_breed_profile_id','b9000000-0000-4000-8000-000000000020',
    'inventory_items',jsonb_build_array(jsonb_build_object('inventory_type','female','quantity_available',20,'barn_location','Private Barn','seller_notes','Private notes')))),
  false,null,null,null,null,'active');
select is((select count(*) from public.inventory_items where store_id='b9000000-0000-4000-8000-000000000010'),1::bigint,'seller can create and read inventory');
select lives_ok($$select public.seller_update_inventory_item((select id from public.inventory_items where store_id='b9000000-0000-4000-8000-000000000010'), 'female', p_seller_notes=>'Updated private notes')$$, 'seller can edit inventory');
select lives_ok($$select public.seller_adjust_inventory_quantity((select id from public.inventory_items where store_id='b9000000-0000-4000-8000-000000000010'), p_quantity_delta=>2, p_note=>'Security test')$$,'seller can adjust quantity');
select is((select quantity_available from public.inventory_items where store_id='b9000000-0000-4000-8000-000000000010'),22,'quantity actually changes');
select lives_ok($$select public.seller_archive_inventory_items(array[(select id from public.inventory_items where store_id='b9000000-0000-4000-8000-000000000010')])$$,'seller can archive inventory');
select is((select count(*) from public.public_storefront_inventory where store_slug='privacy-farm'),0::bigint,'archived inventory hidden publicly');
select lives_ok($$select public.seller_restore_inventory_items(array[(select id from public.inventory_items where store_id='b9000000-0000-4000-8000-000000000010')])$$,'seller can restore inventory');
select lives_ok($$select public.seller_set_inventory_visibility((select id from public.inventory_items where store_id='b9000000-0000-4000-8000-000000000010'), 'active')$$,'seller can republish restored inventory');

select throws_ok($$select * from public.seller_update_store_settings('b9000000-0000-4000-8000-000000000010','{"show_public_email":false,"show_public_phone":false}')$$,
  'P0001','Choose at least one contact method to display on your published storefront: account email or a saved phone number.','settings cannot hide last published contact');
select lives_ok($$select * from public.seller_update_store_settings('b9000000-0000-4000-8000-000000000010','{"show_public_email":false,"show_public_phone":true,"public_phone":"555-0199"}')$$,'seller can switch atomically to phone only');
select is((select public_email from public.public_storefronts where store_slug='privacy-farm'),null,'email hidden for phone-only store');
select is((select public_phone from public.public_storefronts where store_slug='privacy-farm'),'555-0199','phone-only contact displays');
select lives_ok($$select * from public.seller_update_store_settings('b9000000-0000-4000-8000-000000000010','{"show_public_email":true,"show_public_phone":true}')$$,'seller can enable both contacts');
select is((select public_email from public.public_storefronts where store_slug='privacy-farm'),'privacy-owner@example.test','opted-in account email displays through view');
select lives_ok($$select * from public.seller_update_store_settings('b9000000-0000-4000-8000-000000000010','{"show_public_email":true,"show_public_phone":false}')$$,'seller can use email only');

reset role;
update auth.users set email='privacy-updated@example.test' where id='b9000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);
set local role anon;
select throws_ok($$select * from public.inventory_items$$,'42501','permission denied for table inventory_items','anon cannot read private inventory');
select throws_ok($$select public.seller_adjust_inventory_quantity('b9000000-0000-4000-8000-000000000099',p_quantity_delta=>1)$$,'42501','permission denied for function seller_adjust_inventory_quantity','anon cannot invoke seller quantity mutation');
select is((select count(*) from public.public_storefront_inventory where store_slug='privacy-farm'),1::bigint,'public inventory remains readable');
select ok(not exists(select 1 from public.public_storefront_inventory v where store_slug='privacy-farm' and (to_jsonb(v) ? 'barn_location' or to_jsonb(v) ? 'seller_notes')),'public inventory excludes private fields');
select is((select public_email from public.public_storefronts where store_slug='privacy-farm'),'privacy-updated@example.test','account email changes propagate for anonymous storefront view');
select is((select public_email from public.get_public_storefront_home('privacy-farm')),'privacy-updated@example.test','account email changes propagate through storefront RPC');
select ok(not exists(select 1 from public.public_storefronts v where store_slug='privacy-farm' and (to_jsonb(v) ? 'encrypted_password' or to_jsonb(v) ? 'owner_user_id')),'public view reveals no extra auth columns');
select lives_ok($$select * from public.get_public_checkout_summary('privacy-farm',jsonb_build_array(jsonb_build_object('inventory_item_id',(select inventory_item_id from public.public_storefront_inventory where store_slug='privacy-farm'),'quantity',1)))$$,'anonymous customer checkout summary remains available');

reset role;
select set_config('request.jwt.claim.sub', 'b9000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select is((select count(*) from public.inventory_items where store_id='b9000000-0000-4000-8000-000000000010'),0::bigint,'other seller cannot read private inventory');
select throws_ok($$select public.seller_archive_inventory_items(array[(select inventory_item_id from public.public_storefront_inventory where store_slug='privacy-farm')])$$,
  'P0001', 'Some selected inventory rows were not found or do not belong to this store.', 'other seller cannot archive inventory');
reset role;
select set_config('request.jwt.claim.sub','b9000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select lives_ok($$select * from public.seller_update_store_settings('b9000000-0000-4000-8000-000000000010','{"storefront_enabled":false,"show_public_email":false,"show_public_phone":false}')$$,'seller can unpublish and make both contacts private together');
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
select is((select count(*) from public.public_storefronts where store_slug='privacy-farm'),0::bigint,'unpublished store absent publicly');
reset role;
insert into public.seller_onboarding_state(store_id,profile_complete,billing_complete,storefront_details_complete,categories_complete,onboarding_complete)
values ('b9000000-0000-4000-8000-000000000010',true,true,true,true,false)
on conflict (store_id) do update set profile_complete=true,billing_complete=true,storefront_details_complete=true,categories_complete=true,onboarding_complete=false;
select set_config('request.jwt.claim.sub','b9000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select throws_ok($$select * from public.seller_save_onboarding_pickup('{"pickup_address_line1":"1 Farm Road","pickup_city":"Town","pickup_state":"CO","pickup_postal_code":"80000","pickup_policy":"By appointment","email_enabled":false,"phone_enabled":false,"text_enabled":false}')$$,
  'P0001','Choose at least one contact method to display on your storefront.','onboarding requires a deliberate contact choice');
select lives_ok($$select * from public.seller_save_onboarding_pickup('{"pickup_address_line1":"1 Farm Road","pickup_city":"Town","pickup_state":"CO","pickup_postal_code":"80000","pickup_policy":"By appointment","email_enabled":false,"phone_enabled":true,"text_enabled":false}')$$,
  'onboarding accepts public phone without revealing account email');
select is((select show_public_email from public.stores where id='b9000000-0000-4000-8000-000000000010'),false,'phone-only onboarding leaves account email private');
select lives_ok($$select * from public.seller_save_onboarding_pickup('{"pickup_address_line1":"1 Farm Road","pickup_city":"Town","pickup_state":"CO","pickup_postal_code":"80000","pickup_policy":"By appointment","email_enabled":true,"phone_enabled":false,"text_enabled":false}')$$,
  'onboarding accepts explicit public account email');
reset role;
update public.stores set public_phone=null where store_slug='privacy-farm';
set local role authenticated;
select throws_ok($$select * from public.seller_save_onboarding_pickup('{"pickup_address_line1":"1 Farm Road","pickup_city":"Town","pickup_state":"CO","pickup_postal_code":"80000","pickup_policy":"By appointment","email_enabled":false,"phone_enabled":true,"text_enabled":false}')$$,
  'P0001','Save a phone number before choosing public phone or text contact.','onboarding cannot select an absent phone');
reset role;
select * from finish();
rollback;
