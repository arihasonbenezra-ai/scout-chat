export const runtime = 'edge';

// Public anon key — same one already embedded in index.html. Not a secret.
const SUPABASE_URL = 'https://peksgdlfrnymkzlrbsgi.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_rVG6LNvp6Uzs7F6CxSgJlA_zVobq1hy';
const ALLOWED_ORIGINS = ['https://app.meetezzy.com', 'https://meetezzy.com', 'https://scout-chat.vercel.app'];
const ANON_MESSAGE_LIMIT = 8;

// Backstop against a determined attacker who rotates IPs/VPNs to get past
// the per-IP anon caps below - a single global ceiling on total anonymous
// usage per day, independent of who's making the requests. Per-IP limits
// bound one visitor's cost; this bounds worst-case cost for the whole app.
// Tune to your budget/traffic - this is a rough starting point, not a
// carefully-derived number.
const GLOBAL_ANON_DAILY_LIMIT = 300;

const MODEL_BY_MODE = {
  practice: 'claude-haiku-4-5',
  star: 'claude-haiku-4-5',
  mock: 'claude-sonnet-4-5',
  resume: 'claude-sonnet-4-5',
  research: 'claude-sonnet-4-5'
};

// Full, specialized breakdown - entitled/credited reviews only. Free
// reviews use RESUME_SYSTEM_FREE below instead: same input, deliberately
// more basic output, not a stripped-down version of this same prompt.
const RESUME_SYSTEM = [
  'You are Ezzy, a senior recruiting partner giving direct, specific resume feedback.',
  '',
  'You will receive: (1) the candidate\'s resume, (2) the target job description.',
  '',
  'Your job: identify the TOP 5 highest-impact changes the candidate should make, ranked by impact. For each change:',
  '1. Quote the exact line or phrase from their resume that needs work.',
  '2. Explain in 1-2 sentences why it is hurting them for this specific role.',
  '3. Give a concrete suggested rewrite they can copy-paste.',
  '',
  'Hard rules:',
  '- Never invent experience, metrics, skills, or accomplishments the candidate did not state.',
  '- If the resume is missing something the JD requires, say so explicitly. Do not fabricate.',
  '- Be specific to the JD. Generic resume tips are useless.',
  '- If you were given only a target role or company instead of a posting, or no target at all, you have NOT seen the posting. Never present a requirement as coming from a posting you were not given. Say "roles like this typically ask for..." and keep the advice grounded in the resume itself.',
  '- Total response under 600 words. Use clear headers like "Change 1:" through "Change 5:".',
  '- After the 5 changes, end with a one-line summary: "Biggest gap to close before applying: [X]".'
].join('\n');

// Free tier: general pointers only, not the specialized, ranked,
// line-by-line breakdown above - no JD-specific gap identification, no
// rewrites. Deliberately basic so there's a real reason to upgrade.
const RESUME_SYSTEM_FREE = [
  'You are Ezzy, giving a candidate a quick, general resume review.',
  '',
  'You will receive a resume and (optionally) a target job description or target roles.',
  '',
  'Give 3-4 general, high-level pointers - things like clarity, use of concrete metrics, strong vs. weak action verbs, structure. Keep it encouraging but honest.',
  '',
  'Do NOT do a deep, line-by-line or JD-specific breakdown. Do NOT rank issues by impact. Do NOT rewrite specific lines for them. This is a general first look, not the full recruiter-style review.',
  '',
  'Never invent experience, metrics, skills, or accomplishments the candidate did not state.',
  '',
  'Total response under 250 words.'
].join('\n');

// Free tier still gets real JD-matched feedback (same core prompt) - what
// it doesn't get is the structured gap-analysis checklist, Career Brain
// personalization/saving, or unlimited use. See FREE_RESUME_REVIEW_LIMIT.
const RESUME_UPSELL_LINE = '\n\nEnd your response with exactly this line, verbatim: "Want in-depth feedback and a gap analysis against the job you want? Upgrade for a full, recruiter-built resume review."';

// Applied to every prep mode. Prompt rules alone are not the guard - see
// checkGrounding() below, which enforces (1) and (2) server-side.
const GROUNDING_RULES = [
  'Grounding rules (non-negotiable):',
  '1. Every strength or improvement point must start by quoting the candidate\'s exact words in double quotes, copied verbatim from their answer - e.g. You said: "we finished two weeks early". Then comment on that quote.',
  '2. Never attribute to the candidate anything they did not say. No numbers, names, team sizes, tools, or outcomes that are not in their answer.',
  '3. No generic advice. If a point would apply to any answer to this question, cut it. Every point must be about something specific they said.',
  '4. When you restate what the candidate said outside of quotes, never upgrade it. "Offered a pilot" is not "the pilot was agreed"; "showed data" is not "convinced them". If they did not state an outcome, the outcome is unknown - say so or ask.',
  '5. If the answer has at least one concrete thing in it, give feedback on that first, then ask for what is missing. Only skip feedback entirely when there is genuinely nothing specific to comment on.'
].join('\n');

function trainerSystemPrompt(mode, role) {
  var base = trainerBasePrompt(mode, role);
  return base ? base + '\n\n' + GROUNDING_RULES : null;
}

