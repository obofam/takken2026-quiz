'use strict';
// navi-core.js: 学習ナビ「今週の3つ」の選び方。週の境界は日本時間の月曜 0:00。
const test=require('node:test');
const assert=require('node:assert/strict');
const navi=require('../navi-core.js');
const DAY=86400000;
const at=s=>Date.parse(s);
// 2026-10-07（水）。今週の月曜 0:00 JST = 2026-10-04T15:00:00Z。
const NOW=at('2026-10-07T03:00:00Z'),MONDAY=at('2026-10-04T15:00:00Z');
function catalogOf(n){
  const c={};
  for(let i=1;i<=n;i++)c['ep'+i]={episode:i,title:'題'+i,subject:'宅建業法',audioUrl:i%2?'https://stand.fm/episodes/x'+i:'',page:'ep10-preview.html?ep='+i,
    questions:[1,2,3].map(k=>({id:'ep'+i+'-q'+k,topic:'論点'+i+'-'+k,text:'t',answer:true,explanation:'e'}))};
  return c;
}
// 回の3問に同じ値で答えた行。
const solve=(i,iso,value=true)=>[1,2,3].map(k=>({quiz_id:'ep'+i,question_id:'ep'+i+'-q'+k,value,answered_at:iso,attempt_id:'a'}));
const ids=items=>items.map(x=>x.quizId);

