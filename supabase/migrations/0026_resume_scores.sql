-- Resume scorecard. Same engine as the prep scorecard (0023): per-dimension
-- scores each tied to a verbatim quote from the resume, verified server-side,
-- overall computed in code. Rubric rows live in scoring_rubrics under the
-- 'Resume' family so Ari can edit anchors without a deploy. Scores go in
-- their own table: a resume score is not interview readiness and must not
-- show up as one on the dashboard.

insert into scoring_rubrics (family, roles, dimension, kind, weight, anchor_5, anchor_3, anchor_1, source, sort) values
('Resume','Every resume','Quantified impact','core',3,'Most bullets carry a number or concrete outcome tied to what the candidate did (revenue, time saved, hires, pass-through rate).','Some numbers, or outcomes stated without numbers; impact is there but a screener has to infer it.','Responsibilities only ("responsible for", "worked on"). No outcomes anywhere.','Ari',1),
('Resume','Every resume','Ownership and scope','core',2,'Clear what the candidate personally owned, at what scale: team size, budget, volume, systems, regions.','Ownership is guessable but scope is vague; "led" and "supported" blur together.','Cannot tell what they owned versus what the team did, or how big any of it was.','Ari',2),
('Resume','Every resume','Relevance to the target','core',3,'The top third of the resume speaks directly to the target role (or the posting, when given): title, summary, and first bullets match what a screener for that role looks for.','Relevant experience exists but is buried below less relevant material, or the headline points somewhere else.','A screener for the target role would not see the fit without hunting for it.','Ari',3),
('Resume','Every resume','Specificity','core',2,'Names companies, tools, methods, and timeframes. A reader could check any line.','Some specifics, some generic filler ("various stakeholders", "multiple projects").','Generic throughout. Could be anyone''s resume.','Ari',4),
('Resume','Every resume','Scannability','core',1,'Tight bullets, consistent structure, strongest line first in each role. Readable in a six-second skim.','Some long paragraphs or inconsistent formatting; the good lines are findable with effort.','Dense blocks, inconsistent sections, no hierarchy. A screener would skip it.','Ari',5)
on conflict (family, dimension) do nothing;

create table if not exists resume_scores (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text,
  has_posting boolean not null default false,
  -- [{dimension, weight, score (1-5 or null), evidence_quote, verified, improvement}]
  dimensions jsonb not null default '[]'::jsonb,
  overall numeric,               -- 0-10, one decimal; null when fewer than 3 dimensions verified
  scored_dims int not null default 0,
  total_dims int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists resume_scores_user_idx on resume_scores (user_id, created_at desc);
alter table resume_scores enable row level security;
create policy "resume_scores: read own" on resume_scores for select using (auth.uid() = user_id);
grant select on resume_scores to authenticated;
grant select, insert on resume_scores to service_role;
