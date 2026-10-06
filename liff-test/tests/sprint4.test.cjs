'use strict';
// Sprint 4：3問チェックを全放送回へ（台帳・?ep=・回ごとの記録・サーバー検証・一覧ページ・取り込み）。
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const {randomUUID}=require('node:crypto');
const {pathToFileURL}=require('node:url');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const catalog=require('../quiz-catalog');
const sync=require('../sync');
const s=require('../lib/server');
const answersApi=require('../api/answers');
const bareScript=html=>html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
const session={userId:'12345678-1234-4123-8123-123456789abc',storageKey:'mimiobo-test-v1-'+'a'.repeat(64)};
function storage(){const values=new Map();return {values,get length(){return values.size;},key:i=>[...values.keys()][i]??null,getItem:k=>values.has(k)?values.get(k):null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)};}
const make=(episode,subject,extra={})=>({episode,title:'テスト第'+episode+'回',subject,audioUrl:'https://stand.fm/episodes/t'+episode,page:'ep10-preview.html?ep='+episode,
  questions:[1,2,3].map(n=>({id:'ep'+episode+'-q'+n,topic:'論点'+n,text:'問題文'+n,answer:n!==2,explanation:'解説'+n,law:'根拠：宅建業法'+n+'条'})),...extra});
const wide={...catalog,ep3:make(3,'宅建業法'),ep11:make(11,'宅建業法',{audioMinutes:9}),ep14:make(14,'権利関係')};
const plain=v=>JSON.parse(JSON.stringify(v));

// ---------- ep10-preview.html を ?ep= 付きで動かす ----------
function pageHarness(search='',{cat=wide,store=storage()}={}){
  const nodes=new Map(),requests=[],replaced=[],loaded=[],audio=[{textContent:'音声で聴く（約17分）',href:''},{textContent:'音声で復習する（約17分）',href:''}];
  const node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:id==='karte'||id==='retrySave'||id==='missing',disabled:true,textContent:'',children:[],replaceChildren(){},append(){},querySelectorAll:()=>[],setAttribute(){},focus(){}});return nodes.get(id);};
  const location=new URL('https://mimiobo-liff-test.vercel.app/ep10-preview.html'+search);location.replace=v=>replaced.push(v);
  const context=vm.createContext({URL,URLSearchParams,AbortSignal,console,crypto:{randomUUID},location,localStorage:store,sessionStorage:storage(),
    CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},Event:class{constructor(type){this.type=type;}},
    addEventListener(){},dispatchEvent(){},scrollTo(){}});
  context.window=context;context.MimioboHeader={set(){}};context.MimioboCatalog=cat;
  context.history={replaceState(){}};
  context.liff={init:async()=>{},isLoggedIn:()=>false,getIDToken:()=>'t',login(){}};
  context.fetch=async(u,options={})=>{requests.push({url:u,options});return {ok:false,status:401,json:async()=>({error:'login_required'})};};
  context.document={title:'',documentElement:{dataset:{}},getElementById:node,querySelectorAll:sel=>sel==='.audioLink'?audio:[],querySelector:()=>null,createElement:()=>({}),head:{append(script){loaded.push(script.src);script.onload();}}};
  vm.runInContext(bareScript(read('ep10-preview.html')).replace(/initialize\(\);\s*$/,''),context);
  vm.runInContext('paintQuestions=()=>{};paintAnswer=()=>{};results=()=>{};',context);
  return {context,node,requests,replaced,loaded,audio,store,run:code=>vm.runInContext(code,context)};
}

