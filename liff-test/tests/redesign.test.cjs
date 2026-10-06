'use strict';
// 10/6 画面構成の見直し：共通ヘッダー・ログインを account.html に集約・カルテを1つに。
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {randomUUID}=require('node:crypto');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const pages={ep10:read('ep10-preview.html'),karte:read('karte.html'),account:read('account.html')};
const bareScript=html=>html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
const session={userId:'12345678-1234-4123-8123-123456789abc',storageKey:'mimiobo-test-v1-'+'a'.repeat(64)};
function storage(){const values=new Map();return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

// ---------- 共通ヘッダー ----------
const headerOf=html=>html.match(/<header class="site-header">[\s\S]*?<\/header>/)[0];
const headerCss=html=>html.match(/<style>\n\/\* site-header 10\/6 \*\/[\s\S]*?<\/style>/)[0];
test('the same header (markup, css, script) is in all three pages; only the current tab differs',()=>{
  const plain=h=>headerOf(h).replace(' aria-current="page"','');
  assert.equal(plain(pages.karte),plain(pages.ep10));assert.equal(plain(pages.account),plain(pages.ep10));
  assert.equal(headerCss(pages.karte),headerCss(pages.ep10));assert.equal(headerCss(pages.account),headerCss(pages.ep10));
  for(const html of Object.values(pages)){
    assert.ok(html.includes('<script src="/site-header.js"></script>'));
    assert.ok(html.indexOf('<header class="site-header">')<html.indexOf('<main>'));
    assert.ok(headerCss(html).includes('position:sticky;top:0'));assert.ok(headerCss(html).includes('border-bottom:1px solid var(--line)'));
  }
  const header=headerOf(pages.ep10);
  assert.ok(header.includes('耳で覚える宅建'));assert.ok(header.includes('>3問チェック</a>'));assert.ok(header.includes('>学習カルテ</a>'));
  assert.ok(header.includes('id="siteAuth"')&&header.includes('href="account.html"'));
  assert.ok(headerCss(pages.ep10).includes('.site-brand{font-weight:900;font-size:15px'));
});
test('the current page is marked with aria-current="page"; account.html marks neither tab',()=>{
  const current=html=>[...headerOf(html).matchAll(/<a href="([^"]+)" aria-current="page">/g)].map(m=>m[1]);
  assert.deepEqual(current(pages.ep10),['ep10-preview.html']);assert.deepEqual(current(pages.karte),['karte.html']);assert.deepEqual(current(pages.account),[]);
  assert.ok(headerCss(pages.ep10).includes('.site-tabs a[aria-current=page]{color:var(--ink);font-weight:700;border-bottom-color:var(--cyan)}'));
});
function headerHarness({pathname='/ep10-preview.html',reply=async()=>({ok:true,status:200})}={}){
  const attrs={},el={hidden:true,textContent:'ログイン',setAttribute:(k,v)=>{attrs[k]=v;}},handlers={},requests=[];
  const context=vm.createContext({AbortSignal,Promise,location:{pathname},
    document:{getElementById:id=>id==='siteAuth'?el:null},
    addEventListener:(type,fn)=>{handlers[type]=fn;},fetch:async(url,options)=>{requests.push(url);return reply();}});
  context.window=context;vm.runInContext(read('site-header.js'),context);
  return {el,attrs,handlers,requests,context};
}
test('header right end: "ログイン中" when /api/session is ok, "ログイン" when logged out or unreachable',async()=>{
  const inn=headerHarness();await tick();
  assert.equal(inn.el.textContent,'ログイン中');assert.equal(inn.attrs['data-state'],'in');assert.equal(inn.el.hidden,false);assert.deepEqual(inn.requests,['/api/session']);
  for(const reply of [async()=>({ok:false,status:401}),async()=>{throw Error('offline');}]){
    const out=headerHarness({reply});await tick();
    assert.equal(out.el.textContent,'ログイン');assert.equal(out.attrs['data-state'],'out');assert.equal(out.el.hidden,false);
  }
});
test('header: a page that already knows the state wins over the probe; logout flips it back',async()=>{
  let resolve;const slow=headerHarness({reply:()=>new Promise(r=>{resolve=r;})});
  slow.context.MimioboHeader.set(true);resolve({ok:false,status:401});await tick();
  assert.equal(slow.el.textContent,'ログイン中','a late 401 probe must not overwrite a state the page set');
  slow.handlers['mimiobo:logout']();assert.equal(slow.el.textContent,'ログイン');assert.equal(slow.attrs['data-state'],'out');
});
test('header: nothing on account.html (no right end, no request)',async()=>{
  const h=headerHarness({pathname:'/account.html'});await tick();
  assert.equal(h.el.hidden,true);assert.deepEqual(h.requests,[]);
});

// ---------- account.html ----------
function accountHarness(search='',reply){
  const nodes=new Map(),requests=[],headerCalls=[];
  const hiddenAtStart=['accountLoggedOut','accountLoggedIn','accountMethod','accountLinkLine','accountLinkEmailBox'];
  const node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:hiddenAtStart.includes(id),disabled:false,textContent:'',value:'',validity:{valid:true}});return nodes.get(id);};
  const location={search,href:'https://mimiobo-liff-test.vercel.app/account.html'+search,pathname:'/account.html',reloaded:0,reload(){this.reloaded++;}};
  const context=vm.createContext({URLSearchParams,AbortSignal,Date,Object,Promise,JSON,Error,console,location,localStorage:storage(),sessionStorage:storage(),
    Event:class{constructor(type){this.type=type;}},dispatchEvent(){}});
  context.window=context;context.MimioboHeader={set:v=>headerCalls.push(v)};
  context.document={getElementById:node,createElement:()=>({}),head:{append(script){
    if(['/ui-messages.js','/auth-client.js'].includes(script.src))vm.runInContext(read(script.src.slice(1)),context);
    script.onload();
  }}};
  context.fetch=async(url,options={})=>{requests.push({url,options});return reply?reply(url,options):{ok:true,status:200,json:async()=>({...session,providers:['email']})};};
  return {context,node,requests,headerCalls,location,start:()=>vm.runInContext(bareScript(pages.account).replace(/initialize\(\);\s*$/,'')+';initialize()',context)};
}
const out401=()=>({ok:false,status:401,json:async()=>({error:'login_required'})});
test('account.html logged out: LINE button, "or by email" and the mail form are shown; the logged-in part is not',async()=>{
  const h=accountHarness('',out401);await h.start();
  assert.equal(h.node('accountLoggedOut').hidden,false);assert.equal(h.node('accountLoggedIn').hidden,true);assert.deepEqual(h.headerCalls,[false]);
  for(const text of ['<h1>ログイン</h1>','記録を別の端末でも見られるようになります。','>LINEでログイン</button>','または、メールで','>ログインのメールを受け取る</button>','届いたリンクを10分以内に開いてください。','<p class="label">アカウント</p>'])assert.ok(pages.account.includes(text),text);
});
test('account.html logged in: fact row from providers, LINE button only without LINE, mail box only without email',async()=>{
  const cases=[[['email'],'ログインの方法：メール',false,true],[['line'],'ログインの方法：LINE',true,false],[['email','line'],'ログインの方法：メール＋LINE',true,true]];
  for(const [providers,fact,lineHidden,emailHidden] of cases){
    const h=accountHarness('',()=>({ok:true,status:200,json:async()=>({...session,providers})}));await h.start();
    assert.equal(h.node('accountLoggedIn').hidden,false);assert.equal(h.node('accountLoggedOut').hidden,true);assert.deepEqual(h.headerCalls,[true]);
    assert.equal(h.node('accountMethod').textContent,fact);assert.equal(h.node('accountMethod').hidden,false);
    assert.equal(h.node('accountLinkLine').hidden,lineHidden);assert.equal(h.node('accountLinkEmailBox').hidden,emailHidden);
  }
  for(const text of ['<h1>ログイン中</h1>','>LINEも使えるようにする</button>','<summary>メールも使えるようにする</summary>','>このブラウザからログアウト</button>'])assert.ok(pages.account.includes(text),text);
});
test('account.html: session failure shows the shared message and opens neither form',async()=>{
  const h=accountHarness('',()=>({ok:false,status:503,json:async()=>({})}));await h.start();
  assert.equal(h.node('status').textContent,'接続できませんでした。時間をおいてもう一度お試しください。');
  assert.equal(h.node('accountLoggedOut').hidden,true);assert.equal(h.node('accountLoggedIn').hidden,true);
});
test('account.html mail login: posts to /api/email and leaves a 10-minute note for ?next (only karte|ep10)',async()=>{
  for(const [search,page] of [['?next=karte','karte'],['?next=ep10','ep10'],['?next=https://evil.example',null],['',null]]){
    const h=accountHarness(search,url=>url==='/api/session'?out401():{ok:true,status:200,json:async()=>({})});await h.start();
    h.node('accountEmail').value='tester@example.com';await h.node('accountEmailSend').onclick();
    const call=h.requests.find(r=>r.url==='/api/email');assert.deepEqual(JSON.parse(call.options.body),{email:'tester@example.com',link:false});
    const stored=h.context.localStorage.getItem('mimiobo-next');
    if(page){const v=JSON.parse(stored);assert.equal(v.page,page);assert.ok(v.expires>Date.now()&&v.expires<=Date.now()+600000);}else assert.equal(stored,null);
    assert.equal(h.node('accountMessage').textContent,'メールを送りました。届いたリンクを10分以内に開いてください。');assert.equal(h.node('accountEmailSend').disabled,false);
  }
});
test('account.html: an invalid address is rejected before any request; 429 shows the approved message',async()=>{
  const h=accountHarness('',out401);await h.start();
  await h.node('accountEmailSend').onclick();assert.equal(h.node('accountMessage').textContent,'メールアドレスを確認してください。');
  assert.equal(h.requests.filter(r=>r.url==='/api/email').length,0);
  h.node('accountEmail').value='tester@example.com';
  h.context.fetch=async()=>({ok:false,status:429,json:async()=>({error:'try_later'})});
  await h.node('accountEmailSend').onclick();assert.equal(h.node('accountMessage').textContent,'メールの送信回数が上限に達しました。しばらくしてからもう一度お試しください。');
});
test('account.html LINE login goes through the LIFF page with ?login=line and carries ?next',async()=>{
  for(const [search,suffix] of [['?next=karte','&next=karte'],['?next=ep10','&next=ep10'],['',''],['?next=javascript:alert(1)','']]){
    const h=accountHarness(search,out401);await h.start();await h.node('accountLine').onclick();
    assert.equal(h.location.href,'https://liff.line.me/2011606963-hH0DzETc/ep10-preview.html?login=line'+suffix);
    assert.equal(h.requests.length,1,'no API call: the LIFF page does the login');
  }
});
test('account.html: "LINEも使えるようにする" uses the existing link flow; logout deletes the session and reloads',async()=>{
  const ticket='e'.repeat(64);
  const h=accountHarness('',(url,options)=>{
    if(url==='/api/link')return {ok:true,status:200,json:async()=>({linkToken:ticket,expiresIn:600})};
    if(options.method==='DELETE')return {ok:true,status:200,json:async()=>({ok:true})};
    return {ok:true,status:200,json:async()=>({...session,providers:['email']})};
  });
  await h.start();await h.node('accountLinkLine').onclick();
  assert.equal(h.location.href,'https://liff.line.me/2011606963-hH0DzETc/ep10-preview.html?server=1#link='+ticket);
  await h.node('accountLogout').onclick();
  assert.ok(h.requests.some(r=>r.url==='/api/session'&&r.options.method==='DELETE'));assert.equal(h.location.reloaded,1);
});
test('MimioboAuth.lineLoginUrl only accepts the two page names',()=>{
  const ctx={window:{},location:{hash:'',search:''},sessionStorage:storage(),URLSearchParams,Date,Event,AbortSignal,fetch:async()=>({})};
  vm.runInNewContext(read('auth-client.js'),ctx);const {lineLoginUrl}=ctx.window.MimioboAuth;
  assert.equal(lineLoginUrl('karte'),'https://liff.line.me/2011606963-hH0DzETc/ep10-preview.html?login=line&next=karte');
  assert.equal(lineLoginUrl('ep10'),'https://liff.line.me/2011606963-hH0DzETc/ep10-preview.html?login=line&next=ep10');
  for(const bad of ['','x','https://evil.example',undefined,null])assert.equal(lineLoginUrl(bad),'https://liff.line.me/2011606963-hH0DzETc/ep10-preview.html?login=line');
});

