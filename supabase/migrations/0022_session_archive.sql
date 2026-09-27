-- Past sessions: "Start over" (prep) and "Start a new review" (resume)
-- archive the old conversation instead of deleting it, so paying users
-- keep their prep history and the transcripts stay available as evidence
-- for the story bank.
--
-- The table has a unique key on (user_id, mode, role) - the client relied
-- on it for an upsert - which would make an archived row collide with the
-- new active one. Replace it with a partial unique index over ACTIVE rows
-- only. The one client upsert becomes a lookup-then-write.

alter table conversations
  add column if not exists archived_at timestamptz,
  add column if not exists readiness_score int;

do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.conversations'::regclass and contype = 'u'
  loop
    execute format('alter table conversations drop constraint %I', c.conname);
  end loop;
end $$;

create unique index if not exists conversations_active_unique
  on conversations (user_id, mode, role) where archived_at is null;

create index if not exists conversations_archived_idx
  on conversations (user_id, archived_at desc) where archived_at is not null;
