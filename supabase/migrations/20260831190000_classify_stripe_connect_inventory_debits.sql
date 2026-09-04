-- Classify inventory already debited by Stripe Connect reservations when a
-- paid reservation is converted into an order. Backfill only orders with
-- retained ff_connect_checkout_v1 provenance; inventory quantities and all
-- fulfillment/restoration state remain unchanged.

begin;

create or replace function public.settle_storefront_card_checkout(
  p_stripe_checkout_session_id text,
  p_stripe_account_id text,
  p_stripe_livemode boolean,
  p_outcome text,
  p_amount_total_cents bigint,
  p_currency text,
  p_stripe_payment_intent_id text default null,
  p_paid_at timestamptz default null
)
returns table (
  settlement_outcome text,
  order_id uuid,
  order_number text,
  total_amount numeric(10,2),
  currency text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_reservation public.storefront_card_checkout_reservations%rowtype;
  v_existing_session public.stripe_checkout_sessions%rowtype;
  v_existing_order public.orders%rowtype;
  v_snapshot jsonb;
  v_customer_id uuid;
  v_order_id uuid;
  v_order_number text;
  v_next integer;
  v_created_at timestamptz;
  v_email text;
  v_first text;
  v_last text;
  v_phone text;
begin
  if p_outcome not in ('paid','expired') then raise exception 'Settlement outcome must be paid or expired.'; end if;
  select reservations.* into v_reservation from public.storefront_card_checkout_reservations reservations
  where reservations.stripe_checkout_session_id=p_stripe_checkout_session_id for update;

  if v_reservation.id is null then
    select sessions.* into v_existing_session
    from public.stripe_checkout_sessions sessions
    where sessions.stripe_checkout_session_id=p_stripe_checkout_session_id;
    if v_existing_session.id is not null then
      if v_existing_session.metadata->>'stripe_account_id'<>p_stripe_account_id
        or coalesce((v_existing_session.metadata->>'stripe_livemode')::boolean,false)<>p_stripe_livemode
        or v_existing_session.amount_total_cents<>p_amount_total_cents
        or v_existing_session.currency<>lower(nullif(trim(p_currency),'')) then
        raise exception 'Stripe Checkout settlement does not match the settled order.';
      end if;
      select orders.* into v_existing_order from public.orders orders where orders.id=v_existing_session.order_id;
      return query select 'paid'::text,v_existing_order.id,v_existing_order.order_number,v_existing_order.total_amount,
        lower(v_existing_order.currency_code);
      return;
    elsif p_outcome='expired' then
      return query select 'expired'::text,null::uuid,null::text,null::numeric(10,2),lower(nullif(trim(p_currency),''));
      return;
    end if;
    raise exception 'Stripe Checkout reservation was not found.';
  end if;

  if v_reservation.stripe_account_id<>p_stripe_account_id or v_reservation.stripe_livemode<>p_stripe_livemode
    or v_reservation.amount_total_cents<>p_amount_total_cents or v_reservation.currency<>lower(nullif(trim(p_currency),'')) then
    raise exception 'Stripe Checkout settlement does not match the reservation.';
  end if;

  if p_outcome='expired' then
    update public.inventory_items inventory set quantity_available=inventory.quantity_available+(item->>'quantity')::integer
    from jsonb_array_elements(v_reservation.item_snapshot) item
    where item->>'item_type'='listing_inventory' and inventory.id=(item->>'inventory_item_id')::uuid;
    update public.equipment_inventory_items inventory set quantity_available=inventory.quantity_available+(item->>'quantity')::integer
    from jsonb_array_elements(v_reservation.item_snapshot) item
    where item->>'item_type'='equipment_inventory' and inventory.id=(item->>'equipment_inventory_item_id')::uuid;
    update public.processed_poultry_inventory_items inventory set quantity_available=inventory.quantity_available+(item->>'quantity')::integer
    from jsonb_array_elements(v_reservation.item_snapshot) item
    where item->>'item_type'='processed_poultry_inventory' and inventory.id=(item->>'processed_poultry_inventory_item_id')::uuid;
    update public.hatching_egg_inventory_items inventory set quantity_available=inventory.quantity_available+(item->>'quantity')::integer
    from jsonb_array_elements(v_reservation.item_snapshot) item
    where item->>'item_type'='hatching_egg_inventory' and inventory.id=(item->>'hatching_egg_inventory_item_id')::uuid;
    delete from public.storefront_card_checkout_reservations where id=v_reservation.id;
    return query select 'expired'::text,null::uuid,null::text,null::numeric(10,2),v_reservation.currency;
    return;
  end if;

  if nullif(trim(p_stripe_payment_intent_id),'') is null then raise exception 'Paid settlement requires a Stripe PaymentIntent.'; end if;
  v_snapshot:=v_reservation.order_snapshot;
  v_email:=v_snapshot->>'buyer_email'; v_first:=v_snapshot->>'buyer_first_name';
  v_last:=v_snapshot->>'buyer_last_name'; v_phone:=v_snapshot->>'buyer_phone';

  perform pg_advisory_xact_lock(hashtextextended(v_reservation.store_id::text||':'||v_email,0));
  v_customer_id:=public.resolve_order_customer_match(v_reservation.store_id,v_first,v_last,v_email,v_phone);
  if v_customer_id is null then
    insert into public.customers(store_id,email,first_name,last_name,phone,city,state,country,
      delivery_address_line1,delivery_address_line2,delivery_city,delivery_state,delivery_postal_code,delivery_country)
    values(v_reservation.store_id,v_email,v_first,v_last,v_phone,v_snapshot->>'delivery_city',v_snapshot->>'delivery_state',
      coalesce(v_snapshot->>'delivery_country','US'),v_snapshot->>'delivery_address_line1',v_snapshot->>'delivery_address_line2',
      v_snapshot->>'delivery_city',v_snapshot->>'delivery_state',v_snapshot->>'delivery_postal_code',coalesce(v_snapshot->>'delivery_country','US'))
    returning id into v_customer_id;
  else
    update public.customers set first_name=v_first,last_name=v_last,phone=v_phone,
      delivery_address_line1=v_snapshot->>'delivery_address_line1',delivery_address_line2=v_snapshot->>'delivery_address_line2',
      delivery_city=v_snapshot->>'delivery_city',delivery_state=v_snapshot->>'delivery_state',
      delivery_postal_code=v_snapshot->>'delivery_postal_code',delivery_country=coalesce(v_snapshot->>'delivery_country','US')
    where id=v_customer_id;
  end if;

  insert into public.order_number_counters(store_id) values(v_reservation.store_id)
  on conflict on constraint order_number_counters_pkey do nothing;
  update public.order_number_counters set last_order_number=last_order_number+1 where store_id=v_reservation.store_id
  returning last_order_number into v_next;
  v_order_number:=v_next::text;

  insert into public.orders(store_id,customer_id,order_number,order_source,order_status,payment_method,payment_status,
    payment_provider,provider_payment_status,payment_provider_status_updated_at,paid_at,
    buyer_email_snapshot,buyer_first_name_snapshot,buyer_last_name_snapshot,buyer_phone_snapshot,
    buyer_address_line1_snapshot,buyer_address_line2_snapshot,buyer_city_snapshot,buyer_state_snapshot,
    buyer_postal_code_snapshot,buyer_country_snapshot,buyer_notes,pickup_note,pickup_option_id,pickup_option_label_snapshot,
    fulfillment_method,delivery_option_name_snapshot,delivery_fee_amount,subtotal_amount,tax_fee_amount,total_amount,
    currency_code,buyer_ip_address,buyer_user_agent)
  values(v_reservation.store_id,v_customer_id,v_order_number,'storefront','open','stripe_checkout','paid',
    'stripe','paid',now(),coalesce(p_paid_at,now()),v_email,v_first,v_last,v_phone,
    v_snapshot->>'delivery_address_line1',v_snapshot->>'delivery_address_line2',v_snapshot->>'delivery_city',v_snapshot->>'delivery_state',
    v_snapshot->>'delivery_postal_code',v_snapshot->>'delivery_country',v_snapshot->>'buyer_notes',v_snapshot->>'pickup_note',
    nullif(v_snapshot->>'pickup_option_id','')::uuid,v_snapshot->>'pickup_option_label',v_snapshot->>'fulfillment_method',
    v_snapshot->>'delivery_option_name',coalesce((v_snapshot->>'delivery_fee_amount')::numeric,0),
    (v_snapshot->>'subtotal_amount')::numeric,coalesce((v_snapshot->>'tax_fee_amount')::numeric,0),
    (v_snapshot->>'total_amount')::numeric,upper(v_reservation.currency),nullif(v_snapshot->>'buyer_ip_address','')::inet,
    v_snapshot->>'buyer_user_agent') returning id,created_at into v_order_id,v_created_at;

  insert into public.order_items(order_id,store_id,order_item_source,inventory_item_id,equipment_inventory_item_id,
    processed_poultry_inventory_item_id,hatching_egg_inventory_item_id,listing_batch_id,listing_batch_breed_id,
    seller_breed_profile_id,species_id,species_name_snapshot,species_slug_snapshot,breed_display_name_snapshot,
    breed_description_snapshot,inventory_type_snapshot,custom_inventory_label_snapshot,batch_type_snapshot,
    product_type_snapshot,item_name_snapshot,item_category_snapshot,available_date_snapshot,
    age_at_availability_days_snapshot,unit_price_snapshot,quantity,line_subtotal,inventory_debited_quantity)
  select v_order_id,v_reservation.store_id,item->>'item_type',nullif(item->>'inventory_item_id','')::uuid,
    nullif(item->>'equipment_inventory_item_id','')::uuid,nullif(item->>'processed_poultry_inventory_item_id','')::uuid,
    nullif(item->>'hatching_egg_inventory_item_id','')::uuid,nullif(item->>'listing_batch_id','')::uuid,
    nullif(item->>'listing_batch_breed_id','')::uuid,nullif(item->>'seller_breed_profile_id','')::uuid,
    nullif(item->>'species_id','')::uuid,item->>'species_name',item->>'species_slug',item->>'breed_display_name',
    item->>'breed_description',item->>'inventory_type',item->>'custom_inventory_label',item->>'batch_type',
    item->>'product_type',item->>'item_name',item->>'item_category',nullif(item->>'available_date','')::date,
    nullif(item->>'age_at_availability_days','')::integer,(item->>'unit_price')::numeric,
    (item->>'quantity')::integer,(item->>'line_subtotal')::numeric,(item->>'quantity')::integer
  from jsonb_array_elements(v_reservation.item_snapshot) item;

  insert into public.stripe_checkout_sessions(store_id,order_id,stripe_checkout_session_id,stripe_payment_intent_id,
    checkout_session_status,payment_status,amount_total_cents,currency,expires_at,metadata)
  values(v_reservation.store_id,v_order_id,v_reservation.stripe_checkout_session_id,p_stripe_payment_intent_id,
    'complete','paid',v_reservation.amount_total_cents,v_reservation.currency,v_reservation.expires_at,
    jsonb_build_object('stripe_account_id',v_reservation.stripe_account_id,'stripe_livemode',v_reservation.stripe_livemode,
      'reservation_id',v_reservation.id,'schema_version','ff_connect_checkout_v1'));

  perform public.enqueue_email_notification(v_reservation.store_id,v_order_id,'buyer_order_received','buyer',v_email,
    'Order received: '||v_order_number,jsonb_build_object('order_id',v_order_id,'order_number',v_order_number,
      'store_id',v_reservation.store_id,'store_name',v_snapshot->>'store_name','store_slug',v_snapshot->>'store_slug',
      'buyer_first_name',v_first,'buyer_last_name',v_last,'buyer_email',v_email,'order_status','open','payment_status','paid',
      'total_amount',(v_snapshot->>'total_amount')::numeric,'created_at',v_created_at,'pickup_note',v_snapshot->>'pickup_note',
      'pickup_option_label',v_snapshot->>'pickup_option_label','buyer_notes',v_snapshot->>'buyer_notes'));
  perform public.enqueue_email_notification(v_reservation.store_id,v_order_id,'seller_new_order_received','seller',null,
    'New FlockFront order: '||v_order_number,jsonb_build_object('order_id',v_order_id,'order_number',v_order_number,
      'store_id',v_reservation.store_id,'store_name',v_snapshot->>'store_name','store_slug',v_snapshot->>'store_slug',
      'buyer_first_name',v_first,'buyer_last_name',v_last,'buyer_email',v_email,'buyer_phone',v_phone,'order_status','open',
      'payment_status','paid','total_amount',(v_snapshot->>'total_amount')::numeric,'created_at',v_created_at,
      'pickup_option_label',v_snapshot->>'pickup_option_label','item_count',(v_snapshot->>'item_count')::integer));

  delete from public.storefront_card_checkout_reservations where id=v_reservation.id;
  return query select 'paid'::text,v_order_id,v_order_number,(v_snapshot->>'total_amount')::numeric(10,2),v_reservation.currency;
end;
$$;

update public.order_items as oi
set inventory_debited_quantity = oi.quantity
from public.orders as o
where o.id = oi.order_id
  and o.store_id = oi.store_id
  and o.payment_method = 'stripe_checkout'
  and oi.inventory_debited_quantity is null
  and oi.order_item_source in (
    'listing_inventory',
    'equipment_inventory',
    'processed_poultry_inventory',
    'hatching_egg_inventory'
  )
  and exists (
    select 1
    from public.stripe_checkout_sessions as scs
    where scs.order_id = o.id
      and scs.store_id = o.store_id
      and scs.metadata ->> 'schema_version' = 'ff_connect_checkout_v1'
  );

commit;
