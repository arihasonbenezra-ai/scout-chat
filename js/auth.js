
function setAuthNote(msg){
  var el = document.getElementById('authNote');
  if(el) el.textContent = msg || '';
}
function showAuthModal(mode){
  var m = document.getElementById('authModal');
  if(!m) return;
  m.classList.remove('forgot-mode');
  if(mode === 'signin'){ m.classList.add('signin-mode'); }
  else { m.classList.remove('signin-mode'); }
  updateAuthCopy();
  showAuthError('');
  setAuthNote('');
  m.classList.add('active');
  setTimeout(function(){
    var emailEl = document.getElementById('authEmail');
    if(emailEl) emailEl.focus();
  }, 100);
}
function hideAuthModal(){
  var m = document.getElementById('authModal');
  if(m){ m.classList.remove('active'); m.classList.remove('forgot-mode'); }
  showAuthError('');
  setAuthNote('');
}
function toggleAuthMode(){
  var m = document.getElementById('authModal');
  if(!m) return;
  m.classList.remove('forgot-mode');
  m.classList.toggle('signin-mode');
  updateAuthCopy();
  showAuthError('');
  setAuthNote('');
}

// Forgot password: Supabase emails a reset link that brings them back here
// with a recovery session, which the onAuthStateChange listener turns into
// the "set a new password" screen below.
function showForgotPassword(){
  var m = document.getElementById('authModal');
  if(!m) return;
  m.classList.add('forgot-mode');
  showAuthError('');
  setAuthNote('');
  document.getElementById('authModalTitle').textContent = 'Reset your password';
  document.getElementById('authModalSub').textContent = "Enter your email and we'll send you a reset link.";
  var known = document.getElementById('authEmail').value.trim();
  var forgotEmail = document.getElementById('forgotEmail');
  if(known && !forgotEmail.value) forgotEmail.value = known;
  setTimeout(function(){ forgotEmail.focus(); }, 100);
}
async function sendPasswordReset(){
  if(!window.supabaseClient){ showAuthError('Auth is not ready yet — try again in a moment.'); return; }
  var email = document.getElementById('forgotEmail').value.trim();
  if(!email){ showAuthError('Enter your email address.'); return; }
  var btn = document.getElementById('forgotSubmitBtn');
  btn.disabled = true; btn.textContent = 'Sending...';
  showAuthError(''); setAuthNote('');
  try {
    var result = await window.supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    if(result.error) throw result.error;
    setAuthNote('Check your email for a reset link. It can take a minute to arrive.');
    btn.textContent = 'Sent';
  } catch(err){
    console.error('Password reset error:', err);
    showAuthError(err.message || 'Could not send a reset link. Try again.');
    btn.disabled = false; btn.textContent = 'Send reset link';
  }
}

