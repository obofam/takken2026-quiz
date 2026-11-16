'use strict';
// 回のページ（試し用）の3つの直し：第1回だけ全部開ける／「この記録を残す」／やさしいテキストのその回の中身の実数。
// 本番（リポジトリ直下の ep/）の出力にも入っている。違うのは「登録済の方はこちら」「この記録を残す」の行き先だけ（本番 /login?next=/ep/N・試し用 /account.html）。
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),prod=path.join(root,'..');
const mat=path.join(prod,'..','6_有料PDF','やさしいテキスト_2027');
const skip=fs.existsSync(mat)?false:'材料が無い';
const read=p=>fs.readFileSync(p,'utf8');
const trial=n=>read(path.join(root,'ep',String(n),'index.html'));
const prodHtml=n=>read(path.join(prod,'ep',String(n),'index.html'));
const strip=h=>h.replace(/<[^>]+>/g,'');
let B;
const lib=async()=>{if(!B)B=await import(require('node:url').pathToFileURL(path.join(root,'scripts/build-ep.mjs')).href);return B;};
const NG=/購入|買|円|今すぐ|限定|お得|→|›|▼/;

test('open-all: only episode 1 is opened to everyone (OPEN_ALL true + the one-line note); episodes 2-9 stay as before',()=>{
  const cfg=read(path.join(root,'scripts/ep-config.mjs'));
  assert.match(cfg,/export const OPEN_ALL_EPS = \[1\];/);// 回の番号の決め打ちは1か所
  const h1=trial(1);
  assert.match(h1,/var OPEN_ALL = true,/);
  const note=h1.match(/<div class="next-box only-open1" id="open1-note">[\s\S]*?<\/p><\/div>/);
  assert.ok(note,'一文の箱');
  assert.equal(strip(note[0]),'第2回からは、LINEかメールの登録（無料）で開きます。');
  // 今の過去問の next-box と同じリンク先・同じ見た目・同じイベント
  assert.ok(note[0].includes('<a href="https://lin.ee/r6uYtnE" target="_blank" rel="noopener" style="color:var(--ink);text-decoration:underline;text-underline-offset:3px">LINE</a>'));
  assert.ok(note[0].includes('<a href="https://mimiobo.substack.com/subscribe" target="_blank" rel="noopener" data-umami-event="ep-mail" data-umami-event-ep="1" style="color:var(--ink);text-decoration:underline;text-underline-offset:3px">メール</a>'));
  assert.doesNotMatch(note[0],NG);
  // 置き場所：過去問1選（#slot-kk）のすぐ下、やさしいテキストのカードの上
  assert.match(h1,/<div class="slot" id="slot-kk"><\/div><div class="next-box only-open1" id="open1-note">[\s\S]*?<\/div>\s*<a class="tcard"/);
  // 登録なしで全部開けた状態（is-open1）：一文は出す／下の登録の案内（line-card）は残す／登録済の入口が line-card の中に1つ
  assert.match(h1,/\.only-open1\{display:none\}/);
  assert.match(h1,/\.is-open1 \.only-open1\{display:block\}/);
  assert.match(h1,/\.is-open1 \.only-a\.line-card\{display:block !important\}/);
  const card=h1.match(/<div class="line-card only-a">[\s\S]*?<\/div>\s*<\/div>/)[0];
  assert.match(card,/<p class="login-line only-open1"><a href="\/account\.html" data-umami-event="ep-login" data-umami-event-ep="1" data-umami-event-from="open1">登録済の方はこちら<\/a><\/p>/);
  // tier（Umami に送る見え方）は登録なしのまま、失敗したら今までの表示（showFull の失敗は握りつぶす）／購入者になったら外す
  assert.match(h1,/body\.classList\.add\('is-open1'\); tier = '登録なし'; render\(\);/);
  assert.match(h1,/function openView\(msg\) \{[^}]*pendView\('open'\); openAll\(\); \}/);
  assert.match(h1,/openAllOn = false; body\.classList\.remove\('is-open1'\);/);
  // 本番の出力：第1回は同じく全部開ける。登録済の入口の行き先は /login?next=/ep/1
  const p1=prodHtml(1);
  assert.match(p1,/var OPEN_ALL = true,/);
  assert.equal(strip(p1.match(/<div class="next-box only-open1" id="open1-note">[\s\S]*?<\/p><\/div>/)[0]),'第2回からは、LINEかメールの登録（無料）で開きます。');
  assert.match(p1.match(/<div class="line-card only-a">[\s\S]*?<\/div>\s*<\/div>/)[0],/<p class="login-line only-open1"><a href="\/login\?next=\/ep\/1" data-umami-event="ep-login" data-umami-event-ep="1" data-umami-event-from="open1">登録済の方はこちら<\/a><\/p>/);
  assert.doesNotMatch(p1,/account\.html/);
  // 第2回以降：全部開けない。一文の要素も、line-card の中の入口も出さない（本番も同じ）
  for(const h of [2,3,4,5,6,7,8,9].flatMap(n=>[trial(n),prodHtml(n)]).map((h,i)=>h)){
    const n='ep';
    assert.match(h,/var OPEN_ALL = false,/,n);
    assert.doesNotMatch(h,/id="open1-note"|<p class="login-line only-open1">|第2回からは/,n);
  }
});
test('kiroku: the "save this record" button appears after the 3 questions (links to /login?next=/ep/N), only while not synced',()=>{
  for(const [n,h,href] of [1,2,3,4,5,6,7,8,9].flatMap(n=>[[n,trial(n),'/login?next=/ep/'+n],[n,prodHtml(n),'/login?next=/ep/'+n]])){
    const box=h.match(/<div class="kiroku" id="kirokuBox" hidden>[\s\S]*?<\/div>/);
    assert.ok(box,'ep'+n);
    assert.equal(strip(box[0]),'いまは、この端末にだけ残ります。この記録を残す');
    assert.ok(box[0].includes(`<a class="pill ghost" href="${href}" data-umami-event="ep-kiroku-nokosu" data-umami-event-ep="${n}">この記録を残す</a>`),'ep'+n);
    assert.doesNotMatch(box[0],NG);
    // 結果の表示（#quizBox）の外・節の最後。解く前は hidden
    assert.match(h,/<div id="quizBox"><\/div>\s*<div class="kiroku"/);
    assert.match(h,/@media print\{\.kiroku\{display:none !important\}\}/);
    // 解き終えた（takken2027-done を書く）ところから出す。ページを開き直しただけでは出ない（showKiroku は markSetDone からしか呼ばない）
    assert.equal(h.split('showKiroku()').length-1,2);// 定義と、markSetDone の1回
    assert.match(h,/localStorage\.setItem\('takken2027-done'[\s\S]*?\} catch \(_\) \{\} showKiroku\(\);/);
    // サーバーに残っている（synced）なら出さない。部品が無い・例外のときは出す。あとから synced になったら隠す
    assert.match(h,/window\.TakkenProgress && window\.TakkenProgress\.state\(\) === 'synced'\); \} catch \(_\) \{ return false; \}/);
    assert.match(h,/el\.hidden = !\(kirokuOn && !isSynced\(\)\);/);
    assert.match(h,/init\(\{cookieHint: true, onChange: updateKiroku\}\)/);
    assert.match(h,/setInterval\(function \(\) \{ updateKiroku\(\);/);
  }
});
test('tcount: the "what is in this episode" line on the text card is made from the material (figures only buyers see, red-sheet spots)',{skip},async()=>{
  const b=await lib();
  const rows=[];
  for(let n=1;n<=9;n++){
    const m=b.loadMaterial(n),text=b.buildText(m),ex=b.buildExcerpt(m,text);
    const {A,B:Bn,buyerFigs,friendFigs}=b.tcountOf(m,text,ex);
    // 数え方：A＝購入者の画面の図 −（登録者の画面の図＝最初の1枚＋続きの抜粋）／B＝赤シート（今回の数字の分を含む）
    assert.equal(buyerFigs,m.json.figures.length);
    assert.equal(friendFigs,m.json.figures.filter(f=>f.tier!=='paid').length);
    assert.equal(A,m.json.figures.filter(f=>f.tier==='paid').length);
    // 購入者に配る本文（api/_ep-text）の実際の .rs と図の数に合う
    const html=require('../api/_ep-text/ep'+n);
    assert.equal((html.match(/class="[^"]*\brs\b/g)||[]).length,Bn,'ep'+n+' 赤シート');
    assert.equal((html.match(/<figure class="fig"/g)||[]).length,buyerFigs,'ep'+n+' 図');
    const want=b.tcountHtml({A,B:Bn});
    const h=trial(n);
    assert.ok(h.includes(want),'ep'+n);
    assert.ok(prodHtml(n).includes(want),'prod ep'+n);
    const line=strip(want);
    assert.equal(line,`この回は、図解があと${A}枚、赤シートが${Bn}か所。`);
    assert.doesNotMatch(line,NG);
    // 登録者の画面にだけ出す（登録なし・購入者には出さない）
    assert.match(h,/\.tcard \.tcount\{display:none\}/);
    assert.match(h,/\.is-friend \.tcard \.tcount\{display:block;/);
    assert.match(h,/\.is-buyer \.tcard \.tcount\{display:none\}/);
    rows.push([n,A,Bn]);
  }
  assert.equal(rows.length,9);
});
test('tcount: wording rules (A<=0 drops the figure part, B=0 drops the red-sheet part, both 0 drops the line)',{skip},async()=>{
  const b=await lib();
  const t=x=>strip(b.tcountHtml(x));
  assert.equal(t({A:3,B:12}),'この回は、図解があと3枚、赤シートが12か所。');
  assert.equal(t({A:0,B:12}),'この回は、赤シートが12か所。');
  assert.equal(t({A:-1,B:12}),'この回は、赤シートが12か所。');
  assert.equal(t({A:3,B:0}),'この回は、図解があと3枚。');
  assert.equal(b.tcountHtml({A:0,B:0}),'');
  assert.equal(b.tcountHtml({A:-2,B:0}),'');
});
test('gate: no 試 marks are left in the template, and the three fixes are in both the trial and the production output',{skip},async()=>{
  const tpl=read(path.join(root,'templates/ep-index.html'));
  assert.doesNotMatch(tpl,/\/\*試(終)?\*\/|<!--試(終)?-->/);
  const b=await lib();
  assert.equal(b.gateTest,undefined);
  for(let n=1;n<=9;n++)for(const h of [trial(n),prodHtml(n)]){
    assert.match(h,/kiroku|OPEN_ALL|tcount/,'ep'+n);
    assert.doesNotMatch(h,/\/\*試|<!--試/,'ep'+n);
    assert.doesNotMatch(h,/\{\{[A-Z_0-9]+\}\}/,'ep'+n);
  }
});
