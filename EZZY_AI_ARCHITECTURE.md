# Ezzy AI Architecture — Current State and Recommended Evolution

## Current state

- One call shape: client builds a system prompt string + message history in the browser, POSTs to `api/chat.js`, which relays verbatim to Anthropic's Messages API and streams the response back.
- Model routing is a 2-branch if/else: Haiku for Practice/STAR (cheap, high-frequency, short turns), Sonnet for Mock/Resume/Research (needs more reasoning/quality). This is already the right instinct (directive §24 — "don't use the most expensive model for every request") and should be kept as-is.
- One tool enabled: `web_search_20250305`, only in Research mode.
- System prompts are hardcoded strings inline in the HTML — visible in view-source, not versioned separately from the UI code, and (per the architecture doc's #1 finding) currently overridable by anyone since the proxy doesn't constrain the forwarded body.
- No structured output/JSON mode used anywhere. No extraction, no scoring, no embeddings, no eval harness.

## Recommended evolution

### 1. Keep single-provider, direct Anthropic integration

Do not introduce a multi-provider abstraction layer (LangChain-style provider swapping, directive §24's "swap model providers" goal) right now. There's one provider in use, it works, and the cost of premature abstraction (extra indirection, features lagging the native API) outweighs a hypothetical future switch that isn't currently planned. Revisit only if there's an actual second-provider need (e.g. a specialized speech model for live interview analysis — see §5 below).

### 2. Move prompts server-side as part of closing the open proxy

Once `api/chat.js` requires auth (EZZY_ARCHITECTURE.md §1), move system-prompt construction server-side too: the client should send `{mode, role, userTurn}`, and the server picks/builds the system prompt and model. This closes the prompt-injection/model-override risk that exists today (a caller can currently pass any system prompt or model to the open proxy) and gives a single place to version prompts going forward.

### 3. Add a second call type: extraction, separate from coaching

This is the one genuinely new piece of AI architecture Phase 1 needs. Two distinct call types, both hitting the same Anthropic API, no new infra:

- **Coaching calls** (existing): talk to the user, optimized for conversational quality → Haiku/Sonnet per current routing.
- **Extraction calls** (new): given a completed exchange or a pasted resume, return structured JSON (`{claims: [{claim_type, label, status, confidence, detail, evidence}]}`) for the Career Brain (EZZY_CAREER_BRAIN.md). Always Haiku — this is classification/extraction, not open-ended reasoning, and directive §24 explicitly calls for cheap models on this kind of task. Runs server-side, asynchronously, after the coaching reply is already streamed to the user (don't block the chat UI on it).

Use Claude's structured output (tool-use with a fixed schema, or a strict JSON-only system prompt) rather than free text, so extraction results can be validated before being written to `career_claims`.

### 4. Build a minimal eval set before scaling extraction

Directive §25 is right that "it looks pretty good" isn't good enough, but a full eval platform is not warranted yet for a single extraction prompt. Concretely: assemble ~15–20 fixture inputs (a handful of real anonymized resumes/transcripts, a few adversarial ones — vague resumes, contradictory statements) with hand-written expected claims, and run the extraction prompt against them whenever the prompt changes, checking precision (no fabricated claims) and recall (didn't miss obvious ones) by inspection. Automate this into a script once it's being run more than a couple times a week — not before.

### 5. Specialized models — defer

Directive §15/§24 mention speech/communication analysis (filler words, pace, confidence signals) for interview coaching. This needs either audio input (the product is currently text-only chat) or a dedicated speech-analysis model — both are real scope additions, not incremental. Defer until Mock Interview is voice-enabled, which isn't in Phase 1 or 2 of the roadmap.

### 6. Cost discipline

Extraction calls add a second Claude call per exchange. Mitigate: batch extraction at natural checkpoints (mode-exit, every N turns) rather than after every single message, and always route extraction to Haiku regardless of which model the coaching call used. This keeps the marginal cost of the entire Career Brain v0 low relative to the existing coaching spend.
