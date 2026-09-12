-- Company Research is the single biggest unnecessary Anthropic cost in the
-- app today: every request re-runs a full web-search-enabled Sonnet call,
-- even when ten different users ask about the same company. This caches
-- the initial brief (the first message of a research conversation) keyed
-- by company + role, with a freshness window - follow-up questions in the
-- same conversation still go live every time, since those are genuinely
-- per-conversation and don't benefit from caching the same way.
--
-- Locked down to service_role only (like anon_rate_limit/subscriptions) -
-- unlike the knowledge base tables, nothing here needs public anon read
-- access, and allowing open writes would let a client overwrite another
-- company's cached brief with garbage.

create table if not exists company_research_cache (
  id uuid primary key default gen_random_uuid(),
  company_key text not null,
  role_key text not null,
  company text not null,
  role text not null,
  brief text not null,
  created_at timestamptz not null default now(),
  unique (company_key, role_key)
);

alter table company_research_cache enable row level security;

grant select, insert, update on company_research_cache to service_role;
