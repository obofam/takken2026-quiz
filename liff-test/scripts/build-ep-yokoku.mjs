// 回の「予告ページ」を作る。やさしいテキスト・図解の材料がまだ無い回（ep-release.json の prod に入っていない回）の /ep/N を、404にしないため。
// 使い方：node scripts/build-ep-yokoku.mjs            （1〜41回のうち、prod に入っていない回の ep/N/index.html を書く）
//         node scripts/build-ep-yokoku.mjs --check    （書かずに、できあがりの検査だけ）
// 材料：題＝roadmap/index.html の EPS（本編 n=1〜41）。配信日＝2_放送内容/2027/配信日マップ.json（祝日で火・木になる回がある）。二つの日付が違えば失敗する。
// 出し先：本番（リポジトリ直下）の ep/N/index.html。prod に入っている回（材料のある回）は書かない＝build-ep.mjs が作る本物のページを壊さない。
//         材料ができた回は ep-release.json の prod に足して build-ep.mjs を回す（そのとき予告ページは本物のページで上書きされる）。
// 中身：配信日より前＝題・配信日・LINE登録の案内・ロードマップへのリンク。図解・3問・聴くボタンは出さない。配信日以降＝「配信しました」と聴くリンク・LINE。
//       日付の判定は端末の日付（build-ep.mjs の配信前の閉じ方と同じ）。公開物なので、有料の中身は入らない（題と日付だけ）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as CFG from './ep-config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEST_ROOT = path.resolve(HERE, '..');
const PROD_ROOT = path.resolve(TEST_ROOT, '..');
const DATE_MAP = path.resolve(PROD_ROOT, '..', '2_放送内容', '2027', '配信日マップ.json');
const WEEK = '月火水木金土日';
const readText = p => fs.readFileSync(p, 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtDate = iso => {
  const [y, m, d] = iso.split('-').map(Number);
  const wd = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return `${y}年${m}月${d}日（${WEEK[wd]}）`;
};

/* ---- 材料を読む */
export function loadEpisodes() {
  const html = readText(path.join(PROD_ROOT, 'roadmap', 'index.html'));
  const m = /var EPS = (\[[\s\S]*?\]);\n/.exec(html);
  if (!m) throw new Error('roadmap/index.html に var EPS が見つからない');
  const eps = JSON.parse(m[1]).filter(e => e.kind === '本編' && e.n >= 1);
  const map = JSON.parse(readText(DATE_MAP));
  const out = [];
  for (let n = 1; n <= CFG.TOTAL_EPS; n++) {
    const e = eps.find(x => x.n === n);
    if (!e) throw new Error(`roadmap の EPS に第${n}回が無い`);
    const key = map[String(n).padStart(2, '0')];
    if (!key) throw new Error(`配信日マップに ${String(n).padStart(2, '0')} が無い`);
    const mmdd = /^(\d\d)(\d\d)#/.exec(key);
    if (!mmdd) throw new Error(`配信日マップの形が違う：${key}`);
    if (e.d !== `2027-${mmdd[1]}-${mmdd[2]}`) throw new Error(`第${n}回：日付が roadmap（${e.d}）と配信日マップ（${key}）で違う`);
    const parts = e.title.split(' ── ');
    const tentative = /タイトル未定/.test(e.sub || '');
    out.push({ n, date: e.d, title: parts[0], theme: parts.length > 1 ? parts.slice(1).join(' ── ') : '', tentative });
  }
  return out;
}

/* ---- 1回ぶんのページ */
export function buildYokoku(e) {
  const date = fmtDate(e.date);
  const k = Number(e.date.replace(/-/g, ''));
  const plainTitle = e.theme ? `${e.title} ── ${e.theme}` : e.title;
  /* YouTube講義を出す回（ep-config.mjs の FREE_EARLY_EPS）は、動画を見て来た人にも合う言い方にする：図解と○×3問が準備中であること→音声の配信日→登録すると届くこと */
  const early = CFG.FREE_EARLY_EPS.includes(e.n);
  const verb = e.tentative ? `${date}に配信する予定です。` : `${date}に配信します。`;
  const A = (href, ev, label, extra = '') => `<a ${extra}href="${href}" target="_blank" rel="noopener" data-umami-event="${ev}" data-umami-event-ep="${e.n}">${label}</a>`;
  const lineBtn = `<a class="lbtn" href="https://lin.ee/q7FbZoo" target="_blank" rel="noopener" data-umami-event="ep-line" data-umami-event-ep="${e.n}">LINEで受け取る</a>`;
  return `<!DOCTYPE html>
<html lang="ja" data-yokoku="1">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<script>(function(){var k=${k},n=new Date(),t=n.getFullYear()*10000+(n.getMonth()+1)*100+n.getDate();document.documentElement.className+=t<k?' ep-before':' ep-after';})();</script>
<title>第${e.n}回 ${esc(plainTitle)}｜耳で覚える宅建2027</title>
${CFG.UMAMI_SCRIPT}<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700;900&display=swap" rel="stylesheet">
<style>
/* 予告ページ（build-ep-yokoku.mjs が書く）。色・形は回のページ（templates/ep-index.html）にそろえる */
:root{--sky:#17C5E8;--ink:#0A6477;--soft:#E3F8FC;--bg:#F4FAFC;--text:#141B21;--sub:#6B6B76;--line:#DCEEF3;--font:"Noto Sans JP","Hiragino Sans","Yu Gothic",sans-serif;--shadow:0 2px 8px rgba(20,27,33,.05)}
*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%}
html,body{background:var(--bg)}
body{font-family:var(--font);word-break:auto-phrase;overflow-wrap:anywhere;color:var(--text);line-height:1.5;font-size:16px}
.page{max-width:430px;margin:0 auto;background:var(--bg);padding:14px 16px 24px}
.page>*+*{margin-top:12px}
.top{font-size:14px;color:#4F5963;line-height:1.5}
.title{background:var(--ink);color:#fff;border-radius:14px;padding:14px 16px 12px}
.title .row{display:flex;align-items:center;gap:10px}
.title .no{flex:0 0 auto;background:#fff;color:var(--ink);border-radius:999px;font-size:15px;font-weight:900;padding:1px 13px;line-height:1.5}
.title h1{font-size:22px;font-weight:900;line-height:1.3;flex:1;min-width:0}
.title .side{margin-top:10px;padding-top:9px;border-top:1px solid rgba(255,255,255,.35);font-size:18px;font-weight:700;line-height:1.3}
.box{background:#fff;border:1.5px solid var(--sky);border-radius:14px;padding:14px 14px}
.box p{margin:0;font-size:15px;line-height:1.7;text-align:center}
.box p+p{margin-top:8px}
.box .date{font-size:17px;font-weight:900;color:var(--ink)}
.lbtn{display:flex;align-items:center;justify-content:center;min-height:44px;margin-top:12px;text-align:center;font-weight:900;font-size:15px;line-height:1.4;color:var(--text);background:var(--sky);border-radius:999px;padding:8px 18px;text-decoration:none}
.listen{display:block;background:var(--sky);color:var(--text);border-radius:999px;padding:10px 16px;text-align:center;font-size:18px;font-weight:900;line-height:1.4;text-decoration:none}
.oapps{font-size:14px;color:#4F5963;line-height:1.7;margin-top:6px;text-align:center}
.oapps a{color:var(--ink);text-underline-offset:2px}
.prow{display:flex;align-items:center;gap:10px;background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow);padding:12px 12px;color:var(--text);text-decoration:none}
.prow .pt{display:block;font-size:15px;font-weight:700;line-height:1.4}
.prow .py{display:block;font-size:14px;color:#4F5963;line-height:1.5}
.prow .pmid{flex:1;min-width:0}
.prow .go{flex:none;width:8px;height:8px;border-top:2px solid var(--ink);border-right:2px solid var(--ink);transform:rotate(45deg)}
.nk{display:inline-block}
.before-only,.after-only{display:none}
.ep-before .before-only,.ep-after .after-only{display:block}
.trust{margin-top:20px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:8px;border-top:1px solid var(--line);padding:18px 2px 2px}
.trust .art{flex:none;width:44px;height:44px;border-radius:12px;object-fit:cover;display:block}
.trust .tn{font-size:14px;font-weight:700;line-height:1.5;color:var(--sub)}
.trust .tl2{font-size:14px;color:var(--ink);text-decoration:underline;text-underline-offset:3px}
.trust .tcopy{font-size:12px;line-height:1.5;color:var(--sub)}
@media (min-width:820px){
  html,body{background:#E6F0F3}
  body{font-size:17px}
  .page{max-width:680px;margin:28px auto 40px;padding:22px 32px 32px;border-radius:20px;box-shadow:0 2px 18px rgba(20,27,33,.06)}
  .title h1{font-size:26px}
}
</style>
</head>
<body>
<div class="page">

  <div class="top">第${e.n}回　${date}</div>
  <div class="title">
    <div class="row"><span class="no">第${e.n}回</span><h1>${esc(e.title)}</h1></div>${e.theme ? `\n    <div class="side">${esc(e.theme)}</div>` : ''}
  </div>

  <div class="box before-only">${early ? `
    <p><span class="nk">この回の図解と</span><span class="nk">○×3問は、</span><span class="nk">準備中です。</span></p>
    <p class="date">音声は、${verb}</p>` : `
    <p class="date">${verb}</p>`}
    <p><span class="nk">LINEに登録すると、</span><span class="nk">配信の日に</span><span class="nk">図解と○×3問が届きます。</span><br><span class="nk">登録は無料です。</span></p>
    ${lineBtn}
  </div>

  <div class="after-only">
    <a class="listen" href="${CFG.SPOTIFY_SHOW}" target="_blank" rel="noopener" data-umami-event="ep-spotify-show" data-umami-event-ep="${e.n}">音声番組を聴く（Spotify）</a>
    <p class="oapps">他：${A('https://podcasts.apple.com/jp/podcast/id1886337945', 'ep-app', 'Apple', 'data-umami-event-app="apple" ')} / ${A('https://music.amazon.co.jp/podcasts/79590722-f7ad-462f-bc00-a121b3affb1d', 'ep-app', 'Amazon', 'data-umami-event-app="amazon" ')} / ${A('https://stand.fm/channels/69b1fa4b75c28fe6990cf326', 'ep-app', 'stand.fm', 'data-umami-event-app="standfm" ')}</p>
  </div>
  <div class="box after-only">
    <p><span class="nk">この回は、</span><span class="nk">${date}に配信しました。</span></p>
    <p><span class="nk">図解と○×3問は、</span><span class="nk">準備中です。</span></p>
    <p><span class="nk">LINEに登録すると、</span><span class="nk">毎週月曜に</span><span class="nk">図解と○×3問が届きます。</span><br><span class="nk">登録は無料です。</span></p>
    ${lineBtn}
  </div>

  <a class="prow" href="/roadmap" data-umami-event="ep-roadmap" data-umami-event-ep="${e.n}"><span class="pmid"><span class="pt">学習ロードマップ</span><span class="py">全41回の予定を見る</span></span><span class="go" aria-hidden="true"></span></a>

  <div class="trust">
    <img class="art" src="${CFG.ART_PATH}" alt="耳で覚える宅建" width="44" height="44">
    <p class="tn">耳で覚える宅建</p><a class="tl2" href="https://www.mimiobo.com/" target="_blank" rel="noopener">www.mimiobo.com</a><p class="tcopy">© 2027 耳で覚える宅建</p>
  </div>
</div>
</body>
</html>
`;
}

/* ---- 実行 */
export function main(argv) {
  const check = argv.includes('--check');
  const release = JSON.parse(readText(path.join(TEST_ROOT, 'ep-release.json')));
  const eps = loadEpisodes();
  const wrote = [], skipped = [];
  for (const e of eps) {
    if (release.prod.includes(e.n)) { skipped.push(e.n); continue; }
    const html = buildYokoku(e);
    if (/\{\{|undefined|NaN/.test(html)) throw new Error(`第${e.n}回：差し込みが残っている`);
    if (!check) {
      const f = path.join(PROD_ROOT, 'ep', String(e.n), 'index.html');
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, html);
    }
    wrote.push(e.n);
  }
  console.log(`${check ? '検査' : '予告ページを書いた'}：${wrote.length}回（${wrote[0]}〜${wrote[wrote.length - 1]}）／本物のページがあるので書かない：${skipped.join(',')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