function trainerBasePrompt(mode, role) {
  if (mode === 'practice') return 'You are an expert interview coach. The candidate is practicing for a ' + role + ' role. Ask ONE interview question at a time. After they respond, give structured feedback: 1-2 strengths, 1-2 areas to improve (specific and actionable), then move to the next question. Keep each feedback response under 120 words. After 5 questions, give a brief overall summary with a readiness rating out of 10.';
  if (mode === 'star') return 'You are an interview coach specializing in the STAR method (Situation, Task, Action, Result) for a ' + role + ' role. Ask one behavioral question at a time. After each answer, identify which STAR elements were present and missing, then show a concise example of how to strengthen it. Keep responses under 150 words. Then ask the next question.';
  if (mode === 'mock') return 'You are conducting a realistic mock interview for a ' + role + ' position. Respond in plain prose only. Do not use markdown headers, asterisks, dashes, or bullet points. Introduce yourself briefly and set the scene in plain text only, no stage directions, no asterisks, no descriptions of body language or facial expressions. Ask questions one at a time, follow up naturally. Stay in character throughout. After 6-7 questions, end professionally and give a detailed debrief: overall impression, top 2 strengths, top 2 areas to improve, and a readiness rating out of 10. In the debrief, apply the grounding rules below: quote the candidate\'s exact words for each strength and each area to improve.';
  return null;
}

// --- Prep feedback fabrication guard ------------------------------------
// The only source of truth in a prep session is what the candidate typed.
// Feedback must quote it before judging it (GROUNDING_RULES), and this
// check enforces that: every double-quoted span in the reply has to appear
// verbatim (whitespace/punctuation loosened) in the candidate's messages.
var PREP_MODES = { practice: true, star: true, mock: true };

function normText(t) {
  return String(t || '').toLowerCase()
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"')
    .replace(/[^a-z0-9$%'+.\-]+/g, ' ').trim();
}

// Everything said in the session, both sides. Quoting the interviewer's
// own question back ("you were asked to ...") is legitimate and must not
// be flagged; what the guard is for is words attributed to the candidate
// that nobody said.
function sessionText(messages) {
  return (messages || []).map(function (m) {
    if (typeof m.content === 'string') return m.content;
    if (Array.isArray(m.content)) return m.content.map(function (b) { return b && b.text ? b.text : ''; }).join(' ');
    return '';
  }).join('\n');
}

function extractQuotes(reply) {
  var out = [];
  var re = /"([^"\n]{8,240})"|\u201c([^\u201d\n]{8,240})\u201d/g;
  var m;
  while ((m = re.exec(reply)) !== null) out.push(m[1] || m[2]);
  return out;
}

function checkGrounding(reply, sourceText, requireQuote) {
  var src = normText(sourceText);
  var quotes = extractQuotes(reply);
  var bad = quotes.filter(function (q) {
    var n = normText(q);
    return n.length >= 6 && src.indexOf(n) === -1;
  });
  // A reply that asks the candidate for more (rule 4) is not feedback and
  // has nothing to quote yet - only a verdict without a quote is a miss.
  var asksForMore = /\?\s*$/.test(reply.trim()) || (reply.match(/\?/g) || []).length >= 2;
  var missing = requireQuote && quotes.length === 0 && !asksForMore;
  return { ok: !bad.length && !missing, bad: bad, quotes: quotes.length, missing: missing };
}

// Last resort when a retry still fabricates: drop the sentences that hold
// a bad quote and say so, rather than showing invented feedback.
function stripBadQuotes(reply, bad) {
  var sentences = reply.split(/(?<=[.!?])\s+|\n+/);
  var kept = sentences.filter(function (sent) {
    return !bad.some(function (q) { return sent.indexOf(q) !== -1; });
  });
  var removed = sentences.length - kept.length;
  var text = kept.join(' ').replace(/\s{2,}/g, ' ').trim();
  if (removed) text += '\n\n_' + (removed === 1 ? 'One point was' : removed + ' points were') + ' removed because ' + (removed === 1 ? 'it' : 'they') + ' referred to something you didn\'t say._';
  return text;
}

async function callOnce(anthropicBody) {
  var r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(Object.assign({}, anthropicBody, { stream: false }))
  });
  var data = await r.json();
  if (!r.ok) return { ok: false, status: r.status, data: data };
  var text = (data.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('');
  return { ok: true, data: data, text: text };
}

// Runs a prep turn non-streamed, verifies it, retries once with a
// corrective instruction, then strips as a last resort.
async function groundedPrepReply(anthropicBody, messages, mode) {
  var source = sessionText(messages);
  var requireQuote = mode !== 'mock'; // mock stays in character between questions
  var first = await callOnce(anthropicBody);
  if (!first.ok) return first;
  var check = checkGrounding(first.text, source, requireQuote);
  if (check.ok) return { ok: true, text: first.text, data: first.data, guard: { retried: false, stripped: 0 } };
  console.log('[prep-guard] retry', JSON.stringify({ mode: mode, bad: check.bad, missing: check.missing }));

  var correction = check.bad.length
    ? 'Your previous draft quoted words the candidate did not say: ' + check.bad.map(function (q) { return '"' + q + '"'; }).join(', ') + '. That is not acceptable. Rewrite the whole reply. Only quote text that appears verbatim in the candidate\'s answers.'
    : 'Your previous draft did not quote the candidate\'s words. Rewrite it so each point starts with an exact quote from their answer, in double quotes.';
  var retryBody = Object.assign({}, anthropicBody, { system: anthropicBody.system + '\n\n' + correction });
  var second = await callOnce(retryBody);
  if (!second.ok) return second;
  var check2 = checkGrounding(second.text, source, requireQuote);
  if (check2.ok) return { ok: true, text: second.text, data: second.data, guard: { retried: true, stripped: 0 } };

  console.log('[prep-guard] strip', JSON.stringify({ mode: mode, bad: check2.bad, missing: check2.missing }));
  var text = check2.bad.length ? stripBadQuotes(second.text, check2.bad) : second.text;
  return { ok: true, text: text, data: second.data, guard: { retried: true, stripped: check2.bad.length } };
}

