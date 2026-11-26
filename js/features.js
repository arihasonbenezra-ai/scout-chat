
// Career Brain v0 — extraction + "what Ezzy knows about you" panel

// Resolves with the API result ({savedCount, claims}) or null. The toast
// is for extraction that happens in the background of a chat; onboarding
// passes quiet=true and shows the result itself.
async function extractCareerClaims(resumeText, jdText, quiet){
  if(!window.supabaseClient) return null;
  try{
    var sessionRes = await window.supabaseClient.auth.getSession();
    var session = sessionRes.data && sessionRes.data.session;
    if(!session) return null; // anonymous - extraction is a signed-in feature for now

    var res = await fetch(EXTRACT_URL, {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token},
      body: JSON.stringify({resumeText: resumeText||'', jdText: jdText||''})
    });
    if(!res.ok) return null;
    var data = await res.json();
    if(!quiet && data.savedCount > 0) showLearnedToast(data.savedCount);
    return data;
  }catch(e){ console.error('Career Brain extraction error:', e); return null; }
}

function showLearnedToast(count){
  var el = document.createElement('div');
  el.className = 'learned-toast';
  el.innerHTML = 'Ezzy learned ' + count + (count===1?' thing':' things') + ' about you · <a onclick="goToDashboard();">See it on My Career</a>';
  document.body.appendChild(el);
  setTimeout(function(){
    el.classList.add('out');
    setTimeout(function(){ el.remove(); }, 300);
  }, 5000);
}

var BRAIN_PROFILE = null;

// --- Plan (which version of Ezzy this account gets) ---------------------
window._plan = null;
async function loadPlan(uid){
  try{
    var r = await window.supabaseClient.from('subscriptions').select('plan,status,current_period_end,resume_review_credits').eq('user_id', uid).maybeSingle();
    window._plan = r.data || null;
  }catch(e){ window._plan = null; }
}
// Back from Stripe. The webhook that writes the subscription row lands a
// few seconds after the redirect, so the plan loaded at boot is still the
// old one. Poll until the row shows what was bought (or give up quietly),
// then redraw whatever the plan gates: the account menu, the locked
// dashboard preview, and the Career home.
var PENDING_CHECKOUT = null;
async function settleCheckout(uid){
  var pc = PENDING_CHECKOUT; if(!pc) return;
  PENDING_CHECKOUT = null;
  var plan = pc.plan;
  var landed = function(){
    var p = window._plan;
    if(plan === 'resume_review') return !!(p && p.resume_review_credits > 0);
    return planActive() && p.plan === plan;
  };
  var tries = 0;
  while(!landed() && tries < 15){
    await new Promise(function(r){ setTimeout(r, 2000); });
    await loadPlan(uid);
    tries++;
  }
  var ok = landed();
  console.log('[checkout] plan', plan, ok ? 'active after ' + tries + ' polls' : 'not visible after ' + tries + ' polls');
  var msg;
  if(plan === 'resume_review') msg = ok ? 'Your resume review is paid for. Start it whenever you\u2019re ready.' : 'Payment received. Your review unlocks in a minute; refresh if it hasn\u2019t.';
  else if(plan === 'job_search') msg = ok ? 'Job Search is unlocked for 90 days.' : 'Payment received. Job Search unlocks in a minute; refresh if it hasn\u2019t.';
  else msg = ok ? 'Welcome to the Career plan.' : 'Payment received. Your plan activates in a minute; refresh if it hasn\u2019t.';
  showSimpleToast(msg);
  if(!ok) return;
  closePricingModal();
  renderPlanMenuItem();
  if(DASH_ON) loadDashboard();
  else if(isCareerPlan() && !MODE) showDashboard();
}
function planActive(){
  var p = window._plan;
  if(!p || p.status !== 'active') return false;
  if(p.current_period_end && new Date(p.current_period_end).getTime() < Date.now()) return false;
  return true;
}
function isCareerPlan(){ return planActive() && window._plan.plan === 'career'; }
function planLabel(){
  if(!planActive()) return 'Free plan';
  var p = window._plan.plan;
  return p === 'career' ? 'Career plan' : p === 'job_search' ? 'Job Search plan' : 'Free plan';
}
// Account menu is just the plan and sign out. Everything about the person
// lives on My Career.
function renderPlanMenuItem(){
  var ci = document.getElementById('authCancelItem'); if(ci) ci.style.display = planActive() && window._plan && window._plan.plan !== 'free' ? '' : 'none';
  var el = document.getElementById('authPlanItem');
  if(!el) return;
  var label = planLabel();
  el.innerHTML = '<span>' + label + '</span>' + (label === 'Career plan' ? '' : '<span class="header-user-dropdown-hint">Upgrade</span>');
}

