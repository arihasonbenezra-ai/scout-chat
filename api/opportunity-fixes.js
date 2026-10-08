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
 + 'high highly fast paced environment environments global multiple various several key new first full time '
 + 'when where what which whose whom while were been being have does doing done this that these those there their them they then than with without within into onto from over under about above below between among after before during until since because although though whether either neither both each every some many much more most less least very just only also even still such same other another your yours hers ours will would could should shall might must need needs make makes made making take takes took taken give gives gave given well good best better able like across through along around toward towards upon here time times ways thing things part level levels range area areas type types kind used uses using help helped helps helping works worked bring brings brought show shows showed shown keep kept hold held running getting turn turned move moved them itself themselves what whenever wherever however therefore instead rather than once again always never often').split(' ').forEach(function (w) { REWRITE_STOP[w] = true; });
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
// Same word in a different form counts as the same word: "partnered" on the
// resume covers "partnership" in a rewrite. Exact stem, or one is a prefix
// of the other once both are at least five letters.
function hasStem(set, st) {
  if (!st) return false;
  if (set[st]) return true;
  if (st.length < 5) return false;
  for (var k in set) {
    if (k.length >= 5 && (k.indexOf(st) === 0 || st.indexOf(k) === 0)) return true;
  }
  return false;
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
    var level = LEVEL_WORDS[raw] && !hasStem(resumeStems, st) && !resumeStems[raw];
    var imported = st && hasStem(jdStems, st) && !hasStem(resumeStems, st);
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

    // The profile carries the latest resume from any entry point (onboarding
    // or a review); the review row is the fallback for accounts from before
    // the profile column existed.
    var sources = await Promise.all([
      restRows(token, 'career_profile?user_id=eq.' + user.id + '&select=resume_text,resume_updated_at'),
      restRows(token, 'conversations?user_id=eq.' + user.id + '&mode=eq.resume&resume_text=not.is.null&select=resume_text,updated_at&order=updated_at.desc&limit=1')
    ]);
    var onProfile = sources[0][0] && sources[0][0].resume_text ? { text: sources[0][0].resume_text, when: sources[0][0].resume_updated_at } : null;
    var onReview = sources[1][0] && sources[1][0].resume_text ? { text: sources[1][0].resume_text, when: sources[1][0].updated_at } : null;
    var resume = onProfile || onReview || { text: '', when: null };
    var resumeText = resume.text;
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
    var callModel = async function (content, system) {
      const ar = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5', max_tokens: 1500, system: system,
          messages: [{ role: 'user', content: content }],
          tools: [FIX_TOOL], tool_choice: { type: 'tool', name: 'record_fixes' }
        })
      });
      const data = await ar.json();
      if (!ar.ok) throw new Error(JSON.stringify(data).slice(0, 300));
      const tu = (data.content || []).find(function (b) { return b.type === 'tool_use'; });
      return tu && tu.input && Array.isArray(tu.input.fixes) ? tu.input.fixes : [];
    };
    // Grade one model item against the resume. ok = usable rewrite;
    // problems = what the draft used that the resume does not state.
    var grade = function (t, got) {
      got = got || {};
      var cur = String(got.current_line || '').trim(), rw = String(got.rewrite || '').trim();
      var gap = String(got.honest_gap || '').trim().slice(0, 300);
      if (!cur || !rw) return { ok: false, tried: false, gap: gap, problems: [] };
      if (!quoteInResume(cur, resumeText)) return { ok: false, tried: true, ungrounded: true, gap: gap, problems: [] };
      var problems = rewriteProblems(rw, resumeText, opp.jd_text || '');
      if (problems.length) return { ok: false, tried: true, gap: gap, problems: problems };
      return { ok: true, current_line: cur.slice(0, 600), rewrite: rw.slice(0, 600), what_changed: String(got.what_changed || '').trim().slice(0, 240) };
    };
    var pick = function (list, t) { return list.find(function (o) { return o && String(o.requirement || '').toLowerCase().trim() === t.requirement.toLowerCase().trim(); }); };

    var out;
    try { out = await callModel(userContent, FIX_SYSTEM); }
    catch (e) { return res.status(502).json({ error: 'Could not write the fixes', detail: e.message }); }
    var graded = targets.map(function (t) { return grade(t, pick(out, t)); });

    // One corrective pass for drafts that reached past the resume.
    var redo = targets.filter(function (t, i) { return !graded[i].ok && graded[i].tried; });
    if (redo.length) {
      var correction = FIX_SYSTEM + '\n\nYour first drafts for these were rejected by a mechanical check:\n'
        + targets.map(function (t, i) {
            var g = graded[i];
            if (g.ok || !g.tried) return null;
            return '- "' + t.requirement + '": ' + (g.ungrounded ? 'current_line was not found in the resume; copy a line exactly as it appears.' : 'the rewrite used words or numbers the resume does not contain: ' + g.problems.join(', ') + '.');
          }).filter(Boolean).join('\n')
        + '\nWrite them again. Do not echo the requirement\'s own wording; describe what the candidate did using the resume\'s own vocabulary and figures. If that cannot be done honestly, use honest_gap.';
      var redoContent = userContent.replace(/Requirements to make visible[\s\S]*?\n\nResume:/, 'Requirements to make visible:\n' + redo.map(function (t, i) { return (i + 1) + '. ' + t.requirement; }).join('\n') + '\n\nResume:');
      try {
        var out2 = await callModel(redoContent, correction);
        targets.forEach(function (t, i) {
          if (graded[i].ok || !graded[i].tried) return;
          var g2 = grade(t, pick(out2, t));
          if (g2.ok || (!g2.tried && g2.gap)) graded[i] = g2;
          else if (g2.problems && g2.problems.length) graded[i].problems = g2.problems;
        });
      } catch (e) { console.error('[opp-fixes] retry failed', e && e.message); }
    }

    var dropped = 0;
    var fixes = targets.map(function (t, i) {
      var g = graded[i];
      var item = { requirement: t.requirement, importance: t.importance, current_line: '', rewrite: '', what_changed: '', honest_gap: '' };
      if (g.ok) { item.current_line = g.current_line; item.rewrite = g.rewrite; item.what_changed = g.what_changed; return item; }
      if (g.tried) {
        dropped++;
        item.honest_gap = g.ungrounded
          ? 'Ezzy could not tie this one to a specific line on your resume, so there is no rewrite to offer.'
          : 'Ezzy could not write this one from your resume alone. Its drafts kept reaching for something your resume does not say (' + g.problems.slice(0, 4).join(', ') + '). If you have a concrete example of this, add a line about it to your resume and try again.';
      } else {
        item.honest_gap = g.gap || 'Your resume has nothing concrete to build on for this one. It is better shown in the interview than forced into a bullet.';
      }
      return item;
    });
    if (dropped) console.log('[opp-fixes] dropped after retry', dropped);

    var saved = { items: fixes, resume_date: resume.when, generated_at: new Date().toISOString() };
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
