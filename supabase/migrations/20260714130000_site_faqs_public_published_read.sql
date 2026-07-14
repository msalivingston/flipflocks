-- Allow public website visitors to read published FAQ rows only.
-- Platform-admin write policies remain unchanged.

create policy "Anyone can read published site FAQs"
on public.site_faqs
for select
to anon, authenticated
using (is_published = true);

grant select on public.site_faqs to anon, authenticated;