test('?ep=<n> picks the episode from the catalog; no ?ep= (or ?ep=10) is episode 10',()=>{
  for(const search of ['','?ep=10','?ep=010','?server=1']){
    const h=pageHarness(search);
    assert.equal(h.run('QUIZ_ID'),'ep10',search);assert.deepEqual(plain(h.run('questions.map(q=>q.id)')),['ep10-money','ep10-join','ep10-add'],search);
  }
  const h=pageHarness('?ep=3');
  assert.equal(h.run('QUIZ_ID'),'ep3');assert.deepEqual(plain(h.run('questions.map(q=>q.id)')),['ep3-q1','ep3-q2','ep3-q3']);
  assert.deepEqual(plain(h.run('questions.map(q=>q.answer)')),[true,false,true]);
  assert.equal(pageHarness('?ep=11').run('EPISODE.title'),'テスト第11回');
});
test('title, overline, results label, <title> and audio links come from the catalog',()=>{
  let h=pageHarness('?ep=3');h.run('paintEpisode()');
  assert.equal(h.node('epLabel').textContent,'第3回 · テスト第3回');assert.equal(h.node('karteEpLabel').textContent,'第3回 · テスト第3回');
  assert.equal(h.node('resultsLabel').textContent,'第3回の結果');assert.equal(h.context.document.title,'3問チェック｜第3回');
  assert.deepEqual(h.audio.map(a=>[a.href,a.textContent]),[['https://stand.fm/episodes/t3','音声で聴く'],['https://stand.fm/episodes/t3','音声で復習する']],'no length shown when the catalog has none');
  h=pageHarness('?ep=11');h.run('paintEpisode()');
  assert.deepEqual(h.audio.map(a=>a.textContent),['音声で聴く（約9分）','音声で復習する（約9分）']);
  h=pageHarness('');h.run('paintEpisode()');
  assert.equal(h.node('epLabel').textContent,'第10回 · 営業保証金と保証協会');assert.equal(h.context.document.title,'3問チェック｜第10回');
  const url='https://stand.fm/episodes/69dc7ba498eff95c436a4549';
  assert.deepEqual(h.audio.map(a=>[a.href,a.textContent]),[[url,'音声で聴く（約17分）'],[url,'音声で復習する（約17分）']]);
});
test('an episode that is not in the catalog shows the notice and the link to the list, and starts nothing',async()=>{
  for(const search of ['?ep=99','?ep=abc','?ep=0','?ep=1234','?ep=']){
    const h=pageHarness(search);await h.run('initialize()');
    assert.equal(h.node('missing').hidden,false,search);
    for(const id of ['intro','quiz','results'])assert.equal(h.node(id).hidden,true,search+' '+id);
    assert.equal(h.requests.length,0,'no session, no sync, no LINE');assert.deepEqual(h.loaded,[]);
  }
  assert.ok(read('ep10-preview.html').includes('<section id="missing" class="band band-cyan" hidden><div class="wrap"><p>この回の3問チェックはまだありません。</p><p class="more-link"><a href="checks.html">ほかの回を選ぶ</a></p></div></section>'));
});
test('the results screen has the text link "ほかの回を選ぶ" under "もう一度解く"',()=>{
  const html=read('ep10-preview.html'),results=html.match(/<section id="results"[\s\S]*?<\/section>/)[0];
  assert.ok(results.includes('<a id="toChecks" href="checks.html">ほかの回を選ぶ</a>'));
  assert.ok(results.indexOf('id="restart"')<results.indexOf('id="toChecks"'));
  assert.ok(results.indexOf('id="toKarte"')<results.indexOf('id="restart"'),'the primary button is still first');
});
test('"次にやること": episode 10 keeps its wording; other episodes build it from the missed topics',()=>{
  const at='2026-10-01T00:00:00.000Z',set=(h,...v)=>h.run('answers=['+v.map(x=>`{value:${x},at:'${at}'}`).join(',')+']');
  const h=pageHarness('?ep=3');
  set(h,false,false,null);assert.deepEqual(plain(h.run('nextStep()')),{title:'復習：論点1・論点3',body:'解説1'});
  set(h,true,false,true);assert.deepEqual(plain(h.run('nextStep()')),{title:'チェック完了',body:'論点1、論点2、論点3を確認しました。'});
  const e=pageHarness('');
  set(e,false,false,true);assert.equal(e.run('nextStep().title'),'復習：営業保証金と分担金の金額');
  set(e,true,false,false);assert.equal(e.run('nextStep().title'),'復習：加入時と増設時の期限');
  set(e,true,true,true);assert.equal(e.run('nextStep().title'),'復習：加入時と増設時の期限');
  assert.equal(e.run('nextStep().body'),'新しく加入するときは「加入しようとする日まで」。加入後に事務所を増やすときは「設置した日から2週間以内」です。');
  set(e,true,false,true);assert.deepEqual(plain(e.run('nextStep()')),{title:'チェック完了',body:'営業保証金の金額と、分担金の納付期限を確認しました。'});
});

// ---------- 回ごとの保存キー ----------
test('storage keys are per episode; episode 10 keeps its existing guest key and version',()=>{
  assert.equal(pageHarness('').run('GUEST_KEY'),'mimiobo-guest-v1-ep10-v1');
  assert.equal(pageHarness('?ep=10').run('GUEST_KEY'),'mimiobo-guest-v1-ep10-v1');
  assert.equal(pageHarness('?ep=3').run('GUEST_KEY'),'mimiobo-guest-v1-ep3-v1');
  assert.equal(pageHarness('?ep=14').run('GUEST_KEY'),'mimiobo-guest-v1-ep14-v1');
  const store10=pageHarness('').run('Store'),store3=pageHarness('?ep=3').run('Store');
  const ok=(st,version)=>st.validate({version,attempts:[]});
  assert.ok(ok(store10,'ep10-2026-09-15.v1'));assert.ok(ok(store3,'ep3-2026-09-15.v1'));
  assert.throws(()=>ok(store10,'ep3-2026-09-15.v1'));assert.throws(()=>ok(store3,'ep10-2026-09-15.v1'));
});
test("answers saved on one episode never land in another episode's record",()=>{
  const store=storage();
  const a=pageHarness('?ep=3',{store});a.run('openProgress(GUEST_KEY)');a.run('progressStore.record(0,true);progressStore.save()');
  const b=pageHarness('?ep=11',{store});b.run('openProgress(GUEST_KEY)');b.run('progressStore.record(1,false);progressStore.save()');
  assert.deepEqual([...store.values.keys()].sort(),['mimiobo-guest-v1-ep11-v1','mimiobo-guest-v1-ep3-v1']);
  assert.equal(JSON.parse(store.getItem('mimiobo-guest-v1-ep3-v1')).version,'ep3-2026-09-15.v1');
  assert.equal(JSON.parse(store.getItem('mimiobo-guest-v1-ep11-v1')).version,'ep11-2026-09-15.v1');
  const again=pageHarness('?ep=3',{store});again.run('openProgress(GUEST_KEY)');
  assert.deepEqual(plain(again.run('answers.map(a=>a&&a.value)')),[true,null,null]);
});
test('episode 10 records saved before Sprint 4 (device cache and guest key) are restored as they were',()=>{
  const at='2026-10-01T00:00:05.000Z';
  const old={version:'ep10-2026-09-15.v1',attempts:[{id:'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',startedAt:'2026-10-01T00:00:00.000Z',answers:[{value:true,at},{value:false,at},null]}]};
  const store=storage();store.setItem(session.storageKey+'-ep10-v1',JSON.stringify(old));store.setItem('mimiobo-guest-v1-ep10-v1',JSON.stringify(old));
  const h=pageHarness('',{store});
  h.run(`openProgress('${session.storageKey}-ep10-v1')`);
  assert.deepEqual(plain(h.run('answers.map(a=>a&&a.value)')),[true,false,null]);
  h.run('openProgress(GUEST_KEY)');
  assert.deepEqual(plain(h.run('answers.map(a=>a&&a.value)')),[true,false,null]);
  assert.equal(store.getItem(session.storageKey+'-ep10-v1'),JSON.stringify(old),'nothing was rewritten');
  // A record that carries another episode's version is refused rather than overwritten.
  const wrong=storage();wrong.setItem('mimiobo-guest-v1-ep3-v1',JSON.stringify(old));
  const w=pageHarness('?ep=3',{store:wrong});w.run('openProgress(GUEST_KEY)');
  assert.equal(w.run('progressStore'),null);assert.equal(wrong.getItem('mimiobo-guest-v1-ep3-v1'),JSON.stringify(old));
});

