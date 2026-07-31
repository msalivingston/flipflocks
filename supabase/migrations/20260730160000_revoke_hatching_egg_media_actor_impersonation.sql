begin;

revoke all on function public.seller_create_uploaded_hatching_egg_group_media(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  bigint,
  integer,
  integer,
  text,
  text,
  integer,
  boolean
) from public, anon, authenticated, service_role;

commit;