test('weekStart: Monday 0:00 JST; Sunday 23:59 JST still belongs to the previous week',()=>{
  assert.equal(navi.weekStart(at('2026-10-11T14:59:59Z')),MONDAY);
  assert.equal(navi.weekStart(at('2026-10-11T15:00:00Z')),at('2026-10-11T15:00:00Z'));
  assert.equal(navi.weekStart(MONDAY),MONDAY);
  assert.equal(navi.weekStart(NOW),MONDAY);
});
test('no records: the first episode of the ledger, as 次の回',()=>{
  const items=navi.pick([],catalogOf(5),NOW);
  assert.equal(items.length,3);
  assert.deepEqual(items[0],{kind:'next',quizId:'ep1',episode:1,title:'題1',topic:'',page:'ep10-preview.html?ep=1',audioUrl:'https://stand.fm/episodes/x1',reason:'まだ解いていない回',done:false});
  assert.deepEqual(ids(items),['ep1','ep2','ep3']);
  assert.ok(items.every(x=>x.kind==='next'));
});
test('review: latest wrong comes first with これまで n/m問 and the question topic; next continues after the highest solved episode',()=>{
  const rows=[...solve(1,'2026-09-20T00:00:00Z'),{quiz_id:'ep2',question_id:'ep2-q1',value:false,answered_at:'2026-09-21T00:00:00Z'},...solve(2,'2026-09-21T00:00:01Z').slice(1)];
  const items=navi.pick(rows,catalogOf(6),NOW);
  assert.equal(items[0].kind,'review');assert.equal(items[0].quizId,'ep2');assert.equal(items[0].reason,'これまで 0/1問');assert.equal(items[0].topic,'論点2-1');
  assert.equal(items[1].kind,'next');assert.equal(items[1].quizId,'ep3');
});
test('次の回 wraps around to the start when nothing is left after the highest solved episode',()=>{
  const rows=[...solve(3,'2026-09-20T00:00:00Z')];
  const items=navi.pick(rows,catalogOf(3),NOW);
  assert.equal(items.find(x=>x.kind==='next').quizId,'ep1');
  // the highest episode is judged by number, not by solving order
  const rows2=[...solve(2,'2026-09-20T00:00:00Z'),...solve(1,'2026-09-21T00:00:00Z')];
  assert.equal(navi.pick(rows2,catalogOf(4),NOW).find(x=>x.kind==='next').quizId,'ep3');
});
test('recheck: all-correct episodes untouched for 7 days or more, oldest first',()=>{
  const rows=[...solve(1,'2026-09-25T00:00:00Z'),...solve(2,'2026-09-20T00:00:00Z'),...solve(3,'2026-10-02T00:00:00Z')];
  const items=navi.pick(rows,catalogOf(6),NOW);
  const re=items.find(x=>x.kind==='recheck');
  assert.equal(re.quizId,'ep2');assert.equal(re.reason,'最後に解いてから17日');
  // 6 days is too early; an episode whose latest answer is wrong is not rechecked
  const none=navi.pick([...solve(1,'2026-10-01T10:00:00Z')],catalogOf(6),NOW);
  assert.equal(none.some(x=>x.kind==='recheck'),false);
  const wrong=navi.pick([...solve(1,'2026-09-01T00:00:00Z',false)],catalogOf(6),NOW);
  assert.equal(wrong.some(x=>x.kind==='recheck'),false);
});
test('an episode appears once; short slots are filled by more reviews, then by continuing 次の回',()=>{
  // no recheck candidate: ep1 and ep2 are both wrong, ep3 onward unsolved
  const rows=[...solve(1,'2026-09-20T00:00:00Z',false),...solve(2,'2026-09-21T00:00:00Z',false)];
  const items=navi.pick(rows,catalogOf(8),NOW);
  assert.deepEqual(items.map(x=>x.kind+':'+x.quizId),['review:ep1','next:ep3','review:ep2']);
  for(const list of [items,navi.pick([],catalogOf(8),NOW),navi.pick(solve(1,'2026-09-01T00:00:00Z'),catalogOf(8),NOW)])assert.equal(new Set(ids(list)).size,list.length);
  // with a recheck present the three are review / next / recheck
  const full=navi.pick([...solve(1,'2026-09-01T00:00:00Z'),...solve(2,'2026-09-20T00:00:00Z',false)],catalogOf(8),NOW);
  assert.deepEqual(full.map(x=>x.kind),['review','next','recheck']);
});
test('a small ledger gives fewer than three, never a repeat',()=>{
  assert.deepEqual(ids(navi.pick([],catalogOf(2),NOW)),['ep1','ep2']);
  assert.deepEqual(navi.pick([],{},NOW),[]);
  assert.deepEqual(navi.pick(null,null,NOW),[]);
  const all=navi.pick([...solve(1,'2026-09-20T00:00:00Z'),...solve(2,'2026-09-20T00:00:00Z')],catalogOf(2),NOW);
  assert.deepEqual(all.map(x=>x.kind),['recheck']);
});
test('week boundary: an answer at Sunday 23:59 JST counts for the old week, Monday 0:00 JST starts the new one',()=>{
  const cat=catalogOf(5),row=solve(1,'2026-10-11T14:59:00Z',false);
  // still Sunday: the wrong ep1 is this week's answer, so it is not used to choose, and it shows as done on the first episode
  const sun=navi.pick(row,cat,at('2026-10-11T14:59:30Z'));
  assert.deepEqual(sun.map(x=>x.kind+':'+x.quizId+':'+x.done),['next:ep1:true','next:ep2:false','next:ep3:false']);
  // Monday 0:00 JST: that answer is now before the week, so it feeds the review
  const mon=navi.pick(row,cat,at('2026-10-11T15:00:00Z'));
  assert.equal(mon[0].kind,'review');assert.equal(mon[0].quizId,'ep1');assert.equal(mon[0].done,false);
});
test('answers this week only mark done; the three never change during the week',()=>{
  const past=[...solve(1,'2026-09-20T00:00:00Z',false),...solve(2,'2026-09-01T00:00:00Z')];
  const before=navi.pick(past,catalogOf(6),NOW);
  const solvedNext=before.find(x=>x.kind==='next');
  const thisWeek=[...solve(1,'2026-10-06T00:00:00Z'),...solve(+solvedNext.quizId.slice(2),'2026-10-06T01:00:00Z')];
  const after=navi.pick([...past,...thisWeek],catalogOf(6),NOW);
  assert.deepEqual(after.map(x=>x.kind+':'+x.quizId),before.map(x=>x.kind+':'+x.quizId));
  assert.ok(after.find(x=>x.kind==='review').done&&solvedNext&&after.find(x=>x.kind==='next').done);
  assert.equal(after.find(x=>x.kind==='review').reason,before.find(x=>x.kind==='review').reason);
  assert.ok(before.every(x=>x.done===false));
});
