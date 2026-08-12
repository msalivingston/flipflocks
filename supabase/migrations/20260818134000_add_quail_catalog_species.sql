-- Add commonly kept quail species to the default Breed Library.

begin;

with quail_species as (
  select id
  from public.species
  where slug = 'quail'
),
seed_quail(breed_name, breed_slug, description, sort_order) as (
  values
    (
      'Button',
      'button-quail',
      $description$Button quail, also widely known as King or Chinese Painted quail, are tiny ornamental quail kept for their compact size, lively behavior, and colorful appearance. Mature males often show richer blue-gray, chestnut, and black-and-white markings, while females are usually softer brown with subtle patterning that provides natural camouflage.

They are best suited to ornamental aviaries rather than meat production and can be rewarding for keepers who appreciate small, active birds. Button quail require finely sized game-bird feed, shallow chick-safe waterers, dry footing, secure protection from drafts and predators, and housing designed around their very small size. Provide floor cover and hiding places, avoid mixing them with aggressive birds, and use a soft or safely elevated ceiling because startled quail can launch upward suddenly.$description$,
      110
    ),
    (
      'Gambel''s',
      'gambels-quail',
      $description$Gambel's quail are crested game birds native to the desert Southwest, where they travel in coveys through brushy washes and arid scrub. Both sexes carry a forward-curving topknot, while mature males show a bold black face and throat, chestnut crown, gray body, and richly patterned belly.

They are valued by ornamental and game-bird keepers for their distinctive appearance, social behavior, and strong desert character. Gambel's mature more slowly and fly more powerfully than Coturnix, so they need secure, spacious housing with sheltered ground cover and room for natural covey behavior. Provide a complete game-bird ration, clean water, dry footing, protection from predators, and a roof designed to prevent head injuries when birds flush upward. Possession, breeding, transport, and release may be regulated, so keepers should follow all applicable wildlife laws.$description$,
      120
    ),
    (
      'California',
      'california-quail',
      $description$California quail are handsome crested game birds of western North America, recognized by their scaled underparts and distinctive comma-shaped topknot. Mature males typically show a dark face bordered in white, a chestnut crown, and a blue-gray breast, while females are more softly patterned in gray and brown.

They are popular with ornamental and game-bird keepers for their alert personality, attractive covey behavior, and familiar rolling call. California quail mature more slowly and fly more strongly than Coturnix, requiring secure, spacious housing with brushy cover, dry ground, and room to move as a group. Provide a complete game-bird ration, clean water, protection from predators, and a roof designed to prevent injuries when startled birds flush upward. Keepers should confirm local requirements before possessing, breeding, transporting, or releasing native game birds.$description$,
      130
    ),
    (
      'Scaled',
      'scaled-quail',
      $description$Scaled quail are sturdy game birds of the dry grasslands and deserts of the southwestern United States and northern Mexico. Their blue-gray plumage is edged in dark markings that create a scaled appearance, and both sexes carry a pale-tipped crest that gives the species its familiar cotton-top look.

They appeal to ornamental and game-bird keepers for their subtle color, active ground-running behavior, and hardy appearance. Scaled quail are strong, alert birds that benefit from secure flight pens with open floor space, low brush or shelters, dry footing, and protection from weather and predators. Provide a complete game-bird ration, clean water, sensible stocking density, and a roof designed to reduce head injuries when birds flush. As with other native game birds, possession, breeding, transport, and release must follow applicable wildlife laws.$description$,
      140
    )
)
insert into public.breeds (
  species_id,
  breed_name,
  variety,
  breed_slug,
  description,
  category,
  sort_order,
  is_active,
  is_custom
)
select
  quail_species.id,
  seed_quail.breed_name,
  null,
  seed_quail.breed_slug,
  seed_quail.description,
  'Gamebird',
  seed_quail.sort_order,
  true,
  false
from seed_quail
cross join quail_species
on conflict (species_id, breed_slug) do update
set
  breed_name = excluded.breed_name,
  variety = null,
  description = excluded.description,
  category = excluded.category,
  sort_order = excluded.sort_order,
  is_active = true,
  is_custom = false,
  updated_at = now();

commit;
