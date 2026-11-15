'use strict';
// 試し用だけの動き2つ：①過去問の朱入れ（liff-test/ep-kakomon-shuire.json）②赤シートは最初「はずす」・最後まで読むと自動で1回かかる
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),prod=path.join(root,'..');
const mat=path.join(prod,'..','6_有料PDF','やさしいテキスト_2027');
const skip=fs.existsSync(mat)?false:'材料（6_有料PDF）が無い環境では実行しない';
let B;const lib=async()=>{if(!B)B=await import(require('node:url').pathToFileURL(path.join(root,'scripts/build-ep.mjs')).href);return B;};
const read=p=>fs.readFileSync(p,'utf8');
const kakomon=ep=>JSON.parse(read(path.join(mat,`第${String(ep).padStart(2,'0')}回_流し込み材料.json`))).kakomon;
const K={items:[{m:'1',t:'ＡはＢを取り消されることはない。拘禁刑に処せられた。',ok:false},{m:'2',t:'所得税法の違反は含まれない。',ok:true}]};

test('shuire guard: real data passes; word 0 times, 2+ times, del on a correct choice, overlap, bad keys all fail the build',{skip},async()=>{
  const b=await lib();
  const k1=kakomon(1);
  const r=b.shuireFor(1,k1);
  assert.deepEqual(Object.keys(r),['1','2','3','4']);
  for(const [no,arr] of Object.entries(r)){const it=k1.items.find(x=>x.m===no);for(const a of arr){const w=a.mark||a.del;assert.equal(it.t.split(w).length-1,1,no+w);if(a.del)assert.equal(it.ok,false);}}
  const d=x=>({1:x});
  assert.throws(()=>b.shuireFor(1,K,d({1:[{mark:'存在しない語'}]})),/0 回/);
  assert.throws(()=>b.shuireFor(1,{items:[{m:'1',t:'いいいい',ok:false}]},d({1:[{mark:'い'}]})),/4 回/);
  assert.throws(()=>b.shuireFor(1,K,d({2:[{del:'所得税法',to:'x'}]})),/ok:true/);
  assert.throws(()=>b.shuireFor(1,K,d({1:[{del:'取り消されることはない'}]})),/mark|del/);
  assert.throws(()=>b.shuireFor(1,K,d({1:[{mark:'取り消されること'},{del:'ことはない',to:'y'}]})),/重なる/);
  assert.throws(()=>b.shuireFor(1,K,d({9:[{mark:'拘禁刑'}]})),/選択肢 9/);
  assert.equal(b.shuireFor(2,kakomon(2),{1:{}}),null,'データの無い回は何もしない');
});

test('shuire build: every episode with data carries r on exactly the listed choices, choice/explanation text unchanged; episodes without data get nothing; production = trial',{skip},async()=>{
  const b=await lib();
  const data=JSON.parse(read(path.join(root,'ep-kakomon-shuire.json')));
  for(let n=1;n<=9;n++){
    const m=b.loadMaterial(n);
    const js=read(path.join(root,'ep',String(n),'line-full.js'));
    if(data[String(n)]){
      const kk=JSON.parse(js.match(/var KK = (\{[\s\S]*?\});\n/)[1]);
      kk.items.forEach((it,i)=>{
        assert.equal(it.t,m.json.kakomon.items[i].t,'第'+n+'回 本文は1字も変えない');
        assert.deepEqual(it.r,data[String(n)][it.m],'第'+n+'回 '+it.m);
      });
      assert.equal(kk.stem,m.json.kakomon.stem);
      assert.deepEqual(kk.lines.map(l=>l.t),m.json.kakomon.items.map(it=>(it.ok?'正しい。':'誤り。')+it.why),'解説の字も同じ');
      assert.match(read(path.join(root,'ep',String(n),'index.html')),/\.kk-item \.sh-mk\{[^}]*var\(--sheet\)/);
    }else{
      assert.doesNotMatch(js,/shuire|"r":/,'第'+n+'回');
      assert.doesNotMatch(read(path.join(root,'ep',String(n),'index.html')),/sh-mk|sh-g/,'第'+n+'回');
    }
    // 本番にも試し用と同じ朱入れ
    assert.equal(read(path.join(prod,'ep',String(n),'line-full.js')),js,'第'+n+'回 本番の過去問＝試し用');
    assert.equal(/sh-mk/.test(read(path.join(prod,'ep',String(n),'index.html'))),!!data[String(n)],'第'+n+'回 本番のCSS');
  }
});

