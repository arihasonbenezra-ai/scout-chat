-- Posted pay: the salary range a company prints in its own posting, read
-- from the job-board feed at sync time. Only what the posting states is
-- stored; nothing here is estimated. comp_text keeps the sentence the
-- numbers came from so the UI can show it as "posted" and link to it.
alter table job_listings
  add column if not exists comp_min numeric,
  add column if not exists comp_max numeric,
  add column if not exists comp_currency text,
  add column if not exists comp_interval text check (comp_interval in ('year','hour')),
  add column if not exists comp_source text check (comp_source in ('structured','posting_text')),
  add column if not exists comp_text text;

-- Roles for you filters on "shows pay" and the market view groups by family
-- and level over recent listings.
create index if not exists job_listings_comp_idx
  on job_listings (active, family, level) where comp_min is not null;
