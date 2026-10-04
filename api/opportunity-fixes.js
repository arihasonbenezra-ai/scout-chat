export const runtime = 'edge';

// "Apply with these fixes" has to hand over the fixes. For each requirement
// the verdict lists (related experience exists, but the resume does not show
// it at the level the posting asks for), find the resume line that relates
// and rewrite it so the requirement is visible, using only what the resume
// already says. Each rewrite is checked the same way a review's rewrites
// are: the quoted line must be in the resume, and the rewrite may not carry
// a number, a posting-only term, or a level word the resume does not have.
// A rewrite that fails is dropped and the item says so.

// Public anon key — same one already embedded in index.html. Not a secret.
const SUPABASE_URL = 'https://peksgdlfrnymkzlrbsgi.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_rVG6LNvp6Uzs7F6CxSgJlA_zVobq1hy';
const ALLOWED_ORIGINS = ['https://app.meetezzy.com', 'https://meetezzy.com', 'https://scout-chat.vercel.app'];
const MAX_FIXES = 3;

const FIX_SYSTEM = [
  'You are Ezzy, a senior recruiting partner. A candidate is applying to a specific posting. For a short list of requirements, their resume has related experience but does not show it at the level or in the words a screener for this role looks for.',
  '',
  'For EACH requirement given:',
  '- current_line: copy, verbatim, the one line or bullet from the resume that is closest to this requirement. It is checked mechanically; if it is not in the resume the item is discarded.',
  '- rewrite: that same line rewritten so the requirement is visible to a screener. You may reorder, tighten, and re-emphasize, and pull in a fact stated ELSEWHERE in the resume. You may not add any skill, tool, number, scope, or level word the resume does not state, and you may not copy the posting\'s wording into the candidate\'s experience.',
  '- what_changed: one plain sentence, under 25 words, on what the rewrite surfaces and why a screener will see it.',
  '- If the resume has nothing real to build on for a requirement, leave current_line and rewrite empty and set honest_gap to one sentence saying what is absent. Do not invent a bridge.'
].join('\n');

const FIX_TOOL = {
  name: 'record_fixes',
  description: 'Record one resume fix per requirement.',
  input_schema: {
    type: 'object',
    properties: {
      fixes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            requirement: { type: 'string' },
            current_line: { type: 'string' },
            rewrite: { type: 'string' },
            what_changed: { type: 'string' },
            honest_gap: { type: 'string' }
          },
          required: ['requirement']
        }
      }
    },
    required: ['fixes']
  }
};

function corsOrigin(req) {
  var origin = req.headers && (req.headers.origin || req.headers.Origin);
  return ALLOWED_ORIGINS.indexOf(origin) !== -1 ? origin : ALLOWED_ORIGINS[0];
}
function authHeaders(token) { return { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token }; }

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
  } catch (e) { return []; }
}
function hasCareerPlan(sub) {
  if (!sub || sub.status !== 'active' || sub.plan !== 'career') return false;
  if (sub.current_period_end && new Date(sub.current_period_end).getTime() < Date.now()) return false;
  return true;
}