test('shuire view: mark = underline only, del = struck word + small red correction with spoken 誤り/正しくは; sheet red only; no emoji/arrows',{skip},()=>{
  const js=read(path.join(root,'ep/1/line-full.js'));
  const fn=js.match(/ {2}function shuireHtml\(it\) \{[\s\S]*?\n {2}\}\n/)[0];
  const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const ctx={esc};vm.createContext(ctx);vm.runInContext('var esc=this.esc;'+fn+';this.f=shuireHtml;',ctx);
  const it={t:'Ａ社の免許は取り消されることはない。拘禁刑に処せられた。',r:[{del:'取り消されることはない',to:'取り消される'},{mark:'拘禁刑'}]};
  const h=ctx.f(it);
  assert.match(h,/<span class="sh-g" role="group" aria-label="誤り「取り消されることはない」。正しくは「取り消される」"><del>取り消されることはない<\/del><ins aria-hidden="true">取り消される<\/ins><\/span>/);
  assert.match(h,/<span class="sh-mk">拘禁刑<\/span>/);
  const plain=h.replace(/<ins[^>]*>[^<]*<\/ins>/g,'').replace(/<[^>]+>/g,'');
  assert.equal(plain,it.t,'朱入れの字を外せば本文と同じ（本文の字は DOM に残る）');
  assert.equal(ctx.f({t:'a<b',r:[{mark:'a'}]}),'<span class="sh-mk">a</span>&lt;b','HTML は必ずエスケープ');
  const html=read(path.join(root,'ep/1/index.html'));
  const css=html.match(/\/\* 過去問の朱入れ[\s\S]*?\n(?=\/\* 下書きの印)/)[0];
  assert.doesNotMatch(css,/#[0-9a-fA-F]{3,6}/,'新しい色を足さない（--sheet だけ）');
  assert.doesNotMatch(js+css,/→|←|[\u{1F300}-\u{1FAFF}]/u);
  assert.match(js,/res\.hidden = false; shuire\(true\);/);
  assert.match(js,/again\.hidden = true; shuire\(false\);/);
});

// ---- ②赤シート：最初は「はずす」・後半のテキストの終わりが画面に入ったら1回だけ自動でかかる ----
function setup(opts){
  const dan=read(path.join(root,'ep1-3dan.html'));
  const src=dan.match(/ {2}function esc\(s\)[\s\S]*?(?=\n {2}function showBuyer\(html\))/)[0];
  const el=()=>{const e={cls:new Set(),html:'',attrs:{},l:{},textContent:'',style:{},
    set innerHTML(v){this.html=v;},get innerHTML(){return this.html;},
    setAttribute(k,v){this.attrs[k]=String(v);},getAttribute(k){return this.attrs[k]===undefined?null:this.attrs[k];},removeAttribute(k){delete this.attrs[k];},
    addEventListener(t,f){this.l[t]=f;},appendChild(){},getBoundingClientRect(){return{height:48};}};
    e.classList={add:(...a)=>a.forEach(x=>e.cls.add(x)),remove:(...a)=>a.forEach(x=>e.cls.delete(x)),toggle:(c,f)=>{f?e.cls.add(c):e.cls.delete(c);}};
    return e;};
  const rs=[el(),el()];rs.forEach((e,i)=>{e.html='語'+i;e.attrs['data-hint']='○'+i;});
  const tx=el();
  const rootN=[{querySelectorAll:()=>rs,querySelector:()=>tx,appendChild(){}},{querySelectorAll:()=>[],querySelector:()=>null,appendChild(){}}];
  const on=el(),off=el(),hid=el();
  const bar={querySelector:s=>({'[data-r="on"]':on,'[data-r="off"]':off,'[data-r="hid"]':hid})[s]};
  const hint=el(),end={getBoundingClientRect:()=>({top:100})};
  let obs=null;
  class IO{constructor(cb){this.cb=cb;obs=this;this.disc=false;}observe(t){this.t=t;}disconnect(){this.disc=true;}}
  const calls=[];const ctx={window:{scrollBy:(x,y)=>calls.push(y)},document:{createElement:()=>el()},IntersectionObserver:opts.noIO?undefined:IO,console};
  vm.createContext(ctx);
  vm.runInContext(src+';this.setupSheet=setupSheet;',ctx);
  const n=ctx.setupSheet(rootN,bar,opts.noEnd?{}:{hint,end});
  const state=()=>({on:on.attrs['aria-pressed'],off:off.attrs['aria-pressed'],hint:hint.html,sheet:tx.cls.has('sheet'),hid:hid.textContent,hidHtml:hid.html,note:hid.cls.has('is-note'),hintShown:hint.style.display!=='none',rs0:rs[0].cls.has('s-hide')});
  return{calls,n,state,on,off,rs,fire:()=>{obs.cb([{isIntersecting:true}]);},fireOut:()=>{obs.cb([{isIntersecting:false}]);},obs:()=>obs};
}
const WAIT='最後まで読むと、自動でかかります。',NORMAL1='赤い所を押すと答えが出ます。',NORMAL2='もう一度押すと、またかくれます。';
test('red sheet: starts off (all words visible) with the waiting hint; end not yet in view does nothing',()=>{
  const s=setup({});
  assert.equal(s.n,2);
  const st=s.state();
  assert.equal(st.on,'false');assert.equal(st.off,'true');assert.equal(st.rs0,false);
  // 待っている間：帯の右に小さい注釈（2つの語のまとまり）。かくれている数は出さない。帯の下の案内は出さない（余白も空けない）
  assert.equal(st.hidHtml,'<span class="nk">最後まで読むと、</span><span class="nk">自動でかかります。</span>');
  assert.ok(st.note);assert.ok(!st.hidHtml.includes('かくれている'));
  assert.equal(st.hintShown,false);assert.equal(st.hint,'');
  s.fireOut();assert.equal(s.state().on,'false');
});
test('red sheet: end comes into view -> sheet goes on once; hint switches; a later manual off stays off and never re-fires',()=>{
  const s=setup({});
  s.fire();
  let st=s.state();
  assert.equal(st.on,'true');assert.equal(st.sheet,true);assert.equal(st.rs0,true);assert.equal(st.hid,'かくれている 2');
  assert.ok(st.hint.includes(NORMAL1)&&st.hint.includes(NORMAL2)&&st.hintShown&&!st.note&&!st.hid.includes('最後まで'));
  s.off.l.click();
  st=s.state();assert.equal(st.on,'false');assert.equal(st.rs0,false);
  s.fire();
  assert.equal(s.state().on,'false','自動は1回だけ');
  assert.equal(s.obs().disc,true);
});
test('red sheet: a person pressing かける/はずす before the end cancels the auto for good',()=>{
  for(const which of ['on','off']){
    const s=setup({});
    s[which].l.click();
    const st=s.state();
    assert.equal(st.on,which==='on'?'true':'false');
    assert.ok(st.hint.includes(NORMAL1)&&st.hintShown&&!st.note&&/^かくれている \d+$/.test(st.hid));
    assert.equal(s.obs().disc,true);
    if(which==='off'){s.fire();assert.equal(s.state().on,'false','自動はもう動かさない');}
  }
});
test('red sheet: no IntersectionObserver -> stays off (never auto); without an end element the old behaviour (starts on) is kept',()=>{
  const s=setup({noIO:true});
  assert.equal(s.state().on,'false');
  const o=setup({noEnd:true});
  assert.equal(o.state().on,'true');
});
test('red sheet: no jump - the waiting state is the plain "off" layout (no gaps), scroll is corrected by the marker shift, the end marker adds no space; shared part has it',()=>{
  const dan=read(path.join(root,'ep1-3dan.html'));
  assert.doesNotMatch(dan,/s-wait|minHeight/);
  assert.match(dan,/w\.classList\.toggle\('sheet', on\)/);
  assert.match(dan,/window\.scrollBy\(0, dy\)/);
  const s=setup({});s.fire();assert.ok(Array.isArray(s.calls));
  assert.match(dan,/sheetEnd\.style\.cssText = 'height:0;margin-top:-12px;pointer-events:none'/);
  // 目印の置き場：今回の数字の節の終わり。数字が無い回は今日のポイントの終わり、それも無ければ後半のテキストの終わり
  assert.match(dan,/if \(h3\) \{ sec3\.appendChild\(sheetEnd\); \}\s*else if \(point\.children\.length\) \{ point\.appendChild\(sheetEnd\); \}\s*else \{ sec2\.insertBefore\(sheetEnd, q2\); \}/);
  const view=read(path.join(root,'ep/_shared/text-view.js'));
  assert.ok(view.includes('{hint: hint, end: sheetEnd}')&&view.includes('IntersectionObserver'));
});

test('sample page (ep/1/text): red sheet starts off and auto-on at the end marker, same as the buyer view',{skip},()=>{
  const h=read(path.join(prod,'ep/1/text/index.html'));
  assert.match(h,/var sheetEnd = document\.createElement\('div'\);/);
  assert.match(h,/getElementById\('numbers'\)\.appendChild\(sheetEnd\);/);
  assert.match(h,/setupSheet\(roots, document\.getElementById\('sbar'\), \{hint: document\.querySelector\('\.shint'\), end: sheetEnd\}\)/);
  assert.ok(h.includes('最後まで読むと、</span><span class="nk">自動でかかります。')&&h.includes('.sb2-cnt.is-note{')&&h.includes('IntersectionObserver'));
  assert.ok(h.includes('.kk-item .sh-mk{'));
});

// ---- 答えたあと、選択肢の番号の上に赤い○×（記述そのものの正誤・全部の回） ----
test('kk ○×: every episode (trial and production) carries ok from the material on each choice and the ○× CSS; shapes are CSS (ring / two lines with an open centre so the number stays readable), sheet red, with spoken 正しい/誤り',{skip},async()=>{
  const b=await lib();
  for(let n=1;n<=9;n++){
    const m=b.loadMaterial(n);
    for(const base of [root,prod]){
      const js=read(path.join(base,'ep',String(n),'line-full.js'));
      const kk=JSON.parse(js.match(/var KK = (\{[\s\S]*?\});\n/)[1]);
      assert.equal(kk.items.length,m.json.kakomon.items.length);
      kk.items.forEach((it,i)=>assert.equal(it.ok,!!m.json.kakomon.items[i].ok,'第'+n+'回 '+it.m+' の正誤は材料と同じ'));
      const idx=read(path.join(base,'ep',String(n),'index.html'));
      assert.match(idx,/\.kk-jg-o\{border:2\.5px solid var\(--sheet\);border-radius:50%\}/);
      assert.match(idx,/\.kk-jg-x::before,\.kk-jg-x::after\{[^}]*linear-gradient\([^}]*var\(--sheet\)/);
      assert.match(idx,/\.kk-sr\{position:absolute;/);
    }
  }
});
test('kk ○×: nothing before answering; shown on answer for every choice by its own ok (kosu/誤っているもの too); gone on もう一度; not on the explanation rows',{skip},()=>{
  const js=read(path.join(root,'ep/3/line-full.js')); // 個数問題（ア〜エ）
  // 答える前：選択肢の組み立てには○×を入れない／呼び出しは答えたあと・もう一度の2か所だけ
  assert.match(js,/'<span class="kk-mark">' \+ esc\(it\.m\) \+ '<\/span><span>' \+ esc\(it\.t\) \+ '<\/span><\/div>'/);
  assert.equal((js.match(/shuire\(true\)/g)||[]).length,1);assert.equal((js.match(/shuire\(false\)/g)||[]).length,1);
  assert.match(js,/res\.hidden = false; shuire\(true\);/);
  // 解説の行（.kk-lines）には付けない
  const lines=js.match(/var lines = k\.lines\.map[\s\S]*?\.join\(''\);/)[0];
  assert.doesNotMatch(lines,/kk-jg|kk-no/);
  assert.match(js,/box\.querySelectorAll\('\.kk-item > \.kk-mark'\)/);
  // 動き：on で ok=true は○・false は×＋見えない字、off で番号だけに戻る
  const fn=js.match(/ {4}function shuire\(on\) \{[\s\S]*?\n {4}\}/)[0];
  const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const mk=()=>({innerHTML:'ア'});
  const k={items:[{m:'ア',t:'a',ok:false},{m:'イ',t:'b',ok:true},{m:'ウ',t:'c',ok:false},{m:'エ',t:'d',ok:true}]};
  const ts=k.items.map(()=>({innerHTML:''})),ns=k.items.map(it=>({innerHTML:it.m}));
  const ctx={esc,k,tspans:ts,kkNums:ns,shuireHtml:()=>'' };vm.createContext(ctx);vm.runInContext(fn+';this.f=shuire;',ctx);
  ctx.f(true);
  k.items.forEach((it,i)=>{
    const h=ns[i].innerHTML;
    assert.ok(h.includes(esc(it.m)));
    assert.equal(h.includes('kk-jg-o'),it.ok);assert.equal(h.includes('kk-jg-x'),!it.ok);
    assert.ok(h.includes(it.ok?'（正しい）':'（誤り）'));assert.ok(h.includes('aria-hidden="true"'));
  });
  ctx.f(false);
  k.items.forEach((it,i)=>assert.equal(ns[i].innerHTML,it.m,'もう一度で消える'));
});
