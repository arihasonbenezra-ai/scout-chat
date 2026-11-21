-- The three tables that predate the migrations (conversations, messages,
-- profiles) were only ever granted to authenticated. The server's
-- service role could not read or delete them, which broke session
-- removal and left those rows behind on account deletion. Applied by
-- Ari in the SQL editor on 2026-11-21.
grant select, insert, update, delete on public.conversations to service_role;
grant select, insert, update, delete on public.messages to service_role;
grant select, insert, update, delete on public.profiles to service_role;