function isPrepAnswerTurn(mode, messages) {
  if (!PREP_MODES[mode] || !messages || messages.length < 2) return false;
  var last = messages[messages.length - 1];
  if (!last || last.role !== 'user') return false;
  var text = typeof last.content === 'string' ? last.content : sessionText([last]);
  return text.trim().length >= 30; // a real answer, not "ok" / "next"
}

function researchSystemPrompt(role, company) {
  return [
    'You are Ezzy, a recruiting partner helping a candidate prep for a ' + role + ' interview at ' + company + '.',
    '',
    'Use web search to gather CURRENT, DATED information about the company. Produce a focused brief.',
    '',
    'Do NOT write any preamble or process narration before your response. Do NOT say things like "I will search for..." or "Let me search..." or "Now I have the information..." or "I will now search for additional...". Just start your response directly with the disclaimer line below.',
    '',
    'ALWAYS start with this exact disclaimer:',
    '_Based on public web search. Verify specifics like comp, benefits, policies, and current personnel before your interview._',
    '',
    'Then produce these 5 sections:',
    '',
    '**Recent News** - 2-3 most relevant news items from the last 12 months, ideally last 6 months. Each must have a dated source.',
    '**Product** - what the company does and any recent product launches or strategic shifts (last 12 months only)',
    '**Funding & Stage** - last raise, investors, headcount if announced (only include if publicly disclosed and recent)',
    '**What People Are Saying Recently** - 2-3 specific public statements, quotes from leadership, or themes from recent press. NOT generic culture vibes - only specific recent quotes or coverage.',
    '**3 Questions to Ask** - sharp, specific questions a ' + role + ' candidate could ask their interviewer, informed by what you found above',
    '',
    'After the brief, the candidate may ask follow-up questions. Use web search whenever needed.',
    '',
    'CRITICAL ACCURACY RULES:',
    '',
    '1. Every factual claim must come from a search result you retrieved this turn - sources are attached to your sentences automatically from those results, so do not type "(source: ...)" parentheticals yourself. Put the date of the information in the sentence itself, e.g. "In March 2026, Zocdoc launched...". A sentence you cannot back with a search result must be framed as unverified or left out.',
    '',
    '2. If web search did not return verified, dated information on something, write: "I could not find verified recent information on this." Do NOT guess. Do NOT pattern-match from training data. Do NOT use sources older than 12 months for anything except company founding dates and stable historical facts.',
    '',
    '3. DO NOT name specific current personnel (CEO, CTO, VP, hiring manager, etc.) by name. People change roles frequently and outdated personnel info is dangerous. If asked who works there in a follow-up, say: "I cannot reliably verify current personnel. I recommend checking the company website Team page and cross-referencing on LinkedIn."',
    '',
    '4. DO NOT make claims about benefits, comp, vacation, PTO, parental leave, healthcare, RTO/remote policies, or perks unless you have a source from the last 6 months. These change frequently. If asked, say: "I could not find verified current information. Ask the recruiter directly - they are required to disclose these."',
    '',
    '5. Distinguish facts from inferences. If inferring, say so: "Based on their recent product launches, it appears they are prioritizing X (inferred from public news, not confirmed by the company)."',
    '',
    '6. Never combine facts about similarly-named companies. Verify the source is about THIS company.',
    '',
    'Style:',
    '- Specific to the ' + role + ' role, not generic.',
    '- Brief under 600 words. Follow-ups under 250 words.',
    '- Plain text. Bold section headers OK. No bullet points using dashes.'
  ].join('\n');
}

