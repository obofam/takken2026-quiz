const test=require('node:test');
const assert=require('node:assert/strict');
const {create,merge}=require('../sync.js');
const version='ep10-2026-09-15.v1';
const at='2026-09-17T00:00:00.000Z';
const attempt=(id='a',answers=[null,null,null],startedAt=at)=>({id,startedAt,answers});
const data=(...attempts)=>({version,attempts});
function storage(){const m=new Map();return {get length(){return m.size;},key:i=>[...m.keys()][i]??null,getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};}
function setup(){
  const disk=storage(),states=[],posts=[];
  let remote=data(),userId='u',online=true,beforeGet=null;
  const sync=create({userId:'u',storageKey:'user-u',storage:disk,validate:x=>x,onState:x=>states.push(x),fetch:async(url,options)=>{
    if(!online)throw Error('offline');
    const response=body=>({ok:true,status:200,json:async()=>structuredClone(body)});
    if(url==='/api/session')return response({userId});
    if(options.method==='POST'){
      assert.equal(options.headers['X-Mimiobo-User'],'u');
      const row=JSON.parse(options.body);posts.push(row);
      let a=remote.attempts.find(a=>a.id===row.attemptId);
      if(!a){a=attempt(row.attemptId,undefined,row.startedAt);remote.attempts.push(a);}
      const i=['ep10-money','ep10-join','ep10-add'].indexOf(row.questionId);
      if(!a.answers[i])a.answers[i]={value:row.value,at:row.answeredAt};
      return response({ok:true});
    }
    if(beforeGet){const fn=beforeGet;beforeGet=null;await fn();}
    return response(remote);
  }});
  return {sync,disk,states,posts,setRemote:x=>remote=x,setUser:x=>userId=x,setOnline:x=>online=x,onGet:x=>beforeGet=x};
}
test('server wins conflicts without dropping local unanswered retry',()=>{
  const local=data(attempt('a',[{value:false,at},null,null]),attempt('b',undefined,'2026-09-17T01:00:00Z'));
  const result=merge(local,data(attempt('a',[{value:true,at},null,null])));
  assert.equal(result.attempts[0].answers[0].value,true);
  assert.equal(result.attempts.at(-1).id,'b');
  assert.equal(local.attempts[0].answers[0].value,false);
});
test('restores server data and never uploads pre-existing local records',async()=>{
  const s=setup();s.disk.setItem(s.sync.key,JSON.stringify(data(attempt('legacy',[{value:true,at},null,null]))));
  s.setRemote(data(attempt('remote',[null,{value:false,at},null])));
  await s.sync.refresh();assert.equal(s.posts.length,0);assert.equal(s.sync.read().attempts.length,2);
});
test('offline answer persists in scoped queue and retries once online',async()=>{
  const s=setup(),a=attempt('new',[{value:null,at},null,null]);
  s.disk.setItem(s.sync.key,JSON.stringify(data(a)));s.setOnline(false);
  await s.sync.enqueue(a,0);assert.equal(s.states.at(-1),'pending');
  assert.ok(s.disk.getItem(s.sync.prefix+'new:0'));
  s.setOnline(true);await s.sync.refresh();
  assert.equal(s.posts.length,1);assert.equal(s.posts[0].value,null);
  assert.equal(s.disk.getItem(s.sync.prefix+'new:0'),null);assert.equal(s.states.at(-1),'synced');
  await s.sync.refresh();assert.equal(s.posts.length,1);
});
test('different session stops flushing and retains original user queue',async()=>{
  const s=setup();s.setUser('other');
  await s.sync.enqueue(attempt('a',[{value:true,at},null,null]),0);
  assert.equal(s.posts.length,0);assert.equal(s.states.at(-1),'unauthorized');
  assert.ok(s.disk.getItem(s.sync.prefix+'a:0'));
  await s.sync.refresh();assert.equal(s.posts.length,0);
});
test('remote conflicting immutable answer replaces pending answer without POST',async()=>{
  const s=setup(),a=attempt('a',[{value:false,at},null,null]);
  s.disk.setItem(s.sync.key,JSON.stringify(data(a)));
  s.setRemote(data(attempt('a',[{value:true,at},null,null])));
  await s.sync.enqueue(a,0);assert.equal(s.posts.length,0);
  assert.equal(s.sync.read().attempts[0].answers[0].value,true);
  assert.equal(s.disk.getItem(s.sync.prefix+'a:0'),null);
});
test('fetch hydration reads latest cache so another tab new attempt survives',async()=>{
  const s=setup();s.disk.setItem(s.sync.key,JSON.stringify(data(attempt('a'))));
  s.onGet(()=>s.disk.setItem(s.sync.key,JSON.stringify(data(attempt('a'),attempt('b',undefined,'2026-09-17T02:00:00Z')))));
  await s.sync.refresh();assert.equal(s.sync.read().attempts.at(-1).id,'b');
});
test('queue preserves slots from concurrent writers and ignores another user queue',async()=>{
  const s=setup();s.setOnline(false);
  await s.sync.enqueue(attempt('a',[{value:true,at},null,null]),0);
  await s.sync.enqueue(attempt('b',[null,{value:false,at},null]),1);
  s.disk.setItem('mimiobo-answer-queue-v1:other:c:0',JSON.stringify({attemptId:'c'}));
  s.setOnline(true);await s.sync.refresh();
  assert.deepEqual(s.posts.map(p=>p.attemptId),['a','b']);
  assert.ok(s.disk.getItem('mimiobo-answer-queue-v1:other:c:0'));
});
test('401 during answer POST stops syncing and leaves a durable retry record',async()=>{
  const disk=storage(),states=[];
  const sync=create({userId:'u',storageKey:'u',storage:disk,validate:x=>x,onState:x=>states.push(x),fetch:async(url,options)=>{
    if(options.method==='POST')return {status:401,ok:false};
    return {status:200,ok:true,json:async()=>url==='/api/session'?{userId:'u'}:data()};
  }});
  await sync.enqueue(attempt('a',[{value:true,at},null,null]),0);
  assert.equal(states.at(-1),'unauthorized');assert.equal(sync.active,false);
  assert.ok(disk.getItem(sync.prefix+'a:0'));
});

