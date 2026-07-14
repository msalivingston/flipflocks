-- Platform-managed FAQ content for the FlockFront website.
-- Public read access is intentionally not granted in this pass.

create table public.site_faqs (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  answer text not null,
  is_published boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint site_faqs_question_not_blank_check check (btrim(question) <> ''),
  constraint site_faqs_answer_not_blank_check check (btrim(answer) <> '')
);

create index site_faqs_sort_order_created_at_idx
on public.site_faqs(sort_order, created_at);

create trigger site_faqs_set_updated_at
before update on public.site_faqs
for each row
execute function public.set_updated_at();

alter table public.site_faqs enable row level security;

create policy "Platform admins can read site FAQs"
on public.site_faqs
for select
to authenticated
using (public.is_platform_admin());

create policy "Platform admins can insert site FAQs"
on public.site_faqs
for insert
to authenticated
with check (public.is_platform_admin());

create policy "Platform admins can update site FAQs"
on public.site_faqs
for update
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

create policy "Platform admins can delete site FAQs"
on public.site_faqs
for delete
to authenticated
using (public.is_platform_admin());

revoke all on public.site_faqs from anon;
grant select, insert, update, delete on public.site_faqs to authenticated;

comment on table public.site_faqs is
'Platform-managed FAQ content for the future public FlockFront website FAQ section.';
