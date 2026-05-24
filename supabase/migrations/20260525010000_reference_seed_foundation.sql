-- Reference Seed Foundation
--
-- Scope:
-- - Seeds permanent platform-managed reference data only.
-- - Adds supported species, a curated breed catalog, and practical aliases.
-- - Keeps seller-created breed profiles, breeder notes, strains, projects,
--   and line information separate from the platform catalog.
--
-- This migration does not create:
-- - sellers
-- - stores
-- - customers
-- - orders
-- - inventory
-- - refunds
-- - notifications
-- - placeholder descriptions
-- - placeholder images


with seed_species(common_name, slug, sort_order) as (
  values
    ('Chickens', 'chicken', 10),
    ('Ducks', 'duck', 20),
    ('Geese', 'goose', 30),
    ('Turkeys', 'turkey', 40),
    ('Guinea Fowl', 'guinea-fowl', 50),
    ('Quail', 'quail', 60),
    ('Pheasants', 'pheasant', 70),
    ('Peafowl', 'peafowl', 80),
    ('Pigeons & Doves', 'pigeons-doves', 90),
    ('Emus, Ostriches & Rheas', 'emus-ostriches-rheas', 100)
)
insert into public.species (
  common_name,
  slug,
  sort_order,
  is_active
)
select
  seed_species.common_name,
  seed_species.slug,
  seed_species.sort_order,
  true
from seed_species
on conflict (slug) do update
set
  common_name = excluded.common_name,
  sort_order = excluded.sort_order,
  is_active = true,
  updated_at = now();


