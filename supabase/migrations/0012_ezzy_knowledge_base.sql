-- Ezzy Knowledge Base v0: a small, shared (not per-user) knowledge layer
-- that Ezzy's interview-prep prompt can draw on, separate from the
-- per-user career_claims table. Same evidence/confidence/status philosophy
-- as career_claims (see 0001_career_brain_v0.sql) - deliberately not a new
-- philosophical model, just applied to external knowledge instead of a
-- candidate's own history.
--
-- Two tables only:
--   knowledge_sources - provenance for anything ingested (what/where/when).
--   knowledge_items    - structured claims derived from a source, the thing
--                        actually retrieved into prompts.
--
-- Both are shared/public content (curated interview & career knowledge, not
-- personal data), so RLS allows broad read access but writes only via
-- service_role (the ingestion function), unlike career_claims which is
-- locked to auth.uid() = user_id in both directions.

create table if not exists knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  url text,
  title text,
  domain text,
  source_type text not null check (source_type in
    ('official_company_page', 'news', 'industry_guide', 'editorial', 'other')),
  published_at timestamptz,
  retrieved_at timestamptz not null default now(),
  content text,
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists knowledge_items (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references knowledge_sources(id) on delete set null,
  category text not null check (category in ('interview', 'recruiting', 'company', 'career')),
  subject text,
  topic text,
  claim text not null,
  status text not null check (status in ('fact', 'inference', 'opinion')),
  confidence numeric,
  evidence jsonb not null default '[]'::jsonb,
  last_verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  search_vector tsvector generated always as (
    to_tsvector('english', coalesce(subject, '') || ' ' || coalesce(topic, '') || ' ' || claim)
  ) stored
);

create index if not exists knowledge_items_category_idx on knowledge_items (category, subject);
create index if not exists knowledge_items_search_idx on knowledge_items using gin (search_vector);

alter table knowledge_sources enable row level security;
alter table knowledge_items enable row level security;

-- Curated, non-personal content - readable by anyone the app already talks
-- to (anon key included), same way pricing/plan info isn't locked down.
create policy "knowledge_sources: public read" on knowledge_sources
  for select using (true);
create policy "knowledge_items: public read" on knowledge_items
  for select using (true);

-- No insert/update/delete policies for anon/authenticated - only
-- service_role (which bypasses RLS) can write, via the ingestion function.
grant select on knowledge_sources to anon, authenticated;
grant select on knowledge_items to anon, authenticated;
grant select, insert, update, delete on knowledge_sources to service_role;
grant select, insert, update, delete on knowledge_items to service_role;
