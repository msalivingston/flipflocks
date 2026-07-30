create extension if not exists pgcrypto;

create table if not exists public.species (
  id uuid primary key default gen_random_uuid(),
  common_name text,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.breeds (
  id uuid primary key default gen_random_uuid(),
  species_id uuid references public.species(id),
  breed_name text,
  breed_slug text,
  is_active boolean default true,
  created_at timestamptz default now()
);
