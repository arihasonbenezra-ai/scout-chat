-- Question archetypes: the structured "what is this question actually
-- testing" entity from the interview-intelligence design. Deliberately one
-- new table, not five - interview_type/role/competency are free-text
-- columns (same pattern as knowledge_items.category/subject) rather than
-- separate lookup tables, so adding a new interview type, role, or
-- competency is just inserting a row, never a schema change.
--
-- Reuses knowledge_sources for provenance - no separate "documents" table.

create table if not exists question_archetypes (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references knowledge_sources(id) on delete set null,
  interview_type text not null,
  role text,
  competency text not null,
  title text not null,
  example_questions jsonb not null default '[]'::jsonb,
  testing_for jsonb not null default '[]'::jsonb,
  strong_evidence jsonb not null default '[]'::jsonb,
  failure_modes jsonb not null default '[]'::jsonb,
  likely_followups jsonb not null default '[]'::jsonb,
  status text not null check (status in ('fact', 'inference', 'opinion')) default 'opinion',
  confidence numeric,
  created_at timestamptz not null default now(),
  search_vector tsvector generated always as (
    to_tsvector('english', coalesce(role, '') || ' ' || competency || ' ' || title)
  ) stored
);

create index if not exists question_archetypes_type_role_idx on question_archetypes (interview_type, role);
create index if not exists question_archetypes_search_idx on question_archetypes using gin (search_vector);

alter table question_archetypes enable row level security;

create policy "question_archetypes: public read" on question_archetypes
  for select using (true);

grant select on question_archetypes to anon, authenticated;
grant select, insert, update, delete on question_archetypes to service_role;
