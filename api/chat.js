export const runtime = 'edge';

// Public anon key — same one already embedded in index.html. Not a secret.
const SUPABASE_URL = 'https://peksgdlfrnymkzlrbsgi.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_rVG6LNvp6Uzs7F6CxSgJlA_zVobq1hy';
const ALLOWED_ORIGINS = ['https://app.meetezzy.com', 'https://meetezzy.com', 'https://scout-chat.vercel.app'];
const ANON_MESSAGE_LIMIT = 8;

const MODEL_BY_MODE = {
  practice: 'claude-haiku-4-5',
  star: 'claude-haiku-4-5',
  mock: 'claude-sonnet-4-5',
  resume: 'claude-sonnet-4-5',
  research: 'claude-sonnet-4-5'
};

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
  '- Total response under 600 words. Use clear headers like "Change 1:" through "Change 5:".',
  '- After the 5 changes, end with a one-line summary: "Biggest gap to close before applying: [X]".'
].join('\n');

// Free tier: no target job description, no Career Brain personalization -
// a general, still-genuinely-useful critique, not the paid gap-matched review.
const RESUME_SYSTEM_FREE = [
  'You are Ezzy, giving general resume feedback. No target job description was provided - do not assume one or invent a role to compare against.',
  '',
  'Identify the TOP 3 highest-impact general improvements: weak or vague bullet points, missing quantification, unclear structure, or generic phrasing. For each:',
  '1. Quote the exact line that needs work.',
  '2. Explain in 1 sentence why it is weak.',
  '3. Give a concrete suggested rewrite.',
  '',
  'Never invent experience, metrics, or accomplishments the candidate did not state.',
  'Total response under 350 words.',
  'End with exactly this line, verbatim: "Want feedback matched against a specific job, plus what you are missing for it? Upgrade for a full recruiter-style review."'
].join('\n');

function trainerSystemPrompt(mode, role) {
  if (mode === 'practice') return 'You are an expert interview coach. The candidate is practicing for a ' + role + ' role. Ask ONE interview question at a time. After they respond, give structured feedback: 1-2 strengths, 1-2 areas to improve (specific and actionable), then move to the next question. Keep each feedback response under 120 words. After 5 questions, give a brief overall summary with a readiness rating out of 10.';
  if (mode === 'star') return 'You are an interview coach specializing in the STAR method (Situation, Task, Action, Result) for a ' + role + ' role. Ask one behavioral question at a time. After each answer, identify which STAR elements were present and missing, then show a concise example of how to strengthen it. Keep responses under 150 words. Then ask the next question.';
  if (mode === 'mock') return 'You are conducting a realistic mock interview for a ' + role + ' position. Respond in plain prose only. Do not use markdown headers, asterisks, dashes, or bullet points. Introduce yourself briefly and set the scene in plain text only, no stage directions, no asterisks, no descriptions of body language or facial expressions. Ask questions one at a time, follow up naturally. Stay in character throughout. After 6-7 questions, end professionally and give a detailed debrief: overall impression, top 2 strengths, top 2 areas to improve, and a readiness rating out of 10.';
  return null;
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
    '1. Every factual claim must include an inline source with date in this format: (source: domain.com, [year]). Example: "Zocdoc launched a new telehealth feature in 2024 (source: techcrunch.com, 2024)."',
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

function systemPromptFor(mode, role, company, knownClaimsText, resumeUnlocked) {
  if (mode === 'resume') {
    if (!resumeUnlocked) return RESUME_SYSTEM_FREE;
    if (!knownClaimsText) return RESUME_SYSTEM;
    return RESUME_SYSTEM + '\n\nAdditional context Ezzy already knows about this candidate from earlier sessions - reference it if it would strengthen the resume, but never fabricate beyond what is given here or in the resume itself:\n' + knownClaimsText;
  }
  if (mode === 'research') return researchSystemPrompt(role || 'candidate', company || 'the company');
  return trainerSystemPrompt(mode, role || 'candidate');
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

async function lockFreePrepMode(userId, mode) {
  try {
    var res = await fetch(SUPABASE_URL + '/rest/v1/rpc/lock_free_prep_mode', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY
      },
      body: JSON.stringify({ p_user_id: userId, p_mode: mode })
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

async function fetchKnownClaims(token, userId) {
  try {
    var res = await fetch(
      SUPABASE_URL + '/rest/v1/career_claims?user_id=eq.' + userId +
      '&select=claim_type,label,status,evidence&order=last_seen_at.desc&limit=20',
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
    return '- [' + c.claim_type + '] ' + c.label + ' (' + c.status + ')' + (quote ? ' - "' + quote + '"' : '');
  }).join('\n');
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

async function anonHitCount(ip) {
  try {
    var res = await fetch(SUPABASE_URL + '/rest/v1/rpc/increment_anon_usage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + SUPABASE_ANON_KEY
      },
      body: JSON.stringify({ p_key: ip, p_window_hours: 24 })
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

    if (!user) {
      var hits = await anonHitCount(clientIp(req));
      if (hits > ANON_MESSAGE_LIMIT) {
        return res.status(429).json({ error: 'anon_limit_reached' });
      }
    }

    var sub = user ? await fetchSubscription(token, user.id) : null;
    var entitled = hasActiveAccess(sub);

    if (user && !entitled && (mode === 'practice' || mode === 'star' || mode === 'mock')) {
      var lockedMode = sub && sub.free_prep_mode;
      if (lockedMode && lockedMode !== mode) {
        return res.status(403).json({ error: 'free_mode_locked', lockedMode: lockedMode });
      }
      if (!lockedMode) {
        await lockFreePrepMode(user.id, mode);
      }
      var priorTurns = messages.filter(function (m) { return m.role === 'assistant'; }).length;
      if (priorTurns >= 10) {
        return res.status(429).json({ error: 'free_prep_limit_reached' });
      }
    }

    var resumeUnlocked = mode === 'resume' && (entitled || (sub && sub.resume_review_credits > 0));

    var knownClaimsText = null;
    if (mode === 'resume' && user && resumeUnlocked) {
      knownClaimsText = claimsToText(await fetchKnownClaims(token, user.id));
    }

    var anthropicBody = {
      model: MODEL_BY_MODE[mode],
      max_tokens: mode === 'research' ? 4000 : 1000,
      system: systemPromptFor(mode, role, company, knownClaimsText, resumeUnlocked),
      messages: messages,
      stream: isStreaming
    };
    if (mode === 'research') {
      anthropicBody.tools = [{ type: 'web_search_20250305', name: 'web_search' }];
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
