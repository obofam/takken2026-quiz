'use strict';
// Shared header (3問チェック / 学習カルテ / account). Only the right end changes: ログイン or ログイン中.
// Pages that already know the login state call MimioboHeader.set(); the probe below is the fallback.
(function(){
  const el=document.getElementById('siteAuth');
  let decided=false;
  function paint(loggedIn){
    if(!el)return;
    el.textContent=loggedIn?'ログイン中':'ログイン';
    el.setAttribute('data-state',loggedIn?'in':'out');
    el.hidden=false;
  }
  function set(loggedIn){decided=true;paint(!!loggedIn);}
  window.MimioboHeader={set};
  if(!el)return;
  // account.html is where you log in: no right end there.
  if(/\/account(\.html)?$/.test(location.pathname)){el.hidden=true;return;}
  window.addEventListener('mimiobo:logout',()=>set(false));
  fetch('/api/session',{credentials:'same-origin',signal:AbortSignal.timeout(15000)})
    .then(r=>{if(!decided)paint(r.ok);})
    .catch(()=>{if(!decided)paint(false);});
})();
