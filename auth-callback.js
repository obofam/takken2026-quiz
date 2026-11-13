'use strict';
// メールのログインの戻り先。リンクの中の確認用の値をサーバーに渡し、成功なら学習ロードマップへ、失敗なら /login?auth=<結果> へ。
(async()=>{
  let fragment=new URLSearchParams(location.hash.slice(1));
  const tokenHash=fragment.get('token_hash'),accessToken=fragment.get('access_token');
  // 既定のメール文面には refresh token も入っている。保持も使用もしない。
  fragment=null;
  history.replaceState(null,'',location.pathname);
  let result='invalid_token';
  try{
    if(Boolean(tokenHash)!==Boolean(accessToken)){
      const response=await fetch('/api/email-verify',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(accessToken?{accessToken}:{tokenHash}),signal:AbortSignal.timeout(15000)});
      result=response.ok?'ok':'failed';
    }
  }catch{result='unavailable';}
  // ログインできたら、このブラウザに印を残す（記録の同期が、ログインしていない人に問い合わせないための印。中身は入れない）
  try{if(result==='ok')localStorage.setItem('takken2027-login-hint','1');}catch{}
  location.replace(result==='ok'?'/roadmap':'/login?auth='+encodeURIComponent(result));
})();