function failingSetup({postStatus=200,getStatus=200}={}){
  const disk=storage(),states=[],calls=[];
  const sync=create({userId:'u',storageKey:'u',storage:disk,validate:x=>x,onState:x=>states.push(x),fetch:async(url,options)=>{
    calls.push([url,options.method||'GET']);
    const status=url==='/api/session'?200:options.method==='POST'?postStatus:getStatus;
    return {status,ok:status===200,json:async()=>url==='/api/session'?{userId:'u'}:data()};
  }});
  return {sync,disk,states,calls};
}
for(const status of [400,409,422,500])test(`permanent POST ${status} quarantines the row across refresh and enqueue`,async()=>{
  const s=failingSetup({postStatus:status}),a=attempt('a',[{value:true,at},null,null]);
  await s.sync.enqueue(a,0);
  assert.equal(s.states.at(-1),'failed');
  assert.equal(s.disk.getItem(s.sync.prefix+'a:0'),null);
  const dead=JSON.parse(s.disk.getItem(s.sync.deadPrefix+'a:0'));
  assert.equal(dead.row.attemptId,'a');assert.equal(dead.status,status);
  await s.sync.refresh();await s.sync.enqueue(a,0);
  assert.equal(s.calls.filter(c=>c[1]==='POST').length,1);
  assert.equal(s.states.at(-1),'failed');
});
test('GET history limit quarantines blocked queued rows instead of leaving pending',async()=>{
  const s=failingSetup({getStatus:409});
  await s.sync.enqueue(attempt('a',[{value:true,at},null,null]),0);
  assert.equal(s.states.at(-1),'failed');assert.equal(s.disk.getItem(s.sync.prefix+'a:0'),null);
  assert.ok(s.disk.getItem(s.sync.deadPrefix+'a:0'));
  assert.equal(s.calls.filter(c=>c[1]==='POST').length,0);
});
test('503 retains durable queue and retries on next refresh',async()=>{
  const s=failingSetup({postStatus:503});
  await s.sync.enqueue(attempt('a',[{value:true,at},null,null]),0);
  assert.equal(s.states.at(-1),'pending');assert.ok(s.disk.getItem(s.sync.prefix+'a:0'));
  assert.equal(s.disk.getItem(s.sync.deadPrefix+'a:0'),null);
  await s.sync.refresh();assert.equal(s.calls.filter(c=>c[1]==='POST').length,2);
});
test('batch posts are followed by one GET, retaining unconfirmed rows without a loop',async()=>{
  const s=failingSetup();
  for(let i=0;i<3;i++)s.disk.setItem(s.sync.prefix+'a:'+i,JSON.stringify({attemptId:'a',questionId:['ep10-money','ep10-join','ep10-add'][i]}));
  await s.sync.refresh({sessionVerified:true});
  assert.deepEqual(s.calls.map(c=>c[1]),['GET','POST','POST','POST','GET']);
  assert.equal(s.calls.filter(c=>c[0]==='/api/session').length,0);
  assert.equal(s.states.at(-1),'pending');assert.ok(s.disk.getItem(s.sync.prefix+'a:0'));
  await s.sync.refresh();assert.equal(s.calls.filter(c=>c[0]==='/api/session').length,1);
});
test('durable enqueue storage failure is synchronous and does not start requests',()=>{
  const s=failingSetup();s.disk.setItem=()=>{throw Error('quota');};
  assert.throws(()=>s.sync.enqueue(attempt('a',[{value:true,at},null,null]),0),/quota/);
  assert.equal(s.calls.length,0);
});
test('failed dead-letter write preserves original queue row',async()=>{
  const s=failingSetup({postStatus:400}),write=s.disk.setItem;
  s.disk.setItem=(key,value)=>{if(key.startsWith(s.sync.deadPrefix))throw Error('quota');write(key,value);};
  await s.sync.enqueue(attempt('a',[{value:true,at},null,null]),0);
  assert.ok(s.disk.getItem(s.sync.prefix+'a:0'));assert.equal(s.states.at(-1),'failed');
});
test('scheduled refresh coalesces events for 2500ms and stop cancels it',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const s=failingSetup();s.sync.scheduleRefresh();t.mock.timers.tick(2000);s.sync.scheduleRefresh();
  t.mock.timers.tick(2499);assert.equal(s.calls.length,0);
  t.mock.timers.tick(1);await s.sync.refresh();
  assert.equal(s.calls.filter(c=>c[0]==='/api/session').length,1);
  s.sync.scheduleRefresh();s.sync.stop();t.mock.timers.tick(2500);
  assert.equal(s.calls.filter(c=>c[0]==='/api/session').length,1);
});
test('invalid row does not block another valid row in the same batch',async()=>{
  const disk=storage(),states=[],posts=[];let remote=data();
  const sync=create({userId:'u',storageKey:'u',storage:disk,validate:x=>x,onState:x=>states.push(x),fetch:async(url,options)=>{
    if(options.method==='POST'){
      const row=JSON.parse(options.body);posts.push(row.attemptId);
      if(row.attemptId==='bad')return {status:400,ok:false};
      remote=data(attempt('good',[{value:true,at},null,null]));
    }
    return {status:200,ok:true,json:async()=>url==='/api/session'?{userId:'u'}:structuredClone(remote)};
  }});
  for(const id of ['bad','good'])disk.setItem(sync.prefix+id+':0',JSON.stringify({attemptId:id,questionId:'ep10-money'}));
  await sync.refresh();assert.deepEqual(posts,['bad','good']);assert.equal(states.at(-1),'failed');
  assert.ok(disk.getItem(sync.deadPrefix+'bad:0'));assert.equal(disk.getItem(sync.prefix+'good:0'),null);
});
test('network loss after successful POST keeps its row durable until canonical restore',async()=>{
  const disk=storage(),states=[];let accepted=false,offlineAfterPost=true,posts=0;
  const sync=create({userId:'u',storageKey:'u',storage:disk,validate:x=>x,onState:x=>states.push(x),fetch:async(url,options)=>{
    if(options.method==='POST'){accepted=true;posts++;}
    else if(url!=='/api/session'&&accepted&&offlineAfterPost)throw Error('offline');
    return {status:200,ok:true,json:async()=>url==='/api/session'?{userId:'u'}:accepted?data(attempt('a',[{value:true,at},null,null])):data()};
  }});
  await sync.enqueue(attempt('a',[{value:true,at},null,null]),0);
  assert.equal(states.at(-1),'pending');assert.ok(disk.getItem(sync.prefix+'a:0'));
  offlineAfterPost=false;await sync.refresh();assert.equal(posts,1);
  assert.equal(states.at(-1),'synced');assert.equal(disk.getItem(sync.prefix+'a:0'),null);
});
