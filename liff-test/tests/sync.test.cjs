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
