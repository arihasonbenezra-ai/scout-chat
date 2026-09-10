-- Replaces the Pro/Premium plan scheme with the real tiers: Free,
-- Resume Review (one-time, single-use credit), Job Search (one-time,
-- 90-day access window), Career (recurring subscription). No rows have
-- ever been written to this table yet (the webhook was never registered
-- against a live endpoint), so redefining the constraint is safe.

alter table subscriptions drop constraint if exists subscriptions_plan_check;
alter table subscriptions add constraint subscriptions_plan_check
  check (plan in ('free', 'resume_review', 'job_search', 'career'));

alter table subscriptions add column if not exists resume_review_credits int not null default 0;

-- Atomic increment so two near-simultaneous purchases (or a webhook retry)
-- can't clobber each other via a read-then-write race from the webhook.
create or replace function add_resume_review_credit(p_user_id uuid, p_amount int default 1)
returns void
language sql
security definer
set search_path = public
as $$
  insert into subscriptions (user_id, resume_review_credits)
  values (p_user_id, p_amount)
  on conflict (user_id) do update
    set resume_review_credits = subscriptions.resume_review_credits + p_amount,
        updated_at = now();
$$;

revoke all on function add_resume_review_credit(uuid, int) from public;
grant execute on function add_resume_review_credit(uuid, int) to service_role;
