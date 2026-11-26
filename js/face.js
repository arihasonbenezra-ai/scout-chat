
// Ezzy expression engine
(function(){
  var EXPRESSIONS = {
    smile: {
      eyes: '<circle cx="11" cy="14" r="1.8" fill="#000" id="ezzy-eye-l"><animate attributeName="opacity" values="1;1;1;0;0;1;1" keyTimes="0;0.7;0.78;0.82;0.86;0.92;1" dur="4s" repeatCount="indefinite"/></circle><path d="M 9.2 14 Q 11 12.5 12.8 14" fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round" opacity="0"><animate attributeName="opacity" values="0;0;0;1;1;0;0" keyTimes="0;0.7;0.78;0.82;0.86;0.92;1" dur="4s" repeatCount="indefinite"/></path><circle cx="21" cy="15" r="1.8" fill="#000" id="ezzy-eye-r"><animate attributeName="opacity" values="1;1;1;0;0;1;1" keyTimes="0;0.7;0.78;0.82;0.86;0.92;1" dur="4s" repeatCount="indefinite"/></circle><path d="M 19.2 15 Q 21 13.5 22.8 15" fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round" opacity="0"><animate attributeName="opacity" values="0;0;0;1;1;0;0" keyTimes="0;0.7;0.78;0.82;0.86;0.92;1" dur="4s" repeatCount="indefinite"/></path>',
      mouth: '<path d="M 12.5 21 Q 16 23.8 19.5 21" fill="none" stroke="#000" stroke-width="1.8" stroke-linecap="round" opacity="1"><animate attributeName="opacity" values="1;1;1;0.3;0.3;1;1" keyTimes="0;0.7;0.78;0.82;0.86;0.92;1" dur="4s" repeatCount="indefinite"/></path>'
    }
  };

  var ezzyEl = document.getElementById('ezzy-header');
  var currentExpression = 'smile';

  function setEzzyExpression(name){
    if(!ezzyEl || !EXPRESSIONS[name]) return;
    var expr = EXPRESSIONS[name];
    // Always preserve the coral circle, swap eyes + mouth
    ezzyEl.innerHTML = '<circle cx="16" cy="16" r="14" fill="#F26B5E"/>' + expr.eyes + expr.mouth;
    currentExpression = name;
  }

  // Initialize
  if(ezzyEl){
    setEzzyExpression('smile');
  }

  // Expose for later pieces
  window.setEzzyExpression = setEzzyExpression;
})();
