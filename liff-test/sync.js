'use strict';
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MimioboSync=api;
})(typeof window==='object'?window:globalThis,function(){
  const version='ep10-2026-09-15.v1';
  const questionIds=['ep10-money','ep10-join','ep10-add'];
  const clone=value=>JSON.parse(JSON.stringify(value));
  function merge(local,server){
    const attempts=new Map(local.attempts.map(a=>[a.id,clone(a)]));
    for(const remote of server.attempts){
      const a=attempts.get(remote.id)||clone(remote);
      a.startedAt=remote.startedAt;
      remote.answers.forEach((answer,i)=>{if(answer!==null)a.answers[i]=clone(answer);});
      attempts.set(a.id,a);
    }
    return {version,attempts:[...attempts.values()].sort((a,b)=>Date.parse(a.startedAt)-Date.parse(b.startedAt)||a.id.localeCompare(b.id))};
  }
  function create({userId,storageKey,storage,fetch:request,validate,onData=()=>{},onState=()=>{}}){
    const key=storageKey+'-ep10-v1',prefix='mimiobo-answer-queue-v1:'+userId+':';
    let stopped=false,running=null;
    function state(value){onState(value);}
    function read(){const raw=storage.getItem(key);return raw===null?{version,attempts:[]}:validate(JSON.parse(raw));}
    function pending(){
      const rows=[];
      for(let i=0;i<storage.length;i++){
        const k=storage.key(i);
        if(k&&k.startsWith(prefix))rows.push([k,JSON.parse(storage.getItem(k))]);
      }
      return rows;
    }
    async function call(url,options={}){
      const response=await request(url,{...options,credentials:'same-origin',headers:{'X-Mimiobo-User':userId,...options.headers}});
      if(response.status===401||response.status===403){stopped=true;state('unauthorized');throw Error('SESSION_CHANGED');}
      if(!response.ok)throw Error('SYNC_UNAVAILABLE');
      return response.json();
    }
    async function restore(){
      const remote=validate(await call('/api/answers?quiz=ep10'));
      if(stopped)return;
      // Read again after the request: another tab may have saved during the fetch.
      const baseline=storage.getItem(key),local=baseline===null?{version,attempts:[]}:validate(JSON.parse(baseline));
      const next=validate(merge(local,remote));
      if(storage.getItem(key)!==baseline)throw Error('CACHE_CHANGED');
      storage.setItem(key,JSON.stringify(next));
      // A server answer is immutable. Remove any pending duplicate/conflicting slot.
      for(const [k,row] of pending()){
        const a=remote.attempts.find(a=>a.id===row.attemptId);
        if(a&&a.answers[questionIds.indexOf(row.questionId)])storage.removeItem(k);
      }
      onData(next);
    }
    function pump(){
      if(stopped)return Promise.resolve();
      if(running)return running;
      running=(async()=>{
        state('syncing');
        try{
          const session=await call('/api/session');
          if(session.userId!==userId){stopped=true;state('unauthorized');return;}
          await restore();
          // Entries added while a request is in flight are included in the next pass.
          while(!stopped){
            const entry=pending()[0];if(!entry)break;
            const [k,row]=entry;
            await call('/api/answers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(row)});
            if(stopped)return;
            // Keep the row durable until GET confirms the canonical server value.
            await restore();
            if(storage.getItem(k)!==null)throw Error('ANSWER_NOT_CONFIRMED');
          }
          if(!stopped)state('synced');
        }catch(e){if(!stopped)state('pending');}
        finally{running=null;}
      })();
      return running;
    }
    function enqueue(attempt,index){
      if(stopped)throw Error('SESSION_CHANGED');
      const answer=attempt.answers[index];
      if(!answer||!questionIds[index])return;
      const row={attemptId:attempt.id,quizId:'ep10',startedAt:attempt.startedAt,questionId:questionIds[index],value:answer.value,answeredAt:answer.at};
      const k=prefix+attempt.id+':'+index;
      // One key per immutable slot avoids one tab replacing another tab's queue.
      if(storage.getItem(k)===null)storage.setItem(k,JSON.stringify(row));
      state('pending');return pump();
    }
    return {key,prefix,get active(){return !stopped;},read,enqueue,refresh:pump,stop(){stopped=true;state('unauthorized');}};
  }
  return {create,merge};
});