function systemPromptFor(mode, role, company, knownClaimsText, resumeUnlocked, knowledgeText) {
  if (mode === 'resume') {
    var resumeBase = resumeUnlocked ? RESUME_SYSTEM : RESUME_SYSTEM_FREE;
    // Role is optional for resume review ("just resume review" sends none);
    // when the candidate did pick one, keep the feedback pointed at it.
    if (role) {
      resumeBase += '\n\nThe candidate is targeting ' + role + ' roles - keep the feedback relevant to that kind of role.';
    }
    if (knowledgeText) {
      resumeBase += '\n\nEzzy knowledge base - general recruiting and resume-screening knowledge you may draw on when relevant. Cite it by name when you use it; never fabricate a source that isn\'t listed here:\n' + knowledgeText;
    }
    if (!resumeUnlocked) return resumeBase + RESUME_UPSELL_LINE;
    if (!knownClaimsText) return resumeBase;
    return resumeBase + '\n\nAdditional context Ezzy already knows about this candidate from earlier sessions - reference it if it would strengthen the resume, but never fabricate beyond what is given here or in the resume itself:\n' + knownClaimsText;
  }
  if (mode === 'research') return researchSystemPrompt(role || 'candidate', company || 'the company');
  var base = trainerSystemPrompt(mode, role || 'candidate');
  if (base && knowledgeText) {
    base += '\n\nEzzy knowledge base - vetted interview knowledge relevant to this role. Use it to ask sharper, more specific questions and give more grounded feedback. Cite the source by name when you draw on it (e.g. "According to X..."); never fabricate a source that isn\'t listed here:\n' + knowledgeText;
  }
  if (base && knownClaimsText) {
    base += '\n\nWhat Ezzy already knows about this candidate from their profile and earlier sessions. Use it to make questions specific to their real background and target (ask about the projects and skills listed, pitch difficulty at their level, frame feedback against the target role). Never state anything here as if the candidate just told you it, and never invent details beyond it:\n' + knownClaimsText;
  }
  return base;
}

// Shared, non-personal knowledge (see 0012_ezzy_knowledge_base.sql) -
// reused across every user asking about this role, so this costs one
// Postgres read, not an extra Anthropic call. Filters loosely on role name
// since role is free text from the picker (including custom "Other" entries),
// not a fixed enum.
async function fetchKnowledgeItems(category, role) {
  try {
    var filter = 'category=eq.' + encodeURIComponent(category) + '&select=claim,status,topic,subject,knowledge_sources(domain,title)&order=confidence.desc.nullslast&limit=5';
    if (role) {
      filter += '&or=(subject.ilike.*' + encodeURIComponent(role) + '*,subject.is.null)';
    } else {
      filter += '&subject=is.null';
    }
    var res = await fetch(SUPABASE_URL + '/rest/v1/knowledge_items?' + filter, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY }
    });
    if (!res.ok) return [];
    return await res.json();
  } catch (e) {
    return [];
  }
}

function knowledgeToText(items) {
  if (!items || !items.length) return null;
  return items.map(function (i) {
    var src = i.knowledge_sources && (i.knowledge_sources.title || i.knowledge_sources.domain);
    return '- ' + i.claim + (i.status === 'opinion' ? ' (advice)' : '') + (src ? ' [source: ' + src + ']' : '');
  }).join('\n');
}

// Question archetypes (see 0014_question_archetypes.sql) - the richer
// "what is this question actually testing" entity, one Postgres read like
// fetchKnowledgeItems above. star is explicitly the STAR/behavioral
// coaching mode, so it filters to behavioral archetypes only; practice/mock
// stay broad since either could reasonably touch any interview type for
// the role.
async function fetchQuestionArchetypes(role, interviewType) {
  try {
    var filter = 'select=title,competency,example_questions,testing_for,strong_evidence,failure_modes,likely_followups,status,knowledge_sources(domain,title)&order=confidence.desc.nullslast&limit=3';
    if (interviewType) filter += '&interview_type=eq.' + encodeURIComponent(interviewType);
    if (role) {
      filter += '&or=(role.ilike.*' + encodeURIComponent(role) + '*,role.is.null)';
    } else {
      filter += '&role=is.null';
    }
    var res = await fetch(SUPABASE_URL + '/rest/v1/question_archetypes?' + filter, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY }
    });
    if (!res.ok) return [];
    return await res.json();
  } catch (e) {
    return [];
  }
}

function archetypesToText(archetypes) {
  if (!archetypes || !archetypes.length) return null;
  return archetypes.map(function (a) {
    var src = a.knowledge_sources && (a.knowledge_sources.title || a.knowledge_sources.domain);
    return [
      '- Archetype: ' + a.title + ' (competency: ' + a.competency + ')',
      '  Tests for: ' + (a.testing_for || []).join(', '),
      '  Strong evidence: ' + (a.strong_evidence || []).join('; '),
      '  Common failure modes: ' + (a.failure_modes || []).join('; '),
      '  Likely follow-ups: ' + (a.likely_followups || []).join(' / '),
      src ? '  [source: ' + src + ']' : null
    ].filter(Boolean).join('\n');
  }).join('\n');
}

var INTERVIEW_TYPE_BY_MODE = { star: 'behavioral' };

// Company Research is the most expensive call in the app (Sonnet + live web
// search, every time) and the most repeatable - the same company gets asked
// about by many different users. Cache the initial brief by company+role
// with a freshness window; follow-up questions in the conversation always
// go live (see the messages.length === 1 check at the call site), since
// those are genuinely per-conversation.
const RESEARCH_CACHE_TTL_DAYS = 14;

function normalizeKey(s) {
  return (s || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

async function fetchCachedResearch(companyKey, roleKey) {
  try {
    var cutoff = new Date(Date.now() - RESEARCH_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    var res = await fetch(
      SUPABASE_URL + '/rest/v1/company_research_cache?company_key=eq.' + encodeURIComponent(companyKey) +
      '&role_key=eq.' + encodeURIComponent(roleKey) + '&created_at=gte.' + cutoff + '&select=brief&limit=1',
      { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY } }
    );
    if (!res.ok) return null;
    var rows = await res.json();
    return rows && rows[0] ? rows[0].brief : null;
  } catch (e) {
    return null;
  }
}

async function saveCachedResearch(companyKey, roleKey, company, role, brief) {
  try {
    await fetch(SUPABASE_URL + '/rest/v1/company_research_cache?on_conflict=company_key,role_key', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY,
        Prefer: 'resolution=merge-duplicates'
      },
      body: JSON.stringify([{
        company_key: companyKey, role_key: roleKey, company: company, role: role,
        brief: brief, created_at: new Date().toISOString()
      }])
    });
  } catch (e) {
    // caching is best-effort - never fail the request over a cache write
  }
}

