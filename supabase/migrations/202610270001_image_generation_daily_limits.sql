-- Daily image-generation quota for Lorenzo AI.
-- One shared row per user and UTC day; updates are atomic under concurrency.

create table if not exists public.image_generation_daily_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  generation_count integer not null default 0 check (generation_count >= 0),
  primary key (user_id, usage_date)
);

alter table public.image_generation_daily_usage enable row level security;

revoke all on public.image_generation_daily_usage from anon, authenticated;
grant all on public.image_generation_daily_usage to service_role;

create or replace function public.consume_image_generation(
  p_user_id uuid,
  p_daily_limit integer
)
returns table (
  allowed boolean,
  remaining integer,
  resets_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := (now() at time zone 'UTC')::date;
  v_count integer;
begin
  if p_user_id is null or p_daily_limit is null or p_daily_limit < 1 then
    return query select false, 0, ((v_today + 1)::timestamp at time zone 'UTC');
    return;
  end if;

  insert into public.image_generation_daily_usage as usage (
    user_id, usage_date, generation_count
  )
  values (p_user_id, v_today, 1)
  on conflict (user_id, usage_date)
  do update
    set generation_count = usage.generation_count + 1
    where usage.generation_count < p_daily_limit
  returning generation_count into v_count;

  if v_count is null then
    select usage.generation_count
      into v_count
      from public.image_generation_daily_usage as usage
      where usage.user_id = p_user_id
        and usage.usage_date = v_today;

    return query select false, 0, ((v_today + 1)::timestamp at time zone 'UTC');
    return;
  end if;

  return query
    select true, greatest(0, p_daily_limit - v_count),
      ((v_today + 1)::timestamp at time zone 'UTC');
end;
$$;

create or replace function public.refund_image_generation(
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := (now() at time zone 'UTC')::date;
begin
  if p_user_id is null then
    return;
  end if;

  update public.image_generation_daily_usage
    set generation_count = greatest(0, generation_count - 1)
    where user_id = p_user_id
      and usage_date = v_today;
end;
$$;

revoke all on function public.consume_image_generation(uuid, integer) from public, anon, authenticated;
revoke all on function public.refund_image_generation(uuid) from public, anon, authenticated;
grant execute on function public.consume_image_generation(uuid, integer) to service_role;
grant execute on function public.refund_image_generation(uuid) to service_role;
