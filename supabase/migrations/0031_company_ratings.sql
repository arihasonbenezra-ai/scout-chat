-- Employer ratings (Glassdoor, Indeed, Blind) for a company, found by web
-- search and kept only when the number appears in the cited page text.
-- One row per company, refreshed after 30 days. Written by the service
-- role from api/company-ratings.js; the browser reads through that
-- endpoint, never this table.
create table if not exists company_ratings (
  company_key text primary key,
  company text not null,
  ratings jsonb not null default '[]'::jsonb,
  checked_at timestamptz not null default now()
);

alter table company_ratings enable row level security;

grant select, insert, update on company_ratings to service_role;