// ---------- sync.js ----------
const at='2026-10-01T00:00:05.000Z',started='2026-10-01T00:00:00.000Z';
function syncSetup(quizId,{getReply}={}){
  const disk=storage(),calls=[];
  const created=sync.create({userId:'u',storageKey:'user-u',storage:disk,quizId,validate:x=>x,fetch:async(url,options={})=>{
    calls.push({url,options});
    const json=body=>({ok:true,status:200,json:async()=>body});
    if(url==='/api/session')return json({userId:'u'});
    if(options.method==='POST')return json({ok:true});
    if(getReply)return getReply(url);
    return json({version:(quizId||'ep10')+'-2026-09-15.v1',attempts:[]});
  }});
  return {s:created,disk,calls};
}
test('sync.js: episode 10 (the default) keeps its key, version, GET url and quizId',async()=>{
  const {s:sy,disk,calls}=syncSetup();
  assert.equal(sy.key,'user-u-ep10-v1');
  await sy.enqueue({id:'a1',startedAt:started,answers:[{value:true,at},null,null]},0);
  assert.ok(calls.some(c=>c.url==='/api/answers?quiz=ep10'));
  const post=JSON.parse(calls.find(c=>c.options.method==='POST').options.body);
  assert.deepEqual(post,{attemptId:'a1',quizId:'ep10',startedAt:started,questionId:'ep10-money',value:true,answeredAt:at});
  assert.equal(JSON.parse(disk.getItem(sy.key)).version,'ep10-2026-09-15.v1');
});
test('sync.js: another episode has its own key, version, GET url, quizId and question ids',async()=>{
  Object.assign(catalog,{ep3:wide.ep3});
  try{
    const {s:sy,disk,calls}=syncSetup('ep3');
    assert.equal(sy.key,'user-u-ep3-v1');
    await sy.enqueue({id:'a2',startedAt:started,answers:[null,{value:false,at},null]},1);
    assert.ok(calls.some(c=>c.url==='/api/answers?quiz=ep3'));
    const post=JSON.parse(calls.find(c=>c.options.method==='POST').options.body);
    assert.deepEqual(post,{attemptId:'a2',quizId:'ep3',startedAt:started,questionId:'ep3-q2',value:false,answeredAt:at});
    assert.equal(JSON.parse(disk.getItem(sy.key)).version,'ep3-2026-09-15.v1');
    assert.equal(disk.getItem('user-u-ep10-v1'),null,'episode 10 is untouched');
  }finally{delete catalog.ep3;}
});
test('sync.js: an unknown quiz is refused; merge keeps the version it is given',()=>{
  for(const quizId of ['ep99','constructor','__proto__'])assert.throws(()=>sync.create({userId:'u',storageKey:'k',storage:storage(),quizId,validate:x=>x,fetch(){}}),/UNKNOWN_QUIZ/);
  assert.equal(sync.merge({attempts:[]},{attempts:[]}).version,'ep10-2026-09-15.v1');
  assert.equal(sync.merge({attempts:[]},{attempts:[]},'ep3-2026-09-15.v1').version,'ep3-2026-09-15.v1');
});
test("sync.js: a permanent GET failure sets aside only this episode's queued rows",async()=>{
  Object.assign(catalog,{ep3:wide.ep3});
  try{
    const {s:sy,disk}=syncSetup('ep3',{getReply:()=>({ok:false,status:409,json:async()=>({error:'history_limit'})})});
    disk.setItem(sy.prefix+'a3:0',JSON.stringify({attemptId:'a3',quizId:'ep3',questionId:'ep3-q1',value:true,startedAt:started,answeredAt:at}));
    disk.setItem(sy.prefix+'b10:0',JSON.stringify({attemptId:'b10',quizId:'ep10',questionId:'ep10-money',value:true,startedAt:started,answeredAt:at}));
    await sy.refresh();
    assert.equal(disk.getItem(sy.prefix+'a3:0'),null);assert.ok(disk.getItem(sy.deadPrefix+'a3:0'));
    assert.ok(disk.getItem(sy.prefix+'b10:0'),"episode 10's queued answer is still waiting");assert.equal(disk.getItem(sy.deadPrefix+'b10:0'),null);
  }finally{delete catalog.ep3;}
});
test("sync.js: restoring one episode merges into that episode's cache only",async()=>{
  Object.assign(catalog,{ep3:wide.ep3});
  try{
    const server={version:'ep3-2026-09-15.v1',attempts:[{id:'r1',startedAt:started,answers:[{value:true,at},null,null]}]};
    const {s:sy,disk}=syncSetup('ep3',{getReply:()=>({ok:true,status:200,json:async()=>server})});
    disk.setItem('user-u-ep10-v1','{"version":"ep10-2026-09-15.v1","attempts":[]}');
    await sy.refresh();
    assert.equal(JSON.parse(disk.getItem('user-u-ep3-v1')).attempts[0].id,'r1');assert.equal(disk.getItem('user-u-ep10-v1'),'{"version":"ep10-2026-09-15.v1","attempts":[]}');
  }finally{delete catalog.ep3;}
});

