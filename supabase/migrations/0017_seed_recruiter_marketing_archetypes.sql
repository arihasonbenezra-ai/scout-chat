-- Fills the two roles that had zero dedicated archetypes: Recruiter and
-- Marketing (both now real top-level role-picker pills). Same editorial
-- sourcing and format as 0015, same jsonb_to_recordset approach (plain
-- JSON needs no apostrophe escaping, unlike hand-typed SQL string
-- literals - see 0015's revision history for why that matters).
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

  if not exists (select 1 from question_archetypes where title = 'Filling a hard-to-fill role') then
    insert into question_archetypes
      (source_id, interview_type, role, competency, title, example_questions, testing_for, strong_evidence, failure_modes, likely_followups, status, confidence)
    select
      v_editorial_source_id, x.interview_type, x.role, x.competency, x.title,
      x.example_questions, x.testing_for, x.strong_evidence, x.failure_modes, x.likely_followups,
      x.status, x.confidence
    from jsonb_to_recordset($json$
[
  {"interview_type":"behavioral","role":"Recruiter","competency":"Sourcing & Pipeline Building","title":"Filling a hard-to-fill role",
   "example_questions":["Tell me about a time you filled a role with a very small talent pool.","How do you build a candidate pipeline when there's almost no inbound interest?"],
   "testing_for":["sourcing creativity","market knowledge","persistence","resourcefulness"],
   "strong_evidence":["uses multiple channels beyond job boards (referrals, passive outreach, communities)","tracks and can quote pipeline health, not just gut feel","adapts the approach specifically to that role's talent market"],
   "failure_modes":["relies only on inbound applicants and job postings","no measurable process or numbers to point to","gives up quickly on a hard search instead of adapting"],
   "likely_followups":["What was your fill rate or time-to-fill?","Which channel actually worked?","What would you do differently next time?"],
   "status":"opinion","confidence":0.8},
  {"interview_type":"behavioral","role":"Recruiter","competency":"Candidate Experience & Stakeholder Management","title":"Managing a difficult hiring manager or candidate situation",
   "example_questions":["Tell me about a time you had to manage a difficult hiring manager.","Describe a time a candidate had a bad experience - what happened and what did you do?"],
   "testing_for":["stakeholder management","communication","candidate advocacy","conflict resolution"],
   "strong_evidence":["balances the candidate's and hiring manager's needs rather than picking a side","sets expectations proactively instead of reactively","names a specific process change made afterward"],
   "failure_modes":["blames the hiring manager or candidate entirely with no self-reflection","vague description with no concrete resolution"],
   "likely_followups":["How did you push back, specifically?","What would you do differently?","Did the relationship change afterward?"],
   "status":"opinion","confidence":0.8},
  {"interview_type":"behavioral","role":"Recruiter","competency":"Screening Judgment","title":"Evaluating a hire that didn't work out",
   "example_questions":["Tell me about a hire that didn't work out - what did you miss?","How do you evaluate a candidate who looks great on paper but you're unsure about after the interview?"],
   "testing_for":["judgment","structured evaluation","self-awareness","calibration"],
   "strong_evidence":["uses explicit criteria rather than pure gut feel","distinguishes must-haves from nice-to-haves","reflects honestly on what signal was missed"],
   "failure_modes":["refuses to acknowledge any past hiring mistake","no structured criteria, purely instinct-based"],
   "likely_followups":["What signal did you miss?","How did that change your process since?"],
   "status":"opinion","confidence":0.75},
  {"interview_type":"behavioral","role":"Marketing","competency":"Campaign Strategy & Measurement","title":"A campaign that missed its goal",
   "example_questions":["Tell me about a campaign you ran that didn't hit its goal.","How do you decide which channels to invest in?"],
   "testing_for":["strategic thinking","data literacy","prioritization","accountability"],
   "strong_evidence":["ties channel choice to a specific goal and audience, not just intuition","names the actual metric used to judge success or failure","explains a concrete change made after the miss"],
   "failure_modes":["cites vanity metrics (impressions, likes) with no tie to a business outcome","no clear hypothesis behind why a channel was chosen"],
   "likely_followups":["What was the ROI?","How did you know it wasn't working?","What would you change next time?"],
   "status":"opinion","confidence":0.8},
  {"interview_type":"behavioral","role":"Marketing","competency":"Cross-functional Collaboration","title":"Disagreement with Sales or Product on messaging",
   "example_questions":["Tell me about a time marketing and sales disagreed on messaging.","Describe working with product on a launch that had competing priorities."],
   "testing_for":["collaboration","communication","influence without authority"],
   "strong_evidence":["describes a concrete process used to reach alignment","names a specific compromise or decision, not just 'we talked it out'","a positive, checkable outcome"],
   "failure_modes":["describes the conflict with no real resolution","one-sided blame with no acknowledgment of the other side's point"],
   "likely_followups":["How was it actually resolved?","What did you learn about working with that team?"],
   "status":"opinion","confidence":0.75},
  {"interview_type":"case","role":"Marketing","competency":"Messaging & Positioning Judgment","title":"Positioning a product against a competitor",
   "example_questions":["How would you position this product against a competitor?","Tell me about a piece of messaging you had to defend or change."],
   "testing_for":["customer empathy","competitive awareness","communication clarity"],
   "strong_evidence":["grounds positioning in a specific customer insight or competitive gap, not just adjectives","explains the tradeoffs considered before landing on the message"],
   "failure_modes":["generic, buzzword-driven answer with no customer or competitive grounding"],
   "likely_followups":["What data or research backed that?","How did the audience actually respond?"],
   "status":"opinion","confidence":0.75}
]
$json$::jsonb)
    as x(interview_type text, role text, competency text, title text, example_questions jsonb, testing_for jsonb, strong_evidence jsonb, failure_modes jsonb, likely_followups jsonb, status text, confidence numeric);
  end if;
end $$;
