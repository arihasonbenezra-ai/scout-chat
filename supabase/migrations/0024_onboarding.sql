-- First-visit onboarding on the Career plan. The dashboard shows a two-step
-- card (resume, then target) until the profile has something in it or the
-- person finishes/skips; onboarded_at is what stops it coming back.

alter table career_profile
  add column if not exists onboarded_at timestamptz;
