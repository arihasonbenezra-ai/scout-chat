-- Grounded prep scorecard. The readiness score is no longer a number the
-- model picks: it is computed server-side from per-dimension scores that
-- each carry a verified quote from the candidate's own answers.
--
-- scoring_rubrics: one row per dimension per role family (mirrors Ari's
-- "Ezzy Scoring Rubrics" sheet; edit here without a deploy). 'All' rows
-- apply to every family. prep_scores: one row per completed set.

create table if not exists scoring_rubrics (
  id uuid primary key default gen_random_uuid(),
  family text not null,          -- 'All' | 'Engineering' | 'Product / Design / Ops' | 'Go-to-market' | 'People & Talent' | 'General'
  roles text,                    -- human-readable list of roles covered
  dimension text not null,
  kind text not null default 'family' check (kind in ('core','family')),
  weight int not null default 2 check (weight between 1 and 3),
  anchor_5 text,
  anchor_3 text,
  anchor_1 text,
  source text,
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (family, dimension)
);

alter table scoring_rubrics enable row level security;
grant select on scoring_rubrics to service_role;

insert into scoring_rubrics (family, roles, dimension, kind, weight, anchor_5, anchor_3, anchor_1, source, sort) values
('All','Every role','Specificity','core',2,'Names the company, team, timeframe, and exactly what they personally did.','Real example but missing one of: who, when, or their own part.','"I worked on a project where we improved things." Nothing checkable.','Ari',1),
('All','Every role','Ownership','core',2,'Clear "I did X" with their decisions and why. "We" only for team outcomes.','Mix of I and we; their part is guessable but not stated.','Everything is "we" or "the team". Cannot tell what they owned.','Ari',2),
('All','Every role','Results','core',3,'A number or concrete outcome tied to their action, e.g. "closed 5 FDEs in 2 months at 100% offer-accept."','An outcome without a number, or a number without a clear link to their action.','"It went well" / "my manager was happy." No outcome.','Ari',3),
('All','Every role','Structure','core',1,'Situation, what they did, what happened, in that order. No rambling.','Right pieces, wrong order, or one long detour.','Starts mid-story, circles back, listener has to reconstruct it.','Ari',4),
('Engineering','Software Engineer, Data, ML, Infra, DevOps','Technical judgment','family',2,'Explains why this design over the alternatives, and what broke or surprised them.','Explains the design but not the alternatives considered.','Describes what was built, never why.',null,10),
('Engineering','Software Engineer, Data, ML, Infra, DevOps','Scope','family',2,'Clear about scale, systems touched, and who depended on it.','Some sense of size but vague on dependencies.','Cannot tell if it was a script or a platform.',null,11),
('Product / Design / Ops','Product Manager, Product Designer, UX, Program Mgmt, Operations','Decision quality','family',2,'Shows the evidence behind the call: user data, tradeoffs, what they said no to.','A reason is given but no evidence or tradeoff.','"We decided to" with no reasoning.',null,10),
('Product / Design / Ops','Product Manager, Product Designer, UX, Program Mgmt, Operations','Cross-functional influence','family',2,'Names the teams, the disagreement, and how they moved it.','Names the teams; no real disagreement described.','Everyone just agreed.',null,11),
('Go-to-market','Marketing, Sales, Customer Success','Metrics fluency','family',2,'Pipeline, conversion, CAC, retention (whichever fits) with real numbers.','Names the right metric but no number.','"Engagement went up."',null,10),
('Go-to-market','Marketing, Sales, Customer Success','Customer insight','family',2,'A specific thing learned about the customer and what changed because of it.','An insight stated but nothing changed because of it.','Generic audience talk.',null,11),
('People & Talent','Recruiter, HR, People Ops','Stakeholder management','family',2,'A hiring manager or leader who pushed back, and how they handled it.','Stakeholders mentioned; friction is vague.','No friction anywhere.','Ari',10),
('People & Talent','Recruiter, HR, People Ops','Process & funnel','family',2,'Time-to-hire, offer-accept, pass-through rates: what they changed and the effect.','One metric, or a change with no measured effect.','"I hired a lot of people."','Ari',11)
on conflict (family, dimension) do nothing;

create table if not exists prep_scores (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null,
  role text,
  family text not null,
  -- [{dimension, weight, score (1-5 or null), evidence_quote, verified, improvement}]
  dimensions jsonb not null default '[]'::jsonb,
  overall numeric,               -- 0-10, one decimal; null when fewer than 3 dimensions verified
  scored_dims int not null default 0,
  total_dims int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists prep_scores_user_idx on prep_scores (user_id, created_at desc);
alter table prep_scores enable row level security;
create policy "prep_scores: read own" on prep_scores for select using (auth.uid() = user_id);
grant select on prep_scores to authenticated;
grant select, insert on prep_scores to service_role;
