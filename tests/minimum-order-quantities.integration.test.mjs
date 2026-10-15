// Run with: node --test tests/minimum-order-quantities.integration.test.mjs
// Optional local-only runtime (kept outside package.json):
// npm install --no-save --package-lock=false --ignore-scripts --prefix .npm-cache/minimum-order-test-runtime @electric-sql/pglite
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const runtime = new URL("../.npm-cache/minimum-order-test-runtime/node_modules/@electric-sql/pglite/dist/", import.meta.url);
test("minimum quantities against the migrated PostgreSQL commerce paths", {
  skip: !existsSync(new URL("index.js", runtime)) && "Install the optional local PostgreSQL runtime shown above",
}, async (t) => {
  const { PGlite } = await import(new URL("index.js", runtime).href);
  const { pgcrypto } = await import(new URL("contrib/pgcrypto.js", runtime).href);
  const db = new PGlite({ extensions: { pgcrypto } });
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage; create schema extensions;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid$$;
    create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role', true)$$;
    create table auth.users(id uuid primary key, instance_id uuid, aud text, role text, email text, encrypted_password text,
      email_confirmed_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb, created_at timestamptz, updated_at timestamptz,
      confirmation_token text, email_change text, email_change_token_new text, recovery_token text);
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key, bucket_id text, name text, owner uuid, owner_id text, metadata jsonb);
    create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1, '/')$$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    create extension pgcrypto with schema extensions;
  `);
  for (const name of readdirSync(new URL("../supabase/migrations/", import.meta.url)).filter((x) => x.endsWith(".sql")).sort()) {
    // pg_cron/pg_net require hosted Supabase; scheduling is unrelated to orders.
    if (name === "20260903180000_webinar_email_lifecycle.sql") continue;
    // Also exercise the exact production rollout: this unrelated inventory-edit
    // migration is pending there and must not become a hidden dependency.
    if (name === "20260925120000_update_live_bird_advanced_attributes.sql") continue;
    try { await db.exec(readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8")); }
    catch (error) { throw new Error(`Migration ${name}: ${error.message}`, { cause: error }); }
  }
  const store = "f1000000-0000-4000-8000-000000000010";
  const owner = "f1000000-0000-4000-8000-000000000001";
  const id = (n) => `f1000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
  const one = async (sql, args = []) => (await rows(sql, args))[0];
  await db.query(`select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claim.role','service_role',false)`, [owner]);
  await db.query(`insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values($1,'minimum-owner@example.test','{}','{}')`, [owner]);
  await db.query(`insert into public.stores(id,owner_user_id,store_name,store_slug,store_status,storefront_mode,storefront_enabled)
    values($1,$2,'Minimum Farm','minimum-farm','live','hosted',true)`, [store, owner]);
  await db.query(`insert into public.seller_billing_status(store_id,requested_plan_key,requested_billing_cadence,plan_key,billing_plan,
    subscription_status,trial_started_at,trial_ends_at,current_period_start,current_period_end,storefront_access_until,billing_state_authority)
    values($1,'full_flock','monthly','full_flock','monthly','trialing',now(),now()+interval '7 days',now(),now()+interval '7 days',now()+interval '7 days','trial')`, [store]);
  await db.query(`update stores set hatching_eggs_enabled=true,equipment_supplies_enabled=true,processed_poultry_enabled=true where id=$1`, [store]);
  for (const n of [20, 21]) {
    await db.query(`insert into seller_breed_profiles(id,store_id,species_id,custom_breed_name,normalized_custom_breed_name,display_name,visibility_status,moderation_status)
      select $1,$2,id,$3,lower($3),$3,'active','normal' from species where slug='chicken'`, [id(n), store, `Minimum Breed ${n}`]);
  }
  // 13-day chicks, exactly 14-day birds, past-ready adults, future-ready adults, future chicks.
  for (const [n, age, ready] of [[30,13,0],[31,14,0],[32,30,-20],[33,1,13],[34,1,12]]) {
    await db.query(`insert into listing_batches(id,store_id,species_id,origin_date,available_date,base_price,batch_type)
      select $1,$2,id,current_date-$3::integer,current_date+$4::integer,5,'live_animals' from species where slug='chicken'`, [id(n), store, age, ready]);
    await db.query(`insert into listing_batch_breeds(id,store_id,listing_batch_id,seller_breed_profile_id) values($1,$2,$3,$4)`, [id(n+100), store, id(n), id(n%2===0?20:21)]);
    await db.query(`insert into inventory_items(id,store_id,listing_batch_id,listing_batch_breed_id,inventory_type,quantity_available)
      values($1,$2,$3,$4,$5,100)`, [id(n+200), store, id(n), id(n+100), n%2===0?'female':'male']);
  }
  await db.query(`insert into equipment_inventory_items(id,store_id,item_name,category,quantity_available,price,visibility_status,available_date)
    values($1,$2,'Feeder','Feeders & Waterers',100,5,'active',current_date)`, [id(250),store]);
  await db.query(`insert into hatching_egg_inventory_items(id,store_id,species_id,item_name,quantity_available,price,visibility_status,available_date,minimum_order_quantity)
    select $1,$2,id,'Minimum Eggs',100,5,'active',current_date,6 from species where slug='chicken'`, [id(251),store]);
  await db.query(`insert into processed_poultry_inventory_items(id,store_id,species_id,product_name,poultry_type,product_type,quantity_available,price,visibility_status)
    select $1,$2,id,'Poultry Product','Chicken','Meat & Broth',100,5,'active' from species where slug='chicken'`,[id(252),store]);
  const bird = (n, quantity) => ({ item_type: "listing_inventory", item_id: id(n+200), quantity });
  const summary = (items) => one("select * from get_public_checkout_summary('minimum-farm',$1::jsonb)", [JSON.stringify(items)]);
  const policy = (chicks, adults) => one("select * from seller_update_store_settings($1,$2::jsonb)", [store,JSON.stringify({minimum_chick_order_quantity:chicks,minimum_started_adult_bird_order_quantity:adults})]);
  const shortages = (items) => rows("select * from live_bird_minimum_order_shortages($1,$2::jsonb)", [store,JSON.stringify(items)]);
  await t.test("defaults, store settings, validation, and seller context", async () => {
    const context = await one("select * from get_seller_context()");
    assert.equal(context.minimum_chick_order_quantity, 0);
    assert.equal(context.minimum_started_adult_bird_order_quantity, 0);
    assert.equal((await summary([bird(30,1)])).is_checkout_available,true);
    await policy(5,10);
    assert.equal((await one("select * from get_seller_context()")).minimum_started_adult_bird_order_quantity,10);
    await assert.rejects(policy(-1,10));
    await assert.rejects(policy(1.5,10));
    await assert.rejects(policy(null,10));
    assert.equal((await one("select * from get_seller_context()")).minimum_chick_order_quantity,5);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id(2)]);
    await assert.rejects(policy(0,0),/Not authorized/);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
    await db.query("insert into stores(id,owner_user_id,store_name,store_slug) values($1,$2,'Other Farm','other-minimum-farm')",[id(11),owner]);
    assert.equal((await one("select minimum_chick_order_quantity as minimum from stores where id=$1",[id(11)])).minimum,0);
  });
  await t.test("13/14-day boundaries, ready dates, totals across breeds and sexes, and independent groups", async () => {
    assert.equal((await shortages([bird(30,4)]))[0].bird_group,"chicks");
    assert.equal((await shortages([bird(31,9)]))[0].bird_group,"started_adult_birds");
    assert.equal((await shortages([bird(32,9)]))[0].bird_group,"started_adult_birds");
    assert.equal((await shortages([bird(33,9)]))[0].bird_group,"started_adult_birds");
    assert.equal((await shortages([bird(34,4)]))[0].bird_group,"chicks");
    assert.equal((await summary([bird(31,6),bird(32,4)])).is_checkout_available,true);
    assert.equal((await summary([bird(30,2),bird(34,3)])).is_checkout_available,true);
    const short = await summary([bird(30,2),bird(31,6)]);
    assert.equal(short.is_checkout_available,false);
    assert.match(short.message,/at least 5 Chicks.*You have 2.*Add 3/s);
    assert.match(short.message,/at least 10 adult birds.*You have 6.*Add 4 more adult birds/s);
    // Duplicate line IDs are summed, not counted as separate requirements.
    assert.equal((await summary([bird(31,6),bird(31,4)])).is_checkout_available,true);
  });
  await t.test("customer adult shortages use singular/plural wording without changing chick messages", async () => {
    for (const [quantity, noun] of [[9, 'adult bird'], [8, 'adult birds']]) {
      const expected = `This store requires at least 10 adult birds per order. You have ${quantity}. Add ${10-quantity} more ${noun} to continue.`;
      assert.equal((await shortages([bird(31,quantity)]))[0].message, expected);
      assert.equal((await summary([bird(31,quantity)])).message, expected);
    }
    assert.equal((await summary([bird(30,4)])).message,
      'This store requires at least 5 Chicks per order. You have 4. Add 1 more chicks to continue.');
  });
  await t.test("other inventory neither triggers nor satisfies bird minimums; eggs keep their own minimum", async () => {
    const equipment = {item_type:'equipment_inventory',item_id:id(250),quantity:1};
    assert.equal((await summary([equipment])).is_checkout_available,true);
    assert.equal((await summary([bird(31,1),{...equipment,quantity:99}])).is_checkout_available,false);
    assert.equal((await summary([{item_type:'hatching_egg_inventory',item_id:id(251),quantity:5}])).is_checkout_available,false);
    assert.equal((await summary([{item_type:'hatching_egg_inventory',item_id:id(251),quantity:6}])).is_checkout_available,true);
    const product={item_type:'processed_poultry_inventory',item_id:id(252),quantity:99};
    assert.equal((await summary([product])).is_checkout_available,true);
    assert.equal((await summary([bird(31,1),product])).is_checkout_available,false);
    // The public summary retains browser access while private helpers stay hidden.
    await db.exec("set role anon");
    try { assert.match((await summary([bird(31,6)])).message,/Add 4/); }
    finally { await db.exec("reset role"); }
  });
  let order;
  const pickup = (items,key) => one(`select * from create_pay_at_pickup_order_v2(p_store_id=>$1,p_idempotency_key=>$2,
    p_buyer_email=>'buyer@example.test',p_buyer_first_name=>'Minimum',p_buyer_last_name=>'Buyer',p_buyer_phone=>'5550100',
    p_delivery_city=>'Denver',p_delivery_postal_code=>'80202',p_items=>$3::jsonb)`,[store,key,JSON.stringify(items)]);
  await t.test("pay-at-pickup rejects direct bypass atomically, succeeds with combined birds, and preserves retries", async () => {
    const before = await one("select quantity_available from inventory_items where id=$1",[id(231)]);
    await assert.rejects(pickup([bird(31,6)],'short-pickup'),/Add 4/);
    assert.deepEqual(await one("select quantity_available from inventory_items where id=$1",[id(231)]),before);
    order=await pickup([bird(31,6),bird(32,4)],'valid-pickup');
    assert.ok(order.order_id);
    await policy(5,20);
    assert.equal((await pickup([bird(31,6),bird(32,4)],'valid-pickup')).order_id,order.order_id);
    await assert.rejects(pickup([bird(31,6),bird(32,4)],'new-pickup'),/Add 10/);
    await policy(5,10);
  });
  await t.test("summary and pay-at-pickup reject conflicting identifiers and support legacy/current formats", async () => {
    for (const item of [
      {...bird(31,1),inventory_item_id:id(230)},
      {...bird(30,1),inventory_item_id:id(231)},
      {item_type:'equipment_inventory',item_id:id(250),inventory_item_id:id(231),quantity:1},
    ]) {
      await assert.rejects(summary([item]),/Conflicting or ambiguous inventory identifiers/);
      await assert.rejects(pickup([item],'conflicting-'+item.item_id),/Conflicting or ambiguous inventory identifiers/);
    }
    for (const [n,item] of [
      [1,{inventory_item_id:id(231),quantity:10}],
      [2,{...bird(31,10),inventory_item_id:id(231)}],
    ]) {
      const result=await pickup([item],'supported-pickup-'+n);
      const saved=await one('select inventory_item_id,quantity from order_items where order_id=$1',[result.order_id]);
      assert.deepEqual(saved,{inventory_item_id:id(231),quantity:10});
      assert.equal((await summary([item])).is_checkout_available,true);
    }
  });
  await t.test("seller creation and editing reject shortages and preserve existing order data on failure", async () => {
    const manualItems = (quantity) => [{item_type:'inventory',inventory_item_id:id(231),quantity}];
    const create = (quantity,key) => one(`select * from seller_create_manual_order(p_store_id=>$1,p_idempotency_key=>$2,p_items=>$3::jsonb,
      p_customer_email=>'manual@example.test',p_customer_first_name=>'Manual',p_customer_last_name=>'Buyer')`,[store,key,JSON.stringify(manualItems(quantity))]);
    await assert.rejects(create(6,'short-manual'),/Add 4/);
    const conflicting=[{...manualItems(10)[0],item_id:id(230)}];
    await assert.rejects(one(`select * from seller_create_manual_order(p_store_id=>$1,p_idempotency_key=>'conflicting-manual',p_items=>$2::jsonb,
      p_customer_email=>'manual@example.test',p_customer_first_name=>'Manual',p_customer_last_name=>'Buyer')`,[store,JSON.stringify(conflicting)]),/Conflicting or ambiguous inventory identifiers/);
    const manual=await create(10,'valid-manual');
    const line=await one("select id,quantity from order_items where order_id=$1",[manual.order_id]);
    const edit=(quantity)=>one("select * from seller_edit_order(p_order_id=>$1,p_items=>$2::jsonb,p_customer_id=>$3)",[manual.order_id,JSON.stringify([{...manualItems(quantity)[0],order_item_id:line.id,unit_price:5}]),manual.customer_id]);
    await assert.rejects(edit(6),/Add 4/);
    await assert.rejects(one('select * from seller_edit_order(p_order_id=>$1,p_items=>$2::jsonb,p_customer_id=>$3)',
      [manual.order_id,JSON.stringify([{...conflicting[0],order_item_id:line.id,unit_price:5}]),manual.customer_id]),/Conflicting or ambiguous inventory identifiers/);
    assert.equal((await one("select quantity from order_items where id=$1",[line.id])).quantity,10);
    await edit(12);
    assert.equal((await one("select quantity from order_items where id=$1",[line.id])).quantity,12);
  });
  await t.test("card reservations enforce minimums; policy changes preserve held and paid orders", async () => {
    await db.query("insert into store_stripe_connections(store_id,stripe_livemode,stripe_account_id) values($1,false,'acct_MinimumTest')",[store]);
    const reserve=(quantity,n,items=[bird(31,quantity)])=>one(`select * from reserve_storefront_card_checkout(p_reservation_id=>$1,p_store_id=>$2,
      p_stripe_livemode=>false,p_stripe_account_id=>'acct_MinimumTest',p_stripe_checkout_session_id=>$3,p_expires_at=>now()+interval '30 minutes',
      p_amount_total_cents=>$4,p_currency=>'usd',p_buyer_email=>'card@example.test',p_buyer_first_name=>'Card',p_buyer_last_name=>'Buyer',p_buyer_phone=>'5550100',
      p_items=>$5::jsonb,p_delivery_address_line1=>'1 Main St',p_delivery_city=>'Denver',p_delivery_state=>'CO',p_delivery_postal_code=>'80202')`,
      [id(n),store,`cs_test_Minimum${n}`,quantity*500,JSON.stringify(items)]);
    const before=await rows('select id,quantity_available from inventory_items order by id');
    for (const [n,item] of [
      [410,{...bird(31,1),inventory_item_id:id(230)}],
      [411,{...bird(30,1),inventory_item_id:id(231)}],
      [412,{item_type:'equipment_inventory',item_id:id(250),inventory_item_id:id(231),quantity:1}],
    ]) await assert.rejects(reserve(1,n,[item]),/Conflicting or ambiguous inventory identifiers/);
    assert.deepEqual(await rows('select id,quantity_available from inventory_items order by id'),before);
    assert.equal((await one('select count(*)::integer as count from storefront_card_checkout_reservations')).count,0);
    await assert.rejects(reserve(1,413,[bird(30,1)]),/Add 4/);
    await assert.rejects(reserve(1,414,[{inventory_item_id:id(231),quantity:1}]),/Add 9/);
    for(const [n,items] of [
      [415,[{inventory_item_id:id(231),quantity:10}]],
      [416,[{...bird(31,10),inventory_item_id:id(231)}]],
      [417,[bird(31,6),bird(32,4)]],
      [418,[bird(30,2),bird(34,3)]],
    ]) {
      const quantity=items.reduce((total,item)=>total+item.quantity,0);
      await reserve(quantity,n,items);
      const snapshot=(await one('select item_snapshot from storefront_card_checkout_reservations where id=$1',[id(n)])).item_snapshot;
      assert.deepEqual(snapshot.map((item)=>({id:item.inventory_item_id,quantity:item.quantity})).sort((a,b)=>a.id.localeCompare(b.id)),
        items.map((item)=>({id:item.item_id??item.inventory_item_id,quantity:item.quantity})).sort((a,b)=>a.id.localeCompare(b.id)));
    }
    await assert.rejects(reserve(6,400),/Add 4/);
    await reserve(10,401);
    await policy(5,20);
    await reserve(10,401); // Retry of a valid reservation remains valid.
    await assert.rejects(reserve(10,402),/Add 10/);
    const settle=()=>one("select * from settle_storefront_card_checkout('cs_test_Minimum401','acct_MinimumTest',false,'paid',5000,'usd','pi_Minimum401',now())");
    const paid=await settle();
    assert.ok(paid.order_id);
    await policy(5,30);
    assert.equal((await settle()).order_id,paid.order_id);
    assert.equal((await one("select quantity from order_items where order_id=$1",[paid.order_id])).quantity,10);
    await policy(0,0);
    await reserve(1,403);
  });
  await t.test("private helpers are not callable by buyers or sellers", async () => {
    for(const role of ['anon','authenticated','service_role']){
      assert.equal((await one("select has_function_privilege($1,'public.normalize_order_inventory_items(jsonb,boolean)','execute') as allowed",[role])).allowed,false);
      assert.equal((await one("select has_function_privilege($1,'public.live_bird_minimum_order_shortages(uuid,jsonb)','execute') as allowed",[role])).allowed,false);
      assert.equal((await one("select has_function_privilege($1,'public.assert_live_bird_minimum_order_quantities(uuid,jsonb)','execute') as allowed",[role])).allowed,false);
    }
  });
});
