'use strict';
(function(){
  const slot='mimiobo-link-ticket';
  function incoming(){return new URLSearchParams(location.hash.slice(1)).get('link');}
  function captureLink(){
    const token=incoming();
    if(token){
      history.replaceState(null,'',location.pathname+location.search);
      if(/^[0-9a-f]{64}$/.test(token))sessionStorage.setItem(slot,JSON.stringify({token,expires:Date.now()+600000}));
    }
  }
  function pending(){
    try{const value=JSON.parse(sessionStorage.getItem(slot));if(value&&value.expires>Date.now())return value.token;}catch{}
    sessionStorage.removeItem(slot);return undefined;
  }
  async function request(url,body,method='POST'){
    const response=await fetch(url,{method,credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
    const result=await response.json();if(!response.ok){const error=Error(result.error||'AUTH_UNAVAILABLE');error.status=response.status;throw error;}return result;
  }
  // Headless hooks for Claude's login/link controls. No tokens in localStorage.
  window.MimioboAuth={
    captureLink,
    hasPendingLink:()=>/^[0-9a-f]{64}$/.test(incoming()||'')||!!pending(),
    email:(email,{link=false}={})=>request('/api/email',{email,link}),
    async line(idToken){const result=await request('/api/session',{idToken,linkToken:pending()});sessionStorage.removeItem(slot);return result;},
    async linkLine(){
      const result=await request('/api/link',{provider:'line'});
      return 'https://liff.line.me/2011606963-hH0DzETc/ep10-preview.html?server=1#link='+result.linkToken;
    },
    async logout(){const result=await request('/api/session',{},'DELETE');sessionStorage.removeItem(slot);window.dispatchEvent(new Event('mimiobo:logout'));return result;}
  };
})();