with seed_breeds(species_slug, breed_name, breed_slug, category, sort_order) as (
  values
    -- Chickens: source-of-truth catalog from product review.
    ('chicken', 'Ameraucana', 'ameraucana', 'Layers', 10),
    ('chicken', 'Ameraucana - Black', 'ameraucana-black', 'Layers', 20),
    ('chicken', 'Ameraucana - Blue', 'ameraucana-blue', 'Layers', 30),
    ('chicken', 'Ameraucana - Blue Wheaten', 'ameraucana-blue-wheaten', 'Layers', 40),
    ('chicken', 'Ameraucana - Buff', 'ameraucana-buff', 'Layers', 50),
    ('chicken', 'Ameraucana - Lavender', 'ameraucana-lavender', 'Layers', 60),
    ('chicken', 'Ameraucana - Splash', 'ameraucana-splash', 'Layers', 70),
    ('chicken', 'Ameraucana - Wheaten', 'ameraucana-wheaten', 'Layers', 80),
    ('chicken', 'Ameraucana - White', 'ameraucana-white', 'Layers', 90),
    ('chicken', 'Ancona', 'ancona', 'Layers', 100),
    ('chicken', 'Andalusian - Blue', 'andalusian-blue', 'Layers', 110),
    ('chicken', 'Appenzeller Spitzhauben', 'appenzeller-spitzhauben', 'Layers', 120),
    ('chicken', 'Araucana', 'araucana', 'Layers', 130),
    ('chicken', 'Australorp - Black', 'australorp-black', 'Dual Purpose', 140),
    ('chicken', 'Australorp - Blue', 'australorp-blue', 'Dual Purpose', 150),
    ('chicken', 'Australorp - Splash', 'australorp-splash', 'Dual Purpose', 160),
    ('chicken', 'Ayam Cemani', 'ayam-cemani', 'Layers', 170),
    ('chicken', 'Bantam Ameraucana - Black', 'bantam-ameraucana-black', 'Bantams', 180),
    ('chicken', 'Bantam Ameraucana - Blue', 'bantam-ameraucana-blue', 'Bantams', 190),
    ('chicken', 'Bantam Ameraucana - Splash', 'bantam-ameraucana-splash', 'Bantams', 200),
    ('chicken', 'Bantam Brahma - Buff', 'bantam-brahma-buff', 'Bantams', 210),
    ('chicken', 'Bantam Brahma - Dark', 'bantam-brahma-dark', 'Bantams', 220),
    ('chicken', 'Bantam Brahma - Light', 'bantam-brahma-light', 'Bantams', 230),
    ('chicken', 'Bantam Cochin - Black', 'bantam-cochin-black', 'Bantams', 240),
    ('chicken', 'Bantam Cochin - Blue', 'bantam-cochin-blue', 'Bantams', 250),
    ('chicken', 'Bantam Cochin - Buff', 'bantam-cochin-buff', 'Bantams', 260),
    ('chicken', 'Bantam Easter Egger', 'bantam-easter-egger', 'Bantams', 270),
    ('chicken', 'Bantam Frizzle', 'bantam-frizzle', 'Bantams', 280),
    ('chicken', 'Bantam Frizzle - Salmon', 'bantam-frizzle-salmon', 'Bantams', 290),
    ('chicken', 'Bantam Mille Cochin', 'bantam-mille-cochin', 'Bantams', 300),
    ('chicken', 'Bantam Silkie', 'bantam-silkie', 'Bantams', 310),
    ('chicken', 'Bantam Modern - Brown', 'bantam-modern-brown', 'Bantams', 320),
    ('chicken', 'Bantam Modern - White', 'bantam-modern-white', 'Bantams', 330),
    ('chicken', 'Bantam Orpington - Buff', 'bantam-orpington-buff', 'Bantams', 340),
    ('chicken', 'Bantam Orpington - Lavender', 'bantam-orpington-lavender', 'Bantams', 350),
    ('chicken', 'Bantam Phoenix - Golden', 'bantam-phoenix-golden', 'Bantams', 360),
    ('chicken', 'Bantam Phoenix - Silver', 'bantam-phoenix-silver', 'Bantams', 370),
    ('chicken', 'Bantam Plymouth Rock - Barred', 'bantam-plymouth-rock-barred', 'Bantams', 380),
    ('chicken', 'Bantam Polish - Golden Laced', 'bantam-polish-golden-laced', 'Bantams', 390),
    ('chicken', 'Bantam Polish - Silver Laced', 'bantam-polish-silver-laced', 'Bantams', 400),
    ('chicken', 'Bantam Polish - White Crested Black', 'bantam-polish-white-crested-black', 'Bantams', 410),
    ('chicken', 'Bantam Rhode Island Red', 'bantam-rhode-island-red', 'Bantams', 420),
    ('chicken', 'Bantam Sussex - Speckled', 'bantam-sussex-speckled', 'Bantams', 430),
    ('chicken', 'Bantam Wyandotte - Blue Laced Red', 'bantam-wyandotte-blue-laced-red', 'Bantams', 440),
    ('chicken', 'Bantam Wyandotte - Golden Laced', 'bantam-wyandotte-golden-laced', 'Bantams', 450),
    ('chicken', 'Bantam Wyandotte - Silver Laced', 'bantam-wyandotte-silver-laced', 'Bantams', 460),
    ('chicken', 'Barnevelder - Double Laced', 'barnevelder-double-laced', 'Layers', 470),
    ('chicken', 'Barnevelder - Silver Double Laced', 'barnevelder-silver-double-laced', 'Layers', 480),
    ('chicken', 'Belgian d''Anver - Black', 'belgian-d-anver-black', 'Bantams', 490),
    ('chicken', 'Belgian d''Anver - Mille Fleur', 'belgian-d-anver-mille-fleur', 'Bantams', 500),
    ('chicken', 'Belgian d''Anver - Quail', 'belgian-d-anver-quail', 'Bantams', 510),
    ('chicken', 'Belgian d''Uccle - Black', 'belgian-d-uccle-black', 'Bantams', 520),
    ('chicken', 'Belgian d''Uccle - Mille Fleur', 'belgian-d-uccle-mille-fleur', 'Bantams', 530),
    ('chicken', 'Belgian d''Uccle - Mottled', 'belgian-d-uccle-mottled', 'Bantams', 540),
    ('chicken', 'Belgian d''Uccle - Porcelain', 'belgian-d-uccle-porcelain', 'Bantams', 550),
    ('chicken', 'Black Sex Link', 'black-sex-link', 'Layers', 560),
    ('chicken', 'Bovans Brown', 'bovans-brown', 'Layers', 570),
    ('chicken', 'Brahma', 'brahma', 'Dual Purpose', 580),
    ('chicken', 'Brahma - Black', 'brahma-black', 'Dual Purpose', 590),
    ('chicken', 'Brahma - Blue', 'brahma-blue', 'Dual Purpose', 600),
    ('chicken', 'Brahma - Buff', 'brahma-buff', 'Dual Purpose', 610),
    ('chicken', 'Brahma - Dark', 'brahma-dark', 'Dual Purpose', 620),
    ('chicken', 'Brahma - Light', 'brahma-light', 'Dual Purpose', 630),
    ('chicken', 'Brahma - Silver', 'brahma-silver', 'Dual Purpose', 640),
    ('chicken', 'Buckeye', 'buckeye', 'Dual Purpose', 650),
    ('chicken', 'Butter Blue', 'butter-blue', 'Specialty / Project', 660),
    ('chicken', 'California Gray', 'california-gray', 'Layers', 670),
    ('chicken', 'California White', 'california-white', 'Layers', 680),
    ('chicken', 'Campine - Golden', 'campine-golden', 'Layers', 690),
    ('chicken', 'Campine - Silver', 'campine-silver', 'Layers', 700),
    ('chicken', 'Chantecler - Partridge', 'chantecler-partridge', 'Dual Purpose', 710),
    ('chicken', 'Chantecler - White', 'chantecler-white', 'Dual Purpose', 720),
    ('chicken', 'Cinnamon Queen', 'cinnamon-queen', 'Layers', 730),
    ('chicken', 'Cochin - Black', 'cochin-black', 'Dual Purpose', 740),
    ('chicken', 'Cochin - Blue', 'cochin-blue', 'Dual Purpose', 750),
    ('chicken', 'Cochin - Buff', 'cochin-buff', 'Dual Purpose', 760),
    ('chicken', 'Cochin - Partridge', 'cochin-partridge', 'Dual Purpose', 770),
    ('chicken', 'Cochin - Splash', 'cochin-splash', 'Dual Purpose', 780),
    ('chicken', 'Cornish Cross', 'cornish-cross', 'Meat Birds', 790),
    ('chicken', 'Cornish Cross Broiler', 'cornish-cross-broiler', 'Meat Birds', 800),
    ('chicken', 'Cream Legbar', 'cream-legbar', 'Dual Purpose', 810),
    ('chicken', 'Crevecoeur', 'crevecoeur', 'Layers', 820),
    ('chicken', 'Delaware', 'delaware', 'Dual Purpose', 830),
    ('chicken', 'Dominique', 'dominique', 'Dual Purpose', 840),
    ('chicken', 'Dorking - Colored', 'dorking-colored', 'Dual Purpose', 850),
    ('chicken', 'Dorking - Silver Gray', 'dorking-silver-gray', 'Dual Purpose', 860),
    ('chicken', 'Dutch Bantam', 'dutch-bantam', 'Bantams', 870),
    ('chicken', 'Easter Egger', 'easter-egger', 'Layers', 880),
    ('chicken', 'English Orpington - Buff', 'english-orpington-buff', 'Dual Purpose', 890),
    ('chicken', 'Farmers Choice - All Available', 'farmers-choice-all-available', 'Farmers Choice', 900),
    ('chicken', 'Farmers Choice - Blue Egg Layers', 'farmers-choice-blue-egg-layers', 'Farmers Choice', 910),
    ('chicken', 'Farmers Choice - Brown Egg Layers', 'farmers-choice-brown-egg-layers', 'Farmers Choice', 920),
    ('chicken', 'Farmers Choice - Cream Egg Layers', 'farmers-choice-cream-egg-layers', 'Farmers Choice', 930),
    ('chicken', 'Farmers Choice - Rare Breeds', 'farmers-choice-rare-breeds', 'Farmers Choice', 940),
    ('chicken', 'Farmers Choice - White Egg Layers', 'farmers-choice-white-egg-layers', 'Farmers Choice', 950),
    ('chicken', 'Faverolles - Salmon', 'faverolles-salmon', 'Dual Purpose', 960),
    ('chicken', 'Faverolles - White', 'faverolles-white', 'Dual Purpose', 970),
    ('chicken', 'Freedom Ranger', 'freedom-ranger', 'Meat Birds', 980),
    ('chicken', 'Golden Comet', 'golden-comet', 'Layers', 990),
    ('chicken', 'Hamburg - Golden Spangled', 'hamburg-golden-spangled', 'Layers', 1000),
    ('chicken', 'Hamburg - Silver Spangled', 'hamburg-silver-spangled', 'Layers', 1010),
    ('chicken', 'Houdan', 'houdan', 'Layers', 1020),
    ('chicken', 'Houdan - Mottled', 'houdan-mottled', 'Layers', 1030),
    ('chicken', 'Hy-Line Brown', 'hy-line-brown', 'Layers', 1040),
    ('chicken', 'Icelandic', 'icelandic', 'Layers', 1050),
    ('chicken', 'ISA Brown', 'isa-brown', 'Layers', 1060),
    ('chicken', 'Java - Black', 'java-black', 'Dual Purpose', 1070),
    ('chicken', 'Java - Mottled', 'java-mottled', 'Dual Purpose', 1080),
    ('chicken', 'Jersey Giant - Black', 'jersey-giant-black', 'Dual Purpose', 1090),
    ('chicken', 'Jersey Giant - Blue', 'jersey-giant-blue', 'Dual Purpose', 1100),
    ('chicken', 'Jersey Giant - White', 'jersey-giant-white', 'Dual Purpose', 1110),
    ('chicken', 'Kosher King', 'kosher-king', 'Meat Birds', 1120),
    ('chicken', 'La Fleche', 'la-fleche', 'Layers', 1130),
    ('chicken', 'Lakenvelder', 'lakenvelder', 'Layers', 1140),
    ('chicken', 'Langshan - Black', 'langshan-black', 'Dual Purpose', 1150),
    ('chicken', 'Langshan - Blue', 'langshan-blue', 'Dual Purpose', 1160),
    ('chicken', 'Langshan - White', 'langshan-white', 'Dual Purpose', 1170),
    ('chicken', 'Leghorn - Black', 'leghorn-black', 'Layers', 1180),
    ('chicken', 'Leghorn - Blue Breasted Brown', 'leghorn-blue-breasted-brown', 'Layers', 1190),
    ('chicken', 'Leghorn - Blue Partridge', 'leghorn-blue-partridge', 'Layers', 1200),
    ('chicken', 'Leghorn - Brown', 'leghorn-brown', 'Layers', 1210),
    ('chicken', 'Leghorn - Buff', 'leghorn-buff', 'Layers', 1220),
    ('chicken', 'Leghorn - Combless', 'leghorn-combless', 'Layers', 1230),
    ('chicken', 'Leghorn - Silver', 'leghorn-silver', 'Layers', 1240),
    ('chicken', 'Leghorn - V-Comb', 'leghorn-v-comb', 'Layers', 1250),
    ('chicken', 'Leghorn - White', 'leghorn-white', 'Layers', 1260),
    ('chicken', 'Marans - Black Copper', 'marans-black-copper', 'Layers', 1270),
    ('chicken', 'Marans - Blue', 'marans-blue', 'Layers', 1280),
    ('chicken', 'Marans - Blue Copper', 'marans-blue-copper', 'Layers', 1290),
    ('chicken', 'Marans - Cuckoo', 'marans-cuckoo', 'Layers', 1300),
    ('chicken', 'Marans - Golden', 'marans-golden', 'Layers', 1310),
    ('chicken', 'Marans - Splash', 'marans-splash', 'Layers', 1320),
    ('chicken', 'Marans - Splash Copper', 'marans-splash-copper', 'Layers', 1330),
    ('chicken', 'Marans - Wheaten', 'marans-wheaten', 'Layers', 1340),
    ('chicken', 'Marans - White', 'marans-white', 'Layers', 1350),
    ('chicken', 'Mesa Blue', 'mesa-blue', 'Specialty / Project', 1360),
    ('chicken', 'Minorca - Black', 'minorca-black', 'Layers', 1370),
    ('chicken', 'Minorca - Buff', 'minorca-buff', 'Layers', 1380),
    ('chicken', 'Minorca - White', 'minorca-white', 'Layers', 1390),
    ('chicken', 'Modern Game Bantam', 'modern-game-bantam', 'Bantams', 1400),
    ('chicken', 'Moon Dust Blue', 'moon-dust-blue', 'Specialty / Project', 1410),
    ('chicken', 'Moon Dust Brown', 'moon-dust-brown', 'Specialty / Project', 1420),
    ('chicken', 'Naked Neck - Black', 'naked-neck-black', 'Dual Purpose', 1430),
    ('chicken', 'Naked Neck - Buff', 'naked-neck-buff', 'Dual Purpose', 1440),
    ('chicken', 'Naked Neck - Mixed', 'naked-neck-mixed', 'Dual Purpose', 1450),
    ('chicken', 'Nankin', 'nankin', 'Bantams', 1460),
    ('chicken', 'New Hampshire', 'new-hampshire', 'Dual Purpose', 1470),
    ('chicken', 'Old English Game Bantam - Birchen', 'old-english-game-bantam-birchen', 'Bantams', 1480),
    ('chicken', 'Old English Game Bantam - Black', 'old-english-game-bantam-black', 'Bantams', 1490),
    ('chicken', 'Old English Game Bantam - Black Breasted Red', 'old-english-game-bantam-black-breasted-red', 'Bantams', 1500),
    ('chicken', 'Old English Game Bantam - Crele', 'old-english-game-bantam-crele', 'Bantams', 1510),
    ('chicken', 'Old English Game Bantam - Silver', 'old-english-game-bantam-silver', 'Bantams', 1520),
    ('chicken', 'Old English Game Bantam - White', 'old-english-game-bantam-white', 'Bantams', 1530),
    ('chicken', 'Olive Egger', 'olive-egger', 'Layers', 1540),
    ('chicken', 'Orloff - Spangled', 'orloff-spangled', 'Dual Purpose', 1550),
    ('chicken', 'Orpington - Black', 'orpington-black', 'Dual Purpose', 1560),
    ('chicken', 'Orpington - Blue', 'orpington-blue', 'Dual Purpose', 1570),
    ('chicken', 'Orpington - Buff', 'orpington-buff', 'Dual Purpose', 1580),
    ('chicken', 'Orpington - Chocolate', 'orpington-chocolate', 'Dual Purpose', 1590),
    ('chicken', 'Orpington - Jubilee', 'orpington-jubilee', 'Dual Purpose', 1600),
    ('chicken', 'Orpington - Lavender', 'orpington-lavender', 'Dual Purpose', 1610),
    ('chicken', 'Orpington - Silver Laced', 'orpington-silver-laced', 'Dual Purpose', 1620),
    ('chicken', 'Orpington - Splash', 'orpington-splash', 'Dual Purpose', 1630),
    ('chicken', 'Pekin', 'pekin-chicken', 'Bantams', 1640),
    ('chicken', 'Penedesenca - Black', 'penedesenca-black', 'Layers', 1650),
    ('chicken', 'Penedesenca - Crele', 'penedesenca-crele', 'Layers', 1660),
    ('chicken', 'Phoenix - Golden', 'phoenix-golden', 'Layers', 1670),
    ('chicken', 'Phoenix - Silver', 'phoenix-silver', 'Layers', 1680),
    ('chicken', 'Plymouth Rock - Barred', 'plymouth-rock-barred', 'Dual Purpose', 1690),
    ('chicken', 'Plymouth Rock - Buff', 'plymouth-rock-buff', 'Dual Purpose', 1700),
    ('chicken', 'Plymouth Rock - Partridge', 'plymouth-rock-partridge', 'Dual Purpose', 1710),
    ('chicken', 'Plymouth Rock - Silver Penciled', 'plymouth-rock-silver-penciled', 'Dual Purpose', 1720),
    ('chicken', 'Plymouth Rock - White', 'plymouth-rock-white', 'Dual Purpose', 1730),
    ('chicken', 'Polish - Buff Laced', 'polish-buff-laced', 'Layers', 1740),
    ('chicken', 'Polish - Candy Corn Crele', 'polish-candy-corn-crele', 'Layers', 1750),
    ('chicken', 'Polish - Golden Laced', 'polish-golden-laced', 'Layers', 1760),
    ('chicken', 'Polish - Tolbunt', 'polish-tolbunt', 'Layers', 1770),
    ('chicken', 'Polish - White', 'polish-white', 'Layers', 1780),
    ('chicken', 'Polish - White Crested Black', 'polish-white-crested-black', 'Layers', 1790),
    ('chicken', 'Polish - White Crested Blue', 'polish-white-crested-blue', 'Layers', 1800),
    ('chicken', 'Prairie Bluebell', 'prairie-bluebell', 'Layers', 1810),
    ('chicken', 'Prairie Bluebell Egger', 'prairie-bluebell-egger', 'Layers', 1820),
    ('chicken', 'Production Red', 'production-red', 'Layers', 1830),
    ('chicken', 'Red Comet', 'red-comet', 'Layers', 1840),
    ('chicken', 'Red Ranger', 'red-ranger', 'Meat Birds', 1850),
    ('chicken', 'Red Sex Link', 'red-sex-link', 'Layers', 1860),
    ('chicken', 'Rhode Island Red', 'rhode-island-red', 'Dual Purpose', 1870),
    ('chicken', 'Rhode Island White', 'rhode-island-white', 'Dual Purpose', 1880),
    ('chicken', 'Rosecomb - Black', 'rosecomb-black', 'Bantams', 1890),
    ('chicken', 'Rosecomb - Blue', 'rosecomb-blue', 'Bantams', 1900),
    ('chicken', 'Rosecomb - White', 'rosecomb-white', 'Bantams', 1910),
    ('chicken', 'Russian Orloff - White', 'russian-orloff-white', 'Dual Purpose', 1920),
    ('chicken', 'Sapphire Gem', 'sapphire-gem', 'Layers', 1930),
    ('chicken', 'Sebright - Golden', 'sebright-golden', 'Bantams', 1940),
    ('chicken', 'Sebright - Silver', 'sebright-silver', 'Bantams', 1950),
    ('chicken', 'Serama', 'serama', 'Bantams', 1960),
    ('chicken', 'Sicilian Buttercup', 'sicilian-buttercup', 'Layers', 1970),
    ('chicken', 'Silkie - Black', 'silkie-black', 'Layers', 1980),
    ('chicken', 'Silkie - Blue', 'silkie-blue', 'Layers', 1990),
    ('chicken', 'Silkie - Buff', 'silkie-buff', 'Layers', 2000),
    ('chicken', 'Silkie - Cuckoo', 'silkie-cuckoo', 'Layers', 2010),
    ('chicken', 'Silkie - Gray', 'silkie-gray', 'Layers', 2020),
    ('chicken', 'Silkie - Lavender', 'silkie-lavender', 'Layers', 2030),
    ('chicken', 'Silkie - Paint', 'silkie-paint', 'Layers', 2040),
    ('chicken', 'Silkie - Partridge', 'silkie-partridge', 'Layers', 2050),
    ('chicken', 'Silkie - Splash', 'silkie-splash', 'Layers', 2060),
    ('chicken', 'Silkie - White', 'silkie-white', 'Layers', 2070),
    ('chicken', 'Spanish - White Faced Black', 'spanish-white-faced-black', 'Layers', 2080),
    ('chicken', 'Sultan', 'sultan', 'Layers', 2090),
    ('chicken', 'Sumatra', 'sumatra', 'Layers', 2100),
    ('chicken', 'Sussex - Buff', 'sussex-buff', 'Dual Purpose', 2110),
    ('chicken', 'Sussex - Light', 'sussex-light', 'Dual Purpose', 2120),
    ('chicken', 'Sussex - Speckled', 'sussex-speckled', 'Dual Purpose', 2130),
    ('chicken', 'Vorwerk', 'vorwerk', 'Layers', 2140),
    ('chicken', 'Welsummer', 'welsummer', 'Dual Purpose', 2150),
    ('chicken', 'Whiting Creole Blue', 'whiting-creole-blue', 'Specialty / Project', 2160),
    ('chicken', 'Whiting Green', 'whiting-green', 'Specialty / Project', 2170),
    ('chicken', 'Whiting True Blue', 'whiting-true-blue', 'Specialty / Project', 2180),
    ('chicken', 'Wyandotte - Black', 'wyandotte-black', 'Dual Purpose', 2190),
    ('chicken', 'Wyandotte - Blue', 'wyandotte-blue', 'Dual Purpose', 2200),
    ('chicken', 'Wyandotte - Blue Laced Red', 'wyandotte-blue-laced-red', 'Dual Purpose', 2210),
    ('chicken', 'Wyandotte - Buff', 'wyandotte-buff', 'Dual Purpose', 2220),
    ('chicken', 'Wyandotte - Columbian', 'wyandotte-columbian', 'Dual Purpose', 2230),
    ('chicken', 'Wyandotte - Golden Laced', 'wyandotte-golden-laced', 'Dual Purpose', 2240),
    ('chicken', 'Wyandotte - Partridge', 'wyandotte-partridge', 'Dual Purpose', 2250),
    ('chicken', 'Wyandotte - Silver Laced', 'wyandotte-silver-laced', 'Dual Purpose', 2260),
    ('chicken', 'Wyandotte - White', 'wyandotte-white', 'Dual Purpose', 2270),
    ('chicken', 'Yokohama', 'yokohama', 'Layers', 2280),

    -- Ducks.
    ('duck', 'Ancona', 'ancona-duck', 'waterfowl', 10),
    ('duck', 'Appleyard', 'appleyard', 'waterfowl', 20),
    ('duck', 'Cayuga', 'cayuga', 'waterfowl', 30),
    ('duck', 'Crested', 'crested-duck', 'waterfowl', 40),
    ('duck', 'Indian Runner', 'indian-runner', 'waterfowl', 50),
    ('duck', 'Khaki Campbell', 'khaki-campbell', 'waterfowl', 60),
    ('duck', 'Magpie', 'magpie-duck', 'waterfowl', 70),
    ('duck', 'Muscovy', 'muscovy', 'waterfowl', 80),
    ('duck', 'Pekin', 'pekin-duck', 'waterfowl', 90),
    ('duck', 'Rouen', 'rouen', 'waterfowl', 100),
    ('duck', 'Saxony', 'saxony', 'waterfowl', 110),
    ('duck', 'Silver Appleyard', 'silver-appleyard', 'waterfowl', 120),
    ('duck', 'Welsh Harlequin', 'welsh-harlequin', 'waterfowl', 130),
    ('duck', 'Swedish - Black', 'swedish-black', 'waterfowl', 140),
    ('duck', 'Swedish - Blue', 'swedish-blue', 'waterfowl', 150),
    ('duck', 'Swedish - Splash', 'swedish-splash', 'waterfowl', 160),
    ('duck', 'Call - White', 'call-white', 'waterfowl', 170),
    ('duck', 'Call - Gray', 'call-gray', 'waterfowl', 180),
    ('duck', 'Call - Blue Fawn', 'call-blue-fawn', 'waterfowl', 190),
    ('duck', 'Call - Pastel', 'call-pastel', 'waterfowl', 200),
    ('duck', 'Call - Snowy', 'call-snowy', 'waterfowl', 210),

    -- Geese.
    ('goose', 'African', 'african-goose', 'waterfowl', 10),
    ('goose', 'American Buff', 'american-buff-goose', 'waterfowl', 20),
    ('goose', 'Chinese - Brown', 'chinese-brown', 'waterfowl', 30),
    ('goose', 'Chinese - White', 'chinese-white', 'waterfowl', 40),
    ('goose', 'Embden', 'embden', 'waterfowl', 50),
    ('goose', 'Pilgrim', 'pilgrim', 'waterfowl', 60),
    ('goose', 'Pomeranian', 'pomeranian-goose', 'waterfowl', 70),
    ('goose', 'Roman Tufted', 'roman-tufted', 'waterfowl', 80),
    ('goose', 'Sebastopol', 'sebastopol', 'waterfowl', 90),
    ('goose', 'Toulouse', 'toulouse', 'waterfowl', 100),

    -- Turkeys.
    ('turkey', 'Bourbon Red', 'bourbon-red', 'turkey', 10),
    ('turkey', 'Bronze', 'bronze', 'turkey', 20),
    ('turkey', 'Narragansett', 'narragansett', 'turkey', 30),
    ('turkey', 'Royal Palm', 'royal-palm', 'turkey', 40),
    ('turkey', 'Slate', 'slate', 'turkey', 50),
    ('turkey', 'White Holland', 'white-holland', 'turkey', 60),
    ('turkey', 'Beltsville Small White', 'beltsville-small-white', 'turkey', 70),
    ('turkey', 'Black Spanish', 'black-spanish', 'turkey', 80),
    ('turkey', 'Chocolate', 'chocolate', 'turkey', 90),
    ('turkey', 'Jersey Buff', 'jersey-buff', 'turkey', 100),

    -- Guinea fowl.
    ('guinea-fowl', 'Pearl', 'pearl-guinea', 'gamebird', 10),
    ('guinea-fowl', 'Lavender', 'lavender-guinea', 'gamebird', 20),
    ('guinea-fowl', 'White', 'white-guinea', 'gamebird', 30),
    ('guinea-fowl', 'Royal Purple', 'royal-purple-guinea', 'gamebird', 40),
    ('guinea-fowl', 'Coral Blue', 'coral-blue-guinea', 'gamebird', 50),
    ('guinea-fowl', 'Buff Dundotte', 'buff-dundotte-guinea', 'gamebird', 60),
    ('guinea-fowl', 'Pied', 'pied-guinea', 'gamebird', 70),

    -- Quail.
    ('quail', 'Coturnix - Pharaoh', 'coturnix-pharaoh', 'gamebird', 10),
    ('quail', 'Coturnix - Jumbo Brown', 'coturnix-jumbo-brown', 'gamebird', 20),
    ('quail', 'Coturnix - Texas A&M', 'coturnix-texas-a-m', 'gamebird', 30),
    ('quail', 'Coturnix - English White', 'coturnix-english-white', 'gamebird', 40),
    ('quail', 'Coturnix - Italian', 'coturnix-italian', 'gamebird', 50),
    ('quail', 'Coturnix - Tibetan', 'coturnix-tibetan', 'gamebird', 60),
    ('quail', 'Coturnix - Rosetta', 'coturnix-rosetta', 'gamebird', 70),
    ('quail', 'Coturnix - Tuxedo', 'coturnix-tuxedo', 'gamebird', 80),
    ('quail', 'Coturnix - Pearl Fee', 'coturnix-pearl-fee', 'gamebird', 90),
    ('quail', 'Bobwhite', 'bobwhite', 'gamebird', 100),

    -- Pheasants.
    ('pheasant', 'Ringneck', 'ringneck', 'gamebird', 10),
    ('pheasant', 'Melanistic Mutant', 'melanistic-mutant', 'gamebird', 20),
    ('pheasant', 'Lady Amherst', 'lady-amherst', 'gamebird', 30),
    ('pheasant', 'Golden', 'golden-pheasant', 'gamebird', 40),
    ('pheasant', 'Silver', 'silver-pheasant', 'gamebird', 50),
    ('pheasant', 'Reeves', 'reeves', 'gamebird', 60),

    -- Peafowl.
    ('peafowl', 'India Blue', 'india-blue', 'ornamental', 10),
    ('peafowl', 'White', 'white-peafowl', 'ornamental', 20),
    ('peafowl', 'Black Shoulder', 'black-shoulder', 'ornamental', 30),
    ('peafowl', 'Pied', 'pied-peafowl', 'ornamental', 40),
    ('peafowl', 'Purple', 'purple-peafowl', 'ornamental', 50),
    ('peafowl', 'Cameo', 'cameo-peafowl', 'ornamental', 60),

    -- Pigeons & Doves.
    ('pigeons-doves', 'King', 'king', 'pigeon-dove', 10),
    ('pigeons-doves', 'Racing Homer', 'racing-homer', 'pigeon-dove', 20),
    ('pigeons-doves', 'Birmingham Roller', 'birmingham-roller', 'pigeon-dove', 30),
    ('pigeons-doves', 'Fantail', 'fantail', 'pigeon-dove', 40),
    ('pigeons-doves', 'Jacobin', 'jacobin', 'pigeon-dove', 50),
    ('pigeons-doves', 'Modena', 'modena', 'pigeon-dove', 60),
    ('pigeons-doves', 'Archangel', 'archangel', 'pigeon-dove', 70),
    ('pigeons-doves', 'Ringneck Dove', 'ringneck-dove', 'pigeon-dove', 80),

    -- Emus, Ostriches & Rheas.
    ('emus-ostriches-rheas', 'Emu', 'emu', 'ratite', 10),
    ('emus-ostriches-rheas', 'Ostrich - African Black', 'ostrich-african-black', 'ratite', 20),
    ('emus-ostriches-rheas', 'Rhea - Greater', 'rhea-greater', 'ratite', 30)
)
insert into public.breeds (
  species_id,
  breed_name,
  breed_slug,
  category,
  sort_order,
  is_active,
  is_custom
)
select
  species.id,
  seed_breeds.breed_name,
  seed_breeds.breed_slug,
  seed_breeds.category,
  seed_breeds.sort_order,
  true,
  false
