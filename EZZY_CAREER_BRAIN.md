# The Career Brain — Data Model (v0 → v1)

Design goal: a **structured, evolving model of the individual**, built from evidence, that today's product (resume paste, Practice/STAR/Mock transcripts) can already start feeding — without requiring the user to fill out a giant form (directive §9) and without requiring a graph database (see [EZZY_ARCHITECTURE.md](EZZY_ARCHITECTURE.md) §2).

## Core principle: evidence-first typing

Every claim the Career Brain holds about a user carries a **status**, not just a value:

- `fact` — the user stated it directly ("I led a team of 12").
- `inference` — Ezzy derived it from evidence with reasonable confidence ("appears to be strong at cross-functional leadership, based on 3 examples").
- `hypothesis` — Ezzy suspects it but has thin evidence ("may prefer IC roles — only 1 data point").
- `unknown` — explicitly not yet known (used so the UI can say "I don't know yet" rather than silently omitting a field).

This status lives on every claim, alongside a confidence score and the evidence that produced it, so the product can honor directive §7/§27: never present an inference as a fact, and let the user inspect/correct anything Ezzy believes.

## v0 schema (Phase 1 — buildable now, on top of the existing Supabase project)

```sql
-- One row per user; the "identity" layer. Most fields nullable/unknown by default.
create table career_profile (
  user_id uuid primary key references auth.users(id),
  career_stage text,          -- e.g. 'early-career', 'ic-senior', 'manager' — inferred, not asked
  current_role_title text,  -- "current_role" is reserved in Postgres (CURRENT_ROLE)
  current_industry text,
  updated_at timestamptz default now()
);

-- Every discrete claim about the user's experience, skills, achievements, goals, preferences.
-- One table, differentiated by `claim_type`, rather than five near-identical tables — keeps
-- the extraction pipeline uniform (one upsert path) while still being fully relational.
create table career_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  claim_type text not null check (claim_type in
    ('experience','skill','achievement','goal','preference','hypothesis')),
  label text not null,              -- e.g. 'Python', 'Led onboarding redesign', 'Wants Staff PM role'
  status text not null check (status in ('fact','inference','hypothesis','unknown')),
  confidence numeric,                -- 0-1, null for plain facts
  detail jsonb default '{}',         -- claim-specific structured fields, see below
  evidence jsonb default '[]',       -- array of {source, quote, session_id, date}
  contradictory_evidence jsonb default '[]',
  first_seen_at timestamptz default now(),
  last_seen_at timestamptz default now(),
  source_count int default 1
);

create index on career_claims (user_id, claim_type);
-- RLS: user_id = auth.uid() on both tables, same pattern as existing conversations/messages.
```

`detail` shape by `claim_type` (kept in JSONB rather than more tables — cheap to extend without a migration for every new nuance):

- **skill**: `{proficiency: 'beginner'|'intermediate'|'advanced', recency: '2026-08', market_demand: 'high'|'medium'|'low'|null}`
- **experience**: `{company, title, start_date, end_date, scope, team_size, impact}`
- **achievement**: `{metric: 'revenue'|'cost_saved'|'users_impacted'|'team_size'|'other', value, unit}`
- **goal**: `{dimension: 'role'|'industry'|'company'|'compensation'|'location'|'timeline', value}`
- **preference**: `{dimension: 'company_stage'|'culture'|'management_style'|'work_type', value, polarity: 'likes'|'dislikes'}`

Why one `career_claims` table instead of the five+ separate tables (skills, achievements, goals, preferences, hypotheses) implied by the directive: every one of those needs the same evidence/confidence/status machinery, and the extraction pipeline needs to write to exactly one place regardless of what it just learned. Splitting them into five tables today is speculative normalization with no present benefit — split a `claim_type` out into its own table later only if it grows enough distinct structured columns to warrant it (e.g. if `experience` needs real querying by date range at scale).

## Where v0 data comes from (no new user burden)

| Source | What gets extracted |
|---|---|
| Resume paste (`resume` mode) | experience, skills, achievements — already the richest structured source and already flowing through the product today, untouched |
| Practice / STAR answers | skills demonstrated, achievements mentioned, communication patterns |
| Mock interview transcripts | behavioral competencies, weak/strong areas per the existing debrief the model already generates but currently throws away |
| Explicit corrections (Phase 1.5 "What Ezzy Knows" panel) | promotes/demotes `status`, adds `contradictory_evidence` |

No LinkedIn import, no connected accounts, no onboarding form — all deferred until there's a reason to believe users want to connect more sources (start with what the product already collects).

## v1 additions (Phase 2+, only once v0 is live and being read back to users)

- **Readiness dimensions** (directive §11) as a derived view over `career_claims`, not a new source of truth: e.g. "Interview Readiness" = a rollup of Mock/Practice competency claims with recency weighting. Store the computed snapshot (`readiness_snapshots(user_id, dimension, score, confidence, computed_at)`) so the longitudinal chart (§17) is cheap to render without recomputing history.
- **Career hypotheses as first-class** (directive §6): already representable via `claim_type = 'hypothesis'` in v0 — v1 just adds a UI surface and a "confirm/reject" action that flips status to `fact` or deletes the claim.
- **Target-role relevance scoring** on skills (directive's `Python` example) — only meaningful once there's an actual target role signal (a `goal` claim with `dimension = 'role'`) to score relevance against; don't build this column before that dependency exists.

## Explicitly deferred to Phase 3+

- **Market Brain linkage** (market_demand per skill, compensation positioning) — requires an external data source that doesn't exist yet (see EZZY_ARCHITECTURE.md §5). The `market_demand` field above is left in the schema as `null`-able so it can be populated later without a migration, but nothing should compute it in Phase 1.
- **Career graph traversal queries** ("people with your background who wanted this role usually needed X") — needs a large cross-user corpus of outcomes that doesn't exist yet; premature before there are enough users and enough tracked outcomes to make any cohort statistically meaningful.
