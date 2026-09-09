export const runtime = 'edge';

// Public anon key — same one already embedded in index.html. Not a secret.
const SUPABASE_URL = 'https://peksgdlfrnymkzlrbsgi.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_rVG6LNvp6Uzs7F6CxSgJlA_zVobq1hy';
const ALLOWED_ORIGINS = ['https://app.meetezzy.com', 'https://meetezzy.com', 'https://scout-chat.vercel.app'];

const REQUIREMENTS_SYSTEM = [
  'Extract the most important requirements from this job description.',
  'Return at most 10 - the ones that would actually distinguish a strong candidate from a weak one, not boilerplate like "team player" or "excellent communication".',
  'category is one of: experience, skill, competency, technical, domain, education, other.',
  'importance is "required" if the JD treats it as a must-have, "preferred" if it reads as a nice-to-have.'
].join('\n');

const REQUIREMENTS_TOOL = {
  name: 'record_job_requirements',
  description: 'Record structured requirements extracted from a job description.',
  input_schema: {
    type: 'object',
    properties: {
      requirements: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            requirement: { type: 'string' },
            category: { type: 'string', enum: ['experience', 'skill', 'competency', 'technical', 'domain', 'education', 'other'] },
            importance: { type: 'string', enum: ['required', 'preferred'] }
          },
          required: ['requirement', 'category', 'importance']
        }
      }
    },
    required: ['requirements']
  }
};

const GAP_SYSTEM = [
  "You are Ezzy, assessing how well a candidate matches a target job's requirements.",
  "You are given the job's requirements, the candidate's resume, and additional career evidence Ezzy already has about this candidate from earlier sessions (may be empty).",
  '',
  'For every requirement, decide:',
  '- "matched": clearly demonstrated in the resume or known evidence.',
  '- "partial": related experience exists but does not fully cover the requirement.',
  '- "missing": no supporting evidence anywhere provided.',
  '',
  'Ground every judgment in the material given. Do not guess, assume, or go easy to be encouraging - an honest "missing" is more useful than a flattering "partial".',
  'Keep each note under 20 words.'
].join('\n');

const GAP_TOOL = {
  name: 'record_gap_analysis',
  description: 'Record how well the candidate matches each job requirement.',
  input_schema: {
    type: 'object',
    properties: {
      gaps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            requirement: { type: 'string' },
            status: { type: 'string', enum: ['matched', 'partial', 'missing'] },
            note: { type: 'string' }
          },
          required: ['requirement', 'status', 'note']
        }
      }
    },
    required: ['gaps']
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
  if (!claims || !claims.length) return 'None yet.';
  return claims.map(function (c) {
    var quote = c.evidence && c.evidence[0] && c.evidence[0].quote;
    return '- [' + c.claim_type + '] ' + c.label + ' (' + c.status + ')' + (quote ? ' - "' + quote + '"' : '');
  }).join('\n');
}

async function anthropicToolCall(model, system, userContent, tool, maxTokens) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: model,
      max_tokens: maxTokens,
      system: system,
      messages: [{ role: 'user', content: userContent }],
      tools: [tool],
      tool_choice: { type: 'tool', name: tool.name }
    })
  });
  const data = await res.json();
  const toolUse = (data.content || []).find(function (b) { return b.type === 'tool_use'; });
  return toolUse ? toolUse.input : null;
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
    if (!resumeText || !jdText) return res.status(400).json({ error: 'resumeText and jdText required' });

    var reqOutput = await anthropicToolCall(
      'claude-haiku-4-5', REQUIREMENTS_SYSTEM, 'Job description:\n\n' + jdText,
      REQUIREMENTS_TOOL, 1200
    );
    var requirements = (reqOutput && Array.isArray(reqOutput.requirements)) ? reqOutput.requirements.slice(0, 10) : [];
    if (!requirements.length) return res.status(200).json({ requirements: [], gaps: [] });

    var claims = await fetchKnownClaims(token, user.id);
    var userContent = [
      'Job requirements:',
      requirements.map(function (r, i) { return (i + 1) + '. [' + r.importance + '] ' + r.requirement; }).join('\n'),
      '',
      'Candidate resume:',
      resumeText,
      '',
      'Additional known evidence about this candidate from earlier sessions:',
      claimsToText(claims)
    ].join('\n');

    var gapOutput = await anthropicToolCall('claude-sonnet-4-5', GAP_SYSTEM, userContent, GAP_TOOL, 1500);
    var gaps = (gapOutput && Array.isArray(gapOutput.gaps)) ? gapOutput.gaps : [];

    return res.status(200).json({ requirements: requirements, gaps: gaps });
  } catch (err) {
    return res.status(500).json({ error: 'Gap analysis error', detail: err.message });
  }
}
