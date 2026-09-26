-- Memory model (Career Brain v1): the structured spine for Tier 2.
-- See EZZY_CAREER_BRAIN.md "v1: the memory model" for the rationale.
--
-- Adds, on top of career_profile / career_claims (0001):
--   1. Comparable target fields on career_profile - the one row per user
--      that matching, prep, and future cohort insights can query directly
--      (role, level, comp, work type, timeline). Kept as columns, not
--      claims, precisely because they must be comparable across users.
--   2. career_stories   - the story bank (STAR-shaped, competency-tagged).
--   3. career_opportunities - a specific role at a specific company the
--      user is considering, applying to, or interviewing for. Written by
--      pasted JDs today and by job matching later.
--   4. career_outcomes  - an append-only event log of what actually
--      happened (applied, interviewed, offer, hired...). This is the
--      hire-outcome tracking prerequisite. Self-reported to start.
--   5. career_decisions - the "Your Decisions" layer: a question the user
--      brought to Ezzy, what they chose, and why.
--
-- Nothing here is populated automatically yet except the target fields
-- (from the role picker and resume extraction). The tables exist so the
-- flows that follow write into one agreed shape instead of inventing one.

-- 1. Comparable target + identity fields ------------------------------------

alter table career_profile
  add column if not exists target_role_title text,
  add column if not exists target_level text
    check (target_level is null or target_level in
      ('intern','entry','mid','senior','staff','principal','manager','director','vp','exec')),
  add column if not exists target_comp_min integer,
  add column if not exists target_comp_max integer,
  add column if not exists target_comp_currency text not null default 'USD',
  add column if not exists target_work_type text
    check (target_work_type is null or target_work_type in ('remote','hybrid','onsite','any')),
  add column if not exists target_locations text[] not null default '{}',
  add column if not exists target_timeline text
    check (target_timeline is null or target_timeline in
      ('asap','3_months','6_months','12_months','exploring')),
  -- Where the target came from. 'stated' = the user typed/edited it (front
  -- door 1). 'discovered' = produced by the "no idea what I want"
  -- conversation (front door 2). 'prep_role' = defaulted from the landing
  -- role picker. 'resume' = an objective line in the resume. Only 'stated'
  -- and 'discovered' should ever overwrite a non-null target.
  add column if not exists target_source text
    check (target_source is null or target_source in ('stated','discovered','prep_role','resume')),
  add column if not exists target_set_at timestamptz,
  add column if not exists years_experience numeric,
  add column if not exists seniority_level text,
  add column if not exists created_at timestamptz not null default now();

-- 2. Story bank -------------------------------------------------------------

create table if not exists career_stories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  situation text,
  task text,
  action text,
  result text,
  -- e.g. {'leadership','conflict','ambiguity'} - matched against
  -- question_archetypes later so prep can pull the right story.
  competencies text[] not null default '{}',
  -- 'star' | 'mock' | 'practice' | 'resume' | 'user'
  source text not null default 'user',
  source_conversation_id uuid,
  -- 'draft' = extracted, not yet reviewed by the user; 'ready' = user
  -- confirmed or wrote it; 'archived' = user hid it.
  status text not null default 'draft' check (status in ('draft','ready','archived')),
  quality_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists career_stories_user_idx on career_stories (user_id, status);

-- 3. Opportunities ----------------------------------------------------------

