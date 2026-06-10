-- Starter breed catalog enrichment.
--
-- Scope:
-- - Enrich selected platform-managed public.breeds records only.
-- - Do not create seller profiles.
-- - Do not add photos.
-- - Do not promote seller custom breeds into the catalog.
-- - Match records by species.slug + breed_slug.

alter table public.breeds
add column if not exists bird_type text;

alter table public.breeds
add column if not exists annual_egg_production text;

alter table public.breeds
drop constraint if exists breeds_bird_type_check,
add constraint breeds_bird_type_check check (
  bird_type is null
  or bird_type in ('layer', 'meat', 'dual_purpose')
);

alter table public.breeds
drop constraint if exists breeds_annual_egg_production_check,
add constraint breeds_annual_egg_production_check check (
  annual_egg_production is null
  or annual_egg_production in (
    'under_150',
    '150_200',
    '200_250',
    '250_300',
    'over_300'
  )
);

comment on column public.breeds.bird_type is
'Optional controlled platform catalog value for chicken breed purpose.';

comment on column public.breeds.annual_egg_production is
'Optional controlled platform catalog value for annual egg production range.';

with starter_chicken_breeds(
  species_slug,
  breed_slug,
  description,
  bird_type,
  egg_color,
  annual_egg_production
) as (
  values
    (
      'chicken',
      'ameraucana',
      'Ameraucana are hardy blue-egg layers with pea combs and an active, alert nature. They are a good choice for colorful egg baskets and small flocks.',
      'layer',
      'blue',
      '150_200'
    ),
    (
      'chicken',
      'australorp-black',
      'Black Australorp are calm, productive dual-purpose birds known for steady brown egg production and reliable backyard manners.',
      'dual_purpose',
      'brown',
      '250_300'
    ),
    (
      'chicken',
      'brahma',
      'Brahma are large, gentle dual-purpose chickens with feathered legs and a cold-hardy build. They are often valued for temperament and winter presence.',
      'dual_purpose',
      'brown',
      '150_200'
    ),
    (
      'chicken',
      'cochin-buff',
      'Buff Cochin are fluffy, calm chickens often chosen for friendly temperaments and ornamental flock appeal. They lay modest brown eggs.',
      'dual_purpose',
      'brown',
      'under_150'
    ),
    (
      'chicken',
      'cornish-cross',
      'Cornish Cross are fast-growing meat birds bred for efficient table production. They are best managed with careful feed and space planning.',
      'meat',
      'brown',
      'under_150'
    ),
    (
      'chicken',
      'cream-legbar',
      'Cream Legbar are active, crested blue-egg layers with auto-sexing traits. They bring colorful eggs and a lighter, alert flock presence.',
      'layer',
      'blue',
      '150_200'
    ),
    (
      'chicken',
      'delaware',
      'Delaware are sturdy dual-purpose chickens with good growth, calm handling, and dependable brown egg production.',
      'dual_purpose',
      'brown',
      '200_250'
    ),
    (
      'chicken',
      'easter-egger',
      'Easter Eggers are mixed-heritage layers popular for varied plumage and colorful eggs that may be blue, green, or tinted.',
      'layer',
      'blue_green',
      '200_250'
    ),
    (
      'chicken',
      'freedom-ranger',
      'Freedom Ranger are slower-growing meat birds suited to pasture-style systems and flavorful table birds.',
      'meat',
      'brown',
      'under_150'
    ),
    (
      'chicken',
      'golden-comet',
      'Golden Comet are productive hybrid layers known for friendly temperaments and strong brown egg output.',
      'layer',
      'brown',
      '250_300'
    ),
    (
      'chicken',
      'isa-brown',
      'ISA Brown are efficient brown-egg layers bred for high production and approachable backyard flock behavior.',
      'layer',
      'brown',
      'over_300'
    ),
    (
      'chicken',
      'leghorn-white',
      'White Leghorn are active, feed-efficient layers known for prolific white egg production and a lighter Mediterranean build.',
      'layer',
      'white',
      'over_300'
    ),
    (
      'chicken',
      'marans-black-copper',
      'Black Copper Marans are sought after for rich dark brown eggs and striking black-and-copper plumage.',
      'layer',
      'dark_brown',
      '150_200'
    ),
    (
      'chicken',
      'new-hampshire',
      'New Hampshire are practical dual-purpose birds with good growth, steady brown eggs, and a generally calm flock presence.',
      'dual_purpose',
      'brown',
      '200_250'
    ),
    (
      'chicken',
      'olive-egger',
      'Olive Eggers are mixed-heritage layers bred for olive-toned eggs and varied, colorful flock appearances.',
      'layer',
      'olive',
      '150_200'
    ),
    (
      'chicken',
      'orpington-buff',
      'Buff Orpington are gentle, fluffy dual-purpose chickens valued for family-friendly temperaments and steady brown eggs.',
      'dual_purpose',
      'brown',
      '150_200'
    ),
    (
      'chicken',
      'plymouth-rock-barred',
      'Barred Plymouth Rock are classic dual-purpose chickens with calm temperaments, good foraging ability, and reliable brown eggs.',
      'dual_purpose',
      'brown',
      '200_250'
    ),
    (
      'chicken',
      'rhode-island-red',
      'Rhode Island Red are hardy dual-purpose chickens known for strong brown egg production and practical homestead performance.',
      'dual_purpose',
      'brown',
      '250_300'
    ),
    (
      'chicken',
      'silkie-white',
      'White Silkies are small, gentle chickens with soft feathering and strong broody instincts. They are popular for pets and specialty flocks.',
      'layer',
      'light_brown',
      'under_150'
    ),
    (
      'chicken',
      'sussex-speckled',
      'Speckled Sussex are friendly dual-purpose chickens with attractive mottled plumage, good foraging habits, and steady brown eggs.',
      'dual_purpose',
      'brown',
      '200_250'
    ),
    (
      'chicken',
      'welsummer',
      'Welsummer are active dual-purpose birds known for rich brown speckled eggs and classic partridge coloring.',
      'dual_purpose',
      'dark_brown',
      '150_200'
    ),
    (
      'chicken',
      'wyandotte-silver-laced',
      'Silver Laced Wyandotte are cold-hardy dual-purpose chickens with bold laced plumage and dependable brown eggs.',
      'dual_purpose',
      'brown',
      '200_250'
    ),
    (
      'chicken',
      'wyandotte-golden-laced',
      'Golden Laced Wyandotte are cold-hardy dual-purpose chickens with rich laced feathering and steady brown egg production.',
      'dual_purpose',
      'brown',
      '200_250'
    ),
    (
      'chicken',
      'jersey-giant-black',
      'Black Jersey Giant are very large dual-purpose chickens with calm temperaments and steady brown egg production.',
      'dual_purpose',
      'brown',
      '150_200'
    ),
    (
      'chicken',
      'buckeye',
      'Buckeye are hardy dual-purpose chickens developed for cold weather, with active foraging habits and brown eggs.',
      'dual_purpose',
      'brown',
      '150_200'
    )
)
update public.breeds as breeds
set
  description = starter_chicken_breeds.description,
  bird_type = starter_chicken_breeds.bird_type,
  egg_color = starter_chicken_breeds.egg_color,
  annual_egg_production = starter_chicken_breeds.annual_egg_production,
  updated_at = now()
