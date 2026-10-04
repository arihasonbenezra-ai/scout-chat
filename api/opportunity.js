export const runtime = 'edge';
import { fetchDescription } from './_jobs.js';

// Opportunities: a pasted posting -> a career_opportunities row with a fit
// score computed here, not by the model. The model does two bounded jobs:
// read the posting (company, role, stated facts, requirements) and grade
// each requirement against the candidate's evidence. Every number in a
// grading note must exist in that evidence or the row is downgraded, same
// rule as api/gap-analysis.js.

// Public anon key — same one already embedded in index.html. Not a secret.
const SUPABASE_URL = 'https://peksgdlfrnymkzlrbsgi.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_rVG6LNvp6Uzs7F6CxSgJlA_zVobq1hy';
const ALLOWED_ORIGINS = ['https://app.meetezzy.com', 'https://meetezzy.com', 'https://scout-chat.vercel.app'];

const POSTING_SYSTEM = [
  'You are reading a job posting for a career-coaching product. Record only what the posting itself states. Never guess a company, location, level, or salary that is not written in the text; leave the field out instead.',
  'company: the hiring company name as written. role_title: the job title as written.',
  'location: city/region if stated. work_type: remote | hybrid | onsite only if the posting says so.',
  'level: one of entry, mid, senior, staff, principal, manager, director, vp, exec, only if the posting states or clearly implies it (e.g. "Senior" in the title).',
  'comp_min / comp_max: annual base salary in whole currency units, only if a range or figure is printed in the posting.',
  'requirements: at most 10, the ones that would distinguish a strong candidate from a weak one, not boilerplate like "team player". importance is "required" if the posting treats it as a must-have, "preferred" if it reads as a nice-to-have.'
].join('\n');

