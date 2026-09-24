-- Free tier redesign:
--
-- 1. Interview prep: STAR Coaching and Mock Interview become fully paid
--    features (like Company Research already is) - Practice Q&A is now the
--    only free prep mode. This replaces the old "locked to whichever mode
--    you tried first" scheme entirely, since there's only one free mode
--    left to lock to.
--
-- 2. Carry anonymous usage into a new account at signup, so someone can't
--    use their free resume review and/or free practice session
--    anonymously, then sign up and get a second free round on the new
--    account. Two small functions (prep, resume) rather than one unified
--    one, since the two free actions stay independent per the product
--    decision (both allowed, not one-or-the-other).

-- Carries over anonymous prep usage (see anon_rate_limit's 'prep:<ip>' key)
-- into the new account's free_prep_turns_used, but only if the account
-- hasn't used its own free practice session yet (won't clobber real usage).
create or replace function carry_over_anon_prep(p_user_id uuid, p_anon_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hits int;
begin
  select hit_count into v_hits from anon_rate_limit where rate_key = p_anon_key;
  if v_hits is null or v_hits = 0 then
    return;
  end if;

  insert into subscriptions (user_id, free_prep_turns_used, free_prep_mode)
  values (p_user_id, v_hits, 'practice')
  on conflict (user_id) do update
    set free_prep_turns_used = v_hits,
        free_prep_mode = coalesce(subscriptions.free_prep_mode, 'practice')
    where subscriptions.free_prep_turns_used = 0;
end;
$$;

revoke all on function carry_over_anon_prep(uuid, text) from public;
grant execute on function carry_over_anon_prep(uuid, text) to service_role;

-- Same idea for the free resume review - the anon 'resume:<ip>' key only
-- ever reaches hit_count 1 (the cap), so this is really just "did they
-- already use it anonymously" rather than a count to carry precisely.
create or replace function carry_over_anon_resume(p_user_id uuid, p_anon_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hits int;
begin
  select hit_count into v_hits from anon_rate_limit where rate_key = p_anon_key;
  if v_hits is null or v_hits = 0 then
    return;
  end if;

  insert into subscriptions (user_id, free_resume_reviews_used)
  values (p_user_id, 1)
  on conflict (user_id) do update
    set free_resume_reviews_used = 1
    where subscriptions.free_resume_reviews_used = 0;
end;
$$;

revoke all on function carry_over_anon_resume(uuid, text) from public;
grant execute on function carry_over_anon_resume(uuid, text) to service_role;
