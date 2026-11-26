
// Anonymous → signed-up bridge
function captureAnonymousState(){
  if(typeof syncWindowState === 'function') syncWindowState();
  // Only capture if user is currently anonymous (not signed in)
  if(window.supabaseClient){
    // Best-effort sync check; we'll rely on a flag set after signup attempt
  }
  
  // Don't save if there's nothing meaningful (no role picked, no messages)
  if(!window.ROLE && (!window.convoHistory || window.convoHistory.length === 0)){
    return;
  }
  
  var snapshot = {
    role: window.ROLE || null,
    mode: window.MODE === 'resume' ? 'resume' : (window.TRAINER_MODE || 'practice'),
    convoHistory: window.convoHistory || [],
    resumeText: window.RESUME_TEXT || null,
    jdText: window.JD_TEXT || null,
    resumeStage: window.RESUME_STAGE || null,
    capturedAt: Date.now()
  };
  
  try {
    localStorage.setItem('ezzy_anon_pending', JSON.stringify(snapshot));
  } catch(e){
    console.error('Failed to capture anon state:', e);
  }
}

function clearAnonymousCapture(){
  try { localStorage.removeItem('ezzy_anon_pending'); } catch(e){}
}

function getAnonymousCapture(){
  try {
    var raw = localStorage.getItem('ezzy_anon_pending');
    if(!raw) return null;
    var parsed = JSON.parse(raw);
    // Discard if older than 1 hour (safety against stale data)
    if(Date.now() - parsed.capturedAt > 60 * 60 * 1000){
      clearAnonymousCapture();
      return null;
    }
    return parsed;
  } catch(e){
    return null;
  }
}

// Migrate anonymous capture into the new authenticated account
async function migrateAnonymousToAccount(user){
  if(!user || !window.supabaseClient) return;
  var snapshot = getAnonymousCapture();
  if(!snapshot){ return; }
  if(!snapshot.role || !snapshot.convoHistory || snapshot.convoHistory.length === 0){
    clearAnonymousCapture();
    return;
  }
  
  try {
    // Create a conversation row for this captured state
    var insertConvo = {
      user_id: user.id,
      mode: snapshot.mode,
      role: snapshot.role,
      resume_text: snapshot.resumeText,
      jd_text: snapshot.jdText,
      resume_stage: snapshot.resumeStage
    };
    
    var activeQ = window.supabaseClient.from('conversations').select('id').eq('user_id', insertConvo.user_id).eq('mode', insertConvo.mode).is('archived_at', null);
    activeQ = insertConvo.role ? activeQ.eq('role', insertConvo.role) : activeQ.is('role', null);
    var activeRes = await activeQ.maybeSingle();
    var convoRes;
    if(activeRes.data && activeRes.data.id){
      convoRes = await window.supabaseClient.from('conversations').update(insertConvo).eq('id', activeRes.data.id).select('id').single();
    } else {
      convoRes = await window.supabaseClient.from('conversations').insert(insertConvo).select('id').single();
    }
    
    if(convoRes.error || !convoRes.data){
      console.error('Migration: convo insert failed', convoRes.error);
      return;
    }
    var conversationId = convoRes.data.id;
    
    // Insert all messages from the snapshot
    var messageRows = snapshot.convoHistory.map(function(m){
      return {
        conversation_id: conversationId,
        user_id: user.id,
        role: m.role,
        content: m.content
      };
    });
    
    if(messageRows.length > 0){
      var msgRes = await window.supabaseClient.from('messages').insert(messageRows);
      if(msgRes.error){
        console.error('Migration: messages insert failed', msgRes.error);
      }
    }
    
    // Clean up
    clearAnonymousCapture();
    
    // Restore state from snapshot for the active session
    window.ROLE = snapshot.role;
    window._currentConversationId = conversationId;
    if(snapshot.mode === 'resume'){
      window.RESUME_TEXT = snapshot.resumeText || '';
      window.JD_TEXT = snapshot.jdText || '';
      window.RESUME_STAGE = snapshot.resumeStage || 'awaiting_resume';
      window.resumeDropDismissed = (window.RESUME_STAGE !== 'awaiting_resume');
    }
    
    console.log('Migrated anonymous state to authenticated account');
  } catch(err){
    console.error('Migration error:', err);
  }
}
