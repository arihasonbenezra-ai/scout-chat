
var PROXY_URL='/api/chat';
var EXTRACT_URL='/api/extract';
var GAP_ANALYSIS_URL='/api/gap-analysis';
var ROLE=null;
var RESEARCH_STAGE='idle';
var RESEARCH_COMPANY='';
var PENDING_JD=null; // posting text handed over by an opportunity's "Review my resume against it"
var MODE=null;
var TRAINER_MODE=null;
var RESUME_STAGE=null;
var RESUME_TEXT='';
var JD_TEXT='';
var convoHistory=[];

function syncWindowState(){
  window.ROLE = ROLE;
  window.MODE = MODE;
  window.TRAINER_MODE = TRAINER_MODE;
  window.convoHistory = convoHistory;
  window.RESUME_TEXT = RESUME_TEXT;
  window.JD_TEXT = JD_TEXT;
  window.RESUME_STAGE = RESUME_STAGE;
}

var pendingModeSwitch=null;

var msgEl=document.getElementById('messages');
var inputEl=document.getElementById('input');
var sendBtn=document.getElementById('sendBtn');
var isSending=false;
function updateSendBtnState(){ sendBtn.disabled = isSending || !inputEl.value.trim(); }
inputEl.addEventListener('input', updateSendBtnState);

// --- Voice input (Practice only) -------------------------------------------
// Browser speech recognition, no audio leaves the device. Fillers (um, uh,
// you know) are stripped from the text so the answer reads cleanly, and the
// count of what was stripped goes to the server with the answer so the
// feedback can cite a real number. Run-on sentences are left alone: the
// candidate can edit before sending.
var SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition || null;
var micBtn = document.getElementById('micBtn');
var VOICE = { rec: null, listening: false, base: '', finals: [], restarts: 0 };
var VOICE_META = null; // {fillers, words} for the answer in the textarea, if spoken
var FILLER_RE = /\b(?:u+m+|u+h+|e+r+m*|a+h+|h+m+|m+h*m+|you know|like like)\b[,.]?\s*/gi;
function stripFillers(raw){
  var count = 0;
  var out = String(raw).replace(FILLER_RE, function(){ count++; return ''; });
  return { text: out.replace(/\s+/g,' ').trim(), count: count };
}
function shapeChunk(text){
  if(!text) return '';
  var t = text.charAt(0).toUpperCase() + text.slice(1);
  if(!/[.!?]$/.test(t)) t += '.';
  return t;
}
function voiceSupported(){ return !!SpeechRec && (location.protocol === 'https:' || location.hostname === 'localhost'); }
// Interviewer-voice state, declared before anything at load reads it.
var SPEAK = { on: (function(){ try{ return localStorage.getItem('ezzyMockVoice') === '1'; }catch(e){ return false; } })(), spoken: 0, queue: [], playing: false, audio: null, gen: 0, warned: false };
function syncMicBtn(){
  syncSpeakBtn();
  if(!micBtn) return;
  var show = voiceSupported() && MODE === 'trainer';
  micBtn.classList.toggle('on', show);
  micBtn.disabled = inputEl.disabled;
  if(!show && VOICE.listening) voiceStop();
}
function voiceRender(interim){
  var finalsText = VOICE.finals.map(function(f){ return f.text; }).filter(Boolean).join(' ');
  var v = VOICE.base ? VOICE.base + (finalsText ? ' ' + finalsText : '') : finalsText;
  if(interim) v += (v ? ' ' : '') + interim;
  inputEl.value = v;
  updateSendBtnState();
  var words = 0, fillers = 0;
  VOICE.finals.forEach(function(f){ words += f.words; fillers += f.count; });
  VOICE_META = { fillers: fillers, words: words };
}
function voiceStart(){
  if(!voiceSupported() || VOICE.listening) return;
  var rec = new SpeechRec();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = navigator.language || 'en-US';
  VOICE.rec = rec; VOICE.listening = true; VOICE.restarts = 0;
  VOICE.base = inputEl.value.trim(); VOICE.finals = [];
  micBtn.classList.add('listening'); micBtn.setAttribute('aria-pressed','true'); micBtn.title = 'Stop listening';
  inputEl.placeholder = 'Listening... tap the mic again when you\'re done.';
  rec.onresult = function(e){
    var interim = '';
    for(var i = e.resultIndex; i < e.results.length; i++){
      var raw = e.results[i][0].transcript.trim();
      if(!raw) continue;
      if(e.results[i].isFinal){
        var sf = stripFillers(raw);
        VOICE.finals.push({ text: shapeChunk(sf.text), count: sf.count, words: raw.split(/\s+/).length });
      } else interim += (interim ? ' ' : '') + raw;
    }
    voiceRender(interim);
  };
  rec.onerror = function(e){
    if(e.error === 'not-allowed' || e.error === 'service-not-allowed'){
      voiceStop();
      addMsg('bot','I can\'t reach your microphone. Allow it for this site in your browser and try the mic again, or just type.');
    } else if(e.error === 'no-speech'){ /* onend restarts */ }
    else if(e.error !== 'aborted'){ console.warn('speech error', e.error); }
  };
  rec.onend = function(){
    // Chrome ends a continuous session on its own after a pause or ~60s;
    // keep going until the candidate taps stop.
    if(VOICE.listening && VOICE.rec === rec && VOICE.restarts < 20){
      VOICE.restarts++;
      try{ rec.start(); return; }catch(err){}
    }
    if(VOICE.rec === rec) voiceStop();
  };
  try{ rec.start(); }catch(err){ voiceStop(); }
}
function voiceStop(){
  var rec = VOICE.rec;
  VOICE.listening = false; VOICE.rec = null;
  if(rec){ rec.onend = null; try{ rec.stop(); }catch(err){} }
  if(micBtn){ micBtn.classList.remove('listening'); micBtn.setAttribute('aria-pressed','false'); micBtn.title = 'Speak your answer'; }
  if(MODE === 'trainer') inputEl.placeholder = 'Type your answer...';
  voiceRender('');
  if(inputEl.value.trim()) inputEl.focus();
}
function voiceToggle(){ if(VOICE.listening) voiceStop(); else voiceStart(); }
// Clearing the box by hand drops the spoken stats with it.
inputEl.addEventListener('input', function(){ if(!inputEl.value.trim() && !VOICE.listening) VOICE_META = null; });
// The input is enabled/disabled and re-labelled at every mode change; the
// mic follows it rather than being wired into each of those places.
if(window.MutationObserver) new MutationObserver(syncMicBtn).observe(inputEl, { attributes: true, attributeFilter: ['disabled','placeholder'] });
var emptyState=document.getElementById('emptyState');
var modePill=document.getElementById('modePill');
var modePopover=document.getElementById('modePopover');
var modePillLabel=document.getElementById('modePillLabel');
var roleLabel=document.getElementById('roleLabel');
var dotSep=document.getElementById('dotSep');
var rolePills=document.getElementById('rolePills');
var otherRow=document.getElementById('otherRow');
var otherInput=document.getElementById('otherInput');
var modalOverlay=document.getElementById('modalOverlay');
var mainEl=document.getElementById('main');

var AVATAR_HTML='<svg viewBox="0 0 32 32" width="22" height="22" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="16" r="14" fill="#FCEAE6"/><text x="16" y="22" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="16" font-weight="700" fill="#000">E</text></svg>';

function scrollMain(){mainEl.scrollTop=mainEl.scrollHeight;}

function showOtherInput(){
  Array.from(rolePills.querySelectorAll('.empty-pill')).forEach(function(b){if(b.textContent!=='Other')b.classList.add('fade');});
  otherRow.classList.add('show');
  otherInput.focus();
}

function cancelOtherInput(){
  otherInput.value='';
  otherRow.classList.remove('show');
  Array.from(rolePills.querySelectorAll('.empty-pill')).forEach(function(b){b.classList.remove('fade');});
}

function confirmOtherRole(){
  var v=otherInput.value.trim();
  if(!v)return;
  pickRole(v);
}

// Landing flow:
//   "What can I help you with?" -> Resume Review | Interview Prep
//   Resume Review  -> straight to the resume screen. No role step: a pasted
//                     JD already says what the role is, and someone with no
//                     JD just skips it there - asking for a role first was
//                     redundant either way.
//   Interview Prep -> "What role are you prepping for?" -> role pills ->
//                     practice modes + company research.
// A cold visitor learns what Ezzy actually does before being asked for
// anything, and a resume-only visitor is one click from pasting.
var TOP_INTENT=null;
var intentPills=document.getElementById('intentPills');
var emptySub=document.getElementById('emptySub');
var inputArea=document.querySelector('.input-area');

// The chat bar is hidden while the landing screen is up - nothing there is
// typed into, and a visible input box reads like "this is a chatbot, type
// something" instead of "pick one of these".
function setInputAreaVisible(visible){
  if(inputArea) inputArea.style.display = visible ? '' : 'none';
  if(typeof syncMicBtn === 'function') syncMicBtn();
}
setInputAreaVisible(false);

function pickTopIntent(intent){
  if(typeof hideDashboard === 'function') hideDashboard();
  TOP_INTENT=intent;
  if(intent==='resume'){
    startResumeReviewDirect();
    return;
  }
  emptyState.classList.add('quick');
  intentPills.style.display='none';
  emptySub.textContent='What role are you prepping for?';
  rolePills.style.display='';
}

function resetEmptyStateToStage1(){
  TOP_INTENT=null;
  emptyState.classList.add('quick');
  cancelOtherInput();
  emptySub.textContent='What can I help you with?';
  intentPills.style.display='';
  rolePills.style.display='none';
  setInputAreaVisible(false);
}

