'use strict';
// Sprint 2 UI flow: always server mode; logged out = this device only; login merges guest answers into the account.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {randomUUID}=require('node:crypto');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const session={userId:'12345678-1234-4123-8123-123456789abc',storageKey:'mimiobo-test-v1-'+'a'.repeat(64)};
const GUEST_KEY='mimiobo-guest-v1-ep10-v1',cacheKey=session.storageKey+'-ep10-v1';
const plain='https://mimiobo-liff-test.vercel.app/ep10-preview.html';
function storage(){const values=new Map();return {values,get length(){return values.size;},key:i=>[...values.keys()][i]??null,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};}
function harness(url=plain){
  const nodes=new Map(),requests=[],refreshes=[],events=[];
  const node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:id==='karte'||id==='retrySave',disabled:true,textContent:'',children:[],replaceChildren(){},append(){},querySelectorAll:()=>[],setAttribute(){}});return nodes.get(id);};
  const context=vm.createContext({URL,URLSearchParams,AbortSignal,console,crypto:{randomUUID},location:new URL(url),localStorage:storage(),sessionStorage:storage(),
    CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},Event:class{constructor(type){this.type=type;}},
    addEventListener(){},dispatchEvent:event=>events.push(event),scrollTo(){}});
  context.window=context;
  context.history={replaceState(_state,_title,next){context.location=new URL(next,context.location);}};
  context.liff={init:async()=>{},isLoggedIn:()=>true,getIDToken:()=>'test-line-token',login(){assert.fail('unexpected redirect');}};
  context.fetch=async(url,options={})=>{requests.push({url,options});return {ok:true,status:200,json:async()=>session};};
  context.MimioboSync={create:options=>({key:options.storageKey+'-ep10-v1',active:true,stop(){},enqueue(){},refresh:async settings=>refreshes.push(settings),scheduleRefresh(){}})};
  context.document={documentElement:{dataset:{}},getElementById:node,querySelectorAll:()=>[],createElement:()=>({}),head:{append(script){
    if(['/ui-messages.js','/auth-client.js'].includes(script.src))vm.runInContext(read(script.src.slice(1)),context);
    else assert.equal(script.src,'/sync.js');
    script.onload();
  }}};
  function preview(){
    const script=read('ep10-preview.html').match(/<script>\s*([\s\S]*?)<\/script>/)[1];
    vm.runInContext(script.replace(/initialize\(\);\s*$/,''),context);
    vm.runInContext('paintQuestions=()=>{};paintAnswer=()=>{};results=()=>{};',context);
  }
  return {context,node,requests,refreshes,preview,run:code=>vm.runInContext(code,context)};
}
const attemptRow=(id,startedAt,answers)=>({id,startedAt,answers});
const data=(...attempts)=>JSON.stringify({version:'ep10-2026-09-15.v1',attempts});
const A1=attemptRow('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa','2026-10-01T00:00:00.000Z',[{value:true,at:'2026-10-01T00:00:05.000Z'},{value:false,at:'2026-10-01T00:00:09.000Z'},null]);
const A2=attemptRow('bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb','2026-10-02T00:00:00.000Z',[null,null,{value:null,at:'2026-10-02T00:00:07.000Z'}]);
const EXISTING=attemptRow('cccccccc-3333-4333-8333-cccccccccccc','2026-09-30T00:00:00.000Z',[{value:true,at:'2026-09-30T00:00:01.000Z'},null,null]);
const loggedOut=h=>{h.context.liff.isLoggedIn=()=>false;h.context.fetch=async(url,options={})=>{h.requests.push({url,options});return {ok:false,status:401,json:async()=>({error:'login_required'})};};};
const recordingSync=(queued,{fail=false,refreshes}={})=>({create:options=>({key:options.storageKey+'-ep10-v1',active:true,stop(){},
  read:()=>options.validate(JSON.parse(options.storage.getItem(options.storageKey+'-ep10-v1')??'{"version":"ep10-2026-09-15.v1","attempts":[]}')),
  enqueue(attempt,index){if(fail)throw Error('quota');queued.push([attempt.id,index,attempt.answers[index].value]);},
  refresh:async settings=>refreshes?.push(settings),scheduleRefresh(){}})});

