# Ezzy UX Strategy — Evolution, Not Replacement

## What's already working — preserve it

- **Focused single-mode chat.** Five clear entry points (Practice, STAR, Mock, Resume, Research) beat a generic chat box or an overwhelming dashboard. Directive §28 warns against "endless chat" and "generic dashboards" — the current mode picker already avoids both. Don't replace it with a big daily-coach dashboard on day one; layer onto it instead (see below).
- **Onboarding personalization touch** (asking "what should I call you?" mid-session rather than as a cold signup form) is a small, well-judged detail — keep it.
- **PDF export of resume feedback** — a concrete, useful artifact the user leaves with.
- **The "one coach" brand promise** — worth protecting precisely because it's not fully true yet (see below); the fix is to make the product match the claim, not to soften the claim.

## What feels unfinished or overstated today

- **"Remembers your sessions" is narrower than it sounds.** In reality: one persistent conversation *per mode*, no cross-mode memory, no session history list. A user who does a Mock Interview Monday and comes back Wednesday for Resume Feedback gets zero continuity between them. This is the single biggest gap between the marketing promise and the product (see [EZZY_PRODUCT_AUDIT.md](EZZY_PRODUCT_AUDIT.md) §E5).
- **"Get the comp data that matters"** is marketing copy for a feature that doesn't exist in the code at all. Either build a minimal version or remove the claim — shipping neither is the worst of both options.
- **Company Research is Beta and thin** (single web-search-backed brief) relative to how prominently it's positioned as a pillar alongside Practice/Mock/Resume.

## Near-term UX additions (tied directly to Career Brain v0)

1. **"What Ezzy knows about you" panel** (directive §27): even a short list — 3–5 skills, 1–2 achievements, inferred career stage, each tagged fact/inference/hypothesis with an evidence quote and a [Correct] / [Remove] action — turns the abstract "career brain" idea into something a user can see and trust after a single resume paste. This is the highest-impact, lowest-cost UX addition available right now because the backing data (EZZY_CAREER_BRAIN.md) is the first thing Phase 1 builds anyway.
2. **Cross-mode continuity nudges**, not a full history browser: e.g. entering Practice mode when Ezzy already has a Mock Interview debrief on file: "Last time in Mock, structure was your weakest area — want to focus there today?" Small, evidence-backed, and it's the first real instance of the brand promise being true.
3. **Narrow or fulfill the comp-data claim.** Recommend narrowing the landing-page copy now (cheap, immediate, honest) and treat "comp intelligence" as a Phase 3 feature gated on an actual data source — not something to fake with unsourced LLM guesses, which would directly violate the trust principle in directive §26.

## What NOT to build yet, and why

- **A daily-coach homepage** ("here's what I think you should do next," directive §20) needs a real backlog of things to prioritize (upcoming interviews, tracked weaknesses, open goals) — none of which exist as structured data today. Building the daily-coach *UI* before Career Brain v0 exists would just be another layer of hardcoded copy pretending to be personalized, which is exactly the "AI generated some stuff for you" feeling directive §28 warns against. Sequence: Career Brain v0 → one real nudge (#2 above) → only then a dedicated "today" surface, once there's more than one nudge to prioritize.
- **Career Missions / 8-week adaptive plans** (§21) and **proactive notifications** (§22) both require infrastructure (email/push, a planning engine) that isn't justified until it's proven people come back to see what Ezzy has learned about them at all.
- **A big multidimensional readiness dashboard** (§11) — right, eventually, but a "Readiness: 72%, biggest constraint: technical fluency" card is only trustworthy once there's evidence behind each dimension. Ship it after the readiness snapshot computation in EZZY_CAREER_BRAIN.md v1 exists, not before.

## North star, unchanged

Every new surface should answer one of: *understand me, tell me what matters, tell me what to do, help me do it, tell me if I'm improving* (directive §29). The concrete near-term test for anything on this list: can it point to a specific evidence-backed claim in the Career Brain, or is it generic copy dressed up as insight? If the latter, it isn't ready to ship yet.