// Leaves the landing screen for the app proper: header pills, chat bar.
function enterAppShell(role){
  if(typeof hideDashboard === 'function') hideDashboard();
  emptyState.style.display='none';
  setInputAreaVisible(true);
  if(role){
    roleLabel.textContent=role;
    roleLabel.style.display='inline';
    dotSep.style.display='inline';
  } else {
    roleLabel.style.display='none';
    dotSep.style.display='none';
  }
  modePill.style.display='inline-flex';
}

function pickRole(role){
  ROLE=role;
  window.ROLE=role;
  defaultTargetFromRole(role);
  enterAppShell(role);
  inputEl.disabled=true;
  inputEl.placeholder='Pick what you want to do first...';
  showPrepPicker();
}

// Everything interview-prep-related sits together at one step - the three
// practice modes plus Company Research, which is part of prepping for an
// interview rather than a separate top-level thing.
function showPrepPicker(){
  msgEl.innerHTML='';
  convoHistory=[];
  addMsg('bot','Great. What kind of prep?');
  setTimeout(function(){
    var div = document.createElement('div');
    div.className = 'choice-bubbles';
    div.id = 'choiceBubbles';
    div.innerHTML = '<button class="choice-pill" onclick="pickPracticeType(\'practice\',\'Practice Q&amp;A\')">Practice Q&A</button><button class="choice-pill" onclick="pickPracticeType(\'star\',\'STAR Coaching\')">STAR Coaching</button><button class="choice-pill" onclick="pickPracticeType(\'mock\',\'Mock Interview\')">Mock Interview</button><button class="choice-pill" onclick="pickIntent(\'research\')">Company Research</button>';
    msgEl.appendChild(div);
    msgEl.scrollTop = msgEl.scrollHeight;
  }, 400);
}

// Resume Review path - no role at all. The pasted JD carries the role when
// there is one, and a general review doesn't need it.
function startResumeReviewDirect(){
  ROLE=null; window.ROLE=null;
  enterAppShell(null);
  pickIntent('resume');
}

function pickIntent(intent){
  var bubbles = document.getElementById('choiceBubbles');
  if(bubbles) bubbles.remove();
  if(intent==='resume'){
    resumeDropDismissed = false;
    inputEl.disabled=false;
    inputEl.placeholder='Type your answer...';
    startMode('resume','Resume Feedback');
  } else if(intent==='research'){
    inputEl.disabled=false;
    inputEl.placeholder='Type a company name...';
    startMode('research','Company Research');
  }
}

function pickPracticeType(modeId, modeTitle){
  var bubbles = document.getElementById('choiceBubbles');
  if(bubbles) bubbles.remove();
  inputEl.disabled=false;
  inputEl.placeholder='Type your answer...';
  startMode(modeId, modeTitle);
}

async function startMode(modeId,modeTitle){
  if(window._isRestoring) return;
  if(window.resetConversationTracking) window.resetConversationTracking();
  TRAINER_MODE=modeId;
  window.TRAINER_MODE=modeId;
  modePillLabel.textContent=modeTitle;
  setActiveMode(modeId);
  msgEl.innerHTML='';
  convoHistory=[];
  
  // Try to restore saved conversation BEFORE firing kickoff
  var restored = false;
  try {
    restored = await loadConversationForMode(modeId);
    if(restored){
      window.MODE = (modeId === 'resume') ? 'resume' : 'trainer';
    }
  } catch(e){ console.error('Restore error:', e); }
  
  if(restored){ syncMicBtn(); return; }
  
  if(modeId==='resume'){
    MODE='resume';
    RESUME_STAGE='awaiting_resume';
    RESUME_TEXT='';JD_TEXT='';
    addMsg('bot','Paste your resume below. Plain text is fine, formatting will be ignored.');
    return;
  }
  if(modeId==='research'){
    MODE='research';
    window.MODE='research';
    RESEARCH_STAGE='awaiting_company';
    window.RESEARCH_STAGE='awaiting_company';
    RESEARCH_COMPANY='';
    window.RESEARCH_COMPANY='';
    addMsg('bot','What company are you researching? Type the name and I\'ll pull together a brief tailored to your '+ROLE+' interview.');
    return;
  }
  MODE='trainer';
  inputEl.disabled=false;
  inputEl.placeholder='Type your answer...';
  syncMicBtn();
  showTyping();
  streamBotReply([{role:'user',content:'Start the session now.'}],function(reply){
    window._avoidQuestion = '';
    convoHistory.push({role:'assistant',content:reply});
    saveMessage('assistant', reply);
  });
}

function setActiveMode(modeId){
  document.querySelectorAll('.mode-option').forEach(function(o){
    o.classList.toggle('active',o.getAttribute('data-mode')===modeId);
  });
  refreshStartOverRow();
}

function toggleModePopover(){
  var open=modePopover.classList.toggle('show');
  modePill.classList.toggle('open',open);
}

function closeModePopover(){
  modePopover.classList.remove('show');
  modePill.classList.remove('open');
}

document.addEventListener('click',function(e){
  if(!modePill.contains(e.target)&&!modePopover.contains(e.target))closeModePopover();
});

function requestModeSwitch(modeId,modeTitle){
  closeModePopover();
  if(modeId==='decide') window._decideOpportunityId = null; // from the menu: no posting, just the person
  if(modeId==='practice' || modeId==='star' || modeId==='mock'){ window._practiceFocus = null; window._practiceOpportunityId = null; }

  if(modeId===TRAINER_MODE)return;
  if(convoHistory.length===0){
    startMode(modeId,modeTitle);
    return;
  }
  pendingModeSwitch={id:modeId,title:modeTitle};
  document.getElementById('modalTitle').textContent='Switch to '+modeTitle+'?';
  document.getElementById('modalDesc').textContent='This will start a new conversation. Your current one is saved and picks up where you left off when you come back.';
  document.getElementById('modalConfirmBtn').textContent='Switch mode';
  modalOverlay.classList.add('show');
}

function cancelModeSwitch(){
  pendingModeSwitch=null;
  pendingStartOver=false;
  modalOverlay.classList.remove('show');
}

function confirmModeSwitch(){
  if(pendingStartOver){
    pendingStartOver=false;
    modalOverlay.classList.remove('show');
    startNewPrepSession();
    return;
  }
  if(!pendingModeSwitch)return;
  var p=pendingModeSwitch;
  pendingModeSwitch=null;
  modalOverlay.classList.remove('show');
  startMode(p.id,p.title);
}

// At the "paste the job description" step, people often type a role or a
// company instead ("Senior Technical Recruiter @ Figma"). That is a target,
// not a posting - treating it as a posting made the review and the gap
// checklist grade the resume against requirements the model invented.
var TARGET_HINT = null;
function looksLikeJobDescription(text){
  var t = (text || '').trim();
  if(t.length >= 400) return true;
  var lines = t.split(/\n/).filter(function(l){ return l.trim(); }).length;
  return lines >= 4;
}
function parseTargetHint(text){
  var t = (text || '').trim().replace(/\s+/g,' ');
  var m = t.match(/^(.+?)\s*(?:@|\bat\b|\bfor\b|-|\u2013|\u2014)\s*(.+)$/i);
  if(m && m[1].length >= 3 && m[2].length >= 2) return {role: m[1].trim(), company: m[2].trim()};
  return {role: t, company: null};
}
function buildResumeFirstMessage(resumeText, jdText, targetHint){
  var head = 'Here is the candidate\'s resume:\n\n' + resumeText + '\n\n---\n\n';
  if(jdText) return head + 'Here is the target job description:\n\n' + jdText + '\n\nGive your feedback now using the format specified.';
  if(targetHint) return head + 'The candidate did NOT paste a job posting. They said they are targeting: "' + targetHint + '". Review the resume for that kind of role. You have not seen the actual posting, so do not claim the resume matches or misses requirements of a posting; when you rely on what such roles typically ask for, say so explicitly ("roles like this typically look for..."). Give your feedback now using the format specified.';
  return head + 'The candidate does not have a specific job posting to target - give a general resume review using the format specified.';
}

// A long paste (resume, job description) is a document, not a chat line.
// Show it as a collapsed card with a word count and an expand toggle rather
// than echoing the whole thing back as one wall of text.
// A resume or posting pasted in Resume Review, or anything document-sized
// anywhere. A long typed interview answer is a message, not a document.
var DOC_BUBBLE_MIN_CHARS = 600;
var DOC_BUBBLE_ALWAYS_CHARS = 2500;
function looksLikeDocument(text){
  var mode = window.MODE || (typeof MODE !== 'undefined' ? MODE : null);
  if(text.length >= DOC_BUBBLE_ALWAYS_CHARS) return true;
  return mode === 'resume' && text.length >= DOC_BUBBLE_MIN_CHARS;
}
function fillUserBubble(node, text){
  text = text == null ? '' : String(text);
  if(!looksLikeDocument(text)){
    node.textContent = text;
    return;
  }
  node.classList.add('msg-doc');
  var words = text.trim().split(/\s+/).filter(Boolean).length;
  var head = document.createElement('div');
  head.className = 'msg-doc-head';
  head.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
  head.appendChild(document.createTextNode('Pasted document \u00b7 ' + words.toLocaleString() + ' words'));
  var body = document.createElement('div');
  body.className = 'msg-doc-body';
  body.textContent = text;
  var toggle = document.createElement('button');
  toggle.className = 'msg-doc-toggle';
  toggle.type = 'button';
  toggle.textContent = 'Show all';
  toggle.onclick = function(){
    var open = node.classList.toggle('open');
    toggle.textContent = open ? 'Show less' : 'Show all';
  };
  node.appendChild(head);
  node.appendChild(body);
  node.appendChild(toggle);
}

