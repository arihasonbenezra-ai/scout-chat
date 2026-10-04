-- Resume screening rules from Ari's "Ezzy Resume Screening Rules" sheet
-- (2026-10-03; all 19 rows confirmed by him). Loaded into the shared
-- knowledge base under category 'recruiting'; subject is the role family
-- the rule applies to, null for every resume. api/chat.js (resume mode)
-- pulls these by family and the review cites the source by name.
--
-- Same jsonb_to_recordset pattern as 0018. Guarded by topic so re-running
-- this file doesn't duplicate rows. To update a rule later: edit the sheet,
-- then update the matching row's claim here or in the table.

do $$
declare
  v_source_id uuid;
begin
  select id into v_source_id from knowledge_sources
    where title = 'Ezzy resume screening rules';
  if v_source_id is null then
    insert into knowledge_sources (title, source_type, content, is_current)
    values (
      'Ezzy resume screening rules',
      'other',
      'How a screener reads a resume: rules written and confirmed by Ezzy''s founder in the Ezzy Resume Screening Rules sheet (2026-10-03).',
      true
    )
    returning id into v_source_id;
  end if;

  insert into knowledge_items (source_id, category, subject, topic, claim, status, confidence, evidence)
  select v_source_id, x.category, x.subject, x.topic, x.claim, x.status, x.confidence, x.evidence
  from jsonb_to_recordset('[
  {
    "category": "recruiting",
    "subject": null,
    "topic": "screen_the_top_third_of_the_first_page_decides_whether",
    "claim": "The top third of the first page decides whether the rest gets read. Title, summary line, and the first two bullets of the current role carry the screen.",
    "status": "opinion",
    "confidence": 0.85,
    "evidence": [
      {
        "source": "Ari Ben Ezra",
        "note": "First pass is a skim, not a read."
      }
    ]
  },
  {
    "category": "recruiting",
    "subject": null,
    "topic": "screen_a_bullet_that_starts_with_a_duty_responsible_for",
    "claim": "A bullet that starts with a duty (\"Responsible for\", \"Worked on\") is read as a duty. A bullet that starts with the outcome and a number is read as impact. Lead with the outcome.",
    "status": "opinion",
    "confidence": 0.85,
    "evidence": [
      {
        "source": "Ari Ben Ezra",
        "note": "Confirmed by Ari from the screening-rules sheet, 2026-10-03"
      }
    ]
  },
  {
    "category": "recruiting",
    "subject": null,
    "topic": "screen_a_current_title_that_does_not_match_the_target_r",
    "claim": "A current title that does not match the target role gets filtered before a human reads the resume. A one-line summary naming the target role and its scope fixes that without changing the title.",
    "status": "opinion",
    "confidence": 0.85,
    "evidence": [
      {
        "source": "Ari Ben Ezra",
        "note": "Confirmed by Ari from the screening-rules sheet, 2026-10-03"
      }
    ]
  },
  {
    "category": "recruiting",
    "subject": null,
    "topic": "screen_various_multiple_numerous_are_read_as_i_do_not",
    "claim": "\"Various\", \"multiple\", \"numerous\" are read as \"I do not remember, or it was not much\". Replace each with the count.",
    "status": "opinion",
    "confidence": 0.85,
    "evidence": [
      {
        "source": "Ari Ben Ezra",
        "note": "Confirmed by Ari from the screening-rules sheet, 2026-10-03"
      }
    ]
  },
  {
    "category": "recruiting",
    "subject": null,
    "topic": "screen_a_skills_list_longer_than_about_12_items_stops_b",
    "claim": "A skills list longer than about 12 items stops being read. The ones that matter belong inside the experience bullets, where they did something.",
    "status": "opinion",
    "confidence": 0.85,
    "evidence": [
      {
        "source": "Ari Ben Ezra",
        "note": "Confirmed by Ari from the screening-rules sheet, 2026-10-03"
      }
    ]
  },
  {
    "category": "recruiting",
    "subject": null,
    "topic": "screen_the_most_recent_role_gets_most_of_the_attention",
    "claim": "The most recent role gets most of the attention. Roles older than eight years shrink to one or two lines each.",
    "status": "opinion",
    "confidence": 0.85,
    "evidence": [
      {
        "source": "Ari Ben Ezra",
        "note": "Confirmed by Ari from the screening-rules sheet, 2026-10-03"
      }
    ]
  },
  {
    "category": "recruiting",
    "subject": null,
    "topic": "screen_after_three_years_of_experience_education_goes_l",
    "claim": "After three years of experience, education goes last unless the role requires the credential.",
    "status": "opinion",
    "confidence": 0.85,
    "evidence": [
      {
        "source": "Ari Ben Ezra",
        "note": "Confirmed by Ari from the screening-rules sheet, 2026-10-03"
      }
    ]
  },
  {
    "category": "recruiting",
    "subject": null,
    "topic": "screen_a_gap_or_a_short_stint_gets_noticed_either_way_o",
    "claim": "A gap or a short stint gets noticed either way. One honest line beats letting the screener guess.",
    "status": "opinion",
    "confidence": 0.85,
    "evidence": [
      {
        "source": "Ari Ben Ezra",
        "note": "Confirmed by Ari from the screening-rules sheet, 2026-10-03"
      }
    ]
  },
  {
    "category": "recruiting",
    "subject": "People & Talent",
    "topic": "screen_a_recruiter_resume_with_no_funnel_numbers_reqs_c",
    "claim": "A recruiter resume with no funnel numbers (reqs carried, hires per quarter, time to fill, offer-accept rate) reads as coordinator level regardless of title.",
    "status": "opinion",
    "confidence": 0.85,
    "evidence": [
      {
        "source": "Ari Ben Ezra",
        "note": "Confirmed by Ari from the screening-rules sheet, 2026-10-03"
      }
    ]
  },
  {
    "category": "recruiting",
    "subject": "People & Talent",
    "topic": "screen_agency_to_in_house_lead_with_ramp_speed_hiring_m",
    "claim": "Agency to in-house: lead with ramp speed, hiring-manager partnership, and quality of hire, not placement volume or billings.",
    "status": "opinion",
    "confidence": 0.85,
    "evidence": [
      {
        "source": "Ari Ben Ezra",
        "note": "Confirmed by Ari from the screening-rules sheet, 2026-10-03"
      }
    ]
  },
  {
    "category": "recruiting",
    "subject": "People & Talent",
    "topic": "screen_name_the_functions_and_levels_hired_senior_to_st",
    "claim": "Name the functions and levels hired (\"senior to staff engineers, ML and infra\"). \"Technical recruiting\" alone does not tell a hiring manager whether you have closed their kind of candidate.",
    "status": "opinion",
    "confidence": 0.85,
    "evidence": [
      {
        "source": "Ari Ben Ezra",
        "note": "Confirmed by Ari from the screening-rules sheet, 2026-10-03"
      }
    ]
  },
  {
    "category": "recruiting",
    "subject": "People & Talent",
    "topic": "screen_tools_greenhouse_lever_ashby_linkedin_recruiter",
    "claim": "Tools (Greenhouse, Lever, Ashby, LinkedIn Recruiter, Gem) belong in the bullet where they did something, not only in a skills list.",
    "status": "opinion",
    "confidence": 0.85,
    "evidence": [
      {
        "source": "Ari Ben Ezra",
        "note": "Confirmed by Ari from the screening-rules sheet, 2026-10-03"
      }
    ]
  },
  {
    "category": "recruiting",
    "subject": "People & Talent",
    "topic": "screen_process_ownership_built_the_interview_loop_score",
    "claim": "Process ownership (built the interview loop, scorecards, intake, leveling) is what separates a senior recruiter from a senior-titled sourcer on paper.",
    "status": "opinion",
    "confidence": 0.85,
    "evidence": [
      {
        "source": "Ari Ben Ezra",
        "note": "Confirmed by Ari from the screening-rules sheet, 2026-10-03"
      }
    ]
  },
  {
    "category": "recruiting",
    "subject": "Engineering",
    "topic": "screen_scale_words_need_numbers_users_requests_per_seco",
    "claim": "Scale words need numbers: users, requests per second, data volume, team size. \"High scale\" with no number is discounted.",
    "status": "opinion",
    "confidence": 0.85,
    "evidence": [
      {
        "source": "Ari Ben Ezra",
        "note": "Confirmed by Ari from the screening-rules sheet, 2026-10-03"
      }
    ]
  },
  {
    "category": "recruiting",
    "subject": "Engineering",
    "topic": "screen_say_which_systems_were_owned_end_to_end_and_whic",
    "claim": "Say which systems were owned end to end and which were contributed to. When it is ambiguous, the screener assumes the smaller claim.",
    "status": "opinion",
    "confidence": 0.85,
    "evidence": [
      {
        "source": "Ari Ben Ezra",
        "note": "Confirmed by Ari from the screening-rules sheet, 2026-10-03"
      }
    ]
  },
  {
    "category": "recruiting",
    "subject": "Go-to-market",
    "topic": "screen_sales_quota_attainment_by_period_118_of_a_1_2m_q",
    "claim": "Sales: quota attainment by period (\"118% of a $1.2M quota, FY2025\") is the first thing a screener looks for. Missing it is read as below quota.",
    "status": "opinion",
    "confidence": 0.85,
    "evidence": [
      {
        "source": "Ari Ben Ezra",
        "note": "Confirmed by Ari from the screening-rules sheet, 2026-10-03"
      }
    ]
  },
  {
    "category": "recruiting",
    "subject": "Go-to-market",
    "topic": "screen_marketing_pipeline_or_revenue_influenced_beats_e",
    "claim": "Marketing: pipeline or revenue influenced beats engagement metrics. Name the channel and the number.",
    "status": "opinion",
    "confidence": 0.85,
    "evidence": [
      {
        "source": "Ari Ben Ezra",
        "note": "Confirmed by Ari from the screening-rules sheet, 2026-10-03"
      }
    ]
  },
  {
    "category": "recruiting",
    "subject": "Product / Design / Ops",
    "topic": "screen_product_a_shipped_thing_with_a_measured_result_a",
    "claim": "Product: a shipped thing with a measured result and the decision the PM made. A feature list with no outcomes reads as project management.",
    "status": "opinion",
    "confidence": 0.85,
    "evidence": [
      {
        "source": "Ari Ben Ezra",
        "note": "Confirmed by Ari from the screening-rules sheet, 2026-10-03"
      }
    ]
  },
  {
    "category": "recruiting",
    "subject": "Product / Design / Ops",
    "topic": "screen_design_name_the_research_done_and_the_metric_tha",
    "claim": "Design: name the research done and the metric that moved, and link the portfolio. No portfolio link is a pass for most design screeners.",
    "status": "opinion",
    "confidence": 0.85,
    "evidence": [
      {
        "source": "Ari Ben Ezra",
        "note": "Confirmed by Ari from the screening-rules sheet, 2026-10-03"
      }
    ]
  }
]'::jsonb)
    as x(category text, subject text, topic text, claim text, status text, confidence numeric, evidence jsonb)
  where not exists (select 1 from knowledge_items k where k.topic = x.topic);
end $$;
