-- Memoria personale di Lorenzo AI.
-- Le note si salvano solo quando l'utente lo chiede esplicitamente.
create table if not exists public.user_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null check (char_length(trim(content)) between 2 and 400),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_memories_user_updated_idx
  on public.user_memories (user_id, updated_at desc);

create unique index if not exists user_memories_user_content_unique
  on public.user_memories (user_id, lower(trim(content)));

alter table public.user_memories enable row level security;

drop policy if exists "Users can read their own memories" on public.user_memories;
create policy "Users can read their own memories"
  on public.user_memories for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can create their own memories" on public.user_memories;
create policy "Users can create their own memories"
  on public.user_memories for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own memories" on public.user_memories;
create policy "Users can update their own memories"
  on public.user_memories for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own memories" on public.user_memories;
create policy "Users can delete their own memories"
  on public.user_memories for delete
  to authenticated
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.user_memories to authenticated;
grant select, insert, update, delete on public.user_memories to service_role;

create or replace function public.set_user_memories_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_memories_updated_at on public.user_memories;
create trigger user_memories_updated_at
before update on public.user_memories
for each row execute function public.set_user_memories_updated_at();
