// Is it for you? Served through api/opportunity (action: 'wants') because
// the deployment is at its function cap; this file is a helper, not a
// function of its own. The posting (and the research brief when there is one)
// read against what the candidate said they want from the next role.
// The model sorts their own statements into fits / rubs / can't tell,
// quoting their words and the posting's words; the server keeps an item
// only when both quotes are real, then works out the stance itself.
const SUPABASE_URL = 'https://peksgdlfrnymkzlrbsgi.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_rVG6LNvp6Uzs7F6CxSgJlA_zVobq1hy';
const ALLOWED_ORIGINS = ['https://app.meetezzy.com', 'https://meetezzy.com', 'https://scout-chat.vercel.app'];

const SYSTEM = [
  'You read a job posting, and a research brief when one is given, against what a candidate says they want from their next role.',
  'For each thing they said, decide whether this role fits it, rubs against it, or cannot be told from the text.',
  'your_words: copy their words verbatim. source_quote: copy the posting or brief verbatim. Both are checked mechanically and an item with words that are not there is thrown away.',
  'Say nothing about the company beyond what the text says. When the text does not settle a point, mark it unknown and write the one question that would settle it in an interview.',
  'Three to six items. An item that rubs against a non-negotiable matters most. Notes are plain, under 30 words, no praise.'
].join('\n');

const TOOL = {
  name: 'record_fit_for_you',
  description: 'Record how the role reads against what the candidate wants.',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            bucket: { type: 'string', enum: ['fits', 'rubs', 'unknown'] },
            your_words: { type: 'string', description: 'Exact words copied from what the candidate wants (4-120 chars).' },
            source_quote: { type: 'string', description: 'Exact words copied from the posting or brief (8-200 chars). Empty for unknown.' },
            note: { type: 'string', description: 'Why, in under 30 words.' },
            question: { type: 'string', description: 'For unknown: the question to ask the interviewer. Else empty.' }
          },
          required: ['bucket', 'your_words', 'note']
        }
      }
    },
    required: ['items']
  }
};

function normText(t) {
  return String(t || '').toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^a-z0-9$%'+.\-]+/g, ' ').trim();
}
function normalizeKey(s) { return (s || '').toLowerCase().trim().replace(/\s+/g, ' '); }

export var WANT_FIELDS = [
  ['pull', 'What pulls me in'], ['cold', 'What leaves me cold'], ['musts', 'Non-negotiables'], ['optimizing', 'This move is for']
];
export function wantsToText(w) {
  w = w || {};
  var lines = WANT_FIELDS.filter(function (f) { return w[f[0]] && String(w[f[0]]).trim(); }).map(function (f) { return f[1] + ': ' + String(w[f[0]]).trim(); });
  return lines.length ? lines.join('\n') : '';
}
function fieldOf(w, words) {
  var n = normText(words);
  for (var i = 0; i < WANT_FIELDS.length; i++) {
    var k = WANT_FIELDS[i][0];
    if (w[k] && normText(w[k]).indexOf(n) !== -1) return k;
  }
  return null;
}

async function fetchBrief(company) {
  if (!company || !process.env.SUPABASE_SERVICE_ROLE_KEY) return '';
  try {
    var res = await fetch(SUPABASE_URL + '/rest/v1/company_research_cache?company_key=eq.' + encodeURIComponent(normalizeKey(company)) + '&select=brief&order=created_at.desc&limit=1',
      { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY } });
    if (!res.ok) return '';
    var rows = await res.json();
    return rows && rows[0] ? String(rows[0].brief || '') : '';
  } catch (e) { return ''; }
}

export function stanceFor(items) {
  var fits = items.filter(function (i) { return i.bucket === 'fits'; }).length;
  var rubs = items.filter(function (i) { return i.bucket === 'rubs'; });
  var unknown = items.filter(function (i) { return i.bucket === 'unknown'; }).length;
  var q = function (i) { return '\u201c' + i.your_words + '\u201d'; };
  // A non-negotiable crossed is a pass. A domain they called cold is never
  // outweighed by small fits; it is the thing to test. Everything else
  // is counted.
  var must = rubs.filter(function (i) { return i.about === 'musts'; })[0];
  if (must) return { key: 'pass', title: 'Looks like a pass', why: 'It runs against ' + q(must) + ', which you called a non-negotiable.' };
  var cold = rubs.filter(function (i) { return i.about === 'cold'; })[0];
  if (cold) return { key: 'test', title: 'Not sure yet', why: 'You said ' + q(cold) + ' leaves you cold, and that is what they do. ' + (fits ? 'The rest fits. ' : '') + 'Talk it through before you decide.' };
  if (rubs.length && rubs.length >= fits) return { key: 'test', title: 'Not sure yet', why: 'As much rubs against what you said as fits it, starting with ' + q(rubs[0]) + '. Test it before you decide.' };
  if (fits) return { key: 'pursue', title: 'Worth pursuing', why: unknown ? 'It lines up with what you said, with a question or two to settle in the interview.' : 'It lines up with what you said you want.' };
  if (unknown) return { key: 'test', title: 'Not sure yet', why: 'The posting does not say enough. The questions below would settle it.' };
  return { key: 'none', title: 'Nothing to go on', why: 'Nothing in the posting could be matched to what you said.' };
}

