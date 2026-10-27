-- Persistent daily quota for text-chat requests (UTC).
-- Clients cannot read or mutate this table; only the server's service role can.
create table if not exists public.ai_chat_daily_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  request_count integer not null default 0 check (request_count >= 0),
  primary key (user_id, usage_date)
);

alter table public.ai_chat_daily_usage enable row level security;
revoke all on public.ai_chat_daily_usage from anon, authenticated;
grant all on public.ai_chat_daily_usage to service_role;

create or replace function public.consume_ai_chat_request(
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

  insert into public.ai_chat_daily_usage as q (
    user_id, usage_date, request_count
  )
  values (p_user_id, v_today, 1)
  on conflict (user_id, usage_date)
  do update
    set request_count = q.request_count + 1
    where q.request_count < p_daily_limit
  returning request_count into v_count;

  if v_count is null then
    return query select false, 0, ((v_today + 1)::timestamp at time zone 'UTC');
    return;
  end if;

  return query select true, greatest(0, p_daily_limit - v_count),
    ((v_today + 1)::timestamp at time zone 'UTC');
end;
$$;

revoke all on function public.consume_ai_chat_request(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.consume_ai_chat_request(uuid, integer)
  to service_role;
