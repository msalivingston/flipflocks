begin;

with catalog_images(species_slug, breed_slug, image_url) as (
  values
    (
      'chicken',
      'rhode-island-red',
      '/catalog/breeds/chickens/rhode-island-red.png'
    ),
    (
      'chicken',
      'orpington-buff',
      '/catalog/breeds/chickens/orpington-buff.png'
    )
)
update public.breeds as breeds
set
  image_url = catalog_images.image_url,
  updated_at = now()
from catalog_images
join public.species
  on species.slug = catalog_images.species_slug
where breeds.species_id = species.id
  and breeds.breed_slug = catalog_images.breed_slug;

commit;
