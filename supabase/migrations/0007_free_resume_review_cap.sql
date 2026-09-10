-- Free resume review now includes a job posting (JD-aware feedback), but
-- that's real Sonnet-call cost with no purchase behind it - cap it per
-- account so it can't be hammered indefinitely. Atomic: the UPDATE's WHERE
-- clause only succeeds under the limit, so concurrent requests can't both
-- sneak through (same pattern as increment_anon_usage / add_resume_review_credit).

alter table subscriptions add column if not exists free_resume_reviews_used int not null default 0;

create or replace function use_free_resume_review(p_user_id uuid, p_limit int default 3)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  insert into subscriptions (user_id, free_resume_reviews_used)
  values (p_user_id, 1)
  on conflict (user_id) do update
    set free_resume_reviews_used = subscriptions.free_resume_reviews_used + 1
    where subscriptions.free_resume_reviews_used < p_limit
  returning free_resume_reviews_used into v_count;
  return v_count is not null;
end;
$$;

revoke all on function use_free_resume_review(uuid, int) from public;
grant execute on function use_free_resume_review(uuid, int) to service_role;
