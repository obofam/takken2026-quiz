// 配信された回の各アプリ（Spotify・Apple・stand.fm）の回の住所を拾って、ep-config.mjs の表に足す道具。鍵は使わない。
// （Amazon は鍵なしでは取れない：回の一覧がブラウザで描く画面で、公開のデータが無い。表に足すなら番組ページを Chrome で読んで手で足す。無い回は番組ページのままで困らない）
//
// 使い方（liff-test で）
//   node scripts/fetch-ep-links.mjs              下書き：配信日が今日以前で、住所が未入りの回を探して表に出すだけ
//   node scripts/fetch-ep-links.mjs --ep 1       その回だけ（配信日は見ない。入っている住所と合うかも出す）
//   node scripts/fetch-ep-links.mjs --apply      見つかった住所を ep-config.mjs の表に足す（既存の行は変えない）
//   --today YYYY-MM-DD  今日の日付を決め打ち（試し用）
//
// 回の見分け：stand.fm の RSS の各回の概要欄に「第N回「…」の図解と3問👇／https://takken.mimiobo.com/ep/N」の行がある。
// その N を回番号とし、Apple・Spotify は同じ題（正規化して完全一致）で当てる。当たりが無い・2つ以上ある物は足さず「要確認」。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = path.join(HERE, 'ep-config.mjs');
const DATE_MAP = path.join('C:\\Claude', '宅建', '2_放送内容', '2027', '配信日マップ.json');
const YEAR = 2027;
const RSS_URL = 'https://stand.fm/rss/69b1fa4b75c28fe6990cf326';
const APPLE_ID = '1886337945';
const APPLE_LOOKUP = `https://itunes.apple.com/lookup?id=${APPLE_ID}&entity=podcastEpisode&country=jp&limit=200`;
const SPOTIFY_SHOW = 'https://open.spotify.com/show/4UjPh6TOoRFcVUATL9IiE1';
const UA = 'Mozilla/5.0 (compatible; ep-links-check)';

// 設定の表の名前 → アプリの名前
export const TABLES = { SPOTIFY_EPISODE: 'spotify', APPLE_EPISODE: 'apple', AMAZON_EPISODE: 'amazon', STANDFM_EPISODE: 'standfm' };
const APPS = ['spotify', 'apple', 'standfm', 'amazon'];

const norm = s => String(s || '').normalize('NFKC').replace(/\s+/g, '');
const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

// 概要欄から回番号を出す。「の図解と3問」の次の行の https://takken.mimiobo.com/ep/N だけを信じる（2026の回が末尾に付ける「2027年新録版」の案内は拾わない）
export function extractEpNo(description) {
  const m = String(description || '').match(/の図解と3問[^\n]*\n\s*https?:\/\/takken\.mimiobo\.com\/ep\/(\d+)(?![\d/])/);
  return m ? Number(m[1]) : null;
}

// stand.fm の RSS → [{title, link, ep}]
export function parseRss(xml) {
  const out = [];
  for (const chunk of String(xml).split('<item>').slice(1)) {
    const cd = tag => {
      const m = chunk.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))</${tag}>`));
      return m ? (m[1] !== undefined ? m[1] : decode(m[2])) : '';
    };
    out.push({ title: cd('title'), link: cd('link').trim(), ep: extractEpNo(cd('description')) });
  }
  return out;
}

// Apple の lookup の結果 → [{title, url}]（住所は ?i=の番号だけの短い形）
export function parseApple(json) {
  return (json.results || []).filter(r => r.kind === 'podcast-episode' && r.trackId)
    .map(r => ({ title: r.trackName, url: `https://podcasts.apple.com/jp/podcast/id${APPLE_ID}?i=${r.trackId}` }));
}

// Spotify の番組ページ（サーバーで描かれた最近の回の一覧）→ [{title, url}]
export function parseSpotify(html) {
  const out = [];
  const re = /href="\/episode\/([A-Za-z0-9]{22})"[^>]*><h4[^>]*>(?:<span[^>]*><\/span>)?([^<]*)</g;
  let m;
  while ((m = re.exec(html))) out.push({ title: decode(m[2]), url: `https://open.spotify.com/episode/${m[1]}` });
  return out;
}

// 題で当てる。ちょうど1つなら {url}、無ければ {miss}、2つ以上なら {amb}
export function matchByTitle(list, title) {
  const hit = list.filter(x => norm(x.title) === norm(title));
  if (hit.length === 1) return { url: hit[0].url };
  return hit.length ? { amb: hit.length } : { miss: true };
}

// RSS の回番号 → 回の情報。同じ番号が2つ以上あれば amb
export function indexByEp(rssItems) {
  const map = new Map();
  for (const it of rssItems) {
    if (it.ep == null) continue;
    map.set(it.ep, map.has(it.ep) ? { amb: true } : it);
  }
  return map;
}

