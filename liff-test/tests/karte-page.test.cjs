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
  const nodes=new Map(),requests=[],sleeps=[],handlers={},values=new Map();let karteReply={rows:[]};
  const localStorage={getItem:k=>values.has(k)?values.get(k):null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k),key:i=>[...values.keys()][i]??null,get length(){return values.size;}};
  const node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:['needLogin','noEntitlement','entitled','untilRow'].includes(id),disabled:false,textContent:'',innerHTML:'',onclick:null});return nodes.get(id);};
  const context=vm.createContext({URLSearchParams,AbortSignal,Intl,Date,Number,Object,Promise,JSON,Error,console,location:{search,href:'https://mimiobo-liff-test.vercel.app/karte.html'+search},localStorage});
  context.addEventListener=(type,fn)=>{handlers[type]=fn;};
  context.window=context;
  context.setTimeout=(fn,ms)=>{sleeps.push(ms);fn();};
  context.document={getElementById:node,createElement:()=>({}),head:{append(script){script.onload();}}};
  context.MimioboMessages={text:code=>code==='SESSION_INVALID'?'ログイン情報を確認できませんでした。もう一度ログインしてください。':'接続できませんでした。時間をおいてもう一度お試しください。'};
  for(const file of ['quiz-catalog.js','karte-core.js'])vm.runInContext(read(file),context);
  const script=html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
  const reply=(r,fallback)=>typeof r==='number'?{ok:false,status:r,json:async()=>({error:'x'})}:{ok:true,status:200,json:async()=>r??fallback};
  return {context,node,requests,sleeps,values,handlers,start:()=>vm.runInContext(script.replace(/initialize\(\);\s*$/,'')+';initialize()',context),
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
  for(const body of [login,{...login,entitlements:[]},{...login,entitlements:'ume'}]){
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
  const must=['<h1>学習カルテ</h1>','ログインすると、答えた記録がここに集まります。','href="account.html?next=karte">ログイン<','学習カルテは準備中です','記録をためて弱点を見る画面です。今はテスト中で、仕組みの確認だけをしています。','href="plans-preview.html#ume">学習カルテの案内を見る<','学習カルテを試す（テスト決済）','テスト用のカードでしか決済できません。実際の請求はありません。','有効期限：','記録を読み込んでいます…','分野別の正答率','復習する論点','正答率の低い順です。','今の記録では、復習する論点はありません。','記録は回答した時点のものです。同じ問題への再挑戦も数えます。','まだ記録がありません。','3問チェックを始める','放送を聴く','解き直す'];
  for(const text of must)assert.ok(html.includes(text),text);
  assert.equal((html.match(/<style>/g)||[]).length,(html.match(/<\/style>/g)||[]).length);
  const ep10=read('ep10-preview.html'),styles=s=>(s.match(/<style>[\s\S]*?<\/style>/g)||[]);
  // Shared CSS: every ep10 style block except the ep10-only button rule is reused verbatim.
  for(const block of styles(ep10).filter(b=>!b.includes('body.signin-visible #connectLine')&&!b.includes('mobile-scale')&&!b.includes('ep10-only')))assert.ok(html.includes(block));
  assert.doesNotThrow(()=>new Function(html.match(/<script>\s*([\s\S]*?)<\/script>/)[1]));
  assert.doesNotMatch(html,/server=1/);
  // The placeholder body from Sprint 2 is gone; no arrow glyphs; scripts load the shared catalog and core.
  for(const gone of ['Sprint 3','権利の確認だけ','3問チェックに戻る','記録を見るにはログインが必要です','ep10-preview.html#account','badge">テスト中'])assert.ok(!html.includes(gone),gone);
  assert.doesNotMatch(html,/[→↗↘←]/);
  assert.ok(html.includes('<script src="/quiz-catalog.js"></script>')&&html.includes('<script src="/karte-core.js"></script>'));
  // Same parts and colours as the plans-preview sample; the lime success colour is not used for the bars.
  for(const cls of ['.karte-summary','.karte-card','.subject-row','.subject-bar','.rp-weak-item','.rp-weak-name','.rp-weak-meta','.rp-weak-links','.rp-weak-link'])assert.ok(html.includes(cls+'{')||html.includes(cls+' '),cls);
  assert.match(html,/\.rp-weak-item\{display:flex;flex-direction:column/);
  assert.match(html,/\.subject-bar i\{[^}]*background:var\(--cyan\)/);
  assert.match(html,/\.subject-bar\{[^}]*height:8px/);
  // The two cards: white, 16px corners, 1px border, thin shadow, 18px padding; h2 is 20px/900 with a 4px cyan rounded bar.
  assert.match(html,/\.karte-card\{background:#fff;border:1px solid var\(--line\);border-radius:16px;box-shadow:[^;]+;padding:18px/);
  assert.match(html,/\.karte-card h2\{[^}]*font-size:20px;font-weight:900/);
  assert.match(html,/\.karte-card h2::before\{[^}]*width:4px;border-radius:999px;background:#17C5E8/);
  assert.match(html,/\.rp-weak-link\{[^}]*min-height:36px[^}]*font-size:13px/);
  assert.match(html,/\.karte-note\{font-size:12px/);
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
  assert.ok(body.includes('<p id="karteSummary" class="karte-summary">放送 <b>1</b>回 ・ 回答 <b>4</b>問 ・ 復習 <b>1</b>つ</p>'));
  assert.ok(body.includes('分野別の正答率'));assert.ok(body.includes('<span>宅建業法</span><b>2 / 4問</b>'));assert.ok(body.includes('style="width:50%"'));
  assert.ok(!body.includes('<span>権利関係</span>'));
  assert.ok(body.includes('<h2>復習する論点</h2><p class="karte-card-help">正答率の低い順です。</p>'));assert.ok(!body.includes('放送に戻れます'));
  assert.ok(body.includes('<b class="rp-weak-name">事務所増設時の納付期限</b><p class="rp-weak-meta">宅建業法・第10回 ｜ 1問中0問正解</p>'));
  assert.ok(!body.includes('営業保証金の金額</b>'));
  assert.ok(body.includes('href="'+stand+'" target="_blank" rel="noopener noreferrer">放送を聴く</a>'));assert.ok(body.includes('href="ep10-preview.html?ep=10">解き直す</a>'));
  assert.ok(!body.includes('問題を解き直す')&&!body.includes('放送 #'));
  assert.ok(body.includes('記録は回答した時点のものです。同じ問題への再挑戦も数えます。'));
  assert.doesNotMatch(body,/[→↗]/);
});
test('entitled with nothing to review: says so, still shows the summary line, both cards and the note',async()=>{
  const h=harness();h.sessions([withUme]);h.karte({rows:[answerRows[0]]});await h.start();
  const body=h.node('karteBody').innerHTML;
  assert.ok(body.includes('復習 <b>0</b>つ'));assert.ok(body.includes('今の記録では、復習する論点はありません。'));assert.ok(body.includes('<h2>分野別の正答率</h2>'));
  assert.ok(!body.includes('rp-weak-item'));assert.ok(body.includes('記録は回答した時点のものです。'));
});
test('entitled with no records: empty message and the start button, no summary or cards',async()=>{
  const h=harness();h.sessions([withUme]);h.karte({rows:[]});await h.start();
  const body=h.node('karteBody').innerHTML;
  assert.ok(body.includes('まだ記録がありません。'));assert.ok(body.includes('href="ep10-preview.html">3問チェックを始める</a>'));
  for(const gone of ['karte-summary','karte-card','分野別の正答率','復習する論点','記録は回答した時点のものです。'])assert.ok(!body.includes(gone),gone);
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


// ---- 端末の前回分で即表示し、裏で最新に差し替える ----
const CP='mimiobo-karte-cache-v1:',LAST='mimiobo-karte-last-user';
const day=24*60*60*1000;
const cacheRows=[{quiz_id:'ep10',question_id:'ep10-add',value:null,answered_at:'2026-09-01T00:00:00.000Z',attempt_id:'c1'}];
function seed(h,over={},id=userId){
  h.values.set(CP+id,JSON.stringify({savedAt:Date.now()-day,validUntil:'2027-10-17T14:59:59.000Z',rows:cacheRows,...over}));
  h.values.set(LAST,id);
}
const cached=h=>h.node('karteBody').innerHTML.includes('回答 <b>1</b>問');
test('with a cache: the karte is drawn and the status shown before the server answers',async()=>{
  const h=harness();seed(h);let atSession,atKarte;
  h.sessions([withUme]);const inner=h.context.fetch;
  h.context.fetch=async(url,o)=>{
    const snap={vis:visible(h),body:cached(h),status:h.node('karteStatus').textContent,until:h.node('until').textContent};
    if(url==='/api/session')atSession=snap;else atKarte=snap;
    return inner(url,o);
  };
  h.karte({rows:answerRows});await h.start();
  assert.deepEqual(atSession.vis,['entitled']);assert.equal(atSession.body,true);assert.equal(atSession.status,'前回の記録を表示しています。');assert.equal(atSession.until,'2027年10月17日');
  // The reload does not blank the cached screen first.
  assert.equal(atKarte.body,true);assert.equal(atKarte.status,'前回の記録を表示しています。');
});
test('after the server answers: replaced by the latest rows and the status is emptied',async()=>{
  const h=harness();seed(h);h.sessions([withUme]);h.karte({rows:answerRows});await h.start();
  const body=h.node('karteBody').innerHTML;
  assert.ok(body.includes('回答 <b>4</b>問'));assert.equal(cached(h),false);
  assert.equal(h.node('karteStatus').textContent,'');assert.deepEqual(visible(h),['entitled']);
  assert.equal(h.karteCalls().length,1);
});
test('a failed refresh keeps the previous records on screen',async()=>{
  const h=harness();seed(h);h.sessions([withUme]);h.karte(503);await h.start();
  assert.equal(cached(h),true);assert.deepEqual(visible(h),['entitled']);
});
test('the server decides: logged out, no entitlement, or another user drops the cached screen and the cache',async()=>{
  const other={...withUme,userId:'99999999-1234-4123-8123-123456789abc'};
  for(const [session,shown] of [[401,'needLogin'],[403,'needLogin'],[login,'noEntitlement'],[{...login,entitlements:[]},'noEntitlement'],[other,'entitled']]){
    const h=harness();seed(h);h.sessions([session]);h.karte({rows:answerRows});
    await h.start();
    assert.deepEqual(visible(h),[shown],JSON.stringify(session));
    assert.equal(cached(h),false);assert.equal(h.values.has(CP+userId),false);
    if(shown==='entitled'){assert.ok(h.node('karteBody').innerHTML.includes('回答 <b>4</b>問'));assert.equal(h.values.has(CP+other.userId),true);assert.equal(h.values.get(LAST),other.userId);}
    else{assert.equal(h.values.has(LAST),false);assert.equal(h.karteCalls().length,0);assert.equal(h.node('karteBody').innerHTML,'');assert.equal(h.node('karteStatus').textContent,'');}
  }
});
test('/api/karte 401/403 after a cached paint clears the cache and the screen',async()=>{
  for(const [status,shown] of [[403,'noEntitlement'],[401,'needLogin']]){
    const h=harness();seed(h);h.sessions([withUme]);h.karte(status);await h.start();
    assert.deepEqual(visible(h),[shown]);assert.equal(h.node('karteBody').innerHTML,'');assert.equal(h.values.has(CP+userId),false);assert.equal(h.values.has(LAST),false);
  }
});
test('an expired entitlement or a cache older than 14 days is not used',async()=>{
  const cases=[{validUntil:'2026-01-01T00:00:00.000Z'},{savedAt:Date.now()-15*day},{savedAt:'x'},{rows:'x'}];
  for(const over of cases){
    const h=harness();seed(h,over);let first;
    h.sessions([withUme]);const inner=h.context.fetch;
    h.context.fetch=async(url,o)=>{first??={vis:visible(h),body:cached(h)};return inner(url,o);};
    h.karte({rows:answerRows});await h.start();
    assert.deepEqual(first,{vis:[],body:false},JSON.stringify(over));
    assert.ok(h.node('karteBody').innerHTML.includes('回答 <b>4</b>問'));
  }
  const fresh=harness();seed(fresh,{savedAt:Date.now()-13*day,validUntil:null});let seen;
  fresh.sessions([withUme]);const inner=fresh.context.fetch;fresh.context.fetch=async(u,o)=>{seen??=cached(fresh);return inner(u,o);};
  fresh.karte({rows:answerRows});await fresh.start();assert.equal(seen,true);
});
test('a cache of another user is not drawn unless it is the last logged-in user',async()=>{
  const h=harness();seed(h,{},'99999999-1234-4123-8123-123456789abc');h.values.set(LAST,userId);let first;
  h.sessions([withUme]);const inner=h.context.fetch;h.context.fetch=async(u,o)=>{first??=cached(h);return inner(u,o);};
  h.karte({rows:answerRows});await h.start();assert.equal(first,false);
});
test('a successful draw saves the rows, the dates and the last user',async()=>{
  const h=harness();h.sessions([withUme]);h.karte({rows:answerRows});await h.start();
  const saved=JSON.parse(h.values.get(CP+userId));
  assert.deepEqual(saved.rows,answerRows);assert.equal(saved.validUntil,'2027-10-17T14:59:59.000Z');assert.ok(Math.abs(saved.savedAt-Date.now())<60000);
  assert.equal(h.values.get(LAST),userId);
  // Nothing is saved when the draw fails, or when there is no entitlement.
  for(const [session,karteReply] of [[withUme,503],[login,{rows:answerRows}],[401,{rows:answerRows}]]){
    const g=harness();g.sessions([session]);g.karte(karteReply);await g.start();assert.equal(g.values.size,0);
  }
});
test('a storage failure is ignored',async()=>{
  const h=harness();h.context.localStorage.setItem=()=>{throw Error('quota');};
  h.sessions([withUme]);h.karte({rows:answerRows});await h.start();
  assert.deepEqual(visible(h),['entitled']);assert.ok(h.node('karteBody').innerHTML.includes('回答 <b>4</b>問'));assert.equal(h.node('karteStatus').textContent,'');
});
test('logout removes every karte cache and the last user, and drops the screen',async()=>{
  const h=harness();seed(h);seed(h,{},'99999999-1234-4123-8123-123456789abc');h.values.set('other-key','keep');
  h.sessions([withUme]);h.karte({rows:answerRows});await h.start();
  h.handlers['mimiobo:logout']();
  assert.deepEqual([...h.values.keys()],['other-key']);assert.equal(h.node('karteBody').innerHTML,'');assert.deepEqual(visible(h),['needLogin']);
});
test('?checkout=ok and a cache: the re-read flow is unchanged',async()=>{
  const h=harness('?checkout=ok&session_id=cs_test_x');seed(h);h.sessions([withUme]);h.karte({rows:answerRows});await h.start();
  assert.deepEqual(visible(h),['entitled']);assert.equal(h.sessionCalls().length,1);assert.equal(h.node('karteStatus').textContent,'');
});
test('account.html and ep10-preview.html logout buttons also clear the karte caches',()=>{
  for(const name of ['account.html','ep10-preview.html']){
    const src=read(name),line=src.split('\n').find(l=>l.includes("$('accountLogout').onclick"));
    assert.ok(line&&line.includes("mimiobo-karte-last-user")&&line.includes("mimiobo-karte-cache-v1:")&&line.indexOf('removeItem(k)')<line.indexOf('MimioboAuth.logout'),name);
    const values=new Map([['mimiobo-karte-cache-v1:a','1'],['mimiobo-karte-cache-v1:b','2'],['mimiobo-karte-last-user','a'],['keep','3']]);
    const localStorage={removeItem:k=>values.delete(k),key:i=>[...values.keys()][i]??null,get length(){return values.size;}};
    const clear=line.match(/\{(try\{localStorage[\s\S]*?catch\{\})/)[1];
    vm.runInNewContext(clear,{localStorage});
    assert.deepEqual([...values.keys()],['keep'],name);
  }
});


// ---- 10/6 カードの組み直し：主役は「復習する論点」「分野別の正答率」 ----
test('karte body: the summary is one small line, and no stat tiles are drawn',async()=>{
  const h=harness();h.sessions([withUme]);h.karte({rows:answerRows});await h.start();
  // ume only: the one-line navi guide sits above the summary (Sprint 5); the summary still comes first after it.
  const body=h.node('karteBody').innerHTML.replace(/^<p class="navi-teaser">[\s\S]*?<\/p>/,'');
  assert.ok(!body.includes('rp-stat'));assert.ok(!body.includes('<span>放送</span>'));
  assert.equal((body.match(/id="karteSummary"/g)||[]).length,1);
  // the summary comes first, before both cards; only the numbers are bold
  assert.ok(body.startsWith('<p id="karteSummary"'));
  const line=body.match(/<p id="karteSummary"[^>]*>([\s\S]*?)<\/p>/)[1];
  assert.equal(line.replace(/<\/?b>/g,''),'放送 1回 ・ 回答 4問 ・ 復習 1つ');assert.equal((line.match(/<b>/g)||[]).length,3);
  assert.match(html,/\.karte-summary\{font-size:14px[^}]*color:var\(--muted\)/);
});
test('karte body: two cards, h2 in the order 復習する論点 then 分野別の正答率',async()=>{
  const h=harness();h.sessions([withUme]);h.karte({rows:answerRows});await h.start();
  const body=h.node('karteBody').innerHTML;
  const cards=[...body.matchAll(/<section class="karte-card">([\s\S]*?)<\/section>/g)].map(m=>m[1]);
  assert.equal(cards.length,2);
  assert.deepEqual(cards.map(c=>c.match(/^<h2>([^<]+)<\/h2>/)[1]),['復習する論点','分野別の正答率']);
  assert.deepEqual([...body.matchAll(/<h2>([^<]+)<\/h2>/g)].map(m=>m[1]),['復習する論点','分野別の正答率']);
  assert.ok(cards[1].includes('subject-bar')&&!cards[1].includes('rp-weak-item'));
  // the note stays last, outside the cards
  assert.ok(body.trimEnd().endsWith('<p class="karte-note">記録は回答した時点のものです。同じ問題への再挑戦も数えます。</p>'));
  // the entitled area itself is not a second box around the cards
  assert.match(html,/#entitled\.card\{background:transparent;border:0;box-shadow:none;padding:0/);
});
test('karte body: each review topic is three stacked rows (name, description, two pill buttons)',async()=>{
  const h=harness();h.sessions([withUme]);h.karte({rows:answerRows});await h.start();
  const body=h.node('karteBody').innerHTML;
  const items=[...body.matchAll(/<div class="rp-weak-item">([\s\S]*?)<\/div><\/div>/g)].map(m=>m[1]);
  assert.equal(items.length,1);
  const [, name, meta, links]=items[0].match(/^<b class="rp-weak-name">([^<]+)<\/b><p class="rp-weak-meta">([^<]+)<\/p><div class="rp-weak-links">([\s\S]*)$/);
  assert.equal(name,'事務所増設時の納付期限');assert.equal(meta,'宅建業法・第10回 ｜ 1問中0問正解');
  const anchors=[...links.matchAll(/<a class="rp-weak-link"([^>]*)>([^<]+)<\/a>/g)];
  assert.deepEqual(anchors.map(a=>a[2]),['放送を聴く','解き直す']);
  assert.ok(anchors[0][1].includes('href="'+stand+'"')&&anchors[0][1].includes('target="_blank"')&&anchors[0][1].includes('rel="noopener noreferrer"'));
  assert.ok(anchors[1][1].includes('href="ep10-preview.html?ep=10"')&&!anchors[1][1].includes('target='));
  assert.match(html,/\.rp-weak-item\{display:flex;flex-direction:column/);
  assert.doesNotMatch(body,/[→↗↘←]/);
});
