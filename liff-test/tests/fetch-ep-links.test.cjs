'use strict';
// 回の住所を拾う道具（scripts/fetch-ep-links.mjs）：回の見分けと、ep-config.mjs の表への足し方。ネットは使わない。
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const load=()=>import(require('node:url').pathToFileURL(path.join(__dirname,'..','scripts','fetch-ep-links.mjs')).href);

const RSS=`<rss><channel><item>
<title><![CDATA[【先行公開】第1回の題]]></title>
<description><![CDATA[コメント
第1回「免許」の図解と3問👇
https://takken.mimiobo.com/ep/1

▼去年の回
https://open.spotify.com/episode/aaaaaaaaaaaaaaaaaaaaaa]]></description>
<link>https://stand.fm/episodes/e1</link></item>
<item><title><![CDATA[2026の回]]></title>
<description><![CDATA[★2027も使える回です。
▼このテーマの2027年新録版📻
第12回「免許が消える日」2027年3月23日配信
https://takken.mimiobo.com/ep/12/sakutto10]]></description>
<link>https://stand.fm/episodes/old</link></item></channel></rss>`;

test('extractEpNo: 図解と3問の次の行のURLだけを回番号にする（2026の回の新録版案内は拾わない）',async()=>{
  const F=await load();
  const items=F.parseRss(RSS);
  assert.deepEqual(items.map(i=>i.ep),[1,null]);
  assert.equal(items[0].link,'https://stand.fm/episodes/e1');
  assert.equal(F.extractEpNo('第12回「x」の図解と3問👇\nhttps://takken.mimiobo.com/ep/12/sakutto10'),null);
  assert.equal(F.extractEpNo('第3回「x」の図解と3問👇\nhttps://takken.mimiobo.com/ep/3?utm=1'),3);
});

test('matchByTitle: 題が1つだけ当たれば採用・無ければ miss・複数なら amb',async()=>{
  const F=await load();
  const list=[{title:'A　題',url:'u1'},{title:'B',url:'u2'},{title:'B',url:'u3'}];
  assert.deepEqual(F.matchByTitle(list,'A 題'),{url:'u1'});
  assert.deepEqual(F.matchByTitle(list,'B'),{amb:2});
  assert.deepEqual(F.matchByTitle(list,'C'),{miss:true});
  const idx=F.indexByEp([{ep:2,title:'x'},{ep:2,title:'y'},{ep:null,title:'z'}]);
  assert.equal(idx.get(2).amb,true);
});

test('parseApple / parseSpotify',async()=>{
  const F=await load();
  assert.deepEqual(F.parseApple({results:[{kind:'podcast'},{kind:'podcast-episode',trackId:7,trackName:'T'}]}),[{title:'T',url:'https://podcasts.apple.com/jp/podcast/id1886337945?i=7'}]);
  const h='<a href="/episode/0hUKmbfs0MXA0Iwql6KpAd"><h4 class="x"><span class="y" aria-label="New episode"></span>題 &amp; 1</h4>';
  assert.deepEqual(F.parseSpotify(h),[{title:'題 & 1',url:'https://open.spotify.com/episode/0hUKmbfs0MXA0Iwql6KpAd'}]);
});

test('addToTable: 表の最後に日付つきで足す・既にある回は変えない・他の表は触らない',async()=>{
  const F=await load();
  const src="export const A = {\n  1: 'u1', // x\n};\nexport const B = {\n  1: 'b1',\n};\n";
  const out=F.addToTable(src,'A',2,'u2','2027-01-12');
  assert.equal(out,"export const A = {\n  1: 'u1', // x\n  2: 'u2', // 2027-01-12\n};\nexport const B = {\n  1: 'b1',\n};\n");
  assert.equal(F.addToTable(out,'A',2,'zzz','d'),out);
  assert.throws(()=>F.addToTable(src,'NOPE',1,'u','d'));
});

test('実物の ep-config.mjs に足しても読み込める（書き換えず文字列で確認）',async()=>{
  const F=await load();
  const fs=require('node:fs');
  const src=fs.readFileSync(path.join(__dirname,'..','scripts','ep-config.mjs'),'utf8');
  for(const name of Object.keys(F.TABLES)){
    const out=F.addToTable(src,name,99,'https://example.com/x','2027-01-01');
    assert.match(out,/ {2}99: 'https:\/\/example\.com\/x', \/\/ 2027-01-01\r?\n\};/);
  }
});

test('readDates: 数字の回だけ・年は2027',async()=>{
  const F=await load();
  const d=F.readDates();
  assert.equal(d[1],'2027-01-04');assert.equal(d[2],'2027-01-12');
  assert.ok(!('まとめ1' in d));
});
