begin;

-- Stripe may report a completed, zero-dollar subscription Checkout as `paid`
-- even while the resulting Subscription is trialing. Both accepted values remain
-- enrollment evidence only; paid-through authority still belongs exclusively to
-- the verified positive-invoice application contract.
do $migration$
declare
  v_contract_name text;
  v_definition text;
  v_original_predicate constant text :=
    $predicate$or p_session_payment_status is distinct from 'no_payment_required'$predicate$;
  v_corrected_predicate constant text :=
    $predicate$or (
         p_session_payment_status is distinct from 'paid'
         and p_session_payment_status is distinct from 'no_payment_required'
       )$predicate$;
begin
  foreach v_contract_name in array array[
    'apply_verified_saas_checkout_completion',
    'apply_verified_saas_checkout_completion_transactional_v1'
  ] loop
    begin
      select pg_get_functiondef(p.oid)
      into strict v_definition
      from pg_proc as p
      join pg_namespace as n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = v_contract_name;
    exception
      when no_data_found then
        raise exception using errcode = '55000',
          message = 'SAAS_TRIAL_CHECKOUT_APPLICATION_CONTRACT_MISSING';
      when too_many_rows then
        raise exception using errcode = '55000',
          message = 'SAAS_TRIAL_CHECKOUT_APPLICATION_CONTRACT_AMBIGUOUS';
    end;

    if length(v_definition) - length(replace(
         v_definition, v_original_predicate, ''
       )) is distinct from length(v_original_predicate) then
      raise exception using errcode = '55000',
        message = 'SAAS_TRIAL_CHECKOUT_PAYMENT_STATUS_PREDICATE_UNEXPECTED';
    end if;

    execute replace(
      v_definition,
      v_original_predicate,
      v_corrected_predicate
    );
  end loop;
end;
$migration$;

commit;
