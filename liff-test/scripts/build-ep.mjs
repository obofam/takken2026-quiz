// 回のページ（図解と3問）を、回の番号を渡して作る。
// 使い方：node scripts/build-ep.mjs 2   ／   node scripts/build-ep.mjs 1-9   ／   node scripts/build-ep.mjs 2,3,5   ／   node scripts/build-ep.mjs all
// 材料：6_有料PDF/やさしいテキスト_2027/ の 第NN回_*.html・第NN回_流し込み材料.json・直感図解/第NN回_*/data.json（読むだけ）。
//
// 試し用だけに書く：--shisaku を付ける（例：node scripts/build-ep.mjs 1-9 --shisaku）。本番（リポジトリ直下）には1バイトも書かない。
//
// 出し先（大事）
//   試し用（liff-test が公開ルート）：liff-test/ep/N/（index.html・line-full.html・line-full.js・tsuzuki.html）と、有料の中身 liff-test/api/_ep-text/epN.js・epN.pdf。
//   本番（リポジトリ直下）：ep-release.json の prod に入っている回だけ。ep/N/ と api/_ep-text/。入っていない回は本番へ書かない。
//   有料の中身（api/_ep-text/）は .gitignore 済み（公開リポジトリに入れない）。見本ページ ep/N/text/ を作るのは第1回だけ。
// 元の文言は変えない：タグを除いた文字列が元と一致しなければ失敗する。赤シートの find は、そのページ内に1回だけでなければ失敗する。
// 型：liff-test/templates/ep-index.html・ep-line-full.html・ep-line-full.js（もとは第1回の手作りの ep/1/index.html）。回に固有の所は {{…}} で差し込む。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as CFG from './ep-config.mjs';
import { EP1_CSS_TAIL, ep1FixPage2, ep1WrapTm } from './ep-legacy.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TEST_ROOT = path.resolve(HERE, '..');
export const PROD_ROOT = path.resolve(TEST_ROOT, '..');
export const MATERIAL = path.resolve(PROD_ROOT, '..', '6_有料PDF', 'やさしいテキスト_2027');
const CIRCLE = '○';
const RS = ' role="button" tabindex="0"';

/* ============================================================ 小さな部品 */
const readText = p => fs.readFileSync(p, 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
const readJson = p => JSON.parse(readText(p));
const escAttr = t => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const escText = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const plain = h => h.replace(/<[^>]+>/g, '').replace(/\s+/g, '');
const count = (h, s) => h.split(s).length - 1;
const once = (h, from, to) => {
  const n = count(h, from);
  if (n !== 1) throw new Error('not unique (' + n + '): ' + from);
  return h.replace(from, () => to);
};
const WEEK = '月火水木金土日';
const fmtDate = iso => {
  const [y, m, d] = iso.split('-').map(Number);
  const wd = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return `${y}年${m}月${d}日（${WEEK[wd]}）`;
};
const fmtYmd = iso => { const [y, m, d] = iso.split('-').map(Number); return `${y}年${m}月${d}日`; };
/* Python の json.dumps(ensure_ascii=False) と同じ区切り（", " と ": "）で書く。過去問・○×のデータの書き方を、もとの build.py にそろえる */
const pyJson = v => {
  if (Array.isArray(v)) return '[' + v.map(pyJson).join(', ') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).map(k => JSON.stringify(k) + ': ' + pyJson(v[k])).join(', ') + '}';
  return JSON.stringify(v);
};
const jsJson = v => pyJson(v).replace(/<\//g, '<\\/');
const SCRIPT_NAME = ep => (ep === 1 ? 'build-ep1-text.mjs' : 'build-ep.mjs'); /* 第1回の出力の注記は、いまの本番のまま（build-ep1-text.mjs は build-ep.mjs を呼ぶだけの入口として残る） */

/* ============================================================ 材料を読む */
export function loadMaterial(ep) {
  const nn = String(ep).padStart(2, '0');
  const names = fs.readdirSync(MATERIAL);
  const htmls = names.filter(n => n.startsWith('第' + nn + '回_') && n.endsWith('.html'));
  if (htmls.length !== 1) throw new Error(`第${nn}回の html が ${htmls.length} 個（1個のはず）`);
  const jsonPath = path.join(MATERIAL, `第${nn}回_流し込み材料.json`);
  if (!fs.existsSync(jsonPath)) throw new Error('流し込み材料 json が無い: ' + jsonPath);
  const json = readJson(jsonPath);
  if (json.ep !== ep) throw new Error(`json の ep が ${json.ep}（${ep} のはず）`);
  if (json.files.html !== htmls[0]) throw new Error('json の files.html が html と違う: ' + json.files.html + ' / ' + htmls[0]);
  const pdfPath = path.join(MATERIAL, json.files.pdf);
  if (!fs.existsSync(pdfPath)) throw new Error('PDF の元がない: ' + json.files.pdf);
  const dirs = fs.readdirSync(path.join(MATERIAL, '直感図解')).filter(n => n.startsWith('第' + nn + '回_') && fs.statSync(path.join(MATERIAL, '直感図解', n)).isDirectory());
  if (dirs.length !== 1) throw new Error(`直感図解/第${nn}回_* が ${dirs.length} 個`);
  const data = readJson(path.join(MATERIAL, '直感図解', dirs[0], 'data.json'));
  if (data.ep !== ep) throw new Error('data.json の ep が違う');
  return { ep, nn, json, data, html: readText(path.join(MATERIAL, htmls[0])), pdfPath, htmlName: htmls[0] };
}

function validateMaterial(m) {
  const { json, data, ep } = m;
  const tiers = new Set(['free', 'line', 'paid']);
  if (json.figures.some(f => !tiers.has(f.tier))) throw new Error(`第${ep}回：tier が free/line/paid 以外`);
  if (json.figures.filter(f => f.tier === 'free').length !== 1) throw new Error(`第${ep}回：free の図は1枚のはず`);
  if (json.figures.find(f => f.tier === 'free').half !== 1) throw new Error(`第${ep}回：free の図は前半にあるはず`);
  if (json.date !== data.date) throw new Error(`第${ep}回：日付が json と data.json で違う`);
  if (json.title !== data.title.replace(/\n/g, '')) throw new Error(`第${ep}回：題が json と data.json で違う`);
  if (data.quizSets.length !== 2) throw new Error(`第${ep}回：○×3問の組は2つのはず`);
  for (const q of data.quizSets) if (q.questions.length !== 3) throw new Error(`第${ep}回：○×は1組3問のはず`);
  for (const p of json.points) if (![1, 2].includes(p.half)) throw new Error(`第${ep}回：points の half が 1・2 以外`);
  if (json.points.length < 1 || json.points.length > 2) throw new Error(`第${ep}回：points は1〜2件のはず`);
  for (const x of json.numbers) if (/[<>&]/.test(x.n + x.k)) throw new Error(`第${ep}回：今回の数字に < > & がある`);
}

/* ============================================================ やさしいテキスト（スマホ1列）を組む */
const hintOf = (text, choice) => {
  if (Object.prototype.hasOwnProperty.call(choice, text)) return choice[text];
  const chars = Array.from(text);
  if (/[0-9０-９]/.test(text)) return text.replace(/[0-9０-９][0-9０-９,]*/g, CIRCLE); /* 1,000万円 は ○万円（カンマ入りの数字は1つ） */
  const keep = c => '・、〜'.indexOf(c) >= 0 || /\s/.test(c);
  const n = chars.filter(c => !keep(c)).length, head = n <= 1 ? 0 : 1;
  let k = 0;
  return chars.map(c => (keep(c) ? c : (k++ < head ? c : CIRCLE))).join('');
};

const stripPage = (html, withTitle) => {
  /* 印刷用A4版だけにある「今回の数字」の帯・ページ上の帯・題・下の帯は外す（スマホ用の今回の数字は json から作った節を1つだけ出す） */
  html = html.replace(/\s*<!-- 今回の数字:ここから -->[\s\S]*?<!-- 今回の数字:ここまで -->/g, '');
  html = html.replace(/\s*<div class="pbar">[\s\S]*?<\/div>\n/, '\n');
  if (withTitle) html = html.replace(/\s*<div class="ttl">[\s\S]*?<\/div>\n/, '\n');
  if (html.includes('<div class="grow"></div>')) html = html.replace(/\s*<div class="grow"><\/div>[\s\S]*$/, '\n');
  else html = html.replace(/\s*<div class="foot">[\s\S]*$/, '\n');
  return html.replace(/<!--[\s\S]*?-->/g, '').trim();
};

const symbolsOf = src => {
  const o = {};
  for (const m of src.matchAll(/<symbol id="([^"]+)" viewBox="([^"]+)">([\s\S]*?)<\/symbol>/g)) o[m[1]] = { vb: m[2], inner: m[3] };
  return o;
};
const inlineUse = (h, symbols) => {
  const sym = id => { const s = symbols[id]; if (!s) throw new Error('no symbol ' + id); return s; };
  h = h.replace(/<svg( class="ic")?><use href="#([^"]+)"\s*\/><\/svg>/g, (_, c, id) => `<svg${c || ''} viewBox="${sym(id).vb}">${sym(id).inner}</svg>`);
  h = h.replace(/<use\b([^>]*?)\bhref="#([^"]+)"([^>]*?)\/?>/g, (_, a, id, b) => `<svg ${(a + b).trim()} viewBox="${sym(id).vb}">${sym(id).inner}</svg>`);
  if (/<use /.test(h)) throw new Error('use left');
  return h;
};

