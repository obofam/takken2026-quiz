'use strict';
// 回のページ（試し用）の下の固定バー（前の回・上に戻る・次の回）。本番には出していない（ひな形の「試」の印の間）。
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
test('nav bar: not in the production output (not one byte), also not in the gated template',{skip},async()=>{
  const b=await lib();
  const tpl=read(path.join(root,'templates/ep-index.html'));
  const p=b.gateTest(tpl,false);
  assert.doesNotMatch(p,/epnav|NAV_PREV|NAV_NEXT|navTop|ep-nav/);
  assert.match(b.gateTest(tpl,true),/epnav/);
  for(let n=1;n<=9;n++)assert.doesNotMatch(prodHtml(n),/epnav|ep-nav|navTop/,'ep'+n);
  // 本番モードで組んだ文字列にも入っていない
  const m=b.loadMaterial(3),text=b.buildText(m),ex=b.buildExcerpt(m,text);
  assert.doesNotMatch(b.buildPages(m,text,ex,'prod').index,/epnav|ep-nav|navTop|NAV_/);
});
