-- Opportunities flow. A pasted posting becomes a career_opportunities row
-- scored against the whole profile (latest resume, claims, profile fields).
-- `posting` holds what the posting itself states (location, work type,
-- level, comp range, the extracted requirements) so the detail view can
-- show it without re-reading the JD. fit_reasons keeps the per-requirement
-- matched / partial / missing rows, as 0020 intended.

alter table career_opportunities
  add column if not exists posting jsonb not null default '{}'::jsonb;
