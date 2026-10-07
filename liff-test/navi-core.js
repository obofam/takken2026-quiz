'use strict';
// 学習ナビ「今週の3つ」の選び方（純関数）。rows は GET /api/karte の rows、catalog は quiz-catalog.js、now は ms。
// 3つは日本時間の月曜 0:00 に決まり、その週は変わらない：計算には「今週の月曜より前の記録」だけを使う。
// 今週の回答は done（済）の印にだけ使い、選び直さない。
(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./karte-core.js'):root.MimioboKarteCore);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MimioboNaviCore=api;
})(typeof window==='object'?window:globalThis,function(karteCore){
  const DAY=86400000,JST=9*3600000,LIMIT=3,RECHECK_DAYS=7;
  const time=value=>{const t=Date.parse(value);return Number.isFinite(t)?t:0;};
  // 日本時間の今週の月曜 0:00（UTC の ms）。
  function weekStart(now){
    const local=now+JST,midnight=Math.floor(local/DAY)*DAY;
    const sinceMonday=(new Date(midnight).getUTCDay()+6)%7;
    return midnight-sinceMonday*DAY-JST;
  }
  function pick(rows,catalog,now){
    const cat=catalog&&typeof catalog==='object'?catalog:{};
    const list=(Array.isArray(rows)?rows:[]).filter(r=>r&&typeof r==='object');
    if(!(typeof now==='number'&&Number.isFinite(now)))now=Date.now();
    const t0=weekStart(now);
    const past=list.filter(r=>time(r.answered_at)<t0);
    const thisWeek=new Set(list.filter(r=>time(r.answered_at)>=t0).map(r=>r.quiz_id));
    const ids=Object.keys(cat);                       // 台帳順
    const solved=new Set(past.map(r=>r.quiz_id).filter(id=>cat[id]));
    const used=new Set(),items=[];
    const make=(kind,quizId,reason,topic)=>{
      const q=cat[quizId];used.add(quizId);
      return {kind,quizId,episode:q.episode,title:q.title,topic:topic||'',page:q.page,audioUrl:q.audioUrl||'',reason,done:thisWeek.has(quizId)};
    };
    const reviews=karteCore.summarize(past,cat).review;
    const takeReview=()=>{
      const t=reviews.find(x=>!used.has(x.quizId));
      return t?make('review',t.quizId,'前回 '+t.correct+'/'+t.total+'問',t.topic):null;
    };
    // 次の回：今週より前に解いた回のうち番号が最大の回の次から台帳順（最後まで無ければ先頭から）。
    let from=0,top=-Infinity;
    ids.forEach((id,i)=>{if(solved.has(id)&&cat[id].episode>=top){top=cat[id].episode;from=i+1;}});
    const takeNext=()=>{
      for(let k=0;k<ids.length;k++){
        const id=ids[(from+k)%ids.length];
        if(!solved.has(id)&&!used.has(id))return make('next',id,'まだ解いていない回');
      }
      return null;
    };
    // 確かめ直し：直近が全問正解の回のうち、最後に解いてから7日以上の、いちばん古いもの。
    const takeRecheck=()=>{
      let best=null;
      for(const id of ids){
        if(used.has(id)||!solved.has(id))continue;
        const latest=new Map();let last=0;
        past.forEach(r=>{
          if(r.quiz_id!==id)return;
          const q=cat[id].questions.find(x=>x.id===r.question_id);if(!q)return;
          const at=time(r.answered_at),prev=latest.get(q.id);
          if(!prev||at>=prev.at)latest.set(q.id,{at,ok:r.value===q.answer});
          if(at>last)last=at;
        });
        const allRight=cat[id].questions.every(q=>latest.get(q.id)?.ok===true);
        const days=Math.floor((now-last)/DAY);
        if(allRight&&days>=RECHECK_DAYS&&(!best||last<best.last))best={id,last,days};
      }
      return best?make('recheck',best.id,'最後に解いてから'+best.days+'日'):null;
    };
    for(const take of [takeReview,takeNext,takeRecheck]){const item=take();if(item)items.push(item);}
    // 足りない枠：2件目以降の復習 → 次の回の続き。
    for(const take of [takeReview,takeNext])while(items.length<LIMIT){const item=take();if(!item)break;items.push(item);}
    return items.slice(0,LIMIT);
  }
  return {weekStart,pick};
});
