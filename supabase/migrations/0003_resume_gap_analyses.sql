-- Append-only history of resume-vs-job gap analyses, so a new resume
-- review doesn't erase the previous one's results (see EZZY_CAREER_BRAIN.md
-- discussion of the conversations table's overwrite-in-place behavior).

create table if not exists resume_gap_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  jd_text text,
  requirements jsonb not null default '[]'::jsonb,
  gaps jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists resume_gap_analyses_user_idx on resume_gap_analyses (user_id, created_at desc);

alter table resume_gap_analyses enable row level security;

create policy "resume_gap_analyses: read own" on resume_gap_analyses
  for select using (auth.uid() = user_id);
create policy "resume_gap_analyses: write own" on resume_gap_analyses
  for insert with check (auth.uid() = user_id);
create policy "resume_gap_analyses: delete own" on resume_gap_analyses
  for delete using (auth.uid() = user_id);
