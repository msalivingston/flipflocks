-- Normalize default catalog records whose Base Breed still repeats Variety.

begin;

update public.breeds
set
  variety = null,
  updated_at = now()
where is_custom = false
  and variety is not null
  and lower(btrim(breed_name)) = lower(btrim(variety));

update public.breeds
set
  breed_name = btrim(left(
    btrim(breed_name),
    length(btrim(breed_name)) - length(' - ' || btrim(variety))
  )),
  updated_at = now()
where is_custom = false
  and variety is not null
  and lower(right(
    btrim(breed_name),
    length(' - ' || btrim(variety))
  )) = lower(' - ' || btrim(variety));

alter table public.breeds
  add constraint breeds_default_base_name_excludes_variety_suffix_check
  check (
    is_custom = true
    or variety is null
    or (
      lower(btrim(breed_name)) <> lower(btrim(variety))
      and lower(right(
        btrim(breed_name),
        length(' - ' || btrim(variety))
      )) <> lower(' - ' || btrim(variety))
    )
  );

commit;
