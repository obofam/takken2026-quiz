'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {randomUUID}=require('node:crypto');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const session={userId:'12345678-1234-4123-8123-123456789abc',storageKey:'mimiobo-test-v1-'+'a'.repeat(64)};
function storage(){const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};}
function harness(url='https://mimiobo-liff-test.vercel.app/ep10-preview.html?server=1'){
  const nodes=new Map(),requests=[],refreshes=[],events=[];
  const node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:id==='karte'||id==='retrySave',disabled:true,textContent:'',children:[],replaceChildren(){},append(){},querySelectorAll:()=>[],setAttribute(){}});return nodes.get(id);};
  const context=vm.createContext({URL,URLSearchParams,AbortSignal,console,crypto:{randomUUID},location:new URL(url),localStorage:storage(),sessionStorage:storage(),
    CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},Event:class{constructor(type){this.type=type;}},
    addEventListener(){},dispatchEvent:event=>events.push(event),scrollTo(){},TEST_LIFF_ID:'test-liff-id'});
  context.window=context;
  context.history={replaceState(_state,_title,url){context.location=new URL(url,context.location);}};
  context.liff={init:async()=>{},isLoggedIn:()=>true,getIDToken:()=> 'test-line-token',login(){assert.fail('unexpected redirect');}};
  context.fetch=async(url,options={})=>{requests.push({url,options});return {ok:true,status:200,json:async()=>session};};
  context.MimioboSync={create:options=>({key:options.storageKey+'-ep10-v1',active:true,stop(){},enqueue(){},refresh:async settings=>refreshes.push(settings),scheduleRefresh(){}})};
  context.document={documentElement:{dataset:{}},getElementById:node,querySelectorAll:()=>[],createElement:()=>({}),head:{append(script){
    if(['/ui-messages.js','/auth-client.js'].includes(script.src))vm.runInContext(read(script.src.slice(1)),context);
    else assert.equal(script.src,'/sync.js');
    script.onload();
  }}};
  function preview(){
    const script=read('ep10-preview.html').match(/<script>\s*([\s\S]*?)<\/script>/)[1];
    assert.match(script,/initialize\(\);\s*$/);
    vm.runInContext(script.replace(/initialize\(\);\s*$/,''),context);
    // Exercise the production flow while replacing only DOM-heavy rendering.
    vm.runInContext('paintQuestions=()=>{};paintAnswer=()=>{};results=()=>{};',context);
  }
  return {context,node,requests,refreshes,events,preview,run:code=>vm.runInContext(code,context)};
}

