# Ezzy Product & Technical Audit

Scope: this audit reflects the actual state of the `scout-chat` repo (deployed as meetezzy.com) as of 2026-09-07, verified by reading the source and the live site — not the aspirational description in the directive that prompted it.

## A. Current product architecture

Ezzy today is **one static HTML file** (`index.html`, ~1,800 lines: markup, CSS, and all JS inline) plus **one Vercel Edge Function** (`api/chat.js`), deployed as project `scout-chat`.

- **Frontend**: no framework, no build step, no bundler. Vanilla JS with global `var`s (`ROLE`, `TRAINER_MODE`, `RESUME_TEXT`, `convoHistory`, …) mirrored onto `window` for cross-`<script>`-block access.
- **Backend**: `api/chat.js` is a thin proxy — it takes any POST body and forwards it verbatim to `https://api.anthropic.com/v1/messages` using a server-side `ANTHROPIC_API_KEY`, streaming the response back. It does not construct prompts, does not enforce a model allowlist, and does not check who is calling it.
- **Auth + persistence**: Supabase (Postgres + Auth), called directly from the browser with the public anon key. Google OAuth + email/password sign-in.
- **AI**: direct Claude Messages API calls (`claude-haiku-4-5`, `claude-sonnet-4-5`), one tool (`web_search_20250305`) enabled only in Research mode.
- **No** billing/Stripe, **no** analytics (no gtag/PostHog/Mixpanel/Segment), **no** CI, **no** tests, **no** `.gitignore`, **no** schema migrations in the repo (schema lives only in the live Supabase project).

## B. Current user journey

1. Landing page (marketing copy: "Meet your AI career coach") → **Try Ezzy**.
2. Intent picker: **Resume Review / Interview Prep / Company Research** (Beta).
3. Interview Prep expands into 4 sub-modes: **Practice Q&A, STAR Coaching, Mock Interview, Resume Feedback** is really its own top-level intent, and **Company Research** is the 5th. So there are 5 modes total: `practice`, `star`, `mock`, `resume`, `research`.
4. User chats inside the chosen mode. After some usage, an onboarding overlay asks for a first name (used for personalization + Supabase `profiles.name`).
5. If signed in, the conversation for that **(user, mode, role)** triple is upserted to Supabase on every message. There is one persistent "slot" per mode+role — not a list of past sessions.
6. Sign-out shows a "see you soon" overlay; anonymous progress is bridged into the account on first sign-up via `localStorage['ezzy_anon_pending']`.

There is no dashboard, no session history list, and no way to see or resume a *specific* past session — only "continue where you left off" for whichever single conversation exists per mode+role.

## C. Current AI architecture

- Prompts are hardcoded strings, built client-side per mode (e.g. `RESUME_SYSTEM`, the Practice/STAR/Mock instructions, the Research brief format). They live in the HTML in plain view (view-source reveals every system prompt).
- Model selection is a 2-line if/else: Haiku for Practice/STAR, Sonnet for Mock/Resume/Research.
- The client calls `api/chat.js`, which blindly relays to Anthropic. **The model, system prompt, tools, and message history in every request are fully attacker-controlled** — see Weakness #1 below.
- No extraction, scoring, embeddings, or vector search of any kind exists. Nothing produced by these conversations is turned into structured data — it's stored as raw message rows and nothing more.

## D. Current data model — what Ezzy knows about the user today

Supabase tables (inferred from client calls, since no migrations exist in-repo):

- `profiles(id, name)` — just a first name.
- `conversations(id, user_id, mode, role, resume_text, jd_text, resume_stage, research_company, research_stage, updated_at)` — one row per (user, mode, role).
- `messages(id, conversation_id, user_id, role, content)` — raw transcript.

That's it. **There is no skills table, no achievements, no goals, no preferences, no evidence, no readiness score, nothing resembling a "Career Brain."** The only persistent signal about a person is: their first name, whatever resume text they last pasted, and raw chat transcripts. Nothing is extracted or structured from any of it. The "remembers your sessions" claim on the landing page is true only in the narrow sense of "resumes the same single thread per mode" — it is not memory of the person.

