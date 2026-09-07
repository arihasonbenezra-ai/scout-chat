-- Career Brain v0: identity layer + evidence-tagged claims.
-- See EZZY_CAREER_BRAIN.md for the design rationale.
--
-- Run this against the Supabase project used by index.html
-- (project ref peksgdlfrnymkzlrbsgi) via the SQL editor or `supabase db push`.

create table if not exists career_profile (
  user_id uuid primary key references auth.users(id) on delete cascade,
  career_stage text,
  current_role_title text,
  current_industry text,
  updated_at timestamptz not null default now()
);

create table if not exists career_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  claim_type text not null check (claim_type in
    ('experience', 'skill', 'achievement', 'goal', 'preference', 'hypothesis')),
  label text not null,
  status text not null check (status in ('fact', 'inference', 'hypothesis', 'unknown')),
  confidence numeric,
  detail jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  contradictory_evidence jsonb not null default '[]'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  source_count int not null default 1,
  unique (user_id, claim_type, label)
);

create index if not exists career_claims_user_idx on career_claims (user_id, claim_type);

alter table career_profile enable row level security;
alter table career_claims enable row level security;

create policy "career_profile: read own" on career_profile
  for select using (auth.uid() = user_id);
create policy "career_profile: write own" on career_profile
  for insert with check (auth.uid() = user_id);
create policy "career_profile: update own" on career_profile
  for update using (auth.uid() = user_id);

create policy "career_claims: read own" on career_claims
  for select using (auth.uid() = user_id);
create policy "career_claims: write own" on career_claims
  for insert with check (auth.uid() = user_id);
create policy "career_claims: update own" on career_claims
  for update using (auth.uid() = user_id);
create policy "career_claims: delete own" on career_claims
  for delete using (auth.uid() = user_id);
