-- Un profilo riassuntivo aggiornabile per ogni utente autenticato.
create table if not exists public.user_memory_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  profile_text text not null default '',
  updated_at timestamptz not null default now(),
  constraint user_memory_profiles_text_length
    check (char_length(profile_text) <= 8000)
);

alter table public.user_memory_profiles enable row level security;

drop policy if exists "Users can read their own memory profile"
  on public.user_memory_profiles;
create policy "Users can read their own memory profile"
  on public.user_memory_profiles for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can update their own memory profile"
  on public.user_memory_profiles;
create policy "Users can update their own memory profile"
  on public.user_memory_profiles for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can create their own memory profile"
  on public.user_memory_profiles;
create policy "Users can create their own memory profile"
  on public.user_memory_profiles for insert to authenticated
  with check (auth.uid() = user_id);

grant select, insert, update on public.user_memory_profiles to authenticated;
grant select, insert, update on public.user_memory_profiles to service_role;

create or replace function public.set_user_memory_profiles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_memory_profiles_updated_at
  on public.user_memory_profiles;
create trigger user_memory_profiles_updated_at
before update on public.user_memory_profiles
for each row execute function public.set_user_memory_profiles_updated_at();
