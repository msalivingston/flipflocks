-- Normalize breed category capitalization
-- Data update only. No schema changes.

update public.breeds as breeds
set category = category_map.display_category
from (
  values
    ('waterfowl', 'Waterfowl'),
    ('gamebird', 'Gamebird'),
    ('bantams', 'Bantams'),
    ('layers', 'Layers'),
    ('dual purpose', 'Dual Purpose'),
    ('meat birds', 'Meat Birds'),
    ('farmers choice', 'Farmer''s Choice'),
    ('specialty / project', 'Specialty / Project')
) as category_map(existing_category, display_category)
where breeds.category = category_map.existing_category;

-- Validation: distinct category values.
select distinct
  category
from public.breeds
where category is not null
order by category;

-- Validation: count by category.
select
  category,
  count(*) as breed_count
from public.breeds
where category is not null
group by category
order by category;