// --- My Career dashboard (signed-in home) ------------------------------
// Everything shown here is read from tables the app already writes:
// career_profile, career_claims, prep_scores, conversations (archived),
// career_stories, career_opportunities. Nothing is computed by a model.
var DASH_ON = false;
// Where on the dashboard the person is, kept in the address bar so a
// refresh comes back to the same view. Only these shapes are ours; the
// auth flow also uses the hash and must be left alone.
var DASH_HASH_RE = /^(opp\/[0-9a-f-]{8,}|opps\/new|opps|sessions|roles)$/i;
var DASH_BOOT_HASH = (function(){ var h = String(window.location.hash || '').replace(/^#/, ''); return DASH_HASH_RE.test(h) ? h : null; })();
function setDashHash(h){
  try{
    var cur = String(window.location.hash || '').replace(/^#/, '');
    if(cur === (h || '')) return;
    if(!h && cur && !DASH_HASH_RE.test(cur)) return; // not ours to clear
    window.history.replaceState(null, '', window.location.pathname + (window.location.search || '') + (h ? '#' + h : ''));
  }catch(e){}
}
// Returns true when the hash named a view and it was opened.
function routeDashHash(h){
  var m;
  if((m = /^opp\/(.+)$/i.exec(h))){ dashShowOpportunity(m[1]); return true; }
  if(h === 'opps/new'){ dashAddOpportunity(); return true; }
  if(h === 'opps'){ dashShowOpportunities(); return true; }
  if(h === 'sessions'){ dashShowSessions(); return true; }
  if(h === 'roles'){ dashShowRoles(); return true; }
  if(h === 'help'){ dashShowHelp(); return true; }
  if(h === 'directions'){ dashShowDirections(); return true; }
  return false;
}

// --- Directions ------------------------------------------------------------
// The second front door: no target in mind. Ten questions in their own
// words plus the resume on file. The server (api/extract, action
// 'directions') proposes three to five job-board titles, keeps only the
// ones it can quote from both the resume and the answers, and counts the
// open roles for each from the feed. A tap sets one as the target.
var DIR_QUESTIONS = [
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
function dashShowDirections(edit){
  if(!DASH_ON) showDashboard(true);
  var body = document.getElementById('dashBody');
  if(!body) return;
  setDashHash('directions');
  var p = DASH_PROFILE || {};
  var w = p.wants || {};
  var hasResume = !!(p.resume_text || p.resume_updated_at);
  var D = w.directions && Array.isArray(w.directions.items) ? w.directions : null;
  var inner;
  if(!hasResume){
    inner = '<div class="dash-empty"><div class="dash-empty-t">Add your resume first</div><div class="dash-empty-s">The directions are built from what your resume proves, matched against what you say you want. Without it there is nothing to ground them in.</div><button class="dash-btn" onclick="dashResume()">Add your resume</button></div>';
  } else if(!D || edit){
    var a = w.quiz || {};
    inner = '<div class="dash-text">Ten questions, in your own words. Short answers are fine; five is enough to start. Ezzy reads them against your resume and comes back with three to five roles you could win, each with the evidence.</div>'
      + '<div class="dir-form">' + DIR_QUESTIONS.map(function(q, i){
        return '<div class="dir-q"><label for="' + q[0] + '">' + (i + 1) + '. ' + escapeHtml(q[1]) + '</label><input id="' + q[0] + '" class="dash-input" type="text" maxlength="300" value="' + escapeHtml(a[q[0]] || '') + '"/></div>';
      }).join('') + '</div>'
      + '<div class="onb-foot"><button class="dash-btn primary" id="dirGo" onclick="dashRunDirections()">Show me directions</button><span class="dash-muted" id="dirStatus">Takes about twenty seconds.</span></div>'
      + (D ? '<div style="margin-top:8px"><button class="dash-link" onclick="dashShowDirections(false)">Back to your directions</button></div>' : '');
  } else {
    inner = '<div class="dash-text">Built from your resume and your answers on ' + dashDate(D.checked_at) + '. Every quote is yours; the open-role counts are live from the companies\u2019 own boards.</div>'
      + '<div class="dir-list">' + D.items.map(function(d, i){
        return '<div class="dir-card' + (d.unexpected ? ' unexpected' : '') + '"><div class="dir-head"><div class="dir-title">' + escapeHtml(d.title) + (d.unexpected ? ' <span class="dash-tag coral">One you might not have searched</span>' : '') + '</div>'
          + '<span class="dash-row-s">' + (d.open_now == null ? 'Open-role count unavailable' : d.open_now === 0 ? 'None open in Ezzy\u2019s feed right now' : d.open_now + ' open now in Ezzy\u2019s feed') + '</span></div>'
          + '<div class="dash-text">' + escapeHtml(d.why) + '</div>'
          + '<div class="dir-ev"><div class="opp-sub">From your resume</div>' + d.resume_quotes.map(function(q){ return '<div class="dir-quote">\u201c' + escapeHtml(q) + '\u201d</div>'; }).join('') + '</div>'
          + '<div class="dir-ev"><div class="opp-sub">In your words</div>' + d.answer_quotes.map(function(q){ return '<div class="dir-quote">\u201c' + escapeHtml(q) + '\u201d</div>'; }).join('') + '</div>'
          + (d.gap ? '<div class="dash-text"><strong>To close:</strong> ' + escapeHtml(d.gap) + '</div>' : '')
          + '<div class="opp-fix-actions"><button class="dash-btn primary" onclick="dashSetDirection(' + i + ')">Set as my target</button>' + (d.gap && isCareerPlan() ? '<button class="dash-link" onclick="dashDirectionStory(' + i + ')">Build the story for this gap</button>' : '') + '</div></div>';
      }).join('') + '</div>'
      + '<div class="dash-muted">' + (D.dropped ? D.dropped + (D.dropped === 1 ? ' direction was' : ' directions were') + ' dropped because Ezzy could not quote your resume or your answers for them. ' : '') + 'Set one as your target and roles, prep and scores all point at it.</div>'
      + '<div class="opp-fix-actions" style="margin-top:4px"><button class="dash-link" onclick="dashShowDirections(true)">Change my answers</button><button class="dash-link" onclick="dashRunDirections()">Run again</button></div>';
  }
  body.innerHTML = dashView('Directions', 'Roles you could win, from what your resume proves and what you say you want.', 'My Career', 'loadDashboard()', inner);
  body.parentNode.scrollTop = 0;
}
async function dashRunDirections(){
  var p = DASH_PROFILE || {}; var w = p.wants || {};
  var answers = {};
  var any = false;
  DIR_QUESTIONS.forEach(function(q){ var el = document.getElementById(q[0]); var v = el ? el.value.trim() : (w.quiz && w.quiz[q[0]]) || ''; if(v){ answers[q[0]] = v; any = true; } });
  if(Object.keys(answers).length < 5){ var st0 = document.getElementById('dirStatus'); if(st0) st0.textContent = 'Answer at least five.'; return; }
  var body = document.getElementById('dashBody');
  var go = document.getElementById('dirGo'); if(go){ go.disabled = true; go.textContent = 'Reading...'; }
  var st = document.getElementById('dirStatus'); if(st) st.textContent = 'Reading your resume against your answers...';
  if(!go && body) body.innerHTML = dashView('Directions', 'Roles you could win, from what your resume proves and what you say you want.', 'My Career', 'loadDashboard()', '<div class="dash-muted">Reading your resume against your answers...</div>');
  try{
    var token = await getAuthTokenIfSignedIn(); if(!token) throw new Error('Sign in first.');
    var res = await fetch('/api/extract', { method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer ' + token }, body: JSON.stringify({ action: 'directions', answers: answers }) });
    var data = await res.json().catch(function(){ return {}; });
    if(!res.ok) throw new Error((data.message || data.error || 'Could not work out directions') + (data.detail ? ': ' + data.detail : ''));
    DASH_PROFILE = Object.assign({}, p, { wants: Object.assign({}, w, { quiz: data.answers, directions: data.directions }) });
    if(!data.directions.items.length){ DASH_PROFILE.wants.directions = null; if(st) st.textContent = 'Nothing Ezzy could ground in both your resume and your answers. Try fuller answers.'; if(go){ go.disabled = false; go.textContent = 'Show me directions'; } return; }
    dashShowDirections(false);
  }catch(e){
    if(go){ go.disabled = false; go.textContent = 'Show me directions'; }
    if(st) st.textContent = String(e && e.message || e); else dashShowDirections(true);
  }
}
// A direction's gap becomes a STAR session aimed at it; the story it
// produces lands in the bank, and Mock asks about it.
function dashDirectionStory(i){
  var p = DASH_PROFILE || {}; var D = p.wants && p.wants.directions; var d = D && D.items[i]; if(!d || !d.gap) return;
  window._practiceFocus = { role: d.title, company: '', items: [{ requirement: d.gap, status: 'missing', note: 'to close for ' + d.title }] };
  window._practiceOpportunityId = null;
  dashStartMode(d.title, 'star', 'STAR Coaching');
}
async function dashSetDirection(i){
  var p = DASH_PROFILE || {}; var D = p.wants && p.wants.directions; var d = D && D.items[i]; if(!d) return;
  var sr = await window.supabaseClient.auth.getSession(); var uid = sr.data && sr.data.session && sr.data.session.user.id; if(!uid) return;
  var row = { user_id: uid, target_role_title: d.title, target_source: 'discovered', target_set_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  var up = await window.supabaseClient.from('career_profile').upsert(row, { onConflict: 'user_id' });
  if(up.error){ showSimpleToast('Could not save that just now.'); return; }
  showSimpleToast(d.title + ' is your target now.');
  loadDashboard();
}

// How Ezzy works, and the questions people ask. Plain words, one page,
// reached from the menu under your initial. Copy is Ari's to tune.
function dashShowHelp(){
  if(!DASH_ON) showDashboard(true);
  var body = document.getElementById('dashBody');
  if(!body) return;
  setDashHash('help');
  var part = function(t, s){ return '<div class="help-part"><div class="help-t">' + t + '</div><div class="dash-text">' + s + '</div></div>'; };
  var inner = '<div class="dash-text" style="font-size:17px">One coach that knows your resume, your target and your last session. Nothing on My Career is a guess: every number and claim links back to your resume, your answers, or a source. Here is what each part does and when to use it.</div>'
    + '<div class="dash-label" style="margin-top:8px">The parts</div>'
    + part('My Career', 'Home. Your target, what Ezzy knows about you, your latest scorecard, open roles that fit, and the opportunities you\u2019re chasing. Start here, and come back here.')
    + part('Resume Review', 'Drop your resume, and a posting if you have one. You get a recruiter-style review with a scorecard and rewrites built only from what your resume already says. Ezzy keeps what it learns about you. Dropping a new resume replaces the old one.')
    + part('Practice Q&amp;A', 'Five interview questions for your target role. Feedback on each one quotes your own words. After the fifth you get a scorecard, every mark tied to something you said.')
    + part('STAR Coaching', 'Build one story at a time: situation, task, action, result. Each story you tell is saved to your story bank in your own words, and Mock Interview asks about them. From a Direction or an opportunity, STAR aims at the gaps that need a story.')
    + part('Mock Interview', 'The full thing, in character, with a skeptical hiring manager: vague answers get pushed back on, outcomes get asked for their baseline. No feedback until the debrief. Turn on Voice next to the mic and the interviewer speaks.')
    + part('Company Research', 'A dated brief on a company with real, linked sources, including what employees say on the review sites. Nothing without a source.')
    + part('Roles for you', 'Open roles from the companies\u2019 own job boards, matched to your target, newest first. Check my fit reads the whole posting and gives a verdict with the reasons.')
    + part('Directions', 'No target in mind? Ten questions in your own words, read against your resume. Three to five roles you could win, each with the resume lines and the answers that back it, the one thing to close, and how many are open right now. One tap makes it your target.')
    + part('Talk through an opportunity', 'A recruiter reached out, or a posting caught your eye, and you\u2019re not sure. Say what it is. A short conversation, one question at a time, that ends with a stance in your own terms. Ezzy remembers what you learn about yourself along the way, with your say-so.')
    + '<div class="dash-label" style="margin-top:8px">Questions</div>'
    + part('Does Ezzy make things up?', 'No, and it is checked, not promised. A piece of feedback that quotes words you never said is removed and you are told. A suggestion that includes a number you never gave is dropped. A research sentence without a source is marked. If you ever catch something that slipped through, email hello@meetezzy.com.')
    + part('What does the free plan include?', 'Enough to see how Ezzy works: a basic resume review, a Practice set, and the roles that match your target.')
    + part('What is in the Career plan?', 'Everything. Unlimited practice, STAR coaching and mock interviews with scorecards, full resume reviews, company research with employer ratings, Check my fit on any role, talking through any opportunity, and your story bank and opportunity tracker. $19.99 a month.')
    + part('How do I cancel?', 'Click your initial at the top right, then Cancel subscription. Billing stops; you keep access to the end of the month you paid for, then the account drops to Free.')
    + part('How do I replace my resume?', 'Start a Resume Review and drop the new one, or use Replace next to \u201cResume on file\u201d on My Career. The new one takes over everywhere.')
    + part('Where does my information go?', 'Your resume, answers and profile are stored for your account so Ezzy can remember you between sessions. They are sent to the AI model only to produce your coaching. Nothing is sold or shared. To delete everything, click your initial at the top right, then Delete my account. It is gone within a minute.')
    + part('Does it work on my phone?', 'Yes, in the browser. No app to install.')
    + part('Who built this?', 'Recruiters and hiring managers from top companies, who got tired of watching good candidates lose to bad preparation.');
  body.innerHTML = dashView('How Ezzy works', 'What each part does, and the questions people ask.', 'My Career', 'loadDashboard()', inner);
  body.parentNode.scrollTop = 0;
}
var DASH_ROLE = null;
var DASH_PROFILE = null;

function showDashboard(skipLoad){
  var el = document.getElementById('dashboard');
  if(!el) return;
  if(emptyState) emptyState.style.display = 'none';
  setInputAreaVisible(false);
  if(modePill) modePill.style.display = 'none';
  if(roleLabel) roleLabel.style.display = 'none';
  if(dotSep) dotSep.style.display = 'none';
  var sob=document.getElementById('startOverBtn'); if(sob) sob.classList.remove('show');
  el.classList.add('show');
  var mi = document.getElementById('mainInner'); if(mi) mi.style.display = 'none';
  DASH_ON = true;
  var nav = document.getElementById('navHome'); if(nav) nav.classList.remove('off');
  syncBackToOpp();
  if(!skipLoad) loadDashboard();
}

function hideDashboard(){
  var el = document.getElementById('dashboard');
  if(el) el.classList.remove('show');
  var mi = document.getElementById('mainInner'); if(mi) mi.style.display = '';
  DASH_ON = false;
  var nav = document.getElementById('navHome'); if(nav) nav.classList.add('off');
  syncBackToOpp();
  if(!DASH_BOOT_HASH) setDashHash('');
}

function goToDashboard(){
  if(isSending) return;
  clearChatState();
  showDashboard();
}

// Entry points from the dashboard straight into a tool, skipping the
// landing's pick-a-role step when the role is already known.
function dashStartMode(role, modeId, title){
  hideDashboard();
  if(!role){ clearChatState(); pickTopIntent('prep'); return; }
  ROLE = role; window.ROLE = role;
  defaultTargetFromRole(role);
  enterAppShell(role);
  inputEl.disabled = false;
  inputEl.placeholder = 'Type your answer...';
  startMode(modeId, title);
}
function dashPractice(){ window._practiceFocus = null; window._practiceOpportunityId = null; dashStartMode(DASH_ROLE, 'practice', 'Practice Q&A'); }
// Defend your resume: the requirements of one posting the resume only
// partly meets, required ones first, as the brief for a Practice set.
window._practiceFocus = null; window._practiceOpportunityId = null;
function oppFocus(o){
  if(!o) return null;
  var reqs = (o.posting && Array.isArray(o.posting.requirements)) ? o.posting.requirements : [];
  var imp = {}; reqs.forEach(function(r){ imp[r.requirement] = r.importance; });
  var gaps = (Array.isArray(o.fit_reasons) ? o.fit_reasons : []).filter(function(g){ return g.status === 'partial' || g.status === 'missing'; })
    .sort(function(a, b){ return ((imp[b.requirement] === 'required') ? 1 : 0) - ((imp[a.requirement] === 'required') ? 1 : 0); }).slice(0, 6);
  // The round they are in and what they wrote right after the last one,
  // from the newest logged outcome that has them.
  var outs = (o.id === (OPP_CURRENT && OPP_CURRENT.id) ? (OPP_OUTCOMES || []) : (o._outcomes || []));
  var last = outs.filter(function(x){ return x.detail && (x.detail.round || x.detail.debrief); })[0];
  var round = last && last.detail.round ? last.detail.round : (last && last.kind === 'recruiter_screen' ? 'recruiter screen' : '');
  var debrief = last && last.detail.debrief ? last.detail.debrief : null;
  if(!gaps.length && !round && !debrief) return null;
  return { role: o.role_title, company: o.company || '', items: gaps.map(function(g){ return { requirement: g.requirement, status: g.status, note: g.note || '' }; }), round: round, debrief: debrief };
}
async function practiceFocusFromOpportunity(id){
  try{
    var r = await window.supabaseClient.from('career_opportunities').select('id,company,role_title,posting,fit_reasons').eq('id', id).maybeSingle();
    if(r.data){
      try{ var oc = await window.supabaseClient.from('career_outcomes').select('kind,detail,created_at').eq('opportunity_id', id).order('created_at',{ascending:false}).limit(10); r.data._outcomes = oc.data || []; }catch(e){}
      window._practiceFocus = oppFocus(r.data); window._practiceOpportunityId = r.data.id;
    }
  }catch(e){}
}
// Talk through an opportunity that may not be in Ezzy at all: a recruiter
// reached out, a friend mentioned it. Starts from what they say.
function dashDecide(){
  if(!isCareerPlan()){ openPricingModal(); return; }
  window._decideOpportunityId = null;
  var role = DASH_ROLE || (DASH_PROFILE && DASH_PROFILE.current_role_title) || 'Your next role';
  dashStartMode(role, 'decide', 'Talk through an opportunity');
}
function dashStar(){ dashStartMode(DASH_ROLE, 'star', 'STAR Coaching'); }
// From the dashboard, Resume review means a new review. A review still in
// progress is archived first (it stays in Sessions, read-only); the Live
// row in Sessions is how you go back to one on purpose.
async function dashResume(){
  hideDashboard();
  ROLE = null; window.ROLE = null;
  enterAppShell(null);
  resumeDropDismissed = false;
  inputEl.disabled = false;
  inputEl.placeholder = 'Type your answer...';
  await startMode('resume', 'Resume Feedback');
  if(RESUME_STAGE !== 'awaiting_resume') await startNewResumeReview();
}
function dashResearch(){
  hideDashboard();
  if(!DASH_ROLE){ clearChatState(); pickTopIntent('prep'); return; }
  ROLE = DASH_ROLE; window.ROLE = DASH_ROLE;
  enterAppShell(DASH_ROLE);
  pickIntent('research');
}

var DASH_CLAIMS = [];
var DASH_CLAIMS_OPEN = false;
var DASH_CLAIM_LABELS = { skill:'Skills', achievement:'Achievements', experience:'Experience', goal:'Goals', preference:'Preferences', hypothesis:'Hypotheses' };
function dashClaimChips(open){
  var skills = DASH_CLAIMS.filter(function(c){ return c.claim_type==='skill'; });
  if(!open){
    var rest = DASH_CLAIMS.length - Math.min(4, skills.length);
    return skills.slice(0,4).map(function(c){ return '<span class="dash-chip coral">' + escapeHtml(c.label) + '</span>'; }).join('')
      + (rest > 0 ? '<button class="dash-chip more" onclick="toggleDashClaims()">+ ' + rest + ' more</button>' : '');
  }
  var canEdit = isCareerPlan();
  var groups = {};
  DASH_CLAIMS.forEach(function(c){ (groups[c.claim_type] = groups[c.claim_type] || []).push(c); });
  var html = '';
  if(canEdit){
    html += '<div class="dash-add"><input id="dashSkillInput" type="text" placeholder="Add a skill Ezzy missed..." onkeydown="if(event.key===\'Enter\')dashAddSkill()"/><button class="dash-btn" onclick="dashAddSkill()">Add</button></div>';
  }
  // Open list: every claim with where it came from and the line it rests on.
  html += '<div class="dash-claims-list">';
  ['skill','experience','achievement','goal','preference','hypothesis'].forEach(function(t){
    if(!groups[t]) return;
    html += '<div class="dash-claims-group">' + DASH_CLAIM_LABELS[t] + '</div>';
    html += groups[t].map(function(c){
      var ev = (c.evidence && c.evidence[0] && c.evidence[0].quote) || '';
      if(c.evidence && c.evidence[0] && c.evidence[0].source === 'user') ev = '';
      var prof = t==='skill' && c.detail && c.detail.proficiency ? '<span class="brain-prof">' + escapeHtml(c.detail.proficiency) + '</span>' : '';
      return '<div class="dash-claim" data-claim="' + c.id + '"><div class="dash-claim-top"><span class="dash-claim-label">' + escapeHtml(c.label) + prof + '</span>'
        + '<span class="dash-claim-right"><span class="brain-status ' + escapeHtml(c.status) + '">' + claimStatusLabel(c) + '</span>'
        + (canEdit ? '<button class="dash-chip-x" onclick="dashRemoveClaim(\'' + c.id + '\')" aria-label="Remove">&times;</button>' : '') + '</span></div>'
        + (ev ? '<div class="dash-claim-ev">\u201c' + escapeHtml(ev) + '\u201d</div>' : '') + '</div>';
    }).join('');
  });
  html += '</div><button class="dash-chip more" onclick="toggleDashClaims()">Show less</button>';
  return html;
}
function toggleDashClaims(){
  DASH_CLAIMS_OPEN = !DASH_CLAIMS_OPEN;
  var el = document.getElementById('dashClaims');
  if(el) el.innerHTML = dashClaimChips(DASH_CLAIMS_OPEN);
  var t = document.getElementById('dashClaimsToggle');
  if(t) t.textContent = DASH_CLAIMS_OPEN ? 'Show less' : 'See all';
}
async function dashRemoveClaim(id){
  if(!window.supabaseClient) return;
  var chip = document.querySelector('[data-claim="' + id + '"]');
  if(chip) chip.style.opacity = '0.4';
  var r = await window.supabaseClient.from('career_claims').delete().eq('id', id);
  if(r.error){ if(chip) chip.style.opacity = '1'; console.error('remove claim', r.error); return; }
  DASH_CLAIMS = DASH_CLAIMS.filter(function(c){ return c.id !== id; });
  var el = document.getElementById('dashClaims');
  if(el) el.innerHTML = dashClaimChips(DASH_CLAIMS_OPEN);
}
async function dashAddSkill(){
  var input = document.getElementById('dashSkillInput');
  if(!input || !window.supabaseClient) return;
  var label = (input.value||'').trim().slice(0,200);
  if(!label) return;
  var sessionRes = await window.supabaseClient.auth.getSession();
  var session = sessionRes.data && sessionRes.data.session;
  if(!session) return;
  input.disabled = true;
  var r = await window.supabaseClient.from('career_claims').upsert({
    user_id: session.user.id, claim_type:'skill', label: label, status:'fact', detail:{},
    evidence:[{source:'user', quote:'Added by you', date:new Date().toISOString().slice(0,10)}],
    last_seen_at: new Date().toISOString()
  }, {onConflict:'user_id,claim_type,label'}).select('id,claim_type,label,status,detail,evidence').single();
  input.disabled = false;
  if(r.error){ console.error('add skill', r.error); return; }
  DASH_CLAIMS = DASH_CLAIMS.filter(function(c){ return c.id !== r.data.id; });
  DASH_CLAIMS.unshift(r.data);
  var el = document.getElementById('dashClaims');
  if(el) el.innerHTML = dashClaimChips(true);
  var again = document.getElementById('dashSkillInput'); if(again) again.focus();
}

// The weakest verified dimension of a resume score, for the card and Do next.
function dashResumeLow(rs){
  if(!rs || !Array.isArray(rs.dimensions)) return null;
  var scored = rs.dimensions.filter(function(x){ return x.score != null; }).slice().sort(function(a,b){ return a.score - b.score || b.weight - a.weight; });
  return scored[0] || null;
}
function dashGreeting(name){
  var h = new Date().getHours();
  var part = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  return part + (name ? ', ' + escapeHtml(name.split(' ')[0]) : '') + '.';
}
// A date-only value ("2026-10-04") is a calendar day. Parsed bare it is
// midnight UTC, which is the evening before in the Americas; pin it to
// local noon so the day shown is the day that was picked.
function dashDate(iso){
  try{
    var d = /^\d{4}-\d{2}-\d{2}$/.test(String(iso)) ? new Date(iso + 'T12:00:00') : new Date(iso);
    return d.toLocaleDateString(undefined,{month:'short',day:'numeric'});
  }catch(e){ return ''; }
}
// Today as the person's own calendar day, not UTC's.
function localDateStr(d){
  d = d || new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function dashComp(p){
  if(!p.target_comp_min && !p.target_comp_max) return null;
  var k=function(v){ if(!v) return ''; if(v > 10000000) v = v/1000; return '$' + Math.round(v/1000) + 'k'; };
  var lo=k(p.target_comp_min), hi=k(p.target_comp_max);
  return lo && hi ? lo + '\u2013' + hi : (lo || hi);
}
function dashRoleFamily(role){
  var r = String(role||'').toLowerCase();
  if(!r) return null;
  if(/recruit|talent|\bhr\b|human resources|people ops|people partner|sourcer/.test(r)) return 'People & Talent';
  if(/engineer|developer|\bswe\b|\bsde\b|\bdata\b|\bml\b|machine learning|devops|infra|\bsre\b|architect|scientist|analyst/.test(r)) return 'Engineering';
  if(/marketing|sales|account exec|customer success|growth|brand|\bseo\b|content|revenue|\bbdr\b|\bsdr\b/.test(r)) return 'Go-to-market';
  if(/product|designer|design|\bux\b|\bui\b|program manager|project manager|operations|\bops\b|\btpm\b/.test(r)) return 'Product / Design / Ops';
  return 'General';
}

async function loadDashboard(){
  OPP_RETURN = null;
  var body = document.getElementById('dashBody');
  if(!body || !window.supabaseClient) return;
  var sessionRes = await window.supabaseClient.auth.getSession();
  var session = sessionRes.data && sessionRes.data.session;
  if(!session){ body.innerHTML = '<div class="dash-loading">Sign in to see your career.</div>'; return; }
  var uid = session.user.id;
  var sb = window.supabaseClient;
  var q = await Promise.all([
    sb.from('career_profile').select('*').eq('user_id', uid).maybeSingle(),
    sb.from('career_claims').select('id,claim_type,label,status,detail,evidence').eq('user_id', uid).order('last_seen_at',{ascending:false}),
    sb.from('prep_scores').select('id,mode,role,family,dimensions,overall,scored_dims,total_dims,created_at,conversation_id').eq('user_id', uid).order('created_at',{ascending:false}).limit(8),
    sb.from('conversations').select('id,mode,role,archived_at,created_at,updated_at,answer_count,readiness_score,research_company,resume_stage,research_stage').eq('user_id', uid).order('updated_at',{ascending:false}).limit(12),
    sb.from('career_stories').select('id,title,competencies,status,result').eq('user_id', uid).order('updated_at',{ascending:false}).limit(3),
    sb.from('career_opportunities').select('id,company,role_title,stage,fit_score,updated_at,posting,url').eq('user_id', uid).order('updated_at',{ascending:false}).limit(25),
    sb.from('resume_scores').select('id,conversation_id,overall,dimensions,scored_dims,total_dims,created_at,has_posting').eq('user_id', uid).order('created_at',{ascending:false}).limit(1)
  ].map(function(pr){ return pr.then(function(r){ return r; }, function(e){ return {error:e}; }); }));
  var profile = (q[0] && q[0].data) || {};
  var claims = (q[1] && q[1].data) || [];
  var scores = (q[2] && q[2].data) || [];
  var past = ((q[3] && q[3].data) || []).filter(dashSessionHasContent).slice(0,3);
  var stories = (q[4] && q[4].data) || [];
  var opps = (q[5] && q[5].data) || [];
  var resumeScore = (q[6] && q[6].data && q[6].data[0]) || null;
  var nameEl = document.getElementById('authUserName');
  var name = nameEl ? nameEl.textContent.trim() : '';
  var latest = scores[0] || null;
  var lastRole = latest && latest.role ? latest.role : (past[0] && past[0].role) || null;
  DASH_ROLE = profile.target_role_title || lastRole || null;
  DASH_PROFILE = profile; BRAIN_PROFILE = profile;
  var d = { name:name, profile:profile, claims:claims, scores:scores, past:past, stories:stories, opps:opps, latest:latest, resumeScore:resumeScore };
  if(dashNeedsOnboarding(d)){ setDashHash(''); renderOnboarding(body, d); return; }
  ONB = null;
  if(DASH_BOOT_HASH){ var bh = DASH_BOOT_HASH; DASH_BOOT_HASH = null; if(routeDashHash(bh)) return; }
  setDashHash('');
  renderDashboard(body, d);
}

function renderDashboard(body, d){
  var p = d.profile, latest = d.latest;
  var html = '';
  // Career plan: stories, opportunities, Check my fit. Until it is for sale
  // those sections are simply not shown; nothing on this page points at a
  // plan that cannot be bought. The target, scores and sessions are the
  // person's own on every plan.
  var locked = !isCareerPlan();
  var EDIT = 'dashEditTarget()';

  // Greeting + primary actions
  var sub = latest && latest.overall != null
    ? 'Your latest set scored ' + latest.overall + ' out of 10. The next one is aimed at your two lowest marks.'
    : (p.target_role_title ? 'Run a Practice set to get your first scorecard.' : 'Start by telling Ezzy what you\u2019re going for, or paste your resume.');
  html += '<div class="dash-top"><div><h1 class="dash-h1">' + dashGreeting(d.name) + '</h1><div class="dash-sub">' + sub + '</div></div></div>';

  // Cards show up as they get data. A new person sees the target and what
  // to do next, nothing else; the rest of the page fills in as they use Ezzy.
  var hasKnown = !!(d.claims.length || p.current_role_title || d.resumeScore || p.resume_text || p.resume_updated_at);
  var hasRoles = !!roleProfile(p).target_role_title;
  var fresh = !latest && !hasKnown && !d.past.length && !d.stories.length && !d.opps.length;
  html += '<div class="dash-grid' + (fresh ? ' two' : '') + '">';

  // Start here: the three things a new account needs before Ezzy has
  // enough to work with. Each ticks itself off; the card goes when all do.
  var stepResume = !!(p.resume_text || p.resume_updated_at || d.resumeScore || d.claims.length);
  var stepTarget = !!p.target_role_title;
  var stepPractice = !!(latest || d.past.some(function(x){ return x.mode === 'practice'; }));
  if(!(stepResume && stepTarget && stepPractice)){
    var step = function(done, n, t, sub, fn){
      return '<button class="start-step' + (done ? ' done' : '') + '" onclick="' + fn + '"><span class="start-n">' + (done ? '\u2713' : n) + '</span><div><div class="start-t">' + t + '</div><div class="start-s">' + sub + '</div></div></button>';
    };
    html += '<div class="dash-card span3"><div class="dash-card-head"><div class="dash-label">Start here</div><button class="dash-link" onclick="dashShowHelp()">How Ezzy works</button></div><div class="start-steps">'
      + step(stepResume, 1, 'Add your resume', stepResume ? 'On file. Ezzy learned your skills and experience from it.' : 'Ezzy reads it once and keeps what it learns, each item with the line it came from.', 'dashResume()')
      + step(stepTarget, 2, 'Set your target', stepTarget ? escapeHtml(p.target_role_title) + '. Matching and prep point at it.' : 'The role you\u2019re going for. Roles, prep and scores all point at it.', 'dashEditTarget()')
      + step(stepPractice, 3, 'Run one Practice set', stepPractice ? 'Done. Your first scorecard is on this page.' : 'Five questions, feedback on each in your own words, then a scorecard.', 'dashPractice()')
      + '</div></div>';
  }

  // Target
  html += '<div class="dash-card" id="dashTargetCard"><div class="dash-card-head"><div class="dash-label">Your target</div><button class="dash-link" onclick="' + EDIT + '">Edit</button></div>';
  if(p.target_role_title){
    var fam = dashRoleFamily(p.target_role_title);
    var chips = [];
    if(fam) chips.push(fam);
    if(p.target_level) chips.push(p.target_level.charAt(0).toUpperCase()+p.target_level.slice(1));
    if(p.target_work_type && p.target_work_type!=='any') chips.push(p.target_work_type.charAt(0).toUpperCase()+p.target_work_type.slice(1));
    if(p.target_locations && p.target_locations.length) chips.push(p.target_locations.join(' / '));
    var comp = dashComp(p);
    html += '<div class="dash-title">' + escapeHtml(p.target_role_title) + '</div><div class="dash-chips">'
      + chips.map(function(c){ return '<span class="dash-chip">' + escapeHtml(c) + '</span>'; }).join('')
      + (comp ? '<span class="dash-chip">' + escapeHtml(comp) + '</span>' : '<span class="dash-chip" style="color:#8A8A8A">Add comp range</span>')
      + '</div>';
    var w = p.wants || {};
    if(w.optimizing || w.musts || w.cold) html += '<div class="dash-text" style="font-size:15px;color:#555">' + [
      w.optimizing ? 'This move is for: ' + escapeHtml(w.optimizing) : '',
      w.musts ? 'Non-negotiable: ' + escapeHtml(w.musts) : '',
      w.cold ? 'Leaves you cold: ' + escapeHtml(w.cold) : ''].filter(Boolean).join('<br>') + '</div>';
    var confirmed = p.target_source==='stated' || p.target_source==='discovered';
    html += confirmed
      ? '<div class="dash-ok"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Confirmed by you</div>'
      : '<div class="dash-warn">Taken from ' + (p.target_source==='resume' ? 'your resume' : 'the role you picked') + '. Confirm or change it.</div>';
  } else {
    html += '<div class="dash-empty"><div class="dash-empty-t">No target yet</div><div class="dash-empty-s">Tell Ezzy the role you\u2019re going for. Matching and prep are pointed at it.</div><button class="dash-btn" onclick="' + EDIT + '">Set your target</button><button class="dash-link" onclick="dashShowDirections()">Not sure? Find a direction</button></div>';
  }
  html += '</div>';

  // Readiness
  if(latest){
  html += '<div class="dash-card dark"><div class="dash-label">Interview readiness</div>';
  if(latest.overall != null){
    html += '<div class="dash-big"><div class="dash-big-n">' + latest.overall + '</div><div class="dash-big-d">/ 10</div></div>'
      + '<div class="dash-text">From your ' + escapeHtml(SESSION_MODE_LABELS[latest.mode]||latest.mode) + ' set on ' + dashDate(latest.created_at) + '. Computed from ' + latest.scored_dims + ' of ' + latest.total_dims + ' rubric dimensions, every score tied to your own words.</div>';
  } else {
    html += '<div class="dash-big"><div class="dash-big-n" style="font-size:28px">Not rated yet</div></div><div class="dash-text">Your last set didn\u2019t have enough verifiable evidence to score. Fuller answers fix that.</div>';
  }
  var hist = d.scores.slice(0,4).reverse();
  html += '<div class="dash-bars">';
  for(var i=0;i<4;i++){
    var sc = hist[i - (4 - hist.length)];
    if(i < 4 - hist.length || !sc || sc.overall == null) html += '<div class="dash-bar" style="height:6px"></div>';
    else html += '<div class="dash-bar' + (i===3?' now':'') + '" style="height:' + Math.max(6, Math.round(sc.overall/10*32)+6) + 'px" title="' + sc.overall + '/10"></div>';
  }
  html += '</div></div>';
  }

  // What Ezzy knows
  var rsLow = dashResumeLow(d.resumeScore);
  if(hasKnown){
  html += '<div class="dash-card"><div class="dash-card-head"><div class="dash-label">What Ezzy knows</div>' + (d.claims.length ? '<button class="dash-link" id="dashClaimsToggle" onclick="toggleDashClaims()">See all</button>' : '') + '</div>';
  if(d.claims.length || p.current_role_title){
    // Two separate facts, kept separate: the current role (and its industry),
    // and total years of experience across the whole career.
    var line1 = p.current_role_title ? escapeHtml(p.current_role_title) + (p.current_industry ? ', ' + escapeHtml(p.current_industry) : '') : '';
    var line2 = p.years_experience ? Number(p.years_experience) + ' years of experience overall' : '';
    if(line1) html += '<div class="dash-text"><strong>' + line1 + '</strong>' + (line2 ? '<br><span style="color:#6B6B6B">' + line2 + '</span>' : '') + '</div>';
    else if(line2) html += '<div class="dash-text">' + line2 + '</div>';
    DASH_CLAIMS = d.claims;
    html += '<div class="dash-chips" id="dashClaims">' + dashClaimChips(false) + '</div>';
  }
  // Latest resume score, from the review's rubric pass. Not readiness.
  if(d.resumeScore){
    var rs = d.resumeScore;
    var rsCls = rs.overall == null ? 'dash-nr' : rs.overall >= 7 ? 'dash-score' : rs.overall >= 4 ? 'dash-score mid' : 'dash-score low';
    html += '<div class="dash-rs"><span class="' + rsCls + '">' + (rs.overall == null ? 'Resume not rated' : 'Resume ' + rs.overall + '/10') + '</span>'
      + '<span class="dash-row-s">' + (rs.overall == null ? 'Your last review on ' + dashDate(rs.created_at) + ' had too few verifiable lines to score.' : 'From your review on ' + dashDate(rs.created_at) + '.' + (rsLow ? ' Weakest area: ' + escapeHtml(rsLow.dimension.toLowerCase()) + '.' : '')) + '</span>'
      + (rs.conversation_id ? '<button class="dash-link" onclick="dashShowSession(\'' + rs.conversation_id + '\',\'Resume Review\')">Open review</button>' : '') + '</div>';
  }
  // The resume on file, and the way to swap it. Every review or
  // onboarding drop replaces it; this is where that is said.
  html += '<div class="dash-rs"><span class="dash-row-s">' + (p.resume_updated_at || p.resume_text
      ? 'Resume on file' + (p.resume_updated_at ? ' from ' + dashDate(p.resume_updated_at) : '') + '.'
      : 'No resume on file.') + '</span>'
    + '<button class="dash-link" onclick="dashResume()">' + (p.resume_updated_at || p.resume_text ? 'Replace it' : 'Add one') + '</button></div>';
  html += '</div>';
  }

  // A weak spot is only fixed when it stays fixed: 4 or better in the
  // last three rated sets after being low before. Low in two of the last
  // three is a recurring one, and goes first in the next set.
  var DIM_HIST = {};
  (d.scores || []).forEach(function(sc){ (Array.isArray(sc.dimensions) ? sc.dimensions : []).forEach(function(x){ if(x.score == null) return; (DIM_HIST[x.dimension] = DIM_HIST[x.dimension] || []).push(x.score); }); });
  var dimTrend = function(name){
    var hist = DIM_HIST[name] || []; // newest first
    var last3 = hist.slice(0, 3);
    if(last3.length >= 2 && last3.filter(function(v){ return v <= 3; }).length >= 2) return { key:'recurring', label:'Low ' + last3.filter(function(v){ return v <= 3; }).length + ' of your last ' + last3.length };
    if(last3.length === 3 && last3.every(function(v){ return v >= 4; }) && hist.slice(3).some(function(v){ return v <= 3; })) return { key:'fixed', label:'Fixed, 3 sets running' };
    return null;
  };

  // Latest scorecard (span 2), only once there is one.
  var lowNames = [];
  if(latest && Array.isArray(latest.dimensions) && latest.dimensions.length){
  html += '<div class="dash-card span2"><div class="dash-card-head"><div><div class="dash-label">Latest scorecard</div>';
  html += '<div class="dash-row-s">' + escapeHtml(SESSION_MODE_LABELS[latest.mode]||latest.mode) + (latest.role ? ' \u00b7 ' + escapeHtml(latest.role) : '') + ' \u00b7 ' + escapeHtml(latest.family) + ' rubric \u00b7 ' + dashDate(latest.created_at) + '</div>';
  html += '</div>' + (latest.conversation_id ? '<button class="dash-link" onclick="dashShowSession(\'' + latest.conversation_id + '\',\'' + escapeHtml(SESSION_MODE_LABELS[latest.mode]||latest.mode) + '\')">Open session</button>' : '') + '</div>';
    var scored = latest.dimensions.filter(function(x){ return x.score != null; }).slice().sort(function(a,b){ return a.score - b.score; });
    lowNames = scored.slice(0,2).map(function(x){ return x.dimension; });
    html += '<div class="dash-dims">' + latest.dimensions.map(function(x){
      var isLow = lowNames.indexOf(x.dimension) !== -1;
      var meter = x.score == null
        ? '<div class="dash-meter"><div class="dash-meter-track"></div><div class="dash-meter-n">\u2014</div></div>'
        : '<div class="dash-meter"><div class="dash-meter-track"><div class="dash-meter-fill' + (isLow?' low':'') + '" style="width:' + (x.score/5*100) + '%"></div></div><div class="dash-meter-n">' + x.score + '/5</div></div>';
      var note = x.score == null ? 'Not enough verified evidence in your answers.' : escapeHtml(x.improvement || '');
      var tr = dimTrend(x.dimension);
      return '<div class="dash-dim"><div class="dash-dim-name">' + escapeHtml(x.dimension) + (tr ? ' <span class="dash-tag' + (tr.key === 'recurring' ? ' coral' : ' green') + '">' + tr.label + '</span>' : '') + '</div>' + meter + '<div class="dash-dim-note">' + note + '</div></div>';
    }).join('') + '</div>';
  html += '</div>';
  }

  // Do next (rule-based, from the data on this page)
  var next = [];
  if(!p.target_role_title) next.push({hot:true, t:'Find a direction', s:'Ten questions plus your resume. Three to five roles you could win, with the evidence.', fn:'dashShowDirections()'});
  var staleOpp = (d.opps || []).filter(oppStale).sort(function(a,b){ return new Date(a.updated_at) - new Date(b.updated_at); })[0];
  if(staleOpp && !locked) next.push({hot:!next.length, t:'Any news from ' + (staleOpp.company || staleOpp.role_title) + '?', s:(OPP_STAGE_LABEL[staleOpp.stage] || staleOpp.stage) + ' since ' + dashDate(staleOpp.updated_at) + ', nothing logged after. Record what happened, even if it is nothing yet.', fn:'dashShowOpportunity(\'' + staleOpp.id + '\')'});
  var recurring = lowNames.filter(function(n){ var t = dimTrend(n); return t && t.key === 'recurring'; });
  if(lowNames.length === 2) next.push({hot:!next.length, t:'Practice: ' + lowNames[0].toLowerCase() + ' and ' + lowNames[1].toLowerCase(), s: recurring.length ? recurring.map(function(n){ return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase(); }).join(' and ') + (recurring.length === 1 ? ' has' : ' have') + ' been low more than once. Fixed means three good sets in a row.' : 'Five questions aimed at your two lowest marks.', fn:'dashPractice()'});
  else if(!latest) next.push({hot:!next.length, t:'Run your first Practice set', s:'Five questions, feedback on each, then a scorecard.', fn:'dashPractice()'});
  if(rsLow && d.resumeScore.overall != null && d.resumeScore.overall < 8) next.push({t:'Resume: ' + rsLow.dimension.toLowerCase() + ' scored ' + rsLow.score + '/5', s:(rsLow.improvement || 'Fix it, then run the review again to see the score move.').slice(0,120), fn:'dashResume()'});
  if(!d.opps.length && !locked) next.push({t:'Paste a real posting', s:'Get a requirement-by-requirement match, not a guess.', fn:'dashPostingEntry()'});
  if(!d.stories.length && !locked) next.push({t:'Build a story with STAR Coaching', s:'Stories you work through get saved for the real interview.', fn:'dashStar()'});
  if(!d.claims.length) next.push({t:'Review your resume', s:'Ezzy learns your skills and experience from it.', fn:'dashResume()'});
  var shown = next.slice(0,3);
  var shownFns = shown.map(function(n){ return n.fn; });
  var quick = [
    {t:'Practice' + (latest ? ' again' : ''), fn:'dashPractice()'},
    {t:'Resume review', fn:'dashResume()'},
    {t:(locked ? 'Paste a job posting' : 'Add an opportunity'), fn:'dashPostingEntry()'},
    {t:'Talk through an opportunity', fn:'dashDecide()'}
  ].filter(function(a){ return shownFns.indexOf(a.fn) === -1 && !(locked && a.fn === 'dashDecide()'); });
  html += '<div class="dash-card"><div class="dash-label">Do next</div>' + shown.map(function(n){
    return '<button class="dash-next' + (n.hot?' hot':'') + '" onclick="' + n.fn + '"><div class="dash-next-t">' + escapeHtml(n.t) + '</div><div class="dash-next-s">' + escapeHtml(n.s) + '</div></button>';
  }).join('') + (quick.length ? '<div class="dash-quick">' + quick.map(function(a){
    return '<button class="dash-link" onclick="' + a.fn + '">' + escapeHtml(a.t) + '</button>';
  }).join('') + '</div>' : '') + '</div>';

  // Roles for you: open roles at companies Ezzy follows, matched on the
  // target title. Filled in after the page renders (dashLoadRoles).
  if(hasRoles){
  html += '<div class="dash-card span3"><div class="dash-card-head"><div class="dash-label">Roles for you</div><button class="dash-link" id="dashRolesAll" style="display:none" onclick="dashShowRoles()">See all</button></div>'
    + '<div id="dashRoles"><div class="dash-muted">Looking for open ' + escapeHtml(roleProfile(p).target_role_title) + ' roles...</div></div></div>';
  }

  // The last row: sessions, stories, opportunities, whichever exist. Two
  // cards share the width; one takes it all; three sit as thirds.
  var lastRow = (d.past.length ? 1 : 0) + (!locked && d.stories.length ? 1 : 0) + (!locked && d.opps.length ? 1 : 0);
  var lastCls = lastRow === 1 ? ' span3' : lastRow === 2 ? ' half' : '';

  // Past sessions
  if(d.past.length){
  html += '<div class="dash-card' + lastCls + '"><div class="dash-card-head"><div class="dash-label">Sessions</div><button class="dash-link" onclick="dashShowSessions()">All</button></div>';
  html += d.past.map(dashSessionRow).join('');
  html += '</div>';
  }

  if(!locked){
  // Story bank
  if(d.stories.length){
  html += '<div class="dash-card' + lastCls + '"><div class="dash-card-head"><div class="dash-label">Story bank</div></div>';
    html += d.stories.map(function(st){
      return '<div class="dash-empty" style="border-style:solid"><div class="dash-empty-t">' + (st.status==='draft'?'Draft: ':'') + escapeHtml(st.title) + '</div><div class="dash-empty-s">' + (st.competencies && st.competencies.length ? 'Tagged: ' + escapeHtml(st.competencies.join(', ')) + '. ' : '') + (st.result ? '' : 'Missing: the result.') + '</div></div>';
    }).join('');
  html += '</div>';
  }

  // Opportunities
  if(d.opps.length){
  html += '<div class="dash-card' + lastCls + '"><div class="dash-card-head"><div class="dash-label">Opportunities</div><button class="dash-link" onclick="dashShowOpportunities()">All</button></div>';
  html += d.opps.slice(0,3).map(dashOppRow).join('');
  html += '<button class="dash-link" style="align-self:flex-start" onclick="dashAddOpportunity()">+ Add a posting</button>';
  html += oppCalibrationHtml(d.opps);
  html += '</div>';
  }

  }
  html += '</div>'; // grid
  html += '<div class="dash-foot">Nothing on this page is a guess. Every number and claim links back to your resume, your answers, or a source.</div>';
  body.innerHTML = html;
  dashFillRatings(body);
  if(roleProfile(p).target_role_title) dashLoadRoles(d);
}

// --- Past sessions (archived conversations, read-only) ------------------
var SESSION_MODE_LABELS = { practice:'Practice Q&A', star:'STAR Coaching', mock:'Mock Interview', resume:'Resume Review', research:'Company Research', decide:'Talk it through' };

function recordReadinessScore(reply){
  if(!window.supabaseClient || !window._currentConversationId || !reply) return;
  var m = reply.match(/\*\*Readiness:\s*([\d.]+)\s*\/\s*10\*\*/);
  if(!m) return;
  var score = Math.round(parseFloat(m[1]));
  if(isNaN(score) || score < 0 || score > 10) return;
  window.supabaseClient.from('conversations').update({ readiness_score: score }).eq('id', window._currentConversationId)
    .then(function(r){ if(r.error) console.error('readiness save', r.error); });
}

// A conversation row counts as a session once something happened in it:
// an answer given, a review delivered, a brief written. Empty rows from
// opening a mode and leaving are not sessions.
function dashSessionHasContent(r){
  if(!r) return false;
  if(r.archived_at) return true;
  if(r.mode==='practice'||r.mode==='star'||r.mode==='mock') return (r.answer_count||0) > 0;
  if(r.mode==='resume') return r.resume_stage === 'feedback_given';
  if(r.mode==='research') return !!r.research_stage && r.research_stage !== 'awaiting_company' && r.research_stage !== 'generating_brief';
  return false;
}
function dashSessionRow(r){
  var label = SESSION_MODE_LABELS[r.mode] || r.mode;
  var live = !r.archived_at;
  var bits = [];
  if(r.role) bits.push(escapeHtml(r.role)); if(r.research_company) bits.push(escapeHtml(r.research_company));
  bits.push(dashDate(r.archived_at || r.updated_at || r.created_at));
  var prep = (r.mode==='practice'||r.mode==='star'||r.mode==='mock');
  if(prep && r.answer_count) bits.push(r.answer_count + (r.answer_count===1?' answer':' answers'));
  var right = r.readiness_score != null ? '<span class="dash-score">' + r.readiness_score + '/10</span>' : '<span class="dash-nr">' + (prep ? 'not rated' : '') + '</span>';
  var click = live ? 'dashOpenLiveSession(' + JSON.stringify(r.id) + ',' + JSON.stringify(r.mode) + ',' + JSON.stringify(r.role||null) + ')' : 'dashShowSession(\'' + r.id + '\',\'' + escapeHtml(label) + '\')';
  return '<button class="dash-row" onclick=\'' + click.replace(/'/g,'&#39;') + '\'><div><div class="dash-row-t">' + escapeHtml(label) + (live ? ' <span class="dash-tag coral">Live</span>' : '') + '</div><div class="dash-row-s">' + bits.join(' \u00b7 ') + '</div></div>' + right + '</button>';
}
// A live session reopens in its mode (the mode restores its own
// conversation); archived ones are read-only transcripts.
function dashOpenLiveSession(id, mode, role){
  if(mode==='resume'){
    hideDashboard();
    ROLE = role || null; window.ROLE = ROLE;
    enterAppShell(ROLE);
    resumeDropDismissed = true;
    inputEl.disabled = false; inputEl.placeholder = 'Type your answer...';
    startMode('resume', 'Resume Feedback');
    return;
  }
  if(mode==='research'){
    hideDashboard();
    ROLE = role || null; window.ROLE = ROLE;
    enterAppShell(ROLE);
    pickIntent('research');
    return;
  }
  dashStartMode(role, mode, SESSION_MODE_LABELS[mode] || mode);
}

// A dashboard sub-view: same section, a title row with a way back, one card.
function dashView(title, sub, backLabel, backFn, inner){
  return '<div class="dash-top"><div><h1 class="dash-h1">' + title + '</h1><div class="dash-sub">' + sub + '</div></div>'
    + '<div class="dash-actions"><button class="dash-btn" onclick="' + backFn + '">\u2190 ' + backLabel + '</button></div></div>'
    + '<div class="dash-card dash-single">' + inner + '</div>';
}

// Past sessions, in full, on the dashboard. Archived conversations are
// read-only; a fresh set is how you keep prepping.
async function dashShowSessions(){
  var body = document.getElementById('dashBody');
  if(!body || !window.supabaseClient) return;
  if(!DASH_ON) showDashboard(true);
  var sub = 'Live sessions pick up where you left off. Finished ones are read-only.';
  setDashHash('sessions');
  body.innerHTML = dashView('Sessions', sub, 'My Career', 'loadDashboard()', '<div class="dash-loading">Loading...</div>');
  var sessionRes = await window.supabaseClient.auth.getSession();
  var session = sessionRes.data && sessionRes.data.session;
  if(!session){ body.innerHTML = dashView('Sessions', sub, 'My Career', 'loadDashboard()', '<div class="dash-loading">Sign in to see your sessions.</div>'); return; }
  var res = await window.supabaseClient.from('conversations')
    .select('id,mode,role,archived_at,created_at,updated_at,answer_count,readiness_score,research_company,resume_stage,research_stage')
    .eq('user_id', session.user.id)
    .order('updated_at', {ascending:false}).limit(80);
  if(res.data) res.data = res.data.filter(dashSessionHasContent).slice(0, 50);
  var inner;
  if(res.error) inner = '<div class="dash-loading">Could not load sessions. Try again shortly.</div>';
  else if(!res.data || !res.data.length) inner = '<div class="dash-empty"><div class="dash-empty-t">None yet</div><div class="dash-empty-s">Finished and restarted sessions land here with their score.</div></div>';
  else inner = res.data.map(function(r){ return '<div class="sess-wrap">' + dashSessionRow(r) + '<button class="dash-link sess-x" onclick="dashDeleteSession(\'' + r.id + '\', this)">Remove</button></div>'; }).join('');
  body.innerHTML = dashView('Sessions', sub + ' Remove takes the session and its score with it.', 'My Career', 'loadDashboard()', inner);
  body.parentNode.scrollTop = 0;
}
// Two clicks: the first arms it, the second removes. The server deletes
// the messages and the conversation; the scorecard cascades.
async function dashDeleteSession(id, btn){
  if(!btn.getAttribute('data-armed')){ btn.setAttribute('data-armed', '1'); btn.textContent = 'Remove for good?'; btn.style.color = '#8F3229'; setTimeout(function(){ if(btn.isConnected){ btn.removeAttribute('data-armed'); btn.textContent = 'Remove'; btn.style.color = ''; } }, 6000); return; }
  btn.disabled = true; btn.textContent = 'Removing...';
  try{
    var token = await getAuthTokenIfSignedIn(); if(!token) throw new Error('Sign in first.');
    var res = await fetch('/api/account', { method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer ' + token }, body: JSON.stringify({ action:'delete_session', conversationId: id }) });
    var data = await res.json().catch(function(){ return {}; });
    if(!res.ok){ console.error('remove session', data); throw new Error(data.error === 'session_not_found' ? 'Could not find it' : 'Could not remove it'); }
    if(window._currentConversationId === id){ window._currentConversationId = null; }
    dashShowSessions();
  }catch(e){ btn.disabled = false; btn.removeAttribute('data-armed'); btn.style.color = '#8F3229'; btn.textContent = String(e && e.message || e); setTimeout(function(){ if(btn.isConnected){ btn.textContent = 'Remove'; btn.style.color = ''; } }, 4000); }
}

async function dashShowSession(id, label, backLabel, backFn){
  backLabel = backLabel || 'Sessions'; backFn = backFn || 'dashShowSessions()';
  var body = document.getElementById('dashBody');
  if(!body || !window.supabaseClient) return;
  if(!DASH_ON) showDashboard(true);
  var sub = 'Read-only transcript.';
  body.innerHTML = dashView(escapeHtml(label), sub, backLabel, backFn, '<div class="dash-loading">Loading...</div>');
  var res = await window.supabaseClient.from('messages').select('role,content,created_at').eq('conversation_id', id).order('created_at', {ascending:true});
  var inner = '';
  if(res.error || !res.data || !res.data.length){
    inner = '<div class="dash-loading">No messages saved for this session.</div>';
  } else {
    res.data.forEach(function(m){
      if(m.role === 'user'){
        var t = m.content || '';
        if(t.length > 600) t = t.slice(0, 600) + ' \u2026';
        inner += '<div class="sess-msg user">' + escapeHtml(t) + '</div>';
      } else {
        var rendered; try{ rendered = marked.parse(m.content || ''); }catch(e){ rendered = escapeHtml(m.content || ''); }
        inner += '<div class="sess-msg bot">' + rendered + '</div>';
      }
    });
  }
  // A resume review's match box lives in its own table; show it under the transcript.
  try{
    var cv = await window.supabaseClient.from('conversations').select('mode,jd_text,user_id').eq('id', id).maybeSingle();
    if(cv.data && cv.data.mode === 'resume' && cv.data.jd_text){
      var gaps = await fetchGapsForJd(cv.data.user_id, cv.data.jd_text);
      if(gaps.length) inner += '<div class="gap-box sess-gap">' + gapBoxHtml(gaps) + '</div>';
    }
  }catch(e){ console.error('session gap box', e); }
  body.innerHTML = dashView(escapeHtml(label), sub, backLabel, backFn, '<div class="dash-transcript">' + inner + '</div>');
  externalizeLinks(body);
  body.parentNode.scrollTop = 0;
}

// Target editing happens in the target card itself.
function dashEditTarget(){
  var card = document.getElementById('dashTargetCard');
  if(!card){ showDashboard(); return; }
  card.innerHTML = '<div class="dash-card-head"><div class="dash-label">Your target</div><button class="dash-link" onclick="loadDashboard()">Cancel</button></div>'
    + renderTargetBlock(DASH_PROFILE, true);
  var role = document.getElementById('tgtRole'); if(role) role.focus();
}


// --- Roles for you (Active search) ---------------------------------------
// Open roles from job_listings (refreshed nightly from open job-board
// feeds; see api/jobs-sync.js). Matching here is deliberately plain and
// explainable: the target title's words against the role's title, then
// level, work type, and location from the saved target. No fit number is
// shown at this stage. "Check my fit" reads the full posting and runs the
// real match, which lands as an Opportunity with a verdict.
var ROLE_SKIP = /^(senior|sr|staff|principal|lead|junior|jr|associate|intern|head|director|vp|chief|manager of|ii|iii|iv|of|and|the|for|to|in|at|a|an)$/;
var DASH_ROLES = null; // { key, summary, rows: { '<loc>|<level>': ranked } }
// Seeing the roles is free for every signed-in user; they are the
// companies' own public listings. What the Career plan adds is Ezzy's work
// on top: the fit check, the verdict, the fixes.
var ROLE_QUERY = '';   // a title typed into the section when no target is saved
var ROLE_CONTACT = 'hello@meetezzy.com';
var ROLE_SOURCE_NOTE = '<div class="role-source">Listings come from each company\u2019s own public job board and link to that company\u2019s site to apply. Ezzy is not affiliated with these companies. Employers: to have your listings removed, email <a href="mailto:' + ROLE_CONTACT + '">' + ROLE_CONTACT + '</a>.</div>';
// The saved target when there is one; otherwise the title typed here, or
// the role from the person's latest session.
function roleProfile(p){
  p = p || {};
  if(p.target_role_title) return p;
  return Object.assign({}, p, { target_role_title: ROLE_QUERY || DASH_ROLE || '' });
}
function roleAskTitle(){
  return '<div class="dash-empty"><div class="dash-empty-t">What role are you looking for?</div><div class="dash-empty-s">Open roles at the companies Ezzy follows are matched on the title.</div>'
    + '<div class="dash-add" style="max-width:520px"><input id="roleQuery" type="text" maxlength="80" placeholder="e.g. Product Manager" onkeydown="if(event.key===\'Enter\')dashSetRoleQuery()"/><button class="dash-btn" onclick="dashSetRoleQuery()">Show roles</button></div></div>';
}
function dashSetRoleQuery(){
  var el = document.getElementById('roleQuery');
  var v = el ? el.value.trim().slice(0, 80) : '';
  if(!v) return;
  ROLE_QUERY = v; DASH_ROLES = null;
  var box = document.getElementById('dashRoles');
  if(box) box.innerHTML = '<div class="dash-muted">Looking for open ' + escapeHtml(v) + ' roles...</div>';
  dashLoadRoles({ profile: DASH_PROFILE || {}, opps: [] });
}
function roleTokens(title){
  return String(title || '').toLowerCase().replace(/[^a-z0-9+#\s]/g, ' ').split(/\s+/).filter(function(t){ return t.length >= 2 && !ROLE_SKIP.test(t); });
}
function roleStem(t){ return t.length > 4 ? t.replace(/(ing|ers|er|ors|or|s)$/, '') : t; }
function roleHas(stems, tok){
  var st = roleStem(tok);
  return stems.some(function(x){ return x === st || (st.length >= 4 && x.length >= 4 && (x.indexOf(st) === 0 || st.indexOf(x) === 0)); });
}
// Score one listing against the target. Returns null when the core of the
// title (its last word: recruiter, engineer, designer...) is not there.
function rankRole(l, p, toks){
  var stems = roleTokens(l.title).map(roleStem);
  var head = toks[toks.length - 1];
  if(!head || !roleHas(stems, head)) return null;
  var hits = toks.filter(function(t){ return roleHas(stems, t); });
  var score = 5 + 2 * hits.length + (hits.length === toks.length ? 3 : 0);
  var why = [hits.length === toks.length ? 'Title matches your target' : 'Close to your target title'];
  if(p.target_level && l.level){
    if(l.level === p.target_level){ score += 2; why.push(p.target_level.charAt(0).toUpperCase() + p.target_level.slice(1) + ' level'); }
    else score -= 1;
  }
  if(p.target_work_type === 'remote'){ if(l.remote){ score += 2; why.push('Remote'); } else score -= 1; }
  else if(l.remote) why.push('Remote');
  var here = roleInTargetLocation(l, p);
  if(here){ score += 4; why.push('In ' + here); }
  // Fresh roles rise, stale ones sink: a months-old exact match should not
  // sit above a week-old near miss (Ari, 2026-10-17: "offputting").
  var age = roleAgeDays(l);
  if(age !== null){ if(age < 7) score += 3; else if(age < 21) score += 2; else if(age < ROLE_RECENT_DAYS) score += 1; else if(age > 90) score -= 3; }
  return { l: l, score: score, why: why, here: !!here, recent: age === null || age <= ROLE_RECENT_DAYS };
}
// Days since the posting went up; feeds without a post date (Rippling) count
// from when Ezzy first saw it. null when neither is known.
var ROLE_RECENT_DAYS = 45;
function roleWeek(l){ var d = roleAgeDays(l); return d === null ? 1 : Math.floor(d / 7); }
function roleAgeDays(l){
  var iso = l.posted_at || l.first_seen_at;
  if(!iso) return null;
  var days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return isNaN(days) || days < 0 ? null : days;
}
// People write their city many ways; postings do too.
var ROLE_LOC_ALIASES = { 'nyc':['new york'], 'new york city':['new york'], 'ny':['new york'], 'sf':['san francisco'], 'bay area':['san francisco','bay area','palo alto','mountain view','san jose','oakland','sunnyvale','menlo park'], 'la':['los angeles'], 'dc':['washington'], 'washington dc':['washington'], 'philly':['philadelphia'] };
function roleTargetPlaces(p){
  var out = [];
  (p.target_locations || []).forEach(function(x){
    x = String(x).toLowerCase().trim();
    if(x.length < 2 || /^remote/.test(x)) return;
    (ROLE_LOC_ALIASES[x] || [x.replace(/,.*$/, '').trim()]).forEach(function(a){ if(a.length >= 3 && out.indexOf(a) === -1) out.push(a); });
  });
  return out;
}
// A posting can list several places ("San Francisco, CA \u2022 New York, NY").
function rolePlaces(l){
  return String(l.location || '').split(/\s*[\u2022;|]\s*|\s+or\s+|\s*\/\s*/i).map(function(x){ return x.trim(); }).filter(function(x){ return x.length >= 2; });
}
// Returns the posting's place that is in the person's target, or ''.
function roleInTargetLocation(l, p){
  var want = roleTargetPlaces(p);
  if(!want.length) return '';
  var places = rolePlaces(l);
  for(var i = 0; i < places.length; i++){
    var pl = places[i].toLowerCase();
    if(want.some(function(w){ return pl.indexOf(w) !== -1; })) return places[i];
  }
  return '';
}
function roleHead(p){ var toks = roleTokens(p.target_role_title); return toks.length ? toks[toks.length - 1] : ''; }
function roleKey(p){ return roleTokens(p.target_role_title).join(' ') + '|' + (p.target_level || '') + '|' + (p.target_work_type || '') + '|' + (p.target_locations || []).join(','); }
// Everything matching the head word, counted on the server (migration
// 0030): the filter chips, every place and level that appears. One call per
// target; the rows come per filter from dashFetchRoles, so the 400-row cap
// applies within a place, not across the country.
async function roleSummary(p){
  var head = roleHead(p);
  if(!head || !window.supabaseClient) return null;
  var key = roleKey(p);
  if(DASH_ROLES && DASH_ROLES.key === key && DASH_ROLES.summary) return DASH_ROLES.summary;
  var r = await window.supabaseClient.rpc('role_summary', { q: head, places: roleTargetPlaces(p) });
  if(r.error){ console.error('roles summary', r.error); return null; }
  var s = r.data || {};
  var summary = { all: s.all || 0, remote: s.remote || 0, mine: s.mine || 0, places: {}, levels: s.levels || {} };
  // A posting can list several places; count it under each.
  (s.places || []).forEach(function(x){ rolePlaces({ location: x.location }).forEach(function(pl){ summary.places[pl] = (summary.places[pl] || 0) + (x.n || 0); }); });
  DASH_ROLES = { key: key, summary: summary, rows: {} };
  return summary;
}
// The rows for the current filter: the newest 400 in that place, remote, or
// level. Roles with no post date sort by when Ezzy first saw them.
async function dashFetchRoles(p, oppUrls){
  var head = roleHead(p);
  if(!head || !window.supabaseClient) return [];
  var toks = roleTokens(p.target_role_title);
  var key = roleKey(p);
  if(!DASH_ROLES || DASH_ROLES.key !== key) DASH_ROLES = { key: key, summary: null, rows: {} };
  var loc = ROLE_FILTER.loc || 'all', lvl = ROLE_FILTER.level || '';
  var fkey = loc + '|' + lvl + (ROLE_FILTER.pay ? '|pay' : '');
  if(DASH_ROLES.rows[fkey]) return DASH_ROLES.rows[fkey];
  var clean = function(s){ return String(s).replace(/[,()"\\*%]/g, ' ').replace(/\s+/g, ' ').trim(); };
  var build = function(orderCol){
    var q = window.supabaseClient.from('job_listings')
      .select('id,company,title,location,remote,url,posted_at,first_seen_at,level,family,comp_min,comp_max,comp_currency,comp_interval')
      .eq('active', true).textSearch('title_tsv', head, { type: 'websearch' });
    if(ROLE_FILTER.pay) q = q.not('comp_min', 'is', null);
    if(loc === 'remote') q = q.eq('remote', true);
    else if(loc === 'mine'){
      var want = roleTargetPlaces(p).map(clean).filter(Boolean);
      if(want.length) q = q.or(want.map(function(w){ return 'location.ilike.*' + w + '*'; }).join(','));
    }
    else if(loc.indexOf('city:') === 0){ var city = clean(loc.slice(5)); if(city) q = q.ilike('location', '%' + city + '%'); }
    if(lvl) q = q.eq('level', lvl);
    return q.order(orderCol, { ascending: false, nullsFirst: false }).limit(400);
  };
  var r = await build('shown_at');
  if(r.error && /shown_at/.test(r.error.message || '')) r = await build('posted_at'); // migration 0030 not applied yet
  if(r.error){ console.error('roles', r.error); return []; }
  var have = {}; (oppUrls || []).forEach(function(u){ if(u) have[u] = true; });
  var ranked = (r.data || []).filter(function(l){ return !have[l.url]; })
    .map(function(l){ return rankRole(l, p, toks); }).filter(Boolean)
    // Newest week first, then fit, then the exact date. A better-matching
    // role posted a month ago does not sit above one posted today; within
    // the same week the better match wins.
    .sort(function(a, b){ return roleWeek(a.l) - roleWeek(b.l) || b.score - a.score || (new Date(b.l.posted_at || b.l.first_seen_at || 0) - new Date(a.l.posted_at || a.l.first_seen_at || 0)); });
  DASH_ROLES.rows[fkey] = ranked;
  return ranked;
}
// How long the role has been open. Feeds without a post date (Rippling)
// only tell us when Ezzy first saw it, so that reads as a floor.
function roleAge(l){
  var days = roleAgeDays(l);
  if(days === null) return '';
  if(l.posted_at) return days === 0 ? 'Posted today' : 'Open ' + days + (days === 1 ? ' day' : ' days');
  return days === 0 ? 'Listed today' : 'Listed ' + days + '+ days';
}
// A listing that touches something they said pulls them in or leaves them
// cold gets a chip, never hidden: the next one might be the exception.
// Matched on title, company and department, the text the feed carries.
function wantTerms(field){
  var w = (DASH_PROFILE && DASH_PROFILE.wants && DASH_PROFILE.wants[field]) || '';
  return String(w).split(/[,;\n]/).map(function(t){ return t.trim().toLowerCase(); }).filter(function(t){ return t.length >= 3; });
}
// A post date well after Ezzy first saw the role means the company
// refreshed it: a repost, often an evergreen or hard-to-fill req.
function roleRepostChip(l){
  if(!l.posted_at || !l.first_seen_at) return '';
  var gap = Math.floor((new Date(l.posted_at) - new Date(l.first_seen_at)) / 86400000);
  if(isNaN(gap) || gap < 21) return '';
  return '<span class="dash-chip" style="background:#FFF3DA;color:#966B0A" title="Ezzy first saw this role ' + gap + ' days before its current post date">Reposted</span>';
}
function roleWantChips(l){
  var hay = [l.title, l.company, l.department].filter(Boolean).join(' ').toLowerCase();
  var out = [roleRepostChip(l)].filter(Boolean);
  wantTerms('cold').forEach(function(t){ if(hay.indexOf(t) !== -1) out.push('<span class="dash-chip" style="background:#FCEAE6;color:#8F3229">You said \u201c' + escapeHtml(t) + '\u201d leaves you cold</span>'); });
  wantTerms('pull').forEach(function(t){ if(hay.indexOf(t) !== -1) out.push('<span class="dash-chip" style="background:#E6F4EA;color:#17602F">Pulls you in: \u201c' + escapeHtml(t) + '\u201d</span>'); });
  return out.join('');
}
// The pay range the company printed in the posting, as printed: yearly or
// hourly, in its own currency. Nothing is estimated; no range, no chip.
function rolePay(l){
  if(l.comp_min == null) return '';
  var lo = Number(l.comp_min), hi = Number(l.comp_max || l.comp_min);
  var cur = l.comp_currency || 'USD';
  var sym = cur === 'USD' ? '$' : cur === 'GBP' ? '£' : cur === 'EUR' ? '€' : cur + ' ';
  var f = l.comp_interval === 'hour'
    ? function(v){ return sym + (Math.round(v * 100) / 100); }
    : function(v){ return sym + Math.round(v / 1000) + 'k'; };
  var range = lo === hi ? f(lo) : f(lo) + '–' + f(hi);
  return range + (l.comp_interval === 'hour' ? '/hr' : '');
}
function rolePayChip(l){
  var r = rolePay(l);
  return r ? '<span class="dash-chip" style="background:#E6F4EA;color:#17602F" title="Pay range printed in the posting">' + escapeHtml(r) + ' posted</span>' : '';
}
function dashRoleRow(x){
  var l = x.l;
  var sub = [l.location, roleAge(l)].filter(Boolean).map(escapeHtml).join(' · ');
  return '<div class="role-row"><div class="role-main"><div class="dash-row-t">' + escapeHtml(l.title) + ' <span class="role-co">· ' + escapeHtml(l.company) + '</span></div>'
    + (sub ? '<div class="dash-row-s">' + sub + '</div>' : '')
    + '<div class="dash-chips" style="margin-top:6px">' + rolePayChip(l) + roleWantChips(l) + x.why.map(function(w){ return '<span class="dash-chip">' + escapeHtml(w) + '</span>'; }).join('') + '</div></div>'
    + '<div class="role-actions">' + (isCareerPlan() ? '<button class="dash-btn" onclick="dashCheckFit(\'' + l.id + '\', this)">Check my fit</button>' : '')
    + '<a class="dash-link" href="' + escapeHtml(l.url) + '" target="_blank" rel="noopener">View posting ↗</a></div></div>';
}
// What the person is looking at: their own locations, remote, everywhere,
// or one named place; and optionally one level. Remembered between visits.
var ROLE_FILTER = (function(){ try{ return JSON.parse(localStorage.getItem('ezzyRoleFilter') || 'null') || {}; }catch(e){ return {}; } })();
var ROLE_VIEW = null; // { ranked, summary, p, oppUrls, where: 'card' | 'list', loading }
// Roles older than ROLE_RECENT_DAYS are a click away, not the first thing
// seen. Per visit on purpose: a long-open req reads as "nobody is hiring".
var ROLE_SHOW_OLDER = false;
// Older roles rank lowest, so merging them into the capped list would put
// them past the cut and the link would appear to do nothing. They get
// their own section on the full list; from the card, the link opens it.
function showOlderRoles(on){
  ROLE_SHOW_OLDER = on;
  if(!ROLE_VIEW) return;
  if(ROLE_VIEW.where === 'list'){ renderRolesList(); return; }
  // From the card: open the full list and land on the older section, not
  // on the recent rows above it.
  dashShowRoles().then(function(){ var el = document.getElementById('rolesOlder'); if(el) el.scrollIntoView({ block: 'start' }); });
}
// The rows that pass the place/level filter: recent ones shown, older
// ones behind the link.
function roleSplit(ranked){
  var all = applyRoleFilter(ranked);
  return { shown: all.filter(function(x){ return x.recent; }), older: all.filter(function(x){ return !x.recent; }), all: all };
}
function roleOlderSection(sp){
  if(!sp.older.length || ROLE_VIEW.loading) return '';
  var n = sp.older.length + ' older ' + (sp.older.length === 1 ? 'role' : 'roles');
  if(!ROLE_SHOW_OLDER || ROLE_VIEW.where === 'card'){
    return '<div style="margin-top:8px"><button class="dash-link" onclick="showOlderRoles(true)">Show ' + n + '</button> <span class="dash-muted">posted over ' + ROLE_RECENT_DAYS + ' days ago</span></div>';
  }
  return '<div class="dash-label" id="rolesOlder" style="margin-top:18px">Open more than ' + ROLE_RECENT_DAYS + ' days</div><div class="dash-muted" style="margin:2px 0 8px">Usually an evergreen or hard-to-fill role. Still worth a look; expect a slower process.</div>'
    + sp.older.slice(0, 80).map(dashRoleRow).join('')
    + '<div style="margin-top:8px"><button class="dash-link" onclick="showOlderRoles(false)">Hide ' + n + '</button></div>';
}
function roleFilterDefault(summary, p){
  if(ROLE_FILTER.loc) return;
  // Start where they said they want to work, when there is anything there.
  ROLE_FILTER.loc = summary && summary.mine > 0 ? 'mine' : 'all';
}
function applyRoleFilter(ranked){
  var loc = ROLE_FILTER.loc || 'all', lvl = ROLE_FILTER.level || '';
  return ranked.filter(function(x){
    if(loc === 'mine' && !x.here) return false;
    if(loc === 'remote' && !x.l.remote) return false;
    if(loc.indexOf('city:') === 0 && !rolePlaces(x.l).some(function(pl){ return pl === loc.slice(5); })) return false;
    if(lvl && x.l.level !== lvl) return false;
    if(ROLE_FILTER.pay && x.l.comp_min == null) return false;
    return true;
  });
}
function setRoleFilter(key, val){
  ROLE_FILTER[key] = val;
  try{ localStorage.setItem('ezzyRoleFilter', JSON.stringify(ROLE_FILTER)); }catch(e){}
  if(!ROLE_VIEW) return;
  var v = ROLE_VIEW;
  var filterKey = function(){ return (ROLE_FILTER.loc || 'all') + '|' + (ROLE_FILTER.level || '') + (ROLE_FILTER.pay ? '|pay' : ''); };
  var want = filterKey();
  var render = function(){ if(v.where === 'list') renderRolesList(); else renderRolesCard(); };
  v.loading = true; render();
  dashFetchRoles(v.p, v.oppUrls).then(function(ranked){
    if(ROLE_VIEW !== v || filterKey() !== want) return; // they clicked again
    v.ranked = ranked; v.loading = false; render();
  }, function(e){ console.error('roles', e); if(ROLE_VIEW === v){ v.loading = false; render(); } });
}
function roleFilterBar(full){
  var ranked = ROLE_VIEW.ranked, p = ROLE_VIEW.p, s = ROLE_VIEW.summary;
  var mine = (p.target_locations || []).filter(function(x){ return !/^remote/i.test(String(x).trim()); }).join(' / ');
  // Counts come from the server summary; from the loaded rows when there is none.
  var n = function(k, test){ return s ? s[k] : ranked.filter(test).length; };
  var loc = ROLE_FILTER.loc || 'all';
  var chip = function(val, label, count){
    return '<button class="role-chip' + (loc === val ? ' on' : '') + '" onclick="setRoleFilter(\'loc\',\'' + val + '\')">' + escapeHtml(label) + ' <span>' + count + '</span></button>';
  };
  var html = '<div class="role-filters">';
  if(mine) html += chip('mine', mine, n('mine', function(x){ return x.here; }));
  html += chip('remote', 'Remote', n('remote', function(x){ return x.l.remote; })) + chip('all', 'Everywhere', n('all', function(){ return true; }));
  // Only roles whose posting prints a pay range. Counted from the rows in
  // hand; the server summary does not know about pay.
  var payN = ranked.filter(function(x){ return x.l.comp_min != null; }).length;
  if(payN || ROLE_FILTER.pay) html += '<button class="role-chip' + (ROLE_FILTER.pay ? ' on' : '') + '" onclick="setRoleFilter(\'pay\', ' + (ROLE_FILTER.pay ? 'false' : 'true') + ')">Shows pay <span>' + payN + '</span></button>';
  if(full){
    // Every place that appears, most roles first.
    var counts = s ? s.places : {};
    if(!s) ranked.forEach(function(x){ rolePlaces(x.l).forEach(function(pl){ counts[pl] = (counts[pl] || 0) + 1; }); });
    var places = Object.keys(counts).sort(function(a, b){ return counts[b] - counts[a] || a.localeCompare(b); }).slice(0, 60);
    var cur = loc.indexOf('city:') === 0 ? loc.slice(5) : '';
    if(cur && places.indexOf(cur) === -1) places.unshift(cur);
    html += '<select class="dash-field role-sel" onchange="setRoleFilter(\'loc\', this.value || \'all\')"><option value="">Pick a place</option>'
      + places.map(function(pl){ var v = 'city:' + pl; return '<option value="' + escapeHtml(v) + '"' + (loc === v ? ' selected' : '') + '>' + escapeHtml(pl) + (counts[pl] ? ' (' + counts[pl] + ')' : '') + '</option>'; }).join('') + '</select>';
    var levels = s ? s.levels : {};
    if(!s) ranked.forEach(function(x){ if(x.l.level) levels[x.l.level] = (levels[x.l.level] || 0) + 1; });
    var order = ['entry','mid','senior','staff','principal','manager','director','vp','exec'].filter(function(k){ return levels[k]; });
    if(order.length) html += '<select class="dash-field role-sel" onchange="setRoleFilter(\'level\', this.value)"><option value="">Any level</option>'
      + order.map(function(k){ return '<option value="' + k + '"' + (ROLE_FILTER.level === k ? ' selected' : '') + '>' + k.charAt(0).toUpperCase() + k.slice(1) + ' (' + levels[k] + ')</option>'; }).join('') + '</select>';
  }
  return html + '</div>';
}
function roleFilterEmpty(older){
  if(older && ROLE_SHOW_OLDER && ROLE_VIEW.where === 'list') return ''; // the older section follows
  if(older) return '<div class="dash-empty"><div class="dash-empty-t">Nothing recent under this filter</div><div class="dash-empty-s">' + older + (older === 1 ? ' role has' : ' roles have') + ' been open for more than ' + ROLE_RECENT_DAYS + ' days.</div><button class="dash-btn" onclick="showOlderRoles(true)">Show older roles</button></div>';
  return '<div class="dash-empty"><div class="dash-empty-t">Nothing under this filter</div><div class="dash-empty-s">There are open roles elsewhere.</div><button class="dash-btn" onclick="ROLE_FILTER.level=\'\';ROLE_FILTER.pay=false;setRoleFilter(\'loc\',\'all\')">Show everywhere</button></div>';
}
function roleTotal(){ return ROLE_VIEW.summary ? ROLE_VIEW.summary.all : ROLE_VIEW.ranked.length; }
function roleRows(sp, max){
  if(ROLE_VIEW.loading) return '<div class="dash-muted">Loading...</div>';
  return sp.shown.length ? sp.shown.slice(0, max).map(dashRoleRow).join('') : roleFilterEmpty(sp.older.length);
}
function renderRolesCard(){
  var box = document.getElementById('dashRoles');
  if(!box || !ROLE_VIEW) return;
  var ranked = ROLE_VIEW.ranked, p = ROLE_VIEW.p;
  var sp = roleSplit(ranked), shown = sp.shown, total = roleTotal();
  box.innerHTML = roleFilterBar(false) + roleRows(sp, 5) + roleOlderSection(sp)
    + '<div class="dash-muted" style="margin-top:4px">' + shown.length + ' recent of ' + total + ' open roles matching “' + escapeHtml(p.target_role_title) + '”. Matched on the title and your target' + (isCareerPlan() ? '; Check my fit reads the full posting and gives a verdict' : '') + '.</div>'
    + ROLE_SOURCE_NOTE;
  var all = document.getElementById('dashRolesAll'); if(all) all.style.display = total > 5 ? '' : 'none';
}
function renderRolesList(){
  var body = document.getElementById('dashBody');
  if(!body || !ROLE_VIEW) return;
  var ranked = ROLE_VIEW.ranked, p = ROLE_VIEW.p;
  var sp = roleSplit(ranked), shown = sp.shown, total = roleTotal();
  var inner = roleFilterBar(true) + roleRows(sp, 80) + roleOlderSection(sp) + ROLE_SOURCE_NOTE;
  var note = shown.length > 80 ? ', best 80 shown' : ((ROLE_FILTER.loc || 'all') === 'all' && total > ranked.length ? ', newest ' + ranked.length + ' loaded; pick a place to see every role there' : '');
  body.innerHTML = dashView('Roles for you', shown.length + ' recent of ' + total + ' open roles matching “' + escapeHtml(p.target_role_title) + '”' + note + '. Refreshed nightly from each company’s own job board.', 'My Career', 'loadDashboard()', inner);
}
async function dashLoadRoles(d){
  var box = document.getElementById('dashRoles');
  if(!box) return;
  var p = roleProfile(d.profile);
  var oppUrls = (d.opps || []).map(function(o){ return o.url; });
  var summary = null, ranked = [];
  try{ summary = await roleSummary(p); roleFilterDefault(summary, p); ranked = await dashFetchRoles(p, oppUrls); }
  catch(e){ console.error('roles', e); }
  box = document.getElementById('dashRoles'); // the page may have re-rendered while we waited
  if(!box) return;
  if(!(summary ? summary.all : ranked.length)){
    box.innerHTML = '<div class="dash-empty"><div class="dash-empty-t">No open ' + escapeHtml(p.target_role_title) + ' roles right now</div><div class="dash-empty-s">Nothing with that title is open at the companies Ezzy follows today. The list refreshes every night; a broader title will also widen it.</div></div>'
      + (ROLE_QUERY ? roleAskTitle() : '');
    return;
  }
  ROLE_VIEW = { ranked: ranked, summary: summary, p: p, oppUrls: oppUrls, where: 'card' };
  renderRolesCard();
}
async function dashShowRoles(){
  if(!DASH_ON) showDashboard(true);
  var body = document.getElementById('dashBody');
  if(!body) return;
  setDashHash('roles');
  var p = roleProfile(DASH_PROFILE || {});
  body.innerHTML = dashView('Roles for you', 'Open roles matched to your target.', 'My Career', 'loadDashboard()', '<div class="dash-loading">Loading...</div>');
  if(!p.target_role_title){ loadDashboard(); return; }
  var summary = null, ranked = [];
  try{ summary = await roleSummary(p); roleFilterDefault(summary, p); ranked = await dashFetchRoles(p, []); }catch(e){ console.error('roles', e); }
  ROLE_VIEW = { ranked: ranked, summary: summary, p: p, oppUrls: [], where: 'list' };
  renderRolesList();
  body.parentNode.scrollTop = 0;
}
// Reads the full posting from the company's feed, runs the real match, and
// opens the result as an Opportunity.
async function dashCheckFit(listingId, btn){
  if(!isCareerPlan()){ openPricingModal(); return; }
  var token = await getAuthTokenIfSignedIn();
  if(!token) return;
  var label = btn ? btn.textContent : '';
  if(btn){ btn.disabled = true; btn.textContent = 'Reading the posting...'; }
  var fail = function(msg, why){
    if(!btn) return;
    btn.disabled = false; btn.textContent = msg || label;
    var old = btn.parentNode && btn.parentNode.querySelector('.role-err'); if(old) old.remove();
    if(why) btn.insertAdjacentHTML('afterend', '<div class="role-err">' + escapeHtml(why) + '</div>');
  };
  try{
    var res = await fetch(OPP_URL, { method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer ' + token}, body: JSON.stringify({ listingId: listingId }) });
    var data = await res.json().catch(function(){ return { error: 'HTTP ' + res.status + ' with no body' }; });
    if(!res.ok){
      if(data.error === 'upgrade_required'){ fail(); openPricingModal(); return; }
      if(data.error === 'listing_unavailable' || data.error === 'listing_not_found'){ if(btn){ btn.textContent = 'No longer listed'; } return; }
      console.error('check fit', data); fail('Try again', (data.error || 'Failed') + (data.detail ? ': ' + data.detail : '') + ' (' + res.status + ')'); return;
    }
    DASH_ROLES = null; // this role is an opportunity now
    dashShowOpportunity(data.opportunity.id, data.opportunity);
  }catch(e){ console.error('check fit', e); fail('Try again', String(e && e.message || e)); }
}

// --- Opportunities -----------------------------------------------------------
// A pasted posting -> api/opportunity -> a career_opportunities row with the
// posting's stated facts, a per-requirement match, and a fit score computed
// server-side. Stage changes are logged to career_outcomes (the trigger in
// 0020 keeps the row's stage in step); that log is the hire-outcome data.
var OPP_URL = '/api/opportunity';
var OPP_STAGES = [['considering','Considering'],['applied','Applied'],['screening','Recruiter screen'],['interviewing','Interviewing'],['offer','Offer'],['accepted','Accepted'],['hired','Hired'],['rejected','Rejected'],['withdrawn','Withdrawn']];
var OPP_STAGE_LABEL = {}; OPP_STAGES.forEach(function(s){ OPP_STAGE_LABEL[s[0]] = s[1]; });
var OPP_OUTCOME_KIND = { applied:'applied', screening:'recruiter_screen', interviewing:'interview', offer:'offer', accepted:'accepted', hired:'hired', rejected:'rejected', withdrawn:'withdrew' };
var OPP_CURRENT = null;
var OPP_BRIEF = null;
// Set when a tool is opened from an opportunity, so the header can offer a
// way back to it. Cleared whenever the dashboard itself is shown again.
var OPP_RETURN = null; // { id, label }
function oppReturnHere(){
  if(OPP_CURRENT) OPP_RETURN = { id: OPP_CURRENT.id, label: (OPP_CURRENT.company || OPP_CURRENT.role_title) + ' opportunity' };
}
function syncBackToOpp(){
  var el = document.getElementById('navBackOpp');
  if(!el) return;
  if(OPP_RETURN && !DASH_ON){ el.textContent = '\u2190 Back to ' + OPP_RETURN.label; el.classList.add('show'); }
  else el.classList.remove('show');
}
function backToOpportunity(){
  if(isSending || !OPP_RETURN) return;
  var id = OPP_RETURN.id;
  clearChatState();
  showDashboard(true);
  dashShowOpportunity(id);
} // {id, archived_at} of an existing research brief for the open opportunity

// Where "paste a posting" goes: Career accounts track it as an opportunity;
// everyone else gets the Resume Review stopgap, as before.
function dashPostingEntry(){ if(isCareerPlan()) dashAddOpportunity(); else dashResume(); }

function oppFacts(o){
  var m = (o && o.posting) || {};
  var chips = [];
  if(m.level) chips.push(m.level.charAt(0).toUpperCase() + m.level.slice(1));
  if(m.work_type) chips.push(m.work_type === 'onsite' ? 'On-site' : m.work_type.charAt(0).toUpperCase() + m.work_type.slice(1));
  if(m.location) chips.push(m.location);
  var comp = dashComp({ target_comp_min: m.comp_min, target_comp_max: m.comp_max });
  if(comp) chips.push(comp);
  return chips;
}
// The verdict rule. Three numbers a recruiter can argue with, kept in one
// place: a clean apply needs this fit with nothing required missing; below
// the floor, or with this many required items missing, it is a skip;
// everything between is "apply with these fixes".
var VERDICT = { applyFit: 75, skipFit: 40, skipRequiredMissing: 2, maxFixes: 3 };
function oppVerdict(o){
  var out = { key: null, label: '', why: '', fixes: [], caveat: '' };
  if(!o || o.fit_score == null) return out;
  var reqs = (o.posting && Array.isArray(o.posting.requirements)) ? o.posting.requirements : [];
  var gaps = Array.isArray(o.fit_reasons) ? o.fit_reasons : [];
  var imp = {}; reqs.forEach(function(r){ imp[r.requirement] = r.importance; });
  var isReq = function(g){ return imp[g.requirement] === 'required'; };
  var missingReq = gaps.filter(function(g){ return g.status === 'missing' && isReq(g); });
  var partials = gaps.filter(function(g){ return g.status === 'partial'; }).sort(function(a,b){ return (isReq(b)?1:0) - (isReq(a)?1:0); });
  var names = function(list){ return list.map(function(g){ return g.requirement; }).join('; '); };
  if(o.fit_score < VERDICT.skipFit || missingReq.length >= VERDICT.skipRequiredMissing){
    out.key = 'skip'; out.label = 'Skip';
    out.why = missingReq.length >= VERDICT.skipRequiredMissing
      ? missingReq.length + ' required items have no evidence anywhere in your resume or profile: ' + names(missingReq) + '. A better-written resume does not close that.'
      : 'Too little of what this posting asks for shows up in your resume or profile.';
    out.caveat = 'If you do have that experience and Ezzy has not seen it, add it to your resume and score the posting again.';
    return out;
  }
  if(o.fit_score >= VERDICT.applyFit && !missingReq.length){
    out.key = 'apply'; out.label = 'Apply';
    // Partial matches at this fit are polish, not blockers.
    out.fixes = partials.slice(0, VERDICT.maxFixes).map(function(g){ return { requirement: g.requirement, note: g.note || '' }; });
    out.why = 'Nothing required is missing, and most of what they ask for is on your resume as written.'
      + (out.fixes.length ? ' ' + (out.fixes.length === 1 ? 'One item' : out.fixes.length + ' items') + ' could read stronger, but should not hold you back.' : '');
    return out;
  }
  out.key = 'fix'; out.label = 'Apply with these fixes';
  out.fixes = partials.slice(0, VERDICT.maxFixes).map(function(g){ return { requirement: g.requirement, note: g.note || '' }; });
  out.why = out.fixes.length
    ? 'You have related experience for ' + (out.fixes.length === 1 ? 'this item' : 'these items') + ', but the resume does not show it at the level the posting asks for.'
    : 'Close, but not a clean match.';
  if(missingReq.length) out.caveat = 'One required item has no evidence at all: ' + names(missingReq) + '. A resume fix will not cover it, so be ready to speak to it.';
  return out;
}
// The posting's stated facts next to the saved target. Only lines where
// both sides exist; nothing inferred.
function oppVsTarget(o, p){
  var m = (o && o.posting) || {}, out = [];
  p = p || {};
  var cap = function(t){ return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''; };
  if(m.level && p.target_level) out.push(m.level === p.target_level ? 'Level: ' + cap(m.level) + ', same as your target.' : 'Level: ' + cap(m.level) + '. Your target is ' + cap(p.target_level) + '.');
  var k = function(v){ return '$' + Math.round(v/1000) + 'k'; };
  var pmin = m.comp_min || m.comp_max, pmax = m.comp_max || m.comp_min;
  if(pmin && (p.target_comp_min || p.target_comp_max)){
    var range = pmin === pmax ? k(pmin) : k(pmin) + '–' + k(pmax);
    if(p.target_comp_min && pmax < p.target_comp_min) out.push('Pay: ' + range + '. Your range starts at ' + k(p.target_comp_min) + '.');
    else if(p.target_comp_max && pmin > p.target_comp_max) out.push('Pay: ' + range + ', above the top of your range (' + k(p.target_comp_max) + ').');
    else out.push('Pay: ' + range + ', inside the range you set.');
  }
  if(m.work_type && p.target_work_type && p.target_work_type !== 'any'){
    var w = function(t){ return t === 'onsite' ? 'on-site' : t; };
    out.push(m.work_type === p.target_work_type ? 'Work type: ' + w(m.work_type) + ', what you asked for.' : 'Work type: ' + w(m.work_type) + '. You asked for ' + w(p.target_work_type) + '.');
  }
  return out;
}
function oppFitLabel(o){
  if(o.fit_score == null) return '<span class="dash-nr">not scored</span>';
  var v = oppVerdict(o);
  var cls = v.key === 'apply' ? 'dash-score' : v.key === 'fix' ? 'dash-score mid' : 'dash-score low';
  var short = v.key === 'apply' ? 'Apply' : v.key === 'fix' ? 'Apply with fixes' : 'Skip';
  return '<span class="' + cls + '">' + short + ' · ' + o.fit_score + '%</span>';
}
// An opportunity in motion that has had no update for a week: time to ask.
var OPP_ACTIVE = { applied:1, screening:1, interviewing:1, offer:1 };
function oppDaysQuiet(o){ return Math.floor((Date.now() - new Date(o.updated_at).getTime()) / 86400000); }
function oppStale(o){ return !!(o && OPP_ACTIVE[o.stage] && oppDaysQuiet(o) >= 7); }
// Fit scores against what actually happened. Counted, not modelled, and
// only shown once there are enough logged outcomes to mean anything.
var CAL_MIN = 10;
function oppCalibrationHtml(opps){
  var logged = (opps || []).filter(function(o){ return o.fit_score != null && o.stage && o.stage !== 'considering'; });
  if(!logged.length) return '';
  if(logged.length < CAL_MIN) return '<div class="dash-muted">How your fit scores line up with what happens shows here after ' + CAL_MIN + ' logged outcomes. ' + logged.length + ' so far.</div>';
  var heard = { screening:1, interviewing:1, offer:1, accepted:1, hired:1 };
  var band = function(lo, hi, label){
    var rows = logged.filter(function(o){ return o.fit_score >= lo && o.fit_score < hi; });
    if(!rows.length) return '';
    var h = rows.filter(function(o){ return heard[o.stage]; }).length;
    return '<div>' + label + ': ' + h + ' of ' + rows.length + ' got a screen or further</div>';
  };
  return '<div class="opp-vs" style="border-top:1px solid #EEECE7;padding-top:12px"><span class="opp-sub">Your fit scores, against what happened</span>' + band(70, 101, 'Fit 70 and up') + band(50, 70, 'Fit 50 to 69') + band(0, 50, 'Fit under 50') + '</div>';
}
function dashOppRow(o){
  var bits = [OPP_STAGE_LABEL[o.stage] || o.stage].concat(oppFacts(o).slice(0,2));
  bits.push(dashDate(o.updated_at));
  return '<button class="dash-row" onclick="dashShowOpportunity(\'' + o.id + '\')"><div><div class="dash-row-t">' + escapeHtml(o.role_title) + (o.company ? ' \u00b7 ' + escapeHtml(o.company) : '') + (oppStale(o) ? ' <span class="dash-tag coral">Any news?</span>' : '') + '</div><div class="dash-row-s">' + bits.map(escapeHtml).join(' · ') + '</div>' + (o.company ? '<div class="opp-rating" data-company="' + escapeHtml(o.company) + '" data-hint="' + escapeHtml(oppRatingHint(o)) + '"></div>' : '') + '</div>' + oppFitLabel(o) + '</button>';
}

// Employer ratings (Glassdoor, Indeed, Blind) for the companies on the
// page. One request per company; the server keeps each for 30 days and
// only returns a number it found in the cited page text.
var RATINGS_CACHE = {};
// What a search needs to tell this company from a namesake: where the
// posting lives, the role, the location.
function oppRatingHint(o){
  var bits = [];
  try{ if(o.url) bits.push('job posting at ' + new URL(o.url).hostname.replace(/^www\./,'') + new URL(o.url).pathname.split('/').slice(0,2).join('/')); }catch(e){}
  if(o.role_title) bits.push('hiring a ' + o.role_title);
  var m = o.posting || {};
  if(m.location) bits.push('in ' + m.location);
  return bits.join(', ').slice(0, 240);
}
async function fetchCompanyRatings(company, hint){
  var k = company.toLowerCase().trim();
  if(RATINGS_CACHE[k]) return RATINGS_CACHE[k];
  RATINGS_CACHE[k] = (async function(){
    try{
      var sr = await window.supabaseClient.auth.getSession();
      var token = sr.data && sr.data.session && sr.data.session.access_token;
      if(!token) return [];
      var res = await fetch('/api/company-ratings?company=' + encodeURIComponent(company) + (hint ? '&hint=' + encodeURIComponent(hint) : ''), { headers:{ 'Authorization':'Bearer ' + token } });
      if(!res.ok) return [];
      var data = await res.json();
      return Array.isArray(data.ratings) ? data.ratings : [];
    }catch(e){ return []; }
  })();
  return RATINGS_CACHE[k];
}
function ratingText(r){ return r.site + ' ' + r.rating + (r.count ? ' (' + r.count.toLocaleString() + ')' : ''); }
function dashFillRatings(root){
  if(!root || !window.supabaseClient) return;
  var slots = [].slice.call(root.querySelectorAll('.opp-rating[data-company]'));
  slots.forEach(function(el){
    fetchCompanyRatings(el.getAttribute('data-company'), el.getAttribute('data-hint') || '').then(function(ratings){
      var inRow = el.tagName === 'DIV' && !!el.closest('button');
      if(!ratings.length){ if(!inRow) el.innerHTML = '<span class="dash-muted" style="margin:0">No employer rating that search could verify for ' + escapeHtml(el.getAttribute('data-company')) + '.</span>'; return; }
      if(inRow) el.textContent = ratings.map(ratingText).join(' \u00b7 ');
      else el.innerHTML = ratings.map(function(r){
        return '<a class="dash-chip" href="' + escapeHtml(r.url) + '" target="_blank" rel="noopener">' + escapeHtml(ratingText(r)) + ' \u2197</a>';
      }).join('') + '<span class="dash-muted" style="margin:0;align-self:center">Employer ratings found by search, each linked to the page it came from.</span>';
    });
  });
}

function dashAddOpportunity(){
  if(!isCareerPlan()){ openPricingModal(); return; }
  if(!DASH_ON) showDashboard(true);
  var body = document.getElementById('dashBody');
  if(!body) return;
  var inner = '<div class="dash-label">The posting</div>'
    + '<div class="dash-text">Paste the whole posting. Ezzy pulls out what it states (company, level, location, pay if printed) and the requirements that matter, then checks each one against your resume and profile. Nothing is scored that it can’t point to.</div>'
    + '<textarea id="oppJd" class="onb-textarea" placeholder="Paste the job posting here" style="min-height:260px"></textarea>'
    + '<input id="oppUrl" type="url" class="dash-input" placeholder="Link to the posting (optional)"/>'
    + '<div class="onb-status" id="oppStatus"></div>'
    + '<div class="onb-foot"><button class="dash-btn primary" id="oppGo" onclick="dashSubmitOpportunity()">Score it</button><span class="dash-muted">Takes about ten seconds.</span></div>';
  setDashHash('opps/new');
  body.innerHTML = dashView('Add an opportunity', 'A role you\u2019re considering, applying to, or interviewing for.', 'My Career', 'loadDashboard()', inner);
  body.parentNode.scrollTop = 0;
  var ta = document.getElementById('oppJd'); if(ta) ta.focus();
}

async function dashSubmitOpportunity(){
  var ta = document.getElementById('oppJd'), urlEl = document.getElementById('oppUrl'), btn = document.getElementById('oppGo'), st = document.getElementById('oppStatus');
  if(!ta || !btn) return;
  var jd = (ta.value || '').trim();
  var lines = jd.split(/\n/).filter(function(l){ return l.trim(); }).length;
  var say = function(msg, err){ if(st){ st.textContent = msg || ''; st.className = 'onb-status' + (err ? ' err' : ''); } };
  if(!jd){ say('Paste the posting first.', true); return; }
  if(jd.length < 400 && lines < 4){ say('That’s too short to be a posting. Ezzy needs the real requirements, not a title, or it would be grading you against a guess.', true); return; }
  var token = await getAuthTokenIfSignedIn();
  if(!token){ say('Sign in first.', true); return; }
  btn.disabled = true; ta.disabled = true;
  say('Reading the posting, then checking it against your profile...');
  try{
    var res = await fetch(OPP_URL, { method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer ' + token}, body: JSON.stringify({ jdText: jd, url: urlEl ? urlEl.value : '' }) });
    var data = await res.json().catch(function(){ return {}; });
    if(!res.ok){
      btn.disabled = false; ta.disabled = false;
      if(data.error === 'upgrade_required'){ openPricingModal(); say('Opportunities are part of the Career plan.', true); return; }
      if(data.error === 'posting_too_short'){ say('That’s too short to be a posting. Paste the full description.', true); return; }
      say('Could not score that posting. Try again in a moment.', true);
      console.error('opportunity', data);
      return;
    }
    dashShowOpportunity(data.opportunity.id, data.opportunity);
  }catch(e){
    btn.disabled = false; ta.disabled = false;
    say('Could not reach Ezzy. Check your connection and try again.', true);
    console.error('opportunity', e);
  }
}

async function dashShowOpportunities(){
  if(!DASH_ON) showDashboard(true);
  var body = document.getElementById('dashBody');
  if(!body || !window.supabaseClient) return;
  var sessionRes = await window.supabaseClient.auth.getSession();
  var session = sessionRes.data && sessionRes.data.session;
  if(!session) return;
  var r = await window.supabaseClient.from('career_opportunities').select('id,company,role_title,stage,fit_score,updated_at,posting').eq('user_id', session.user.id).order('updated_at',{ascending:false});
  var rows = r.data || [];
  var inner = rows.length ? rows.map(dashOppRow).join('') : '<div class="dash-empty"><div class="dash-empty-t">Nothing tracked yet</div><div class="dash-empty-s">Paste a posting and it lands here with a fit score and the reason.</div></div>';
  if(isCareerPlan()) inner += '<button class="dash-link" style="align-self:flex-start" onclick="dashAddOpportunity()">+ Add a posting</button>';
  // The funnel, counted from the rows. Nothing estimated.
  var cnt = function(list){ return rows.filter(function(o){ return list.indexOf(o.stage) !== -1; }).length; };
  var funnel = rows.length ? rows.length + ' tracked \u00b7 ' + cnt(['applied','screening','interviewing','offer','accepted','hired','rejected','withdrawn']) + ' applied \u00b7 ' + cnt(['interviewing','offer','accepted','hired']) + ' reached interviews \u00b7 ' + cnt(['offer','accepted','hired']) + ' offers.' : 'Nothing tracked yet.';
  setDashHash('opps');
  body.innerHTML = dashView('Opportunities', funnel + ' Open one to log where it stands or prep for it.', 'My Career', 'loadDashboard()', inner);
  dashFillRatings(body);
  body.parentNode.scrollTop = 0;
}

// For an opportunity from Roles for you: the date the company's board last
// listed it, when it no longer does; '' while it is still up or unknown.
async function oppPostingClosed(row){
  if(!row || row.source !== 'job_feed' || !row.external_id || !window.supabaseClient) return '';
  var k = String(row.external_id).split(':');
  if(k.length < 3) return '';
  try{
    var r = await window.supabaseClient.from('job_listings').select('active,last_seen_at')
      .eq('ats', k[0]).eq('slug', k[1]).eq('external_id', k.slice(2).join(':')).maybeSingle();
    return r.data && r.data.active === false ? (r.data.last_seen_at || '') : '';
  }catch(e){ console.error('posting state', e); return ''; }
}
async function dashShowOpportunity(id, row){
  OPP_RETURN = null;
  if(!DASH_ON) showDashboard(true);
  var body = document.getElementById('dashBody');
  if(!body || !window.supabaseClient) return;
  if(!row){
    body.innerHTML = '<div class="dash-loading">Loading...</div>';
    var r = await window.supabaseClient.from('career_opportunities').select('*').eq('id', id).maybeSingle();
    row = r.data;
    if(!row){ dashShowOpportunities(); return; }
  }
  OPP_CURRENT = row;
  setDashHash('opp/' + row.id);
  // A brief already written for this company and role is the thing to
  // offer, not another research run.
  OPP_BRIEF = null;
  if(row.company){
    try{
      var br = await window.supabaseClient.from('conversations').select('id,archived_at').eq('mode','research').eq('role', row.role_title).eq('research_company', row.company).order('created_at',{ascending:false});
      OPP_BRIEF = (br.data && br.data[0]) || null;
    }catch(e){ console.error('brief lookup', e); }
  }
  var outcomes = [];
  try{
    var oc = await window.supabaseClient.from('career_outcomes').select('id,kind,detail,occurred_at,created_at').eq('opportunity_id', row.id).order('created_at',{ascending:false});
    outcomes = oc.data || [];
  }catch(e){ console.error('outcomes', e); }
  var canEdit = isCareerPlan();
  var m = row.posting || {};
  var reqs = Array.isArray(m.requirements) ? m.requirements : [];
  var gaps = Array.isArray(row.fit_reasons) ? row.fit_reasons : [];
  var byReq = {}; gaps.forEach(function(g){ byReq[g.requirement] = g; });
  var matched = gaps.filter(function(g){ return g.status === 'matched'; }).length;
  var partial = gaps.filter(function(g){ return g.status === 'partial'; }).length;

  var html = '<div class="dash-chips">' + oppFacts(row).map(function(c){ return '<span class="dash-chip">' + escapeHtml(c) + '</span>'; }).join('')
    + (row.url ? '<a class="dash-chip" href="' + escapeHtml(row.url) + '" target="_blank" rel="noopener">Open posting ↗</a>' : '') + '</div>'
    + (row.company ? '<div class="dash-chips opp-rating" data-company="' + escapeHtml(row.company) + '" data-hint="' + escapeHtml(oppRatingHint(row)) + '"></div>' : '');
  // A role that came from the feed: say so when the company has since
  // taken the posting down. The opportunity itself stays; a closed posting
  // is not a rejection, so the stage is left to the person.
  var closed = await oppPostingClosed(row);
  if(closed) html += '<div class="dash-warn" style="margin:4px 0 10px">This posting came down on ' + escapeHtml(dashDate(closed)) + '. The company no longer lists it.</div>';

  // Verdict: apply, apply with these fixes, or skip. Computed from the
  // match above; the fit number stays as the working underneath it.
  var V = oppVerdict(row);
  html += '<div class="opp-fit' + (V.key ? ' v-' + V.key : '') + '">';
  if(V.key){
    html += '<div class="opp-verdict">' + V.label + '</div><div class="dash-text">' + escapeHtml(V.why) + '</div>';
    if(V.fixes.length){
      var stored = row.posting && row.posting.fixes && Array.isArray(row.posting.fixes.items) ? row.posting.fixes : null;
      if(V.key === 'apply') html += '<div class="opp-sub">Worth sharpening before you send it</div>';
      // Before the fixes are written: the items and what the match found.
      // After: the same items, each with its rewrite. Never both.
      html += '<div class="opp-fixes" id="oppFixShort">' + (stored ? '' : V.fixes.map(function(f){
        return '<div class="opp-fix"><span class="opp-fix-t">' + escapeHtml(f.requirement) + '</span>' + (f.note ? '<span class="opp-fix-n">' + escapeHtml(f.note) + '</span>' : '') + '</div>';
      }).join('')) + '</div>';
      html += '<div id="oppFixesOut">' + (stored ? renderOppFixes(stored) : '') + '</div>'
        + '<div class="opp-fix-actions"><button class="dash-btn primary" id="oppFixBtn" onclick="dashOppFixes()">' + oppFixBtnLabel(stored, V.key) + '</button>'
        + '<button class="dash-link" onclick="dashOppResume()">or run a full resume review against this posting</button></div>';
    }
    if(V.caveat) html += '<div class="dash-text">' + escapeHtml(V.caveat) + '</div>';
    var vs = oppVsTarget(row, DASH_PROFILE);
    if(vs.length) html += '<div class="opp-vs"><span class="opp-sub">Against your target</span>' + vs.map(function(t){ return '<div>' + escapeHtml(t) + '</div>'; }).join('') + '</div>';
    html += '<div class="dash-muted">' + row.fit_score + '% fit: ' + matched + ' of ' + reqs.length + ' requirements matched outright' + (partial ? ', ' + partial + ' partial' : '') + '. Required items count double. The verdict is a rule applied to that match, not an opinion; every row below points at your resume or profile.</div>';
  } else {
    html += '<div class="opp-verdict">No verdict yet</div><div class="dash-text">Ezzy has nothing on file to check this posting against. Do a Resume Review and it learns your skills and experience; then add the posting again.</div>';
  }
  html += '</div>';

  // Is it for you? The other half of fit, from what they said they want.
  html += '<div class="dash-label">Is it for you?</div><div id="oppWants">' + oppWantsHtml(row, null) + '</div>';

  // Requirements
  if(reqs.length){
    var icon = { matched:'✓', partial:'~', missing:'✕' };
    html += '<div class="dash-label">How you match</div><div class="dash-gaps">' + reqs.map(function(rq){
      var g = byReq[rq.requirement];
      var stt = g ? g.status : 'unscored';
      return '<div class="gap-row gap-' + stt + '"><span class="gap-icon">' + (icon[stt] || '·') + '</span><div><div class="gap-req">' + escapeHtml(rq.requirement) + (rq.importance === 'required' ? ' <span class="dash-tag">Required</span>' : '') + '</div>'
        + (g && g.note ? '<div class="gap-note">' + escapeHtml(g.note) + '</div>' : '')
        + (g && g.evidence_quote ? '<div class="gap-ev">\u201c' + escapeHtml(g.evidence_quote) + '\u201d <span>from your resume</span></div>' : '') + '</div></div>';
    }).join('') + '</div>';
  }

  // Stage
  html += '<div class="dash-label">Where it stands</div>';
  if(canEdit){
    var today = localDateStr();
    var offerish = row.stage === 'offer' || row.stage === 'accepted' || row.stage === 'hired';
    html += '<div class="opp-now">Currently: <strong>' + escapeHtml(OPP_STAGE_LABEL[row.stage] || row.stage) + '</strong></div>'
      + '<div class="opp-log">'
      + '<div class="opp-f"><label for="oppStage">What happened</label>' + selectHtml('oppStage', OPP_STAGES, row.stage).replace('<select ', '<select class="dash-field" onchange="dashStageChanged()" ') + '</div>'
      + '<div class="opp-f"><label for="oppDate">When</label><input type="date" id="oppDate" class="dash-field" value="' + today + '" max="' + today + '"/></div>'
      + '<div class="opp-f" id="oppCompWrap" style="' + (offerish ? '' : 'display:none') + '"><label for="oppComp">Base salary offered</label><input type="text" id="oppComp" class="dash-field" inputmode="numeric" placeholder="e.g. 185000"/></div>'
      + '<div class="opp-f" id="oppRoundWrap" style="display:none"><label for="oppRound">Which round</label>' + selectHtml('oppRound', OPP_ROUNDS, '').replace('<select ', '<select class="dash-field" ') + '</div>'
      + '<div class="opp-f wide"><label for="oppNote">Note (optional)</label><input type="text" id="oppNote" class="dash-field" maxlength="200" placeholder="Who you spoke to, what happens next"/></div>'
      + '<div class="opp-f wide" id="oppDebrief" style="display:none"><div class="opp-sub" style="margin-bottom:8px">Debrief, while it\u2019s fresh. The next prep for this company opens with it.</div>'
      + '<label for="oppDbOff">What caught you off guard, or felt flat?</label><input type="text" id="oppDbOff" class="dash-field" maxlength="300"/>'
      + '<label for="oppDbWorried" style="margin-top:8px">What did they seem most worried about?</label><input type="text" id="oppDbWorried" class="dash-field" maxlength="300"/>'
      + '<label for="oppDbLearned" style="margin-top:8px">What did you learn about the team\u2019s real problem?</label><input type="text" id="oppDbLearned" class="dash-field" maxlength="300"/></div>'
      + '<div class="opp-f wide"><button class="dash-btn primary" id="oppLogBtn" onclick="dashLogOutcome(\'' + row.id + '\')">Log update</button></div></div>'
      + '<div class="dash-muted" id="oppStageNote">' + (oppStale(row)
          ? (OPP_STAGE_LABEL[row.stage] || row.stage) + ' since ' + dashDate(row.updated_at) + ', ' + oppDaysQuiet(row) + ' days with nothing logged. Any news? <button class="dash-link" onclick="dashStillWaiting(\'' + row.id + '\')">Still waiting, ask me again in a week</button>'
          : '') + '</div>';
  } else {
    html += '<div class="opp-stage"><span class="dash-chip">' + escapeHtml(OPP_STAGE_LABEL[row.stage] || row.stage) + '</span></div>';
  }
  OPP_OUTCOMES = outcomes;
  if(outcomes.length){
    html += '<div class="opp-sub">History, newest first</div><div class="opp-history">' + outcomes.map(function(o){
      var d = o.detail || {};
      var comp = d.comp ? dashComp({ target_comp_min: d.comp }) + ' base' : '';
      return '<div class="opp-event"><div><span class="opp-event-k">' + escapeHtml(OUTCOME_KIND_LABEL[o.kind] || o.kind) + '</span><span class="opp-event-d">' + dashDate(o.occurred_at || o.created_at) + (comp ? ' \u00b7 ' + escapeHtml(comp) : '') + '</span>'
        + (d.round && o.kind !== 'recruiter_screen' ? '<div class="opp-event-n">' + escapeHtml(d.round.charAt(0).toUpperCase() + d.round.slice(1)) + ' round</div>' : '')
        + (d.note ? '<div class="opp-event-n">' + escapeHtml(d.note) + '</div>' : '')
        + (d.debrief ? '<div class="opp-event-n">' + [d.debrief.off_guard ? 'Off guard: ' + escapeHtml(d.debrief.off_guard) : '', d.debrief.worried ? 'They worried about: ' + escapeHtml(d.debrief.worried) : '', d.debrief.learned ? 'Learned: ' + escapeHtml(d.debrief.learned) : ''].filter(Boolean).join('<br>') + '</div>' : '') + '</div>'
        + (canEdit ? '<button class="dash-chip-x" onclick="dashRemoveOutcome(\'' + o.id + '\',\'' + row.id + '\')" aria-label="Remove this entry">&times;</button>' : '') + '</div>';
    }).join('') + '</div>';
  }

  // Prep for this one
  var focusNow = oppFocus(row);
  html += '<div class="dash-label">Prep for this one</div>'
    + (focusNow && focusNow.items.length ? '<div class="dash-text">Defend your resume: five questions aimed at the ' + focusNow.items.length + (focusNow.items.length === 1 ? ' requirement' : ' requirements') + ' it only partly shows, so you can explain them honestly before a recruiter asks.' + (focusNow.debrief ? ' Your debrief from the last round is in the brief.' : '') + '</div>' : '')
    + '<div class="dash-actions">'
    + '<button class="dash-btn primary" onclick="dashOppPractice()">' + (focusNow && focusNow.items.length ? 'Defend your resume' : 'Practice for this role') + '</button>'
    + (focusNow ? '<button class="dash-btn" onclick="dashOppStar()">Build stories for the gaps</button>' : '')
    + '<button class="dash-btn" onclick="dashOppMock()">Mock' + (focusNow && focusNow.round ? ' the ' + escapeHtml(focusNow.round) : ' interview') + '</button>'
    + (row.company ? '<button class="dash-btn" onclick="' + (OPP_BRIEF ? 'dashOppOpenBrief()' : 'dashOppResearch()') + '">' + (OPP_BRIEF ? 'Open your ' + escapeHtml(row.company) + ' brief' : 'Research ' + escapeHtml(row.company)) + '</button>' : '')
    + '<button class="dash-btn" onclick="dashOppResume()">Review my resume against it</button></div>';
  if(canEdit) html += '<div class="onb-foot" style="margin-top:8px"><button class="dash-link" style="color:#8A8A8A" onclick="dashRemoveOpportunity(\'' + row.id + '\')">Remove this opportunity</button></div>';

  body.innerHTML = dashView(escapeHtml(row.role_title) + (row.company ? ' <span style="color:#8A8A8A;font-weight:500">at ' + escapeHtml(row.company) + '</span>' : ''), 'Added ' + dashDate(row.created_at) + '.', 'Opportunities', 'dashShowOpportunities()', html);
  dashFillRatings(body);
  dashOppWantsLoad(row);
  body.parentNode.scrollTop = 0;
}

var OUTCOME_KIND_LABEL = { applied:'Applied', recruiter_screen:'Recruiter screen', interview:'Interview', final_round:'Final round', offer:'Offer', accepted:'Accepted the offer', rejected:'Rejected', withdrew:'Withdrew', hired:'Hired', started_role:'Started the role' };
// Steps that happen once for a given role. Screens, interviews, and offers can repeat.
var OUTCOME_ONCE = { applied:1, accepted:1, hired:1, rejected:1, withdrew:1 };
var OPP_OUTCOMES = [];
var OUTCOME_KIND_STAGE = { applied:'applied', recruiter_screen:'screening', interview:'interviewing', final_round:'interviewing', offer:'offer', accepted:'accepted', rejected:'rejected', withdrew:'withdrawn', hired:'hired', started_role:'hired' };

// Comp is only asked for where a number exists: an offer, or after it.
var OPP_ROUNDS = [['','Not sure'],['recruiter screen','Recruiter screen'],['hiring manager','Hiring manager'],['technical','Technical or case'],['panel','Panel'],['final','Final round'],['executive','Executive']];
function dashStageChanged(){
  var sel = document.getElementById('oppStage'), wrap = document.getElementById('oppCompWrap');
  if(!sel || !wrap) return;
  var v = sel.value;
  wrap.style.display = (v === 'offer' || v === 'accepted' || v === 'hired') ? '' : 'none';
  var isRound = v === 'screening' || v === 'interviewing';
  var db = document.getElementById('oppDebrief'); if(db) db.style.display = isRound ? '' : 'none';
  var rw = document.getElementById('oppRoundWrap'); if(rw) rw.style.display = v === 'interviewing' ? '' : 'none';
  if(v === 'screening'){ var rs = document.getElementById('oppRound'); if(rs) rs.value = 'recruiter screen'; }
}

// One entry in the outcome log: what happened, when, and for an offer the
// number. The log is the record; the trigger from 0020 moves the stage.
async function dashLogOutcome(id){
  if(!window.supabaseClient) return;
  var sel = document.getElementById('oppStage'), note = document.getElementById('oppStageNote'), btn = document.getElementById('oppLogBtn');
  if(!sel || !OPP_STAGE_LABEL[sel.value]) return;
  var stage = sel.value;
  var sessionRes = await window.supabaseClient.auth.getSession();
  var session = sessionRes.data && sessionRes.data.session;
  if(!session) return;
  var dateEl = document.getElementById('oppDate'), compEl = document.getElementById('oppComp'), noteEl = document.getElementById('oppNote');
  var today = localDateStr();
  var when = dateEl && /^\d{4}-\d{2}-\d{2}$/.test(dateEl.value) && dateEl.value <= today ? dateEl.value : today;
  var compWrap = document.getElementById('oppCompWrap');
  var detail = outcomeDetail(compEl && compWrap && compWrap.style.display !== 'none' ? compEl.value : '', noteEl ? noteEl.value : '');
  if(stage === 'screening' || stage === 'interviewing'){
    var rsel = document.getElementById('oppRound');
    detail.round = stage === 'screening' ? 'recruiter screen' : ((rsel && rsel.value) || '');
    var g = function(id){ var el = document.getElementById(id); return el ? el.value.trim().slice(0, 300) : ''; };
    var db = { off_guard: g('oppDbOff'), worried: g('oppDbWorried'), learned: g('oppDbLearned') };
    if(db.off_guard || db.worried || db.learned) detail.debrief = db;
  }
  // Some steps happen once per role. A second "Applied" is a mistake, not news.
  var kindWanted = OPP_OUTCOME_KIND[stage];
  var dup = OUTCOME_ONCE[kindWanted] && (OPP_OUTCOMES || []).filter(function(o){ return o.kind === kindWanted; })[0];
  if(dup){
    if(note) note.textContent = 'Already logged: ' + (OUTCOME_KIND_LABEL[kindWanted] || kindWanted) + ' on ' + dashDate(dup.occurred_at || dup.created_at) + '. Remove that entry below if the date is wrong.';
    return;
  }
  if(btn) btn.disabled = true;
  if(note) note.textContent = 'Saving...';
  var r;
  var kind = OPP_OUTCOME_KIND[stage];
  if(kind){
    r = await window.supabaseClient.from('career_outcomes').insert({ user_id: session.user.id, opportunity_id: id, kind: kind, source: 'ezzy_flow', occurred_at: when, detail: detail });
  } else {
    r = await window.supabaseClient.from('career_opportunities').update({ stage: stage, updated_at: new Date().toISOString() }).eq('id', id);
  }
  if(r.error){ console.error('log outcome', r.error); if(btn) btn.disabled = false; if(note) note.textContent = 'Could not save. Try again.'; return; }
  dashShowOpportunity(id);
}
// People type 185, 185k, $185,000. Anything under 10,000 is read as thousands.
function outcomeDetail(compText, noteText){
  var detail = {};
  var raw = parseFloat(String(compText || '').replace(/[$,\s]/g,'').replace(/k$/i,''));
  if(!isNaN(raw) && raw > 0){ detail.comp = raw >= 10000 ? Math.round(raw) : Math.round(raw * 1000); detail.currency = 'USD'; }
  var n = String(noteText || '').trim().slice(0,200);
  if(n) detail.note = n;
  return detail;
}

// "Nothing yet" is an answer too: it resets the week without inventing an event.
async function dashStillWaiting(id){
  if(!window.supabaseClient) return;
  var r = await window.supabaseClient.from('career_opportunities').update({ updated_at: new Date().toISOString() }).eq('id', id);
  if(r.error){ console.error('still waiting', r.error); return; }
  dashShowOpportunity(id);
}

// Removing an entry puts the stage back to whatever the latest remaining
// entry says (or Considering when none are left).
async function dashRemoveOutcome(outcomeId, oppId){
  if(!window.supabaseClient) return;
  if(!confirm('Remove this entry from the history?')) return;
  var r = await window.supabaseClient.from('career_outcomes').delete().eq('id', outcomeId);
  if(r.error){ console.error('remove outcome', r.error); return; }
  var left = await window.supabaseClient.from('career_outcomes').select('kind,created_at').eq('opportunity_id', oppId).order('created_at',{ascending:false});
  var latest = left.data && left.data[0];
  var stage = (latest && OUTCOME_KIND_STAGE[latest.kind]) || 'considering';
  await window.supabaseClient.from('career_opportunities').update({ stage: stage, updated_at: new Date().toISOString() }).eq('id', oppId);
  dashShowOpportunity(oppId);
}

async function dashRemoveOpportunity(id){
  if(!window.supabaseClient) return;
  if(!confirm('Remove this opportunity and its history?')) return;
  var r = await window.supabaseClient.from('career_opportunities').delete().eq('id', id);
  if(r.error){ console.error('remove opportunity', r.error); return; }
  dashShowOpportunities();
}

// The fixes themselves: for each requirement the verdict lists, the line
// on the resume that relates and a rewrite that makes it visible. Written
// and checked server-side (api/opportunity-fixes.js); a rewrite that uses
// anything the resume does not state never reaches the page.
var OPP_FIX_URL = '/api/opportunity-fixes';
function renderOppFixes(fx){
  var items = (fx && fx.items) || [];
  if(!items.length) return '';
  return '<div class="opp-fixlist">' + items.map(function(f, i){
    var body;
    if(f.rewrite){
      body = '<div class="opp-fx-l">On your resume now</div><div class="opp-fx-cur">\u201c' + escapeHtml(f.current_line) + '\u201d</div>'
        + '<div class="opp-fx-l">Change it to</div><div class="opp-fx-new" id="oppFx' + i + '">' + escapeHtml(f.rewrite) + '</div>'
        + (f.what_changed ? '<div class="opp-fx-why">' + escapeHtml(f.what_changed) + '</div>' : '')
        + '<button class="dash-link" onclick="copyOppFix(' + i + ', this)">Copy the rewrite</button>';
    } else {
      body = '<div class="opp-fx-why">' + escapeHtml(f.honest_gap || 'Nothing on your resume to build on for this one.') + '</div>';
    }
    return '<div class="opp-fx"><div class="opp-fx-t">' + escapeHtml(f.requirement) + '</div>' + body + '</div>';
  }).join('') + '</div>'
    + '<div class="dash-muted">' + (function(){
        var n = items.filter(function(f){ return !!f.rewrite; }).length;
        return (n ? n + ' of ' + items.length + (items.length === 1 ? ' has' : ' have') + ' a rewrite you can paste in. ' : 'No rewrites this time. ')
          + 'Written from the resume you gave me' + (fx.resume_date ? ' on ' + dashDate(fx.resume_date) : '') + ', using only what that resume already says.';
      })() + '</div>';
}
// What the button offers next, given what is already on the page.
function oppFixBtnLabel(fx, verdictKey){
  if(!fx) return verdictKey === 'apply' ? 'Show me how to sharpen these' : 'Show me how to fix these';
  var wrote = (fx.items || []).some(function(f){ return !!f.rewrite; });
  return wrote ? 'Write them again' : 'Try again';
}
function copyOppFix(i, btn){
  var el = document.getElementById('oppFx' + i);
  if(!el) return;
  var done = function(){ if(btn){ btn.textContent = 'Copied'; setTimeout(function(){ btn.textContent = 'Copy the rewrite'; }, 1600); } };
  try{ navigator.clipboard.writeText(el.textContent).then(done, function(){}); }catch(e){}
}
async function dashOppFixes(){
  if(!OPP_CURRENT) return;
  var o = OPP_CURRENT;
  var btn = document.getElementById('oppFixBtn'), out = document.getElementById('oppFixesOut');
  if(!btn || !out) return;
  var token = await getAuthTokenIfSignedIn();
  if(!token) return;
  btn.disabled = true; btn.textContent = 'Writing the fixes...';
  try{
    var res = await fetch(OPP_FIX_URL, { method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer ' + token}, body: JSON.stringify({ opportunityId: o.id }) });
    var data = await res.json().catch(function(){ return {}; });
    btn.disabled = false;
    if(!res.ok){
      btn.textContent = 'Show me how to fix these';
      if(data.error === 'upgrade_required'){ openPricingModal(); return; }
      out.innerHTML = '<div class="dash-text">Could not write the fixes just now. Try again in a moment.</div>';
      console.error('opportunity fixes', data);
      return;
    }
    if(data.reason === 'no_resume'){
      btn.textContent = 'Show me how to fix these';
      out.innerHTML = '<div class="dash-text">Ezzy has no resume on file to rewrite. Run a resume review once and the fixes can be written from it.</div>';
      return;
    }
    var fx = { items: data.fixes || [], resume_date: data.resume_date, generated_at: data.generated_at };
    o.posting = Object.assign({}, o.posting || {}, { fixes: fx });
    var shortList = document.getElementById('oppFixShort'); if(shortList) shortList.innerHTML = '';
    out.innerHTML = renderOppFixes(fx);
    btn.textContent = oppFixBtnLabel(fx);
  }catch(e){
    btn.disabled = false; btn.textContent = 'Show me how to fix these';
    out.innerHTML = '<div class="dash-text">Could not reach Ezzy. Check your connection and try again.</div>';
    console.error('opportunity fixes', e);
  }
}

// Prep shortcuts carry the role (and company) in, so nothing is re-typed.
// A live brief reopens in research mode (follow-ups still work); an
// archived one opens read-only like any past session.
function dashOppOpenBrief(){
  if(!OPP_BRIEF){ dashOppResearch(); return; }
  if(OPP_BRIEF.archived_at) dashShowSession(OPP_BRIEF.id, 'Company Research', (OPP_CURRENT.company || 'the') + ' opportunity', 'dashShowOpportunity(\'' + OPP_CURRENT.id + '\')');
  else dashOppResearch();
}
async function dashOppMock(){
  if(!OPP_CURRENT) return;
  var o = OPP_CURRENT; var focus = oppFocus(o);
  oppReturnHere();
  window._practiceFocus = focus; window._practiceOpportunityId = focus ? o.id : null;
  try{
    var sr = await window.supabaseClient.auth.getSession(); var uid = sr.data && sr.data.session && sr.data.session.user.id;
    if(uid) await window.supabaseClient.from('conversations').update({ archived_at: new Date().toISOString() })
      .eq('user_id', uid).eq('mode', 'mock').eq('role', o.role_title).is('archived_at', null).or('opportunity_id.is.null,opportunity_id.neq.' + o.id);
  }catch(e){ console.error('archive general mock', e); }
  dashStartMode(o.role_title, 'mock', 'Mock Interview');
}
async function dashOppStar(){
  if(!OPP_CURRENT) return;
  var o = OPP_CURRENT; var focus = oppFocus(o); if(!focus){ dashOppPractice(); return; }
  oppReturnHere();
  window._practiceFocus = focus; window._practiceOpportunityId = o.id;
  try{
    var sr = await window.supabaseClient.auth.getSession(); var uid = sr.data && sr.data.session && sr.data.session.user.id;
    if(uid) await window.supabaseClient.from('conversations').update({ archived_at: new Date().toISOString() })
      .eq('user_id', uid).eq('mode', 'star').eq('role', o.role_title).is('archived_at', null).or('opportunity_id.is.null,opportunity_id.neq.' + o.id);
  }catch(e){ console.error('archive general star', e); }
  dashStartMode(o.role_title, 'star', 'STAR Coaching');
}
async function dashOppPractice(){
  if(!OPP_CURRENT) return;
  var o = OPP_CURRENT;
  oppReturnHere();
  var focus = oppFocus(o);
  window._practiceFocus = focus; window._practiceOpportunityId = focus ? o.id : null;
  // A set for this posting starts clean: a live general set for the same
  // role is archived (it stays in Sessions), and one already started for
  // this very posting comes back as it was.
  if(focus){
    try{
      var sr = await window.supabaseClient.auth.getSession(); var uid = sr.data && sr.data.session && sr.data.session.user.id;
      if(uid) await window.supabaseClient.from('conversations').update({ archived_at: new Date().toISOString() })
        .eq('user_id', uid).eq('mode', 'practice').eq('role', o.role_title).is('archived_at', null).or('opportunity_id.is.null,opportunity_id.neq.' + o.id);
    }catch(e){ console.error('archive general practice', e); }
  }
  dashStartMode(o.role_title, 'practice', 'Practice Q&A');
}

// --- Is it for you? --------------------------------------------------------
// The other half of fit: the posting read against what the person said
// they want (profile.wants). Computed by api/opportunity-wants and kept on
// the opportunity (posting.wants) so it shows without another call.
var OPP_WANTS_URL = '/api/opportunity'; // action: 'wants'
function wantsSet(p){ var w = (p && p.wants) || {}; return !!(w.pull || w.cold || w.musts || w.optimizing); }
async function dashGoEditTarget(){ if(!DASH_ON) showDashboard(true); await loadDashboard(); dashEditTarget(); }
function oppWantsHtml(row, state){
  var W = row.posting && row.posting.wants;
  if(!wantsSet(DASH_PROFILE)) return '<div class="dash-empty"><div class="dash-empty-t">Ezzy doesn\u2019t know what you want yet</div><div class="dash-empty-s">Say what pulls you in, what leaves you cold, and what this move is for. Every posting then gets read against it, in your words.</div><button class="dash-btn" onclick="dashGoEditTarget()">Tell Ezzy what you want</button></div>';
  if(state === 'loading') return '<div class="dash-muted">Reading the posting against what you want...</div>';
  if(state && state.error) return '<div class="dash-text">' + escapeHtml(state.error) + '</div><button class="dash-link" onclick="dashOppWantsRun(true)">Try again</button>';
  if(!W || !Array.isArray(W.items)) return '<button class="dash-btn" onclick="dashOppWantsRun(true)">Read it against what you want</button>';
  var V = W.stance || {}; var cls = { pursue:'v-apply', test:'v-fix', pass:'v-skip' }[V.key] || '';
  var group = function(key, title){
    var items = W.items.filter(function(i){ return i.bucket === key; });
    if(!items.length) return '';
    return '<div class="opp-sub">' + title + '</div><div class="opp-fixes">' + items.map(function(i){
      return '<div class="opp-fix"><span class="opp-fix-t">\u201c' + escapeHtml(i.your_words) + '\u201d</span>'
        + '<span class="opp-fix-n">' + escapeHtml(i.note) + (i.source_quote ? ' <span style="color:#8A8A8A">Posting: \u201c' + escapeHtml(i.source_quote) + '\u201d</span>' : '') + '</span>'
        + (i.question ? '<span class="opp-fix-n"><strong>Ask:</strong> ' + escapeHtml(i.question) + '</span>' : '') + '</div>';
    }).join('') + '</div>';
  };
  return '<div class="opp-fit ' + cls + '"><div class="opp-verdict">' + escapeHtml(V.title || '') + '</div><div class="dash-text">' + escapeHtml(V.why || '') + '</div>'
    + group('rubs', 'Rubs against what you said') + group('fits', 'Fits what you said') + group('unknown', 'Worth asking')
    + '<div class="opp-fix-actions"><button class="dash-btn primary" onclick="dashOppDecide()">Talk it through</button><button class="dash-link" onclick="dashOppWantsRun(true)">Read it again</button></div>'
    + '<div class="dash-muted">Read from your own words and the posting' + (W.used_brief ? ' and your research brief' : '') + '.' + (W.dropped ? ' ' + W.dropped + (W.dropped === 1 ? ' line was' : ' lines were') + ' dropped for quoting words that are in neither.' : '') + '</div></div>';
}
function dashOppWantsLoad(row){
  var W = row.posting && row.posting.wants;
  if(wantsSet(DASH_PROFILE) && !(W && Array.isArray(W.items))) dashOppWantsRun(false);
}
async function dashOppWantsRun(force){
  var row = OPP_CURRENT; var box = document.getElementById('oppWants'); if(!row || !box) return;
  if(!isCareerPlan()){ openPricingModal(); return; }
  box.innerHTML = oppWantsHtml(row, 'loading');
  try{
    var token = await getAuthTokenIfSignedIn(); if(!token) return;
    var res = await fetch(OPP_WANTS_URL, { method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer ' + token}, body: JSON.stringify({ action: 'wants', opportunityId: row.id }) });
    var data = await res.json().catch(function(){ return {}; });
    if(!res.ok){
      if(data.error === 'upgrade_required'){ openPricingModal(); box.innerHTML = oppWantsHtml(row, { error: 'Part of the Career plan.' }); return; }
      if(data.error === 'wants_required'){ box.innerHTML = oppWantsHtml(row, null); return; }
      box.innerHTML = oppWantsHtml(row, { error: 'Could not read it just now' + (data.detail ? ': ' + data.detail : '') + '.' }); return;
    }
    row.posting = Object.assign({}, row.posting || {}, { wants: data.wants });
    if(OPP_CURRENT && OPP_CURRENT.id === row.id) OPP_CURRENT.posting = row.posting;
    box.innerHTML = oppWantsHtml(row, null);
  }catch(e){ box.innerHTML = oppWantsHtml(row, { error: 'Could not read it just now.' }); }
}
// Talk it through: a bounded conversation about this one opportunity that
// ends in a stance. Lives in chat as the 'decide' mode, tied to the
// opportunity so coming back restores the right one.
async function dashOppDecide(){
  if(!OPP_CURRENT) return;
  var o = OPP_CURRENT;
  if(!isCareerPlan()){ openPricingModal(); return; }
  oppReturnHere();
  hideDashboard();
  ROLE = o.role_title; window.ROLE = o.role_title;
  enterAppShell(o.role_title);
  inputEl.disabled = false;
  inputEl.placeholder = 'Type your answer...';
  window._decideOpportunityId = o.id;
  try{
    var sessionRes = await window.supabaseClient.auth.getSession();
    var uid = sessionRes.data && sessionRes.data.session && sessionRes.data.session.user.id;
    if(uid){
      await window.supabaseClient.from('conversations').update({ archived_at: new Date().toISOString() })
        .eq('user_id', uid).eq('mode', 'decide').eq('role', o.role_title).is('archived_at', null).or('opportunity_id.is.null,opportunity_id.neq.' + o.id);
    }
  }catch(e){ console.error('archive other decide', e); }
  await startMode('decide', 'Talk through an opportunity');
}
async function dashOppResearch(){
  if(!OPP_CURRENT || !OPP_CURRENT.company) return;
  var o = OPP_CURRENT;
  oppReturnHere();
  hideDashboard();
  ROLE = o.role_title; window.ROLE = o.role_title;
  enterAppShell(o.role_title);
  inputEl.disabled = false;
  inputEl.placeholder = 'Type a company name...';
  // A brief on file for this role but a different company would be restored
  // in place of this one; archive it so this company's research starts
  // clean. A brief for the same company comes back as it was.
  try{
    var sessionRes = await window.supabaseClient.auth.getSession();
    var uid = sessionRes.data && sessionRes.data.session && sessionRes.data.session.user.id;
    if(uid){
      await window.supabaseClient.from('conversations').update({ archived_at: new Date().toISOString() })
        .eq('user_id', uid).eq('mode', 'research').eq('role', o.role_title).is('archived_at', null).neq('research_company', o.company);
    }
  }catch(e){ console.error('archive other research', e); }
  await startMode('research', 'Company Research');
  // The company is known, so the research runs; nothing to type.
  if(RESEARCH_STAGE === 'awaiting_company') handleSendText(o.company);
}
async function dashOppResume(){
  if(!OPP_CURRENT) return;
  var o = OPP_CURRENT;
  oppReturnHere();
  hideDashboard();
  ROLE = null; window.ROLE = null;
  enterAppShell(null);
  resumeDropDismissed = false;
  inputEl.disabled = false;
  inputEl.placeholder = 'Type your answer...';
  await startMode('resume', 'Resume Feedback');
  // An old review on file would swallow the posting; start clean instead.
  if(RESUME_STAGE !== 'awaiting_resume') await startNewResumeReview();
  PENDING_JD = o.jd_text || null;
  if(!PENDING_JD) return;
  var posting = 'the ' + o.role_title + (o.company ? ' posting from ' + o.company : ' posting');
  // The resume from the last review is on file; asking for it again is busywork.
  var last = await latestResumeOnFile();
  if(last){
    resumeDropDismissed = true;
    var dz = document.getElementById('dropZone'); if(dz) dz.classList.remove('active');
    addMsg('bot', 'Reviewing the resume you gave me' + (last.when ? ' on ' + dashDate(last.when) : '') + ' against ' + posting + '. To use a different resume, click Start a new review when this one finishes.');
    handleSendText(last.text);
  } else {
    addMsg('bot', 'I have ' + posting + '. Drop or paste your resume and I\u2019ll review it against that.');
  }
}
// The most recent resume Ezzy has seen, if any: the profile copy (written
// by extraction from onboarding or a review) first, then the last review's
// row for accounts from before the profile carried one.
async function latestResumeOnFile(){
  try{
    var sessionRes = await window.supabaseClient.auth.getSession();
    var uid = sessionRes.data && sessionRes.data.session && sessionRes.data.session.user.id;
    if(!uid) return null;
    var usable = function(text){ return text && text.trim().length >= 200; };
    var p = await window.supabaseClient.from('career_profile').select('resume_text,resume_updated_at').eq('user_id', uid).maybeSingle();
    if(p.data && usable(p.data.resume_text)) return { text: p.data.resume_text, when: p.data.resume_updated_at };
    var r = await window.supabaseClient.from('conversations').select('resume_text,updated_at').eq('user_id', uid).eq('mode', 'resume').not('resume_text', 'is', null).order('updated_at', {ascending:false}).limit(1);
    var row = r.data && r.data[0];
    return row && usable(row.resume_text) ? { text: row.resume_text, when: row.updated_at } : null;
  }catch(e){ console.error('latest resume', e); return null; }
}

// --- First visit on the Career plan ----------------------------------------
// Replaces the dashboard until the profile has something in it or the
// person finishes or skips (career_profile.onboarded_at). Two steps:
// resume (extraction fills the profile, every claim quoted from it), then
// the target. Nothing is rated here; the dashboard's "not yet" states
// take over after.
var ONB = null; // { step:'resume'|'target', name, profile, learned, target:'yes'|'no'|null, busy }
var ONB_DRAG_BOUND = false;
var ONB_DONE = false; // finished or skipped this visit, even if the write failed

function dashNeedsOnboarding(d){
  return isCareerPlan() && !ONB_DONE && !d.profile.onboarded_at && !d.profile.target_role_title && !d.claims.length;
}

function renderOnboarding(body, d){
  if(!ONB) ONB = { step:'resume', learned:null, target:null, busy:false };
  ONB.name = d.name; ONB.profile = d.profile || {};
  onbRender();
}

function onbRender(){
  var body = document.getElementById('dashBody');
  if(!body || !ONB) return;
  var onResume = ONB.step === 'resume';
  var html = '<div class="dash-top"><div><h1 class="dash-h1">' + dashGreeting(ONB.name) + '</h1><div class="dash-sub">Two quick things and My Career is set up. Both can be changed later.</div></div></div>';
  html += '<div class="dash-card dash-single"><div class="onb-steps"><span class="onb-step' + (onResume ? ' on' : ' done') + '">1 · Your resume</span><span class="onb-step' + (onResume ? '' : ' on') + '">2 · Your target</span></div>';
  html += onResume ? onbResumeStep() : onbTargetStep();
  html += '</div>';
  body.innerHTML = html;
  body.parentNode.scrollTop = 0;
  if(onResume) onbBindDrop();
  else if(ONB.target === 'yes'){ var r = document.getElementById('tgtRole'); if(r) r.focus(); }
}

function onbResumeStep(){
  return '<div class="dash-label">Your resume</div>'
    + '<div class="dash-text">Ezzy reads it once and pulls out your skills and experience, each tied to the line it came from. That is what prep and matching run on.</div>'
    + '<div class="onb-drop" id="onbDrop"><div class="drop-zone-icon">↑</div><div class="drop-zone-title">Drop your resume here</div><div class="drop-zone-sub">PDF or TXT</div>'
    + '<input type="file" id="onbFile" accept=".pdf,.txt,application/pdf,text/plain" style="display:none" onchange="onbFilePicked(this)">'
    + '<button type="button" class="drop-zone-browse-btn" onclick="document.getElementById(\'onbFile\').click()">Choose file</button>'
    + '<div class="drop-zone-paste">or <a onclick="onbShowPaste()">paste it as text</a></div></div>'
    + '<div id="onbPaste" style="display:none"><textarea id="onbPasteText" class="onb-textarea" placeholder="Paste your resume text here"></textarea><div class="dash-actions" style="margin-top:10px"><button class="dash-btn primary" onclick="onbUseText()">Use this</button></div></div>'
    + '<div class="onb-status" id="onbStatus"></div>'
    + '<div class="onb-foot"><button class="dash-link" onclick="onbSkipResume()">Skip for now</button><span class="dash-muted">You can do a Resume Review from My Career any time.</span></div>';
}

function onbTargetStep(){
  var p = ONB.profile || {};
  var html = '<div class="dash-label">Your target</div>';
  var L = ONB.learned;
  if(L && L.count > 0){
    var bits = [];
    if(p.current_role_title) bits.push('<strong>' + escapeHtml(p.current_role_title) + (p.current_industry ? ', ' + escapeHtml(p.current_industry) : '') + '</strong>');
    if(p.years_experience) bits.push(Number(p.years_experience) + ' years of experience');
    var skills = (L.claims || []).filter(function(c){ return c.claim_type === 'skill'; }).slice(0, 6);
    html += '<div class="onb-learned"><div>From your resume: ' + (bits.length ? bits.join(', ') + ', and ' : '') + L.count + ' item' + (L.count === 1 ? '' : 's') + ' Ezzy can point to a line for.</div>'
      + (skills.length ? '<div class="dash-chips" style="margin-top:10px">' + skills.map(function(c){ return '<span class="dash-chip coral">' + escapeHtml(c.label) + '</span>'; }).join('') + '</div>' : '')
      + '<div class="dash-muted" style="margin-top:8px">All of it, with the line each came from, is under What Ezzy knows on My Career. Remove anything that is wrong.</div></div>';
  } else if(L && L.failed){
    html += '<div class="onb-learned">Ezzy could not read that just now. Resume Review on My Career does the same job later.</div>';
  } else if(L){
    html += '<div class="onb-learned">Ezzy did not find anything it could quote from that text. Resume Review on My Career does the same job later.</div>';
  }
  html += '<div class="dash-text" style="font-weight:600">Do you know the role you’re going for?</div>';
  if(!ONB.target){
    html += '<div class="dash-actions"><button class="dash-btn primary" onclick="onbTarget(\'yes\')">Yes, I know it</button><button class="dash-btn" onclick="onbTarget(\'no\')">Not yet</button></div>';
  } else if(ONB.target === 'yes'){
    html += renderTargetBlock(p, true) + '<button class="dash-link" onclick="onbTarget(null)">Back</button>';
  } else {
    html += '<div class="dash-text">No problem. Set your target sits first on My Career whenever you are ready, and prep works without it. One thing that helps now:</div>'
      + '<div class="brain-target"><div class="brain-target-row"><div class="brain-field"><label>When do you want to be in a new role?</label>' + selectHtml('onbTimeline', TARGET_TIMELINE, p.target_timeline) + '</div></div></div>'
      + '<div class="onb-foot"><button class="dash-btn primary" id="onbGo" onclick="onbFinishNoTarget()">Go to My Career</button><button class="dash-link" onclick="onbTarget(null)">Back</button></div>';
  }
  return html;
}

function onbBindDrop(){
  var box = document.getElementById('onbDrop');
  if(!box) return;
  ['dragenter','dragover'].forEach(function(evt){
    box.addEventListener(evt, function(e){ e.preventDefault(); e.stopPropagation(); box.classList.add('dragging'); });
  });
  box.addEventListener('dragleave', function(e){ if(e.target === box) box.classList.remove('dragging'); });
  box.addEventListener('drop', function(e){
    e.preventDefault(); e.stopPropagation(); box.classList.remove('dragging');
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if(f) onbFile(f);
  });
  // A file dropped next to the box must not navigate the tab to the PDF.
  if(!ONB_DRAG_BOUND){
    ONB_DRAG_BOUND = true;
    ['dragover','drop'].forEach(function(evt){
      window.addEventListener(evt, function(e){ if(ONB && DASH_ON && ONB.step === 'resume') e.preventDefault(); }, false);
    });
  }
}

function onbStatus(msg, isErr){
  var el = document.getElementById('onbStatus');
  if(!el) return;
  el.textContent = msg || '';
  el.className = 'onb-status' + (isErr ? ' err' : '');
}
function onbShowPaste(){
  var el = document.getElementById('onbPaste');
  if(!el) return;
  el.style.display = '';
  var ta = document.getElementById('onbPasteText'); if(ta) ta.focus();
}
function onbFilePicked(input){
  var f = input.files && input.files[0];
  input.value = '';
  if(f) onbFile(f);
}
function onbFile(file){
  if(!ONB || ONB.busy) return;
  onbStatus('Reading ' + (file.name || 'your file') + '...');
  readResumeFile(file).then(function(text){ onbProcess(text); }, function(err){
    onbStatus((err && err.message) || 'I had trouble reading that file. Try pasting the text instead.', true);
  });
}
function onbUseText(){
  var ta = document.getElementById('onbPasteText');
  onbProcess(ta ? ta.value : '');
}
async function onbProcess(text){
  if(!ONB || ONB.busy) return;
  text = String(text || '').trim();
  if(text.length < 20){ onbStatus('That looked empty. Try a different file or paste your resume as text.', true); return; }
  ONB.busy = true;
  onbStatus('Ezzy is reading your resume. This takes a few seconds...');
  var data = await extractCareerClaims(text, '', true);
  // Extraction wrote to career_profile; read it back so step 2 shows it.
  try{
    var sessionRes = await window.supabaseClient.auth.getSession();
    var uid = sessionRes.data && sessionRes.data.session && sessionRes.data.session.user.id;
    if(uid){
      var r = await window.supabaseClient.from('career_profile').select('*').eq('user_id', uid).maybeSingle();
      if(r.data){ ONB.profile = r.data; DASH_PROFILE = r.data; BRAIN_PROFILE = r.data; }
    }
  }catch(e){ console.error('onboarding profile reload', e); }
  ONB.learned = data ? { count: data.savedCount || 0, claims: data.claims || [] } : { count: 0, failed: true };
  ONB.busy = false;
  ONB.step = 'target';
  onbRender();
}
function onbSkipResume(){
  if(!ONB || ONB.busy) return;
  ONB.learned = null;
  ONB.step = 'target';
  onbRender();
}
function onbTarget(choice){
  if(!ONB) return;
  ONB.target = choice;
  onbRender();
}
async function onbFinishNoTarget(){
  var sel = document.getElementById('onbTimeline');
  var btn = document.getElementById('onbGo'); if(btn) btn.disabled = true;
  await onbFinish({ target_timeline: (sel && sel.value) || null });
}
// Marks the profile onboarded (plus whatever the step collected) and
// hands over to the dashboard. If the write fails the card still goes
// away for this visit; it just comes back next time.
async function onbFinish(extra){
  try{
    var sessionRes = await window.supabaseClient.auth.getSession();
    var session = sessionRes.data && sessionRes.data.session;
    if(session){
      var row = Object.assign({ user_id: session.user.id, onboarded_at: new Date().toISOString(), updated_at: new Date().toISOString() }, extra || {});
      var r = await window.supabaseClient.from('career_profile').upsert(row, {onConflict:'user_id'});
      if(r.error) console.error('onboarding finish', r.error);
    }
  }catch(e){ console.error('onboarding finish', e); }
  ONB = null; ONB_DONE = true;
  var body = document.getElementById('dashBody');
  if(body) body.innerHTML = '<div class="dash-loading">Setting up My Career...</div>';
  await loadDashboard();
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, function(ch){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];
  });
}

var TARGET_LEVELS = [['','Level'],['entry','Entry'],['mid','Mid'],['senior','Senior'],['staff','Staff'],['principal','Principal'],['manager','Manager'],['director','Director'],['vp','VP'],['exec','Exec']];
var TARGET_WORK = [['','Work type'],['remote','Remote'],['hybrid','Hybrid'],['onsite','On-site'],['any','Any']];
var TARGET_TIMELINE = [['','Timeline'],['asap','ASAP'],['3_months','~3 months'],['6_months','~6 months'],['12_months','~12 months'],['exploring','Just exploring']];

function selectHtml(id, options, value){
  return '<select id="'+id+'">' + options.map(function(o){
    return '<option value="'+o[0]+'"'+(o[0]===(value||'')?' selected':'')+'>'+o[1]+'</option>';
  }).join('') + '</select>';
}

function renderTargetBlock(p, noTitle){
  p = p || {};
  var w = p.wants || {};
  var comp = function(v){ if(!v) return ''; if(v > 10000000) v = v/1000; return Math.round(v/1000); };
  var hint;
  if(!p.target_role_title) hint = 'Tell Ezzy what you’re going for. Matching and prep are pointed at this.';
  else if(p.target_source==='stated' || p.target_source==='discovered') hint = 'Confirmed by you.';
  else if(p.target_source==='resume') hint = 'Taken from your resume. Confirm or change it.';
  else hint = 'Taken from the role you picked. Confirm or change it.';
  return (noTitle ? '' : '<div class="brain-group-title">Your target</div>')
    + '<div class="brain-target">'
    + '<div class="brain-target-row"><div class="brain-field"><label>Role</label><input id="tgtRole" type="text" placeholder="e.g. Senior Product Manager" value="'+escapeHtml(p.target_role_title||'')+'"/></div></div>'
    + '<div class="brain-target-row"><div class="brain-field"><label>Level</label>'+selectHtml('tgtLevel', TARGET_LEVELS, p.target_level)+'</div>'
    + '<div class="brain-field"><label>Work type</label>'+selectHtml('tgtWork', TARGET_WORK, p.target_work_type)+'</div></div>'
    + '<div class="brain-target-row"><div class="brain-field"><label>Comp min ($)</label><input id="tgtCompMin" type="number" min="0" step="5" placeholder="e.g. 150000" value="'+(comp(p.target_comp_min) ? comp(p.target_comp_min)*1000 : '')+'"/></div>'
    + '<div class="brain-field"><label>Comp max ($)</label><input id="tgtCompMax" type="number" min="0" step="5" placeholder="e.g. 200000" value="'+(comp(p.target_comp_max) ? comp(p.target_comp_max)*1000 : '')+'"/></div></div>'
    + '<div class="brain-target-row"><div class="brain-field"><label>Location(s)</label><input id="tgtLoc" type="text" placeholder="e.g. NYC, Remote US" value="'+escapeHtml((p.target_locations||[]).join(', '))+'"/></div>'
    + '<div class="brain-field"><label>Timeline</label>'+selectHtml('tgtTimeline', TARGET_TIMELINE, p.target_timeline)+'</div></div>'
    + '<div class="brain-group-title">What you want from the next one</div>'
    + '<div class="brain-target-row"><div class="brain-field"><label>What pulls you in</label><input id="wantPull" type="text" maxlength="240" placeholder="e.g. developer tools, climate, something I would use myself" value="'+escapeHtml(w.pull||'')+'"/></div></div>'
    + '<div class="brain-target-row"><div class="brain-field"><label>What leaves you cold</label><input id="wantCold" type="text" maxlength="240" placeholder="e.g. medical supply, ad tech, anything I could not explain to a friend" value="'+escapeHtml(w.cold||'')+'"/></div></div>'
    + '<div class="brain-target-row"><div class="brain-field"><label>Non-negotiables</label><input id="wantMusts" type="text" maxlength="240" placeholder="e.g. remote, equity, a manager I would learn from" value="'+escapeHtml(w.musts||'')+'"/></div></div>'
    + '<div class="brain-target-row"><div class="brain-field"><label>This move is for</label><input id="wantFor" type="text" maxlength="240" placeholder="e.g. a title bump, a mission I can pitch, more pace" value="'+escapeHtml(w.optimizing||'')+'"/></div></div>'
    + '<div class="brain-target-foot"><div class="brain-target-hint" id="tgtHint">'+hint+'</div><button class="brain-save" id="tgtSave" onclick="saveTarget()">Save</button></div>'
    + '</div>';
}

async function saveTarget(){
  if(!window.supabaseClient) return;
  var sessionRes = await window.supabaseClient.auth.getSession();
  var session = sessionRes.data && sessionRes.data.session;
  if(!session) return;
  var btn = document.getElementById('tgtSave');
  var hint = document.getElementById('tgtHint');
  var role = (document.getElementById('tgtRole').value||'').trim().slice(0,120);
  if(!role){ hint.textContent = 'Add a role first.'; return; }
  // Field says $k, but people type full dollars too. Anything 10,000+ is dollars.
  var k = function(id){ var v = parseFloat(String(document.getElementById(id).value).replace(/[$,\s]/g,'')); if(isNaN(v) || v<=0) return null; return v >= 10000 ? Math.round(v) : Math.round(v*1000); };
  var locs = (document.getElementById('tgtLoc').value||'').split(',').map(function(x){return x.trim().slice(0,60);}).filter(Boolean).slice(0,6);
  var row = {
    user_id: session.user.id,
    target_role_title: role,
    target_level: document.getElementById('tgtLevel').value || null,
    target_work_type: document.getElementById('tgtWork').value || null,
    target_comp_min: k('tgtCompMin'),
    target_comp_max: k('tgtCompMax'),
    target_locations: locs,
    target_timeline: document.getElementById('tgtTimeline').value || null,
    target_source: 'stated',
    target_set_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  var wv = function(id){ var el = document.getElementById(id); return el ? el.value.trim().slice(0,240) : ''; };
  var wants = { pull: wv('wantPull'), cold: wv('wantCold'), musts: wv('wantMusts'), optimizing: wv('wantFor') };
  if(wants.pull || wants.cold || wants.musts || wants.optimizing || (BRAIN_PROFILE && BRAIN_PROFILE.wants)){ row.wants = wants; row.wants_updated_at = new Date().toISOString(); }
  btn.disabled = true; hint.textContent = 'Saving...';
  var res = await window.supabaseClient.from('career_profile').upsert(row, {onConflict:'user_id'});
  btn.disabled = false;
  if(res.error){ hint.textContent = 'Could not save. Try again.'; return; }
  BRAIN_PROFILE = Object.assign({}, BRAIN_PROFILE||{}, row);
  hint.textContent = 'Saved. Confirmed by you.';
  if(ONB && DASH_ON){ onbFinish({}); return; }
  if(DASH_ON) loadDashboard();
}

// Landing role picker -> a working target, but only when the profile has
// none. A target the user typed or that the "no idea" conversation produced
// is never replaced by a pill click.
async function defaultTargetFromRole(role){
  try{
    if(!role || !window.supabaseClient) return;
    var sessionRes = await window.supabaseClient.auth.getSession();
    var session = sessionRes.data && sessionRes.data.session;
    if(!session) return;
    var uid = session.user.id;
    var existing = await window.supabaseClient.from('career_profile').select('target_role_title,target_source').eq('user_id', uid).maybeSingle();
    var cur = existing.data;
    if(cur && cur.target_role_title && cur.target_source !== 'prep_role') return;
    await window.supabaseClient.from('career_profile').upsert({
      user_id: uid,
      target_role_title: role,
      target_source: 'prep_role',
      target_set_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, {onConflict:'user_id'});
  }catch(e){ console.error('defaultTargetFromRole', e); }
}

// Plain-language labels for the evidence status. The status values stay
// as-is in the data (fact / inference / hypothesis); only the badge changes.
function claimStatusLabel(c){
  var src = c.evidence && c.evidence[0] && c.evidence[0].source;
  if(src === 'user') return 'Added by you';
  if(c.status === 'fact') return 'From your resume';
  if(c.status === 'inference') return 'Ezzy\u2019s read';
  if(c.status === 'hypothesis') return 'Ezzy\u2019s guess';
  return 'Unknown';
}

// Gap analysis: how a resume matches a target job, using Career Brain evidence.
// Signed-in only - anonymous resume review is unaffected either way.
async function runGapAnalysis(resumeText, jdText){
  var token = await getAuthTokenIfSignedIn();
  if(!token) return;
  try{
    var res = await fetch(GAP_ANALYSIS_URL, {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
      body: JSON.stringify({resumeText: resumeText||'', jdText: jdText||''})
    });
    if(!res.ok) return;
    var data = await res.json();
    if(data.gaps && data.gaps.length) appendGapAnalysis(data.gaps);
  }catch(e){ console.error('Gap analysis error:', e); }
}

function gapBoxHtml(gaps){
  var icon = {matched:'\u2713', partial:'~', missing:'\u2715'};
  var html = '<div class="gap-title">How you match this role</div>';
  gaps.forEach(function(g){
    html += '<div class="gap-row gap-'+(g.status||'missing')+'">'
      + '<span class="gap-icon">'+(icon[g.status]||'?')+'</span>'
      + '<div><div class="gap-req">'+escapeHtml(g.requirement)+'</div>'
      + '<div class="gap-note">'+escapeHtml(g.note||'')+'</div></div>'
      + '</div>';
  });
  return html;
}
function appendGapAnalysis(gaps){
  var box = document.createElement('div');
  box.className = 'gap-box';
  box.innerHTML = gapBoxHtml(gaps);
  msgEl.appendChild(box);
  scrollMain();
}
// The match box is not a chat message, so a restored review would lose it.
// It was saved to resume_gap_analyses at the time, keyed by the posting.
async function fetchGapsForJd(uid, jdText){
  if(!uid || !jdText || !window.supabaseClient) return [];
  try{
    var r = await window.supabaseClient.from('resume_gap_analyses').select('gaps').eq('user_id', uid).eq('jd_text', jdText).order('created_at', {ascending:false}).limit(1);
    var g = r.data && r.data[0] && r.data[0].gaps;
    return Array.isArray(g) ? g : [];
  }catch(e){ console.error('gap restore', e); return []; }
}

// Pricing / checkout
function openPricingModal(){
  var dropdown = document.getElementById('authUserDropdown');
  if(dropdown) dropdown.classList.remove('active');
  document.getElementById('pricingError').textContent = '';
  document.getElementById('pricingOverlay').classList.add('active');
}

function closePricingModal(){
  document.getElementById('pricingOverlay').classList.remove('active');
}

async function startCheckout(plan){
  var errEl = document.getElementById('pricingError');
  errEl.textContent = '';
  var token = await getAuthTokenIfSignedIn();
  if(!token){
    closePricingModal();
    showAuthModal('signup');
    return;
  }
  try{
    var res = await fetch('/api/create-checkout-session', {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
      body: JSON.stringify({plan: plan})
    });
    var data = await res.json();
    if(!res.ok || !data.url){
      errEl.textContent = 'Could not start checkout. Try again in a moment.';
      return;
    }
    window.location.href = data.url;
  }catch(e){
    errEl.textContent = 'Could not start checkout. Try again in a moment.';
  }
}

function showSimpleToast(message){
  var el = document.createElement('div');
  el.className = 'learned-toast';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(function(){
    el.classList.add('out');
    setTimeout(function(){ el.remove(); }, 300);
  }, 5000);
}

(function(){
  var params = new URLSearchParams(window.location.search);
  var checkoutResult = params.get('checkout');
  if(checkoutResult==='success'){
    // Older success links have no plan; Career is what the modal mostly sells.
    PENDING_CHECKOUT = { plan: params.get('plan') || 'career' };
    showSimpleToast('Payment received. Setting up your account...');
  } else if(checkoutResult==='cancel'){
    showSimpleToast('Checkout canceled - you were not charged.');
  }
  if(checkoutResult){
    var url = new URL(window.location.href);
    url.searchParams.delete('checkout');
    url.searchParams.delete('plan');
    window.history.replaceState({}, '', url.toString());
  }
})();