from seed_breeds
join public.species
  on species.slug = seed_breeds.species_slug
on conflict (species_id, breed_slug) do update
set
  breed_name = excluded.breed_name,
  category = excluded.category,
  sort_order = excluded.sort_order,
  is_active = true,
  is_custom = false,
  updated_at = now();


with seed_aliases(species_slug, breed_slug, alias) as (
  values
    ('chicken', 'rhode-island-red', 'RIR'),
    ('chicken', 'marans-black-copper', 'BCM'),
    ('chicken', 'easter-egger', 'EE'),
    ('chicken', 'olive-egger', 'OE'),
    ('chicken', 'whiting-true-blue', 'WTB'),
    ('chicken', 'wyandotte-silver-laced', 'SLW'),
    ('chicken', 'wyandotte-blue-laced-red', 'BLRW')
),
normalized_aliases as (
  select
    seed_aliases.species_slug,
    seed_aliases.breed_slug,
    seed_aliases.alias,
    regexp_replace(
      regexp_replace(
        lower(trim(seed_aliases.alias)),
        '[^a-z0-9]+',
        '-',
        'g'
      ),
      '(^-|-$)',
      '',
      'g'
    ) as normalized_alias
  from seed_aliases
)
insert into public.breed_aliases (
  breed_id,
  alias,
  normalized_alias
)
select
  breeds.id,
  normalized_aliases.alias,
  normalized_aliases.normalized_alias
from normalized_aliases
join public.species
  on species.slug = normalized_aliases.species_slug
join public.breeds
  on breeds.species_id = species.id
 and breeds.breed_slug = normalized_aliases.breed_slug
where normalized_aliases.normalized_alias <> ''
on conflict (normalized_alias) do nothing;