test('email request 429 displays the approved rate-limit message and re-enables the button',async()=>{
  const h=harness();h.preview();h.run(read('ui-messages.js'));h.run(read('auth-client.js'));
  h.node('accountEmail').value='tester@example.com';
  h.context.fetch=async(url,options)=>{
    assert.equal(url,'/api/email');assert.equal(options.method,'POST');
    return {ok:false,status:429,json:async()=>({error:'try_later'})};
  };
  await h.node('accountEmailSend').onclick();
  assert.equal(h.node('accountMessage').textContent,'メールの送信回数が上限に達しました。しばらくしてからもう一度お試しください。');
  assert.equal(h.node('accountEmailSend').disabled,false);
});
test('LIFF state unwrap captures linking ticket before existing-session shortcut; click sends link',async()=>{
  const h=harness('https://mimiobo-liff-test.vercel.app/ep10-preview.html?liff.state=wrapped'),ticket='b'.repeat(64);
  let inits=0;
  h.context.liff.init=async()=>{inits++;h.context.history.replaceState(null,'','/ep10-preview.html?server=1#link='+ticket);};
  h.preview();await h.run('initialize()');
  assert.equal(inits,1);assert.equal(h.context.location.hash,'');
  assert.equal(h.context.MimioboAuth.hasPendingLink(),true);
  assert.equal(h.refreshes.length,0,'must not open existing session before consuming link');
  assert.equal(h.node('connectLine').hidden,false);assert.equal(typeof h.node('connectLine').onclick,'function');
  await h.node('connectLine').onclick();
  const posted=h.requests.filter(r=>r.options.method==='POST');assert.equal(posted.length,1);
  assert.equal(posted[0].url,'/api/session');
  assert.deepEqual(JSON.parse(posted[0].options.body),{idToken:'test-line-token',linkToken:ticket});
  assert.equal(h.context.MimioboAuth.hasPendingLink(),false);assert.equal(h.refreshes.length,1);
});
test('existing server session checks session only once and marks initial sync verified',async()=>{
  const h=harness();h.preview();await h.run('initialize()');
  assert.equal(h.requests.length,1);assert.equal(h.requests[0].url,'/api/session');
  assert.equal(h.requests[0].options.method,undefined);assert.equal(h.refreshes.length,1);
  assert.equal(h.refreshes[0].sessionVerified,true);assert.equal(h.run('canAnswer'),true);
});
test('callback failure queries display safe Japanese fallback instead of silently opening session',async()=>{
  for(const code of ['failed','unavailable','invalid_token']){
    const h=harness('https://mimiobo-liff-test.vercel.app/ep10-preview.html?server=1&auth='+code);
    h.preview();await h.run('initialize()');
    assert.equal(h.node('saveStatus').textContent,h.run("MimioboMessages.text('auth:"+code+"')"));
    assert.equal(h.requests.length,0);assert.equal(h.refreshes.length,0);
  }
});
test('unknown internal initialization errors never reach visible status',async()=>{
  const h=harness();h.context.liff.init=async()=>{throw Error('INTERNAL_SECRET_TOKEN');};
  h.preview();await h.run('initialize()');
  assert.equal(h.node('saveStatus').textContent,h.run('MimioboMessages.fallback'));
  assert.equal(h.context.document.documentElement.dataset.syncState,'unavailable');
});
test('successful local save remains saved when enqueue fails, with pending status and retry',async()=>{
  const h=harness();h.preview();h.run(read('ui-messages.js'));
  let enqueues=0;h.context.testSync={enqueue(){enqueues++;throw Error('quota-secret');}};
  h.run("openProgress('local-test');answerSync=testSync;answer(0,true);");
  const cached=h.context.localStorage.getItem('local-test');
  assert.equal(JSON.parse(cached).attempts[0].answers[0].value,true);
  assert.equal(h.run('saveProblem'),false);assert.equal(h.context.document.documentElement.dataset.syncState,'pending');
  assert.equal(h.node('saveStatus').textContent,h.run("MimioboMessages.text('pending')"));
  assert.equal(h.node('retrySave').hidden,false);assert.equal(enqueues,1);
  const attempt=h.run('progressStore.current.id');
  h.run('answer(1,false)');h.node('restart').onclick();
  assert.equal(h.run('progressStore.current.id'),attempt);
  assert.equal(h.run('progressStore.current.answers[1]'),null);
  assert.equal(h.run('canAnswer'),false);
  h.node('retrySave').onclick();
  assert.equal(enqueues,2);assert.equal(h.run('saveProblem'),false);
  assert.equal(h.context.localStorage.getItem('local-test'),cached);assert.equal(h.node('retrySave').hidden,false);
  h.context.testSync.enqueue=()=>{enqueues++;};h.node('retrySave').onclick();
  assert.equal(h.run('enqueueProblem'),false);assert.equal(h.run('canAnswer'),true);
  assert.equal(h.node('retrySave').hidden,true);assert.equal(enqueues,3);
});
test('old index enables its connect button after SDK init with remaining or resolved liff.state',async()=>{
  for(const unwrap of [false,true]){
    const h=harness('https://mimiobo-liff-test.vercel.app/?liff.state=wrapped');
    h.context.liff.isLoggedIn=()=>false;
    h.context.liff.init=async()=>{if(unwrap)h.context.history.replaceState(null,'','/');};
    await h.run(read('app.js'));
    assert.equal(h.run('ready'),true);assert.equal(h.node('connect').disabled,false);
    assert.equal(h.node('connect').textContent,'LINEで連携して試す');
  }
});
test('old index login errors use the shared fallback instead of internal error codes',async()=>{
  const h=harness('https://mimiobo-liff-test.vercel.app/');h.context.liff.isLoggedIn=()=>false;
  await h.run(read('app.js'));h.context.liff.isLoggedIn=()=>true;
  h.context.fetch=async()=>({ok:false,json:async()=>({error:'not_allowed'})});
  await h.node('connect').onclick();
  assert.equal(h.node('message').textContent,h.run("MimioboMessages.text('not_allowed')"));assert.equal(h.node('connect').disabled,false);
});