/* 赤シートの対象：find（そのページの中にちょうど1回）の中の text（find の中にちょうど1回）の位置で当てはめる。
   text が1つの <span>/<b> の中身ぜんぶなら、その要素に rs を付ける（mk は rs に置き換える）。そうでなければ text を <span class="rs"> で包む。
   narrow があれば、かけるのは核の語だけ。編集は位置で行うので、同じ find を使う target があっても、芯の中に target が複数あってもよい。 */
const markOpen = (tag, hint) => {
  const m = /\bclass="([^"]*)"/.exec(tag);
  if (m) {
    const cls = m[1].split(/\s+/).filter(c => c && c !== 'mk').concat('rs');
    tag = tag.slice(0, m.index) + `class="${cls.join(' ')}"` + tag.slice(m.index + m[0].length);
  } else tag = tag.replace(/^<([a-zA-Z0-9]+)/, '<$1 class="rs"');
  return tag.slice(0, -1) + `${RS} data-hint="${escAttr(hint)}">`;
};
const rsSpan = (text, hint) => `<span class="rs"${RS} data-hint="${escAttr(hint)}">${text}</span>`;
const wholeElement = (h, s, e) => {
  const m = /<(span|b)\b[^>]*>$/.exec(h.slice(0, s));
  if (!m || m.index + m[0].length !== s) return null;
  if (!h.startsWith(`</${m[1]}>`, e)) return null;
  return { os: m.index, oe: s };
};
function applyTargets(h, half, red, ctx) {
  const edits = [];
  for (const t of red.targets) {
    if (t.half !== half) continue;
    const { find, text } = t;
    if (!find || !text) throw new Error(`${ctx}：find か text が空（半分${half}）`);
    const nf = count(h, find);
    if (nf !== 1) throw new Error(`${ctx}：半分${half}「${text}」の find がページ内に ${nf} 回（ちょうど1回のはず）：${find}`);
    const nt = count(find, text);
    if (nt !== 1) throw new Error(`${ctx}：半分${half}「${text}」が find の中に ${nt} 回（ちょうど1回のはず）：${find}`);
    const s = h.indexOf(find) + find.indexOf(text), e = s + text.length;
    const core = Object.prototype.hasOwnProperty.call(red.narrow, text) ? red.narrow[text] : null;
    const hint = hintOf(core || text, red.choice);
    const el = wholeElement(h, s, e);
    if (core && text.includes(core)) {
      const j = text.indexOf(core);
      edits.push([s + j, s + j + core.length, rsSpan(core, hint), text]);
    } else if (el) edits.push([el.os, el.oe, markOpen(h.slice(el.os, el.oe), hint), text]);
    else edits.push([s, e, rsSpan(text, hint), text]);
  }
  edits.sort((a, b) => a[0] - b[0]);
  let out = '', pos = 0, last = 0;
  for (const [s, e, nw, text] of edits) {
    if (s < last) throw new Error(`${ctx}：半分${half}「${text}」が前の対象と重なる`);
    out += h.slice(pos, s) + nw;
    pos = last = e;
  }
  out += h.slice(pos);
  /* 芯の蛍光ペン（.mk）は、どれも中に対象が1つ以上あること */
  for (const m of h.matchAll(/<span class="mk">/g)) {
    let depth = 0, i = m.index, end = -1;
    for (const t of h.slice(i).matchAll(/<span\b|<\/span>/g)) {
      depth += t[0] === '</span>' ? -1 : 1;
      if (depth === 0) { end = i + t.index + t[0].length; break; }
    }
    if (end < 0 || !edits.some(ed => ed[0] >= m.index && ed[0] < end)) throw new Error(`${ctx}：半分${half}に、対象のない蛍光ペン（.mk）がある：${h.slice(m.index, m.index + 60)}`);
  }
  return out;
};
/* 赤シートの対象と前後の「（」「。、」）」が、帯から離れて行頭・行末に残らないよう、くっつけて折らない箱に入れる（タグだけ） */
const glue = h => h.replace(/([「『（]?)(<(span|b) class="[^"]*\brs\b[^"]*"[^>]*>[^<]*<\/\3>)([。、」』）]?)/g, (m, a, el, _t, z) => ((a || z) ? `<span class="nb">${a}${el}${z}</span>` : m));

/* 幅の広い図（role="img" の svg）を、字が11pxより小さくなるなら横スクロールの箱に入れる（材料の _tools/preview_sp.py の plan_svgs と同じ計算） */
const AVAIL = 332, TARGET_PX = 11;
function planSvgs(h) {
  let out = '', pos = 0;
  for (const m of h.matchAll(/<svg\b[^>]*role="img"[^>]*>[\s\S]*?<\/svg>/g)) {
    const s = m[0];
    out += h.slice(pos, m.index);
    pos = m.index + s.length;
    const vb = /viewBox="[\d.]+ [\d.]+ ([\d.]+) ([\d.]+)"/.exec(s);
    const fonts = [...s.matchAll(/<(?:text|tspan)\b[^>]*?\bfont-size="([0-9.]+)"/g)].map(x => Number(x[1]));
    const f = fonts.length ? Math.min(...fonts) : null;
    const before = h.slice(0, m.index);
    const inTl = before.lastIndexOf('<div class="tl">') > before.lastIndexOf('</figure>') && before.lastIndexOf('<div class="tl">') >= 0;
    const fEff = f && inTl ? Math.max(f, 15) : f;
    if (!vb || !fEff) { out += s; continue; }
    const W = Number(vb[1]);
    const need = W * TARGET_PX / fEff;
    if (need > AVAIL + 1) {
      const px = Math.ceil(need);
      const s2 = /^<svg\b[^>]*\bstyle="/.test(s.split('>', 1)[0])
        ? s.replace(/style="([^"]*)"/, (_, st) => `style="${st};width:${px}px;max-width:none;height:auto"`)
        : s.replace('<svg', `<svg style="width:${px}px;max-width:none;height:auto"`);
      out += `<div class="xs${px <= AVAIL + 26 ? ' xs-fit' : ''}" tabindex="0">${s2}</div>`; /* 枠いっぱいに収まる幅なら、枠の端まで広げて横スクロールを出さない */
    } else out += s;
  }
  return out + h.slice(pos);
}

/* ---- CSS ---- */
const stripBraceBlock = (css, headerRe) => {
  for (;;) {
    const m = headerRe.exec(css);
    if (!m) return css;
    const i = css.indexOf('{', m.index);
    let depth = 0, j = i;
    for (; j < css.length; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') { depth--; if (depth === 0) break; }
    }
    css = css.slice(0, m.index) + css.slice(j + 1);
  }
};
const NUM_CSS = `
/* 今回の数字（有料だけ。抜粋には入れない） */
.numh{font-size:22px;font-weight:900;color:var(--ink);line-height:1.3}
.nl{display:flex;flex-direction:column;gap:8px}
.nr{display:flex;flex-direction:column;align-items:flex-start;gap:2px;background:#fff;border:1px solid var(--line);border-radius:12px;padding:8px 12px}
.nv{font-size:24px;font-weight:900;color:var(--ink);line-height:1.3}
.nr .nk{font-size:16px;line-height:1.5}
`;
const spOverridesCss = () => {
  const css = readText(path.join(MATERIAL, '_tools', 'sp_overrides.css'));
  if (count(css, '.thost{') !== 1) throw new Error('sp_overrides.css の .thost{ が1つでない');
  /* 材料の確認用ページでは .thost が枠。本物は Shadow DOM なので :host に読み替える（--sheet もここで持つ） */
  return '\n' + css.replace('.thost{', ':host{--sheet:#8E3B3B;');
};

/* ---- 1回ぶんのテキストを組む ----
   戻り値：{ html（API が返す文字列）, p1, p2, p3, n1, n2（赤シートなしの抜粋用）, css, raw（外した後の元）, … } */