// ---------- auth-callback (メールのリンクから戻る) ----------
async function callback(note){
  const replacements=[],local=storage();if(note!==undefined)local.setItem('mimiobo-next',typeof note==='string'?note:JSON.stringify(note));
  const ctx={location:{hash:'#token_hash=test-token-hash',pathname:'/auth-callback.html',replace:v=>replacements.push(v)},history:{replaceState(){}},URLSearchParams,AbortSignal,localStorage:local,
    fetch:async()=>({ok:callback.ok!==false})};
  await vm.runInNewContext(read('auth-callback.js'),ctx);return {replacements,local};
}
test('email login with a "karte" note goes to karte.html and clears the note; every other case keeps the old landing',async()=>{
  const soon=Date.now()+60000;
  let r=await callback({page:'karte',expires:soon});assert.deepEqual(r.replacements,['/karte.html']);assert.equal(r.local.getItem('mimiobo-next'),null);
  for(const note of [{page:'ep10',expires:soon},{page:'karte',expires:Date.now()-1},{page:'https://evil.example',expires:soon},'not json',undefined]){
    r=await callback(note);assert.deepEqual(r.replacements,['/ep10-preview.html?server=1&auth=ok'],JSON.stringify(note));assert.equal(r.local.getItem('mimiobo-next'),null);
  }
  callback.ok=false;try{r=await callback({page:'karte',expires:soon});}finally{callback.ok=undefined;}
  assert.deepEqual(r.replacements,['/ep10-preview.html?server=1&auth=failed'],'a failed login never skips the error message');
});