create table if not exists career_opportunities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company text,
  role_title text not null,
  -- 'pasted_jd' | 'adzuna' | 'user'
  source text not null default 'user',
  external_id text,
  url text,
  jd_text text,
  fit_score numeric,
  fit_reasons jsonb not null default '[]'::jsonb,
  -- Current stage, denormalised from career_outcomes for cheap listing.
  stage text not null default 'considering' check (stage in
    ('considering','applied','screening','interviewing','offer','accepted','rejected','withdrawn','hired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists career_opportunities_user_idx on career_opportunities (user_id, stage, updated_at desc);
create unique index if not exists career_opportunities_external_idx
  on career_opportunities (user_id, source, external_id) where external_id is not null;

-- 4. Outcomes (append-only) -------------------------------------------------

create table if not exists career_outcomes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  opportunity_id uuid references career_opportunities(id) on delete set null,
  kind text not null check (kind in
    ('applied','recruiter_screen','interview','final_round','offer','accepted',
     'rejected','withdrew','hired','started_role','promoted','comp_change','left_role')),
  -- 'self_reported' | 'ezzy_flow' (e.g. the user hit "I applied" inside
  -- a flow) | 'inferred'. Referral-fee logic must only ever trust
  -- self_reported/ezzy_flow rows that also have a confirmed opportunity.
  source text not null default 'self_reported' check (source in ('self_reported','ezzy_flow','inferred')),
  -- Free-form structured extras: {comp: 185000, currency: 'USD', level: 'senior', note: '...'}
  detail jsonb not null default '{}'::jsonb,
  occurred_at date not null default current_date,
  created_at timestamptz not null default now()
);

create index if not exists career_outcomes_user_idx on career_outcomes (user_id, occurred_at desc);
create index if not exists career_outcomes_opportunity_idx on career_outcomes (opportunity_id);

-- Keep the denormalised stage on the opportunity in step with the latest
-- outcome event, so the client never has to compute it.
create or replace function career_outcomes_sync_stage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stage text;
begin
  if new.opportunity_id is null then
    return new;
  end if;
  v_stage := case new.kind
    when 'applied' then 'applied'
    when 'recruiter_screen' then 'screening'
    when 'interview' then 'interviewing'
    when 'final_round' then 'interviewing'
    when 'offer' then 'offer'
    when 'accepted' then 'accepted'
    when 'rejected' then 'rejected'
    when 'withdrew' then 'withdrawn'
    when 'hired' then 'hired'
    when 'started_role' then 'hired'
    else null
  end;
  if v_stage is not null then
    update career_opportunities
      set stage = v_stage, updated_at = now()
      where id = new.opportunity_id and user_id = new.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists career_outcomes_sync_stage_trg on career_outcomes;
create trigger career_outcomes_sync_stage_trg
  after insert on career_outcomes
  for each row execute function career_outcomes_sync_stage();

-- 5. Decisions log ----------------------------------------------------------

create table if not exists career_decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in
    ('choose_target','take_offer','apply','negotiate','leave_role','other')),
  question text not null,
  -- [{label, pros: [...], cons: [...]}]
  options jsonb not null default '[]'::jsonb,
  chosen text,
  reasoning text,
  status text not null default 'open' check (status in ('open','decided','revisited')),
  opportunity_id uuid references career_opportunities(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists career_decisions_user_idx on career_decisions (user_id, status, created_at desc);

-- RLS + grants ----------------------------------------------------------------
-- Same pattern as 0001 + 0008: RLS on, own-rows-only, explicit grants so the
-- policies are actually reachable from the anon-key REST endpoint.

alter table career_stories enable row level security;
alter table career_opportunities enable row level security;
alter table career_outcomes enable row level security;
alter table career_decisions enable row level security;

create policy "career_stories: read own" on career_stories for select using (auth.uid() = user_id);
create policy "career_stories: write own" on career_stories for insert with check (auth.uid() = user_id);
create policy "career_stories: update own" on career_stories for update using (auth.uid() = user_id);
create policy "career_stories: delete own" on career_stories for delete using (auth.uid() = user_id);

create policy "career_opportunities: read own" on career_opportunities for select using (auth.uid() = user_id);
create policy "career_opportunities: write own" on career_opportunities for insert with check (auth.uid() = user_id);
create policy "career_opportunities: update own" on career_opportunities for update using (auth.uid() = user_id);
create policy "career_opportunities: delete own" on career_opportunities for delete using (auth.uid() = user_id);

-- Outcomes are append-only from the client: no update policy. A wrong entry
-- is deleted and re-entered, which keeps the log honest for later fee logic.
create policy "career_outcomes: read own" on career_outcomes for select using (auth.uid() = user_id);
create policy "career_outcomes: write own" on career_outcomes for insert with check (auth.uid() = user_id);
create policy "career_outcomes: delete own" on career_outcomes for delete using (auth.uid() = user_id);

create policy "career_decisions: read own" on career_decisions for select using (auth.uid() = user_id);
create policy "career_decisions: write own" on career_decisions for insert with check (auth.uid() = user_id);
create policy "career_decisions: update own" on career_decisions for update using (auth.uid() = user_id);
create policy "career_decisions: delete own" on career_decisions for delete using (auth.uid() = user_id);

grant select, insert, update, delete on career_stories to authenticated;
grant select, insert, update, delete on career_opportunities to authenticated;
grant select, insert, delete on career_outcomes to authenticated;
grant select, insert, update, delete on career_decisions to authenticated;
