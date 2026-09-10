-- Anonymous message cap: 8 requests per IP per rolling 24h window before
-- api/chat.js requires sign-in. Signed-in users are never subject to this.
--
-- The table itself has RLS enabled with NO policies, so it can only be
-- written through increment_anon_usage() below (SECURITY DEFINER, owned by
-- the migration-running role, which bypasses RLS) — anon/authenticated
-- callers can invoke the function but can't read or write the table directly.

create table if not exists anon_rate_limit (
  rate_key text primary key,
  hit_count int not null default 0,
  window_start timestamptz not null default now()
);

alter table anon_rate_limit enable row level security;

create or replace function increment_anon_usage(p_key text, p_window_hours int default 24)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  insert into anon_rate_limit (rate_key, hit_count, window_start)
  values (p_key, 1, now())
  on conflict (rate_key) do update
    set hit_count = case
        when anon_rate_limit.window_start < now() - make_interval(hours => p_window_hours)
          then 1
        else anon_rate_limit.hit_count + 1
      end,
      window_start = case
        when anon_rate_limit.window_start < now() - make_interval(hours => p_window_hours)
          then now()
        else anon_rate_limit.window_start
      end
  returning hit_count into v_count;
  return v_count;
end;
$$;

revoke all on function increment_anon_usage(text, int) from public;
grant execute on function increment_anon_usage(text, int) to anon, authenticated;
