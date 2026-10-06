'use strict';
// 学習カルテの集計（karte-core.js）と問題の台帳（quiz-catalog.js）。
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {summarize,SUBJECTS}=require('../karte-core');
const catalog=require('../quiz-catalog');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const row=(question,value,at,attempt='a1',quiz='ep10')=>({quiz_id:quiz,question_id:question,value,answered_at:at,attempt_id:attempt});
const day=n=>'2026-10-0'+n+'T00:00:00.000Z';

test('the page reads its questions from the catalog; the static first paint matches the catalog (ep10)',()=>{
  const html=read('ep10-preview.html');
  assert.ok(!/const questions=\[/.test(html),'no questions are written into the page any more');
  assert.ok(html.includes('<script src="/quiz-catalog.js"></script>'));
  assert.ok(html.includes('第10回 · '+catalog.ep10.title));
  assert.ok(html.includes('音声で聴く（約'+catalog.ep10.audioMinutes+'分）'));
  assert.equal(catalog.ep10.episode,10);assert.equal(catalog.ep10.page,'ep10-preview.html?ep=10');
});
test('ep10 keeps the ids, answers and order that existing records were saved under',()=>{
  assert.deepEqual(catalog.ep10.questions.map(({id,topic,answer})=>({id,topic,answer})),[
    {id:'ep10-money',topic:'営業保証金の金額',answer:true},
    {id:'ep10-join',topic:'新規加入時の納付期限',answer:false},
    {id:'ep10-add',topic:'事務所増設時の納付期限',answer:true}
  ]);
  assert.equal(catalog.ep10.audioUrl,'https://stand.fm/episodes/69dc7ba498eff95c436a4549');
});
test('catalog entries are well formed: one of the four subjects, an existing page, exactly 3 full questions with unique ids',()=>{
  const ids=new Set();
  for(const [quizId,quiz] of Object.entries(catalog)){
    assert.ok(SUBJECTS.includes(quiz.subject),quizId);
    assert.equal(quizId,'ep'+quiz.episode);
    assert.ok(Number.isInteger(quiz.episode)&&quiz.title&&/^https:\/\//.test(quiz.audioUrl),quizId);
    assert.equal(quiz.page,'ep10-preview.html?ep='+quiz.episode);
    assert.ok(fs.existsSync(path.join(__dirname,'..',quiz.page.split('?')[0])),quiz.page);
    assert.equal(quiz.questions.length,3,quizId);
    for(const q of quiz.questions){
      assert.equal(typeof q.answer,'boolean');assert.ok(q.topic);assert.ok(!ids.has(q.id),q.id);ids.add(q.id);
      assert.match(q.id,new RegExp('^'+quizId+'-[a-z0-9]{1,16}$'));
      for(const key of ['text','explanation','law'])assert.ok(typeof q[key]==='string'&&q[key].length>0,quizId+' '+q.id+' '+key);
    }
  }
  assert.deepEqual(SUBJECTS,['宅建業法','権利関係','法令上の制限','税・その他']);
});
test('the answer API and the sync queue take their question ids from the catalog, not from a copy',()=>{
  assert.ok(read('api/answers.js').includes("require('../quiz-catalog')"));
  assert.ok(!/QUESTIONS=\['/.test(read('api/answers.js')));
  assert.ok(read('sync.js').includes("require('./quiz-catalog')")&&!/questionIds=\['/.test(read('sync.js')));
});

test('empty input gives zero stats and no sections',()=>{
  for(const rows of [[],null,undefined,'x']){
    assert.deepEqual(summarize(rows,catalog),{stats:{episodes:0,answers:0,review:0},subjects:[],topics:[],review:[]});
  }
});
test('one correct answer: counted once, no review, only the answered subject appears',()=>{
  const s=summarize([row('ep10-money',true,day(1))],catalog);
  assert.deepEqual(s.stats,{episodes:1,answers:1,review:0});
  assert.deepEqual(s.subjects,[{name:'宅建業法',correct:1,total:1}]);
  assert.deepEqual(s.topics,[{quizId:'ep10',questionId:'ep10-money',topic:'営業保証金の金額',subject:'宅建業法',episode:10,audioUrl:catalog.ep10.audioUrl,page:'ep10-preview.html?ep=10',correct:1,total:1,latestCorrect:true}]);
  assert.deepEqual(s.review,[]);
});
test('retries change the rate: a later wrong answer puts the topic back in review, a later right one takes it out',()=>{
  // ep10-join の正解は false。
  let s=summarize([row('ep10-join',true,day(1),'a1'),row('ep10-join',false,day(2),'a2')],catalog);
  assert.equal(s.topics[0].correct,1);assert.equal(s.topics[0].total,2);assert.equal(s.topics[0].latestCorrect,true);assert.equal(s.review.length,0);
  assert.deepEqual(s.subjects,[{name:'宅建業法',correct:1,total:2}]);
  s=summarize([row('ep10-join',false,day(1),'a1'),row('ep10-join',true,day(2),'a2')],catalog);
  assert.equal(s.topics[0].latestCorrect,false);assert.deepEqual(s.review.map(t=>t.questionId),['ep10-join']);
  assert.equal(s.stats.answers,2);
});
test('the latest answer is decided by answered_at, not by the order of the rows',()=>{
  const s=summarize([row('ep10-money',true,day(3),'a2'),row('ep10-money',false,day(1),'a1')],catalog);
  assert.equal(s.topics[0].latestCorrect,true);assert.equal(s.review.length,0);
});
test('"still unsure" (value null) counts as wrong, in the total and in review',()=>{
  const s=summarize([row('ep10-money',null,day(1)),row('ep10-add',true,day(1))],catalog);
  assert.deepEqual(s.subjects,[{name:'宅建業法',correct:1,total:2}]);
  assert.deepEqual(s.stats,{episodes:1,answers:2,review:1});
  assert.deepEqual(s.review.map(t=>[t.questionId,t.correct,t.total,t.latestCorrect]),[['ep10-money',0,1,false]]);
});
test('rows for quizzes or questions that are not in the catalog are ignored',()=>{
  const s=summarize([row('ep10-money',true,day(1)),row('ep99-x',true,day(1),'a9','ep99'),row('ep10-nope',true,day(1)),row('ep10-money',true,day(1),'a8','ep99'),null,{}],catalog);
  assert.deepEqual(s.stats,{episodes:1,answers:1,review:0});assert.equal(s.topics.length,1);
  assert.deepEqual(summarize([row('x',true,day(1),'a','zz')],catalog).stats,{episodes:0,answers:0,review:0});
});
test('subjects are summed per subject in the fixed order, and a new episode only needs a catalog entry',()=>{
  const wide={...catalog,
    ep14:{episode:14,title:'抵当権',subject:'権利関係',audioUrl:'https://example.com/ep14',page:'ep14.html',questions:[{id:'ep14-a',topic:'抵当権の順位',answer:true}]},
    ep20:{episode:20,title:'建蔽率',subject:'法令上の制限',audioUrl:'https://example.com/ep20',page:'ep20.html',questions:[{id:'ep20-a',topic:'建蔽率の緩和',answer:false}]}};
  const s=summarize([row('ep20-a',false,day(1),'b','ep20'),row('ep14-a',false,day(1),'c','ep14'),row('ep10-money',true,day(1)),row('ep10-add',true,day(1))],wide);
  assert.deepEqual(s.subjects,[{name:'宅建業法',correct:2,total:2},{name:'権利関係',correct:0,total:1},{name:'法令上の制限',correct:1,total:1}]);
  assert.deepEqual(s.stats,{episodes:3,answers:4,review:1});
  assert.deepEqual(s.review.map(t=>[t.questionId,t.episode,t.subject]),[['ep14-a',14,'権利関係']]);
});
test('review is ordered by lowest rate first, then oldest latest answer first',()=>{
  const wide={...catalog,ep11:{episode:11,title:'x',subject:'権利関係',audioUrl:'https://example.com/11',page:'ep11.html',questions:[{id:'ep11-a',topic:'A',answer:true},{id:'ep11-b',topic:'B',answer:true}]}};
  const rows=[
    // ep10-money: 1/2、直近は不正解（10/5）
    row('ep10-money',true,day(1),'a1'),row('ep10-money',false,day(5),'a2'),
    // ep10-add: 0/1、直近は不正解（10/4）
    row('ep10-add',false,day(4),'a3'),
    // ep11-a: 0/1（まだ分からない、10/2）。ep10-add と同率で、より古い
    row('ep11-a',null,day(2),'a4','ep11'),
    // ep11-b: 1/2、直近は不正解（10/3）。ep10-money と同率で、より古い
    row('ep11-b',true,day(1),'a5','ep11'),row('ep11-b',false,day(3),'a6','ep11'),
    // ep10-join: 直近が正解 → 復習に出ない
    row('ep10-join',false,day(6),'a7')
  ];
  assert.deepEqual(summarize(rows,wide).review.map(t=>t.questionId),['ep11-a','ep10-add','ep11-b','ep10-money']);
  assert.deepEqual(summarize(rows.slice().reverse(),wide).review.map(t=>t.questionId),['ep11-a','ep10-add','ep11-b','ep10-money']);
});
