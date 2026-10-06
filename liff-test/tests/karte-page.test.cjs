'use strict';
// karte.html: shows only what GET /api/session says. 401 = login guide, no ume = guide + test checkout, ume = body.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const html=read('karte.html');
const userId='12345678-1234-4123-8123-123456789abc';
const login={userId,storageKey:'mimiobo-test-v1-'+'a'.repeat(64),providers:['email']};
const withUme={...login,entitlements:[{plan:'ume',valid_until:'2027-10-17T14:59:59.000Z'}]};
function harness(search=''){
  const nodes=new Map(),requests=[],sleeps=[];
  const node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:['needLogin','noEntitlement','entitled','untilRow'].includes(id),disabled:false,textContent:'',onclick:null});return nodes.get(id);};
  const context=vm.createContext({URLSearchParams,AbortSignal,Intl,Date,Number,Object,Promise,JSON,Error,console,location:{search,href:'https://mimiobo-liff-test.vercel.app/karte.html'+search}});
  context.window=context;
  context.setTimeout=(fn,ms)=>{sleeps.push(ms);fn();};
  context.document={getElementById:node,createElement:()=>({}),head:{append(script){script.onload();}}};
  context.MimioboMessages={text:code=>code==='SESSION_INVALID'?'ログイン情報を確認できませんでした。もう一度ログインしてください。':'接続できませんでした。時間をおいてもう一度お試しください。'};
  const script=html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
  return {context,node,requests,sleeps,start:()=>vm.runInContext(script.replace(/initialize\(\);\s*$/,'')+';initialize()',context),sessions(list){let i=0;context.fetch=async(url,options={})=>{requests.push({url,options});const r=list[Math.min(i++,list.length-1)];return typeof r==='number'?{ok:false,status:r,json:async()=>({error:'x'})}:{ok:true,status:200,json:async()=>r};};}};
}
const visible=h=>['needLogin','noEntitlement','entitled'].filter(id=>!h.node(id).hidden);
test('logged out (401 or 403): only the login guide is shown',async()=>{
  for(const status of [401,403]){
    const h=harness();h.sessions([status]);await h.start();
    assert.deepEqual(visible(h),['needLogin']);assert.equal(h.requests[0].url,'/api/session');assert.equal(h.requests[0].options.credentials,'same-origin');
  }
});
test('logged in without a learning-karte entitlement: guide and test checkout, no body',async()=>{
  for(const body of [login,{...login,entitlements:[]},{...login,entitlements:[{plan:'take',valid_until:null}]},{...login,entitlements:'ume'}]){
    const h=harness();h.sessions([body]);await h.start();
    assert.deepEqual(visible(h),['noEntitlement']);
  }
});
test('entitled: the body is shown with the valid-until date in Japan time',async()=>{
  const h=harness();h.sessions([withUme]);await h.start();
  assert.deepEqual(visible(h),['entitled']);assert.equal(h.node('until').textContent,'2027年10月17日');assert.equal(h.node('untilRow').hidden,false);
  const open=harness();open.sessions([{...login,entitlements:[{plan:'ume',valid_until:null}]}]);await open.start();
  assert.deepEqual(visible(open),['entitled']);assert.equal(open.node('untilRow').hidden,true);
});
test('the page never opens from the URL alone: ?checkout=ok without an entitlement stays closed',async()=>{
  const h=harness('?checkout=ok&session_id=cs_test_x');h.sessions([login]);await h.start();
  assert.equal(visible(h).includes('entitled'),false);
});
test('back from Checkout: polls every 3 seconds, up to 5 times, then opens once the webhook has landed',async()=>{
  const h=harness('?checkout=ok&session_id=cs_test_x');h.sessions([login,login,withUme]);await h.start();
  assert.deepEqual(visible(h),['entitled']);assert.equal(h.requests.length,3);assert.deepEqual(h.sleeps,[3000,3000]);assert.equal(h.node('status').textContent,'');
});
test('back from Checkout: gives up after 5 re-reads with the approved message',async()=>{
  const h=harness('?checkout=ok&session_id=cs_test_x');h.sessions([login]);await h.start();
  assert.equal(h.requests.length,6);assert.deepEqual(h.sleeps,[3000,3000,3000,3000,3000]);
  assert.equal(h.node('status').textContent,'反映に少し時間がかかっています。しばらくしてからこのページを開き直してください。');
  assert.deepEqual(visible(h).includes('entitled'),false);
});
test('while waiting the status line shows the approved waiting text',async()=>{
  const h=harness('?checkout=ok');const seen=[];h.sessions([login]);
  h.context.setTimeout=(fn)=>{seen.push(h.node('status').textContent);fn();};
  await h.start();assert.equal(seen[0],'決済の反映を待っています…');
});
test('server errors show the shared safe message and open nothing',async()=>{
  const h=harness();h.sessions([503]);await h.start();
  assert.deepEqual(visible(h),[]);
  assert.equal(h.node('status').textContent,'接続できませんでした。時間をおいてもう一度お試しください。');
});
test('test checkout posts with the current user header and then navigates to the returned URL',async()=>{
  const h=harness();h.sessions([login]);await h.start();
  h.context.fetch=async(url,options)=>{h.requests.push({url,options});return {ok:true,status:200,json:async()=>({url:'https://checkout.stripe.com/c/pay/cs_test_abc'})};};
  await h.node('buy').onclick();
  const call=h.requests.at(-1);
  assert.equal(call.url,'/api/checkout');assert.equal(call.options.method,'POST');assert.equal(call.options.headers['X-Mimiobo-User'],userId);
  assert.equal(call.options.headers['Content-Type'],'application/json');assert.equal(call.options.body,'{}');
  assert.equal(h.context.location.href,'https://checkout.stripe.com/c/pay/cs_test_abc');
});
test('test checkout failure re-enables the button with a safe message; a stale session says to log in again',async()=>{
  for(const [status,text] of [[503,'接続できませんでした。時間をおいてもう一度お試しください。'],[401,'ログイン情報を確認できませんでした。もう一度ログインしてください。']]){
    const h=harness();h.sessions([login]);await h.start();
    h.context.fetch=async()=>({ok:false,status,json:async()=>({error:'payment_not_configured'})});
    await h.node('buy').onclick();
    assert.equal(h.node('buyMessage').textContent,text);assert.equal(h.node('buy').disabled,false);
    assert.equal(h.context.location.href.startsWith('https://checkout'),false);
  }
});
test('page structure: approved copy, links and shared CSS',()=>{
  const must=['<p class="label">学習カルテ</p>','耳で覚える宅建 <span class="muted">｜学習カルテ</span>','記録を見るにはログインが必要です','メールかLINEでログインすると、ここに記録が集まります。','href="ep10-preview.html#account">ログインする<','学習カルテは準備中です','記録をためて弱点を見る画面です。今はテスト中で、仕組みの確認だけをしています。','href="plans-preview.html#ume">学習カルテの案内を見る<','学習カルテを試す（テスト決済）','テスト用のカードでしか決済できません。実際の請求はありません。','この画面は Sprint 3 で記録から作ります。今は権利の確認だけです。','<span class="badge">テスト中</span>','href="ep10-preview.html">3問チェックに戻る<','有効期限：'];
  for(const text of must)assert.ok(html.includes(text),text);
  assert.equal((html.match(/<style>/g)||[]).length,(html.match(/<\/style>/g)||[]).length);
  const ep10=read('ep10-preview.html'),styles=s=>(s.match(/<style>[\s\S]*?<\/style>/g)||[]);
  // Shared CSS: every ep10 style block except the ep10-only button rule is reused verbatim.
  for(const block of styles(ep10).filter(b=>!b.includes('body.signin-visible #connectLine')))assert.ok(html.includes(block));
  assert.doesNotThrow(()=>new Function(html.match(/<script>\s*([\s\S]*?)<\/script>/)[1]));
  assert.doesNotMatch(html,/server=1/);
});
