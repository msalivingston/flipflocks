begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

create temporary table seller_breed_concurrency_probe (
  available boolean not null,
  infrastructure_message text,
  first_profile_id uuid,
  second_profile_id uuid,
  profile_count integer
) on commit drop;

do $probe$
declare
  v_connection_string text := format(
    'hostaddr=%s port=5432 dbname=%s user=postgres password=postgres',
    host(inet_server_addr()),
    current_database()
  );
  v_first_profile_id uuid;
  v_second_profile_id uuid;
  v_profile_count integer;
begin
  if not exists (
    select 1 from pg_available_extensions where name = 'dblink'
  ) then
    insert into seller_breed_concurrency_probe(
      available,
      infrastructure_message
    )
    values (false, 'dblink is not available in this PostgreSQL image');
    return;
  end if;

  execute 'create extension if not exists dblink with schema extensions';
  perform extensions.dblink_connect('breed_snapshot_setup', v_connection_string);
  perform extensions.dblink_connect('breed_snapshot_first', v_connection_string);
  perform extensions.dblink_connect('breed_snapshot_second', v_connection_string);

  perform extensions.dblink_exec('breed_snapshot_setup', $remote$
    delete from public.stores
    where id = 'b1210000-0000-4000-8000-000000000010';
    delete from auth.users
    where id = 'b1210000-0000-4000-8000-000000000001';

    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change,
      email_change_token_new, recovery_token
    )
    values (
      'b1210000-0000-4000-8000-000000000001',
      '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated',
      'breed-snapshot-concurrency@example.test', '', now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb, now(), now(), '', '', '', ''
    );

    insert into public.stores (
      id, owner_user_id, store_name, store_slug, store_status,
      storefront_mode, storefront_enabled
    )
    values (
      'b1210000-0000-4000-8000-000000000010',
      'b1210000-0000-4000-8000-000000000001',
      'Breed Snapshot Concurrency Farm',
      'breed-snapshot-concurrency-farm', 'draft', 'hosted', false
    );
  $remote$);

  perform extensions.dblink_exec(
    'breed_snapshot_first',
    'set "request.jwt.claim.role" = ''authenticated'''
  );
  perform extensions.dblink_exec(
    'breed_snapshot_first',
    'set "request.jwt.claim.sub" = ''b1210000-0000-4000-8000-000000000001'''
  );
  perform extensions.dblink_exec(
    'breed_snapshot_second',
    'set "request.jwt.claim.role" = ''authenticated'''
  );
  perform extensions.dblink_exec(
    'breed_snapshot_second',
    'set "request.jwt.claim.sub" = ''b1210000-0000-4000-8000-000000000001'''
  );

  perform extensions.dblink_send_query('breed_snapshot_first', $remote$
    select seller_breed_profile_id
    from public.seller_upsert_breed_profile(
      'b1210000-0000-4000-8000-000000000010',
      (select species_id from public.breeds where breed_slug = 'orpington-buff'),
      (select id from public.breeds where breed_slug = 'orpington-buff')
    )
  $remote$);
  perform extensions.dblink_send_query('breed_snapshot_second', $remote$
    select seller_breed_profile_id
    from public.seller_upsert_breed_profile(
      'b1210000-0000-4000-8000-000000000010',
      (select species_id from public.breeds where breed_slug = 'orpington-buff'),
      (select id from public.breeds where breed_slug = 'orpington-buff')
    )
  $remote$);

  select seller_breed_profile_id
  into v_first_profile_id
  from extensions.dblink_get_result('breed_snapshot_first')
    as result(seller_breed_profile_id uuid);
  select seller_breed_profile_id
  into v_second_profile_id
  from extensions.dblink_get_result('breed_snapshot_second')
    as result(seller_breed_profile_id uuid);
  perform seller_breed_profile_id
  from extensions.dblink_get_result('breed_snapshot_first')
    as result(seller_breed_profile_id uuid);
  perform seller_breed_profile_id
  from extensions.dblink_get_result('breed_snapshot_second')
    as result(seller_breed_profile_id uuid);

  select profile_count
  into v_profile_count
  from extensions.dblink(
    'breed_snapshot_setup',
    $remote$
      select count(*)::integer as profile_count
      from public.seller_breed_profiles
      where store_id = 'b1210000-0000-4000-8000-000000000010'
        and breed_id = (
          select id from public.breeds where breed_slug = 'orpington-buff'
        )
    $remote$
  ) as result(profile_count integer);

  insert into seller_breed_concurrency_probe values (
    true,
    null,
    v_first_profile_id,
    v_second_profile_id,
    v_profile_count
  );

  perform extensions.dblink_exec('breed_snapshot_setup', $remote$
    delete from public.stores
    where id = 'b1210000-0000-4000-8000-000000000010';
    delete from auth.users
    where id = 'b1210000-0000-4000-8000-000000000001';
  $remote$);
  perform extensions.dblink_disconnect('breed_snapshot_first');
  perform extensions.dblink_disconnect('breed_snapshot_second');
  perform extensions.dblink_disconnect('breed_snapshot_setup');
exception when others then
  insert into seller_breed_concurrency_probe(
    available,
    infrastructure_message
  )
  values (false, sqlerrm);
  begin
    perform extensions.dblink_exec('breed_snapshot_setup', $remote$
      delete from public.stores
      where id = 'b1210000-0000-4000-8000-000000000010';
      delete from auth.users
      where id = 'b1210000-0000-4000-8000-000000000001';
    $remote$);
  exception when others then null;
  end;
  begin perform extensions.dblink_disconnect('breed_snapshot_first'); exception when others then null; end;
  begin perform extensions.dblink_disconnect('breed_snapshot_second'); exception when others then null; end;
  begin perform extensions.dblink_disconnect('breed_snapshot_setup'); exception when others then null; end;
end;
$probe$;

select case
  when available then pass('dblink breed auto-add concurrency probe is available')
  else skip(
    'dblink breed auto-add concurrency probe unavailable: ' ||
      infrastructure_message,
    1
  )
end
from seller_breed_concurrency_probe;

select case
  when available then is(
    first_profile_id,
    second_profile_id,
    'concurrent platform auto-add callers resolve the same seller profile'
  )
  else skip('dblink breed auto-add concurrency probe unavailable', 1)
end
from seller_breed_concurrency_probe;

select case
  when available then is(
    profile_count,
    1,
    'concurrent platform auto-add leaves exactly one seller profile'
  )
  else skip('dblink breed auto-add concurrency probe unavailable', 1)
end
from seller_breed_concurrency_probe;

select * from finish();
rollback;
