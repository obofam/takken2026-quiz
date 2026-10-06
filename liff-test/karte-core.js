'use strict';
// 学習カルテの集計（純関数）。rows は GET /api/karte の rows、catalog は quiz-catalog.js。
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MimioboKarteCore=api;
})(typeof window==='object'?window:globalThis,function(){
  const SUBJECTS=['宅建業法','権利関係','法令上の制限','税・その他'];
  const time=value=>{const t=Date.parse(value);return Number.isFinite(t)?t:0;};
  // 正解は value===answer。null（まだ分からない）は不正解として数える。
  function summarize(rows,catalog){
    const list=Array.isArray(rows)?rows:[],cat=catalog&&typeof catalog==='object'?catalog:{};
    const entries=new Map(),episodes=new Set();
    let answers=0;
    // 台帳にある順を保つため、先に台帳から枠を作る（回答が付いた枠だけ後で使う）。
    for(const [quizId,quiz] of Object.entries(cat))for(const q of quiz.questions||[]){
      entries.set(quizId+'\u0000'+q.id,{quizId,quiz,q,correct:0,total:0,latestAt:-1,latestCorrect:false,seq:-1});
    }
    list.forEach((row,seq)=>{
      const entry=row&&entries.get(row.quiz_id+'\u0000'+row.question_id);
      if(!entry)return;
      const ok=row.value===entry.q.answer,at=time(row.answered_at);
      entry.total++;if(ok)entry.correct++;answers++;episodes.add(row.quiz_id);
      // 直近の回答。同時刻は後から来た行を新しいとみなす。
      if(at>=entry.latestAt){entry.latestAt=at;entry.latestCorrect=ok;entry.seq=seq;}
    });
    const used=[...entries.values()].filter(e=>e.total>0);
    const subjectTotals=new Map(SUBJECTS.map(name=>[name,{name,correct:0,total:0}]));
    for(const e of used){
      if(!subjectTotals.has(e.quiz.subject))subjectTotals.set(e.quiz.subject,{name:e.quiz.subject,correct:0,total:0});
      const s=subjectTotals.get(e.quiz.subject);s.correct+=e.correct;s.total+=e.total;
    }
    const subjects=[...subjectTotals.values()].filter(s=>s.total>0);
    const toTopic=e=>({quizId:e.quizId,questionId:e.q.id,topic:e.q.topic,subject:e.quiz.subject,episode:e.quiz.episode,audioUrl:e.quiz.audioUrl,page:e.quiz.page,correct:e.correct,total:e.total,latestCorrect:e.latestCorrect});
    const topics=used.map(toTopic);
    // 復習：直近が正解でないもの。正答率の低い順、同率なら直近が古い順。
    const review=used.filter(e=>!e.latestCorrect)
      .sort((a,b)=>a.correct*b.total-b.correct*a.total||a.latestAt-b.latestAt)
      .map(toTopic);
    return {stats:{episodes:episodes.size,answers,review:review.length},subjects,topics,review};
  }
  return {SUBJECTS,summarize};
});
