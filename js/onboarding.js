
async function checkAndShowOnboarding(user){
  if(!user || !window.supabaseClient) return;
  try {
    var result = await window.supabaseClient.from('profiles').select('name').eq('id', user.id).maybeSingle();
    if(result.error) {
      console.error('Profile check error:', result.error);
      return;
    }
    if(!result.data || !result.data.name){
      showOnboarding(user);
    }
  } catch(err){
    console.error('Onboarding check error:', err);
  }
}

function showOnboarding(user){
  window._currentOnboardingUser = user;
  var overlay = document.getElementById('onboardingOverlay');
  if(!overlay) return;
  overlay.classList.add('active');
  setTimeout(function(){
    var inp = document.getElementById('onboardingName');
    if(inp) inp.focus();
  }, 200);
}

function hideOnboarding(){
  var overlay = document.getElementById('onboardingOverlay');
  if(overlay) overlay.classList.remove('active');
  window._currentOnboardingUser = null;
}

async function handleOnboardingSubmit(e){
  e.preventDefault();
  var user = window._currentOnboardingUser;
  if(!user || !window.supabaseClient) return;
  
  var nameEl = document.getElementById('onboardingName');
  var btn = document.getElementById('onboardingSubmitBtn');
  var errEl = document.getElementById('onboardingError');
  var name = nameEl.value.trim();
  
  if(!name){
    errEl.textContent = 'Please enter a name.';
    return;
  }
  
  btn.disabled = true;
  btn.textContent = 'Saving...';
  errEl.textContent = '';
  
  try {
    // The email rides along so the profiles table reads without a join to
    // auth. Older databases without the column still get the name.
    var result = await window.supabaseClient.from('profiles').upsert({ id: user.id, name: name, email: user.email || null }, { onConflict: 'id' });
    if(result.error && /email/i.test(String(result.error.message || ''))) result = await window.supabaseClient.from('profiles').upsert({ id: user.id, name: name }, { onConflict: 'id' });

    if(result.error) throw result.error;
    
    hideOnboarding();
    // Update header display with new name
    document.getElementById('authUserInitial').textContent = name.charAt(0).toUpperCase();
    document.getElementById('authUserName').textContent = name;
  } catch(err){
    console.error('Onboarding save error:', err);
    errEl.textContent = err.message || 'Could not save. Try again.';
    btn.disabled = false;
    btn.textContent = 'Continue';
  }
}
