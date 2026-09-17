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
    const deadPrefix='mimiobo-answer-dead-letter-v1:'+userId+':';
    let stopped=false,running=null,refreshTimer=null;
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
    function hasFailed(){
      for(let i=0;i<storage.length;i++)if(storage.key(i)?.startsWith(deadPrefix))return true;
      return false;
    }
    function quarantine(k,row,error){
      // Save first: a quota failure must never erase the only durable copy.
      storage.setItem(deadPrefix+k.slice(prefix.length),JSON.stringify({row,status:error.status||null}));
      storage.removeItem(k);
    }
    async function call(url,options={}){
      let response;
      try{response=await request(url,{...options,credentials:'same-origin',headers:{'X-Mimiobo-User':userId,...options.headers}});}
      catch(cause){throw Object.assign(Error('SYNC_NETWORK'),{retryable:true,cause});}
      if(response.status===401||response.status===403){stopped=true;state('unauthorized');throw Error('SESSION_CHANGED');}
      if(!response.ok)throw Object.assign(Error('SYNC_UNAVAILABLE'),{status:response.status,retryable:response.status===503});
      return response.json();
    }
    async function restore(){
      let remote;
      try{remote=validate(await call('/api/answers?quiz=ep10'));}
      catch(error){
        // A permanent GET failure (e.g. history_limit) would otherwise prevent
        // the queue reaching POST forever. Retain these rows outside retry work.
        if(error.status&&!error.retryable)for(const [k,row] of pending())quarantine(k,row,error);
        throw error;
      }
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
    function pump({sessionVerified=false}={}){
      if(stopped)return Promise.resolve();
      if(running)return running;
      running=(async()=>{
        try{
          state('syncing');
          if(!sessionVerified){
            const session=await call('/api/session');
            if(session.userId!==userId){stopped=true;state('unauthorized');return;}
          }
          await restore();
          const sent=new Set();
          // Entries added while a request is in flight are included in the next pass.
          while(!stopped){
            let posted=false;
            for(;;){
              const entry=pending().find(([k])=>!sent.has(k));if(!entry)break;
              const [k,row]=entry;
              try{await call('/api/answers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(row)});}
              catch(error){
                if(stopped||error.retryable)throw error;
                quarantine(k,row,error);continue;
              }
              if(stopped)return;
              sent.add(k);posted=true;
            }
            if(stopped)return;
            // One canonical read per batch, retaining durable rows until confirmed.
            if(posted)await restore();
            if(!pending().some(([k])=>!sent.has(k)))break;
          }
          if(!stopped)state(hasFailed()?'failed':pending().length?'pending':'synced');
        }catch(e){
          if(!stopped){
            let next='failed';
            if(e.retryable){try{if(!hasFailed())next='pending';}catch{}}
            state(next);
          }
        }
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
      if(storage.getItem(deadPrefix+attempt.id+':'+index)!==null){state('failed');return Promise.resolve();}
      // One key per immutable slot avoids one tab replacing another tab's queue.
      if(storage.getItem(k)===null)storage.setItem(k,JSON.stringify(row));
      state('pending');return pump();
    }
    function scheduleRefresh(){
      if(stopped)return;
      clearTimeout(refreshTimer);
      refreshTimer=setTimeout(()=>{refreshTimer=null;void pump();},2500);
    }
    return {key,prefix,deadPrefix,get active(){return !stopped;},read,enqueue,refresh:pump,scheduleRefresh,stop(){clearTimeout(refreshTimer);stopped=true;state('unauthorized');}};
  }
  return {create,merge};
});
