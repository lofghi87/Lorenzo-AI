-- Persistent daily quota for all text-chat requests (UTC).
-- Anonymous visitors use a SHA-256 IP key; authenticated visitors use their user ID.
-- Raw client IP addresses are not stored in this table.
create table if not exists public.ai_chat_daily_usage (
  client_key text not null check (length(client_key) between 1 and 128),
  usage_date date not null,
  request_count integer not null default 0 check (request_count >= 0),
  primary key (client_key, usage_date)
);

alter table public.ai_chat_daily_usage enable row level security;
revoke all on public.ai_chat_daily_usage from anon, authenticated;
grant all on public.ai_chat_daily_usage to service_role;

create or replace function public.consume_ai_chat_request(
  p_client_key text,
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
  -- Elimina soltanto i vecchi contatori del client corrente: evita una
  -- scansione globale della tabella a ogni messaggio.
  delete from public.ai_chat_daily_usage
    where client_key = p_client_key
      and usage_date < v_today - 30;

  if p_client_key is null
     or length(p_client_key) < 1
     or length(p_client_key) > 128
     or p_daily_limit is null
     or p_daily_limit < 1 then
    return query select false, 0, ((v_today + 1)::timestamp at time zone 'UTC');
    return;
  end if;

  insert into public.ai_chat_daily_usage as q (
    client_key, usage_date, request_count
  )
  values (p_client_key, v_today, 1)
  on conflict (client_key, usage_date)
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

revoke all on function public.consume_ai_chat_request(text, integer)
  from public, anon, authenticated;
grant execute on function public.consume_ai_chat_request(text, integer)
  to service_role;