// --- Company Research fabrication guard --------------------------------
// The model is told to cite everything, but a prompt rule is not a check.
// The API attaches real citations (url, title, cited_text) to every text
// block that draws on a web search result. This pass rebuilds the brief
// from those citations instead of trusting whatever the model typed:
//   - a cited block gets a real link to the page it came from
//   - a model-typed "(source: x.com, 2024)" is removed if the block is
//     cited (the real link replaces it), linked if x.com was actually in
//     the search results, or marked "source not verified" otherwise
//   - a Sources list of every page actually cited is appended
// The result is what gets shown, cached, and served to later users.
function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
}

var TYPED_SOURCE_RE = /\s*\((?:sources?|via|per)\s*:\s*([^)]*)\)/gi;

function verifyResearchBrief(content) {
  var results = {};   // host -> {url, title, page_age}
  var cited = [];     // ordered unique cited pages
  var citedByUrl = {};
  var unverified = 0;
  var citedBlocks = 0;
  var out = [];

  (content || []).forEach(function (b) {
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
      b.content.forEach(function (r) {
        if (r && r.type === 'web_search_result' && r.url) {
          var h = hostOf(r.url);
          if (h && !results[h]) results[h] = { url: r.url, title: r.title || h, page_age: r.page_age || null };
        }
      });
    }
  });

  (content || []).forEach(function (b) {
    if (b.type !== 'text' || typeof b.text !== 'string') return;
    var text = b.text;
    var cites = Array.isArray(b.citations) ? b.citations.filter(function (c) { return c && c.type === 'web_search_result_location' && c.url; }) : [];

    if (cites.length) {
      citedBlocks++;
      text = text.replace(TYPED_SOURCE_RE, '');
      var links = [];
      cites.forEach(function (c) {
        if (!citedByUrl[c.url]) {
          citedByUrl[c.url] = { url: c.url, title: c.title || hostOf(c.url), page_age: (results[hostOf(c.url)] || {}).page_age || null, n: cited.length + 1 };
          cited.push(citedByUrl[c.url]);
        }
        var n = citedByUrl[c.url].n;
        if (links.indexOf(n) === -1) links.push(n);
      });
      var tail = links.map(function (n) { return '[' + n + '](' + cited[n - 1].url + ')'; }).join(' ');
      // Place the link before a trailing newline so it stays on the sentence.
      var m = text.match(/(\s*)$/);
      text = text.slice(0, text.length - m[1].length) + ' ' + tail + m[1];
    } else {
      text = text.replace(TYPED_SOURCE_RE, function (whole, inner) {
        var hosts = String(inner).toLowerCase().match(/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/g) || [];
        var hit = null;
        for (var i = 0; i < hosts.length && !hit; i++) {
          var h = hosts[i].replace(/^www\./, '');
          if (results[h]) hit = results[h];
        }
        if (hit) {
          if (!citedByUrl[hit.url]) {
            citedByUrl[hit.url] = { url: hit.url, title: hit.title, page_age: hit.page_age, n: cited.length + 1 };
            cited.push(citedByUrl[hit.url]);
          }
          return ' [' + citedByUrl[hit.url].n + '](' + hit.url + ')';
        }
        unverified++;
        return ' *(source not verified)*';
      });
    }
    out.push(text);
  });

  var body = out.join('').trim();
  if (cited.length) {
    body += '\n\n**Sources**\n' + cited.map(function (c) {
      return c.n + '. [' + String(c.title).replace(/[\[\]]/g, '') + '](' + c.url + ')' + (c.page_age ? ' · ' + c.page_age : '');
    }).join('\n');
  }
  if (unverified) {
    body += '\n\n_' + unverified + (unverified === 1 ? ' claim' : ' claims') + ' above could not be matched to a search result and ' + (unverified === 1 ? 'is' : 'are') + ' marked "source not verified". Treat ' + (unverified === 1 ? 'it' : 'them') + ' as unconfirmed._';
  }
  return { text: body, sources: cited, citedBlocks: citedBlocks, unverified: unverified, searched: Object.keys(results).length };
}

// Research runs non-streamed so the whole response can be verified before
// anyone sees it, then is replayed to the client in the same SSE shape the
// streaming path uses (one delta + [DONE]) so the client needs no change.
function writeAsStream(res, text) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.write('data: ' + JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text } }) + '\n\n');
  res.write('data: [DONE]\n\n');
  res.end();
}

