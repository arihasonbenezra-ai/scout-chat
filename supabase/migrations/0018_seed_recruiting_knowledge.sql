-- Fills out the 'recruiting' category, which had only one seed item (from
-- 0013) and wasn't wired into anything yet. This is what api/chat.js
-- (resume mode) and api/gap-analysis.js now draw on - see the app code
-- changes in the same commit as this migration for how it's used.
--
-- Same editorial sourcing/format as 0015/0017, same jsonb_to_recordset
-- approach for safety.
--
-- Guarded so re-running this file doesn't duplicate rows.

do $$
declare
  v_editorial_source_id uuid;
begin
  select id into v_editorial_source_id from knowledge_sources
    where title = 'Ezzy Editorial - Interview Fundamentals';
  if v_editorial_source_id is null then
    insert into knowledge_sources (title, source_type, content, is_current)
    values (
      'Ezzy Editorial - Interview Fundamentals',
      'editorial',
      'Internally authored by Ezzy from well-established, publicly-known interview-coaching practice.',
      true
    )
    returning id into v_editorial_source_id;
  end if;

  if not exists (select 1 from knowledge_items where topic = 'quantified_impact') then
    insert into knowledge_items (source_id, category, subject, topic, claim, status, confidence, evidence)
    select v_editorial_source_id, x.category, x.subject, x.topic, x.claim, x.status, x.confidence, x.evidence
    from jsonb_to_recordset($json$
[
  {"category":"recruiting","subject":null,"topic":"quantified_impact",
   "claim":"A resume bullet with a quantified outcome (a number, percentage, or dollar amount) reads as stronger evidence of impact than a list of responsibilities, since responsibilities describe a job while a measured outcome describes a result.",
   "status":"opinion","confidence":0.85,
   "evidence":[{"quote":"editorial synthesis of standard resume-screening practice"}]},
  {"category":"recruiting","subject":null,"topic":"tailoring_to_jd",
   "claim":"A resume tailored to the specific job description - mirroring its key terms and leading with the most relevant experience - typically screens better than one generic resume sent to every role.",
   "status":"opinion","confidence":0.85,
   "evidence":[{"quote":"editorial synthesis of standard resume-screening practice"}]},
  {"category":"recruiting","subject":null,"topic":"ats_keyword_matching",
   "claim":"Many companies use an applicant tracking system that filters or ranks resumes by keyword match against the job description before a human reads them, so omitting the JD's core terms entirely can hurt a candidate even if they actually have the skill.",
   "status":"opinion","confidence":0.8,
   "evidence":[{"quote":"editorial synthesis of common applicant-tracking-system behavior"}]},
  {"category":"recruiting","subject":null,"topic":"career_progression_narrative",
   "claim":"Recruiters and hiring managers commonly scan a resume for a clear narrative of increasing scope, seniority, or complexity over time, not just a list of past job titles.",
   "status":"opinion","confidence":0.8,
   "evidence":[{"quote":"editorial synthesis of standard resume-screening practice"}]},
  {"category":"recruiting","subject":null,"topic":"action_verbs",
   "claim":"A bullet that opens with a strong, specific action verb naming what the candidate actually did reads as more credible than one that opens with a weak or passive phrase like \"responsible for\" or \"helped with\".",
   "status":"opinion","confidence":0.75,
   "evidence":[{"quote":"editorial synthesis of standard resume-writing guidance"}]},
  {"category":"recruiting","subject":null,"topic":"scope_matching_seniority",
   "claim":"For a given seniority level, resumes are commonly screened for evidence of scope that matches that level - team size led, budget owned, systems or users impacted - rather than years of experience alone.",
   "status":"opinion","confidence":0.8,
   "evidence":[{"quote":"editorial synthesis of standard leveling/screening practice"}]},
  {"category":"recruiting","subject":null,"topic":"ownership_signal",
   "claim":"Language that shows ownership of an outcome (\"drove\", \"led\", \"owned\") is generally read as a stronger signal than language that only shows participation (\"worked on\", \"contributed to\") for the same piece of work.",
   "status":"opinion","confidence":0.75,
   "evidence":[{"quote":"editorial synthesis of standard resume-screening practice"}]}
]
$json$::jsonb) as x(category text, subject text, topic text, claim text, status text, confidence numeric, evidence jsonb);
  end if;
end $$;
