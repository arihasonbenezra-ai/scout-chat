
(function(){
  if(!window.supabaseClient) return;

  // Check on page load. A stored token can outlive its account (the user
  // was deleted server-side); getUser() asks the server, and if the
  // account is gone the stale session is dropped so the page starts
  // signed out instead of stuck in onboarding with a dead user id.
  window.supabaseClient.auth.getSession().then(async function(res){
    var session = res.data.session;
    if(session && session.user){
      try{
        var u = await window.supabaseClient.auth.getUser();
        if(u.error || !u.data || !u.data.user){
          await window.supabaseClient.auth.signOut({ scope: 'local' });
          updateAuthUI(null);
          return;
        }
      }catch(e){}
      updateAuthUI(session.user);
      resumeGatedRetryIfAny();
    } else {
      updateAuthUI(null);
    }
  });
  
  // Listen for auth changes (sign in, sign out)
  // Deliberately NOT auto-restoring "your most recently touched conversation
  // from any mode" here anymore. A backgrounded tab can get fully discarded
  // and reloaded by the browser (common under memory pressure) - that's a
  // fresh page load, so a same-page "only once" guard can't prevent it from
  // firing again. The failure mode (silently teleporting someone away from
  // whatever they were mid-typing, to an unrelated old conversation, because
  // it happens to have the newest timestamp) is worse than the convenience
  // it bought. Re-entering a specific mode still restores that mode's own
  // conversation correctly via loadConversationForMode - only the
  // guess-which-mode-you-meant behavior is gone.
  window.supabaseClient.auth.onAuthStateChange(function(event, session){
    if(session && session.user){
      updateAuthUI(session.user);
    } else {
      updateAuthUI(null);
    }
    // Arriving from a "forgot password" email: Supabase signs them in with
    // a recovery session and fires this event - that's the moment to ask
    // for the new password.
    if(event === 'PASSWORD_RECOVERY') showNewPasswordOverlay();
  });
  
  // Close dropdown on outside click
  document.addEventListener('click', function(e){
    var dropdown = document.getElementById('authUserDropdown');
    var userBtn = document.getElementById('authUserBtn');
    if(!dropdown || !userBtn) return;
    if(dropdown.classList.contains('active') && !userBtn.contains(e.target) && !dropdown.contains(e.target)){
      dropdown.classList.remove('active');
    }
  });
})();

async function updateAuthUI(user){
  var signInBtn = document.getElementById('authSignInBtn');
  var userMenu = document.getElementById('authUserMenu');
  if(!signInBtn || !userMenu) return;
  
  if(user){
    // Try to fetch the profile name from Postgres first
    var displayName = null;
    try {
      var res = await window.supabaseClient.from('profiles').select('name').eq('id', user.id).maybeSingle();
      if(res.data && res.data.name) displayName = res.data.name;
    } catch(e){ /* fall through */ }
    
    if(!displayName){
      displayName = (user.user_metadata && user.user_metadata.name) || user.email.split('@')[0];
    }
    
    var initial = displayName.charAt(0).toUpperCase();
    document.getElementById('authUserInitial').textContent = initial;
    document.getElementById('authUserName').textContent = displayName;
    document.getElementById('authUserEmail').textContent = user.email;
    signInBtn.style.display = 'none';
    userMenu.style.display = 'block';
    
    // Migrate anonymous data first (if any), then check onboarding
    await migrateAnonymousToAccount(user);
    checkAndShowOnboarding(user);
    // Two versions of Ezzy: Career plan accounts get the dashboard as home;
    // Job Search / free accounts keep the pill landing and can open the
    // dashboard as a locked preview from the My Career link.
    await loadPlan(user.id);
    renderPlanMenuItem();
    var navHome = document.getElementById('navHome');
    if(navHome) navHome.classList.add('show');
    if(isCareerPlan() && !MODE && emptyState && emptyState.style.display !== 'none') showDashboard();
    settleCheckout(user.id);
  } else {
    signInBtn.style.display = 'inline-flex';
    userMenu.style.display = 'none';
    var navHome2 = document.getElementById('navHome');
    if(navHome2) navHome2.classList.remove('show');
    hideDashboard();
  }
}

function toggleUserDropdown(){
  var d = document.getElementById('authUserDropdown');
  if(d) d.classList.toggle('active');
}