## E. Major weaknesses (prioritized)

1. **Open, unauthenticated AI proxy — live cost/abuse risk.** `api/chat.js` has no session check, no rate limit, `Access-Control-Allow-Origin: *`, and forwards any request body to Anthropic using the site's own API key. Anyone who finds the endpoint (trivial — it's called from public JS) can use it as a free, unauthenticated Claude proxy at the owner's expense, with any model/prompt/tool they like. This is not a future risk, it is exploitable on the live site right now and should be fixed independent of any roadmap.
2. **No persistent user model.** The entire "career coach that knows you" premise has zero foundation today — there's a name and a pasted resume string, nothing structured.
3. **No analytics/telemetry.** There is no way to know activation, retention, drop-off by mode, or whether any given change helps or hurts. Every product decision right now is a guess.
4. **No tests, no CI, single 1,800-line inline-everything file.** The commit history shows repeated "fix race condition," "fix typo," "fix mangled block" commits — direct evidence that the current architecture is already fragile to change. `.bak.*` files and a one-off `fix.py` script in the working tree show the team has been hand-patching via file copies rather than relying on version control safety nets.
5. **Marketing overstates the product.** The landing page promises "get the comp data that matters" and positions Company Research as a core pillar — Research mode is Beta-tagged, comp/compensation data is not implemented anywhere in the code, and "remembers your sessions" doesn't mean what a visitor would assume.
6. **No schema-as-code.** The Supabase schema exists only in the live database; there are no migration files in the repo, so it can't be reproduced, reviewed, or rolled back safely.
7. **No user data controls despite storing sensitive data.** Resume text, JD text, and full interview transcripts are stored in plaintext with no export/delete/view UI for the user (relevant given interview performance and resume content are sensitive).
8. **No `.gitignore`.** `.env.local` isn't tracked today, but that's luck, not policy — there's nothing stopping a future secret from being committed.

## F. Major opportunities (prioritized)

1. **Career Brain v0**: extract structured skills/achievements/goals from resume text and mock/practice transcripts that already flow through the system today. This is the single highest-leverage change — the raw material is already being collected and thrown away.
2. **"What Ezzy knows about you" panel**: even a v0 profile becomes a trust-building, differentiating surface with very little new infra.
3. **Cross-mode continuity**: today, Practice and Mock and Resume are 3 unrelated conversations. Even light continuity ("you mentioned leading a team of 12 in Mock last week — want to turn that into a STAR story?") would materially change the "one coach" feel the brand promises.
4. **Interview performance over time**: the transcripts already exist; adding a scoring extraction pass turns "did I get better?" from unanswerable into a real, evidence-backed line chart.
5. **Analytics instrumentation**: prerequisite to validating literally everything else on this list.

## G. Technical debt

- Single-file, no-build, global-mutable-state architecture. Workable at current scope, but every one of the "F" opportunities above requires new server-side logic (extraction calls, new tables) that this architecture can absolutely still support — the debt is about *safety of change* (no tests/CI), not about needing a rewrite.
- The open proxy (E1) is also a technical-debt item: it exists because the proxy was built as "make streaming work" without an auth layer, not by design.
- No environment separation (single Supabase project, presumably prod-only) — risky for testing schema/extraction changes.

## H. Recommended architecture

See [EZZY_ARCHITECTURE.md](EZZY_ARCHITECTURE.md). Headline: **do not rewrite.** Keep the static-HTML-plus-edge-function shape, keep Supabase, keep direct Anthropic calls. Add: proxy authentication, a Career Brain schema (relational + JSONB evidence, not a graph database), a server-side extraction step, and basic instrumentation. Introduce modularization (splitting the HTML file) only if/when it starts blocking velocity — it is not blocking anything today.

## I. Recommended roadmap

See [EZZY_ROADMAP.md](EZZY_ROADMAP.md).
