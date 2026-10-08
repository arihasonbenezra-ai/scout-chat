-- Roles for you: let the browser ask for the newest roles *in one place*
-- instead of the newest 400 overall, and sort roles with no post date
-- (Rippling feeds publish none) by when Ezzy first saw them rather than
-- dropping them to the end.
--
-- shown_at: posted date, or first-seen date when the feed has none.
alter table job_listings
  add column if not exists shown_at timestamptz
  generated always as (coalesce(posted_at, first_seen_at)) stored;
create index if not exists job_listings_shown_idx on job_listings (active, shown_at desc);

-- One call per target title: how many open roles match the head word in
-- all, remote, and the person's own places, plus every place and level
-- that appears. The browser builds the filter chips from this, then loads
-- rows for the chosen filter only.
create or replace function role_summary(q text, places text[] default '{}')
returns json
language sql stable
as $$
  with m as (
    select location, remote, level from job_listings
    where active and title_tsv @@ websearch_to_tsquery('english', q)
  )
  select json_build_object(
    'all', (select count(*) from m),
    'remote', (select count(*) from m where remote),
    'mine', (select count(*) from m where exists (
      select 1 from unnest(coalesce(places, '{}')) pl where pl <> '' and m.location ilike '%' || pl || '%')),
    'places', (select coalesce(json_agg(json_build_object('location', location, 'n', n)), '[]'::json)
      from (select location, count(*) n from m where location is not null group by location order by n desc limit 400) s),
    'levels', (select coalesce(json_object_agg(level, n), '{}'::json)
      from (select level, count(*) n from m where level is not null group by level) s)
  );
$$;
revoke execute on function role_summary(text, text[]) from public;
grant execute on function role_summary(text, text[]) to authenticated, service_role;