async function signOut(){
  if(!window.supabaseClient) return;
  var nameEl = document.getElementById('authUserName');
  var displayName = (nameEl && nameEl.textContent) ? nameEl.textContent.trim() : '';
  var d = document.getElementById('authUserDropdown');
  if(d) d.classList.remove('active');
  await window.supabaseClient.auth.signOut();
  clearChatState();
  showGoodbyeOverlay(displayName);
}
function clearChatState(){
  convoHistory = [];
  MODE = null; ROLE = null; TRAINER_MODE = null;
  RESUME_STAGE = null; RESUME_TEXT = ''; JD_TEXT = ''; PENDING_JD = null;
  pendingModeSwitch = null;
  resumeDropDismissed = false;
  if(typeof hideTyping === 'function') hideTyping();
  if(msgEl) msgEl.innerHTML = '';
  if(modePill) modePill.style.display = 'none';
  if(roleLabel) roleLabel.style.display = 'none';
  var sob=document.getElementById('startOverBtn'); if(sob) sob.classList.remove('show');
  if(dotSep) dotSep.style.display = 'none';
  if(emptyState) emptyState.style.display = '';
  if(typeof resetEmptyStateToStage1 === 'function') resetEmptyStateToStage1();
  if(typeof syncWindowState === 'function') syncWindowState();
}
// Cancel and delete, self-serve. No email to anyone.
var ACCOUNT_KIND = null;
function accountConfirm(kind){
  var d = document.getElementById('authUserDropdown'); if(d) d.classList.remove('active');
  ACCOUNT_KIND = kind;
  var t = document.getElementById('accountTitle'), x = document.getElementById('accountText'), inp = document.getElementById('accountConfirmInput'), go = document.getElementById('accountGo'), keep = document.getElementById('accountKeep'), err = document.getElementById('accountError');
  err.textContent = ''; inp.value = ''; go.disabled = false; keep.style.display = '';
  if(kind === 'cancel'){
    t.textContent = 'Cancel your subscription?';
    x.textContent = 'Billing stops. You keep everything until the end of the month you paid for, then the account drops to Free. Your resume, sessions and opportunities stay.';
    inp.style.display = 'none'; go.textContent = 'Cancel subscription';
  } else {
    t.textContent = 'Delete your account?';
    x.textContent = 'Everything goes: your resume, answers, sessions, opportunities and the login itself. Any subscription is cancelled first. This cannot be undone.';
    inp.style.display = ''; go.textContent = 'Delete my account';
  }
  document.getElementById('accountOverlay').classList.add('active');
  if(kind === 'delete') setTimeout(function(){ inp.focus(); }, 50);
}
function accountClose(){ document.getElementById('accountOverlay').classList.remove('active'); ACCOUNT_KIND = null; }
async function accountGo(){
  var kind = ACCOUNT_KIND, go = document.getElementById('accountGo'), err = document.getElementById('accountError'), inp = document.getElementById('accountConfirmInput');
  if(kind === 'delete' && inp.value.trim() !== 'DELETE'){ err.textContent = 'Type DELETE to confirm.'; return; }
  go.disabled = true; err.textContent = '';
  try{
    var token = await getAuthTokenIfSignedIn(); if(!token) throw new Error('Sign in first.');
    var res = await fetch('/api/account', { method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer ' + token }, body: JSON.stringify({ action: kind, confirm: inp.value.trim() }) });
    var data = await res.json().catch(function(){ return {}; });
    if(!res.ok) throw new Error((data.error || 'Could not do that') + (data.detail ? ': ' + data.detail : ''));
    if(kind === 'cancel'){
      accountClose();
      showSimpleToast(data.billed ? 'Cancelled. You keep access until ' + (data.ends ? dashDate(data.ends) : 'the end of the period') + '.' : 'Nothing is being billed. Access ends ' + (data.ends ? dashDate(data.ends) : 'when the period does') + '.');
      return;
    }
    // Deleted. Drop the local session and say goodbye for real.
    try{ await window.supabaseClient.auth.signOut({ scope: 'local' }); }catch(e){}
    document.getElementById('accountTitle').textContent = 'Your account is deleted.';
    document.getElementById('accountText').textContent = 'Everything is gone. Thanks for giving Ezzy a try.';
    inp.style.display = 'none'; document.getElementById('accountKeep').style.display = 'none';
    go.disabled = false; go.textContent = 'Close'; go.onclick = function(){ location.href = location.pathname; };
  }catch(e){ go.disabled = false; err.textContent = String(e && e.message || e); }
}
function showGoodbyeOverlay(name){
  var overlay = document.getElementById('goodbyeOverlay');
  if(!overlay) return;
  var nameSpan = document.getElementById('goodbyeName');
  if(nameSpan) nameSpan.textContent = name ? (', ' + name) : '';
  overlay.classList.add('active');
}
function hideGoodbyeOverlay(){
  var overlay = document.getElementById('goodbyeOverlay');
  if(overlay) overlay.classList.remove('active');
}
function startFreshFromGoodbye(){
  hideGoodbyeOverlay();
  // clearChatState already restored emptyState (role picker) — nothing more to do
}
function signInFromGoodbye(){
  hideGoodbyeOverlay();
  if(typeof showAuthModal === 'function') showAuthModal('signin');
}

// Override onAuthSuccess from earlier to update UI
function onAuthSuccess(user){
  hideAuthModal();
  updateAuthUI(user);
  if(pendingGatedRetry){
    try { localStorage.removeItem('ezzy_pending_retry'); } catch(e){}
    var retry=pendingGatedRetry;
    pendingGatedRetry=null;
    isSending=true;updateSendBtnState();
    showTyping();
    streamBotReply(retry.messages, retry.afterDone);
  }
}
