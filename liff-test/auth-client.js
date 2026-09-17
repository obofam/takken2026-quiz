'use strict';
(function(){
  const slot='mimiobo-link-ticket';
  const valid=token=>typeof token==='string'&&/^[0-9a-f]{64}$/.test(token);
  function incoming(){return new URLSearchParams(location.hash.slice(1)).has('link')||new URLSearchParams(location.search).has('link');}
  function captureLink({clean=true}={}){
    if(!incoming())return;
    const query=new URLSearchParams(location.search),fragment=new URLSearchParams(location.hash.slice(1));
    const tokens=[...query.getAll('link'),...fragment.getAll('link')];
    const expires=query.has('link_expires')?Number(query.get('link_expires')):Date.now()+600000;
    const value=tokens.length===1&&valid(tokens[0])&&Number.isFinite(expires)&&expires>Date.now()
      ?{token:tokens[0],expires:Math.min(expires,Date.now()+600000)}:{invalid:true};
    // Persist before removing credentials or allowing the SDK to navigate.
    sessionStorage.setItem(slot,JSON.stringify(value));
    if(!clean)return;
    query.delete('link');query.delete('link_expires');fragment.delete('link');
    history.replaceState(null,'',location.pathname+(query.size?'?'+query:'')+(fragment.size?'#'+fragment:''));
  }
  function pending(){
    const stored=sessionStorage.getItem(slot);if(stored===null)return undefined;
    try{const value=JSON.parse(stored);if(valid(value?.token)&&value.expires>Date.now())return value;}catch{}
    // A failed/expired link must never fall back to creating a separate account.
    throw Error('invalid_link');
  }
  async function request(url,body,method='POST'){
    const response=await fetch(url,{method,credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
    const result=await response.json();if(!response.ok){const error=Error(result.error||'AUTH_UNAVAILABLE');error.status=response.status;throw error;}return result;
  }
  // Headless hooks for Claude's login/link controls. No tokens in localStorage.
  window.MimioboAuth={
    captureLink,
    hasPendingLink:()=>incoming()||sessionStorage.getItem(slot)!==null,
    lineRedirectUri(base){
      const value=pending();
      return value?base+(base.includes('?')?'&':'?')+'link='+value.token+'&link_expires='+value.expires:base;
    },
    email:(email,{link=false}={})=>request('/api/email',{email,link}),
    async line(idToken){const result=await request('/api/session',{idToken,linkToken:pending()?.token});sessionStorage.removeItem(slot);return result;},
    async linkLine(){
      const result=await request('/api/link',{provider:'line'});
      if(!valid(result.linkToken))throw Error('invalid_link');
      sessionStorage.setItem(slot,JSON.stringify({token:result.linkToken,expires:Date.now()+600000}));
      return 'https://liff.line.me/2011606963-hH0DzETc/ep10-preview.html?server=1#link='+result.linkToken;
    },
    async logout(){const result=await request('/api/session',{},'DELETE');sessionStorage.removeItem(slot);window.dispatchEvent(new Event('mimiobo:logout'));return result;}
  };
})();