// "Set a new password" screen, shown when they arrive from the reset email.
function showNewPasswordOverlay(){
  var overlay = document.getElementById('newPasswordOverlay');
  if(!overlay) return;
  hideAuthModal();
  overlay.classList.add('active');
  setTimeout(function(){
    var inp = document.getElementById('newPasswordInput');
    if(inp) inp.focus();
  }, 200);
}
async function submitNewPassword(e){
  if(e) e.preventDefault();
  if(!window.supabaseClient) return;
  var inp = document.getElementById('newPasswordInput');
  var btn = document.getElementById('newPasswordSubmitBtn');
  var errEl = document.getElementById('newPasswordError');
  var pw = inp.value;
  if(pw.length < 8){ errEl.textContent = 'Use at least 8 characters.'; return; }
  btn.disabled = true; btn.textContent = 'Saving...'; errEl.textContent = '';
  try {
    var result = await window.supabaseClient.auth.updateUser({ password: pw });
    if(result.error) throw result.error;
    document.getElementById('newPasswordOverlay').classList.remove('active');
    inp.value = '';
    addMsg('bot', 'Your password is updated and you\'re signed in.');
  } catch(err){
    console.error('Password update error:', err);
    errEl.textContent = err.message || 'Could not update your password. Try again.';
  } finally {
    btn.disabled = false; btn.textContent = 'Save new password';
  }
}
function updateAuthCopy(){
  var m = document.getElementById('authModal');
  var isSignin = m.classList.contains('signin-mode');
  document.getElementById('authModalTitle').textContent = isSignin ? 'Welcome back' : 'Welcome to Ezzy';
  document.getElementById('authModalSub').textContent = isSignin ? 'Sign in to keep going' : 'Sign up to save your progress';
  document.getElementById('authSubmitBtn').textContent = isSignin ? 'Sign In' : 'Sign Up';
  var toggleLink = document.getElementById('authToggleLink');
  toggleLink.textContent = isSignin ? 'Sign up' : 'Sign in';
  toggleLink.parentElement.firstChild.textContent = isSignin ? "Don't have an account? " : 'Already have an account? ';
  var pwField = document.getElementById('authPassword');
  if(pwField) pwField.setAttribute('autocomplete', isSignin ? 'current-password' : 'new-password');
}
// Auth submit handler — handles both sign up and sign in
async function handleAuthSubmit(e){
  e.preventDefault();
  if(!window.supabaseClient){
    showAuthError('Auth is not ready yet — try again in a moment.');
    return;
  }
  var modal = document.getElementById('authModal');
  var isSignin = modal.classList.contains('signin-mode');
  var email = document.getElementById('authEmail').value.trim();
  var password = document.getElementById('authPassword').value;
  var name = document.getElementById('authName').value.trim();
  var submitBtn = document.getElementById('authSubmitBtn');
  
  if(!email || !password){
    showAuthError('Please fill in email and password.');
    return;
  }
  if(!isSignin && password.length < 6){
    showAuthError('Password must be at least 6 characters.');
    return;
  }
  
  submitBtn.disabled = true;
  submitBtn.textContent = isSignin ? 'Signing in...' : 'Creating account...';
  showAuthError('');
  
  try {
    if(isSignin){
      captureAnonymousState();
      var result = await window.supabaseClient.auth.signInWithPassword({email: email, password: password});
      if(result.error) throw result.error;
      onAuthSuccess(result.data.user);
    } else {
      captureAnonymousState();
      var result = await window.supabaseClient.auth.signUp({
        email: email,
        password: password,
        options: { data: { name: name || '' } }
      });
      if(result.error) throw result.error;
      // With email confirmation on, Supabase answers a signup for an address
      // that already has an account with a user, no session and an empty
      // identities list, and sends no mail. Say so instead of "check your email".
      if(result.data.user && Array.isArray(result.data.user.identities) && result.data.user.identities.length===0){
        showAuthError('You already have an account with this email. Sign in instead.');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign Up';
        return;
      }
      // If email confirmation is required, user.session will be null
      if(result.data.user && !result.data.session){
        showAuthError('Check your email to confirm your account.');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign Up';
        return;
      }
      onAuthSuccess(result.data.user);
    }
  } catch(err){
    console.error('Auth error:', err);
    showAuthError(err.message || 'Something went wrong. Try again.');
    submitBtn.disabled = false;
    submitBtn.textContent = isSignin ? 'Sign In' : 'Sign Up';
  }
}

function showAuthError(msg){
  var el = document.getElementById('authError');
  if(el) el.textContent = msg;
}

function onAuthSuccess(user){
  console.log('Auth success:', user);
  hideAuthModal();
  // For now, just log - we'll handle UI updates in Phase 2C
}

async function signInWithGoogle(){
  if(!window.supabaseClient){
    showAuthError('Auth is not ready yet — try again in a moment.');
    return;
  }
  showAuthError('');
  try {
    captureAnonymousState();
    var result = await window.supabaseClient.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin
      }
    });
    if(result.error) throw result.error;
    // Browser redirects to Google, then back here. onAuthStateChange handles the rest.
  } catch(err){
    console.error('Google OAuth error:', err);
    showAuthError(err.message || 'Could not start Google sign-in.');
  }
}
