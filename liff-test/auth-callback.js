'use strict';
(async()=>{
  const tokenHash=new URLSearchParams(location.hash.slice(1)).get('token_hash');
  history.replaceState(null,'',location.pathname);
  let result='invalid_token';
  try{
    if(tokenHash){const response=await fetch('/api/email-verify',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({tokenHash}),signal:AbortSignal.timeout(15000)});result=response.ok?'ok':'failed';}
  }catch{result='unavailable';}
  location.replace('/ep10-preview.html?server=1&auth='+result);
})();