// ---------- ep10-preview.html（3問チェック） ----------
function ep10Harness(url='https://mimiobo-liff-test.vercel.app/ep10-preview.html',reply){
  const nodes=new Map(),requests=[],refreshes=[],headerCalls=[],replaced=[],logins=[];
  const node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:id==='karte'||id==='retrySave',disabled:true,textContent:'',children:[],replaceChildren(){},append(){},querySelectorAll:()=>[],setAttribute(){},focus(){}});return nodes.get(id);};
  const location=new URL(url);location.replace=v=>replaced.push(v);
  const context=vm.createContext({URL,URLSearchParams,AbortSignal,console,crypto:{randomUUID},location,localStorage:storage(),sessionStorage:storage(),
    CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},Event:class{constructor(type){this.type=type;}},
    addEventListener(){},dispatchEvent(){},scrollTo(){}});
  context.window=context;context.MimioboHeader={set:v=>headerCalls.push(v)};
  context.history={replaceState(_s,_t,next){const r=context.location.replace;context.location=new URL(next,context.location);context.location.replace=r;}};
  context.liff={init:async()=>{},isLoggedIn:()=>true,getIDToken:()=>'test-line-token',login:options=>logins.push(options)};
  context.fetch=async(u,options={})=>{requests.push({url:u,options});return reply?reply(u,options):{ok:true,status:200,json:async()=>session};};
  context.MimioboSync={create:options=>({key:options.storageKey+'-ep10-v1',active:true,stop(){},enqueue(){},refresh:async s=>refreshes.push(s),scheduleRefresh(){}})};
  context.document={documentElement:{dataset:{}},getElementById:node,querySelectorAll:()=>[],createElement:()=>({}),head:{append(script){
    if(['/ui-messages.js','/auth-client.js'].includes(script.src))vm.runInContext(read(script.src.slice(1)),context);
    script.onload();
  }}};
  function preview(){
    vm.runInContext(bareScript(pages.ep10).replace(/initialize\(\);\s*$/,''),context);
    vm.runInContext('paintQuestions=()=>{};paintAnswer=()=>{};results=()=>{};',context);
  }
  return {context,node,requests,refreshes,headerCalls,replaced,logins,preview,run:code=>vm.runInContext(code,context)};
}
const guestOnly=(u,options={})=>({ok:false,status:401,json:async()=>({error:'login_required'})});
const A1={id:'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',startedAt:'2026-10-01T00:00:00.000Z',answers:[{value:true,at:'2026-10-01T00:00:05.000Z'},null,null]};
const guestData=JSON.stringify({version:'ep10-2026-09-15.v1',attempts:[A1]});

