# Job source seed data (Active search)

Mapped 2026-10-04 from Ari's 400-company target list (target_companies_*.txt).

| File | What | Status |
|---|---|---|
| job_sources.json | 185 companies on open job-board feeds (Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Rippling). `ats` + `slug` per company. | Cleared to use. These feeds are published for other software to read. |
| job_sources_careers_pages.json | 140 companies reachable only through their careers page's own data calls (Workday, Oracle, Eightfold, Avature, in-house). `solid` = clean JSON/XML; `fragile` = sitemaps or HTML that needs parsing. | NOT approved. Public data, but not an offered feed, and some sites' terms forbid automated access. Ari decides, ideally after legal advice. Do not build ingestion on this file without his go. |
| job_sources_unreachable.json | `blocked` (site refused automated requests; left alone), `not_found`, and `excluded` (answered only with spoofed or guessed headers; never use). | Do not retry with evasion. |

Each company was verified with a live request that returned real postings for that company. Role counts are a snapshot and several Workday totals are capped at 2,000.
