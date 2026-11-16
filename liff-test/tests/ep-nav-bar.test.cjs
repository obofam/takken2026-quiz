'use strict';
// 回のページの下の固定バー（前の回・上に戻る・次の回）。本番にも試し用にも入る。
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),prod=path.join(root,'..');
const mat=path.join(prod,'..','6_有料PDF','やさしいテキスト_2027');
const skip=fs.existsSync(mat)?false:'材料が無い';
const read=p=>fs.readFileSync(p,'utf8');
const trial=n=>read(path.join(root,'ep',String(n),'index.html'));
const prodHtml=n=>read(path.join(prod,'ep',String(n),'index.html'));
const bar=h=>{const m=h.match(/<nav class="epnav"[\s\S]*?<\/nav>/);assert.ok(m,'バーがある');return m[0];};
let B;
const lib=async()=>{if(!B)B=await import(require('node:url').pathToFileURL(path.join(root,'scripts/build-ep.mjs')).href);return B;};

test('nav bar: episode 3 has prev=2 and next=4 with links, open dates and umami events',()=>{
  const b=bar(trial(3));
  assert.match(b,/<a class="enb prev" href="\/ep\/2"[^>]*data-umami-event="ep-nav" data-umami-event-to="prev" data-umami-event-ep="3">[\s\S]*?第2回<\/a>/);
  assert.match(b,/<a class="enb next" href="\/ep\/4"[^>]* data-open="20270125"[^>]*data-umami-event-to="next" data-umami-event-ep="3">第4回/);
  assert.match(b,/<button type="button" class="enb top" id="navTop" data-umami-event="ep-nav" data-umami-event-to="top" data-umami-event-ep="3">上に戻る<\/button>/);
  assert.match(b,/<a class="enb top latest" id="navLatest" href="\/ep\/3" style="display:none" data-cur="3" data-eps="1:0,2:20270112,3:20270118,4:20270125[^"]*" data-umami-event="ep-nav" data-umami-event-to="latest" data-umami-event-ep="3">最新回へ<\/a>/);
});
test('nav bar: 最新回へ picks the newest open episode by date and hides on that episode',()=>{
  const vm=require('node:vm');
  const run=(n,today)=>{const b=bar(trial(n));const eps=b.match(/data-eps="([^"]+)"/)[1].split(',').map(x=>x.split(':').map(Number));let k=0;for(const [e,d] of eps)if(d<=today&&e>k)k=e;return k===n?null:k;};
  assert.equal(run(3,20261117),1);
  assert.equal(run(1,20261117),null);
  assert.equal(run(1,20270120),3);
  assert.equal(run(3,20270120),null);
  assert.equal(run(2,99999999),9);
});
test('nav bar: episode 1 has no prev (empty slot), the sample episode is never closed (no data-open on a link to it)',()=>{
  const b=bar(trial(1));
  assert.match(b,/<div class="epnav-s"><\/div>/);
  assert.doesNotMatch(b,/class="enb prev"/);
  assert.doesNotMatch(bar(trial(2)).match(/class="enb prev"[^>]*>/)[0],/data-open/);
});
test('nav bar: the episode after the last built one (10) is a disabled span, not a link',()=>{
  const b=bar(trial(9));
  assert.match(b,/<span class="enb next off" aria-disabled="true" data-ep="10">第10回/);
  assert.doesNotMatch(b,/href="\/ep\/10"/);
});
test('nav bar: no arrow characters (chevrons are drawn with CSS)',()=>{
  for(let n=1;n<=9;n++)assert.doesNotMatch(bar(trial(n)),/[→←›‹▶◀▼▲]/,'ep'+n);
});
test('nav bar: also in the production output (same prev/next/data-open, no arrows, no price words), only the date check differs',{skip},async()=>{
  const b=await lib();
  const tpl=read(path.join(root,'templates/ep-index.html'));
  assert.doesNotMatch(tpl,/<!--試|\/\*試/);
  assert.match(tpl,/epnav/);
  for(let n=1;n<=9;n++){
    const bp=bar(prodHtml(n)),bt=bar(trial(n));
    assert.equal(bp,bt,'ep'+n);// 前後の番号・data-open・ボタンは本番と試し用で同じ（バーの中は日付の比べ方に依らない）
    assert.doesNotMatch(bp,/[→←›‹▶◀▼▲]/,'ep'+n);
    assert.doesNotMatch(bp,/購入|買|円/,'ep'+n);
  }
  assert.match(bar(prodHtml(3)),/<a class="enb prev" href="\/ep\/2"/);
  assert.match(bar(prodHtml(3)),/<a class="enb next" href="\/ep\/4"[^>]* data-open="20270125"/);
  assert.match(bar(prodHtml(1)),/<a class="enb next" href="\/ep\/2"[^>]* data-open="/);
  assert.match(bar(prodHtml(9)),/<span class="enb next off" aria-disabled="true" data-ep="10">第10回/);
  // 日付の比べ方：本番は端末の日付、試し用は ?today= だけ
  const m=b.loadMaterial(3),text=b.buildText(m),ex=b.buildExcerpt(m,text);
  const pi=b.buildPages(m,text,ex,'prod',[1,2,3,4,5,6,7,8,9]).index,ti=b.buildPages(m,text,ex,'test',[1,2,3]).index;
  assert.ok(pi.includes("var n=new Date(),t=n.getFullYear()*10000+(n.getMonth()+1)*100+n.getDate();var as=document.querySelectorAll('.epnav a[data-open]')"));
  assert.doesNotMatch(pi,/today=\(/);
  assert.match(ti,/\[\?&\]today=/);
  assert.doesNotMatch(pi,/NAV_|\{\{/);
  // 本番の「ページがあるか」は ep-release.json の prod（ここでは 1〜9 を渡した）、試し用は今回 build した回
  assert.match(ti.match(/<nav class="epnav"[\s\S]*?<\/nav>/)[0],/<span class="enb next off" aria-disabled="true" data-ep="4">/);
});