// ep-config.mjs のソースの表 name に「  N: 'url', // 日付 …」を足す。既にある回は変えない。
export function addToTable(src, name, ep, url, note) {
  const re = new RegExp(`(export const ${name} = \\{\\r?\\n)([\\s\\S]*?)(\\r?\\n\\};)`);
  const m = src.match(re);
  if (!m) throw new Error(`${name} が見つからない`);
  if (new RegExp(`^\\s*${ep}:`, 'm').test(m[2])) return src;
  const nl = m[1].includes('\r') ? '\r\n' : '\n'; // ep-config.mjs は CRLF
  const body = m[2].replace(/\s+$/, '');
  return src.replace(re, () => `${m[1]}${body}${nl}  ${ep}: '${url}', // ${note}${m[3]}`);
}

export async function readTables() {
  const C = await import(pathToFileURL(CONFIG).href + '?t=' + Date.now());
  return { spotify: C.SPOTIFY_EPISODE, apple: C.APPLE_EPISODE, amazon: C.AMAZON_EPISODE, standfm: C.STANDFM_EPISODE };
}

// 配信日マップ → 数字の回だけ { 回番号: 'YYYY-MM-DD' }
export function readDates(file = DATE_MAP) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const out = {};
  for (const [k, v] of Object.entries(j)) {
    if (!/^\d+$/.test(k)) continue;
    const m = String(v).match(/^(\d{2})(\d{2})#/);
    if (m) out[Number(k)] = `${YEAR}-${m[1]}-${m[2]}`;
  }
  return out;
}

async function get(url, asJson) {
  const r = await fetch(url, { headers: { 'user-agent': UA } });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return asJson ? r.json() : r.text();
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const epArg = args.includes('--ep') ? Number(args[args.indexOf('--ep') + 1]) : null;
  const today = args.includes('--today') ? args[args.indexOf('--today') + 1] : new Date().toISOString().slice(0, 10);
  const tables = await readTables();
  const dates = readDates();

  const eps = epArg ? [epArg] : Object.keys(dates).map(Number).filter(n => dates[n] <= today && APPS.some(a => a !== 'amazon' && !tables[a][n])).sort((a, b) => a - b);
  if (!eps.length) { console.log('住所が足りない配信済みの回は無い（今日=' + today + '）'); return; }

  const errs = [];
  const safe = async (name, fn) => { try { return await fn(); } catch (e) { errs.push(`${name}: ${e.message}`); return null; } };
  const rss = await safe('stand.fm RSS', async () => parseRss(await get(RSS_URL)));
  const apple = await safe('Apple', async () => parseApple(await get(APPLE_LOOKUP, true)));
  const spot = await safe('Spotify', async () => parseSpotify(await get(SPOTIFY_SHOW)));
  const byEp = rss ? indexByEp(rss) : new Map();

  const found = []; // {ep, app, url}
  console.log(`今日=${today}`);
  for (const ep of eps) {
    const it = byEp.get(ep);
    const res = {};
    if (!rss) res.standfm = { err: '取得失敗' };
    else if (!it) res.standfm = { miss: true };
    else if (it.amb) res.standfm = { amb: 2 };
    else res.standfm = { url: it.link };
    const viaTitle = (list, label) => {
      if (!list) return { err: '取得失敗' };
      if (!it || it.amb) return { miss: true };
      return matchByTitle(list, it.title);
    };
    res.apple = viaTitle(apple);
    res.spotify = viaTitle(spot);
    res.amazon = { na: true };
    console.log(`\n第${ep}回（配信日 ${dates[ep] || '?'}）`);
    for (const app of APPS) {
      const r = res[app], have = tables[app][ep];
      let s;
      if (r.url) {
        if (have) s = have === r.url ? `入済・一致 ${r.url}` : `入済だが違う\n      表: ${have}\n      今回: ${r.url}`;
        else { s = `見つかった ${r.url}`; found.push({ ep, app, url: r.url }); }
      } else if (r.amb) s = have ? `入済（当たりが複数＝要確認）` : '要確認（当たりが複数。足さない）';
      else if (r.miss) s = have ? '入済（今回は見つからず）' : '見つからない（配信前か、一覧に出ていない。要確認）';
      else if (r.err) s = have ? `入済（${r.err}）` : r.err;
      else s = have ? `入済 ${have}` : '自動では取れない（番組ページのまま。足すなら Chrome で番組ページを読んで手で）';
      console.log(`  ${app.padEnd(8)} ${s}`);
    }
  }
  if (errs.length) console.log('\n取得の失敗:\n  ' + errs.join('\n  '));

  if (!apply) { console.log(`\n足せる住所: ${found.length} 件（--apply で ep-config.mjs に足す）`); return; }
  let src = fs.readFileSync(CONFIG, 'utf8');
  const nameOf = Object.fromEntries(Object.entries(TABLES).map(([k, v]) => [v, k]));
  for (const f of found) src = addToTable(src, nameOf[f.app], f.ep, f.url, today);
  fs.writeFileSync(CONFIG, src);
  console.log(`\nep-config.mjs に ${found.length} 件足した。次：build-ep.mjs を回し直す（公開は別）。`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e); process.exit(1); });
}
