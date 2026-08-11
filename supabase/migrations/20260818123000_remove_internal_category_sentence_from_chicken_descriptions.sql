-- Remove internal catalog-classification wording from customer-facing chicken
-- breed descriptions. Seller-owned profile descriptions are not modified.

do $$
declare
  v_species_id uuid;
  v_row_count integer;
  v_expected_count integer;
begin
  select species.id
  into strict v_species_id
  from public.species
  where species.slug = 'chicken';

  select count(*)
  into v_row_count
  from public.breeds as breeds
  where breeds.species_id = v_species_id
    and breeds.is_custom = false
    and breeds.is_active
    and breeds.description like
      '%FlockFront classifies this profile as ' || breeds.category || '.%';

  v_expected_count := v_row_count;

  if v_expected_count not in (188, 189) then
    raise exception 'Expected 188 production or 189 replayable chicken descriptions with internal classification wording; found %.', v_expected_count;
  end if;

  update public.breeds as breeds
  set
    description = replace(
      breeds.description,
      'FlockFront classifies this profile as ' || breeds.category || '. ',
      ''
    ),
    updated_at = now()
  where breeds.species_id = v_species_id
    and breeds.is_custom = false
    and breeds.is_active
    and breeds.description like
      '%FlockFront classifies this profile as ' || breeds.category || '.%';

  get diagnostics v_row_count = row_count;
  if v_row_count <> v_expected_count then
    raise exception 'Expected to correct % active chicken descriptions; updated %.', v_expected_count, v_row_count;
  end if;

  if exists (
    select 1
    from public.breeds as breeds
    where breeds.species_id = v_species_id
      and breeds.is_custom = false
      and breeds.is_active
      and breeds.description like '%FlockFront classifies this profile as %'
  ) then
    raise exception 'Internal catalog-classification wording remains in an active chicken description.';
  end if;
end;
$$;
