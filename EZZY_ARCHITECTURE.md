# Ezzy Recommended Architecture

Principle: this is an **evolution**, not a rewrite. Every recommendation below is scoped to what Phase 1–2 of the roadmap actually needs. Anything from the original directive that implies infrastructure Phase 1–2 doesn't need (graph databases, multi-agent orchestration, a market-scraping pipeline) is deliberately deferred — see "What we are explicitly not building yet."

## 1. Close the open proxy (do this first, independent of everything else)

**Problem it solves**: `api/chat.js` currently accepts any request and forwards it to Anthropic with the site's API key — no auth, no rate limit, `Access-Control-Allow-Origin: *`. This is a live cost/abuse exposure, not a hypothetical one.

**Fix**: require a valid Supabase session JWT (verify with the Supabase project's JWT secret or `auth.getUser()` server-side) before proxying, restrict `Access-Control-Allow-Origin` to the real origin, and constrain the forwarded body to an allowlist of models/fields the app actually uses (don't relay the client's body verbatim). Add a basic per-user rate limit (even an in-memory/edge-KV sliding window is enough at current scale).

- **Data model**: none new.
- **Dependencies**: Supabase server-side verification (already have the JS client; add `@supabase/ssr` or manual JWT verification).
- **Failure modes**: unauthenticated requests now correctly 401 instead of silently costing money.
- **Cost implications**: this *saves* money — it is the fix for an active leak.
- **Migration strategy**: none needed, it's additive validation in one file.
- **Testing strategy**: manual curl test with/without a valid token before and after deploy.

## 2. Career Brain v0 as relational tables + JSONB evidence, not a graph database

**Problem it solves**: today there is no structured user model at all — see [EZZY_CAREER_BRAIN.md](EZZY_CAREER_BRAIN.md) for the schema.

**Why relational, not graph**: the directive's "Career Graph" concept (Person → Experience → Skills → Achievements → Competencies → Target Roles → Companies) is real and worth designing for, but at current data volumes (a handful of tables, single-digit-thousands of rows at most) a graph database (Neo4j, etc.) adds an entire new operational dependency, deployment target, and query language for zero present benefit. Postgres with foreign keys plus JSONB `evidence` columns expresses the same relationships and is queryable with plain SQL joins. Revisit graph infrastructure only if/when the traversal queries ("find people whose profile resembles X") become a real, frequent product need — not before.

- **Data model**: see EZZY_CAREER_BRAIN.md.
- **APIs**: new Supabase tables, read/written via the existing Supabase JS client — no new API layer needed.
- **Dependencies**: none beyond what's already provisioned (Supabase).
- **Failure modes**: extraction writes bad/duplicate data — mitigate with an idempotent upsert keyed on (user_id, claim_type, normalized_claim) and a confidence-merge rule rather than blind insert.
- **Cost implications**: negligible storage cost; the real cost is the extraction LLM calls (see AI architecture doc — use Haiku).
- **Security/privacy**: this table stores the same class of sensitive data (resume/skills/goals) already stored today in `conversations.resume_text` — no new privacy tier, but it does mean more places PII lives, so RLS policies (`user_id = auth.uid()`) must be applied to every new table, same as presumably exists on `conversations`/`messages` today (verify this — it wasn't visible from the client code and should be confirmed directly in Supabase).
- **Migration strategy**: write these as actual SQL migration files checked into the repo (`/supabase/migrations/`) — today's schema exists only live in Supabase with no source-of-truth in git, which should be fixed as part of this work regardless of Career Brain.
- **Testing strategy**: seed a fixture user + fixture resume, assert the extraction produces the expected rows.

## 3. Extraction as a distinct AI call type, not part of the chat call

**Problem it solves**: today, Claude only ever talks *to* the user. Nothing turns a conversation into structured facts.

**Design**: after a resume paste, or at natural checkpoints in Practice/STAR/Mock (e.g. every 3rd exchange, or on mode-exit), fire a second, separate Claude call (Haiku, cheap, JSON-mode/structured-output) whose only job is "extract any new skills/achievements/goals/preferences mentioned in this exchange, with a confidence and a quote as evidence." This is a **server-side** call (add a small `api/extract.js` Edge Function alongside `api/chat.js`), not a client-side one, so extraction prompts aren't visible/tamperable the way today's coaching prompts are.

- See [EZZY_AI_ARCHITECTURE.md](EZZY_AI_ARCHITECTURE.md) for full detail.

## 4. Basic analytics

**Problem it solves**: no visibility into activation/retention/mode usage today.

**Design**: add a minimal, privacy-conscious event log — either a lightweight self-hosted table (`events(user_id, event_name, mode, created_at, metadata jsonb)`) written via the existing Supabase client, or a hosted product-analytics tool (PostHog has a generous free tier and a simple client SDK) if the team wants funnels/retention charts without building them. Given the team is small, a hosted tool is the pragmatic choice; the in-house `events` table is the fallback if they'd rather not add a third-party script.

## 5. What we are explicitly not building yet

- **Graph database** — deferred, see above.
- **Multi-agent orchestration framework** (the "8 agents" architecture in the original directive) — with one small proxy and one small team, a handful of distinct prompts/call-types (coach, extractor, matcher — added one at a time as phases land) achieves the same outcome without the coordination overhead of an agent framework. Revisit only if/when there are genuinely parallel, long-running, tool-using workflows (e.g. autonomous job discovery) that a simple function call can't express.
- **Market Brain / job scraping pipeline** — this is a standalone data-acquisition product (scraping job boards/company pages raises real ToS and legal questions, and labor-market/compensation data are normally licensed from a vendor, not scraped). Do not build this until Phase 3, and even then, start with user-pasted job descriptions (zero acquisition cost, zero legal exposure) before ever considering autonomous discovery.
- **Vector search/embeddings** — not needed until there's a corpus large enough to need semantic retrieval (e.g. matching a user against thousands of ingested job descriptions). A handful of structured tables and direct SQL filters cover Phase 1–3.
- **New frontend framework/rewrite** — the single-file app is not what's limiting the roadmap below; don't spend the first month of "career brain" work re-platforming the UI instead of shipping the actual feature.

## 6. Environments

Add a second Supabase project (or at minimum a separate schema) for development, so schema changes for Career Brain v0 can be tested without touching production user data. This is a prerequisite for #2 above, not optional.