test('ep10 markup: the dev strip, sign-in card, karte screen, account block and nav are hidden but keep their ids',()=>{
  const html=pages.ep10;
  assert.match(html,/\.dev-only\{display:none!important\}/);
  assert.match(html,/<div class="preview dev-only"[^>]*>[\s\S]*?id="storageScope"[\s\S]*?id="retrySave"[\s\S]*?id="connectLine"[\s\S]*?id="saveStatus"/);
  for(const re of [/<section id="signinPrompt"[^>]*\bhidden>/,/<section id="karte"[^>]*dev-only[^>]*\bhidden>/,/<section id="account"[^>]*dev-only[^>]*\bhidden>/,/<nav class="preview-links[^"]*dev-only"[^>]*\bhidden>/,/<button id="showKarte"[^>]*\bhidden>/])assert.match(html,re,String(re));
  for(const id of ['signinPromptLine','accountLine','accountEmail','accountEmailSend','accountLinkLine','accountLinkEmail','accountLinkEmailSend','accountLogout','accountMessage','openKarte','backResults','saveAlert','loginHint','restartInline','toKarte','linkPendingBand','accountLinkPending','accountLinkPendingGo'])assert.match(html,new RegExp('id="'+id+'"'),id);
  assert.doesNotMatch(html,/<header>/,'the old header is gone');
});
test('ep10 hero and results use the redesigned wording and buttons',()=>{
  const html=pages.ep10;
  for(const text of ['<h1>3問チェック</h1>','<p>○か×で答えると、すぐに解説が出ます。</p>','音声で聴く（約17分）','id="progressChip" class="chip">回答 0 / 3<','>最初から解き直す</button>','<title>3問チェック｜第10回</title>',
    'ログインすると、答えた記録が学習カルテに集まります。<a href="account.html?next=ep10">ログイン</a>',
    '<a id="toKarte" class="primary" href="karte.html">学習カルテで記録を見る</a>','<button id="restart" class="secondary" type="button">もう一度解く</button>',
    '<a class="footer-link" href="plans-preview.html">学習サポートの一覧</a>','教材の確認範囲','静かに、淡々と。'])assert.ok(html.includes(text),text);
  for(const gone of ['定着3問チェック','聴いた内容を3問で確かめます','記録を残す <span'])assert.ok(!html.includes(gone),gone);
  // primary button comes before the secondary one, inside the results section
  const results=html.match(/<section id="results"[\s\S]*?<\/section>/)[0];
  assert.ok(results.indexOf('id="toKarte"')<results.indexOf('id="restart"'));assert.ok(results.includes('id="showKarte"'));
  assert.ok(results.includes('id="nextTitle"')&&results.includes('id="nextBody"')&&results.includes('id="resultsStorageNote"'));
});
test('ep10: login hint and header follow the login state; the results note is only for logged-out visitors',async()=>{
  const out=ep10Harness(undefined,guestOnly);out.context.liff.isLoggedIn=()=>false;out.preview();await out.run('initialize()');
  assert.equal(out.node('loginHint').hidden,false);assert.deepEqual(out.headerCalls,[false]);
  assert.equal(out.node('resultsStorageNote').textContent,'この端末にだけ残ります。ログインすると学習カルテに集まります。');
  const inn=ep10Harness();inn.preview();await inn.run('initialize()');
  assert.equal(inn.node('loginHint').hidden,true);assert.deepEqual(inn.headerCalls,[true]);assert.equal(inn.node('resultsStorageNote').textContent,'');
});
test('ep10: normal saves show no alert; a save failure shows one line above the questions and clears when saving works again',()=>{
  const h=ep10Harness();h.preview();h.run(fs.readFileSync(path.join(__dirname,'..','ui-messages.js'),'utf8'));
  h.run("openProgress('local-test');answer(0,true);");
  assert.equal(h.node('saveAlert').hidden,true);assert.equal(h.node('saveAlert').textContent,'');
  const ls=h.context.localStorage,set=ls.setItem;ls.setItem=()=>{throw Error('quota');};
  h.run('answer(1,false)');
  assert.equal(h.node('saveAlert').hidden,false);assert.equal(h.node('saveAlert').textContent,'保存できませんでした。この画面の回答は未保存です。');
  ls.setItem=set;
  assert.match(pages.ep10,/<section id="quiz"[^>]*><div class="wrap"><p id="saveAlert" class="save-alert" role="alert" hidden><\/p><div id="quizList"><\/div>/);
});
test('ep10: sign-in failures (?auth=failed) are shown in the alert line, not in the hidden dev strip',async()=>{
  const h=ep10Harness('https://mimiobo-liff-test.vercel.app/ep10-preview.html?server=1&auth=failed');h.preview();await h.run('initialize()');
  assert.equal(h.node('saveAlert').hidden,false);assert.equal(h.node('saveAlert').textContent,h.run("MimioboMessages.text('auth:failed')"));
  assert.equal(h.node('loginHint').hidden,false);
});
test('ep10: sync problems (unavailable / unauthorized) reach the alert line, a later "synced" clears it',()=>{
  const h=ep10Harness();h.preview();h.run(fs.readFileSync(path.join(__dirname,'..','ui-messages.js'),'utf8'));
  h.run("syncState('unavailable')");assert.equal(h.node('saveAlert').hidden,false);assert.equal(h.node('saveAlert').textContent,'サーバーに接続できません。端末には保存しています。');
  h.run("syncState('synced')");assert.equal(h.node('saveAlert').hidden,true);
  h.run("syncState('pending')");assert.equal(h.node('saveAlert').hidden,true,'a normal pending state is not a problem');
});
test('ep10: "最初から解き直す" shows only when an earlier answer was restored, and runs the restart',async()=>{
  const fresh=ep10Harness(undefined,guestOnly);fresh.context.liff.isLoggedIn=()=>false;fresh.preview();await fresh.run('initialize()');
  assert.equal(fresh.node('restartInline').hidden,true);
  const h=ep10Harness(undefined,guestOnly);h.context.liff.isLoggedIn=()=>false;h.context.localStorage.setItem('mimiobo-guest-v1-ep10-v1',guestData);
  h.preview();await h.run('initialize()');
  assert.equal(h.node('restartInline').hidden,false);assert.equal(h.run('answers[0].value'),true);
  h.node('restartInline').onclick();
  assert.equal(h.run('answers.some(Boolean)'),false);assert.equal(h.node('restartInline').hidden,true);
  assert.equal(h.run('progressStore.data.attempts.length'),2,'the old attempt stays; a new one starts');
});
test('ep10: after a LINE login finishes, ?next=karte (or the saved note) moves on to karte.html; nothing else does',async()=>{
  const run=async(url,note)=>{
    const h=ep10Harness(url,(u,o)=>o.method==='POST'?{ok:true,status:200,json:async()=>session}:out401());
    if(note)h.context.localStorage.setItem('mimiobo-next',JSON.stringify(note));
    h.preview();await h.run('initialize()');return h;
  };
  const base='https://mimiobo-liff-test.vercel.app/ep10-preview.html';
  assert.deepEqual((await run(base+'?next=karte')).replaced,['karte.html']);
  const saved=await run(base,{page:'karte',expires:Date.now()+60000});assert.deepEqual(saved.replaced,['karte.html']);assert.equal(saved.context.localStorage.getItem('mimiobo-next'),null);
  for(const [url,note] of [[base+'?next=ep10'],[base],[base+'?next=https://evil.example'],[base+'?next=//evil.example'],[base,{page:'karte',expires:Date.now()-1}]])assert.deepEqual((await run(url,note)).replaced,[],url);
  // An existing session does not jump anywhere.
  const existing=ep10Harness(base+'?next=karte');existing.preview();await existing.run('initialize()');assert.deepEqual(existing.replaced,[]);
});
test('ep10: ?login=line (from account.html) goes straight to the LINE login and brings ?next along; plain visits do not',async()=>{
  const base='https://mimiobo-liff-test.vercel.app/ep10-preview.html';
  const go=async url=>{const h=ep10Harness(url,guestOnly);h.context.liff.isLoggedIn=()=>false;h.preview();await h.run('initialize()');return h;};
  const a=await go(base+'?login=line&next=karte');
  assert.equal(a.logins.length,1);assert.equal(a.logins[0].redirectUri,base+'?next=karte','the redirect keeps the destination and drops login=line');
  const b=await go(base+'?login=line');assert.equal(b.logins.length,1);assert.equal(b.logins[0].redirectUri,base);
  const c=await go(base+'?login=line&next=https://evil.example');assert.equal(c.logins[0].redirectUri,base);
  const d=await go(base);assert.equal(d.logins.length,0);assert.equal(d.node('connectLine').hidden,false);
  // Already inside LINE: no redirect, the login completes by itself.
  const inLine=ep10Harness(base+'?login=line&next=karte',(u,o)=>o.method==='POST'?{ok:true,status:200,json:async()=>session}:out401());
  inLine.preview();await inLine.run('initialize()');assert.equal(inLine.logins.length,0);assert.deepEqual(inLine.replaced,['karte.html']);
});
test('ep10: a pending LINE link shows its button in the visible band (the account block is hidden) and does not auto-redirect',async()=>{
  const ticket='f'.repeat(64);
  const h=ep10Harness('https://mimiobo-liff-test.vercel.app/ep10-preview.html?server=1#link='+ticket,guestOnly);
  h.context.liff.isLoggedIn=()=>false;h.preview();await h.run('initialize()');
  assert.equal(h.node('linkPendingBand').hidden,false);assert.equal(h.node('accountLinkPending').hidden,false);assert.equal(h.logins.length,0);
  await h.node('accountLinkPendingGo').onclick();assert.equal(h.logins.length,1);assert.equal(new URL(h.logins[0].redirectUri).searchParams.get('link'),ticket);
  const band=pages.ep10.match(/<section id="linkPendingBand"[\s\S]*?<\/section>/)[0];
  assert.ok(band.includes('id="accountLinkPending"')&&band.includes('id="accountLinkPendingGo"'));assert.ok(!pages.ep10.match(/<section id="account"[\s\S]*?<\/section>/)[0].includes('accountLinkPending"'));
});

// ---------- karte.html ----------
test('karte.html: logged-out guide, no "テスト中" badge, expiry as a small grey line under the title',()=>{
  const html=pages.karte;
  const need=html.match(/<div id="needLogin"[\s\S]*?<\/div>\n<\/div>/)[0];
  assert.ok(need.includes('<h1>学習カルテ</h1>')&&need.includes('ログインすると、答えた記録がここに集まります。')&&need.includes('<a class="primary" href="account.html?next=karte">ログイン</a>'));
  const entitled=html.match(/<div id="entitled"[\s\S]*?<\/div>\n<\/div>/)[0];
  assert.ok(entitled.indexOf('<h1>学習カルテ</h1>')<entitled.indexOf('id="untilRow"'));assert.match(entitled,/<p id="untilRow" class="small muted" hidden>有効期限：/);
  assert.ok(!entitled.includes('badge'));
  const none=html.match(/<div id="noEntitlement"[\s\S]*?<\/div>\n<\/div>/)[0];
  assert.ok(none.includes('学習カルテを試す（テスト決済）')&&none.includes('テスト用のカードでしか決済できません。実際の請求はありません。'));
  assert.ok(html.includes('<footer>')&&html.includes('href="plans-preview.html">学習サポートの一覧</a>'));
});
test('karte.html tells the header the login state it already knows',async()=>{
  const calls=[];
  const run=async reply=>{
    calls.length=0;
    const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,textContent:'',innerHTML:''});return nodes.get(id);};
    const ctx=vm.createContext({URLSearchParams,AbortSignal,Intl,Date,Number,Object,Promise,JSON,Error,console,location:{search:''},document:{getElementById:node,createElement:()=>({}),head:{append(s){s.onload();}}},
      fetch:async()=>reply});ctx.window=ctx;ctx.MimioboHeader={set:v=>calls.push(v)};
    vm.runInContext(read('quiz-catalog.js'),ctx);vm.runInContext(read('karte-core.js'),ctx);
    await vm.runInContext(bareScript(pages.karte).replace(/initialize\(\);\s*$/,'')+';initialize()',ctx);
  };
  await run(out401());assert.deepEqual(calls,[false]);
  await run({ok:true,status:200,json:async()=>({...session,providers:['email'],entitlements:[]})});assert.deepEqual(calls,[true]);
});

