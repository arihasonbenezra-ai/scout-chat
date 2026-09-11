-- Anonymous users previously had no per-feature cap at all - only the
-- general 8-message/24h anti-spam ceiling in anon_rate_limit, which meant
-- someone could run unlimited resume reviews and interview prep sessions
-- anonymously forever. Free tier is now the same regardless of account
-- status: 1 resume review, 1 prep session capped at 8 questions.
--
-- Reuses anon_rate_limit (already IP-keyed) for both counters via the
-- existing increment_anon_usage RPC with a ~10-year window, so the count is
-- effectively lifetime-per-IP rather than the 24h rolling window the general
-- cap uses - callers use rate_key prefixes ('resume:<ip>', 'prep:<ip>') to
-- keep these counters distinct from the general per-IP key.
--
-- Prep mode also needs locking the same way a signed-in free account locks
-- one mode (practice/star/mock), so switching modes mid-session doesn't
-- reset the count under a fresh key.

alter table anon_rate_limit add column if not exists locked_mode text
  check (locked_mode in ('practice', 'star', 'mock'));

create or replace function lock_anon_prep_mode(p_key text, p_mode text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current text;
begin
  insert into anon_rate_limit (rate_key, hit_count, window_start, locked_mode)
  values (p_key, 0, now(), p_mode)
  on conflict (rate_key) do update
    set locked_mode = coalesce(anon_rate_limit.locked_mode, p_mode)
  returning locked_mode into v_current;
  return v_current;
end;
$$;

revoke all on function lock_anon_prep_mode(text, text) from public;
grant execute on function lock_anon_prep_mode(text, text) to anon, authenticated;
