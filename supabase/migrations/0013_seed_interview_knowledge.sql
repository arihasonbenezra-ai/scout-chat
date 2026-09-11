-- Seed data to prove the retrieval -> prompt injection path end-to-end.
--
-- These items are Ezzy-authored (well-established, publicly-known
-- interview-coaching practice), not scraped from a specific external site -
-- see the chat conversation this shipped from for why: real ingestion was
-- attempted against a couple of real pages first and blocked by bot
-- protection, so this seed exists to prove the pipeline works today without
-- fabricating a citation to content that was never actually fetched. The
-- ingestion function (api/ingest-knowledge.js) is fully built and ready to
-- populate this table for real from any URL that's actually approved and
-- fetched - swap in real sources there whenever.
--
-- Guarded so re-running this migration file doesn't duplicate rows.

do $$
declare
  v_source_id uuid;
begin
  if exists (select 1 from knowledge_sources where title = 'Ezzy Editorial - Interview Fundamentals') then
    return;
  end if;

  insert into knowledge_sources (title, source_type, content, is_current)
  values (
    'Ezzy Editorial - Interview Fundamentals',
    'editorial',
    'Internally authored by Ezzy from well-established, publicly-known interview-coaching practice. Not derived from a single external document - proves the retrieval pipeline while real source ingestion is set up.',
    true
  )
  returning id into v_source_id;

  insert into knowledge_items (source_id, category, subject, topic, claim, status, confidence, evidence) values
  (v_source_id, 'interview', null, 'star_method',
   'Behavioral interview answers are strongest when structured as Situation, Task, Action, Result (STAR); the most common weakness is skipping straight to actions without stating a concrete, measurable result.',
   'opinion', 0.9, '[{"quote":"editorial synthesis of standard STAR interviewing practice"}]'::jsonb),

  (v_source_id, 'interview', null, 'individual_contribution',
   'Interviewers commonly probe behavioral answers with a follow-up like "what was your specific role" because candidates often default to "we" when describing team achievements, obscuring their individual contribution.',
   'opinion', 0.85, '[{"quote":"editorial synthesis of common interviewer follow-up patterns"}]'::jsonb),

  (v_source_id, 'interview', 'Product Manager', 'product_sense',
   'Product Manager interviews commonly include a "product sense" question (e.g. "how would you improve product X") that evaluates user empathy, prioritization logic, and the ability to define success metrics - not just a clever final answer.',
   'opinion', 0.85, '[{"quote":"editorial synthesis of standard PM interview loop structure"}]'::jsonb),

  (v_source_id, 'interview', 'Product Manager', 'prioritization',
   'Strong Product Manager candidates justify prioritization tradeoffs with an explicit framework (e.g. impact vs. effort, or a stated set of goals) rather than an unstructured gut call.',
   'opinion', 0.8, '[{"quote":"editorial synthesis of standard PM interview evaluation criteria"}]'::jsonb),

  (v_source_id, 'interview', 'Software Engineer', 'technical_communication',
   'In technical interviews, thinking out loud - stating assumptions and tradeoffs before and while coding - is typically weighted as heavily as arriving at a correct final solution.',
   'opinion', 0.85, '[{"quote":"editorial synthesis of standard technical interview evaluation practice"}]'::jsonb),

  (v_source_id, 'interview', 'Software Engineer', 'system_design',
   'System design interviews commonly evaluate whether a candidate clarifies requirements and scale constraints before proposing an architecture, rather than jumping straight to a solution.',
   'opinion', 0.8, '[{"quote":"editorial synthesis of standard system design interview practice"}]'::jsonb),

  (v_source_id, 'recruiting', null, 'resume_screening',
   'Resume screeners typically spend well under a minute on a first pass, so the top third of a resume (most recent or most relevant role) carries disproportionate weight in whether it gets a full read.',
   'opinion', 0.75, '[{"quote":"editorial synthesis of common resume-screening behavior"}]'::jsonb);
end $$;
