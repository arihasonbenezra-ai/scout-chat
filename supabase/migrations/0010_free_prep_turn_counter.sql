-- The 10-question free prep cap was being counted by trusting the
-- assistant-message count in the client-submitted `messages` array, which
-- is not a real limit - a client that sends a shorter history resets its
-- own count. Replace it with a real server-side counter, same atomic
-- pattern as use_free_resume_review: the UPDATE's WHERE clause only
-- succeeds under the limit, so concurrent requests can't both sneak through.

alter table subscriptions add column if not exists free_prep_turns_used int not null default 0;

create or replace function use_free_prep_turn(p_user_id uuid, p_limit int default 10)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  insert into subscriptions (user_id, free_prep_turns_used)
  values (p_user_id, 1)
  on conflict (user_id) do update
    set free_prep_turns_used = subscriptions.free_prep_turns_used + 1
    where subscriptions.free_prep_turns_used < p_limit
  returning free_prep_turns_used into v_count;
  return v_count is not null;
end;
$$;

revoke all on function use_free_prep_turn(uuid, int) from public;
grant execute on function use_free_prep_turn(uuid, int) to service_role;
