-- "Is it for you?": the half of fit that is the candidate's to decide.
-- wants: what they want from the next role, in their own words, so a
-- posting can be read against it. Keys: pull, cold, musts, optimizing.
alter table career_profile
  add column if not exists wants jsonb not null default '{}'::jsonb,
  add column if not exists wants_updated_at timestamptz;

-- A talk-it-through conversation belongs to one opportunity.
alter table conversations
  add column if not exists opportunity_id uuid references career_opportunities(id) on delete set null;
create index if not exists conversations_opportunity_idx on conversations (opportunity_id);