export function verify(items, wants, sourceNorm) {
  var wantsNorm = normText(wantsToText(wants));
  var kept = [], dropped = 0;
  (items || []).forEach(function (it) {
    if (!it || ['fits', 'rubs', 'unknown'].indexOf(it.bucket) === -1) return;
    var yw = String(it.your_words || '').trim();
    var sq = String(it.source_quote || '').trim();
    var ywn = normText(yw);
    if (ywn.length < 4 || wantsNorm.indexOf(ywn) === -1) { dropped++; return; }
    if (it.bucket !== 'unknown') {
      var sqn = normText(sq);
      if (sqn.length < 8 || sourceNorm.indexOf(sqn) === -1) { dropped++; return; }
    } else if (!String(it.question || '').trim()) { dropped++; return; }
    kept.push({ bucket: it.bucket, about: fieldOf(wants, yw), your_words: yw.slice(0, 160), source_quote: it.bucket === 'unknown' ? '' : sq.slice(0, 240),
      note: String(it.note || '').slice(0, 220), question: it.bucket === 'unknown' ? String(it.question || '').slice(0, 220) : '' });
  });
  return { items: kept.slice(0, 8), dropped: dropped };
}

// Called from api/opportunity after auth and the plan check.
export async function handleWants(req, res, user, token, restRows, authHeaders) {
  try {
    var body = req.body || {};
    var oppId = typeof body.opportunityId === 'string' && /^[0-9a-f-]{16,}$/i.test(body.opportunityId) ? body.opportunityId : '';
    if (!oppId) return res.status(400).json({ error: 'opportunityId required' });
    var rows = await Promise.all([
      restRows(token, 'career_opportunities?id=eq.' + oppId + '&user_id=eq.' + user.id + '&select=id,company,role_title,jd_text,posting'),
      restRows(token, 'career_profile?user_id=eq.' + user.id + '&select=wants')
    ]);
    var opp = rows[0][0];
    if (!opp) return res.status(404).json({ error: 'opportunity_not_found' });
    var wants = (rows[1][0] && rows[1][0].wants) || {};
    var wantsText = wantsToText(wants);
    if (!wantsText) return res.status(400).json({ error: 'wants_required' });

    var brief = await fetchBrief(opp.company);
    var jd = String(opp.jd_text || '').slice(0, 12000);
    var sourceText = jd + (brief ? '\n\nResearch brief:\n' + brief.slice(0, 6000) : '');
    var userContent = ['Role: ' + opp.role_title + (opp.company ? ' at ' + opp.company : ''), '', 'What the candidate wants:', wantsText, '', 'The posting:', jd, brief ? '\nResearch brief on the company:\n' + brief.slice(0, 6000) : ''].join('\n');

    var r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: 1500, system: SYSTEM, messages: [{ role: 'user', content: userContent }], tools: [TOOL], tool_choice: { type: 'tool', name: TOOL.name } })
    });
    var data = await r.json();
    var tu = (data.content || []).find(function (b) { return b.type === 'tool_use'; });
    if (!r.ok || !tu) {
      var why = data && data.error ? (data.error.type + ': ' + data.error.message) : 'no tool_use';
      console.error('[opportunity-wants] ' + r.status + ' ' + why);
      return res.status(502).json({ error: 'Could not read the posting against what you want', detail: String(why).slice(0, 300) });
    }
    var v = verify(tu.input.items, wants, normText(sourceText));
    var result = { stance: stanceFor(v.items), items: v.items, dropped: v.dropped, used_brief: !!brief, checked_at: new Date().toISOString() };

    var posting = Object.assign({}, opp.posting || {}, { wants: result });
    await fetch(SUPABASE_URL + '/rest/v1/career_opportunities?id=eq.' + oppId + '&user_id=eq.' + user.id, {
      method: 'PATCH', headers: Object.assign({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }, authHeaders(token)), body: JSON.stringify({ posting: posting })
    });
    return res.status(200).json({ wants: result });
  } catch (err) {
    return res.status(500).json({ error: 'Fit-for-you error', detail: err && err.message });
  }
}