test('logged out: ?server=1 is not needed, answers stay on this device, nothing is sent',async()=>{
  for(const url of [plain,plain+'?server=1']){
    const h=harness(url);loggedOut(h);h.preview();await h.run('initialize()');
    assert.equal(h.run('canAnswer'),true);assert.equal(h.run('answerSync'),null);
    assert.equal(h.node('storageScope').textContent,'記録：この端末に保存');
    assert.equal(h.node('signinPrompt').hidden,false,'sign-in card stays for logged-out visitors');
    assert.equal(h.node('account').hidden,false);
    h.run('answer(0,true);answer(1,null)');
    const saved=JSON.parse(h.context.localStorage.getItem(GUEST_KEY));
    assert.equal(saved.attempts.length,1);assert.deepEqual(saved.attempts[0].answers.map(a=>a&&a.value),[true,null,null]);
    assert.deepEqual(h.requests.map(r=>r.url),['/api/session'],'only the session probe, no answer POST');
    assert.equal(h.refreshes.length,0);
  }
});
test('logged out: guest answers are restored on the next visit from the fixed guest key',async()=>{
  const h=harness();loggedOut(h);
  h.context.localStorage.setItem(GUEST_KEY,data(A1));
  h.preview();await h.run('initialize()');
  assert.equal(h.run('answers[0].value'),true);assert.equal(h.run('progressStore.current.id'),A1.id);
  assert.equal(h.run('canAnswer'),true);
});
test('logged out: LIFF or session failures still leave the quiz answerable on this device without hiding the error',async()=>{
  const h=harness();h.context.liff.init=async()=>{throw Error('INTERNAL_SECRET_TOKEN');};
  h.preview();h.run(read('ui-messages.js'));await h.run('initialize()');
  assert.equal(h.node('saveStatus').textContent,h.run('MimioboMessages.fallback'));
  assert.equal(h.run('canAnswer'),true);assert.equal(h.context.document.documentElement.dataset.syncState,'unavailable');
  h.run('answer(0,true)');assert.equal(JSON.parse(h.context.localStorage.getItem(GUEST_KEY)).attempts.length,1);
});
test('login merges guest attempts into the account cache, queues every answer once and removes the guest copy',async()=>{
  const h=harness(),queued=[];
  h.context.localStorage.setItem(GUEST_KEY,data(A1,A2));h.context.localStorage.setItem(cacheKey,data(EXISTING));
  h.context.MimioboSync=recordingSync(queued,{refreshes:h.refreshes});
  h.preview();await h.run('initialize()');
  assert.deepEqual(queued,[[A1.id,0,true],[A1.id,1,false],[A2.id,2,null]]);
  assert.equal(h.context.localStorage.getItem(GUEST_KEY),null);
  assert.deepEqual(JSON.parse(h.context.localStorage.getItem(cacheKey)).attempts.map(a=>a.id),[EXISTING.id,A1.id,A2.id]);
  assert.equal(h.node('storageScope').textContent,'記録：アカウントに保存');
  assert.equal(h.refreshes.length,1);assert.equal(h.run('progressStore.data.attempts.length'),3);
});
test('guest merge does not duplicate an attempt already cached, and a queue failure keeps the guest copy for the next load',async()=>{
  const h=harness(),queued=[];
  h.context.localStorage.setItem(GUEST_KEY,data(A1));h.context.localStorage.setItem(cacheKey,data(A1));
  h.context.MimioboSync=recordingSync(queued,{fail:true});
  h.preview();await h.run('initialize()');
  assert.equal(JSON.parse(h.context.localStorage.getItem(cacheKey)).attempts.length,1);
  assert.notEqual(h.context.localStorage.getItem(GUEST_KEY),null,'guest copy retained');
  const again=harness();again.context.localStorage=h.context.localStorage;
  again.context.MimioboSync=recordingSync(queued);again.preview();await again.run('initialize()');
  assert.deepEqual(queued,[[A1.id,0,true],[A1.id,1,false]]);assert.equal(h.context.localStorage.getItem(GUEST_KEY),null);
  assert.equal(JSON.parse(h.context.localStorage.getItem(cacheKey)).attempts.length,1);
});
test('a corrupt guest copy is left untouched and never blocks login',async()=>{
  const h=harness(),queued=[];
  h.context.localStorage.setItem(GUEST_KEY,'{not json');h.context.MimioboSync=recordingSync(queued,{refreshes:h.refreshes});
  h.preview();await h.run('initialize()');
  assert.equal(h.context.localStorage.getItem(GUEST_KEY),'{not json');assert.equal(queued.length,0);assert.equal(h.refreshes.length,1);
});
test('end to end with the real sync queue: guest answers reach the server once, the queue drains, the guest copy is gone',async()=>{
  const h=harness(),posted=[],server=new Map();
  h.context.MimioboSync=require('../sync.js');
  h.context.fetch=async(url,options={})=>{
    h.requests.push({url,options});
    if(url==='/api/session')return {ok:true,status:200,json:async()=>session};
    if(url==='/api/answers?quiz=ep10')return {ok:true,status:200,json:async()=>({version:'ep10-2026-09-15.v1',attempts:[...server.values()]})};
    assert.equal(url,'/api/answers');assert.equal(options.method,'POST');assert.equal(options.headers['X-Mimiobo-User'],session.userId);
    const row=JSON.parse(options.body);posted.push(row);
    const a=server.get(row.attemptId)||{id:row.attemptId,startedAt:row.startedAt,answers:[null,null,null]};
    a.answers[['ep10-money','ep10-join','ep10-add'].indexOf(row.questionId)]={value:row.value,at:row.answeredAt};server.set(a.id,a);
    return {ok:true,status:200,json:async()=>({ok:true})};
  };
  const store=h.context.localStorage;store.setItem(GUEST_KEY,data(A1,A2));
  h.preview();await h.run('initialize()');
  assert.deepEqual(posted.map(r=>[r.attemptId,r.questionId,r.value]).sort(),[[A1.id,'ep10-join',false],[A1.id,'ep10-money',true],[A2.id,'ep10-add',null]].sort());
  assert.equal(store.getItem(GUEST_KEY),null);
  assert.equal([...store.values.keys()].filter(k=>k.startsWith('mimiobo-answer-queue-v1:')).length,0,'queue drained');
  assert.equal(JSON.parse(store.getItem(cacheKey)).attempts.length,2);
  assert.equal(h.context.document.documentElement.dataset.syncState,'synced');
});
test('?checkout=cancel shows the cancellation message and removes the parameter',async()=>{
  const h=harness(plain+'?checkout=cancel#account');h.preview();await h.run('initialize()');
  assert.equal(h.node('accountMessage').textContent,'決済を中止しました。');
  assert.equal(h.context.location.search,'');assert.equal(h.context.location.hash,'#account');
  const none=harness();none.preview();await none.run('initialize()');assert.equal(none.node('accountMessage').textContent,'');
});
test('ep10-preview has no ?server=1 switch left and keeps its existing element ids',()=>{
  const html=read('ep10-preview.html');
  assert.doesNotMatch(html,/serverMode/);assert.doesNotMatch(html,/get\('server'\)/);
  for(const id of ['storageScope','retrySave','connectLine','saveStatus','intro','signinPrompt','signinPromptLine','quiz','quizList','results','karte','account','accountStatus','accountLoggedOut','accountLoggedIn','accountLine','accountEmail','accountEmailSend','accountLinkLine','accountLinkPending','accountLinkPendingGo','accountLinkNote','accountLinkEmail','accountLinkEmailSend','accountLogout','accountMessage','syncStatus','showKarte','openKarte','restart','backResults'])
    assert.match(html,new RegExp('id="'+id+'"'),id);
});
