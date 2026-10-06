'use strict';
(async()=>{
  let fragment=new URLSearchParams(location.hash.slice(1));
  const tokenHash=fragment.get('token_hash'),accessToken=fragment.get('access_token');
  // The default email template also supplies a refresh token. Never retain/use it.
  fragment=null;
  history.replaceState(null,'',location.pathname);
  let result='invalid_token';
  try{
    if(Boolean(tokenHash)!==Boolean(accessToken)){
      const response=await fetch('/api/email-verify',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(accessToken?{accessToken}:{tokenHash}),signal:AbortSignal.timeout(15000)});
      result=response.ok?'ok':'failed';
    }
  }catch{result='unavailable';}
  // account.html?next=karte left a note in this browser: go there after a successful email login. Otherwise the usual landing.
  let target='/ep10-preview.html?server=1&auth='+result;
  try{
    const next=JSON.parse(localStorage.getItem('mimiobo-next'));
    if(result==='ok'&&next&&next.page==='karte'&&next.expires>Date.now())target='/karte.html';
  }catch{}
  try{localStorage.removeItem('mimiobo-next');}catch{}
  location.replace(target);
})();
