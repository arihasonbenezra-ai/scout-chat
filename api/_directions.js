// Directions: three to five roles a person could actually win, built from
// two real sources. What their resume proves, and what they said they
// want in a ten-question quiz. Served through api/extract (action:
// 'directions') because the deployment is at its function cap. The model
// proposes; every quote is checked against the resume or the answers and
// a direction without one of each is dropped; open-role counts come from
// the feed, not the model.
const SUPABASE_URL = 'https://peksgdlfrnymkzlrbsgi.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_rVG6LNvp6Uzs7F6CxSgJlA_zVobq1hy';

export const QUESTIONS = [
  ['q1', 'If you could spend all day on one kind of work, what would it be?'],
  ['q2', 'What part of your last role drained you?'],
  ['q3', 'What part of it did you not want to hand off to anyone?'],
  ['q4', 'People, systems, or ideas: which do you want more of?'],
  ['q5', 'How fast do you want the place to move?'],
  ['q6', 'How do you want to be measured?'],
  ['q7', 'Lead, build, or advise?'],
  ['q8', 'If money were not the question, what would you do?'],
  ['q9', 'What do people come to you for?'],
  ['q10', 'What have you been told you are good at that you do not use enough?']
];

const SYSTEM = [
  'You are a recruiter who has placed people across many functions. From a candidate\'s resume and their answers to ten short questions, propose three to five role directions they could actually win, as real job-board titles (for example "Recruiting Manager", "Customer Success Manager", "Talent Operations Lead"), not personality labels.',
  'At least one direction should be one they would not have searched for themselves, adjacent to what the resume proves rather than the obvious next title.',
  'For each direction: resume_quotes are one to three passages copied verbatim from the resume that show they could do it; answer_quotes are one or two passages copied verbatim from their answers that show they would want it. Both are checked mechanically: a quote that is not verbatim is thrown away, and a direction left without one of each is thrown away.',
  'why: under 40 words, plain, specific to this person. gap: the one thing they would need to close or show, under 25 words. No praise, no personality types, nothing the text does not support.'
].join('\n');

const TOOL = {
  name: 'record_directions',
  description: 'Record the role directions for this candidate.',
  input_schema: { type: 'object', properties: { directions: { type: 'array', items: { type: 'object', properties: {
    title: { type: 'string', description: 'A job-board title.' },
    why: { type: 'string' },
    resume_quotes: { type: 'array', items: { type: 'string' } },
    answer_quotes: { type: 'array', items: { type: 'string' } },
    gap: { type: 'string' },
    unexpected: { type: 'boolean', description: 'True when this is the one they would not have searched for.' }
  }, required: ['title', 'why', 'resume_quotes', 'answer_quotes', 'gap'] } } }, required: ['directions'] }
};

function normText(t) {
  return String(t || '').toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^a-z0-9$%'+.\-]+/g, ' ').trim();
}
function hdr(token) { return { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token }; }
function svc() { return { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY }; }

export function answersToText(a) {
  a = a || {};
  return QUESTIONS.filter(function (q) { return a[q[0]] && String(a[q[0]]).trim(); })
    .map(function (q) { return q[1] + '\n' + String(a[q[0]]).trim(); }).join('\n\n');
}

export function verify(directions, resumeNorm, answersNorm) {
  var kept = [], dropped = 0;
  (directions || []).forEach(function (d) {
    if (!d || !d.title) return;
    var rq = (d.resume_quotes || []).map(function (q) { return String(q || '').trim(); }).filter(function (q) { var n = normText(q); return n.length >= 8 && resumeNorm.indexOf(n) !== -1; }).slice(0, 3);
    var aq = (d.answer_quotes || []).map(function (q) { return String(q || '').trim(); }).filter(function (q) { var n = normText(q); return n.length >= 4 && answersNorm.indexOf(n) !== -1; }).slice(0, 2);
    if (!rq.length || !aq.length) { dropped++; return; }
    kept.push({ title: String(d.title).slice(0, 80), why: String(d.why || '').slice(0, 300), resume_quotes: rq.map(function (q) { return q.slice(0, 240); }), answer_quotes: aq.map(function (q) { return q.slice(0, 240); }), gap: String(d.gap || '').slice(0, 200), unexpected: !!d.unexpected });
  });
  return { items: kept.slice(0, 5), dropped: dropped };
}