function addMsg(role,text){
  var node;
  if(role==='user'){
    node=document.createElement('div');
    node.className='msg msg-user';
    fillUserBubble(node,text);
  } else {
    node=document.createElement('div');
    node.className='msg-bot-row';
    var av=document.createElement('div');
    av.className='msg-bot-avatar';
    av.textContent='E';
    var bub=document.createElement('div');
    bub.className='msg-bot';
    if(text){try{bub.innerHTML=marked.parse(text);}catch(e){bub.textContent=text;} externalizeLinks(bub);}
    node.appendChild(av);
    node.appendChild(bub);
  }
  msgEl.appendChild(node);
  scrollMain();
  return node;
}

function externalizeLinks(el){
  if(!el) return;
  Array.prototype.forEach.call(el.querySelectorAll('a[href]'), function(a){
    a.target='_blank'; a.rel='noopener noreferrer';
  });
}

function setBubbleText(node,text){
  var bub=node.querySelector('.msg-bot');
  if(bub){
    try{bub.innerHTML=marked.parse(text);}catch(e){bub.textContent=text;}
    externalizeLinks(bub);
  } else {
    node.textContent=text;
  }
  scrollMain();
}

var TYPING_INTERVAL=null;
function showTyping(label){
  var t=document.createElement('div');
  t.className='typing';t.id='typing';
  var dots='<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>';
  if(Array.isArray(label)){
    var idx=0;
    t.innerHTML='<span class="typing-label" id="typingLabel">'+label[0]+'</span>'+dots;
    msgEl.appendChild(t);scrollMain();
    if(TYPING_INTERVAL)clearInterval(TYPING_INTERVAL);
    TYPING_INTERVAL=setInterval(function(){
      if(idx < label.length-1){
        idx++;
        var el=document.getElementById('typingLabel');
        if(el)el.textContent=label[idx];
        else { clearInterval(TYPING_INTERVAL); TYPING_INTERVAL=null; }
      } else {
        clearInterval(TYPING_INTERVAL); TYPING_INTERVAL=null;
      }
    },5000);
  } else if(label){
    t.innerHTML='<span class="typing-label">'+label+'</span>'+dots;
    msgEl.appendChild(t);scrollMain();
  } else {
    t.innerHTML=dots;
    msgEl.appendChild(t);scrollMain();
  }
}

function hideTyping(){var t=document.getElementById('typing');if(t)t.remove();if(TYPING_INTERVAL){clearInterval(TYPING_INTERVAL);TYPING_INTERVAL=null;}}

// Prompt/model selection now lives server-side in api/chat.js — the client only
// sends {mode, role, company, messages}. See EZZY_AI_ARCHITECTURE.md.
function currentModeKey(){
  if(MODE==='resume') return 'resume';
  if(MODE==='research') return 'research';
  return TRAINER_MODE;
}

function handleSend(){handleSendText(inputEl.value);}

// Mirrors companyNameProblem in api/chat.js (the server refuses too).
var COMPANY_ASK='I need a company name to build the brief. Which company are you interviewing with? Just the name, like "Stripe" or "Mayo Clinic".';
var GREETING_RE=/^(hi+|hello+|hey+|heya|yo|sup|hola|howdy|thanks|thank you|ok|okay|test|testing)([\s,!.]+(there|ezzy|everyone|all|you))*[\s!.,]*$/i;
function companyNameProblem(name){
  var s=String(name||'').trim();
  if(!s||!/[a-z0-9]/i.test(s)) return 'empty';
  if(GREETING_RE.test(s)) return 'greeting';
  if(/\?\s*$/.test(s)) return 'question';
  if(s.split(/\s+/).length>6) return 'too long';
  return null;
}
function researchAskAgain(){
  RESEARCH_STAGE='awaiting_company'; window.RESEARCH_STAGE='awaiting_company';
  RESEARCH_COMPANY=''; window.RESEARCH_COMPANY='';
  hideTyping();
  addMsg('bot',COMPANY_ASK);
}

function handleSendText(text){
  speakStop();
  text=text.trim();if(!text)return;
  if(VOICE.listening) voiceStop();
  var spoken = (MODE==='trainer' && VOICE_META && VOICE_META.words > 0) ? VOICE_META : null;
  VOICE_META = null;
  inputEl.value='';
  updateSendBtnState();

  if(MODE==='research'){
    addMsg('user',text);
    if(RESEARCH_STAGE==='awaiting_company'){
      if(companyNameProblem(text)){ addMsg('bot',COMPANY_ASK); return; }
      RESEARCH_COMPANY=text;
      window.RESEARCH_COMPANY=text;
      RESEARCH_STAGE='generating_brief';
      window.RESEARCH_STAGE=RESEARCH_STAGE;
      saveMessage('user', text);
      showTyping(['Ezzy is researching '+text+'...','Pulling together your brief...','Almost done...']);
      var researchPrompt='I\'m interviewing for a '+ROLE+' role at '+text+'. Generate a research brief tailored to that interview, using web search to pull current information.';
      convoHistory=[{role:'user',content:researchPrompt}];
      callClaudeWithSearch(convoHistory,function(reply, ok){
        hideTyping();
        if(!ok){
          // No brief landed: stay on the company question instead of
          // pretending there is a brief to follow up on.
          addMsg('bot',reply);
          convoHistory=[];
          researchAskAgain();
          return;
        }
        addMsg('bot',reply);
        convoHistory.push({role:'assistant',content:reply});
        RESEARCH_STAGE='conversational';
        window.RESEARCH_STAGE=RESEARCH_STAGE;
        saveMessage('assistant', reply);
      });
    } else {
      convoHistory.push({role:'user',content:text});
      saveMessage('user', text);
      showTyping(['Ezzy is researching '+RESEARCH_COMPANY+'...','Searching the web...','Almost done...']);
      callClaudeWithSearch(convoHistory,function(reply, ok){
        hideTyping();
        addMsg('bot',reply);
        if(!ok){ convoHistory.pop(); return; } // the question never got an answer; drop it from the history sent next time
        convoHistory.push({role:'assistant',content:reply});
        saveMessage('assistant', reply);
      });
    }
    return;
  }
  if(MODE==='resume'){
    addMsg('user',text);
    if(RESUME_STAGE==='awaiting_resume'){
      RESUME_TEXT=text;
      RESUME_STAGE='awaiting_jd';
      // Came here from an opportunity: the posting is already in hand.
      if(PENDING_JD){
        var pj = PENDING_JD; PENDING_JD = null;
        setTimeout(function(){ handleSendText(pj); }, 200);
        return;
      }
      setTimeout(function(){
        addMsg('bot','Got it. Now paste the job description you\'re targeting.');
        appendSkipJDButton();
      },200);
    } else if(RESUME_STAGE==='awaiting_jd'){
      removeSkipJDButton();
      var isJD = looksLikeJobDescription(text);
      JD_TEXT = isJD ? text : null;
      TARGET_HINT = isJD ? null : text.trim();
      window.JD_TEXT = JD_TEXT; window.TARGET_HINT = TARGET_HINT;
      RESUME_STAGE='feedback_given';
      if(TARGET_HINT){
        var parsed = parseTargetHint(TARGET_HINT);
        defaultTargetFromRole(parsed.role);
        addMsg('bot','Got it - I\'ll review for ' + (parsed.company ? parsed.role + ' roles at ' + parsed.company : parsed.role + ' roles') + '. I haven\'t seen the actual posting, so this is based on what those roles usually ask for. Paste the real posting any time and I\'ll check you against its exact requirements.');
      }
      convoHistory=[{role:'user',content:buildResumeFirstMessage(RESUME_TEXT, JD_TEXT, TARGET_HINT)}];
      isSending=true;updateSendBtnState();
      showTyping();
      streamBotReply(convoHistory.slice(),function(reply){
        if(!reply) return; // blocked (rate limit) or errored - the chat already shows why, nothing to download or learn from
        convoHistory.push({role:'assistant',content:reply});
      saveMessage('assistant', reply);
        appendDownloadButton();
        extractCareerClaims(RESUME_TEXT, JD_TEXT);
        // The requirement-by-requirement match only makes sense against a
        // real posting; against a typed target it would be invented.
        if(JD_TEXT) runGapAnalysis(RESUME_TEXT, JD_TEXT);
      });
    } else {
      convoHistory.push({role:'user',content:text});
      saveMessage('user', text);
      isSending=true;updateSendBtnState();showTyping();
      streamBotReply(convoHistory.slice(),function(reply){
        if(!reply) return;
        convoHistory.push({role:'assistant',content:reply});
      saveMessage('assistant', reply);
        // Buttons are re-shown after every reply here, not just the first -
        // someone can keep typing (a new resume, a follow-up question)
        // without ever clicking "Start a new review", so it needs to stay
        // available rather than only appearing once.
        appendDownloadButton();
      });
    }
  } else if(MODE==='trainer'){
    addMsg('user',text);
    convoHistory.push({role:'user',content:text});
      saveMessage('user', text);
    window._pendingVoice = spoken; // read once by callClaudeStream
    isSending=true;updateSendBtnState();showTyping();
    streamBotReply(convoHistory.slice(),function(reply){
      convoHistory.push({role:'assistant',content:reply});
      var saved = saveMessage('assistant', reply);
      recordReadinessScore(reply);
      refreshStartOverRow();
      if(isPrepSetComplete(reply)){
        Promise.resolve(saved).then(archiveCompletedPrepSession);
      }
    });
  }
}