from starter_chicken_breeds
join public.species as species
  on species.slug = starter_chicken_breeds.species_slug
where breeds.species_id = species.id
  and breeds.breed_slug = starter_chicken_breeds.breed_slug;

with starter_non_chicken_breeds(species_slug, breed_slug, description) as (
  values
    -- Ducks.
    ('duck', 'pekin-duck', 'Pekin ducks are large, fast-growing white ducks commonly raised for meat, eggs, and friendly backyard flocks.'),
    ('duck', 'khaki-campbell', 'Khaki Campbell ducks are active, efficient layers known for strong egg production and practical small-farm use.'),
    ('duck', 'indian-runner', 'Indian Runner ducks have upright posture, active foraging habits, and a reputation for steady egg production.'),
    ('duck', 'muscovy', 'Muscovy ducks are quiet, sturdy ducks valued for meat, brooding ability, and strong foraging behavior.'),
    ('duck', 'rouen', 'Rouen ducks are large, calm ducks with mallard-like coloring and good table-bird qualities.'),
    ('duck', 'cayuga', 'Cayuga ducks are quiet, dark-feathered ducks with an iridescent sheen and useful backyard egg production.'),
    ('duck', 'welsh-harlequin', 'Welsh Harlequin ducks are calm, attractive layers known for good egg production and practical flock temperament.'),
    ('duck', 'silver-appleyard', 'Silver Appleyard ducks are large dual-purpose ducks known for good size, attractive plumage, and steady eggs.'),

    -- Geese.
    ('goose', 'embden', 'Embden geese are large white geese commonly raised for meat, flock guardianship, and visible pasture presence.'),
    ('goose', 'toulouse', 'Toulouse geese are heavy, calm geese valued for size, traditional farm appearance, and steady grazing.'),
    ('goose', 'african-goose', 'African geese are large, alert geese with prominent knobs and strong flock-guardian tendencies.'),
    ('goose', 'chinese-brown', 'Brown Chinese geese are active, vocal geese known for alertness, grazing, and strong farmyard presence.'),
    ('goose', 'chinese-white', 'White Chinese geese are active, vocal geese often chosen for alertness, grazing, and clean white plumage.'),
    ('goose', 'american-buff-goose', 'American Buff geese are calm, medium-weight geese with warm buff plumage and practical homestead appeal.'),
    ('goose', 'sebastopol', 'Sebastopol geese are ornamental geese known for long curled feathers and gentle, eye-catching pasture presence.'),

    -- Turkeys.
    ('turkey', 'bourbon-red', 'Bourbon Red turkeys are heritage birds known for rich red plumage, good flavor, and traditional farm appeal.'),
    ('turkey', 'bronze', 'Bronze turkeys are classic table birds with strong growth, broad bodies, and traditional dark feathering.'),
    ('turkey', 'narragansett', 'Narragansett turkeys are heritage birds valued for calm temperaments, foraging ability, and attractive barred coloring.'),
    ('turkey', 'royal-palm', 'Royal Palm turkeys are smaller ornamental heritage turkeys with striking black-and-white plumage.'),
    ('turkey', 'slate', 'Slate turkeys are heritage turkeys known for blue-gray plumage, good foraging, and traditional table qualities.'),
    ('turkey', 'white-holland', 'White Holland turkeys are heritage white turkeys valued for table use and traditional farm flocks.'),
    ('turkey', 'black-spanish', 'Black Spanish turkeys are heritage turkeys with glossy dark plumage, foraging ability, and table qualities.'),

    -- Guinea fowl.
    ('guinea-fowl', 'pearl-guinea', 'Pearl guineas are hardy, active birds often kept for alerting, insect control, and free-range flocks.'),
    ('guinea-fowl', 'lavender-guinea', 'Lavender guineas are hardy, active guineas with soft gray-lavender coloring and strong alerting behavior.'),
    ('guinea-fowl', 'white-guinea', 'White guineas are active, hardy birds with bright white plumage and useful alerting instincts.'),
    ('guinea-fowl', 'royal-purple-guinea', 'Royal Purple guineas are active gamebirds with dark iridescent plumage and strong flock alerting behavior.'),
    ('guinea-fowl', 'coral-blue-guinea', 'Coral Blue guineas are hardy, active birds with blue-gray coloring and practical free-range traits.'),

    -- Quail.
    ('quail', 'coturnix-pharaoh', 'Pharaoh Coturnix quail are fast-maturing utility quail commonly raised for eggs, meat, and small-space production.'),
    ('quail', 'coturnix-jumbo-brown', 'Jumbo Brown Coturnix quail are larger utility quail valued for efficient meat and egg production.'),
    ('quail', 'coturnix-texas-a-m', 'Texas A&M Coturnix quail are white-feathered utility quail often raised for clean-looking table birds and eggs.'),
    ('quail', 'coturnix-english-white', 'English White Coturnix quail are small utility quail with white plumage and practical egg production.'),
    ('quail', 'bobwhite', 'Bobwhite quail are native-style gamebirds often raised for flight conditioning, conservation, or specialty flocks.'),

    -- Ratites.
    ('emus-ostriches-rheas', 'emu', 'Emus are large ratites raised for specialty farms, breeding programs, and spacious pasture systems.'),
    ('emus-ostriches-rheas', 'ostrich-african-black', 'African Black ostriches are large ratites suited to experienced handlers and spacious specialty operations.'),
    ('emus-ostriches-rheas', 'rhea-greater', 'Greater rheas are large South American ratites often kept in specialty breeding and pasture settings.')
)
update public.breeds as breeds
set
  description = starter_non_chicken_breeds.description,
  updated_at = now()
from starter_non_chicken_breeds
join public.species as species
  on species.slug = starter_non_chicken_breeds.species_slug
where breeds.species_id = species.id
  and breeds.breed_slug = starter_non_chicken_breeds.breed_slug;

do $$
begin
  if not exists (
    select 1
    from public.breeds
    where egg_color is not null
      and egg_color not in (
        'white',
        'light_brown',
        'brown',
        'dark_brown',
        'blue',
        'blue_green',
        'green',
        'olive'
      )
  ) then
    alter table public.breeds
    drop constraint if exists breeds_egg_color_check;

    alter table public.breeds
    add constraint breeds_egg_color_check check (
      egg_color is null
      or egg_color in (
        'white',
        'light_brown',
        'brown',
        'dark_brown',
        'blue',
        'blue_green',
        'green',
        'olive'
      )
    );
  else
    raise notice 'Skipping breeds_egg_color_check because existing catalog egg_color values are outside the approved starter set.';
  end if;
end;
$$;