async function callResearch(anthropicBody) {
  // pause_turn: the API paused a long search turn; resend with the partial
  // assistant content appended to continue. Bounded so a stuck turn ends.
  var body = Object.assign({}, anthropicBody, { stream: false });
  var merged = [];
  for (var i = 0; i < 3; i++) {
    var r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body)
    });
    var data = await r.json();
    if (!r.ok) return { ok: false, status: r.status, data: data };
    merged = merged.concat(data.content || []);
    if (data.stop_reason !== 'pause_turn') return { ok: true, data: data, content: merged };
    body = Object.assign({}, body, { messages: body.messages.concat([{ role: 'assistant', content: data.content }]) });
  }
  return { ok: true, content: merged };
}

async function fetchSubscription(token, userId) {
  try {
    var res = await fetch(
      SUPABASE_URL + '/rest/v1/subscriptions?user_id=eq.' + userId + '&select=*',
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token } }
    );
    if (!res.ok) return null;
    var rows = await res.json();
    return rows && rows[0] ? rows[0] : null;
  } catch (e) {
    return null;
  }
}

function hasActiveAccess(sub) {
  if (!sub || sub.status !== 'active') return false;
  if (sub.plan !== 'job_search' && sub.plan !== 'career') return false;
  if (sub.current_period_end && new Date(sub.current_period_end).getTime() < Date.now()) return false;
  return true;
}

// Carries anonymous usage (by IP) into a freshly-signed-up account, so
// signing up after using the free tier anonymously doesn't grant a second
// free round - see 0019_free_tier_redesign.sql. Best-effort: an infra
// failure here just means the DB-side gate re-evaluates without the
// carry-over, which fails closed (denies) rather than open in practice
// since a fresh account with no carried-over usage still hits its own
// independent free limit correctly - it just might get a full fresh one
// this one time rather than an already-exhausted one.
async function carryOverAnonPrep(userId, anonKey) {
  try {
    await fetch(SUPABASE_URL + '/rest/v1/rpc/carry_over_anon_prep', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY
      },
      body: JSON.stringify({ p_user_id: userId, p_anon_key: anonKey })
    });
  } catch (e) {
    // best-effort - see comment above
  }
}

async function carryOverAnonResume(userId, anonKey) {
  try {
    await fetch(SUPABASE_URL + '/rest/v1/rpc/carry_over_anon_resume', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY
      },
      body: JSON.stringify({ p_user_id: userId, p_anon_key: anonKey })
    });
  } catch (e) {
    // best-effort - see comment above
  }
}

const FREE_PREP_TURN_LIMIT = 8;

// Atomic, same reasoning as useFreeResumeReview below: fails closed on
// infra errors since this exists to bound cost, not to be generous on
// our own outages.
async function useFreePrepTurn(userId) {
  try {
    var res = await fetch(SUPABASE_URL + '/rest/v1/rpc/use_free_prep_turn', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY
      },
      body: JSON.stringify({ p_user_id: userId, p_limit: FREE_PREP_TURN_LIMIT })
    });
    if (!res.ok) return false;
    return await res.json();
  } catch (e) {
    return false;
  }
}

const FREE_RESUME_REVIEW_LIMIT = 1;

// Atomic: only succeeds (and increments) while under the limit, so two
// near-simultaneous requests can't both sneak through. Fails closed
// (treats an infra error as "limit reached") since this exists specifically
// to bound cost, not to be generous on our own outages.
async function useFreeResumeReview(userId) {
  try {
    var res = await fetch(SUPABASE_URL + '/rest/v1/rpc/use_free_resume_review', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY
      },
      body: JSON.stringify({ p_user_id: userId, p_limit: FREE_RESUME_REVIEW_LIMIT })
    });
    if (!res.ok) return false;
    return await res.json();
  } catch (e) {
    return false;
  }
}

async function fetchKnownClaims(token, userId) {
  try {
    var res = await fetch(
      SUPABASE_URL + '/rest/v1/career_claims?user_id=eq.' + userId +
      '&select=claim_type,label,status,evidence,detail&order=last_seen_at.desc&limit=30',
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token } }
    );
    if (!res.ok) return [];
    return await res.json();
  } catch (e) {
    return [];
  }
}

function claimsToText(claims) {
  if (!claims || !claims.length) return null;
  return claims.map(function (c) {
    var quote = c.evidence && c.evidence[0] && c.evidence[0].quote;
    var prof = c.claim_type === 'skill' && c.detail && c.detail.proficiency ? ', ' + c.detail.proficiency : '';
    return '- [' + c.claim_type + '] ' + c.label + ' (' + c.status + prof + ')' + (quote ? ' - "' + quote + '"' : '');
  }).join('\n');
}

// The memory model's comparable fields (0020_memory_model.sql) - one row
// per user. Read alongside claims so every mode can be pointed at the
// candidate's actual target, not just the role pill they clicked today.
async function fetchCareerProfile(token, userId) {
  try {
    var res = await fetch(
      SUPABASE_URL + '/rest/v1/career_profile?user_id=eq.' + userId + '&select=*',
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token } }
    );
    if (!res.ok) return null;
    var rows = await res.json();
    return rows && rows[0] ? rows[0] : null;
  } catch (e) {
    return null;
  }
}

