-- Enforce the canonical seller breed profile description limit.
-- NOT VALID avoids rewriting existing rows while still checking new inserts and updates.

alter table public.seller_breed_profiles
drop constraint if exists seller_breed_profiles_seller_description_length_check;

alter table public.seller_breed_profiles
add constraint seller_breed_profiles_seller_description_length_check
check (
  seller_description is null
  or char_length(seller_description) <= 1500
) not valid;
