
(function(){
  // Supabase config - REPLACE WITH YOUR VALUES
  var SUPABASE_URL = 'https://peksgdlfrnymkzlrbsgi.supabase.co';
  var SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_rVG6LNvp6Uzs7F6CxSgJlA_zVobq1hy';
  
  if(SUPABASE_URL.indexOf('YOUR_') === 0 || SUPABASE_PUBLISHABLE_KEY.indexOf('YOUR_') === 0){
    console.warn('Supabase not configured yet - replace placeholders in index.html');
    return;
  }
  
  window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  console.log('Supabase initialized');
})();