function profileToText(p) {
  if (!p) return null;
  var lines = [];
  var now = [];
  if (p.current_role_title) now.push(p.current_role_title);
  if (p.current_industry) now.push('in ' + p.current_industry);
  if (p.seniority_level) now.push('(' + p.seniority_level + ')');
  if (typeof p.years_experience === 'number' || (p.years_experience && !isNaN(Number(p.years_experience)))) {
    now.push(Number(p.years_experience) + ' years experience');
  }
  if (now.length) lines.push('Current: ' + now.join(' '));
  if (p.target_role_title) {
    var t = [p.target_role_title];
    if (p.target_level) t.push(p.target_level + ' level');
    if (p.target_comp_min || p.target_comp_max) {
      var cur = p.target_comp_currency || 'USD';
      var lo = p.target_comp_min ? Math.round(p.target_comp_min / 1000) + 'k' : '';
      var hi = p.target_comp_max ? Math.round(p.target_comp_max / 1000) + 'k' : '';
      t.push('comp ' + (lo && hi ? lo + '-' + hi : lo || hi) + ' ' + cur);
    }
    if (p.target_work_type && p.target_work_type !== 'any') t.push(p.target_work_type);
    if (p.target_locations && p.target_locations.length) t.push(p.target_locations.join('/'));
    if (p.target_timeline) t.push('timeline: ' + String(p.target_timeline).replace('_', ' '));
    var how = p.target_source === 'stated' || p.target_source === 'discovered' ? 'confirmed by the candidate' : 'not yet confirmed by the candidate - treat as a working assumption';
    lines.push('Target: ' + t.join(', ') + ' [' + how + ']');
  }
  return lines.length ? lines.join('\n') : null;
}

function memoryToText(profile, claims) {
  var parts = [];
  var pt = profileToText(profile);
  var ct = claimsToText(claims);
  if (pt) parts.push(pt);
  if (ct) parts.push(ct);
  return parts.length ? parts.join('\n') : null;
}

function corsOrigin(req) {
  var origin = req.headers && (req.headers.origin || req.headers.Origin);
  return ALLOWED_ORIGINS.indexOf(origin) !== -1 ? origin : ALLOWED_ORIGINS[0];
}

async function getAuthedUser(token) {
  if (!token) return null;
  var res = await fetch(SUPABASE_URL + '/auth/v1/user', {
    headers: { Authorization: 'Bearer ' + token, apikey: SUPABASE_ANON_KEY }
  });
  if (!res.ok) return null;
  var data = await res.json();
  return data && data.id ? data : null;
}

function clientIp(req) {
  var xff = req.headers && (req.headers['x-forwarded-for'] || req.headers['X-Forwarded-For']);
  if (xff) return xff.split(',')[0].trim();
  return (req.headers && req.headers['x-real-ip']) || 'unknown';
}

