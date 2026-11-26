
async function loadConversationForMode(modeId){
  if(!window.supabaseClient) return false;
  var session = await window.supabaseClient.auth.getSession();
  if(!session.data.session) return false;
  var userId = session.data.session.user.id;
  
  var dbMode = (modeId === 'resume') ? 'resume' : modeId;
  
  var role = window.ROLE || null;
  // Fetch conversation row for user+mode+role
  var query = window.supabaseClient
    .from('conversations')
    .select('*')
    .eq('user_id', userId)
    .eq('mode', dbMode)
    .is('archived_at', null);
  if(role){ query = query.eq('role', role); }
  else { query = query.is('role', null); }
  var convoRes = await query.maybeSingle();
  
  if(convoRes.error || !convoRes.data){ window._prepMeta = { restart_count: 0, answer_count: 0 }; return false; }
  var convo = convoRes.data;
  
  // Fetch messages for this conversation
  var msgRes = await window.supabaseClient
    .from('messages')
    .select('role, content, created_at')
    .eq('conversation_id', convo.id)
    .order('created_at', { ascending: true });
  
  if(msgRes.error || !msgRes.data || msgRes.data.length === 0){
    // Conversation exists but no messages — treat as fresh (but keep its
    // restart/answer counts: a just-restarted set still counts as used)
    window._prepMeta = { restart_count: convo.restart_count || 0, answer_count: convo.answer_count || 0 };
    return false;
  }
  
  // Restore state variables
  window.ROLE = convo.role || window.ROLE;
  window._currentConversationId = convo.id;
  window._prepMeta = { restart_count: convo.restart_count || 0, answer_count: convo.answer_count || 0 };
  if(modeId === 'decide' && convo.opportunity_id) window._decideOpportunityId = convo.opportunity_id;
  if((modeId === 'practice' || modeId === 'star' || modeId === 'mock') && convo.opportunity_id) practiceFocusFromOpportunity(convo.opportunity_id);
  
  if(modeId === 'resume'){
    window.RESUME_TEXT = convo.resume_text || '';
    window.JD_TEXT = convo.jd_text || '';
    window.RESUME_STAGE = convo.resume_stage || 'awaiting_resume';
    window.resumeDropDismissed = (window.RESUME_STAGE !== 'awaiting_resume');
  }
  var researchHalfStarted = false;
  if(modeId === 'research'){
    var savedStage = convo.research_stage || 'conversational';
    if(savedStage === 'generating_brief' || savedStage === 'awaiting_company'){ savedStage = 'awaiting_company'; researchHalfStarted = true; }
    window.RESEARCH_COMPANY = researchHalfStarted ? '' : (convo.research_company || '');
    window.RESEARCH_STAGE = savedStage;
    if(typeof RESEARCH_COMPANY !== 'undefined') RESEARCH_COMPANY = window.RESEARCH_COMPANY;
    if(typeof RESEARCH_STAGE !== 'undefined') RESEARCH_STAGE = window.RESEARCH_STAGE;
  }
  
  // Clear current UI and rebuild from saved messages
  msgEl.innerHTML = '';
  convoHistory = [];
  
  msgRes.data.forEach(function(m){
    var displayRole = (m.role === 'assistant') ? 'bot' : 'user';
    addMsgWithoutSave(displayRole, m.content);
    convoHistory.push({role: m.role, content: m.content});
  });
  if(researchHalfStarted){
    // The brief never landed (tab closed mid-search, or the company was
    // not a company). Nothing to follow up on: ask for the company again.
    convoHistory = [];
    addMsgWithoutSave('bot', COMPANY_ASK);
  }

  // Restoring a completed review skips handleSendText entirely, so the
  // buttons that normally follow a reply never got a chance to appear -
  // same root cause as the "no button" report, just a different path in.
  if(modeId === 'resume' && convo.resume_stage === 'feedback_given'){
    var gaps = await fetchGapsForJd(userId, convo.jd_text);
    if(gaps.length) appendGapAnalysis(gaps);
    appendDownloadButton();
  }
  refreshStartOverRow();

  return true;
}

// Version of addMsg that skips the saveMessage hook (so loaded messages don't re-save)
function addMsgWithoutSave(role, text){
  var node;
  if(role === 'user'){
    node = document.createElement('div');
    node.className = 'msg msg-user';
    fillUserBubble(node, text);
  } else {
    node = document.createElement('div');
    node.className = 'msg-bot-row';
    var av = document.createElement('div');
    av.className = 'msg-bot-avatar';
    av.textContent = 'E';
    var bub = document.createElement('div');
    bub.className = 'msg-bot';
    if(text){ try{ bub.innerHTML = marked.parse(text); }catch(e){ bub.textContent = text; } externalizeLinks(bub); }
    node.appendChild(av);
    node.appendChild(bub);
  }
  msgEl.appendChild(node);
  if(typeof scrollMain === 'function') scrollMain();
}
