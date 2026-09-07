export const runtime = 'edge';

// Public anon key — same one already embedded in index.html. Not a secret.
const SUPABASE_URL = 'https://peksgdlfrnymkzlrbsgi.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_rVG6LNvp6Uzs7F6CxSgJlA_zVobq1hy';
const ALLOWED_ORIGINS = ['https://meetezzy.com', 'https://scout-chat.vercel.app'];

const EXTRACT_SYSTEM = [
  'You are a structured-data extractor for a career-coaching product. You are not talking to the candidate - you are reading their resume (and optionally a target job description) and pulling out factual claims about their career.',
  '',
  'Extract only what is directly supported by the text. Do not invent experience, metrics, or skills.',
  '',
  'For every claim, set "status":',
  '- "fact": the resume states this directly.',
  '- "inference": reasonably concluded from the resume but not stated in those words (e.g. seniority implied by scope of responsibility).',
  '',
  'Every claim needs an evidence_quote: the exact phrase from the resume it is based on.',
  '',
  'claim_type is one of: experience, skill, achievement, goal, preference.',
  'Extract at most 20 claims. Prioritize the highest-signal ones over exhaustive coverage.'
].join('\n');

const EXTRACT_TOOL = {
  name: 'record_career_claims',
  description: "Record structured career claims extracted from the candidate's resume.",
  input_schema: {
    type: 'object',
    properties: {
      profile: {
        type: 'object',
        properties: {
          career_stage: { type: 'string' },
          current_role: { type: 'string' },
          current_industry: { type: 'string' }
        }
      },
      claims: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            claim_type: { type: 'string', enum: ['experience', 'skill', 'achievement', 'goal', 'preference'] },
            label: { type: 'string' },
            status: { type: 'string', enum: ['fact', 'inference'] },
            confidence: { type: 'number' },
            detail: { type: 'object' },
            evidence_quote: { type: 'string' }
          },
          required: ['claim_type', 'label', 'status', 'evidence_quote']
        }
      }
    },
    required: ['claims']
  }
};

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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', corsOrigin(req));
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    var authHeader = req.headers && (req.headers.authorization || req.headers.Authorization);
    var token = authHeader && authHeader.indexOf('Bearer ') === 0 ? authHeader.slice(7) : null;
    var user = await getAuthedUser(token);
    if (!user) return res.status(401).json({ error: 'Sign in required' });

    var body = req.body || {};
    var resumeText = typeof body.resumeText === 'string' ? body.resumeText.slice(0, 20000) : '';
    var jdText = typeof body.jdText === 'string' ? body.jdText.slice(0, 20000) : '';
    if (!resumeText) return res.status(400).json({ error: 'resumeText required' });

    var userMsg = 'Resume:\n\n' + resumeText + (jdText ? '\n\n---\n\nTarget job description:\n\n' + jdText : '');

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 2000,
        system: EXTRACT_SYSTEM,
        messages: [{ role: 'user', content: userMsg }],
        tools: [EXTRACT_TOOL],
        tool_choice: { type: 'tool', name: 'record_career_claims' }
      })
    });
    const claudeData = await claudeRes.json();
    const toolUse = (claudeData.content || []).find(function (b) { return b.type === 'tool_use'; });
    if (!toolUse) return res.status(502).json({ error: 'Extraction failed', detail: claudeData });

    var extracted = toolUse.input || {};
    var claims = Array.isArray(extracted.claims) ? extracted.claims.slice(0, 20) : [];
    var today = new Date().toISOString().slice(0, 10);

    var rows = claims
      .filter(function (c) { return c && c.claim_type && c.label && c.evidence_quote; })
      .map(function (c) {
        return {
          user_id: user.id,
          claim_type: c.claim_type,
          label: String(c.label).slice(0, 200),
          status: c.status === 'inference' ? 'inference' : 'fact',
          confidence: typeof c.confidence === 'number' ? c.confidence : null,
          detail: c.detail && typeof c.detail === 'object' ? c.detail : {},
          evidence: [{ source: 'resume', quote: String(c.evidence_quote).slice(0, 400), date: today }],
          last_seen_at: new Date().toISOString()
        };
      });

    if (rows.length) {
      const upsertRes = await fetch(SUPABASE_URL + '/rest/v1/career_claims?on_conflict=user_id,claim_type,label', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: 'Bearer ' + token,
          Prefer: 'resolution=merge-duplicates,return=representation'
        },
        body: JSON.stringify(rows)
      });
      if (!upsertRes.ok) {
        const errText = await upsertRes.text();
        return res.status(502).json({ error: 'Could not save claims', detail: errText });
      }
    }

    var profile = extracted.profile && typeof extracted.profile === 'object' ? extracted.profile : null;
    if (profile && (profile.career_stage || profile.current_role || profile.current_industry)) {
      await fetch(SUPABASE_URL + '/rest/v1/career_profile?on_conflict=user_id', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: 'Bearer ' + token,
          Prefer: 'resolution=merge-duplicates'
        },
        body: JSON.stringify([{
          user_id: user.id,
          career_stage: profile.career_stage || null,
          current_role_title: profile.current_role || null,
          current_industry: profile.current_industry || null,
          updated_at: new Date().toISOString()
        }])
      });
    }

    return res.status(200).json({ savedCount: rows.length, claims: rows });
  } catch (err) {
    return res.status(500).json({ error: 'Extraction error', detail: err.message });
  }
}
