'use strict';
// karte.html の「今週の3つ」：take / matsu でカード、ume だけなら1行の案内、権利なしは既存どおり。
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const html=read('karte.html');
const userId='12345678-1234-4123-8123-123456789abc';
const login={userId,storageKey:'mimiobo-test-v1-'+'a'.repeat(64),providers:['email']};
const withPlan=plan=>({...login,entitlements:[{plan,valid_until:'2027-10-17T14:59:59.000Z'}]});
function run(session,rows,{now}={}){
  const nodes=new Map(),values=new Map();
  const node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:['needLogin','noEntitlement','entitled','untilRow'].includes(id),disabled:false,textContent:'',innerHTML:'',onclick:null});return nodes.get(id);};
  const localStorage={getItem:k=>values.has(k)?values.get(k):null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k),key:i=>[...values.keys()][i]??null,get length(){return values.size;}};
  const RealDate=Date;
  const FakeDate=now===undefined?RealDate:class extends RealDate{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}};
  const context=vm.createContext({URLSearchParams,AbortSignal,Intl,Date:FakeDate,Number,Object,Promise,JSON,Error,console,location:{search:'',href:'https://x/karte.html'},localStorage});
  context.addEventListener=()=>{};context.window=context;context.setTimeout=fn=>fn();
  context.document={getElementById:node,createElement:()=>({}),head:{append(s){s.onload();}}};
  context.MimioboMessages={text:()=>'x'};
  context.fetch=async url=>({ok:true,status:200,json:async()=>url==='/api/karte'?{rows}:session});
  for(const file of ['quiz-catalog.js','karte-core.js','navi-core.js'])vm.runInContext(read(file),context);
  const script=html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
  return vm.runInContext(script.replace(/initialize\(\);\s*$/,'')+';initialize()',context).then(()=>({node,values}));
}
const day=86400000;
test('take and matsu: the card with label, heading, one-line help and the rows',async()=>{
  for(const plan of ['take','matsu']){
    const {node}=await run(withPlan(plan),[]);
    const body=node('karteBody').innerHTML;
    assert.equal(node('noEntitlement').hidden,true);assert.equal(node('entitled').hidden,false);
    assert.ok(body.startsWith('<section class="karte-card navi-card">'));
    assert.ok(body.includes('<span class="plan-dot dot-take"><img class="plan-dot-icon" src="img/icons/plan-navi.svg" alt="" width="18" height="18">学習ナビ</span><h2>今週の3つ</h2>'));
    assert.ok(body.includes('毎週月曜に、記録から決まります。'));
    assert.ok(body.includes('<p class="navi-kind">次の回</p><p class="navi-title">第1回 '));
    assert.ok(body.includes('まだ解いていない回'));assert.ok(body.includes('>3問を解く</a>'));
    assert.ok(body.includes('>音声</a>'));
    assert.ok(body.indexOf('今週の3つ')<body.indexOf('まだ記録がありません。'));
    assert.ok(!body.includes('済'));assert.ok(!body.includes('今週の3つは済みました。'));
  }
});
test('ume only: one guide line to plans-preview#take instead of the card',async()=>{
  const {node}=await run(withPlan('ume'),[]);
  const body=node('karteBody').innerHTML;
  assert.ok(body.startsWith('<p class="navi-teaser"><a href="plans-preview.html#take">学習ナビ｜今週やることを決める</a></p>'));
  assert.ok(!body.includes('今週の3つ')&&!body.includes('navi-card'));
});
test('no entitlement: the existing guide, no navi at all',async()=>{
  const {node}=await run(login,[]);
  assert.equal(node('noEntitlement').hidden,false);assert.equal(node('karteBody').innerHTML,'');
});
test('done rows are faded with 済; all three done adds the one closing line',async()=>{
  const now=Date.parse('2026-10-07T03:00:00Z');
  const cat=require('../quiz-catalog.js'),first=Object.keys(cat)[0];
  // first episode of the ledger answered this week (Tue 10/6): it is a 次の回 candidate based on the past only, so with no past it stays on the list as done
  const rows=cat[first].questions.map(q=>({quiz_id:first,question_id:q.id,value:q.answer,answered_at:'2026-10-06T00:00:00Z',attempt_id:'a'}));
  const {node}=await run(withPlan('take'),rows,{now});
  const body=node('karteBody').innerHTML;
  assert.ok(body.includes('class="navi-item is-done"'));assert.ok(body.includes('<span class="navi-done">済</span>'));
  assert.equal((body.match(/navi-item is-done/g)||[]).length,1);assert.ok(!body.includes('今週の3つは済みました。'));
  const all=Object.keys(cat).slice(0,3).flatMap(id=>cat[id].questions.map(q=>({quiz_id:id,question_id:q.id,value:q.answer,answered_at:'2026-10-06T00:00:00Z',attempt_id:'a'})));
  const full=await run(withPlan('take'),all,{now});
  assert.ok(full.node('karteBody').innerHTML.includes('<p class="navi-all-done">今週の3つは済みました。</p>'));
});
test('the cached screen keeps the same navi mode',async()=>{
  const {values}=await run(withPlan('take'),[]);
  const saved=JSON.parse([...values].find(([k])=>k.startsWith('mimiobo-karte-cache-v1:'))[1]);
  assert.equal(saved.navi,'card');
});
test('markup: style blocks balanced, scripts parse, navi-core is loaded, no arrows, 15px body on phones',()=>{
  assert.equal((html.match(/<style>/g)||[]).length,(html.match(/<\/style>/g)||[]).length);
  assert.ok(html.includes('<script src="/navi-core.js"></script>'));
  for(const m of html.matchAll(/<script>\s*([\s\S]*?)<\/script>/g))assert.doesNotThrow(()=>new Function(m[1]));
  assert.doesNotThrow(()=>new Function(read('navi-core.js')));
  assert.doesNotMatch(html.match(/\/\* 学習ナビ[\s\S]*?<\/style>/)[0],/[→↗↘←]/);
  assert.match(html,/@media\(max-width:480px\)\{body\{font-size:15px/);
});
