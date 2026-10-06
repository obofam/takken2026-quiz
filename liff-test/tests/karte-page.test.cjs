'use strict';
// karte.html: shows only what GET /api/session says. 401 = login guide, no ume = guide + test checkout, ume = the karte built from GET /api/karte.
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
  const nodes=new Map(),requests=[],sleeps=[];let karteReply={rows:[]};
  const node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:['needLogin','noEntitlement','entitled','untilRow'].includes(id),disabled:false,textContent:'',innerHTML:'',onclick:null});return nodes.get(id);};
  const context=vm.createContext({URLSearchParams,AbortSignal,Intl,Date,Number,Object,Promise,JSON,Error,console,location:{search,href:'https://mimiobo-liff-test.vercel.app/karte.html'+search}});
  context.window=context;
  context.setTimeout=(fn,ms)=>{sleeps.push(ms);fn();};
  context.document={getElementById:node,createElement:()=>({}),head:{append(script){script.onload();}}};
  context.MimioboMessages={text:code=>code==='SESSION_INVALID'?'ログイン情報を確認できませんでした。もう一度ログインしてください。':'接続できませんでした。時間をおいてもう一度お試しください。'};
  for(const file of ['quiz-catalog.js','karte-core.js'])vm.runInContext(read(file),context);
  const script=html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
  const reply=(r,fallback)=>typeof r==='number'?{ok:false,status:r,json:async()=>({error:'x'})}:{ok:true,status:200,json:async()=>r??fallback};
  return {context,node,requests,sleeps,start:()=>vm.runInContext(script.replace(/initialize\(\);\s*$/,'')+';initialize()',context),
    sessionCalls:()=>requests.filter(r=>r.url==='/api/session'),karteCalls:()=>requests.filter(r=>r.url==='/api/karte'),
    karte(r){karteReply=r;},
    sessions(list){let i=0;context.fetch=async(url,options={})=>{requests.push({url,options});if(url==='/api/karte')return typeof karteReply==='function'?karteReply():reply(karteReply);return reply(list[Math.min(i++,list.length-1)]);};}};
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
  assert.deepEqual(visible(h),['entitled']);assert.equal(h.sessionCalls().length,3);assert.deepEqual(h.sleeps,[3000,3000]);assert.equal(h.node('status').textContent,'');
});
test('back from Checkout: gives up after 5 re-reads with the approved message',async()=>{
  const h=harness('?checkout=ok&session_id=cs_test_x');h.sessions([login]);await h.start();
  assert.equal(h.sessionCalls().length,6);assert.deepEqual(h.sleeps,[3000,3000,3000,3000,3000]);
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
  const must=['<p class="label">学習カルテ</p>','耳で覚える宅建 <span class="muted">｜学習カルテ</span>','記録を見るにはログインが必要です','メールかLINEでログインすると、ここに記録が集まります。','href="ep10-preview.html#account">ログインする<','学習カルテは準備中です','記録をためて弱点を見る画面です。今はテスト中で、仕組みの確認だけをしています。','href="plans-preview.html#ume">学習カルテの案内を見る<','学習カルテを試す（テスト決済）','テスト用のカードでしか決済できません。実際の請求はありません。','<span class="badge">テスト中</span>','有効期限：','記録を読み込んでいます…','分野別の正答率','復習する論点','正答率の低い順。放送に戻れます。','今の記録では、復習する論点はありません。','記録は回答した時点のものです。同じ問題への再挑戦も数えます。','まだ記録がありません。','3問チェックを始める','を聴く','問題を解き直す'];
  for(const text of must)assert.ok(html.includes(text),text);
  assert.equal((html.match(/<style>/g)||[]).length,(html.match(/<\/style>/g)||[]).length);
  const ep10=read('ep10-preview.html'),styles=s=>(s.match(/<style>[\s\S]*?<\/style>/g)||[]);
  // Shared CSS: every ep10 style block except the ep10-only button rule is reused verbatim.
  for(const block of styles(ep10).filter(b=>!b.includes('body.signin-visible #connectLine')&&!b.includes('mobile-scale')))assert.ok(html.includes(block));
  assert.doesNotThrow(()=>new Function(html.match(/<script>\s*([\s\S]*?)<\/script>/)[1]));
  assert.doesNotMatch(html,/server=1/);
  // The placeholder body from Sprint 2 is gone; no arrow glyphs; scripts load the shared catalog and core.
  for(const gone of ['Sprint 3','権利の確認だけ','3問チェックに戻る'])assert.ok(!html.includes(gone),gone);
  assert.doesNotMatch(html,/[→↗↘←]/);
  assert.ok(html.includes('<script src="/quiz-catalog.js"></script>')&&html.includes('<script src="/karte-core.js"></script>'));
  // Same parts and colours as the plans-preview sample; the lime success colour is not used for the bars.
  for(const cls of ['.rp-stats','.rp-stat','.subject-results','.subject-row','.subject-bar','.rp-weak-item','.rp-weak-main','.rp-weak-tag','.rp-weak-count','.rp-weak-link'])assert.ok(html.includes(cls+'{')||html.includes(cls+' '),cls);
  assert.match(html,/\.subject-bar i\{[^}]*background:var\(--cyan\)/);
});


