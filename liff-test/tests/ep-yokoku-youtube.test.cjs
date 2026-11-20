'use strict';
// 予告ページ（材料がまだ無い回）の言い方と、YouTube用の短い住所の転送（Kei 11/20）。
// ・YouTube講義を出す回（FREE_EARLY_EPS）は「図解と○×3問は準備中」→「音声の配信日」→「登録すると届く」の順。34〜36回（講義なし）は今までの言い方。
// ・/ep/N/yt・/ep/N/ytpin・/roadmap/yt は、既存の汎用の転送（utm_source=stf）より先に書かれていて、目印つきの住所へ行く。
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),prod=path.join(root,'..');
const read=p=>fs.readFileSync(p,'utf8');

test('yokoku page: YouTube episode says 準備中 first, then the audio date; non-YouTube episode keeps the old wording',()=>{
  for (const n of [10, 33, 41]) {
    const h=read(path.join(prod,'ep',String(n),'index.html'));
    const before=h.split('<div class="box before-only">')[1].split('</div>')[0];
    assert.match(before,/準備中です。/,`ep ${n}`);
    assert.ok(before.indexOf('準備中')<before.indexOf('音声は、'),`ep ${n}: 準備中 comes first`);
    assert.ok(before.indexOf('音声は、')<before.indexOf('LINEに登録すると'),`ep ${n}: date before LINE`);
  }
  for (const n of [34, 35, 36]) {
    const h=read(path.join(prod,'ep',String(n),'index.html'));
    const before=h.split('<div class="box before-only">')[1].split('</div>')[0];
    assert.doesNotMatch(before,/準備中/,`ep ${n}`);
    assert.doesNotMatch(before,/音声は、/,`ep ${n}`);
  }
});

test('vercel.json: yt / ytpin / roadmap yt rules come before the generic mark rules and keep the utm values',()=>{
  const r=JSON.parse(read(path.join(prod,'vercel.json'))).redirects;
  const find=s=>r.findIndex(x=>x.source===s);
  const iYt=find('/ep/:n([0-9]+)/yt'),iPin=find('/ep/:n([0-9]+)/ytpin'),iRm=find('/roadmap/yt');
  const iGen=r.findIndex(x=>/^\/ep\/:n\(\[0-9\]\+\)\/:mark/.test(x.source)),iGenRm=r.findIndex(x=>/^\/roadmap\/:mark/.test(x.source));
  assert.ok(iYt>=0&&iPin>=0&&iRm>=0);
  assert.ok(iYt<iGen&&iPin<iGen&&iRm<iGenRm);
  assert.equal(r[iYt].destination,'/ep/:n?utm_source=youtube&utm_medium=lecture');
  assert.equal(r[iPin].destination,'/ep/:n?utm_source=youtube&utm_medium=pin');
  assert.equal(r[iRm].destination,'/roadmap?utm_source=youtube&utm_medium=lecture');
});

test('umami-ctx: utm_source=youtube is its own entrance (youtube), mark lecture / pin',()=>{
  const code=read(path.join(prod,'ep','_shared','umami-ctx.js'));
  assert.match(code,/us === 'youtube'/);
  assert.match(code,/youtube: 1/);
});