async function openCount(title) {
  try {
    var res = await fetch(SUPABASE_URL + '/rest/v1/rpc/role_summary', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, svc()), body: JSON.stringify({ q: title, places: [] }) });
    if (!res.ok) return null;
    var s = await res.json();
    return s && typeof s.all === 'number' ? s.all : null;
  } catch (e) { return null; }
}

export async function handleDirections(req, res, user, token) {
  var body = req.body || {};
  var answers = {};
  QUESTIONS.forEach(function (q) { var v = body.answers && body.answers[q[0]]; if (typeof v === 'string' && v.trim()) answers[q[0]] = v.trim().slice(0, 300); });
  if (Object.keys(answers).length < 5) return res.status(400).json({ error: 'answers_required', message: 'Answer at least five of the ten.' });

  var rows = await Promise.all([
    fetch(SUPABASE_URL + '/rest/v1/career_profile?user_id=eq.' + user.id + '&select=resume_text,wants,current_role_title,years_experience,target_role_title', { headers: hdr(token) }).then(function (r) { return r.ok ? r.json() : []; }, function () { return []; }),
    fetch(SUPABASE_URL + '/rest/v1/career_claims?user_id=eq.' + user.id + '&claim_type=eq.skill&select=label&limit=40', { headers: hdr(token) }).then(function (r) { return r.ok ? r.json() : []; }, function () { return []; })
  ]);
  var profile = rows[0][0] || {};
  var resume = String(profile.resume_text || '');
  if (resume.trim().length < 200) return res.status(400).json({ error: 'resume_required', message: 'Add your resume first; the directions are built from it.' });
  var skills = (rows[1] || []).map(function (c) { return c.label; }).filter(Boolean);
  var answersText = answersToText(answers);

  var userContent = ['Current role: ' + (profile.current_role_title || 'not stated') + (profile.years_experience ? ', ' + profile.years_experience + ' years of experience' : ''),
    skills.length ? 'Skills on file: ' + skills.join(', ') : '', '', 'Their answers:', answersText, '', 'Their resume:', resume.slice(0, 9000)].join('\n');
  var r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: 2500, output_config: { effort: 'high' }, system: SYSTEM, messages: [{ role: 'user', content: userContent }], tools: [TOOL], tool_choice: { type: 'tool', name: TOOL.name } })
  });
  var data = await r.json();
  var tu = (data.content || []).find(function (b) { return b.type === 'tool_use'; });
  if (!r.ok || !tu) {
    var why = data && data.error ? (data.error.type + ': ' + data.error.message) : 'no tool_use';
    console.error('[directions] ' + r.status + ' ' + why);
    return res.status(502).json({ error: 'Could not work out directions', detail: String(why).slice(0, 300) });
  }
  var v = verify(tu.input.directions, normText(resume), normText(answersText));
  var counts = await Promise.all(v.items.map(function (d) { return openCount(d.title); }));
  v.items.forEach(function (d, i) { d.open_now = counts[i]; });
  var result = { items: v.items, dropped: v.dropped, checked_at: new Date().toISOString() };

  // Keep the answers and the result on the profile, beside what they want.
  var wants = Object.assign({}, profile.wants || {}, { quiz: answers, directions: result });
  await fetch(SUPABASE_URL + '/rest/v1/career_profile?user_id=eq.' + user.id, {
    method: 'PATCH', headers: Object.assign({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }, hdr(token)), body: JSON.stringify({ wants: wants, wants_updated_at: new Date().toISOString() })
  });
  return res.status(200).json({ directions: result, answers: answers });
}
