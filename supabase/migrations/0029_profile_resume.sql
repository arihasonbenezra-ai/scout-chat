-- The resume on file. Until now the only copy of a resume lived on the
-- resume-review conversation, so someone who dropped their resume at
-- onboarding (which only extracts claims) had nothing for the opportunity
-- verdict and written fixes to read: both told them to run a review first.
-- api/extract.js now writes every resume it reads here, so the profile
-- always carries the latest resume Ezzy has seen, from any entry point.

alter table career_profile
  add column if not exists resume_text text,
  add column if not exists resume_updated_at timestamptz;