// ---------- サーバーの検証（台帳） ----------
const user=session.userId,now='2026-01-01T00:00:00.000Z';
const originalFetch=global.fetch,originalEnv={...process.env};
function response(){const headers={};return {code:0,data:null,headers,setHeader(k,v){headers[k]=v;},getHeader(k){return headers[k];},status(n){this.code=n;return this;},json(d){this.data=d;return this;}};}
function cookie(){return s.COOKIE+'='+s.sign({purpose:'session',userId:user,provider:'email',subject:'tester@example.com',exp:Date.now()/1000+600});}
function request(body={},method='POST',url='/api/answers?quiz=ep10'){return {method,url,headers:{host:'localhost:3000',origin:'http://localhost:3000','content-type':'application/json','x-mimiobo-user':user,cookie:cookie()},body};}
function authenticated(run){global.fetch=async(url,options)=>{const u=new URL(url),body=options.body?JSON.parse(options.body):undefined;
  const data=u.pathname==='/rest/v1/allowlist'?[{provider:'email'}]:u.pathname==='/rest/v1/identities'?[{user_id:user}]:await run(u,options,body);
  return {ok:true,status:200,json:async()=>data};};}
const answer=(extra={})=>({attemptId:'aaaaaaaa-1234-4123-8123-123456789abc',quizId:'ep10',questionId:'ep10-money',value:true,startedAt:now,answeredAt:now,...extra});
test.beforeEach(()=>{Object.assign(process.env,{SESSION_SECRET:'test-secret-at-least-thirty-two-bytes-long',SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test_only'});global.fetch=async()=>{throw Error('unmocked fetch');};});
test.after(()=>{global.fetch=originalFetch;process.env=originalEnv;});
// The API reads the same catalog object; add test episodes for the duration of one test.
const withEpisodes=fn=>async()=>{Object.assign(catalog,{ep3:wide.ep3,ep11:wide.ep11});try{await fn();}finally{delete catalog.ep3;delete catalog.ep11;}};
test('server: the catalog decides which quiz and question are valid (400 otherwise)',withEpisodes(()=>{
  assert.equal(answersApi.validate(answer({quizId:'ep3',questionId:'ep3-q2'})).p_quiz_id,'ep3');
  assert.equal(answersApi.validate(answer({quizId:'ep11',questionId:'ep11-q3',value:null})).p_question_id,'ep11-q3');
  assert.equal(answersApi.validate(answer()).p_question_id,'ep10-money','episode 10 is accepted exactly as before');
  const bad=[{quizId:'ep99',questionId:'ep99-q1'},{quizId:'ep3',questionId:'ep3-q9'},{quizId:'ep3',questionId:'ep10-money'},{quizId:'ep10',questionId:'ep3-q1'},
    {quizId:'__proto__'},{quizId:'constructor',questionId:'x'},{quizId:'toString'},{quizId:['ep3'],questionId:'ep3-q1'},{quizId:3},{quizId:undefined},{questionId:['ep10-money']},{questionId:undefined}];
  for(const patch of bad)assert.throws(()=>answersApi.validate(answer(patch)),e=>e.status===400,JSON.stringify(patch));
}));
test("server: POST for another episode reaches the same RPC with that episode's ids; an unregistered one never reaches the database",withEpisodes(async()=>{
  const calls=[];authenticated((u,options,body)=>{assert.equal(u.pathname,'/rest/v1/rpc/save_answer');calls.push(body);return null;});
  let res=response();await answersApi(request(answer({quizId:'ep3',questionId:'ep3-q1'})),res);
  assert.equal(res.code,200);assert.equal(calls[0].p_quiz_id,'ep3');assert.equal(calls[0].p_question_id,'ep3-q1');assert.equal(calls[0].p_user_id,user);
  for(const patch of [{quizId:'ep99',questionId:'ep99-q1'},{quizId:'ep3',questionId:'ep10-add'}]){res=response();await answersApi(request(answer(patch)),res);assert.equal(res.code,400);assert.equal(res.data.error,'invalid_answer');}
  assert.equal(calls.length,1);
}));
test("server: GET works only for catalog quizzes, filters by that quiz and answers in that quiz's order",withEpisodes(async()=>{
  authenticated(u=>{
    assert.equal(u.searchParams.get('quiz_id'),'eq.ep3');
    return [{id:'x',started_at:now,answers:[{question_id:'ep3-q3',value:true,answered_at:now},{question_id:'ep3-q1',value:null,answered_at:now}]}];
  });
  let res=response();await answersApi(request({},'GET','/api/answers?quiz=ep3'),res);
  assert.equal(res.code,200);assert.equal(res.data.version,'ep3-2026-09-15.v1');
  assert.deepEqual(res.data.attempts[0].answers,[{value:null,at:now},null,{value:true,at:now}]);
  const req=request({},'GET');req.query={quiz:'ep10'};
  authenticated(u=>{assert.equal(u.searchParams.get('quiz_id'),'eq.ep10');return [];});
  res=response();await answersApi(req,res);assert.equal(res.code,200);assert.equal(res.data.version,'ep10-2026-09-15.v1');
  global.fetch=async(url)=>{if(String(url).includes('/rest/v1/attempts'))throw Error('the attempts table must not be read');return {ok:true,status:200,json:async()=>String(url).includes('allowlist')?[{provider:'email'}]:[{user_id:user}]};};
  for(const quiz of ['ep99','__proto__','constructor','hasOwnProperty','',undefined,['ep3','ep10']]){
    const bad=request({},'GET','/api/answers');bad.query={quiz};res=response();await answersApi(bad,res);
    assert.equal(res.code,400,String(quiz));assert.equal(res.data.error,'invalid_quiz');
  }
}));

// ---------- checks.html（回の一覧） ----------
function fakeElement(tag){return {tag,className:'',textContent:'',href:'',dataset:{},children:[],append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=[...nodes];}};}
function checksHarness({cat=wide,store=storage(),sessionReply}={}){
  const root=fakeElement('div'),headerCalls=[],requests=[],handlers={};
  const context=vm.createContext({AbortSignal,JSON,Object,Number,Date,console,localStorage:store,addEventListener:(type,fn)=>{handlers[type]=fn;}});
  context.window=context;context.MimioboCatalog=cat;context.MimioboHeader={set:v=>headerCalls.push(v)};
  context.document={getElementById:()=>root,createElement:fakeElement};
  context.fetch=async(url,options)=>{requests.push({url,options});return sessionReply?sessionReply():{ok:false,status:401,json:async()=>({})};};
  const start=()=>vm.runInContext(bareScript(read('checks.html')).replace(/initialize\(\);\s*$/,'')+';initialize()',context);
  const view=()=>root.children.map(g=>({subject:g.children[0].textContent,cards:g.children[1].children.map(c=>({href:c.href,num:c.children[0].textContent,title:c.children[1].textContent,state:c.children[2].textContent,done:c.children[2].dataset.done}))}));
  return {context,root,headerCalls,requests,handlers,start,view,store};
}
const attemptOf=(answers,startedAt=started)=>({id:randomUUID(),startedAt,answers});
const saved=(quizId,...attempts)=>JSON.stringify({version:quizId+'-2026-09-15.v1',attempts});
test('checks.html: headings only for subjects in the catalog (fixed order), cards in episode order, "未回答" when nothing is saved',async()=>{
  const h=checksHarness();await h.start();
  const view=h.view();
  assert.deepEqual(view.map(g=>g.subject),['宅建業法','権利関係']);
  assert.deepEqual(view[0].cards.map(c=>[c.num,c.title,c.state,c.href]),[
    ['第3回','テスト第3回','未回答','ep10-preview.html?ep=3'],
    ['第10回','営業保証金と保証協会','未回答','ep10-preview.html?ep=10'],
    ['第11回','テスト第11回','未回答','ep10-preview.html?ep=11']]);
  assert.deepEqual(view[1].cards.map(c=>[c.num,c.state]),[['第14回','未回答']]);
  assert.ok(view.flatMap(g=>g.cards).every(c=>c.done==='false'));
});
test('checks.html: the state is the number of correct answers in the latest answered attempt on this device',async()=>{
  const store=storage();
  // ep3: correct answers are true,false,true. First attempt 1/3, latest answered attempt 3/3, then an empty retry that is ignored.
  store.setItem('mimiobo-guest-v1-ep3-v1',saved('ep3',attemptOf([{value:true,at},{value:true,at},null]),attemptOf([{value:true,at},{value:false,at},{value:true,at}],'2026-10-02T00:00:00.000Z'),attemptOf([null,null,null],'2026-10-03T00:00:00.000Z')));
  // ep10: "still unsure" does not count as correct.
  store.setItem('mimiobo-guest-v1-ep10-v1',saved('ep10',attemptOf([{value:true,at},{value:null,at},null])));
  // ep11: data that carries another version string is ignored; ep14: broken JSON is ignored.
  store.setItem('mimiobo-guest-v1-ep11-v1',saved('ep3',attemptOf([{value:true,at},null,null])));
  store.setItem('mimiobo-guest-v1-ep14-v1','{broken');
  const h=checksHarness({store});await h.start();
  assert.deepEqual(h.view().flatMap(g=>g.cards).map(c=>[c.num,c.state,c.done]),[['第3回','3/3','true'],['第10回','1/3','true'],['第11回','未回答','false'],['第14回','未回答','false']]);
});
test('checks.html: logged in reads the synced cache of that account (falls back to this device); the header is told the state',async()=>{
  const store=storage();
  store.setItem(session.storageKey+'-ep3-v1',saved('ep3',attemptOf([{value:true,at},{value:false,at},{value:false,at}])));
  store.setItem('mimiobo-guest-v1-ep3-v1',saved('ep3',attemptOf([{value:false,at},null,null])));
  store.setItem('mimiobo-guest-v1-ep11-v1',saved('ep11',attemptOf([{value:true,at},{value:false,at},{value:true,at}])));
  store.setItem('mimiobo-test-v1-'+'b'.repeat(64)+'-ep10-v1',saved('ep10',attemptOf([{value:true,at},{value:false,at},{value:true,at}])));
  const h=checksHarness({store,sessionReply:()=>({ok:true,status:200,json:async()=>session})});await h.start();
  assert.equal(h.requests[0].url,'/api/session');assert.equal(h.requests[0].options.credentials,'same-origin');assert.deepEqual(h.headerCalls,[true]);
  assert.deepEqual(h.view().flatMap(g=>g.cards).map(c=>[c.num,c.state]),[['第3回','2/3'],['第10回','未回答'],['第11回','3/3'],['第14回','未回答']]);
  // Logged out: the account cache is not read at all.
  const out=checksHarness({store});await out.start();
  assert.deepEqual(out.headerCalls,[false]);assert.deepEqual(out.view().flatMap(g=>g.cards).map(c=>[c.num,c.state]),[['第3回','0/3'],['第10回','未回答'],['第11回','3/3'],['第14回','未回答']]);
  // A bad storageKey from the server is never used.
  const odd=checksHarness({store,sessionReply:()=>({ok:true,status:200,json:async()=>({...session,storageKey:'x'})})});await odd.start();
  assert.equal(odd.view()[0].cards[0].state,'0/3');
});
test('checks.html: refreshes when another tab saves; the page copy is only the approved two lines',async()=>{
  const store=storage(),h=checksHarness({store});await h.start();
  assert.equal(h.view()[0].cards[0].state,'未回答');
  store.setItem('mimiobo-guest-v1-ep3-v1',saved('ep3',attemptOf([{value:true,at},null,null])));
  h.handlers.storage();assert.equal(h.view()[0].cards[0].state,'1/3');
  const html=read('checks.html');
  assert.ok(html.includes('<h1>3問チェック</h1><p>聴いた回を、3問で確かめます。</p>'));
  assert.ok(html.includes('<title>3問チェック｜耳で覚える宅建</title>'));
  assert.ok(html.includes('<script src="/quiz-catalog.js"></script>')&&html.includes('<script src="/site-header.js"></script>'));
});
test('checks.html: <style> and <script> blocks balance and parse; the local harness serves it; content/ is not shipped',()=>{
  for(const file of ['checks.html','ep10-preview.html']){
    const html=read(file);
    assert.equal((html.match(/<style>/g)||[]).length,(html.match(/<\/style>/g)||[]).length,file);
    assert.doesNotThrow(()=>new Function(bareScript(html)),file);
  }
  assert.ok(read('scripts/dev.cjs').includes("'checks.html'"));
  const ignore=read('.vercelignore').split(/\r?\n/);assert.ok(ignore.includes('content/')&&ignore.includes('SPRINT4_*.md'));assert.ok(!ignore.includes('quiz-catalog.js')&&!ignore.includes('checks.html'));
});

// ---------- 学習カルテの「解き直す」 ----------
test('karte: the "解き直す" link follows the catalog page of any episode',()=>{
  const {summarize}=require('../karte-core');
  const topics=summarize([{quiz_id:'ep3',question_id:'ep3-q1',value:false,answered_at:now,attempt_id:'a'}],wide).review;
  assert.equal(topics[0].page,'ep10-preview.html?ep=3');
  assert.ok(read('karte.html').includes('解き直す'));
});

// ---------- ログイン後の戻り先 ----------
test('next: only karte, checks and ep<n> are accepted (never a URL); LINE login carries them',()=>{
  const ctx={window:{},location:{hash:'',search:''},sessionStorage:storage(),URLSearchParams,Date,Event,AbortSignal,fetch:async()=>({})};
  vm.runInNewContext(read('auth-client.js'),ctx);const {lineLoginUrl}=ctx.window.MimioboAuth;
  const base='https://liff.line.me/2011606963-hH0DzETc/ep10-preview.html?login=line';
  for(const ok of ['karte','checks','ep10','ep3','ep11','ep999'])assert.equal(lineLoginUrl(ok),base+'&next='+ok);
  for(const bad of ['','ep','ep1234','epx','ep3/x','ep3&x=1','EP3','https://evil.example','//evil','javascript:alert(1)',undefined,null,3,['ep3']])assert.equal(lineLoginUrl(bad),base,String(bad));
});
async function callback(note,ok=true){
  const replacements=[],local=storage();if(note!==undefined)local.setItem('mimiobo-next',typeof note==='string'?note:JSON.stringify(note));
  const ctx={location:{hash:'#token_hash=test-token-hash',pathname:'/auth-callback.html',replace:v=>replacements.push(v)},history:{replaceState(){}},URLSearchParams,AbortSignal,localStorage:local,fetch:async()=>({ok})};
  await vm.runInNewContext(read('auth-callback.js'),ctx);return {replacements,local};
}
test('email login lands on the requested page: karte, checks or that episode; anything else keeps the old landing',async()=>{
  const soon=Date.now()+60000;
  assert.deepEqual((await callback({page:'checks',expires:soon})).replacements,['/checks.html']);
  assert.deepEqual((await callback({page:'ep3',expires:soon})).replacements,['/ep10-preview.html?ep=3&server=1&auth=ok']);
  assert.deepEqual((await callback({page:'ep3',expires:soon},false)).replacements,['/ep10-preview.html?ep=3&server=1&auth=failed'],'a failed login still shows the error message');
  assert.deepEqual((await callback({page:'checks',expires:soon},false)).replacements,['/ep10-preview.html?server=1&auth=failed']);
  for(const note of [{page:'ep10',expires:soon},{page:'ep3',expires:Date.now()-1},{page:'ep3/../x',expires:soon},{page:'ep1234',expires:soon},{page:'https://evil.example',expires:soon},{page:3,expires:soon}])
    assert.deepEqual((await callback(note)).replacements,['/ep10-preview.html?server=1&auth=ok'],JSON.stringify(note));
});
test('after a LINE login on the episode page, ?next sends the visitor on; a name that is not in the catalog or is the current page stays put',()=>{
  const go=search=>{const h=pageHarness(search);h.run('goNext()');return h.replaced;};
  assert.deepEqual(go('?next=karte'),['karte.html']);
  assert.deepEqual(go('?next=checks'),['checks.html']);
  assert.deepEqual(go('?next=ep3'),['ep10-preview.html?ep=3'],'back to the episode the login started from');
  assert.deepEqual(go('?ep=3&next=ep10'),['ep10-preview.html?ep=10']);
  assert.deepEqual(go('?next=ep10'),[],'already on episode 10');
  assert.deepEqual(go('?ep=3&next=ep3'),[]);
  for(const bad of ['?next=ep99','?next=ep','?next=https://evil.example','?next=ep3/x','?next=ep1234'])assert.deepEqual(go(bad),[],bad);
});
test('account.html and the episode page accept the same ?next names (no URLs)',()=>{
  for(const file of ['account.html','ep10-preview.html']){
    const html=read(file);
    assert.ok(html.includes('/^(karte|checks|ep\\d{1,3})$/.test(v)'),file);assert.ok(!html.includes('NEXT_PAGES'),file);
  }
});
test('LINE redirect from an episode page returns to that episode; episode 10 is unchanged',()=>{
  const ep=read('ep10-preview.html');
  assert.ok(ep.includes("const next=queryNext()||(QUIZ_ID!=='ep10'?QUIZ_ID:'')"));
  assert.ok(ep.includes('href="account.html?next=ep10">ログイン</a>'),'static login hint is unchanged for episode 10');
});

// ---------- 取り込みスクリプト ----------
const loadImport=()=>import(pathToFileURL(path.join(__dirname,'..','scripts','import-content.mjs')).href);
const goodItem=(n,extra={})=>({quizId:'ep'+n,episode:n,title:'第'+n+'回の題',subject:'宅建業法',audioUrl:'https://stand.fm/episodes/x'+n,
  questions:[{id:'ep'+n+'-q1',topic:'免許の有効期間',text:'文1',answer:true,explanation:'解説1。',law:'根拠：宅建業法3条'},{id:'ep'+n+'-q2',topic:'免許の更新',text:'文2',answer:false,explanation:'解説2。',law:'根拠：宅建業法3条'},{id:'ep'+n+'-q3',topic:'免許換え',text:'文3',answer:true,explanation:'解説3。',law:'根拠：宅建業法7条'}],
  sourceRows:[1,2,3],check:[{id:'ep'+n+'-q1',status:'条文照合OK',note:'確認'}],...extra});
const loadCatalog=source=>vm.runInNewContext('(function(){var module={exports:{}};'+source+';return module.exports;})()');
test('import: a well-formed file passes and becomes catalog entries (sourceRows and check are not copied)',async()=>{
  const {validateEntries}=await loadImport();
  const r=validateEntries([goodItem(1),goodItem(2)]);
  assert.deepEqual(r.problems,[]);assert.deepEqual(Object.keys(r.entries),['ep1','ep2']);
  assert.equal(r.entries.ep1.page,'ep10-preview.html?ep=1');assert.equal(r.entries.ep1.sourceRows,undefined);assert.equal(r.entries.ep1.check,undefined);
  assert.deepEqual(Object.keys(r.entries.ep1.questions[0]),['id','topic','text','answer','explanation','law']);
});
test('import: shape problems are reported and nothing is accepted',async()=>{
  const {validateEntries}=await loadImport();
  const bad=(item,re)=>{const r=validateEntries([item]);assert.ok(r.problems.some(p=>re.test(p)),JSON.stringify(r.problems)+' '+re);};
  bad({...goodItem(1),quizId:'ep2'},/quizId/);
  bad({...goodItem(1),episode:0},/episode/);bad({...goodItem(1),episode:1.5},/episode/);
  bad({...goodItem(1),title:' '},/title/);bad({...goodItem(1),subject:'民法'},/subject/);bad({...goodItem(1),audioUrl:'http://x'},/audioUrl/);
  bad({...goodItem(1),questions:goodItem(1).questions.slice(0,2)},/ちょうど3問/);
  const q=(patch,n=0)=>({...goodItem(1),questions:goodItem(1).questions.map((x,i)=>i===n?{...x,...patch}:x)});
  bad(q({id:'ep2-q1'}),/id は ep1-/);bad(q({id:'ep1-Q1'}),/id は ep1-/);bad(q({id:'ep1-q2'}),/重複/);bad(q({topic:''}),/topic/);bad(q({text:undefined}),/text/);
  bad(q({explanation:''}),/explanation/);bad(q({law:'宅建業法3条'}),/根拠：/);bad(q({answer:'true'}),/answer/);
  bad({...goodItem(1),questions:goodItem(1).questions.map(x=>({...x,answer:true}))},/○と×/);
  assert.ok(validateEntries([goodItem(1),goodItem(1)]).problems.some(p=>/2回/.test(p)));
  assert.ok(validateEntries([]).problems.length&&validateEntries({}).problems.length&&validateEntries(null).problems.length);
  assert.ok(validateEntries([goodItem(1),goodItem(2,{questions:goodItem(1).questions})]).problems.length,'ids of episode 1 cannot be reused in episode 2');
});
test('import: episode 10 is never overwritten; a check that is not 条文照合OK is surfaced as a warning',async()=>{
  const {validateEntries}=await loadImport();
  const r=validateEntries([goodItem(10),goodItem(4,{check:[{id:'ep4-q1',status:'要確認',note:'通達が根拠'}]})]);
  assert.deepEqual(r.skipped,['ep10']);assert.deepEqual(Object.keys(r.entries),['ep4']);assert.deepEqual(r.problems,[]);
  assert.ok(r.warnings.some(w=>w.includes('要確認')&&w.includes('通達が根拠')));
});
test('import: merging keeps episode 10 exactly and the result is a catalog the app can load',async()=>{
  const {validateEntries,mergeSource,serialize}=await loadImport();
  const source=read('quiz-catalog.js'),before=plain(catalog);
  const merged=mergeSource(source,validateEntries([goodItem(2),goodItem(1)]).entries);
  const next=plain(loadCatalog(merged.source));
  assert.deepEqual(Object.keys(next),['ep1','ep2','ep10'],'ordered by episode');
  assert.deepEqual(next.ep10,before.ep10,'episode 10 is unchanged (audioMinutes, hints, pairs, recommend included)');
  assert.equal(next.ep1.title,'第1回の題');assert.equal(next.ep2.questions[1].answer,false);
  // Importing again replaces the same episode, keeps the others and a hand-set audioMinutes.
  const again=mergeSource(merged.source.replace('"episode":1,','"audioMinutes":12,"episode":1,'),validateEntries([goodItem(1,{title:'改題'})]).entries);
  const second=loadCatalog(again.source);
  assert.equal(second.ep1.title,'改題');assert.equal(second.ep1.audioMinutes,12);assert.equal(second.ep2.title,'第2回の題');assert.equal(second.ep10.episode,10);
  assert.ok(serialize({ep10:before.ep10}).includes('"ep10":{'));
  assert.throws(()=>mergeSource('no markers',{}),/DATA_BEGIN/);
});
test('import: run() checks without --write, writes with --write, and writes nothing when anything is wrong',async()=>{
  const {run}=await loadImport();
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'import-'));
  try{
    const catalogFile=path.join(dir,'quiz-catalog.js');fs.copyFileSync(path.join(__dirname,'..','quiz-catalog.js'),catalogFile);
    const original=fs.readFileSync(catalogFile,'utf8'),logs=[],log=m=>logs.push(m);
    const good=path.join(dir,'good.json');fs.writeFileSync(good,JSON.stringify([goodItem(1),goodItem(2),goodItem(10)]));
    assert.equal(run([good],{catalogFile,log}),0);assert.equal(fs.readFileSync(catalogFile,'utf8'),original,'dry run changes nothing');
    assert.ok(logs.some(l=>l.includes('検査OK'))&&logs.some(l=>l.includes('第10回は取り込みません')));
    assert.equal(run([good,'--write'],{catalogFile,log}),0);
    const written=fs.readFileSync(catalogFile,'utf8');assert.notEqual(written,original);
    assert.deepEqual(Object.keys(loadCatalog(written)),['ep1','ep2','ep10']);
    const broken=path.join(dir,'broken.json');fs.writeFileSync(broken,JSON.stringify([goodItem(3),{...goodItem(4),subject:'民法'}]));
    const before=fs.readFileSync(catalogFile,'utf8');
    assert.equal(run([broken,'--write'],{catalogFile,log}),1);assert.equal(fs.readFileSync(catalogFile,'utf8'),before,'one bad entry blocks all of them');
    assert.equal(run([path.join(dir,'missing.json')],{catalogFile,log}),1);assert.equal(run([],{catalogFile,log}),2);
    fs.writeFileSync(path.join(dir,'text.json'),'not json');assert.equal(run([path.join(dir,'text.json')],{catalogFile,log}),1);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