// ---- Sprint 3: the karte body, built from GET /api/karte ----
const stand='https://stand.fm/episodes/69dc7ba498eff95c436a4549';
const answerRows=[
  {quiz_id:'ep10',question_id:'ep10-money',value:true,answered_at:'2026-10-01T00:00:00.000Z',attempt_id:'a1'},
  {quiz_id:'ep10',question_id:'ep10-join',value:true,answered_at:'2026-10-01T00:00:01.000Z',attempt_id:'a1'},
  {quiz_id:'ep10',question_id:'ep10-add',value:null,answered_at:'2026-10-01T00:00:02.000Z',attempt_id:'a1'},
  {quiz_id:'ep10',question_id:'ep10-join',value:false,answered_at:'2026-10-02T00:00:00.000Z',attempt_id:'a2'}
];
test('entitled: stats, subject rates and the review list are drawn from the server rows',async()=>{
  const h=harness();h.sessions([withUme]);h.karte({rows:answerRows});await h.start();
  assert.deepEqual(visible(h),['entitled']);
  const call=h.karteCalls();assert.equal(call.length,1);
  assert.equal(call[0].options.credentials,'same-origin');assert.equal(call[0].options.headers['X-Mimiobo-User'],userId);
  const body=h.node('karteBody').innerHTML;
  assert.equal(h.node('karteStatus').textContent,'');
  // 4 answers, 1 broadcast, 1 topic to review (ep10-add: still unsure); join was wrong first, right later.
  assert.ok(body.includes('<b>1回</b><span>放送</span>'));assert.ok(body.includes('<b>4問</b><span>回答</span>'));assert.ok(body.includes('<b>1つ</b><span>復習する論点</span>'));
  assert.ok(body.includes('分野別の正答率'));assert.ok(body.includes('<span>宅建業法</span><b>2 / 4問</b>'));assert.ok(body.includes('style="width:50%"'));
  assert.ok(!body.includes('<span>権利関係</span>'));
  assert.ok(body.includes('復習する論点</h2>'));assert.ok(body.includes('正答率の低い順。放送に戻れます。'));
  assert.ok(body.includes('<b>事務所増設時の納付期限</b><span class="rp-weak-tag">宅建業法・第10回</span>'));assert.ok(body.includes('0 / 1問'));
  assert.ok(!body.includes('営業保証金の金額</b>'));
  assert.ok(body.includes('href="'+stand+'" target="_blank" rel="noopener noreferrer">放送 #10 を聴く</a>'));assert.ok(body.includes('href="ep10-preview.html">問題を解き直す</a>'));
  assert.ok(body.includes('記録は回答した時点のものです。同じ問題への再挑戦も数えます。'));
  assert.doesNotMatch(body,/[→↗]/);
});
test('entitled with nothing to review: says so, still shows the tiles and the note',async()=>{
  const h=harness();h.sessions([withUme]);h.karte({rows:[answerRows[0]]});await h.start();
  const body=h.node('karteBody').innerHTML;
  assert.ok(body.includes('<b>0つ</b><span>復習する論点</span>'));assert.ok(body.includes('今の記録では、復習する論点はありません。'));
  assert.ok(!body.includes('rp-weak-item'));assert.ok(body.includes('記録は回答した時点のものです。'));
});
test('entitled with no records: empty message and the start button, no tiles',async()=>{
  const h=harness();h.sessions([withUme]);h.karte({rows:[]});await h.start();
  const body=h.node('karteBody').innerHTML;
  assert.ok(body.includes('まだ記録がありません。'));assert.ok(body.includes('href="ep10-preview.html">3問チェックを始める</a>'));
  for(const gone of ['rp-stats','分野別の正答率','復習する論点','記録は回答した時点のものです。'])assert.ok(!body.includes(gone),gone);
  assert.deepEqual(visible(h),['entitled']);
});
test('rows outside the catalog are not drawn',async()=>{
  const h=harness();h.sessions([withUme]);h.karte({rows:[{quiz_id:'ep99',question_id:'x',value:true,answered_at:'2026-10-01T00:00:00.000Z',attempt_id:'z'}]});await h.start();
  assert.ok(h.node('karteBody').innerHTML.includes('まだ記録がありません。'));
});
test('while loading the status line says so; the body is empty until the rows arrive',async()=>{
  const h=harness();h.sessions([withUme]);const seen=[];
  h.karte(()=>{seen.push([h.node('karteStatus').textContent,h.node('karteBody').innerHTML]);return {ok:true,status:200,json:async()=>({rows:answerRows})};});
  await h.start();
  assert.deepEqual(seen,[['記録を読み込んでいます…','']]);assert.equal(h.node('karteStatus').textContent,'');
});
test('/api/karte 403 switches to the no-entitlement screen; 401 to the login guide',async()=>{
  for(const [status,shown] of [[403,'noEntitlement'],[401,'needLogin']]){
    const h=harness();h.sessions([withUme]);h.karte(status);await h.start();
    assert.deepEqual(visible(h),[shown]);assert.equal(h.node('karteBody').innerHTML,'');assert.equal(h.node('karteStatus').textContent,'');
  }
});
test('/api/karte failure shows the shared service_unavailable message and draws no records',async()=>{
  for(const failure of [503,500,()=>{throw Error('network');}]){
    const h=harness();h.sessions([withUme]);h.karte(failure);await h.start();
    assert.equal(h.node('karteStatus').textContent,'接続できませんでした。時間をおいてもう一度お試しください。');assert.equal(h.node('karteBody').innerHTML,'');
  }
});
test('no records are requested without an entitlement or a login',async()=>{
  for(const session of [login,401]){const h=harness();h.sessions([session]);await h.start();assert.equal(h.karteCalls().length,0);}
});
