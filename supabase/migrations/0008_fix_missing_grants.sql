-- RLS policies alone don't grant SQL-level privileges - Postgres requires
-- both a base GRANT and a passing RLS policy for a request to succeed.
-- Tables created via the SQL editor (all of ours) don't get the automatic
-- grants that Supabase's Table Editor UI applies, which is why
-- career_claims (and friends) were returning 403 instead of enforcing RLS
-- as intended. Granted verbs match exactly the policies each table already
-- has - nothing here is newly permissive, it just makes the existing
-- policies actually reachable.

grant select, insert, update on career_profile to authenticated;
grant select, insert, update, delete on career_claims to authenticated;
grant select, insert, delete on resume_gap_analyses to authenticated;
grant select on subscriptions to authenticated;