async function anonHitCount(key, windowHours) {
  try {
    var res = await fetch(SUPABASE_URL + '/rest/v1/rpc/increment_anon_usage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + SUPABASE_ANON_KEY
      },
      body: JSON.stringify({ p_key: key, p_window_hours: windowHours || 24 })
    });
    if (!res.ok) return 0; // fail open on infra errors rather than blocking every anonymous visitor
    return await res.json();
  } catch (e) {
    return 0;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', corsOrigin(req));
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    var body = req.body || {};
    var mode = body.mode;
    var role = typeof body.role === 'string' ? body.role.slice(0, 120) : null;
    var company = typeof body.company === 'string' ? body.company.slice(0, 120) : null;
    var messages = Array.isArray(body.messages) ? body.messages : null;
    var isStreaming = body.stream === true;

    if (!Object.prototype.hasOwnProperty.call(MODEL_BY_MODE, mode)) {
      return res.status(400).json({ error: 'Unknown mode' });
    }
    if (!messages || !messages.length) {
      return res.status(400).json({ error: 'messages required' });
    }

    var authHeader = req.headers && (req.headers.authorization || req.headers.Authorization);
    var token = authHeader && authHeader.indexOf('Bearer ') === 0 ? authHeader.slice(7) : null;
    var user = token ? await getAuthedUser(token) : null;

    var ip = clientIp(req);

    // Practice Q&A and Resume Review (the two free-tier features) now
    // require a free account before Ezzy actually generates anything -
    // someone can still paste a resume or start answering questions
    // anonymously, but seeing the result requires signing up first. This
    // also means no Anthropic cost is spent on anyone who abandons before
    // signing up, and closes the old anon-then-signup double-dip at the
    // source rather than needing the carry-over functions below to catch it.
    if (!user && (mode === 'practice' || mode === 'resume')) {
      return res.status(401).json({ error: 'signup_required' });
    }

    if (!user) {
      var hits = await anonHitCount(ip);
      if (hits > ANON_MESSAGE_LIMIT) {
        return res.status(429).json({ error: 'anon_limit_reached' });
      }
      var globalAnonHits = await anonHitCount('global:anon');
      if (globalAnonHits > GLOBAL_ANON_DAILY_LIMIT) {
        return res.status(429).json({ error: 'anon_global_limit_reached' });
      }
    }

    var sub = user ? await fetchSubscription(token, user.id) : null;
    var entitled = hasActiveAccess(sub);

    // Company Research, STAR Coaching, and Mock Interview are all fully
    // paid features now - Practice Q&A is the only free prep mode (there's
    // nothing left to "lock to whichever you tried first" since it's the
    // only option), same treatment as Company Research already got.
    if (mode === 'research' && !entitled) {
      return res.status(403).json({ error: 'research_requires_job_search' });
    }
    if ((mode === 'star' || mode === 'mock') && !entitled) {
      return res.status(403).json({ error: 'prep_mode_requires_job_search', mode: mode });
    }

    // user is guaranteed non-null below - anonymous practice/resume
    // requests already returned 401 above. carryOverAnonPrep/Resume are
    // still called (harmless, idempotent) in case someone used the old
    // anonymous flow in the window before this gate existed.
    if (!entitled && mode === 'practice') {
      await carryOverAnonPrep(user.id, 'prep:' + ip);
      var allowedPrepTurn = await useFreePrepTurn(user.id);
      if (!allowedPrepTurn) {
        return res.status(429).json({ error: 'free_prep_limit_reached' });
      }
    }

    var resumeUnlocked = mode === 'resume' && (entitled || (sub && sub.resume_review_credits > 0));

    // messages.length === 1 is the initial resume(+JD) submission that kicks
    // off a review - the client always resets to a fresh 1-message array for
    // that turn. Later back-and-forth in the same review doesn't re-count.
    if (mode === 'resume' && !resumeUnlocked && messages.length === 1) {
      await carryOverAnonResume(user.id, 'resume:' + ip);
      var allowedFreeReview = await useFreeResumeReview(user.id);
      if (!allowedFreeReview) {
        return res.status(403).json({ error: 'free_resume_limit_reached' });
      }
    }

    // Memory injection: paying users get what Ezzy knows about them in every
    // mode (the coach "knows your career"). Free tier stays memory-less, as
    // before, which is also what keeps the free prompts cheap.
    var knownClaimsText = null;
    var memoryOn = user && (entitled || resumeUnlocked) && mode !== 'research';
    if (memoryOn) {
      var memParts = await Promise.all([fetchCareerProfile(token, user.id), fetchKnownClaims(token, user.id)]);
      knownClaimsText = memoryToText(memParts[0], memParts[1]);
    }

    var knowledgeText = null;
    if (mode === 'practice' || mode === 'star' || mode === 'mock') {
      var factsText = knowledgeToText(await fetchKnowledgeItems('interview', role));
      var archetypesText = archetypesToText(await fetchQuestionArchetypes(role, INTERVIEW_TYPE_BY_MODE[mode]));
      var parts = [];
      if (archetypesText) parts.push('Relevant question archetypes:\n' + archetypesText);
      if (factsText) parts.push('General interview knowledge:\n' + factsText);
      knowledgeText = parts.length ? parts.join('\n\n') : null;
    } else if (mode === 'resume') {
      knowledgeText = knowledgeToText(await fetchKnowledgeItems('recruiting', role));
    }

    // Company Research: serve a cached brief for the initial message of a
    // conversation when one exists and is still fresh - skips the
    // Anthropic call (web search + Sonnet) entirely. Follow-up questions
    // (messages.length > 1) always go live.
    var researchCacheKeys = null;
    if (mode === 'research' && messages.length === 1) {
      researchCacheKeys = { companyKey: normalizeKey(company), roleKey: normalizeKey(role) };
      var cachedBrief = await fetchCachedResearch(researchCacheKeys.companyKey, researchCacheKeys.roleKey);
      if (cachedBrief) {
        if (isStreaming) return writeAsStream(res, cachedBrief);
        return res.status(200).json({
          content: [{ type: 'text', text: cachedBrief }],
          usage: { input_tokens: 0, output_tokens: 0 }
        });
      }
    }

    var anthropicBody = {
      model: MODEL_BY_MODE[mode],
      max_tokens: mode === 'research' ? 4000 : 1000,
      system: systemPromptFor(mode, role, company, knownClaimsText, resumeUnlocked, knowledgeText),
      messages: messages,
      stream: isStreaming
    };
    if (isPrepAnswerTurn(mode, messages)) {
      var gp = await groundedPrepReply(anthropicBody, messages, mode);
      if (!gp.ok) return res.status(gp.status || 502).json(gp.data || { error: 'Prep reply failed' });
      if (isStreaming) return writeAsStream(res, gp.text);
      return res.status(200).json({ content: [{ type: 'text', text: gp.text }], guard: gp.guard, usage: (gp.data && gp.data.usage) || {} });
    }

    if (mode === 'research') {
      anthropicBody.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 }];
      var rr = await callResearch(anthropicBody);
      if (!rr.ok) return res.status(rr.status || 502).json(rr.data || { error: 'Research failed' });
      var verified = verifyResearchBrief(rr.content);
      if (!verified.text) return res.status(502).json({ error: 'Research returned no text' });
      if (researchCacheKeys) {
        await saveCachedResearch(researchCacheKeys.companyKey, researchCacheKeys.roleKey, company, role, verified.text);
      }
      if (isStreaming) return writeAsStream(res, verified.text);
      return res.status(200).json({
        content: [{ type: 'text', text: verified.text }],
        research: { sources: verified.sources.length, unverified: verified.unverified, searched: verified.searched },
        usage: (rr.data && rr.data.usage) || {}
      });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(anthropicBody)
    });

    if (!isStreaming) {
      const data = await response.json();
      return res.status(response.status).json(data);
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }
    res.end();
  } catch (err) {
    res.status(500).json({ error: 'Proxy error', detail: err.message });
  }
}
