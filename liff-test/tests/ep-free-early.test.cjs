'use strict';
// 回のページ：YouTube講義の回は、登録なしの見え方（図1枚＋○×）を配信日前に開ける（Kei 11/19）／「無料だけ」の回（やさしいテキストの材料がまだ無い回）／組の数・問の数が違う○×。
// 無料だけの回の材料は tests/fixtures/free-ep/（第09回の図1と data.json を写した試験用。本物の 無料の1枚_2027 には触らない）。
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=path.join(__dirname,'..'),prod=path.join(root,'..');
const mat=path.join(prod,'..','6_有料PDF','やさしいテキスト_2027');
const skip=fs.existsSync(mat)?false:'材料が無い';
const FIX=path.join(__dirname,'fixtures','free-ep');
const read=p=>fs.readFileSync(p,'utf8');
let B,C;
const lib=async()=>{if(!B){const u=f=>require('node:url').pathToFileURL(path.join(root,'scripts',f)).href;B=await import(u('build-ep.mjs'));C=await import(u('ep-config.mjs'));}return B;};
const run=(code,{today,search=''})=>{const html={className:''};const [y,m,d]=today;const FD=function(){return {getFullYear:()=>y,getMonth:()=>m-1,getDate:()=>d};};new Function('document','Date','location',code)({documentElement:html},FD,{search});return html.className;};
const gate=h=>{const m=h.match(/<script>(\(function\(\)\{var k=[\s\S]*?)<\/script>/);return m?m[1]:null;};

test('FREE_EARLY_EPS: 2-33 and 37-41 (not 1, not 34-36)',async()=>{
  await lib();
  const want=[];for(let n=2;n<=33;n++)want.push(n);for(let n=37;n<=41;n++)want.push(n);
  assert.deepEqual(C.FREE_EARLY_EPS,want);
});

test('early episode (ep 3): before the date only html.ep-early (never ep-closed); on and after the date nothing is added; trial uses ?today= only',{skip},()=>{
  const prodH=read(path.join(prod,'ep/3/index.html')),trialH=read(path.join(root,'ep/3/index.html'));
  const pc=gate(prodH);
  assert.equal(run(pc,{today:[2027,1,17]}).trim(),'ep-early');
  assert.equal(run(pc,{today:[2027,1,18]}).trim(),'');
  assert.equal(run(pc,{today:[2027,2,1]}).trim(),'');
  assert.equal(run(pc,{today:[2026,11,20]}).trim(),'ep-early');
  const tc=gate(trialH);
  assert.equal(run(tc,{today:[2030,1,1],search:''}).trim(),'');
  assert.equal(run(tc,{today:[2030,1,1],search:'?today=2026-11-20'}).trim(),'ep-early');
  assert.equal(run(tc,{today:[2030,1,1],search:'?today=2027-01-18'}).trim(),'');
  for(const h of [prodH,trialH]){
    assert.doesNotMatch(h,/ep-closed|closed-box/);
    assert.doesNotMatch(h,/<script>\n\(function \(\) \{\n  'use strict'; if \(document/,'3問の script は配信日前でも動く');
  }
});

test('early episode (ep 3): the pre-date branch returns before LINE judge / line-full / ep-text; one note line right after the past-exam box; no login entrances while ep-early',{skip},()=>{
  for(const h of [read(path.join(prod,'ep/3/index.html')),read(path.join(root,'ep/3/index.html'))]){
    const i=h.indexOf("document.documentElement.classList.contains('ep-early')");
    assert.ok(i>0);
    const j=h.indexOf('var judged;');
    assert.ok(i<j,'判定より前で return');
    const block=h.slice(i,j);
    assert.match(block,/return;/);
    assert.doesNotMatch(block,/showFull|textCheck|ep-text|liff\.init|judge\(/);
    assert.match(block,/pendView\('open'\); settleView\(\);/);
    assert.match(block,/__epProgressStart/);
    assert.match(h,/<div class="next-box only-a"><p>[\s\S]*?<\/div>\n    <p class="pnote early-note"><span class="nk">この回の図の続きと<\/span><span class="nk">過去問1選は、<\/span><span class="nk">1月18日（月）の配信から<\/span><span class="nk">開きます。<\/span><\/p>\n    <div class="slot" id="slot-kk">/);
    assert.equal((h.match(/early-note/g)||[]).length,3);// CSS 2 + 本体 1
    assert.match(h,/\.early-note\{display:none\}/);
    assert.match(h,/\.ep-early \.top-login,\.ep-early \.login-line\{display:none\}/);
    assert.match(h,/id="kirokuBox" hidden/);// 「この記録を残す」は今のまま
  }
});

test('non-early episode (34: pretend by relabelling ep 2): still closed until the date, no early parts',{skip},async()=>{
  const b=await lib();
  const m=b.loadMaterial(2),text=b.buildText(m),ex=b.buildExcerpt(m,text);
  m.ep=34;
  const h=b.buildPages(m,text,ex,'prod',[1,2]).index;
  assert.match(h,/ep-closed/);assert.doesNotMatch(h,/early/i);
  assert.match(h,/<div class="next-box closed-box"><p>この回は、\d+年\d+月\d+日（.）からです。<\/p>/);
  assert.equal((h.match(/ep-closed'\)\) \{ return; \}/g)||[]).length,2);
  assert.match(h,/<span class="enb next off" aria-disabled="true" data-ep="35">/);
});

test('nav: links to early episodes carry no data-open; the 最新回へ list still holds the delivery dates',{skip},()=>{
  const h=read(path.join(root,'ep/5/index.html'));
  assert.doesNotMatch(h,/data-open=/);
  assert.match(h,/data-eps="1:0,2:20270112,3:20270118,4:20270125,5:20270201/);
});

test('free-only episodes (fixtures 10 / 23 / 30): only index.html; always the not-registered view + the note; no TCOUNT line; sets / questions follow the json',{skip},async()=>{
  const b=await lib();
  for(const [ep,date,sets,qs] of [[10,'2027-03-08',2,[3,3]],[23,'2027-05-31',1,[3]],[30,'2027-07-19',3,[2,2,2]]]){
    const r=b.buildEp(ep,{prod:[1]},null,{freeDir:FIX,today:'2026-11-19',built:[ep]});
    assert.deepEqual(r.files.map(f=>f.rel),[`liff-test/ep/${ep}/index.html`]);
    assert.equal(r.report.freeOnly,true);assert.equal(r.report.prod,false);
    const h=r.files[0].data;
    assert.match(h,/<script>document\.documentElement\.className\+=' ep-early';<\/script>/,'日付に関係なく常に ep-early');
    assert.doesNotMatch(h,/ep-closed|closed-box/);
    const [y,m,d]=date.split('-').map(Number);const wd='日月火水木金土'[new Date(Date.UTC(y,m-1,d)).getUTCDay()];
    assert.ok(h.includes(`<span class="nk">${m}月${d}日（${wd}）の配信から</span><span class="nk">開きます。</span></p>`),'日付の一文 '+ep);
    assert.doesNotMatch(h,/<span class="tcount">/,'TCOUNT は出さない');
    assert.match(h,/<a class="tcard"/,'カードは残す');
    assert.equal((h.match(/data-fig="1"/g)||[]).length,1);
    assert.doesNotMatch(h,/class="[^"]*\brs\b[^"]*"|role="button"|data-hint|data-part=/);
    const quiz=JSON.parse(h.match(/var QUIZ = (\[[\s\S]*?\]);\n/)[1]);
    assert.equal(quiz.length,sets);
    assert.deepEqual(quiz.map(q=>q.questions.length),qs);
    quiz.forEach((q,i)=>assert.ok(q.label.endsWith(`の${qs[i]}問`),q.label));
    assert.ok(h.indexOf("document.documentElement.classList.contains('ep-early')")>0);
  }
});

test('free-only episode: when ep-release.json lists it, prod gets index.html only; --shisaku writes the trial side only',{skip},async()=>{
  const b=await lib();
  const r=b.buildEp(10,{prod:[1,10]},null,{freeDir:FIX,today:'2026-11-19',built:[10]});
  assert.deepEqual(r.files.map(f=>f.rel).sort(),['ep/10/index.html','liff-test/ep/10/index.html']);
  const s=b.buildEp(10,{prod:[1,10]},null,{freeDir:FIX,today:'2026-11-19',built:[10],shisaku:true});
  assert.deepEqual(s.files.map(f=>f.rel),['liff-test/ep/10/index.html']);
  assert.doesNotMatch(r.files.find(f=>f.rel==='ep/10/index.html').data,/today=\(/);
});

test('free-only episode: warns when the delivery date is within 14 days of today (also when already past), not otherwise',{skip},async()=>{
  const b=await lib();
  const w=today=>b.buildEp(10,{prod:[1]},null,{freeDir:FIX,today,built:[10]}).report.warn;
  assert.match(w('2027-03-01'),/第10回（無料だけ）：配信日 2027-03-08 があと7日/);
  assert.match(w('2027-02-22'),/あと14日/);
  assert.equal(w('2027-02-21'),null);
  assert.match(w('2027-03-08'),/あと0日/);
  assert.match(w('2027-03-10'),/2日前/);
  assert.equal(w('2026-11-19'),null);
});

test('free-only material: the html must hold exactly one figure and it must be figure 1; the json ep and shape are checked',{skip},async()=>{
  const b=await lib();
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'free-ep-'));
  const put=(name,data)=>fs.writeFileSync(path.join(tmp,name),data);
  const j0=read(path.join(FIX,'第10回_無料の1枚.json')),h0=read(path.join(FIX,'第10回_無料の1枚.html'));
  const fig=h0.match(/<figure class="fig">[\s\S]*?<\/figure>/)[0];
  put('第10回_無料の1枚.json',j0);
  put('第10回_無料の1枚.html',h0.replace(fig,fig+'\n'+fig));
  assert.throws(()=>b.loadMaterial(10,{freeDir:tmp}),/図が 2 枚/);
  put('第10回_無料の1枚.html',h0.replace(fig,''));
  assert.throws(()=>b.loadMaterial(10,{freeDir:tmp}),/図が 0 枚/);
  put('第10回_無料の1枚.html',h0.replace('<span class="n">1</span>','<span class="n">2</span>'));
  assert.throws(()=>b.loadMaterial(10,{freeDir:tmp}),/図の番号が 2/);
  put('第10回_無料の1枚.html',h0);
  put('第10回_無料の1枚.json',j0.replace('"ep": 10','"ep": 11'));
  assert.throws(()=>b.loadMaterial(10,{freeDir:tmp}),/ep が 11/);
  const j=JSON.parse(j0);j.quizSets[0].questions=j.quizSets[0].questions.slice(0,1);
  put('第10回_無料の1枚.json',JSON.stringify(j));
  assert.throws(()=>b.loadMaterial(10,{freeDir:tmp}),/1組2〜3問/);
  const j4=JSON.parse(j0);j4.quizSets=[...j4.quizSets,...j4.quizSets];
  put('第10回_無料の1枚.json',JSON.stringify(j4));
  assert.throws(()=>b.loadMaterial(10,{freeDir:tmp}),/1〜3つ/);
  assert.throws(()=>b.loadMaterial(11,{freeDir:tmp}),/材料が無い/);
  fs.rmSync(tmp,{recursive:true,force:true});
});

test('free-only figure gets the same phone-width treatment as ep 2-9 (sp_overrides.css in the shadow styles; same figure markup as ep 9 figure 1)',{skip},async()=>{
  const b=await lib();
  const r=b.buildEp(10,{prod:[1]},null,{freeDir:FIX,today:'2026-11-19',built:[10]});
  const h=r.files[0].data;
  const tpl=h.match(/<template id="nk-fig1">([\s\S]*?)<\/template>/)[1];
  assert.match(tpl,/\.fig > \.cap\{display:block;position:relative;padding-left:32px/);
  assert.match(tpl,/:host\{--sheet:#8E3B3B;/);
  assert.doesNotMatch(tpl,/<use /);
  assert.match(tpl,/<figure class="fig">[\s\S]*?<span class="n">1<\/span>/);
  const m9=b.loadMaterial(9),t9=b.buildText(m9),e9=b.buildExcerpt(m9,t9);
  assert.equal(tpl.includes(e9.fig1),true,'第9回の図1と同じ並びの html');
});

test('quizSets with other numbers of sets / questions also work for a full episode; labels follow the number of questions; episodes 2-9 keep the 3-question label',{skip},async()=>{
  const b=await lib();
  const m=b.loadMaterial(2),text=b.buildText(m),ex=b.buildExcerpt(m,text);
  const base=b.buildPages(m,text,ex,'test',[1,2]).index;
  assert.equal((base.match(/」の3問/g)||[]).length,2);
  m.data.quizSets=[{...m.data.quizSets[0],questions:m.data.quizSets[0].questions.slice(0,2)}];
  const h=b.buildPages(m,text,ex,'test',[1,2]).index;
  const quiz=JSON.parse(h.match(/var QUIZ = (\[[\s\S]*?\]);\n/)[1]);
  assert.equal(quiz.length,1);assert.equal(quiz[0].questions.length,2);assert.match(quiz[0].label,/」の2問$/);
});