// ---------- 文言・構文・配信 ----------
test('no developer wording on screen: Sprint / テスト中 / 保存中 / アカウントに保存 (only the test-checkout note keeps "テスト中")',()=>{
  const exemptSentence='記録をためて弱点を見る画面です。今はテスト中で、仕組みの確認だけをしています。';
  for(const [name,html] of Object.entries(pages)){
    const markup=html.replace(/<script[\s\S]*?<\/script>/g,'').replace(/<style[\s\S]*?<\/style>/g,'').replace(exemptSentence,'');
    for(const word of ['Sprint','テスト中','保存中','アカウントに保存'])assert.ok(!markup.includes(word),name+' markup: '+word);
    for(const word of ['Sprint','保存中','アカウントに保存'])assert.ok(!html.includes(word),name+' file: '+word);
  }
  assert.ok(pages.karte.includes(exemptSentence));
  for(const file of ['ui-messages.js','site-header.js','auth-client.js','auth-callback.js'])for(const word of ['保存中','アカウントに保存','Sprint'])assert.ok(!read(file).includes(word),file+': '+word);
});
test('the three pages keep balanced <style> blocks, parse as scripts, and keep the mobile-scale block',()=>{
  for(const [name,html] of Object.entries(pages)){
    assert.equal((html.match(/<style>/g)||[]).length,(html.match(/<\/style>/g)||[]).length,name);
    assert.equal((html.match(/<script[ >]/g)||[]).length,(html.match(/<\/script>/g)||[]).length,name);
    assert.doesNotThrow(()=>new Function(bareScript(html)),name);
    assert.ok(html.includes('/* mobile-scale 10/6 */'),name);
  }
  assert.doesNotThrow(()=>new Function(read('site-header.js')));
});
test('every script the three pages load is served by the local harness and exists; plans-preview is untouched',()=>{
  const dev=read('scripts/dev.cjs');
  for(const html of Object.values(pages))for(const m of html.matchAll(/<script src="\/([^"]+)"/g)){assert.ok(dev.includes("'"+m[1]+"'"),m[1]);assert.ok(fs.existsSync(path.join(__dirname,'..',m[1])),m[1]);}
  for(const file of ['account.html','site-header.js','ep10-preview.html','karte.html'])assert.ok(dev.includes("'"+file+"'"),file);
  assert.ok(!read('plans-preview.html').includes('site-header'));
});
