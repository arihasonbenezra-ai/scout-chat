
// Conversation persistence

window._currentConversationId = null;

// "generating_brief" is an in-flight state, never a saved one: if the tab
// closes mid-search the row must come back asking for the company again.
function persistedResearchStage(){
  var s = window.RESEARCH_STAGE || null;
  return s === 'generating_brief' ? 'awaiting_company' : s;
}
async function ensureConversation(){
  if(!window.supabaseClient) return null;
  var session = await window.supabaseClient.auth.getSession();
  if(!session.data.session) return null;
  var userId = session.data.session.user.id;
  var mode;
  if(window.MODE === 'resume') mode = 'resume';
  else if(window.MODE === 'research') mode = 'research';
  else mode = (window.TRAINER_MODE || 'practice');
  
  var role = window.ROLE || null;
  // Try to fetch existing conversation for this user+mode+role combo
  var query = window.supabaseClient
    .from('conversations')
    .select('id')
    .eq('user_id', userId)
    .eq('mode', mode)
    .is('archived_at', null);
  if(role){ query = query.eq('role', role); }
  else { query = query.is('role', null); }
  var existing = await query.maybeSingle();
  
  if(existing.data && existing.data.id){
    window._currentConversationId = existing.data.id;
    return existing.data.id;
  }
  
  // Create new conversation row
  var insertData = {
    user_id: userId,
    mode: mode,
    role: window.ROLE || null,
    resume_text: window.RESUME_TEXT || null,
    jd_text: window.JD_TEXT || null,
    resume_stage: window.RESUME_STAGE || null,
    research_company: window.RESEARCH_COMPANY || null,
    research_stage: persistedResearchStage()
  };
  if(mode === 'decide' && window._decideOpportunityId) insertData.opportunity_id = window._decideOpportunityId;
  if((mode === 'practice' || mode === 'star' || mode === 'mock') && window._practiceOpportunityId) insertData.opportunity_id = window._practiceOpportunityId;
  
  var created = await window.supabaseClient
    .from('conversations')
    .insert(insertData)
    .select('id')
    .single();
  
  if(created.data && created.data.id){
    window._currentConversationId = created.data.id;
    return created.data.id;
  }
  return null;
}

async function saveMessage(role, content){
  if(!window.supabaseClient || !content) return;
  if(role !== 'user' && role !== 'assistant') return;
  
  var session = await window.supabaseClient.auth.getSession();
  if(!session.data.session) return; // not signed in - skip save
  var userId = session.data.session.user.id;
  
  var conversationId = await ensureConversation();
  if(!conversationId) return;
  
  await window.supabaseClient.from('messages').insert({
    conversation_id: conversationId,
    user_id: userId,
    role: role,
    content: content
  });
  
  // Update conversation's updated_at + mode-specific fields
  var patch = {
    role: window.ROLE || null,
    resume_text: window.RESUME_TEXT || null,
    jd_text: window.JD_TEXT || null,
    resume_stage: window.RESUME_STAGE || null,
    research_company: window.RESEARCH_COMPANY || null,
    research_stage: persistedResearchStage(),
    updated_at: new Date().toISOString()
  };
  // Prep modes: how many answers the candidate has given in this set
  // (drives the one-restart-per-set rule in startNewPrepSession).
  var prepMode = window.TRAINER_MODE || (typeof TRAINER_MODE !== 'undefined' ? TRAINER_MODE : null);
  var inPrep = (prepMode === 'practice' || prepMode === 'star' || prepMode === 'mock') && (window.MODE === 'trainer' || (typeof MODE !== 'undefined' && MODE === 'trainer'));
  if(role === 'user' && inPrep && Array.isArray(window.convoHistory || convoHistory)){
    var hist = window.convoHistory || convoHistory;
    patch.answer_count = hist.filter(function(m){ return m.role === 'user'; }).length;
    window._prepMeta = window._prepMeta || {};
    window._prepMeta.answer_count = patch.answer_count;
  }
  await window.supabaseClient.from('conversations').update(patch).eq('id', conversationId);
}

// Reset conversation tracking when mode changes
window.resetConversationTracking = function(){
  window._currentConversationId = null;
};
