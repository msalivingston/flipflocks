-- Text-only update to the shared cart/checkout shortage message. Preserve the
-- evaluator's grouping, quantities, policy fields, security and permissions.
begin;

do $migration$
declare
  v_definition text := pg_get_functiondef('public.live_bird_minimum_order_shortages(uuid,jsonb)'::regprocedure);
  v_label text := '''started_adult_birds'', ''Started & Adult Birds'',';
  v_noun text := 'case when bird_group = ''chicks'' then ''chicks'' else ''Started & Adult Birds'' end';
begin
  if strpos(v_definition, v_label) = 0 or strpos(v_definition, v_noun) = 0 then
    raise exception 'Adult bird shortage wording does not match the existing evaluator.';
  end if;
  v_definition := replace(v_definition, v_label, '''started_adult_birds'', ''adult birds'',');
  v_definition := replace(v_definition, v_noun,
    'case when bird_group = ''chicks'' then ''chicks'' when minimum_quantity - quantity = 1 then ''adult bird'' else ''adult birds'' end');
  execute v_definition;
end;
$migration$;

commit;