async function getAuthTokenIfSignedIn(){
  if(!window.supabaseClient) return null;
  try{
    var sessionRes = await window.supabaseClient.auth.getSession();
    var session = sessionRes.data && sessionRes.data.session;
    return session ? session.access_token : null;
  }catch(e){ return null; }
}

function showAnonLimitMessage(){
  hideTyping();
  addMsg('bot','You\'ve used your free messages for today. Sign in (it\'s free) to keep going.');
  showAuthModal('signup');
}

function showAnonGlobalLimitMessage(){
  hideTyping();
  addMsg('bot','Ezzy is experiencing high demand right now. Please sign in to continue, or try again later.');
  showAuthModal('signup');
}

// Practice Q&A and Resume Review both require a free account before Ezzy
// actually generates anything - this fires the first time an anonymous
// visitor tries either one, before any AI call happens server-side.
function showSignupRequiredMessage(){
  hideTyping();
  addMsg('bot','Create a free account to see your results - it only takes a few seconds, and you\'re not paying anything yet.');
  stashRetryForAuth();
  showAuthModal('signup');
  var sub = document.getElementById('authModalSub');
  if(sub) sub.textContent = 'Sign up to see your results';
}

// Persists enough to resume exactly where they left off after signing in.
// Needed specifically for Google sign-in, which does a full page reload
// (redirect to Google and back) that wipes all in-memory state including
// pendingGatedRetry below - email/password signup doesn't reload the page,
// so it resolves faster via that in-memory path instead, but this covers
// both the same way.
function stashRetryForAuth(){
  try {
    localStorage.setItem('ezzy_pending_retry', JSON.stringify({
      mode: window.MODE === 'resume' ? 'resume' : 'practice',
      role: window.ROLE || null,
      resumeText: window.RESUME_TEXT || null,
      jdText: window.JD_TEXT || null,
      targetHint: window.TARGET_HINT || null,
      ts: Date.now()
    }));
  } catch(e){}
}

function resumeGatedRetryIfAny(){
  var raw;
  try { raw = localStorage.getItem('ezzy_pending_retry'); } catch(e){ return; }
  if(!raw) return;
  try { localStorage.removeItem('ezzy_pending_retry'); } catch(e){}
  var stash;
  try { stash = JSON.parse(raw); } catch(e){ return; }
  if(!stash || (Date.now() - stash.ts) > 30*60*1000) return; // stale, ignore

  ROLE = stash.role; window.ROLE = stash.role;
  // Fresh page load lands on the "What can I help you with?" screen - leave
  // it the same way a click would, otherwise it sits on top of the restored chat.
  enterAppShell(ROLE);
  inputEl.disabled=false;
  inputEl.placeholder='Type your answer...';

  if(stash.mode === 'resume' && stash.resumeText){
    MODE='resume'; window.MODE='resume';
    RESUME_TEXT = stash.resumeText; window.RESUME_TEXT = RESUME_TEXT;
    JD_TEXT = stash.jdText || null; window.JD_TEXT = JD_TEXT;
    TARGET_HINT = stash.targetHint || null; window.TARGET_HINT = TARGET_HINT;
    RESUME_STAGE = 'feedback_given'; window.RESUME_STAGE = RESUME_STAGE;
    window.resumeDropDismissed = true;

    msgEl.innerHTML='';
    setActiveMode('resume');
    if(modePillLabel) modePillLabel.textContent = 'Resume Feedback';
    addMsg('bot','Paste your resume below. Plain text is fine, formatting will be ignored.');
    addMsg('user', RESUME_TEXT);
    if(JD_TEXT || TARGET_HINT){
      addMsg('bot','Got it. Now paste the job description you\'re targeting.');
      addMsg('user', JD_TEXT || TARGET_HINT);
    } else {
      addMsg('user',"I don't have a specific job in mind");
    }

    convoHistory=[{role:'user',content:buildResumeFirstMessage(RESUME_TEXT, JD_TEXT, TARGET_HINT)}];
    isSending=true;updateSendBtnState();showTyping();
    streamBotReply(convoHistory.slice(),function(reply){
      if(!reply) return;
      convoHistory.push({role:'assistant',content:reply});
      saveMessage('assistant', reply);
      appendDownloadButton();
      extractCareerClaims(RESUME_TEXT, JD_TEXT);
      if(JD_TEXT) runGapAnalysis(RESUME_TEXT, JD_TEXT);
    });
  } else if(stash.mode === 'practice'){
    startMode('practice','Practice Q&A');
  }
}

var FREE_MODE_LABEL = {star:'STAR Coaching', mock:'Mock Interview', decide:'Talk through an opportunity' };

function showUpgradeGateMessage(errorCode, detail){
  hideTyping();
  if(errorCode === 'prep_mode_requires_job_search'){
    var modeLabel = FREE_MODE_LABEL[detail && detail.mode] || 'This mode';
    addMsg('bot',modeLabel+' is part of the Career plan. It unlocks in-depth interview prep, full resume reviews against the job you want, roles matched to you, and a recruiter to talk any opportunity through with.');
  } else if(errorCode === 'free_prep_limit_reached'){
    addMsg('bot','You\'ve used your free practice session. Sign up for in-depth, unlimited interview prep - Practice, STAR, and Mock Interview - plus a full resume review with gap analysis against the job you want.');
  } else if(errorCode === 'free_resume_limit_reached'){
    addMsg('bot','You\'ve used your free resume review. Sign up for an in-depth breakdown and gap analysis against the job you want - specific rewrites grounded in your resume, not just general pointers.');
  } else if(errorCode === 'research_requires_job_search'){
    addMsg('bot','Company Research is part of the Career plan. Upgrade to unlock it.');
  } else {
    addMsg('bot','Upgrade to unlock this.');
  }
  openPricingModal();
}

async function callClaudeWithSearch(messages,cb){
  try{
    var headers={'Content-Type':'application/json'};
    var token=await getAuthTokenIfSignedIn();
    if(token) headers['Authorization']='Bearer '+token;
    var res=await fetch(PROXY_URL,{method:'POST',headers:headers,body:JSON.stringify({
      mode:'research',
      role:ROLE,
      company:window.RESEARCH_COMPANY||RESEARCH_COMPANY,
      messages:messages
    })});
    if(res.status===400){
      var badBody=await res.json().catch(function(){return {};});
      if(badBody.error==='company_required'){ researchAskAgain(); return; }
    }
    if(res.status===403){
      var gateBody=await res.json().catch(function(){return {};});
      hideTyping();
      if(RESEARCH_STAGE==='generating_brief'){ RESEARCH_STAGE='awaiting_company'; window.RESEARCH_STAGE='awaiting_company'; }
      showUpgradeGateMessage(gateBody.error, gateBody);
      return;
    }
    if(res.status===429){
      var searchLimitBody=await res.json().catch(function(){return {};});
      hideTyping();
      if(RESEARCH_STAGE==='generating_brief'){ RESEARCH_STAGE='awaiting_company'; window.RESEARCH_STAGE='awaiting_company'; }
      if(searchLimitBody.error==='anon_global_limit_reached') showAnonGlobalLimitMessage();
      else showAnonLimitMessage();
      return;
    }
    if(!res.ok){cb('Sorry, I could not generate a brief. Please try again.', false);return;}
    var data=await res.json();
    if(!data.content){cb('Sorry, I could not generate a brief. Please try again.', false);return;}
    var textBlocks=data.content.filter(function(b){return b.type==='text';});
    var text=textBlocks.map(function(b){return b.text;}).join('\n\n');
    if(!text){cb('Sorry, I could not generate a brief. Please try again.', false);return;}
    cb(text, true);
  }catch(e){cb('Sorry, something went wrong. Please try again.', false);}
}

// Set when a call gets stopped by the signup-required gate, so signing up
// can automatically pick up exactly where the user left off instead of
// requiring them to resend their resume/answer a second time.
var pendingGatedRetry=null;

