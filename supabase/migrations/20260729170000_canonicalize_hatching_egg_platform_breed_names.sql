begin;

create or replace function public.canonicalize_hatching_egg_inventory_breed_name()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_canonical_breed_name text;
begin
  select breeds.breed_name
  into v_canonical_breed_name
  from public.breeds as breeds
  where breeds.species_id = new.species_id
    and breeds.is_active = true
    and public.normalize_hatching_egg_item_name(breeds.breed_name) =
      public.normalize_hatching_egg_item_name(new.item_name)
  order by breeds.sort_order, breeds.breed_name, breeds.id
  limit 1;

  new.item_name := coalesce(
    v_canonical_breed_name,
    regexp_replace(btrim(new.item_name), '\s+', ' ', 'g')
  );

  return new;
end;
$$;

drop trigger if exists hatching_egg_inventory_canonicalize_breed_name
on public.hatching_egg_inventory_items;

create trigger hatching_egg_inventory_canonicalize_breed_name
before insert or update of item_name, species_id
on public.hatching_egg_inventory_items
for each row
execute function public.canonicalize_hatching_egg_inventory_breed_name();

update public.hatching_egg_inventory_items as hatching_items
set item_name = breeds.breed_name
from public.breeds as breeds
where breeds.species_id = hatching_items.species_id
  and breeds.is_active = true
  and public.normalize_hatching_egg_item_name(breeds.breed_name) =
    public.normalize_hatching_egg_item_name(hatching_items.item_name)
  and hatching_items.item_name is distinct from breeds.breed_name;

comment on function public.canonicalize_hatching_egg_inventory_breed_name() is
'Canonicalizes standalone Hatching Eggs names to an active platform breed within the same species when normalized names match. Custom names remain allowed.';

commit;
