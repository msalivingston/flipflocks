create table if not exists public.customer_timeline_notes (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  note_date date not null default current_date,
  title text,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint customer_timeline_notes_title_not_empty_check check (
    title is null
    or length(trim(title)) > 0
  ),

  constraint customer_timeline_notes_body_not_empty_check check (
    length(trim(body)) > 0
  )
);

comment on table public.customer_timeline_notes is
'Seller-private dated customer activity notes for the customer timeline.';

comment on column public.customer_timeline_notes.store_id is
'Tenant ownership field used for seller-scoped RLS.';

comment on column public.customer_timeline_notes.customer_id is
'Customer this private timeline note belongs to.';

create index if not exists customer_timeline_notes_store_customer_date_idx
on public.customer_timeline_notes(store_id, customer_id, note_date desc, created_at desc);

drop trigger if exists customer_timeline_notes_set_updated_at
on public.customer_timeline_notes;

create trigger customer_timeline_notes_set_updated_at
before update on public.customer_timeline_notes
for each row
execute function public.set_updated_at();

alter table public.customer_timeline_notes enable row level security;

drop policy if exists "Store owners can read own customer timeline notes"
on public.customer_timeline_notes;

create policy "Store owners can read own customer timeline notes"
on public.customer_timeline_notes
for select
to authenticated
using (
  (
    public.owns_store(store_id)
    or public.is_admin()
  )
  and exists (
    select 1
    from public.customers
    where customers.id = customer_timeline_notes.customer_id
      and customers.store_id = customer_timeline_notes.store_id
  )
);

drop policy if exists "Store owners can insert own customer timeline notes"
on public.customer_timeline_notes;

create policy "Store owners can insert own customer timeline notes"
on public.customer_timeline_notes
for insert
to authenticated
with check (
  (
    public.owns_store(store_id)
    or public.is_admin()
  )
  and exists (
    select 1
    from public.customers
    where customers.id = customer_timeline_notes.customer_id
      and customers.store_id = customer_timeline_notes.store_id
  )
);

drop policy if exists "Store owners can update own customer timeline notes"
on public.customer_timeline_notes;

create policy "Store owners can update own customer timeline notes"
on public.customer_timeline_notes
for update
to authenticated
using (
  (
    public.owns_store(store_id)
    or public.is_admin()
  )
  and exists (
    select 1
    from public.customers
    where customers.id = customer_timeline_notes.customer_id
      and customers.store_id = customer_timeline_notes.store_id
  )
)
with check (
  (
    public.owns_store(store_id)
    or public.is_admin()
  )
  and exists (
    select 1
    from public.customers
    where customers.id = customer_timeline_notes.customer_id
      and customers.store_id = customer_timeline_notes.store_id
  )
);

drop policy if exists "Store owners can delete own customer timeline notes"
on public.customer_timeline_notes;

create policy "Store owners can delete own customer timeline notes"
on public.customer_timeline_notes
for delete
to authenticated
using (
  (
    public.owns_store(store_id)
    or public.is_admin()
  )
  and exists (
    select 1
    from public.customers
    where customers.id = customer_timeline_notes.customer_id
      and customers.store_id = customer_timeline_notes.store_id
  )
);

revoke all on public.customer_timeline_notes from public;
grant select, insert, update, delete on public.customer_timeline_notes to authenticated;
