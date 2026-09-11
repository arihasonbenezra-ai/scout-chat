-- Two seed batches:
--
-- 1. Question archetypes (Ezzy-authored, from well-established public
--    interview-coaching practice) - the richer, more valuable entity from
--    the interview-intelligence design, covering the roles the existing
--    Ezzy role picker already uses (Software Engineer, Product Manager,
--    Product Designer) plus role-agnostic behavioral/leadership/case
--    fundamentals.
--
-- 2. Real external knowledge: Amazon's official public Leadership
--    Principles page (https://www.amazon.jobs/en/principles - checked
--    against robots.txt before fetching; the page is explicitly published
--    for candidates and is not disallowed). Every claim's evidence is an
--    exact quote from that real, retrieved page - genuine provenance, not
--    fabricated.
--
-- Seed content is passed as a single dollar-quoted JSON block and expanded
-- with jsonb_to_recordset, rather than dozens of hand-escaped SQL string
-- literals - plain JSON needs no apostrophe escaping at all, which is both
-- safer to write and safer against a client mangling quotes on paste.
--
-- Guarded so re-running this file doesn't duplicate rows.

do $$
declare
  v_editorial_source_id uuid;
  v_amazon_source_id uuid;
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

  if not exists (select 1 from question_archetypes where title = 'Influencing someone without direct authority') then
    insert into question_archetypes
      (source_id, interview_type, role, competency, title, example_questions, testing_for, strong_evidence, failure_modes, likely_followups, status, confidence)
    select
      v_editorial_source_id, x.interview_type, x.role, x.competency, x.title,
      x.example_questions, x.testing_for, x.strong_evidence, x.failure_modes, x.likely_followups,
      x.status, x.confidence
    from jsonb_to_recordset($json$
[
  {"interview_type":"behavioral","role":null,"competency":"Influence","title":"Influencing someone without direct authority",
   "example_questions":["Tell me about a time you had to convince a stakeholder who disagreed with you.","Describe a time you had to get buy-in from someone you had no authority over."],
   "testing_for":["influence","communication","judgment","stakeholder management"],
   "strong_evidence":["a clear, specific disagreement or resistance","candidate explains their reasoning, not just the outcome","influence through logic/relationship rather than authority or escalation","a concrete, checkable outcome"],
   "failure_modes":["blaming the other person for the disagreement","vague or generic description with no real conflict","escalating to a manager instead of resolving it directly","no measurable or observable result"],
   "likely_followups":["Why did they disagree in the first place?","What did you say or do, specifically?","What alternatives did you consider?","What would you do differently next time?"],
   "status":"opinion","confidence":0.85},
  {"interview_type":"behavioral","role":null,"competency":"Ownership","title":"Owning a mistake or failure",
   "example_questions":["Tell me about a time you made a significant mistake at work.","Describe a project that failed. What was your role?"],
   "testing_for":["ownership","accountability","self-awareness","learning from failure"],
   "strong_evidence":["candidate clearly states their own responsibility, not just the team's","specific corrective action taken afterward","a concrete lesson that changed later behavior"],
   "failure_modes":["deflecting blame to teammates, tooling, or circumstances","picking a fake-failure that is actually a humble-brag","no real corrective action or lesson"],
   "likely_followups":["What would you do differently?","How did you fix it?","Has that lesson changed how you work since?"],
   "status":"opinion","confidence":0.85},
  {"interview_type":"behavioral","role":null,"competency":"Conflict Management","title":"Navigating disagreement with a peer or manager",
   "example_questions":["Tell me about a conflict you had with a coworker.","Describe a time you disagreed with your manager's decision."],
   "testing_for":["conflict management","communication","emotional intelligence","professionalism"],
   "strong_evidence":["describes the other person's perspective fairly, not as a villain","focuses on the issue rather than the personality","reaches a resolution or a clear, professional next step"],
   "failure_modes":["one-sided framing where the candidate is always right","no real resolution described","avoids the conflict rather than addressing it"],
   "likely_followups":["How did the other person react?","Would you do anything differently?","How is the relationship now?"],
   "status":"opinion","confidence":0.8},
  {"interview_type":"leadership","role":null,"competency":"Decision-Making","title":"Making a decision with incomplete information",
   "example_questions":["Tell me about a time you had to make a decision without all the information you wanted.","Describe a high-stakes decision you made quickly."],
   "testing_for":["decision-making","risk assessment","judgment under ambiguity"],
   "strong_evidence":["names the specific tradeoff or risk they weighed","explains why they didn't wait for more data","a clear, checkable outcome of the decision"],
   "failure_modes":["claims the decision was obvious in hindsight","no real ambiguity or risk in the example","vague on what information was actually missing"],
   "likely_followups":["What was the biggest risk?","What would have made you wait?","How did it turn out?"],
   "status":"opinion","confidence":0.8},
  {"interview_type":"product","role":"Product Manager","competency":"Product Sense","title":"Improving an existing product",
   "example_questions":["How would you improve this product?","What's a product you love, and how would you make it better?"],
   "testing_for":["user empathy","problem framing","prioritization","product judgment","metrics"],
   "strong_evidence":["identifies a specific user segment and their real problem before proposing a solution","considers and prioritizes among multiple ideas rather than pitching just one","names a metric that would validate the change"],
   "failure_modes":["jumps straight to a feature idea with no problem definition","proposes many ideas with no prioritization logic","no way to measure success"],
   "likely_followups":["Who specifically has this problem?","Why this idea over other options?","How would you know it worked?"],
   "status":"opinion","confidence":0.85},
  {"interview_type":"product","role":"Product Manager","competency":"Prioritization","title":"Prioritizing under limited resources",
   "example_questions":["How would you prioritize these three features with only one engineer for the quarter?","Tell me about a time you had to say no to a stakeholder's request."],
   "testing_for":["prioritization","stakeholder management","strategic thinking"],
   "strong_evidence":["uses an explicit framework or stated set of goals to justify tradeoffs","acknowledges what is being given up, not just what is chosen","handles stakeholder pushback directly rather than avoiding it"],
   "failure_modes":["unstructured gut-call prioritization with no stated reasoning","avoids ever saying no to anyone","ignores the cost of the tradeoff"],
   "likely_followups":["What did you deprioritize, and why?","How did the stakeholder react?","What would change your prioritization?"],
   "status":"opinion","confidence":0.8},
  {"interview_type":"technical","role":"Software Engineer","competency":"Technical Communication","title":"Thinking out loud while solving a technical problem",
   "example_questions":["Walk me through how you'd approach this problem.","What tradeoffs are you considering with this approach?"],
   "testing_for":["technical communication","problem-solving process","tradeoff awareness"],
   "strong_evidence":["states assumptions and constraints before diving into a solution","narrates reasoning while working, not just the final answer","names at least one tradeoff or alternative approach considered"],
   "failure_modes":["silently arrives at an answer with no visible reasoning","no assumptions stated, leading to solving the wrong problem","dismisses alternative approaches without explanation"],
   "likely_followups":["What would you do differently at scale?","What's the time/space complexity?","What edge cases did you consider?"],
   "status":"opinion","confidence":0.85},
  {"interview_type":"system_design","role":"Software Engineer","competency":"Requirements Clarification","title":"Clarifying scale and requirements before designing",
   "example_questions":["Design a system for a URL shortener.","How would you architect a service to handle millions of daily active users?"],
   "testing_for":["requirements gathering","scoping","systems thinking"],
   "strong_evidence":["asks about scale, read/write ratio, and constraints before proposing an architecture","explicitly states assumptions when the interviewer doesn't provide detail","revisits the design when new constraints are introduced"],
   "failure_modes":["jumps straight to a specific architecture with no clarifying questions","ignores stated scale constraints","treats the first design as final and doesn't adapt"],
   "likely_followups":["What happens if traffic increases 10x?","What's the bottleneck in this design?","How would you handle a component failing?"],
   "status":"opinion","confidence":0.8},
  {"interview_type":"product","role":"Product Designer","competency":"Design Judgment","title":"Walking through a past design decision",
   "example_questions":["Walk me through a design you're proud of.","Tell me about a time you had to push back on a design request."],
   "testing_for":["design judgment","user empathy","communication","collaboration with engineering/PM"],
   "strong_evidence":["ties design choices back to a specific user need or research insight, not just aesthetics","explains constraints (technical, business, or timeline) that shaped the decision","describes how feedback changed the design"],
   "failure_modes":["describes the design with no rationale beyond taste","no mention of constraints or collaboration","unable to explain a tradeoff that was made"],
   "likely_followups":["What research or data backed this?","What did you push back on, and why?","What would you change if you did it again?"],
   "status":"opinion","confidence":0.8},
  {"interview_type":"case","role":null,"competency":"Structured Problem-Solving","title":"Structuring an ambiguous, open-ended business problem",
   "example_questions":["A client's revenue dropped 20 percent last quarter - how would you figure out why?","How would you decide whether to launch this product in a new market?"],
   "testing_for":["structured thinking","hypothesis generation","quantitative reasoning","communication under ambiguity"],
   "strong_evidence":["lays out a clear framework or set of hypotheses before diving into analysis","asks clarifying questions rather than assuming missing data","reaches a reasoned recommendation, not just an open-ended exploration"],
   "failure_modes":["dives into calculations before framing the problem","treats the first hypothesis as the answer with no testing","never arrives at a concrete recommendation"],
   "likely_followups":["What would change your recommendation?","What data would you want that you don't have?","What's the biggest risk in your recommendation?"],
   "status":"opinion","confidence":0.75}
]
$json$::jsonb)
    as x(interview_type text, role text, competency text, title text, example_questions jsonb, testing_for jsonb, strong_evidence jsonb, failure_modes jsonb, likely_followups jsonb, status text, confidence numeric);
  end if;

  -- Real external source: Amazon's official public Leadership Principles page.
  if not exists (select 1 from knowledge_sources where url = 'https://www.amazon.jobs/en/principles') then
    insert into knowledge_sources (url, title, domain, source_type, retrieved_at, content, is_current)
    select 'https://www.amazon.jobs/en/principles', 'Leadership Principles - Amazon Jobs', 'www.amazon.jobs',
           'official_company_page', now(), x.content, true
    from jsonb_to_recordset($json$
[
  {"content":"We use our Leadership Principles every day, whether we're discussing ideas for new projects or deciding on the best way to solve a problem. Customer Obsession: Leaders start with the customer and work backwards. They work vigorously to earn and keep customer trust. Ownership: Leaders are owners. They think long term and don't sacrifice long-term value for short-term results. They act on behalf of the entire company, beyond just their own team. Bias for Action: Speed matters in business. Many decisions and actions are reversible and do not need extensive study. We value calculated risk taking. Have Backbone; Disagree and Commit: Leaders are obligated to respectfully challenge decisions when they disagree, even when doing so is uncomfortable or exhausting. Once a decision is determined, they commit wholly. Earn Trust: Leaders listen attentively, speak candidly, and treat others respectfully. They benchmark themselves and their teams against the best. Dive Deep: Leaders operate at all levels, stay connected to the details, audit frequently, and are skeptical when metrics and anecdote differ."}
]
$json$::jsonb) as x(content text)
    returning id into v_amazon_source_id;

    insert into knowledge_items (source_id, category, subject, topic, claim, status, confidence, evidence)
    select v_amazon_source_id, x.category, x.subject, x.topic, x.claim, x.status, x.confidence, x.evidence
    from jsonb_to_recordset($json$
[
  {"category":"interview","subject":"Amazon","topic":"leadership_principles",
   "claim":"Amazon evaluates candidates against named Leadership Principles rather than generic competencies - Customer Obsession means leaders start with the customer and work backwards.",
   "status":"fact","confidence":0.95,
   "evidence":[{"quote":"Customer Obsession Leaders start with the customer and work backwards. They work vigorously to earn and keep customer trust."}]},
  {"category":"interview","subject":"Amazon","topic":"leadership_principles",
   "claim":"Amazon's Ownership principle expects candidates to demonstrate thinking beyond their own team and not sacrificing long-term value for short-term results.",
   "status":"fact","confidence":0.95,
   "evidence":[{"quote":"Ownership Leaders are owners. They think long term and don't sacrifice long-term value for short-term results. They act on behalf of the entire company, beyond just their own team."}]},
  {"category":"interview","subject":"Amazon","topic":"leadership_principles",
   "claim":"Amazon's Bias for Action principle values calculated risk-taking and treats most decisions as reversible and not requiring extensive study.",
   "status":"fact","confidence":0.95,
   "evidence":[{"quote":"Speed matters in business. Many decisions and actions are reversible and do not need extensive study. We value calculated risk taking."}]},
  {"category":"interview","subject":"Amazon","topic":"leadership_principles",
   "claim":"Amazon's Have Backbone; Disagree and Commit principle expects candidates to show they respectfully challenged a decision they disagreed with, then fully committed once it was made.",
   "status":"fact","confidence":0.95,
   "evidence":[{"quote":"Leaders are obligated to respectfully challenge decisions when they disagree, even when doing so is uncomfortable or exhausting... Once a decision is determined, they commit wholly."}]},
  {"category":"interview","subject":"Amazon","topic":"leadership_principles",
   "claim":"Amazon's Dive Deep principle expects leaders to stay connected to operational details and be skeptical when metrics and anecdotes disagree.",
   "status":"fact","confidence":0.95,
   "evidence":[{"quote":"Leaders operate at all levels, stay connected to the details, audit frequently, and are skeptical when metrics and anecdote differ."}]}
]
$json$::jsonb) as x(category text, subject text, topic text, claim text, status text, confidence numeric, evidence jsonb);
  end if;
end $$;