const POSTING_TOOL = {
  name: 'record_job_posting',
  description: 'Record the facts a job posting states and its key requirements.',
  input_schema: {
    type: 'object',
    properties: {
      company: { type: 'string' },
      role_title: { type: 'string' },
      location: { type: 'string' },
      work_type: { type: 'string', enum: ['remote', 'hybrid', 'onsite'] },
      level: { type: 'string', enum: ['entry', 'mid', 'senior', 'staff', 'principal', 'manager', 'director', 'vp', 'exec'] },
      comp_min: { type: 'number' },
      comp_max: { type: 'number' },
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
    required: ['role_title', 'requirements']
  }
};

const GAP_SYSTEM = [
  "You are Ezzy, assessing how well a candidate matches a job's requirements.",
  "You are given the requirements and everything Ezzy knows about the candidate: their most recent resume (may be absent), profile facts, and career claims each backed by a quote.",
  '',
  'For every requirement, decide:',
  '- "matched": the evidence shows this exact thing, at the level and scope the requirement names. Direct evidence, not adjacent evidence.',
  '- "partial": related experience exists but the level, scope, function, or specificity differs. Partial is the default whenever you have to reason from adjacent experience.',
  '- "missing": no supporting evidence anywhere provided.',
  '',
  'A recruiter will check this against the resume. Calibrate like one: ten matched is a red flag, not a compliment. Ground every judgment in the material given. Do not guess, assume, or go easy to be encouraging.',
  'Notes: under 20 words, and every number in a note must be copied from the evidence exactly (they are checked mechanically; a number not in the evidence downgrades the match).'
].join('\n');

const GAP_TOOL = {
  name: 'record_gap_analysis',
  description: 'Record how well the candidate matches each requirement.',
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

function authHeaders(token) {
  return { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token };
}

async function getAuthedUser(token) {
  if (!token) return null;
  var res = await fetch(SUPABASE_URL + '/auth/v1/user', { headers: authHeaders(token) });
  if (!res.ok) return null;
  var data = await res.json();
  return data && data.id ? data : null;
}

async function restRows(token, path) {
  try {
    var res = await fetch(SUPABASE_URL + '/rest/v1/' + path, { headers: authHeaders(token) });
    if (!res.ok) return [];
    return await res.json();
  } catch (e) {
    return [];
  }
}

function hasCareerPlan(sub) {
  if (!sub || sub.status !== 'active' || sub.plan !== 'career') return false;
  if (sub.current_period_end && new Date(sub.current_period_end).getTime() < Date.now()) return false;
  return true;
}

function claimsToText(claims) {
  if (!claims || !claims.length) return 'None.';
  return claims.map(function (c) {
    var quote = c.evidence && c.evidence[0] && c.evidence[0].quote;
    var prof = c.detail && c.detail.proficiency ? ', ' + c.detail.proficiency : '';
    return '- [' + c.claim_type + prof + '] ' + c.label + ' (' + c.status + ')' + (quote ? ' - "' + quote + '"' : '');
  }).join('\n');
}

function profileToText(p) {
  if (!p) return 'None.';
  var bits = [];
  if (p.current_role_title) bits.push('Current role: ' + p.current_role_title + (p.current_industry ? ' (' + p.current_industry + ')' : ''));
  if (p.years_experience) bits.push('Years of experience: ' + p.years_experience);
  if (p.seniority_level) bits.push('Seniority: ' + p.seniority_level);
  if (p.target_role_title) bits.push('Target role: ' + p.target_role_title + (p.target_level ? ', ' + p.target_level : ''));
  return bits.length ? bits.join('\n') : 'None.';
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

// Weighted by what the posting says matters. Required counts double.
function fitScore(requirements, gaps) {
  var byReq = {};
  gaps.forEach(function (g) { if (g && g.requirement) byReq[g.requirement] = g.status; });
  var got = 0, max = 0;
  requirements.forEach(function (r) {
    var w = r.importance === 'required' ? 2 : 1;
    max += w;
    var st = byReq[r.requirement];
    if (st === 'matched') got += w;
    else if (st === 'partial') got += w / 2;
  });
  if (!max) return null;
  return Math.round((got / max) * 100);
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

    var subs = await restRows(token, 'subscriptions?user_id=eq.' + user.id + '&select=plan,status,current_period_end');
    if (!hasCareerPlan(subs[0])) return res.status(403).json({ error: 'upgrade_required' });

    var body = req.body || {};
    var jdText = typeof body.jdText === 'string' ? body.jdText.trim().slice(0, 20000) : '';
    var url = typeof body.url === 'string' ? body.url.trim().slice(0, 500) : '';
    if (!/^https?:\/\//i.test(url)) url = '';

    // A role picked from "Roles for you": the posting is read from the
    // company's own job-board feed now, not from what the candidate pasted.
    var listing = null, listingKey = null;
    if (typeof body.listingId === 'string' && /^[0-9a-f-]{16,}$/i.test(body.listingId)) {
      var ls = await restRows(token, 'job_listings?id=eq.' + body.listingId + '&select=id,company,title,location,url,ats,slug,external_id');
      listing = ls[0];
      if (!listing) return res.status(404).json({ error: 'listing_not_found' });
      listingKey = listing.ats + ':' + listing.slug + ':' + listing.external_id;
      // Checked before: hand back the same opportunity instead of scoring twice.
      var prior = await restRows(token, 'career_opportunities?user_id=eq.' + user.id + '&source=eq.job_feed&external_id=eq.' + encodeURIComponent(listingKey) + '&select=*&limit=1');
      if (prior[0]) return res.status(200).json({ opportunity: prior[0], existing: true });
      var desc = '';
      try { desc = await fetchDescription(listing.ats, listing.slug, listing.external_id); }
      catch (e) { return res.status(502).json({ error: 'listing_unavailable', detail: String(e && e.message || e).slice(0, 160) }); }
      jdText = [listing.title, listing.company, listing.location ? 'Location: ' + listing.location : '', '', desc].join('\n').trim().slice(0, 20000);
      url = listing.url;
    }
    // A requirement list can only come from a real posting; a one-liner
    // would make the model invent requirements and then grade against them.
    var jdLines = jdText.split(/\n/).filter(function (l) { return l.trim(); }).length;
    if (!jdText || (jdText.length < 400 && jdLines < 4)) {
      return res.status(400).json({ error: 'posting_too_short' });
    }

    // 1. What the posting states.
    var posting = await anthropicToolCall('claude-haiku-4-5', POSTING_SYSTEM, 'Job posting:\n\n' + jdText, POSTING_TOOL, 1500);
    if (!posting || !posting.role_title) return res.status(502).json({ error: 'Could not read that posting' });
    var requirements = Array.isArray(posting.requirements) ? posting.requirements.slice(0, 10) : [];
    var meta = {
      location: posting.location ? String(posting.location).slice(0, 120) : null,
      work_type: posting.work_type || null,
      level: posting.level || null,
      comp_min: typeof posting.comp_min === 'number' && posting.comp_min > 0 ? Math.round(posting.comp_min) : null,
      comp_max: typeof posting.comp_max === 'number' && posting.comp_max > 0 ? Math.round(posting.comp_max) : null,
      requirements: requirements
    };

    // 2. Everything Ezzy knows about the candidate.
    var evidence = await Promise.all([
      restRows(token, 'career_profile?user_id=eq.' + user.id + '&select=*'),
      restRows(token, 'career_claims?user_id=eq.' + user.id + '&select=claim_type,label,status,detail,evidence&order=last_seen_at.desc&limit=40'),
      restRows(token, 'conversations?user_id=eq.' + user.id + '&mode=eq.resume&resume_text=not.is.null&select=resume_text&order=created_at.desc&limit=1')
    ]);
    var profile = evidence[0][0] || null;
    var claims = evidence[1] || [];
    var resumeText = (evidence[2][0] && evidence[2][0].resume_text) || '';
    var hasEvidence = !!(resumeText || claims.length);

    // 3. Grade each requirement, then score here.
    var gaps = [];
    var unverified = 0;
    if (hasEvidence && requirements.length) {
      var userContent = [
        'Job requirements:',
        requirements.map(function (r, i) { return (i + 1) + '. [' + r.importance + '] ' + r.requirement; }).join('\n'),
        '',
        'Candidate profile:',
        profileToText(profile),
        '',
        'Candidate claims (each with the quote it rests on):',
        claimsToText(claims),
        '',
        'Most recent resume:',
        resumeText || '(none on file)'
      ].join('\n');
      var gapOutput = await anthropicToolCall('claude-sonnet-4-5', GAP_SYSTEM, userContent, GAP_TOOL, 1500);
      gaps = (gapOutput && Array.isArray(gapOutput.gaps)) ? gapOutput.gaps : [];

      var normT = function (t) { return String(t || '').toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z0-9$%'+.\-]+/g, ' ').trim(); };
      var srcText = resumeText + '\n' + profileToText(profile) + '\n' + claimsToText(claims);
      var srcTokens = normT(srcText).split(' ');
      var cores = {};
      srcTokens.forEach(function (t) { var c = t.replace(/[^0-9.]/g, '').replace(/\.$/, ''); if (c) cores[c] = true; });
      gaps = gaps.filter(function (g) { return g && g.requirement && g.status; }).map(function (g) {
        var bad = normT(g.note).split(' ').filter(function (t) {
          if (!/\d/.test(t) || srcTokens.indexOf(t) !== -1) return false;
          var c = t.replace(/[^0-9.]/g, '').replace(/\.$/, '');
          return c && !cores[c];
        });
        if (!bad.length) return { requirement: g.requirement, status: g.status, note: String(g.note || '').slice(0, 240) };
        unverified++;
        return {
          requirement: g.requirement,
          status: g.status === 'matched' ? 'partial' : g.status,
          note: 'Evidence not verified against your profile (' + bad.join(', ') + ' not found). Treat as partial.'
        };
      });
      if (unverified) console.log('[opp-guard] unverified notes', unverified);
    }
    var score = hasEvidence ? fitScore(requirements, gaps) : null;

    // 4. Save.
    var row = {
      user_id: user.id,
      company: listing ? listing.company : (posting.company ? String(posting.company).slice(0, 120) : null),
      role_title: listing ? String(listing.title).slice(0, 160) : String(posting.role_title).slice(0, 160),
      source: listing ? 'job_feed' : 'pasted_jd',
      external_id: listingKey,
      url: url || null,
      jd_text: jdText,
      fit_score: score,
      fit_reasons: gaps,
      posting: meta,
      stage: 'considering',
      updated_at: new Date().toISOString()
    };
    var ins = await fetch(SUPABASE_URL + '/rest/v1/career_opportunities?select=*', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json', Prefer: 'return=representation' }, authHeaders(token)),
      body: JSON.stringify([row])
    });
    if (!ins.ok) return res.status(502).json({ error: 'Could not save the opportunity', detail: await ins.text() });
    var saved = await ins.json();
    return res.status(200).json({ opportunity: saved[0], hasEvidence: hasEvidence, unverified: unverified });
  } catch (err) {
    return res.status(500).json({ error: 'Opportunity error', detail: err.message });
  }
}
