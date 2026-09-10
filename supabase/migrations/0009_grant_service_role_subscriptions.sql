-- The webhook writes to subscriptions directly via a REST call using the
-- service-role key (not through one of the SECURITY DEFINER RPC functions,
-- which don't need this since they run with the function owner's
-- privileges regardless of the caller's grants). service_role typically
-- bypasses RLS, but RLS-bypass and table-level GRANTs are separate things -
-- it still needs the base privilege to touch the table at all.

grant select, insert, update on public.subscriptions to service_role;