export function buildText(m) {
  const { ep, json, html: src } = m;
  const legacy = CFG.LEGACY_EPS.includes(ep);
  const ctx = `第${ep}回`;
  const symbols = symbolsOf(src);
  const pages = [...src.matchAll(/<section class="page(?: p\d)?">([\s\S]*?)<\/section>\s*(?=<!--|<\/div>)/g)].map(x => x[1]);
  if (pages.length !== 2) throw new Error(ctx + '：ページが ' + pages.length + ' 個（2個のはず）');
  let css = src.match(/<style>([\s\S]*?)<\/style>/)[1];
  css = css.replace(/:root\{/, ':host{');
  css = stripBraceBlock(css, /@page\s*\{/);
  if (legacy) css = css.replace(/@media print\{[\s\S]*?\n  \}\n/, '');
  else { css = stripBraceBlock(css, /@media\s+print\s*\{/); css = stripBraceBlock(css, /@media\s+screen\s*\{/); }
  const raw = [stripPage(pages[0], true), stripPage(pages[1], false)];
  const before = raw.map(h => plain(inlineUse(h, symbols)));
  const red = json.redsheet;
  /* 元のページの中でも find が1回だけ（外した帯・題の中の同じ字に当たっていないか） */
  for (const t of red.targets) {
    const orig = pages[t.half - 1];
    if (count(orig, t.find) !== 1) throw new Error(`${ctx}：半分${t.half}「${t.text}」の find が元のページ内に ${count(orig, t.find)} 回（ちょうど1回のはず）`);
  }
  const make = withRs => raw.map((h0, i) => {
    let h = withRs ? applyTargets(h0, i + 1, red, ctx) : h0;
    if (legacy) { if (i === 1) h = ep1FixPage2(h); h = ep1WrapTm(h); } else h = planSvgs(h);
    h = inlineUse(h, symbols);
    if (/<use /.test(h)) throw new Error('use left');
    return withRs ? glue(h) : h;
  });
  const [p1, p2] = make(true);
  const [n1, n2] = make(false);
  /* 今回の数字（有料だけ。無料の抜粋には入れない）。0組なら節そのものを作らない */
  const nums = json.numbers;
  const p3 = nums.length
    ? '<h2 class="numh">今回の数字</h2><div class="nl">' + nums.map(x => `<div class="nr"><span class="nv rs"${RS} data-hint="${escAttr(hintOf(x.n, red.choice))}">${x.n}</span><span class="nk">${x.k}</span></div>`).join('') + '</div>'
    : '';
  /* 文言が変わっていないか */
  if (before[0] !== plain(p1) || before[1] !== plain(p2)) throw new Error(ctx + '：text changed');
  if (before[0] !== plain(n1) || before[1] !== plain(n2)) throw new Error(ctx + '：text changed (nukigaki base)');
  if (plain(p3) !== plain(nums.length ? '今回の数字' + nums.map(x => x.n + x.k).join('') : '')) throw new Error(ctx + '：text changed (numbers)');
  const rsCount = h => (h.match(/class="[^"]*\brs\b/g) || []).length;
  const expectRs = red.targets.length + nums.length;
  if (rsCount(p1) + rsCount(p2) + rsCount(p3) !== expectRs) throw new Error(`${ctx}：赤シートの数が合わない（${rsCount(p1)}+${rsCount(p2)}+${rsCount(p3)} と、対象${red.targets.length}＋今回の数字${nums.length}）`);
  css = legacy ? css + EP1_CSS_TAIL : css + '\n/* ===== スマホ1列（材料の _tools/sp_overrides.css） ===== */' + spOverridesCss();
  const body = '<style>' + css + NUM_CSS + '</style>' +
    '<div class="tx" data-part="1">' + p1 + '</div>' +
    '<div class="tx" data-part="2">' + p2 + '</div>' +
    (p3 ? '<div class="tx" data-part="3">' + p3 + '</div>' : '');
  const jsModule = `'use strict';\n// ${SCRIPT_NAME(ep)} が作る。手で直さない。やさしいテキスト第${ep}回（有料）。公開しない（api/_ は URL で取れない）。\nmodule.exports = ` + JSON.stringify(body) + ';\n';
  return { html: body, jsModule, p1, p2, p3, n1, n2, css, raw, rs: [rsCount(p1), rsCount(p2), rsCount(p3)], symbols };
}

/* ============================================================ 図の抜粋（無料・LINE登録者向け）と、公開してよい部品 */
const figsOf = h => [...h.matchAll(/<figure class="fig"[^>]*>[\s\S]*?<\/figure>/g)].map(x => x[0]);
const figNo = f => Number(f.match(/<span class="n">(\d+)<\/span>/)[1]);
const capTitle = f => f.match(/<div class="cap"><span class="n">\d+<\/span>([^<]*)/)[1];
const noComments = css => css.replace(/\/\*[\s\S]*?\*\//g, '');

export function buildExcerpt(m, text) {
  const { ep, json } = m;
  const orig = {}, nuki = {};
  for (const h of text.raw) for (const f of figsOf(h)) orig[figNo(f)] = f;
  for (const h of [text.n1, text.n2]) for (const f of figsOf(h)) nuki[figNo(f)] = f;
  const allNos = Object.keys(orig).map(Number).sort((a, b) => a - b);
  if (allNos.join() !== json.figures.map(f => f.no).sort((a, b) => a - b).join()) throw new Error(`第${ep}回：図の番号が json と html で違う（html ${allNos}）`);
  const tier = {}, half = {};
  for (const f of json.figures) { tier[f.no] = f.tier; half[f.no] = f.half; }
  for (const n of allNos) {
    if (capTitle(orig[n]) !== json.figures.find(f => f.no === n).cap) throw new Error(`第${ep}回：図${n}の題が json と html で違う`);
    const open = tier[n] !== 'paid';
    if (open) {
      if (plain(inlineUse(orig[n], text.symbols)) !== plain(nuki[n])) throw new Error('nukigaki text changed in fig ' + n);
      if (/\brs\b|role="button"/.test(nuki[n])) throw new Error('rs in nukigaki fig ' + n);
      if (/<use /.test(nuki[n])) throw new Error('use left in fig ' + n);
    }
  }
  const freeNo = json.figures.find(f => f.tier === 'free').no;
  const card = n => '<div class="gcard"><span class="gno">' + n + '</span><span class="gm"><span class="gt">' + capTitle(orig[n]) + '</span><span class="gn">この図は、<a href="' + CFG.SITE + CFG.TEXT_SAMPLE_PATH + '" data-umami-event="ep-text" data-umami-event-ep="' + ep + '">やさしいテキスト（有料）</a>に</span></span></div>';
  const fig = n => '<div class="tx" data-fig="' + n + '">' + nuki[n] + '</div>';
  const seq = nos => nos.map(n => (tier[n] !== 'paid' ? fig(n) : card(n))).join('\n');
  const cards1 = allNos.filter(n => half[n] === 1 && n !== freeNo), cards2 = allNos.filter(n => half[n] === 2);
  const css = noComments(text.css);
  const html =
    `<!-- 第${ep}回 図解：やさしいテキストからの抜粋（無料・LINE登録者向け）。scripts/${SCRIPT_NAME(ep)} が作る。手で直さない。赤シートなし。 -->\n` +
    '<style data-nk="css">' + css + '</style>\n' +
    '<div data-slot="fig1">\n' + fig(freeNo) + '\n</div>\n' +
    '<div data-slot="cards1">\n' + seq(cards1) + '\n</div>\n' +
    '<div data-slot="cards2">\n' + seq(cards2) + '\n</div>\n';
  return { html, css, freeNo, fig1: fig(freeNo), orig, nuki, tier, counts: { free: 1, line: allNos.filter(n => tier[n] === 'line').length, paid: allNos.filter(n => tier[n] === 'paid').length } };
}

/* ============================================================ 回のページ（型に回の中身を入れる） */
const tplCache = {};
const template = name => (tplCache[name] ??= readText(path.join(TEST_ROOT, 'templates', name)));
const fill = (tpl, vals) => {
  const used = new Set();
  const out = tpl.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, k) => {
    if (!(k in vals)) throw new Error('型の {{' + k + '}} に入れる値がない');
    used.add(k);
    return vals[k];
  });
  for (const k of Object.keys(vals)) if (!used.has(k)) throw new Error('型にない値: ' + k);
  return out;
};
const T = s => escText(s).replace(/\n/g, '<br>');
const titleHtml = title => {
  if (title.includes('\n')) return T(title);
  const i = title.indexOf('、');
  if (i > 0 && i < 12 && i + 1 < title.length) return T(title.slice(0, i + 1)) + '<br>' + T(title.slice(i + 1));
  return T(title);
};
/* 「対象」の札：短ければそのまま、長ければ文節ごとの箱（.nk）に分ける */
const nkChunks = line => {
  const MAX = 14, out = [];
  for (const p of line.split(/(?<=[、。])/)) {
    if (Array.from(p).length <= MAX) { out.push(p); continue; }
    let cur = '';
    for (const { segment } of new Intl.Segmenter('ja', { granularity: 'word' }).segment(p)) {
      if (Array.from(cur + segment).length > MAX && cur) { out.push(cur); cur = segment; } else cur += segment;
    }
    if (cur) out.push(cur);
  }
  if (out.length > 1 && Array.from(out[out.length - 1]).length <= 3) { const l = out.pop(); out[out.length - 1] += l; }
  return out;
};
const targetDiv = (ep, halfNo, scope) => {
  if (!scope) return '';
  const forced = CFG.TARGET_CHUNKS[ep]?.[halfNo];
  const lines = scope.split('\n');
  const body = lines.map(l => {
    const chunks = forced && lines.length === 1 ? forced : (Array.from(l).length <= 16 ? null : nkChunks(l));
    if (forced && lines.length === 1 && forced.join('') !== l) throw new Error('対象の札の区切りが元の文と違う');
    return chunks ? chunks.map(c => `<span class="nk">${T(c)}</span>`).join('') : T(l);
  }).join('<br>');
  return `<div class="target">${body}</div>`;
};
const pointCore = text => `<div class="core"><h2>今日のポイント</h2><p>${T(text)}</p></div>`;

/* ---- 過去問の朱入れ（本番・試し用の両方）。データは liff-test/ep-kakomon-shuire.json（回→選択肢の記号→[{mark}|{del,to}]）。
   mark・del の語は、その選択肢の本文（材料の kakomon.items[].t）にちょうど1回。del は ok:false の選択肢だけ。語どうしは重ならない。 */
export const SHUIRE_FILE = path.join(TEST_ROOT, 'ep-kakomon-shuire.json');
export const SHUIRE_STYLE = 'after'; /* 'ruby'（取り消した字の上）／'after'（すぐ後ろ）。375px幅で確かめて決めた */
export const loadShuire = () => (fs.existsSync(SHUIRE_FILE) ? readJson(SHUIRE_FILE) : {});
export function shuireFor(ep, k, data = loadShuire()) {
  const d = data[String(ep)];
  if (!d) return null;
  const ctx = `第${ep}回の朱入れ`;
  if (typeof d !== 'object' || Array.isArray(d)) throw new Error(ctx + '：回の中身は {記号: [..]} のはず');
  const out = {};
  for (const [no, arr] of Object.entries(d)) {
    const it = k.items.find(x => x.m === no);
    if (!it) throw new Error(`${ctx}：選択肢 ${no} が材料に無い`);
    if (!Array.isArray(arr) || !arr.length) throw new Error(`${ctx}：選択肢 ${no} は空でない配列のはず`);
    const spans = [];
    for (const a of arr) {
      const keys = Object.keys(a).sort().join();
      const isMark = keys === 'mark', isDel = keys === 'del,to';
      if (!isMark && !isDel) throw new Error(`${ctx}：選択肢 ${no} の項目は {mark} か {del,to} のはず：${JSON.stringify(a)}`);
      const w = isMark ? a.mark : a.del;
      if (typeof w !== 'string' || !w) throw new Error(`${ctx}：選択肢 ${no} の語が空`);
      if (isDel && (typeof a.to !== 'string' || !a.to)) throw new Error(`${ctx}：選択肢 ${no} の to が空`);
      if (isDel && it.ok) throw new Error(`${ctx}：選択肢 ${no} は正しい選択肢（ok:true）なので del は置けない`);
      const n = count(it.t, w);
      if (n !== 1) throw new Error(`${ctx}：選択肢 ${no} の本文に「${w}」が ${n} 回（ちょうど1回のはず）`);
      const i = it.t.indexOf(w);
      spans.push([i, i + w.length, w]);
    }
    spans.sort((x, y) => x[0] - y[0]);
    for (let i = 1; i < spans.length; i++) if (spans[i][0] < spans[i - 1][1]) throw new Error(`${ctx}：選択肢 ${no} の「${spans[i - 1][2]}」と「${spans[i][2]}」が重なる`);
    out[no] = arr;
  }
  return out;
}
const shuireVals = shuire => {
  if (!shuire) return { SHUIRE_FN: '', SHUIRE_REF: '', SHUIRE_ON: '', SHUIRE_OFF: '', SHUIRE_CSS: '' };
  const ruby = SHUIRE_STYLE === 'ruby';
  const delHtml = ruby
    ? `'<span class="sh-g" role="group" aria-label="' + esc('誤り「' + a.del + '」。正しくは「' + a.to + '」') + '"><ruby><del>' + esc(a.del) + '</del><rt><ins aria-hidden="true">' + esc(a.to) + '</ins></rt></ruby></span>'`
    : `'<span class="sh-g" role="group" aria-label="' + esc('誤り「' + a.del + '」。正しくは「' + a.to + '」') + '"><del>' + esc(a.del) + '</del><ins aria-hidden="true">' + esc(a.to) + '</ins></span>'`;
  const css = '\n/* 過去問の朱入れ（答えたあと。色は赤シートと同じ --sheet。字は足さず、本文の字は DOM に残す） */\n' +
    '.kk-item .sh-mk{text-decoration:underline;text-decoration-color:var(--sheet);text-decoration-thickness:2px;text-underline-offset:4px}\n' +
    '.kk-item del{text-decoration:line-through;text-decoration-color:var(--sheet);text-decoration-thickness:2px}\n' +
    (ruby
      ? '.kk-item ins{text-decoration:none;color:var(--sheet);font-weight:700}\n.kk-item rt{font-size:11px;line-height:1;color:var(--sheet)}'
      : '.kk-item ins{text-decoration:none;color:var(--sheet);font-weight:700;font-size:12px;margin-left:3px}');
  return {
    SHUIRE_FN: `
  /* 朱入れ（試し用）：答えたあと、選択肢の本文に赤を重ねる（mark＝決め手の語に赤い下線／del＝誤りの語に赤い取り消し線＋正しい言い方を小さい赤字で）。本文の字は変えない */
  function shuireHtml(it) {
    var t = it.t, list = [];
    it.r.forEach(function (a) {
      var w = a.mark || a.del, i = t.indexOf(w);
      if (i >= 0) { list.push({i: i, w: w, a: a}); }
    });
    list.sort(function (x, y) { return x.i - y.i; });
    var out = '', pos = 0;
    list.forEach(function (x) {
      var a = x.a;
      out += esc(t.slice(pos, x.i));
      out += a.mark ? '<span class="sh-mk">' + esc(a.mark) + '</span>' : ${delHtml};
      pos = x.i + x.w.length;
    });
    return out + esc(t.slice(pos));
  }`,
    SHUIRE_REF: `
    var tspans = box.querySelectorAll('.kk-item > span:last-child');
    function shuire(on) {
      Array.prototype.forEach.call(tspans, function (s, i) {
        var it = k.items[i];
        if (it.r) { s.innerHTML = on ? shuireHtml(it) : esc(it.t); }
      });
    }`,
    SHUIRE_ON: ' shuire(true);',
    SHUIRE_OFF: ' shuire(false);',
    SHUIRE_CSS: css,
  };
};

const kakomonJs = (k, shuire) => {
  const items = k.items.map(it => (shuire && shuire[it.m] ? { m: it.m, t: it.t, r: shuire[it.m] } : { m: it.m, t: it.t }));
  const lines = k.items.map(it => ({ m: it.m, t: (it.ok ? '正しい。' : '誤り。') + it.why }));
  const buttons = k.buttons || (k.kosu ? ['1 一つ', '2 二つ', '3 三つ', '4 四つ'] : ['1', '2', '3', '4']);
  const out = { year: k.year, no: k.no, revised: !!k.revised, stem: k.stem, items, buttons, answer: k.answer, lines, onair: k.onair };
  let tail = k.tail;
  if (!tail && k.kosu) {
    const n = k.items.filter(it => it.ok).length;
    tail = `正しいものは ${k.items.filter(it => it.ok).map(it => it.m).join('・')} の${'〇一二三四'[n]}つ。`;
  }
  if (tail) out.tail = tail;
  return out;
};
const quizJs = data => data.quizSets.map(q => ({ label: `${q.label}　「${q.theme}」の3問`, questions: q.questions.map(x => ({ q: x.text, a: !!x.answer, exp: x.exp })) }));

const y2026Section = prev => {
  if (!prev || !prev.length) return '';
  const rows = prev.map(p => {
    const mm = /^【([^】]+)】\s*(.+)$/.exec(p.t);
    const [t, tag] = mm ? [mm[2], '・' + mm[1]] : [p.t, ''];
    return `<li><a class="prow" href="${escAttr(p.url)}" target="_blank" rel="noopener"><span class="pico" aria-hidden="true"></span><span class="pmid"><span class="pt">${T(t)}</span><span class="py">2026年の放送${T(tag)}・Spotifyで聴く</span></span><span class="pgo" aria-hidden="true"></span></a></li>`;
  }).join('');
  return '  <section class="sec" id="y2026">\n    <div class="shead"><h2 class="sh"><span style="white-space:nowrap">去年の放送も聴いて、</span><span style="white-space:nowrap">さらに理解を深める</span></h2><p class="ssub"><span class="nk">2026年に配信した、</span><span class="nk">同じテーマの回です（Spotify）</span></p></div>\n' +
    `    <ul class="past">${rows}</ul>\n  </section>\n`;
};

/* 配信日まで閉じる（第1回＝見本の回は閉じない）。条件は roadmap/index.html と同じ：端末の日付（new Date() の年月日）が配信日以上なら開く。
   試し用は、ふだんは開いたまま。?today=YYYY-MM-DD を付けたときだけ、その日として判定する（roadmap-an2.html と同じ言い方）。本番の型には today の上書きを入れない。 */
function gateVals(ep, iso, dateLabel, test) {
  if (CFG.SAMPLE_EPS.includes(ep)) return { GATE_SCRIPT: '', CLOSED_CSS: '', CLOSED_BOX: '', GUARD: '' };
  const k = Number(iso.replace(/-/g, ''));
  const now = test
    ? 'var m=/[?&]today=(\\d{4})-(\\d\\d)-(\\d\\d)/.exec(location.search),t=m?(+m[1]*10000+(+m[2])*100+(+m[3])):k;'
    : 'var n=new Date(),t=n.getFullYear()*10000+(n.getMonth()+1)*100+n.getDate();';
  return {
    GATE_SCRIPT: '\n<script>(function(){var k=' + k + ';' + now + "if(t<k){document.documentElement.className+=' ep-closed';}})();</script>",
    CLOSED_CSS: '\n/* 配信前（html.ep-closed）：上の札と題と、この囲みだけ出す */\n.closed-box{display:none}\n.ep-closed .closed-box{display:block}\n.ep-closed .top-login{display:none}\n.ep-closed .page > *:not(.top):not(.title):not(.closed-box){display:none !important}\n.next-box.closed-box a.lbtn{display:flex;margin:10px 0 0;padding:8px 18px}',
    CLOSED_BOX: '\n  <div class="next-box closed-box"><p>この回は、' + dateLabel + 'からです。</p><a class="lbtn" href="/roadmap">学習ロードマップへ</a></div>',
    GUARD: " if (document.documentElement.classList.contains('ep-closed')) { return; }",
  };
}

/* 登録なしの見え方に出す「登録済の方はこちら」の入口（上の行の右・図の下の囲み・過去問1選の囲み）。LINE・メール・購入者の見え方では .only-a ごと出ない。配信前で閉じているときも出さない。
   リンク先：本番は /login?next=/ep/N。試し用には /login が無いので、試し用のログインの画面 /account.html（next は付けない）。 */
function loginVals(ep, sample, test) {
  const href = test ? '/account.html' : `/login?next=/ep/${ep}`;
  const a = `<a href="${href}" data-umami-event="ep-login" data-umami-event-ep="${ep}">登録済の方はこちら</a>`;
  return {
    TOP_LOGIN: `<span class="top-login only-a${sample ? ' top-login2' : ''}">無料ページ（${a}）</span>`,
    LOGIN_LINE: `<p class="login-line">${a}</p>`,
    LOGIN_CSS: '\n/* 登録済の方の入口（登録なしの見え方だけ。.only-a） */\n.top-login{margin-left:auto;text-align:right}\n.top-login2{flex:0 0 100%}\n.top-login a,.login-line a{color:var(--ink);text-decoration:underline;text-underline-offset:2px}\n.top-login a{display:inline-block;padding:11px 0;margin:-11px 0}\n.next-box .login-line{margin-top:4px;font-size:14px;line-height:1.7;color:#4F5963}',
  };
}

/* 回のページ一式（index.html・line-full.html・line-full.js）。mode は 'prod'（本番）か 'test'（試し用） */
export function buildPages(m, text, ex, mode) {
  const { ep, json, data } = m;
  const test = mode === 'test';
  const sec = data.sections;
  if (sec.length !== 2) throw new Error(`第${ep}回：data.json の sections は2つのはず`);
  const half = i => `${sec[i].label}　${sec[i].theme}`;
  const date = fmtDate(json.date);
  const episodeUrl = CFG.SPOTIFY_EPISODE[ep];
  const listen = episodeUrl
    ? `<a class="listen" href="${escAttr(episodeUrl)}" target="_blank" rel="noopener" data-umami-event="ep-spotify" data-umami-event-ep="${ep}">この回を聴く（Spotify）</a>`
    : `<a class="listen" href="${CFG.SPOTIFY_SHOW}" target="_blank" rel="noopener" data-umami-event="ep-spotify-show" data-umami-event-ep="${ep}">音声番組を聴く（Spotify）</a>`;
  const haishin = episodeUrl ? '' : `<p class="pnote haishin"><span class="nk">この回の配信は</span> <span class="nk">${date}から（予定）。</span><span class="nk">いまは番組のページが開きます。</span></p>`;
  const sample = CFG.SAMPLE_EPS.includes(ep);
  const abs = p => (test ? CFG.SITE + p : p);
  const fig1Template = '<template id="nk-fig1"><style data-nk="css">' + ex.css + '</style>' + ex.fig1 + '</template>';
  const index = fill(template('ep-index.html'), {
    EP: String(ep), SUB: escText(json.sub),
    UMAMI: test ? '' : `<!-- Umami analytics (page: ep${ep}${sample ? ' 見本' : ''}) -->\n` + CFG.UMAMI_SCRIPT,
    DATE: date, DATE_YMD: fmtYmd(json.date),
    SMP: sample ? '<span class="smp">2027年版の見本</span>' : '',
    TITLE_HTML: titleHtml(data.title), LISTEN: listen, HAISHIN: haishin,
    HALF1_H: T(half(0)), TARGET1: targetDiv(ep, 1, sec[0].scope),
    FIG1_TEMPLATE: fig1Template, QUIZ_JSON: jsJson(quizJs(data)),
    TEXT_SAMPLE_URL: abs(CFG.TEXT_SAMPLE_PATH), TEXT_SAMPLE_IMG: abs(CFG.TEXT_SAMPLE_IMG), ART: abs(CFG.ART_PATH),
    Y2026: y2026Section(data.prev2026),
    LIFF_ID: CFG.LIFF_ID[mode],
    SHUIRE_CSS: shuireVals(shuireFor(ep, json.kakomon)).SHUIRE_CSS,
    MIHON_EXPR: test ? "qs.get('mihon')" : "isLocal ? qs.get('mihon') : null",
    MIHON_EXPORT: test ? ' window.__epMihon = mihon;' : '',
    NO_WHO: test ? "!who && mihon !== 'kounyu'" : '!who',
    ...gateVals(ep, json.date, date, test),
    ...loginVals(ep, sample, test),
    MIHON_QS: test ? " + (mihon === 'kounyu' ? '&mihon=1' : '')" : '',
  });
  const corePoint = h => json.points.find(p => p.half === h);
  const c1 = corePoint(1), c2 = corePoint(2);
  const lineFullHtml = fill(template('ep-line-full.html'), {
    EP: String(ep),
    CORE1: c1 ? pointCore(c1.text) + '\n' : '',
    HALF2_H: T(half(1)),
    CORE2: c2 ? '  ' + pointCore(c2.text) + '\n' : '',
    TARGET2: sec[1].scope ? '  ' + targetDiv(ep, 2, sec[1].scope) + '\n' : '',
  });
  /* 朱入れ（データのある回だけ。本番・試し用とも同じ） */
  const shuire = shuireFor(ep, json.kakomon);
  const lineFullJs = fill(template('ep-line-full.js'), { EP: String(ep), KK_JSON: jsJson(kakomonJs(json.kakomon, shuire)), ...(({ SHUIRE_CSS, ...js }) => js)(shuireVals(shuire)) });
  return { index, lineFullHtml, lineFullJs, points: { c1, c2 } };
}

/* ============================================================ 公開側に有料の中身が出ていないか */
/* 有料の節の印：赤シート・芯の囲み（.key）・寄り道の囲み（.aside）・今回の数字の節。札の字（「芯」「ワンポイント」など）でなく class で見る（札の字は材料が変える） */
export const PAID_MARKUP = /class="[^"]*\b(?:rs|key|aside|numh|nl|nr|nv)\b[^"]*"|role="button"|data-hint|data-part=/;
export function checkPublic(m, text, ex, pages) {
  const { ep } = m;
  const ctx = `第${ep}回`;
  const bad = PAID_MARKUP;
  for (const [name, h] of [['index.html', pages.index], ['line-full.html', pages.lineFullHtml], ['tsuzuki.html', ex.html]]) {
    if (bad.test(h)) throw new Error(`${ctx}：公開側の ${name} に赤シートの印・今回の数字の節が入っている`);
  }
  /* テキストだけ（paid）の図の字が、公開側（無料の図・今日のポイント・ページの字）に出ていないこと。無料・登録者の図や芯にも同じ文があるものは除く */
  const strip = h => h.replace(/<(script|style)\b[\s\S]*?<\/\1>/g, '').replace(/<template\b[\s\S]*?<\/template>/g, t => t);
  const publicPlain = plain(strip(pages.index) + strip(pages.lineFullHtml) + strip(ex.html));
  const openPlain = plain(Object.keys(ex.tier).filter(n => ex.tier[n] !== 'paid').map(n => ex.orig[n]).join('')) + plain(m.json.points.map(p => p.text).join('')) + plain([m.json.title, m.json.sub, ...m.data.sections.flatMap(x => [x.theme, x.scope || ''])].join(''));
  let checked = 0;
  for (const n of Object.keys(ex.tier).filter(n => ex.tier[n] === 'paid')) {
    const capT = capTitle(ex.orig[n]);
    for (const t of ex.orig[n].split(/<[^>]+>/).map(x => x.trim()).filter(x => Array.from(x).length >= 8 && x !== capT)) {
      const p = plain(t);
      if (openPlain.includes(p)) continue;
      checked++;
      if (publicPlain.includes(p)) throw new Error(`${ctx}：テキストだけの図${n}の字が公開側に出ている：${t}`);
    }
  }
  /* 第1回は、もともとの検査の語も */
  if (ep === 1) for (const w of ['転貸', '又貸し', '適用されない', '事務所に数える', '継続して業務ができる施設', '取消しの理由', '聴聞の公示', '駆け込み廃業も取消し']) {
    if (ex.html.includes(w)) throw new Error('本番用の抜粋に有料の語が入っている: ' + w);
  }
  return checked;
}

/* ============================================================ 第1回だけ：見本ページ（ep/1/text/index.html）と、購入者の見え方の共通の部品 */
export function buildShared() {
  const read = rel => readText(path.join(TEST_ROOT, rel));
  const must = (mm, what) => { if (!mm) throw new Error('見本ページ：' + what + ' が見つからない'); return mm; };
  const dan = read('ep1-3dan.html');
  const sheetJs = must(dan.match(/  function esc\(s\)[\s\S]*?(?=\n  function showBuyer\(html\))/), 'ep1-3dan.html の setupSheet')[0];
  const sheetCss = must(dan.match(/\.sbar2\{[\s\S]*?\.sb2:focus-visible\{[^}]*\}/), 'ep1-3dan.html の赤シートの帯のCSS')[0];
  const jumpCss = must(dan.match(/\.jump\{[^}]*\}\n\.jb\{[^}]*\}\n\.jb:active\{[^}]*\}/), 'ep1-3dan.html の上の近道のCSS')[0];
  const pdfCss = must(dan.match(/\.pdfrow\{[^}]*\}\n\.pdfbtn\{[^}]*\}/), 'ep1-3dan.html のPDFボタンのCSS')[0];
  const jumpBlock = jumpCss + `
.jb:focus-visible{outline:2px solid var(--sky);outline-offset:2px}
@media (min-width:820px){.jump{margin-left:-32px;margin-right:-32px;padding:4px 32px}}`;
  /* 購入者の見え方（本番の ep/N/index.html が、/api/ep-text で 200 が返った人にだけ読み込む共通の部品）。回の番号は住所（/ep/N）から読む */
  let viewJs = must(dan.match(/  function esc\(s\)[\s\S]*?(?=\n  function getText\(preview\))/), 'ep1-3dan.html の購入者の見え方（showBuyer まで）')[0];
  const buyerBaseCss = must(dan.match(/\.is-buyer \.tcard[^\n]*\n\.thost\{[^\n]*\n\.textwrap\{[^\n]*\n\.is-buyer #text1[^\n]*\n/), 'ep1-3dan.html の購入者の見え方のCSS')[0];
  viewJs = once(viewJs, "var pdfUrl = '/api/ep-pdf?ep=1' + (mihon === 'kounyu' ? '&mihon=1' : '');", "var pdfUrl = '/api/ep-pdf?ep=' + epNo + (mihon === 'kounyu' ? '&mihon=1' : '');");
  viewJs = once(viewJs, 'data-umami-event="ep-pdf" data-umami-event-ep="1">', "data-umami-event=\"ep-pdf\" data-umami-event-ep=\"' + epNo + '\">");
  /* 今回の数字が0組の回は、節を出さない */
  viewJs = once(viewJs, 'if (!style || !t1 || !t2 || !t3) {', 'if (!style || !t1 || !t2) {');
  viewJs = once(viewJs, 'h3 = host(t3);', 'h3 = t3 ? host(t3) : null;');
  viewJs = once(viewJs, 'sec3.appendChild(h3.el);', 'if (h3) { sec3.appendChild(h3.el); }');
  viewJs = once(viewJs, 'zukai.parentNode.insertBefore(sec3, honban);', 'if (h3) { zukai.parentNode.insertBefore(sec3, honban); }');
  viewJs = once(viewJs, 'setupSheet([h1.root, h2.root, h3.root], bar, {hint: hint, end: sheetEnd})', 'setupSheet(h3 ? [h1.root, h2.root, h3.root] : [h1.root, h2.root], bar, {hint: hint, end: sheetEnd})');
  const viewJsOut = `/* 自動生成：liff-test/scripts/build-ep1-text.mjs（正本は liff-test/ep1-3dan.html）。直さない。
   やさしいテキスト購入者の見え方の動き（赤シート・テキストの差し込み・近道）。ep/1/index.html が、購入の確認（テキストのAPI）で 200 が返った人にだけ読み込む。
   有料の中身は入れない（テキストの HTML は引数で受け取る）。 */
(function () {
  'use strict';
  var body = document.body;
  var mihon = window.__epMihon || null; /* 試し用だけ、?mihon=kounyu のとき ep/N/index.html が入れる（PDF も見本の入口になる）。本番では常に null */
  var epNo = (/\\/ep\\/(\\d+)(?:\\/|$)/.exec(location.pathname) || [0, '1'])[1]; /* 回の番号は住所（/ep/N）から読む。build-ep.mjs が作る */
  var buyerShown = false;
  function setTier() {}
${viewJs}
  window.TakkenTextView = { show: showBuyer };
})();
`;
  const viewCssOut = `/* 自動生成：liff-test/scripts/build-ep1-text.mjs（正本は liff-test/ep1-3dan.html と、見本ページと同じ部品）。直さない。
   やさしいテキスト購入者の見え方のCSS（上の近道・赤シートの帯・印刷用ボタン）。有料の中身は入れない。 */
:root{--navh:48px}
${jumpBlock}
${buyerBaseCss}${sheetCss}
.is-buyer .only-a,.is-buyer .line-card{display:none !important}
`;
  if (/class="[^"]*\brs\b|role="button"|今回の数字|_ep-text|api\/ep-text/.test(viewJsOut + viewCssOut) || /class="[^"]*\b(?:key|aside)\b/.test(viewJsOut + viewCssOut)) throw new Error('共通の部品に有料の中身が入っている');
  return { viewJsOut, viewCssOut, sheetJs, sheetCss, jumpBlock, pdfCss, dan };
}

export function buildSample(m, text, pages, shared) {
  const { json } = m;
  const { sheetJs, sheetCss, jumpBlock, pdfCss } = shared;
  const read = rel => readText(path.join(TEST_ROOT, rel));
  const must = (mm, what) => { if (!mm) throw new Error('見本ページ：' + what + ' が見つからない'); return mm; };
  const { p1, p2, p3 } = text;
  /* 今日のポイントは、各半分の「芯」と同じ文であること（タグを除いた文字列で照合） */
  const keyText = h => must(h.match(/<div class="key">[\s\S]*?<span class="t">([\s\S]*?)<\/span><\/div>/), '芯')[1];
  const cores = [pages.points.c1, pages.points.c2].map(p => pointCore(p.text));
  [p1, p2].forEach((p, i) => { if (plain(keyText(p)) !== plain(cores[i].replace(/<h2>[^<]*<\/h2>/, ''))) throw new Error('見本ページ：今日のポイントが芯と違う ' + (i + 1)); });
  const road = read('../roadmap/index.html');
  const tiers = must(road.match(/<section class="tiers"[\s\S]*?<\/section>/), 'roadmap の表')[0].replace(/\s*<p class="tt-note">[\s\S]*?<\/p>/, '');
  if ((tiers.match(/<tbody>[\s\S]*<\/tbody>/)[0].match(/<tr>/g) || []).length !== 8) throw new Error('見本ページ：表の行は8つのはず');
  /* ○×3問・過去問1選：本番（ep/1/index.html・ep/1/line-full.js）のデータと動きとCSSをそのまま取り込む（手で二重に持たない） */
  const idxHtml = pages.index, lineFullJs = pages.lineFullJs.replace(/\r\n?/g, '\n').trim();
  const quizScript = must(idxHtml.match(/<script>\n(\(function \(\) \{\n  'use strict';\n  \/\* 3問のデータ[\s\S]*?\n\}\)\(\);)\n<\/script>/), 'ep/1/index.html の3問のスクリプト')[1];
  if (!/getElementById\('kkBox'\)/.test(lineFullJs) || /class="dm"/.test(lineFullJs)) throw new Error('見本ページ：line-full.js の形が想定と違う');
  const idxCss = must(idxHtml.match(/<style>([\s\S]*?)<\/style>/), 'ep/1/index.html のCSS')[1];
  const quizKeep = /^(\.over|\.qset|\.qcard|\.qhead|\.qno|\.qtext|\.qbtns|\.pill|\.qres|\.score|\.kk|\.line-inv|\.lbtn|a\.lbtn|\.nk\{)/;
  const quizCss = '.qres .zk,.kk-src,.line-inv p.lnote{font-size:14px;line-height:1.65}\n' + idxCss.replace(/\r\n?/g, '\n').split('\n').filter(l => quizKeep.test(l) && !/\.dm\b/.test(l)).join('\n');
  if ((quizCss.match(/\{/g) || []).length !== (quizCss.match(/\}/g) || []).length) throw new Error('見本ページ：取り込んだCSSの括弧が合わない');
  const pageCss = `
:root{--sky:#17C5E8;--ink:#0A6477;--soft:#E3F8FC;--bg:#F4FAFC;--text:#141B21;--sub:#6B6B76;--line:#DCEEF3;--sheet:#8E3B3B;--lime:#D6F034;--lime-soft:#F4FBD2;--lime-dark:#4F6300;--font:"Noto Sans JP","Hiragino Sans","Yu Gothic",sans-serif;--shadow:0 2px 8px rgba(20,27,33,.05);--navh:48px}
*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%}
html,body{background:var(--bg)}
body{font-family:var(--font);word-break:auto-phrase;overflow-wrap:anywhere;color:var(--text);line-height:1.5;font-size:16px;overflow-x:hidden}
[hidden]{display:none !important}
.page{max-width:430px;margin:0 auto;background:var(--bg);padding:14px 16px 24px}
.page>*+*{margin-top:14px}
.nb{display:inline-block}
a{color:var(--ink);text-underline-offset:2px}
/* 上：札・題・説明 */
.smp-head{text-align:center;padding-top:6px}
.smp-tag{display:inline-block;font-size:13px;font-weight:700;color:var(--ink);background:var(--soft);border:1px solid var(--sky);border-radius:999px;padding:1px 14px;line-height:1.6}
.smp-h{font-size:22px;font-weight:900;line-height:1.4;margin-top:8px;color:var(--text)}
.smp-lead{font-size:15px;line-height:1.8;margin-top:8px;text-align:left}
.smp-prep{font-size:13px;line-height:1.7;color:#4F5963;margin-top:6px;text-align:left}
/* 違いの表（roadmap/index.html と同じ） */
.tiers{--card:#fff;--line:#D9E0E6;--muted:#56636E;--cyan-dark:#0EA2C2;--text:#2B3A46;background:var(--card);border:1px solid var(--line);border-radius:12px;box-shadow:0 2px 8px rgba(43,58,70,.08);padding:12px 16px 6px;color:var(--text);line-height:1.75}
.tiers h2{font-size:1rem;font-weight:700;margin-bottom:4px;line-height:1.5}
.tt{width:100%;border-collapse:collapse;table-layout:fixed;margin-top:6px}
.tt th,.tt td{border-top:1px solid var(--line);padding:9px 4px;text-align:center;vertical-align:middle;font-size:.9375rem;line-height:1.45}
.tt thead th{border-top:0;font-weight:700;font-size:.875rem;vertical-align:bottom}
.tt thead th small{display:block;font-size:.875rem;font-weight:500;color:var(--muted)}
.tt thead th:first-child{width:31%}
.tt tbody th{text-align:left;font-weight:700;padding-left:0}
.tt td.y{color:var(--cyan-dark);font-weight:900;font-size:1.15rem}
.tt td.n{color:#8A949C}
/* 読む画面（購入者の画面と同じ部品） */
.reader{display:flex;flex-direction:column;gap:12px}
.thost{display:block}
.textwrap{display:flex;flex-direction:column;gap:12px}
.sec{display:flex;flex-direction:column;gap:12px;padding-top:6px}
.core{position:relative;overflow:hidden;background:#fff;border-radius:12px;box-shadow:var(--shadow);padding:10px 14px 12px 20px}
.core::before{content:"";position:absolute;left:0;top:0;bottom:0;width:6px;background:var(--sky)}
.core h2{font-size:14px;font-weight:900;color:var(--ink);line-height:1.3;letter-spacing:.04em}
.core p{font-size:17px;font-weight:700;margin-top:3px;line-height:1.7}
${jumpBlock}
${sheetCss}
${pdfCss}
.sec-h{font-size:24px;font-weight:900;color:var(--ink);line-height:1.3;display:flex;align-items:center;gap:10px}
.sec-h::before{content:"";width:6px;height:24px;border-radius:3px;background:var(--sky)}
@media (max-width:600px){.sec-h{font-size:22px}}
/* 上に貼りつく近道（48px）と赤シートの帯（44px）の下に、節の頭が来る位置 */
#text1,#text2,#point,#numbers,#honban,.qset{scroll-margin-top:calc(var(--navh) + 52px)}
${quizCss}
.pdfthumb{display:block;width:120px;margin:10px auto 0;border:1px solid #ececec;border-radius:8px;overflow:hidden;background:#fff;line-height:0}
.pdfthumb img{display:block;width:100%;height:auto}
.links{display:flex;flex-direction:column;gap:8px;align-items:center}
.links a{display:flex;align-items:center;justify-content:center;width:100%;max-width:360px;min-height:44px;padding:9px 18px;font-size:15px;font-weight:700;line-height:1.4;color:var(--ink);background:#fff;border:1.5px solid var(--sky);border-radius:999px;text-decoration:none;text-align:center}
.about-t{font-size:13px;line-height:1.7;color:#4E5B66;text-align:left}
.foot{font-size:13px;line-height:1.4;color:#4F5963}
/* LINE・メールの枠（roadmap/index.html の .line-cta と同じ） */
.line-cta{--cyan-dark:#0EA2C2;--muted:#56636E;background:#fff;border:1px solid var(--sky);border-radius:12px;box-shadow:0 2px 8px rgba(43,58,70,.08);padding:14px;text-align:center;color:#2B3A46;line-height:1.75;margin-top:20px}
.line-cta .over{font-size:12px;font-weight:700;letter-spacing:.15em;color:var(--cyan-dark)}
.line-cta .head{font-size:16px;line-height:1.5;font-weight:800;margin-top:4px}
.line-cta .body{font-size:14px;line-height:1.5;color:var(--muted);margin:4px 0 10px}
.line-cta .btns{display:grid;grid-template-columns:1fr 1fr;gap:10px;max-width:420px;margin:0 auto}
.line-cta .btn{display:flex;align-items:center;justify-content:center;font-weight:700;text-decoration:none;color:#fff;background:var(--cyan-dark);border-radius:999px;min-height:44px;padding:8px 8px;font-size:14px}
@media (min-width:768px){
  .line-cta{padding:20px 18px}
  .line-cta .over{font-size:.85rem}
  .line-cta .head{font-size:1.08rem}
  .line-cta .body{font-size:1rem;margin:4px 0 14px}
  .line-cta .btn{min-height:48px;padding:11px 8px;font-size:1rem}
}
/* PCで開いたとき：同じページを1列のまま広げ、字を一回り大きく（購入者の画面と同じ考え方） */
@media (min-width:820px){
  html,body{background:#E6F0F3}
  body{font-size:17px}
  .page{max-width:680px;margin:28px auto 40px;padding:22px 32px 32px;border-radius:20px;box-shadow:0 2px 18px rgba(20,27,33,.06)}
  .smp-h{font-size:26px}
  .core p{font-size:19px}
  .qtext,.kk-stem{font-size:17px}
  .kk-item{font-size:16px}
  .sec-h{font-size:26px}
}
@media (max-width:520px){html{scrollbar-width:none}html::-webkit-scrollbar{display:none}}
`;
  const sampleScript = `
${quizScript}
${lineFullJs}
(function () {
  'use strict';
  /* 赤シート：購入者の画面（ep1-3dan.html）と同じ関数。build-ep1-text.mjs が切り出して入れる */
${sheetJs}
  var cssT = document.getElementById('tpl-css');
  var inQ = document.getElementById('quizBox');
  var q1 = document.getElementById('q1'), q2 = document.getElementById('q2');
  /* 3問は前半・後半のテキストの直後へ。解き終えたあとの案内は、購入者の画面と同じく次のテキスト・今日のポイントへ */
  document.getElementById('text1').appendChild(q1);
  document.getElementById('text2').appendChild(q2);
  var a1 = q1.querySelector('.line-inv a'), a2 = q2.querySelector('.line-inv a');
  if (a1) { a1.setAttribute('href', '#text2'); a1.textContent = '後半のテキストへ'; }
  if (a2) { a2.setAttribute('href', '#point'); a2.textContent = '今日のポイントへ'; }
  /* 「図解で確かめる」は、その組のテキストへ */
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href="#zukai"]') : null;
    if (!a) { return; }
    e.preventDefault();
    var t = document.getElementById(a.closest('#q2') ? 'text2' : 'text1');
    if (t) { t.scrollIntoView({block: 'start'}); }
  });
  /* 3問済は takken2027-done に残し、ログインしている人はサーバーにも置く（本番の ep/1/index.html と同じつなぎ方・cookieHint:true） */
  if (window.__epProgressStart) { window.__epProgressStart(); }
  var roots = [];
  Array.prototype.forEach.call(document.querySelectorAll('.thost[data-tpl]'), function (h) {
    var root = h.attachShadow({mode: 'open'});
    root.appendChild(cssT.content.cloneNode(true));
    root.appendChild(document.getElementById(h.getAttribute('data-tpl')).content.cloneNode(true));
    roots.push(root);
  });
  /* 赤シートが自動でかかる目印：「今回の数字」の節の終わり（過去問1選の手前）。高さ0・上のすき間を打ち消して並びは変えない */
  var sheetEnd = document.createElement('div');
  sheetEnd.setAttribute('aria-hidden', 'true');
  sheetEnd.style.cssText = 'height:0;margin-top:-12px;pointer-events:none';
  document.getElementById('numbers').appendChild(sheetEnd);
  try { setupSheet(roots, document.getElementById('sbar'), {hint: document.querySelector('.shint'), end: sheetEnd}); } catch (e) { console.warn(e); }
  /* LINE・メールの枠：配信前（2027-01-04より前）の文言（roadmap/index.html と同じ） */
  var d = new Date(), t = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  if (t < 20270104) {
    document.getElementById('lineHead').innerHTML = '<span class="nb">始まったら、</span><span class="nb">LINEかメールでお知らせします</span>';
    document.getElementById('lineBody').innerHTML = '<span class="nb">図解の続きと過去問1選を、</span><span class="nb">毎週月曜にお届けします（予定）。</span><br><span class="nb">登録無料です。</span>';
  }
})();
`;
  const tpl = (id, inner) => '<template id="' + id + '">' + inner + '</template>';
  const styleOnly = text.html.match(/^<style>[\s\S]*?<\/style>/)[0];
  const samplePage = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>やさしいテキスト 第1回（見本）｜耳で覚える宅建2027</title>
<!-- Umami analytics (page: ep1 やさしいテキスト見本) -->
${CFG.UMAMI_SCRIPT.trimEnd()}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700;900&display=swap" rel="stylesheet">
<style>${pageCss}</style>
</head>
<body>
<!-- このページは liff-test/scripts/build-ep1-text.mjs が作る。手で直さない。購入者の画面と同じ中身を、見本としてそのまま載せている（有料の中身を公開側に出してよいのは ep/1/text/ だけ）。 -->
<div class="page">
  <header class="smp-head">
    <span class="smp-tag">有料版の見本</span>
    <h1 class="smp-h">やさしいテキスト　第1回　<span class="nb">宅建業と免許</span></h1>
    <p class="smp-lead">これを見ながら放送を聴くと、より理解が深まるように作っています。無料の図解は、このテキストからの抜粋です。</p>
    <p class="smp-prep">このテキストは準備中です。第1回を、見本として公開しています。</p>
  </header>

  ${tiers}

  <div class="reader" id="reader">
    <nav class="jump" id="jump" aria-label="このページの節"><a class="jb" href="#text1">前半</a><a class="jb" href="#text2">後半</a><a class="jb" href="#honban">過去問1選</a></nav>
    <div class="sbar2" id="sbar"><span class="sb2-lab">赤シート</span><span class="seg"><button type="button" class="sb2" data-r="on" aria-pressed="true" aria-label="赤シートをかける（全部の語をかくす）">かける</button><button type="button" class="sb2" data-r="off" aria-pressed="false" aria-label="赤シートをはずす（全部の語を見せる）">はずす</button></span><span class="sb2-cnt" data-r="hid"></span></div>
    <p class="shint"><span class="nb">赤い所を押すと答えが出ます。</span><span class="nb">もう一度押すと、またかくれます。</span></p>
    <div class="textwrap">
      <section class="sec" id="text1"><div class="thost" data-tpl="tpl-1"></div></section>
      <section class="sec" id="text2"><div class="thost" data-tpl="tpl-2"></div></section>
      <section class="sec" id="point">
        ${cores.join('\n        ')}
      </section>
      <section class="sec" id="numbers"><div class="thost" data-tpl="tpl-3"></div></section>
      <section class="sec" id="honban">
        <div class="over kk-over">チャレンジ！</div>
        <h2 class="sec-h">過去問1選</h2>
        <div id="kkBox"></div>
      </section>
    </div>
    <div id="quizBox" hidden></div>
    <div class="pdfrow">
      <a class="pdfbtn" href="/ep/1/text/yasashii-text-01-a4.pdf" target="_blank" rel="noopener" data-umami-event="text-a4-pdf" data-umami-event-ep="1">印刷用のA4版（PDF）を開く</a>
      <a class="pdfthumb" href="/ep/1/text/yasashii-text-01-a4.pdf" target="_blank" rel="noopener" data-umami-event="text-a4-pdf" data-umami-event-ep="1" tabindex="-1" aria-hidden="true"><img src="/ep/1/text/a4-p1.webp" width="800" height="1133" loading="lazy" alt=""></a>
    </div>
    <p class="about-t">このテキストは、宅建の全体をつかむための入り口です。概要をつかんだら、試験対策として、例外や細かい知識を過去問やお手持ちの参考書でご確認ください。</p>
  </div>

  <nav class="links" aria-label="ほかのページ">
    <a href="/roadmap" data-umami-event="text-back" data-umami-event-to="roadmap">学習ロードマップ（兼 進捗トラッカー）へ</a>
  </nav>

  <section class="line-cta">
    <div class="over">LINE・メール</div>
    <p class="head" id="lineHead"><span class="nb">図解の続きと過去問1選は、</span><span class="nb">LINEかメールで</span></p>
    <p class="body" id="lineBody"><span class="nb">毎週月曜に、こちらからお届けします。</span><br><span class="nb">登録無料です。</span></p>
    <div class="btns"><a class="btn" href="https://lin.ee/r6uYtnE" target="_blank" rel="noopener" data-umami-event="text-line" data-umami-event-ep="1">LINEで受け取る</a><a class="btn" href="https://mimiobo.substack.com/subscribe" target="_blank" rel="noopener" data-umami-event="text-mail" data-umami-event-ep="1">メールで受け取る</a></div>
  </section>

  <div class="foot">条文は2026年4月1日施行版で照合</div>
</div>
${tpl('tpl-css', styleOnly)}
${tpl('tpl-1', '<div class="tx" data-part="1">' + p1 + '</div>')}
${tpl('tpl-2', '<div class="tx" data-part="2">' + p2 + '</div>')}
${tpl('tpl-3', '<div class="tx" data-part="3">' + p3 + '</div>')}
<script>${sampleScript}</script>
</body>
</html>
`;
  const rsTotal = text.rs.reduce((a, b) => a + b, 0);
  const sampleRs = (samplePage.match(/class="[^"]*\brs\b/g) || []).length;
  if (sampleRs !== rsTotal) throw new Error(`見本ページ：赤シートが${rsTotal}か所でない ${sampleRs}`);
  if (/△/.test(samplePage)) throw new Error('見本ページに△がある');
  return { samplePage, sampleRs };
}

/* ============================================================ 出し先の決まり */
export const releaseFile = () => path.join(TEST_ROOT, 'ep-release.json');
export function readRelease() {
  const r = JSON.parse(readText(releaseFile()));
  if (!Array.isArray(r.prod) || r.prod.some(n => !Number.isInteger(n) || n < 1)) throw new Error('ep-release.json の prod は回の番号の配列のはず');
  return r;
}
const ensureIgnored = rel => {
  try { execFileSync('git', ['check-ignore', '-q', rel], { cwd: PROD_ROOT, stdio: 'ignore' }); }
  catch { throw new Error('有料の中身の置き場が .gitignore に入っていない: ' + rel); }
};

/* 1回ぶんを全部組む（書かない）。{ files: [{rel（リポジトリ直下からの道）, data, secret?}], report } */
/* shisaku＝試し用だけ（本番の分は作らない）。 */
export function buildEp(ep, release, shared, opts = {}) {
  const m = loadMaterial(ep);
  validateMaterial(m);
  const text = buildText(m);
  const ex = buildExcerpt(m, text);
  const files = [];
  const inProd = release.prod.includes(ep);
  const pdf = fs.readFileSync(m.pdfPath);
  /* open＝配信日（日本時間のその日の 0:00 から API が返す）。第1回（見本の回）は open を入れない＝閉じない */
  const meta = JSON.stringify(CFG.SAMPLE_EPS.includes(ep) ? { name: `やさしいテキスト_第${ep}回_${m.json.sub}.pdf` } : { name: `やさしいテキスト_第${ep}回_${m.json.sub}.pdf`, open: m.json.date }) + '\n';
  const modes = inProd && !opts.shisaku ? ['test', 'prod'] : ['test'];
  let checked = 0;
  const byMode = {};
  for (const mode of modes) {
    const pages = buildPages(m, text, ex, mode);
    byMode[mode] = pages;
    checked += checkPublic(m, text, ex, pages);
    const base = mode === 'prod' ? '' : 'liff-test/';
    files.push(
      { rel: `${base}ep/${ep}/index.html`, data: pages.index },
      { rel: `${base}ep/${ep}/line-full.html`, data: pages.lineFullHtml },
      { rel: `${base}ep/${ep}/line-full.js`, data: pages.lineFullJs },
      { rel: `${base}ep/${ep}/tsuzuki.html`, data: ex.html },
      { rel: `${base}api/_ep-text/ep${ep}.js`, data: text.jsModule, secret: true },
      { rel: `${base}api/_ep-text/ep${ep}.pdf`, data: pdf, secret: true },
      { rel: `${base}api/_ep-text/ep${ep}.meta.json`, data: meta, secret: true },
    );
  }
  if (ep === 1) {
    if (inProd && !opts.shisaku) files.push({ rel: 'ep/1/text/index.html', data: buildSample(m, text, byMode.prod, shared).samplePage });
  }
  const report = {
    ep, sub: m.json.sub, prod: inProd,
    figs: ex.counts, figTotal: m.json.figures.length, rs: text.rs, rsTotal: text.rs.reduce((a, b) => a + b, 0),
    numbers: m.json.numbers.length, points: m.json.points.length, leakChecked: checked,
    pdfNote: m.json.files.pdf,
  };
  return { files, report, m, text, ex };
}

export function sharedFiles(shared, opts = {}) {
  return [
    { rel: 'ep/_shared/text-view.js', data: shared.viewJsOut, prodOnly: true },
    { rel: 'ep/_shared/text-view.css', data: shared.viewCssOut, prodOnly: true },
    { rel: 'liff-test/ep/_shared/text-view.js', data: shared.viewJsOut },
    { rel: 'liff-test/ep/_shared/text-view.css', data: shared.viewCssOut },
  ].filter(f => !(opts.shisaku && f.prodOnly));
}

export function parseEps(arg) {
  const all = fs.readdirSync(MATERIAL).map(n => /^第(\d\d)回_流し込み材料\.json$/.exec(n)).filter(Boolean).map(x => Number(x[1])).sort((a, b) => a - b);
  if (arg === 'all') return all;
  const out = new Set();
  for (const part of String(arg).split(',')) {
    const r = /^(\d+)-(\d+)$/.exec(part);
    if (r) for (let n = Number(r[1]); n <= Number(r[2]); n++) out.add(n);
    else if (/^\d+$/.test(part)) out.add(Number(part));
    else throw new Error('回の指定が読めない: ' + part);
  }
  const eps = [...out].sort((a, b) => a - b);
  for (const n of eps) if (!all.includes(n)) throw new Error(`第${n}回の流し込み材料 json が無い`);
  return eps;
}

export function main(argv) {
  const shisaku = argv.includes('--shisaku');
  const arg = argv.find(a => !a.startsWith('--'));
  if (!arg) { console.error('使い方: node scripts/build-ep.mjs <回の番号 | 1-9 | 2,3 | all> [--shisaku（試し用だけに書く）]'); process.exit(2); }
  const eps = parseEps(arg);
  const release = readRelease();
  for (const n of release.prod) if (!fs.existsSync(path.join(MATERIAL, `第${String(n).padStart(2, '0')}回_流し込み材料.json`))) throw new Error(`ep-release.json の prod に、材料の無い回 ${n} がある`);
  ensureIgnored('api/_ep-text/ep1.js');
  ensureIgnored('liff-test/api/_ep-text/ep1.js');
  const shared = buildShared();
  const reports = [];
  const writes = new Map();
  for (const ep of eps) {
    const r = buildEp(ep, release, shared, { shisaku });
    reports.push(r.report);
    for (const f of r.files) writes.set(f.rel, f);
  }
  /* 共通の部品：第1回の本番、または試し用に回を出すとき */
  for (const f of sharedFiles(shared, { shisaku })) writes.set(f.rel, f);
  const prodDirs = new Set(release.prod.map(n => `ep/${n}/`));
  for (const [rel, f] of writes) {
    /* 本番（リポジトリ直下）へ書くのは、prod に入っている回だけ */
    if (shisaku && !rel.startsWith('liff-test/')) throw new Error('--shisaku なのに本番へ書こうとした: ' + rel);
    if (!rel.startsWith('liff-test/')) {
      const mm = /^(?:ep|api\/_ep-text)\/(?:ep)?(\d+)[/.]/.exec(rel);
      if (mm && !release.prod.includes(Number(mm[1]))) throw new Error('prod に入っていない回を本番へ書こうとした: ' + rel);
    }
    const abs = path.join(PROD_ROOT, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, f.data);
  }
  /* 本番の api/_ep-text に、材料の名前の控えを書き直す（prod の回だけ。ep-pdf.js がダウンロード名に使う）は、ファイル単位ですでに書いた */
  console.log(`written ${writes.size} files; prod=[${release.prod}]`);
  console.log('ep  sub                       図(無料/続き/テキストだけ)  赤シート(前/後/数字)  今回の数字  本番');
  for (const r of reports) {
    console.log(`${String(r.ep).padStart(2)}  ${r.sub.padEnd(16, '　')}  ${r.figs.free}/${r.figs.line}/${r.figs.paid} (計${r.figTotal})  ${r.rs.join('/')} (計${r.rsTotal})  ${r.numbers}組  ${r.prod && !shisaku ? '本番に書いた' : '試し用だけ'}`);
  }
  return reports;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