// Interviewer voice for Mock: Google's HD voice through the chat function,
// one sentence at a time as the reply streams in, so nothing waits for the
// whole answer. Off by default, remembered per browser.
function speakEnabled(){ return SPEAK.on && currentModeKey() === 'mock'; }
function syncSpeakBtn(){
  var b = document.getElementById('speakBtn'); if(!b) return;
  var show = MODE === 'trainer' && TRAINER_MODE === 'mock';
  b.classList.toggle('on', show); b.classList.toggle('active', SPEAK.on);
  b.textContent = SPEAK.on ? 'Voice on' : 'Voice off'; b.setAttribute('aria-pressed', SPEAK.on ? 'true' : 'false');
}
function speakToggle(){ SPEAK.on = !SPEAK.on; try{ localStorage.setItem('ezzyMockVoice', SPEAK.on ? '1' : '0'); }catch(e){} if(!SPEAK.on) speakStop(); syncSpeakBtn(); }
function speakStop(){ SPEAK.gen++; SPEAK.queue = []; SPEAK.playing = false; if(SPEAK.audio){ try{ SPEAK.audio.pause(); }catch(e){} SPEAK.audio = null; } }
function speakFeed(full){
  if(!speakEnabled()) return;
  for(;;){
    var rest = full.slice(SPEAK.spoken);
    var m = rest.match(/^[\s\S]*?[.!?](?=["\u201d']?\s)/);
    if(!m) return;
    SPEAK.spoken += m[0].length;
    var sent = m[0].trim(); if(sent.length > 1) speakEnqueue(sent);
  }
}
function speakFlush(full){ if(!speakEnabled()) return; var rest = full.slice(SPEAK.spoken).trim(); SPEAK.spoken = full.length; if(rest) speakEnqueue(rest); }
function speakEnqueue(text){
  var gen = SPEAK.gen;
  var item = { audio: (async function(){
    try{
      var token = await getAuthTokenIfSignedIn(); if(!token) return null;
      var res = await fetch(PROXY_URL, { method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer ' + token }, body: JSON.stringify({ action:'tts', text: text }) });
      if(!res.ok){ if(res.status === 503 && !SPEAK.warned){ SPEAK.warned = true; showSimpleToast('The interviewer voice isn\u2019t set up yet.'); } return null; }
      var data = await res.json(); return data.audio || null;
    }catch(e){ return null; }
  })() };
  if(gen !== SPEAK.gen) return;
  SPEAK.queue.push(item); speakPump();
}
async function speakPump(){
  if(SPEAK.playing || !SPEAK.queue.length) return;
  SPEAK.playing = true;
  var gen = SPEAK.gen, item = SPEAK.queue.shift();
  var b64 = await item.audio;
  if(gen !== SPEAK.gen) return;
  if(!b64){ SPEAK.playing = false; speakPump(); return; }
  var a = new Audio('data:audio/mp3;base64,' + b64); SPEAK.audio = a;
  a.onended = a.onerror = function(){ if(gen !== SPEAK.gen) return; SPEAK.playing = false; SPEAK.audio = null; speakPump(); };
  try{ await a.play(); }catch(e){ if(gen !== SPEAK.gen) return; SPEAK.playing = false; speakPump(); }
}

function streamBotReply(messages,afterDone){
  var bubbleNode=null;var fullText='';
  speakStop(); SPEAK.spoken = 0;
  callClaudeStream(messages,function(deltaText,fullSoFar){
    if(!bubbleNode){hideTyping();bubbleNode=addMsg('bot','');}
    fullText=fullSoFar;
    setBubbleText(bubbleNode,fullSoFar);
    speakFeed(fullSoFar);
  },function(gatedBySignup){
    isSending=false;updateSendBtnState();
    hideTyping();
    if(gatedBySignup){
      // No real reply happened - stash the retry and skip afterDone
      // entirely rather than firing it with an empty reply, which would
      // push a bogus empty turn into the conversation history.
      pendingGatedRetry={messages:messages,afterDone:afterDone};
      return;
    }
    // Errored or gated: callClaudeStream already told the user. Never hand
    // an empty reply to afterDone - callers push it into convoHistory, and
    // an empty assistant turn makes every later send fail too.
    if(!fullText) return;
    speakFlush(fullText);
    if(afterDone)afterDone(fullText);
    maybeOfferLearned();
  });
}

// What Ezzy learned about what you want, from your own words in a
// talk-through, offered once and saved only on a tap.
var LEARN_LABEL = { pull:'what pulls you in', cold:'what leaves you cold', musts:'your non-negotiables', optimizing:'what this move is for' };
function maybeOfferLearned(){
  var g = window._lastGuard; window._lastGuard = null;
  if(g && g.story && g.story.title && currentModeKey() === 'star'){
    var sEl = document.createElement('div'); sEl.className = 'learn-card';
    sEl.innerHTML = '<span>Saved to your story bank as \u201c' + escapeHtml(g.story.title) + '\u201d' + (g.story.complete ? '.' : ', without a result yet.') + ' Mock Interview will ask about it.</span>';
    msgEl.appendChild(sEl); msgEl.scrollTop = msgEl.scrollHeight;
  }
  if(!g || !g.learned || !g.learned.words || currentModeKey() !== 'decide') return;
  var L = g.learned;
  // The words are theirs, but the exact phrase from a conversation is not
  // always the one they want on their profile ("ship catheters to people").
  // They get to tidy it before it is saved.
  var el = document.createElement('div'); el.className = 'learn-card';
  el.innerHTML = '<span>Add to ' + escapeHtml(LEARN_LABEL[L.field] || 'what you want') + '?</span>'
    + '<input class="learn-input" type="text" maxlength="80" value="' + escapeHtml(L.words) + '"/>'
    + '<button class="dash-btn" onclick="saveLearned(this,\'' + (LEARN_LABEL[L.field] ? L.field : 'pull') + '\')">Add</button>'
    + '<button class="dash-link" onclick="this.parentNode.remove()">No</button>';
  msgEl.appendChild(el); msgEl.scrollTop = msgEl.scrollHeight;
}
async function saveLearned(btn, field){
  var card = btn.parentNode; var inp = card.querySelector('.learn-input');
  var words = (inp ? inp.value : '').trim().slice(0, 80);
  if(!words){ if(inp) inp.focus(); return; }
  btn.disabled = true;
  try{
    var sr = await window.supabaseClient.auth.getSession(); var uid = sr.data && sr.data.session && sr.data.session.user.id;
    if(!uid) throw new Error('no session');
    var cur = await window.supabaseClient.from('career_profile').select('wants').eq('user_id', uid).maybeSingle();
    var wants = Object.assign({}, (cur.data && cur.data.wants) || {});
    wants[field] = wants[field] ? wants[field] + ', ' + words : words;
    var up = await window.supabaseClient.from('career_profile').upsert({ user_id: uid, wants: wants, wants_updated_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict:'user_id' });
    if(up.error) throw up.error;
    if(DASH_PROFILE) DASH_PROFILE.wants = wants;
    card.innerHTML = '<span>Saved to ' + escapeHtml(LEARN_LABEL[field]) + '. Roles get read against it from now on.</span>';
  }catch(e){ btn.disabled = false; var sp = card.querySelector('span'); if(sp) sp.textContent = 'Could not save that just now.'; }
}

async function callClaudeStream(messages,onChunk,onDone){
  try{
    var headers={'Content-Type':'application/json'};
    var token=await getAuthTokenIfSignedIn();
    if(token) headers['Authorization']='Bearer '+token;
    var res=await fetch(PROXY_URL,{method:'POST',headers:headers,body:JSON.stringify({
      mode:currentModeKey(),
      role:ROLE,
      messages:messages,
      conversationId: window._currentConversationId || null,
      opportunityId: currentModeKey() === 'decide' ? (window._decideOpportunityId || null) : null,
      focus: (currentModeKey() === 'practice' || currentModeKey() === 'star' || currentModeKey() === 'mock') && window._practiceFocus ? window._practiceFocus : null,
      avoid: (messages.length===1 && messages[0].content==='Start the session now.' && window._avoidQuestion) ? window._avoidQuestion : null,
      voice: window._pendingVoice || null,
      stream:true
    })});
    window._pendingVoice = null;
    if(res.status===401){
      showSignupRequiredMessage();
      if(onDone)onDone(true);
      return;
    }
    if(res.status===403){
      var gateBody=await res.json().catch(function(){return {};});
      showUpgradeGateMessage(gateBody.error, gateBody);
      if(onDone)onDone();
      return;
    }
    if(res.status===429){
      var limitBody=await res.json().catch(function(){return {};});
      if(limitBody.error==='free_prep_limit_reached') showUpgradeGateMessage(limitBody.error, limitBody);
      else if(limitBody.error==='anon_global_limit_reached') showAnonGlobalLimitMessage();
      else showAnonLimitMessage();
      if(onDone)onDone();
      return;
    }
    if(!res.ok){
      var errBody=await res.json().catch(function(){return {};});
      hideTyping();
      addMsg('bot',streamErrorMessage(errBody));
      if(onDone)onDone();
      return;
    }
    var reader=res.body.getReader();
    var decoder=new TextDecoder();
    var fullText='';var buffer='';var streamError=null;
    while(true){
      var chunk=await reader.read();
      if(chunk.done)break;
      buffer+=decoder.decode(chunk.value,{stream:true});
      var lines=buffer.split('\n');
      buffer=lines.pop();
      for(var i=0;i<lines.length;i++){
        var line=lines[i].trim();
        if(!line||!line.startsWith('data: '))continue;
        var data=line.slice(6);
        if(data==='[DONE]')continue;
        try{
          var json=JSON.parse(data);
          if(json.type==='ezzy_guard'){ window._lastGuard = json.guard; console.warn('[ezzy-guard]', JSON.stringify(json.guard)); continue; }
          if(json.type==='error'){ streamError=json; continue; }
          if(json.type==='content_block_delta'&&json.delta&&json.delta.text){
            fullText+=json.delta.text;
            onChunk(json.delta.text,fullText);
          }
        }catch(e){}
      }
    }
    if(streamError||!fullText){
      // Either the API sent an in-band error event, or the stream closed
      // without a single text delta. Both leave the typing dots up forever
      // unless we say something here.
      console.warn('[chat] stream ended without a reply', streamError||'(no deltas)');
      hideTyping();
      addMsg('bot',streamErrorMessage(streamError));
    }
    if(onDone)onDone();
  }catch(e){
    hideTyping();
    addMsg('bot','Sorry, something went wrong. Please try again.');
    if(onDone)onDone();
  }
}

function streamErrorMessage(body){
  // body is either the proxy's {error:'upstream_error', upstream:{type}} or
  // an in-band Anthropic event {type:'error', error:{type}}.
  var inner=(body&&body.upstream)||(body&&body.error);
  var kind=(inner&&typeof inner==='object'?inner.type:inner)||'';
  if(/overloaded|rate_limit/.test(String(kind))) return 'I\'m overloaded right now. Give it a few seconds and send that again.';
  return 'Sorry, something went wrong on my end. Please send that again.';
}

function appendDownloadButton(){
  var btn=document.createElement('button');
  btn.className='download-btn';
  btn.innerHTML='<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg> Download PDF';
  btn.onclick=downloadFeedbackPDF;
  msgEl.appendChild(btn);

  var newBtn=document.createElement('button');
  newBtn.className='new-review-btn';
  newBtn.textContent='Start a new review';
  newBtn.onclick=startNewResumeReview;
  msgEl.appendChild(newBtn);

  scrollMain();
}

function appendSkipJDButton(){
  removeSkipJDButton();
  var btn=document.createElement('button');
  btn.className='new-review-btn';
  btn.id='skipJdBtn';
  btn.textContent="Skip - I don't have a specific job";
  btn.onclick=skipJobDescription;
  msgEl.appendChild(btn);
  scrollMain();
}

function removeSkipJDButton(){
  var btn=document.getElementById('skipJdBtn');
  if(btn) btn.remove();
}

// Not everyone reviewing a resume has one specific job posting in mind -
// forcing a JD paste blocked general "make my resume stronger" reviews
// entirely. Skipping goes straight to a general review with no further
// questions - asking a follow-up here would defeat the point of "just a
// general review" (the structured JD-requirement gap analysis is skipped
// too, since there's no real requirement list to check the resume against).
function skipJobDescription(){
  removeSkipJDButton();
  addMsg('user',"I don't have a specific job in mind");
  RESUME_STAGE='feedback_given';
  window.RESUME_STAGE=RESUME_STAGE;
  JD_TEXT=null; window.JD_TEXT=null; TARGET_HINT=null; window.TARGET_HINT=null;
  var generalUserMsg='Here is the candidate\'s resume:\n\n'+RESUME_TEXT+'\n\n---\n\nThe candidate does not have a specific job posting to target - give a general resume review using the format specified.';
  convoHistory=[{role:'user',content:generalUserMsg}];
  isSending=true;updateSendBtnState();
  showTyping();
  streamBotReply(convoHistory.slice(),function(reply){
    if(!reply) return;
    convoHistory.push({role:'assistant',content:reply});
    saveMessage('assistant', reply);
    appendDownloadButton();
    extractCareerClaims(RESUME_TEXT, null);
  });
}

// Resume Feedback keeps exactly one conversation per account - re-entering
// the mode restores it rather than starting fresh (useful if you got
// interrupted mid-review). This clears it out for real, so someone
// targeting a different job posting can actually get a second review
// instead of always landing back on the first one.
// Prep modes (Practice / STAR / Mock) keep one saved session per mode+role
// and restore it on re-entry. "Start over" clears that saved session and
// kicks off a fresh one, mirroring "Start a new review" for resumes.
// Lives at the bottom of the mode menu, small and behind a confirm - it's
// for someone who genuinely wants a fresh session, not a reflex button
// under every reply (each restart is a new API call).
var pendingStartOver=false;
async function requestStartOver(){
  if(isSending){ console.warn('[start-over] blocked: a reply is still in progress'); return; }
  // Re-read the saved row before offering the dialog so the icon can never
  // be stale relative to the server (restart already used, set unfinished).
  try{
    var modeId = TRAINER_MODE || window.TRAINER_MODE;
    var sessionRes = await window.supabaseClient.auth.getSession();
    var uid = sessionRes.data && sessionRes.data.session && sessionRes.data.session.user.id;
    if(uid && modeId){
      var q = window.supabaseClient.from('conversations').select('id,restart_count,answer_count').eq('user_id', uid).eq('mode', modeId).is('archived_at', null);
      q = window.ROLE ? q.eq('role', window.ROLE) : q.is('role', null);
      var r = await q.maybeSingle();
      if(r.error) console.warn('[start-over] row lookup failed', r.error);
      else if(r.data) window._prepMeta = { restart_count: r.data.restart_count || 0, answer_count: r.data.answer_count || 0 };
      else window._prepMeta = { restart_count: 0, answer_count: 0 };
      console.log('[start-over] state', JSON.stringify({ mode: modeId, role: window.ROLE || null, row: r.data || null, meta: window._prepMeta }));
    }
  }catch(e){ console.warn('[start-over] precheck error', e); }
  if(!startOverAvailable()){ console.warn('[start-over] not available: restart used and set not finished'); refreshStartOverRow(); return; }
  pendingStartOver=true;
  document.getElementById('modalTitle').textContent='Start over?';
  document.getElementById('modalDesc').textContent='This clears your current session and begins a new one with fresh questions.';
  document.getElementById('modalConfirmBtn').textContent='Start over';
  modalOverlay.classList.add('show');
}

// A finished set is a past session, not a live one. Once the scorecard
// has been delivered and saved, archive it so reopening the mode starts
// fresh; the finished set stays readable under Past sessions.
function isPrepSetComplete(reply){
  return /\*\*Scorecard\*\*/.test(reply || '');
}
async function archiveCompletedPrepSession(){
  var id = window._currentConversationId;
  if(!id || !window.supabaseClient) return;
  try{
    var r = await window.supabaseClient.from('conversations').update({ archived_at: new Date().toISOString() }).eq('id', id);
    if(r.error){ console.error('[set-complete] archive failed', r.error); return; }
  }catch(e){ console.error('[set-complete]', e); return; }
  window._currentConversationId = null;
  window._prepMeta = { restart_count: 0, answer_count: 0 };
  refreshStartOverRow();
  inputEl.disabled = true;
  inputEl.placeholder = 'Set complete. Use the restart icon for a new one.';
  addMsgWithoutSave('bot', '_Set complete and saved to Past sessions. Use the \u21bb icon next to your role to start a new set._');
  // This set was prep for a real role: point back at its record.
  if(typeof OPP_RETURN !== 'undefined' && OPP_RETURN){
    var ob = document.createElement('button');
    ob.className = 'new-review-btn';
    ob.textContent = 'Log where the ' + OPP_RETURN.label + ' stands';
    ob.onclick = backToOpportunity;
    msgEl.appendChild(ob);
    scrollMain();
  }
}

// One restart per set. After a restart, the candidate has to answer the
// full set before they can start over again. Tracked on the conversation
// row (restart_count / answer_count, migration 0021) so it survives a
// refresh. The row is kept and its messages cleared, so the counts persist
// and the next session reuses the same row.
var PREP_SET_SIZE = { practice: 5, star: 5, mock: 6 };
// Counts for the current prep session, mirrored from the conversation row.
window._prepMeta = { restart_count: 0, answer_count: 0 };
function startOverAvailable(){
  var modeId = TRAINER_MODE || window.TRAINER_MODE;
  // Always available in a prep mode. Restarts are counted on the
  // conversation, not prevented: nobody gets trapped in a session, and a
  // pattern of restarting past hard questions is visible rather than
  // blocked (Ari, 2026-11-21).
  return modeId==='practice'||modeId==='star'||modeId==='mock';
}
function refreshStartOverRow(){
  var btn=document.getElementById('startOverBtn');
  if(btn) btn.classList.toggle('show', startOverAvailable());
}
async function startNewPrepSession(){
  if(isSending){ console.warn('[start-over] blocked: sending'); return; }
  var modeId = TRAINER_MODE || window.TRAINER_MODE;
  if(!modeId){ console.warn('[start-over] no prep mode active'); return; }
  if(!startOverAvailable()) { console.warn('[start-over] not available at run time'); refreshStartOverRow(); return; }
  var required = PREP_SET_SIZE[modeId] || 5;
  console.log('[start-over] running for', modeId, window.ROLE || null);
  if(window.supabaseClient){
    try{
      var sessionRes = await window.supabaseClient.auth.getSession();
      var uid = sessionRes.data && sessionRes.data.session && sessionRes.data.session.user.id;
      if(uid){
        var query = window.supabaseClient.from('conversations').select('id,restart_count,answer_count').eq('user_id', uid).eq('mode', modeId).is('archived_at', null);
        query = window.ROLE ? query.eq('role', window.ROLE) : query.is('role', null);
        var existing = await query.maybeSingle();
        var row = existing.data;
        var answered = !!(row && (row.answer_count || 0) > 0);
        if(row && row.id){
          var used = (row.restart_count || 0) >= 1;
          var completed = (row.answer_count || 0) >= required;
          if(used && answered && !completed){ console.warn('[start-over] row says restart used, set unfinished', row); refreshStartOverRow(); return; }
          // Remember the opener so the new set starts somewhere else.
          var firstQ = null;
          for(var qi=0; qi<convoHistory.length; qi++){ if(convoHistory[qi].role==='assistant'){ firstQ=convoHistory[qi].content; break; } }
          window._avoidQuestion = (!answered && firstQ) ? String(firstQ).slice(0,500) : '';
          // Delete the conversation row (cascades to its messages - deleting
          // messages directly can be refused by RLS and then the old
          // session silently comes back on restore), then recreate it with
          // the restart recorded so the count survives a refresh.
          // Archive rather than delete: the transcript stays readable under
          // "Past sessions" and feeds the story bank later.
          var arch = await window.supabaseClient.from('conversations').update({ archived_at: new Date().toISOString() }).eq('id', row.id);
          if(arch.error){ console.error('Start over: could not archive session', arch.error); showSimpleToast('Could not start over. Try again.'); return; }
        }
        var hadLive = !!(row && row.id);
        // A restart only counts once an answer was given; before that the
        // old row's count carries over unchanged.
        var nextRestart = hadLive ? (answered ? 1 : (row.restart_count || 0)) : 0;
        var ins = await window.supabaseClient.from('conversations').insert({
          user_id: uid, mode: modeId, role: window.ROLE || null, restart_count: nextRestart, answer_count: 0
        });
        if(ins.error) console.error('[start-over] could not record restart', ins.error);
        else console.log('[start-over] ' + (hadLive ? 'archived old session, ' : '') + 'new row created');
        window._prepMeta = { restart_count: nextRestart, answer_count: 0 };
      }
    }catch(e){ console.error('Could not clear previous session:', e); }
  }
  window._currentConversationId = null;
  convoHistory=[]; window.convoHistory=[];
  msgEl.innerHTML='';
  inputEl.disabled = false;
  inputEl.placeholder = 'Type your answer...';
  refreshStartOverRow();
  startMode(modeId, modePillLabel.textContent || modeId);
}

async function startNewResumeReview(){
  if(window.supabaseClient){
    try{
      var sessionRes = await window.supabaseClient.auth.getSession();
      var uid = sessionRes.data && sessionRes.data.session && sessionRes.data.session.user.id;
      if(uid){
        var query = window.supabaseClient.from('conversations').select('id').eq('user_id', uid).eq('mode', 'resume').is('archived_at', null);
        query = window.ROLE ? query.eq('role', window.ROLE) : query.is('role', null);
        var existing = await query.maybeSingle();
        if(existing.data && existing.data.id){
          await window.supabaseClient.from('conversations').update({ archived_at: new Date().toISOString() }).eq('id', existing.data.id);
        }
      }
    }catch(e){ console.error('Could not clear previous review:', e); }
  }
  window._currentConversationId = null;
  RESUME_TEXT=''; JD_TEXT=''; RESUME_STAGE='awaiting_resume';
  window.RESUME_TEXT=''; window.JD_TEXT=''; window.RESUME_STAGE='awaiting_resume';
  convoHistory=[]; window.convoHistory=[];
  resumeDropDismissed=false;
  msgEl.innerHTML='';
  addMsg('bot','Paste your new resume below. Plain text is fine, formatting will be ignored.');
  inputEl.disabled=false;
  inputEl.placeholder='Type your answer...';
}

function downloadFeedbackPDF(){
  var jsPDF=window.jspdf.jsPDF;
  var doc=new jsPDF({unit:'pt',format:'letter'});
  var pageW=612, pageH=792, margin=60, maxW=pageW-margin*2;
  var y=0;
  var BODY=10.5, BODY_LH=15;

  function header(){
    doc.setFillColor(242,107,94); doc.rect(0,0,pageW,44,'F');
    doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(13);
    doc.text('Ezzy. Resume Review', margin, 28);
    doc.setFont('helvetica','normal'); doc.setFontSize(9);
    var meta=[]; if(window.ROLE) meta.push(window.ROLE); if(window.TARGET_HINT) meta.push(window.TARGET_HINT);
    meta.push(new Date().toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}));
    doc.text(meta.join('  ·  '), pageW-margin, 28, {align:'right'});
    doc.setTextColor(17,17,17); y=76;
  }
  function ensure(h){ if(y+h>pageH-margin){ doc.addPage(); header(); } }
  function clean(t){
    return String(t||'').replace(/\*\*(.+?)\*\*/g,'$1').replace(/(^|\s)\*(\S[^*]*)\*(?=\s|$|[.,;:])/g,'$1$2').replace(/(^|\s)_(\S[^_]*)_(?=\s|$|[.,;:])/g,'$1$2').replace(/`([^`]+)`/g,'$1').replace(/→/g,'->').replace(/“|”/g,'"').replace(/‘|’/g,"'").replace(/–|—/g,'-');
  }
  function para(text, indent, size, style, color){
    size=size||BODY; style=style||'normal'; indent=indent||0;
    doc.setFont('helvetica',style); doc.setFontSize(size); doc.setTextColor.apply(doc, color||[17,17,17]);
    var lines=doc.splitTextToSize(clean(text), maxW-indent);
    for(var i=0;i<lines.length;i++){ ensure(BODY_LH); doc.text(lines[i], margin+indent, y); y+=BODY_LH; }
  }
  function label(text){ ensure(26); y+=6; para(text.toUpperCase(), 0, 8.5, 'bold', [143,50,41]); y+=2; }
  function title(text){ ensure(30); y+=10; para(text, 0, 13, 'bold'); y+=4; }
  function rule(){ ensure(16); y+=4; doc.setDrawColor(230,220,216); doc.line(margin,y,pageW-margin,y); y+=12; }
  function bullet(text, marker, indent){
    doc.setFont('helvetica','normal'); doc.setFontSize(BODY); doc.setTextColor(17,17,17);
    var lines=doc.splitTextToSize(clean(text), maxW-indent-16);
    for(var i=0;i<lines.length;i++){ ensure(BODY_LH); if(i===0) doc.text(marker, margin+indent, y); doc.text(lines[i], margin+indent+16, y); y+=BODY_LH; }
    y+=3;
  }
  // A real table: header row on a tint, wrapped cells, light rules between
  // rows, page-break aware. Short columns (score, status) stay narrow.
  function table(headers, rows){
    var n=headers.length; if(!n) return;
    var weights=headers.map(function(h,i){ var hl=h.toLowerCase(); if(/score|status|weight|fit/.test(hl)) return 0.55; if(i===0) return 1.1; return 2; });
    var sum=weights.reduce(function(a,b){return a+b;},0);
    var widths=weights.map(function(w){ return w/sum*maxW; });
    var pad=6, cellLH=12, cellSize=9;
    function wrap(cells, bold){
      doc.setFont('helvetica', bold?'bold':'normal'); doc.setFontSize(cellSize);
      var out=[], h=0;
      for(var i=0;i<n;i++){ var ls=doc.splitTextToSize(clean(cells[i]||''), widths[i]-pad*2); out.push(ls); h=Math.max(h, ls.length*cellLH); }
      return {lines:out, h:h+pad*2};
    }
    function drawRow(cells, isHead){
      var w=wrap(cells, isHead);
      if(y+w.h>pageH-margin){ doc.addPage(); header(); y=76-BODY_LH+4; if(!isHead){ drawRow(headers, true); } }
      var top=y;
      if(isHead){ doc.setFillColor(243,241,236); doc.rect(margin, top, maxW, w.h, 'F'); }
      doc.setFont('helvetica', isHead?'bold':'normal'); doc.setFontSize(cellSize); doc.setTextColor.apply(doc, isHead?[107,107,107]:[17,17,17]);
      var x=margin;
      for(var i=0;i<n;i++){
        var ls=w.lines[i];
        for(var k=0;k<ls.length;k++){ doc.text(isHead?ls[k].toUpperCase():ls[k], x+pad, top+pad+cellSize-1+k*cellLH); }
        x+=widths[i];
      }
      y=top+w.h;
      doc.setDrawColor(238,236,231); doc.line(margin, y, pageW-margin, y);
    }
    y=y-BODY_LH+6; // para() treats y as a baseline; rows treat it as a top edge
    // Header and first row travel together: an orphaned header row at the
    // foot of a page reads as a broken table.
    var need=wrap(headers,true).h + (rows.length ? wrap(rows[0],false).h : 0);
    if(y+need>pageH-margin){ doc.addPage(); header(); y=76-BODY_LH+4; }
    drawRow(headers, true);
    rows.forEach(function(r){ drawRow(r, false); });
    y+=BODY_LH+6;
  }
  // The computed score, set apart the way the chat shows it.
  function callout(big, rest){
    var h=40; ensure(h+BODY_LH);
    var top=y-BODY_LH+4;
    doc.setFillColor(252,234,230); doc.roundedRect(margin, top, maxW, h, 6, 6, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(15); doc.setTextColor(143,50,41);
    doc.text(clean(big), margin+14, top+26);
    y=top+h+BODY_LH+2;
    if(rest) para(rest, 0, 9.5, 'normal', [90,90,90]);
  }
  function renderMarkdown(md){
    var lines=String(md||'').split('\n');
    for(var i=0;i<lines.length;i++){
      var raw=lines[i], line=raw.trim(), m;
      if(!line){ y+=5; continue; }
      if(/^\|/.test(line)){
        // Gather the whole table, then draw it.
        var tl=[]; while(i<lines.length && /^\|/.test(lines[i].trim())){ tl.push(lines[i].trim()); i++; } i--;
        var split=function(l){ return l.replace(/^\|/,'').replace(/\|$/,'').split('|').map(function(c){return c.trim();}); };
        var headers=split(tl[0]);
        var body=tl.slice(1).filter(function(l){ return !/^\|\s*:?-+/.test(l); }).map(split);
        table(headers, body); continue;
      }
      if(/^-{3,}$|^\*{3,}$|^_{3,}$/.test(line)){ rule(); continue; }
      if((m=line.match(/^#{1,3}\s+(.*)$/))){ title(clean(m[1])); continue; }
      if(/^\*{0,2}change\s+\d+/i.test(line)){ title(clean(line).replace(/:\s*$/,'')); continue; }
      if((m=line.match(/^\*\*(resume scorecard|scorecard)\*\*\s*(.*)$/i))){ ensure(150); title(m[1].charAt(0).toUpperCase()+m[1].slice(1)); if(m[2]) para(clean(m[2]), 0, 9.5, 'normal', [110,110,110]); continue; }
      if((m=line.match(/^\*\*((?:resume score|readiness):\s*[^*]+)\*\*\s*(?:-\s*)?(.*)$/i))){ callout(m[1], m[2]); continue; }
      if((m=line.match(/^\*\*(.+?):?\*\*:?\s*$/))){ label(m[1]); continue; }
      if((m=line.match(/^(?:[-*•])\s+(.*)$/))){ bullet(m[1], '•', 6); continue; }
      if((m=line.match(/^(\d+)[.)]\s+(.*)$/))){ bullet(m[2], m[1]+'.', 6); continue; }
      if((m=line.match(/^\*\*(.+?):\*\*\s*(.*)$/))){ label(m[1]); if(m[2]) para(m[2]); continue; }
      if((m=line.match(/^_(.+)_$/))){ para(m[1], 0, 9.5, 'italic', [110,110,110]); continue; }
      para(line);
    }
  }

  header();
  // Only Ezzy's review - the candidate already has their own resume.
  var replies=convoHistory.filter(function(m){ return m.role==='assistant' && m.content; });
  if(!replies.length){ para('No review to export yet.'); }
  replies.forEach(function(m, idx){ if(idx>0) rule(); renderMarkdown(m.content); });

  // Match box, if one is on screen
  var rows=document.querySelectorAll('.gap-box .gap-row');
  if(rows.length){
    rule(); title('How you match this role');
    Array.prototype.forEach.call(rows, function(r){
      var st=r.classList.contains('gap-matched')?'Matched':r.classList.contains('gap-partial')?'Partial':'Missing';
      var req=r.querySelector('.gap-req'); var note=r.querySelector('.gap-note');
      ensure(BODY_LH*2);
      para((req?req.textContent:'')+'  -  '+st, 0, BODY, 'bold');
      if(note && note.textContent) para(note.textContent, 12, 9.5, 'normal', [90,90,90]);
      y+=4;
    });
  }

  // Footer on every page
  var n=doc.getNumberOfPages();
  for(var pg=1; pg<=n; pg++){
    doc.setPage(pg); doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(150,150,150);
    doc.text('Ezzy · meetezzy.com', margin, pageH-30);
    doc.text('Page '+pg+' of '+n, pageW-margin, pageH-30, {align:'right'});
  }
  var d=new Date();var stamp=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  doc.save('ezzy-resume-review-'+stamp+'.pdf');
}

// Resume drop zone visibility
var resumeDropDismissed = false;
function updateDropZoneVisibility(){
  var dz=document.getElementById('dropZone');
  if(!dz)return;
  var shouldShow = (MODE==='resume' && RESUME_STAGE==='awaiting_resume' && !resumeDropDismissed);
  if(shouldShow){ dz.classList.add('active'); }
  else { dz.classList.remove('active'); }
}
// Reset dismissed flag when entering resume mode fresh
function resetDropZoneDismissal(){ resumeDropDismissed = false; }
// Poll for state changes (cheap & reliable; avoids monkey-patching addMsg)
setInterval(updateDropZoneVisibility, 300);
// Allow user to dismiss drop zone and paste instead
document.addEventListener('click', function(e){
  if(e.target && e.target.id==='pasteResumeLink'){
    resumeDropDismissed = true;
    var dz=document.getElementById('dropZone');
    if(dz) dz.classList.remove('active');
    var inputEl=document.getElementById('input');
    if(inputEl) inputEl.focus();
  }
  if(e.target && (e.target.id==='dropZoneBack' || e.target.id==='dropZoneClose')) leaveResumeDrop();
});
// Changed your mind at the drop box: signed-in users go back to My Career,
// anyone else gets the landing. Esc does the same.
function leaveResumeDrop(){
  resumeDropDismissed = true;
  var dz=document.getElementById('dropZone');
  if(dz) dz.classList.remove('active');
  var signedIn = document.getElementById('authUserMenu') && document.getElementById('authUserMenu').style.display !== 'none';
  if(signedIn && typeof goToDashboard === 'function') goToDashboard();
  else clearChatState();
}
document.addEventListener('keydown', function(e){
  if(e.key !== 'Escape') return;
  var dz=document.getElementById('dropZone');
  if(dz && dz.classList.contains('active')) leaveResumeDrop();
});
// Initial check
setTimeout(updateDropZoneVisibility, 200);

// Reads a dropped or chosen resume (PDF or TXT) to plain text. Resolves
// with the text; rejects with an Error whose message can be shown as-is.
// err.dismiss is true when the file itself is the problem (wrong type,
// too big, scanned, locked) rather than a transient one.
function readResumeFile(file){
  return new Promise(function(resolve, reject){
    var fail = function(msg, dismiss){ var e = new Error(msg); e.dismiss = !!dismiss; reject(e); };
    var name = (file.name || '').toLowerCase();
    var isText = name.endsWith('.txt') || file.type === 'text/plain';
    var isPdf = name.endsWith('.pdf') || file.type === 'application/pdf';
    if(isText){
      var tr = new FileReader();
      tr.onload = function(ev){ resolve(ev.target.result || ''); };
      tr.onerror = function(){ fail('I had trouble reading that file. Try pasting the text instead.'); };
      tr.readAsText(file);
      return;
    }
    if(!isPdf) return fail('That file type is not supported. Drop a PDF or TXT file, or paste your resume as text.', true);
    if(!window.pdfjsLib) return fail('PDF reader is still loading \u2014 give it a moment and try again.');
    if(file.size > 5 * 1024 * 1024) return fail('That PDF is over 5MB. Try a smaller file or paste the text below.', true);
    var reader = new FileReader();
    reader.onload = function(ev){
      var typedArray = new Uint8Array(ev.target.result);
      window.pdfjsLib.getDocument({data: typedArray}).promise.then(function(pdf){
        var pagePromises = [];
        for(var p = 1; p <= pdf.numPages; p++){
          pagePromises.push(pdf.getPage(p).then(function(page){
            return page.getTextContent().then(function(content){
              return content.items.map(function(item){return item.str;}).join(' ');
            });
          }));
        }
        return Promise.all(pagePromises).then(function(pages){
          var fullText = pages.join('\n\n').trim();
          if(!fullText || fullText.length < 30){
            return fail('This looks like a scanned PDF. We can only read PDFs with selectable text (like ones exported from Word or Google Docs). Try pasting your resume as text instead.', true);
          }
          resolve(fullText);
        }, function(err){
          console.error('PDF page error:', err);
          fail('I had trouble reading that PDF. Try pasting the text instead.', true);
        });
      }).catch(function(err){
        console.error('PDF load error:', err);
        fail(err && err.name === 'PasswordException'
          ? 'That PDF is password-protected. Please remove the password or paste the resume as text.'
          : 'I could not open that PDF. Try a different file or paste the text below.', true);
      });
    };
    reader.onerror = function(){ fail('I had trouble reading that file. Try pasting the text instead.'); };
    reader.readAsArrayBuffer(file);
  });
}

// Drop zone file handling
(function(){
  var dz = document.getElementById('dropZone');
  var dzBox = document.getElementById('dropZoneBox');
  if(!dz || !dzBox) return;

  var browseBtn = document.getElementById('resumeBrowseBtn');
  var fileInput = document.getElementById('resumeFileInput');
  if(browseBtn && fileInput){
    browseBtn.addEventListener('click', function(){ fileInput.click(); });
    fileInput.addEventListener('change', function(){
      if(fileInput.files && fileInput.files[0]) handleDroppedFile(fileInput.files[0]);
      fileInput.value = ''; // allow picking the same file again later
    });
  }

  // Prevent default browser behavior on the entire overlay (including dead space)
  ['dragenter','dragover','dragleave','drop'].forEach(function(evt){
    dz.addEventListener(evt, function(e){
      e.preventDefault();
      e.stopPropagation();
    }, false);
  });
  // Also catch the drop on the overlay itself (not just dzBox), in case user drops outside the dashed box
  dz.addEventListener('drop', function(e){
    e.preventDefault();
    e.stopPropagation();
    var files = e.dataTransfer && e.dataTransfer.files;
    if(!files || files.length === 0) return;
    handleDroppedFile(files[0]);
  });
  // ALSO globally prevent the browser from opening dropped files when overlay is active
  ['dragover','drop'].forEach(function(evt){
    window.addEventListener(evt, function(e){
      if(dz.classList.contains('active')){
        e.preventDefault();
      }
    }, false);
  });

  // Visual feedback on the drop box
  dzBox.addEventListener('dragenter', function(e){ dzBox.classList.add('dragging'); });
  dzBox.addEventListener('dragover', function(e){ dzBox.classList.add('dragging'); });
  dzBox.addEventListener('dragleave', function(e){
    if(e.target === dzBox) dzBox.classList.remove('dragging');
  });

  // Drop is handled on the overlay (dz) — don't duplicate here, just visual cleanup
  dzBox.addEventListener('drop', function(e){
    dzBox.classList.remove('dragging');
  });

  // Chat drop zone: read the file, then send the text through the
  // resume flow. Errors flagged .dismiss close the drop zone for good.
  function handleDroppedFile(file){
    readResumeFile(file).then(function(text){
      injectResumeText(text, file.name);
    }, function(err){
      if(err && err.dismiss){
        resumeDropDismissed = true;
        dz.classList.remove('active');
        inputEl.disabled = false;
        inputEl.placeholder = 'Type your answer...';
      }
      addMsg('bot', (err && err.message) || 'I had trouble reading that file. Try pasting the text instead.');
    });
  }

  function injectResumeText(text, fileName){
    if(!text || text.trim().length < 20){
      addMsg('bot','That file looked empty. Try a different file or paste your resume as text.');
      return;
    }
    // Hide drop zone permanently
    resumeDropDismissed = true;
    dz.classList.remove('active');
    inputEl.disabled = false;
    inputEl.placeholder = 'Type your answer...';
    // Send the parsed text through the existing flow
    handleSendText(text);
  }
})();
