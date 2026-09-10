-- Supports Free-tier limits: which single prep mode a free user has
-- locked in, and an atomic way to spend a Resume Review credit.

alter table subscriptions add column if not exists free_prep_mode text
  check (free_prep_mode in ('practice', 'star', 'mock'));

create or replace function use_resume_review_credit(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update subscriptions
    set resume_review_credits = resume_review_credits - 1,
        updated_at = now()
    where user_id = p_user_id and resume_review_credits > 0;
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

revoke all on function use_resume_review_credit(uuid) from public;
grant execute on function use_resume_review_credit(uuid) to service_role;

create or replace function lock_free_prep_mode(p_user_id uuid, p_mode text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current text;
begin
  insert into subscriptions (user_id, free_prep_mode)
  values (p_user_id, p_mode)
  on conflict (user_id) do update
    set free_prep_mode = coalesce(subscriptions.free_prep_mode, p_mode)
  returning free_prep_mode into v_current;
  return v_current;
end;
$$;

revoke all on function lock_free_prep_mode(uuid, text) from public;
grant execute on function lock_free_prep_mode(uuid, text) to service_role;
