'use strict';
// 先行公開の回（ep-config.mjs の STANDFM_EPISODE）：第1回は stand.fm の回の住所で「聴く」を出し、「配信は○月○日から（予定）」の注記を出さない。第2回以降は変えない。
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),prod=path.join(root,'..');
const read=p=>fs.readFileSync(p,'utf8');
const URL1='https://stand.fm/episodes/6b00055673b676464a0eb4e1';
const SHOW='https://open.spotify.com/show/4UjPh6TOoRFcVUATL9IiE1';

test('STANDFM_EPISODE: ep 1 only',async()=>{
  const C=await import(require('node:url').pathToFileURL(path.join(root,'scripts','ep-config.mjs')).href);
  assert.deepEqual(C.STANDFM_EPISODE,{1:URL1});
  assert.deepEqual(C.SPOTIFY_EPISODE,{});
});

test('ep 1 (prod and trial): main button = Spotify show, stand.fm episode URL in the other-apps row, no "予定" note',()=>{
  for(const h of [read(path.join(prod,'ep/1/index.html')),read(path.join(root,'ep/1/index.html'))]){
    assert.ok(h.includes('<a class="listen" href="'+SHOW+'" target="_blank" rel="noopener" data-umami-event="ep-spotify-show" data-umami-event-ep="1">音声番組を聴く（Spotify）</a>'));
    const row=h.match(/<p class="oapps">他：.*<\/p>/)[0];
    assert.ok(row.includes('<a href="'+URL1+'" target="_blank" rel="noopener" data-umami-event="ep-app" data-umami-event-app="standfm-ep">stand.fm</a>'));
    assert.ok(!row.includes('Spotify'));
    assert.doesNotMatch(h,/stand\.fm\/channels/);
    assert.doesNotMatch(h,/<p class="pnote haishin">/);
    assert.doesNotMatch(h,/いまは番組のページが開きます/);
    assert.match(h,/podcasts\.apple\.com[\s\S]*music\.amazon\.co\.jp/);
  }
});

test('ep 2-9 (prod and trial): unchanged listen / note',()=>{
  for(let n=2;n<=9;n++)for(const base of [prod,root]){
    const h=read(path.join(base,'ep/'+n+'/index.html'));
    assert.match(h,new RegExp('data-umami-event="ep-spotify-show" data-umami-event-ep="'+n+'">音声番組を聴く（Spotify）</a>'));
    assert.match(h,/<p class="pnote haishin"><span class="nk">この回の配信は<\/span> <span class="nk">2027年\d+月\d+日（.）から（予定）。<\/span><span class="nk">いまは番組のページが開きます。<\/span><\/p>/);
    assert.doesNotMatch(h,/stand\.fm\/episodes|standfm-ep/);
  }
});