// --- grounding checks (same rules as the resume review guard in chat.js) ---
function normText(t) {
  return String(t || '').toLowerCase()
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[^a-z0-9$%'+.\-]+/g, ' ').trim();
}
var REWRITE_STOP = {};
('drive drove driving driven lead led leading own owned owning build built building manage managed managing deliver delivered delivering partner partnered '
 + 'support supported improve improved increase increased reduce reduced develop developed create created design designed implement implemented launch launched '
 + 'scale scaled grow grew ensure ensured strong experience ability team teams role roles work working across within including year years plus with from into '
 + 'through while using that this these those their your they them have having been being more most over under than then also both each every about after before '
 + 'company companies organization business businesses function functions program programs project projects process processes result results impact goal goals '
 + 'responsible responsibility responsibilities require required requirements preferred candidate candidates position opportunity looking ideal must should will '
 + 'strategy strategic initiative initiatives stakeholder stakeholders cross functional collaborate collaborated collaboration communicate communication skills skill '
 + 'high highly fast paced environment environments global multiple various several key new first full time').split(' ').forEach(function (w) { REWRITE_STOP[w] = true; });
var LEVEL_WORDS = { senior: 1, staff: 1, principal: 1, lead: 1, director: 1, head: 1, vp: 1, executive: 1, chief: 1, manager: 1 };
function stemTok(t) {
  t = String(t || '').toLowerCase().replace(/[^a-z]/g, '');
  if (t.length < 4) return '';
  return t.replace(/(ings?|ed|es|s)$/, '');
}
function stemSet(text) {
  var out = {};
  normText(text).split(' ').forEach(function (t) { var st = stemTok(t); if (st) out[st] = true; });
  return out;
}
// Returns the list of things in `rewrite` that the resume does not support.
function rewriteProblems(rewrite, resumeText, jdText) {
  var srcTokens = normText(resumeText).split(' ');
  var cores = {};
  srcTokens.forEach(function (t) { var c = t.replace(/[^0-9.]/g, '').replace(/\.$/, ''); if (c) cores[c] = true; });
  var resumeStems = stemSet(resumeText), jdStems = stemSet(jdText);
  var bad = [];
  normText(rewrite).split(' ').forEach(function (t) {
    if (/\d/.test(t)) {
      if (srcTokens.indexOf(t) !== -1) return;
      var c = t.replace(/[^0-9.]/g, '').replace(/\.$/, '');
      if (c && cores[c]) return;
      if (bad.indexOf(t) === -1) bad.push(t);
      return;
    }
    var raw = t.replace(/[^a-z]/g, ''), st = stemTok(t);
    if (!raw || REWRITE_STOP[raw] || REWRITE_STOP[st]) return;
    var level = LEVEL_WORDS[raw] && !resumeStems[st] && !resumeStems[raw];
    var imported = st && jdStems[st] && !resumeStems[st];
    if ((level || imported) && bad.indexOf(raw) === -1) bad.push(raw);
  });
  return bad;
}
function quoteInResume(q, resumeText) {
  var n = normText(q);
  return n.length >= 8 && normText(resumeText).indexOf(n) !== -1;
}

// Which requirements the verdict calls fixes: partial ones, required first.
function fixTargets(opp) {
  var reqs = (opp.posting && Array.isArray(opp.posting.requirements)) ? opp.posting.requirements : [];
  var gaps = Array.isArray(opp.fit_reasons) ? opp.fit_reasons : [];
  var imp = {}; reqs.forEach(function (r) { imp[r.requirement] = r.importance; });
  return gaps.filter(function (g) { return g && g.status === 'partial'; })
    .sort(function (a, b) { return (imp[b.requirement] === 'required' ? 1 : 0) - (imp[a.requirement] === 'required' ? 1 : 0); })
    .slice(0, MAX_FIXES)
    .map(function (g) { return { requirement: g.requirement, note: g.note || '', importance: imp[g.requirement] || 'preferred' }; });
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

    var oppId = req.body && typeof req.body.opportunityId === 'string' ? req.body.opportunityId : '';
    if (!/^[0-9a-f-]{16,}$/i.test(oppId)) return res.status(400).json({ error: 'opportunityId required' });
    var opps = await restRows(token, 'career_opportunities?id=eq.' + oppId + '&user_id=eq.' + user.id + '&select=id,role_title,company,jd_text,fit_reasons,posting');
    var opp = opps[0];
    if (!opp) return res.status(404).json({ error: 'Opportunity not found' });

    var targets = fixTargets(opp);
    if (!targets.length) return res.status(200).json({ fixes: [], reason: 'nothing_to_fix' });

    var resumes = await restRows(token, 'conversations?user_id=eq.' + user.id + '&mode=eq.resume&resume_text=not.is.null&select=resume_text,updated_at&order=updated_at.desc&limit=1');
    var resumeText = (resumes[0] && resumes[0].resume_text) || '';
    if (resumeText.trim().length < 200) return res.status(200).json({ fixes: [], reason: 'no_resume' });

    var userContent = [
      'Posting: ' + opp.role_title + (opp.company ? ' at ' + opp.company : ''),
      '',
      'Requirements to make visible (each with what the match found):',
      targets.map(function (t, i) { return (i + 1) + '. ' + t.requirement + (t.note ? ' - match note: ' + t.note : ''); }).join('\n'),
      '',
      'Resume:',
      resumeText
    ].join('\n');
    const ar = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5', max_tokens: 1500, system: FIX_SYSTEM,
        messages: [{ role: 'user', content: userContent }],
        tools: [FIX_TOOL], tool_choice: { type: 'tool', name: 'record_fixes' }
      })
    });
    const data = await ar.json();
    if (!ar.ok) return res.status(502).json({ error: 'Could not write the fixes', detail: JSON.stringify(data).slice(0, 300) });
    const tu = (data.content || []).find(function (b) { return b.type === 'tool_use'; });
    var out = tu && tu.input && Array.isArray(tu.input.fixes) ? tu.input.fixes : [];

    var dropped = 0;
    var fixes = targets.map(function (t) {
      var got = out.find(function (o) { return o && String(o.requirement || '').toLowerCase().trim() === t.requirement.toLowerCase().trim(); }) || {};
      var cur = String(got.current_line || '').trim(), rw = String(got.rewrite || '').trim();
      var item = { requirement: t.requirement, importance: t.importance, current_line: '', rewrite: '', what_changed: '', honest_gap: String(got.honest_gap || '').trim().slice(0, 300) };
      if (cur && rw) {
        var grounded = quoteInResume(cur, resumeText);
        var problems = grounded ? rewriteProblems(rw, resumeText, opp.jd_text || '') : [];
        if (grounded && !problems.length) {
          item.current_line = cur.slice(0, 600); item.rewrite = rw.slice(0, 600); item.what_changed = String(got.what_changed || '').trim().slice(0, 240);
          item.honest_gap = '';
        } else {
          dropped++;
          item.honest_gap = grounded
            ? 'Ezzy drafted a rewrite but it used something your resume does not state (' + problems.slice(0, 4).join(', ') + '), so it was thrown out. If that is true of you, add it to your resume and try again.'
            : 'Ezzy could not point to a line on your resume for this one, so there is no rewrite to offer.';
        }
      } else if (!item.honest_gap) {
        item.honest_gap = 'Nothing on your resume to build on for this one.';
      }
      return item;
    });
    if (dropped) console.log('[opp-fixes] dropped', dropped);

    var saved = { items: fixes, resume_date: resumes[0].updated_at, generated_at: new Date().toISOString() };
    try {
      await fetch(SUPABASE_URL + '/rest/v1/career_opportunities?id=eq.' + oppId + '&user_id=eq.' + user.id, {
        method: 'PATCH',
        headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders(token)),
        body: JSON.stringify({ posting: Object.assign({}, opp.posting || {}, { fixes: saved }) })
      });
    } catch (e) { /* showing the fixes matters more than caching them */ }

    return res.status(200).json({ fixes: fixes, resume_date: saved.resume_date, generated_at: saved.generated_at });
  } catch (err) {
    return res.status(500).json({ error: 'Fixes error', detail: err.message });
  }
}
