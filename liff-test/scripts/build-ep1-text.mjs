// やさしいテキスト第1回（A4縦2ページの印刷用HTML）から、スマホで読む1列版を作る。
// 出力：api/_ep-text/ep1.js（HTMLの文字列をexport。api/ の _ 始まりは公開されず、URLでは取れない）。
// 使い方：node scripts/build-ep1-text.mjs
// 元の文言は変えない：タグを除いた文字列が元と一致しなければ失敗する。赤シートの対象は class="rs" を付けるだけ。
import fs from 'node:fs';
const SRC = new URL('../../../6_有料PDF/やさしいテキスト_2027/第01回_宅建業と免許.html', import.meta.url);
const OUT = new URL('../api/_ep-text/ep1.js', import.meta.url);
const src = fs.readFileSync(SRC, 'utf8');

/* --- 部品を取り出す --- */
const symbols = {};
for (const m of src.matchAll(/<symbol id="([^"]+)" viewBox="([^"]+)">([\s\S]*?)<\/symbol>/g)) symbols[m[1]] = { vb: m[2], inner: m[3] };
const pages = [...src.matchAll(/<section class="page">([\s\S]*?)<\/section>\s*(?=<!--|<\/div>)/g)].map(m => m[1]);
if (pages.length !== 2) throw new Error('page count ' + pages.length);
let css = src.match(/<style>([\s\S]*?)<\/style>/)[1];

/* --- ページごとに、印刷用の枠（ページ上の帯・題・下の帯）を外す --- */
const strip = (html, withTitle) => {
  html = html.replace(/\s*<div class="pbar">[\s\S]*?<\/div>\n/, '\n');
  if (withTitle) html = html.replace(/\s*<div class="ttl">[\s\S]*?<\/div>\n/, '\n');
  html = html.replace(/\s*<div class="grow"><\/div>[\s\S]*$/, '\n');
  return html.replace(/<!--[\s\S]*?-->/g, '').trim();
};
const raw = [strip(pages[0], true), strip(pages[1], false)];
const plain = h => h.replace(/<svg[^>]*aria-label="[^"]*"/g, m => m).replace(/<[^>]+>/g, '').replace(/\s+/g, '');
const before = raw.map(plain);

/* --- 赤シートの対象（class="rs"）。1か所ずつ、1回だけ見つかることを確かめる --- */
const once = (h, from, to) => {
  const n = h.split(from).length - 1;
  if (n !== 1) throw new Error('not unique (' + n + '): ' + from);
  return h.replace(from, to);
};
const RS = ' role="button" tabindex="0"';
const pill = (h, cls, text, ctx) => once(h, ctx, ctx.replace(`<span class="${cls}">${text}</span>`, `<span class="${cls} rs"${RS}>${text}</span>`));
const bold = (h, text) => once(h, `<b>${text}</b>`, `<b class="rs"${RS}>${text}</b>`);
let [p1, p2] = raw;
// 前半
p1 = p1.replace(/<span class="mk">/g, `<span class="rs"${RS}>`);
for (const t of ['当たらない', 'いらない', '適用されない', '事務所の場所だけ', '免許換え']) p1 = bold(p1, t);
p1 = pill(p1, 'pill ng', 'いらない', '<span class="pill ng">いらない</span><span>自ら貸借</span>');
p1 = pill(p1, 'pill ng', 'いらない', '<span class="pill ng">いらない</span><span>1回だけ</span>');
p1 = pill(p1, 'pill ok', '免許がいる', '<span class="pill ok">免許がいる</span><span>くり返し売る</span>');
p1 = once(p1, '<span class="pill ng hl">いらない</span>', `<span class="pill ng hl rs"${RS}>いらない</span>`);
// 後半
p2 = p2.replace(/<span class="mk">/g, `<span class="rs"${RS}>`);
for (const t of ['背任', '道路交通法の違反', '控訴している間', '1人でも欠格', '免許を受けられる']) p2 = bold(p2, t);
p2 = once(p2, '<span class="go">復権の日から、すぐ</span>', `<span class="go rs"${RS}>復権の日から、すぐ</span>`);
p2 = once(p2, '<span class="go">満了の日から、すぐ</span>', `<span class="go rs"${RS}>満了の日から、すぐ</span>`);
p2 = once(p2, '原則、届出の日から5年欠格です', `原則、<span class="rs"${RS}>届出の日から5年</span>欠格です`);
p2 = once(p2, '<span class="pill ng">罰金でも欠格になる罪</span>', `<span class="pill ng rs"${RS}>罰金でも欠格になる罪</span>`);
p2 = once(p2, '<span class="pill ok">欠格にならない</span>', `<span class="pill ok rs"${RS}>欠格にならない</span>`);

/* --- アイコンの <use> を、その場の svg に置き換える（Shadow DOM の中でも壊れない） --- */
const inline = h => h.replace(/<svg( class="ic")?><use href="#([^"]+)"\/><\/svg>/g, (_, c, id) => {
  const s = symbols[id]; if (!s) throw new Error('no symbol ' + id);
  return `<svg${c || ''} viewBox="${s.vb}">${s.inner}</svg>`;
});
p1 = inline(p1); p2 = inline(p2);
if (/<use /.test(p1 + p2)) throw new Error('use left');

/* --- 文言が変わっていないか --- */
const after = [p1, p2].map(plain);
if (before[0] !== after[0] || before[1] !== after[1]) throw new Error('text changed');
const rsCount = h => (h.match(/class="[^"]*\brs\b/g) || []).length;

/* --- CSS：元のCSSを Shadow DOM 用にし、スマホの1列に組み直す --- */
css = css.replace(/:root\{/, ':host{').replace(/@page\{[^}]*\}/, '').replace(/@media print\{[\s\S]*?\n  \}\n/, '');
css += `
/* ===== スマホ1列（ここから追記） ===== */
:host{display:block;font-family:var(--font);color:var(--text);font-size:15px;line-height:1.6;letter-spacing:.02em;word-break:auto-phrase;overflow-wrap:anywhere;--sheet:#8E3B3B}
.tx{display:flex;flex-direction:column;gap:12px}
.sec{font-size:19px}
.fig{padding:10px 12px 12px}
.fig > .cap{flex-wrap:wrap;font-size:16px;row-gap:2px}
.capsub{margin-left:0;flex:0 0 100%;padding-left:32px}
.row{flex-direction:column;gap:10px !important;align-items:stretch !important}
.row > *{flex:none !important}
.tbl{grid-template-columns:44px 1fr 1fr}
.side{gap:8px}
.pc .top{align-items:flex-start}
.pc .res{flex-wrap:wrap}
.way svg{width:100px}
.tl{flex-direction:column;align-items:stretch;gap:8px}
.tl ul{flex:none}
.rk{grid-template-columns:1fr;gap:4px 0}
.rk .lb{margin-top:6px}
.bars{height:auto;min-height:30px}
.bars .g,.bars .go{white-space:normal;text-align:center;padding:4px 8px;line-height:1.4}
.team{flex-wrap:wrap;gap:8px}
.pnl{flex:none !important}
svg.tm,.tl svg{width:100%;height:auto}
.aside{gap:10px;padding:8px 12px 10px}
.aside svg{width:44px;height:44px;flex:0 0 44px}
.key{padding:8px 12px}
.key .t{font-size:17px}
.pill{white-space:normal}
.chip{font-size:14px}
.tk{font-size:14px}
/* 赤シート。隠す前（オフのとき）はもとの蛍光ペンの見た目 */
.rs{box-shadow:inset 0 -0.42em 0 var(--mark);-webkit-box-decoration-break:clone;box-decoration-break:clone;border-radius:3px;-webkit-tap-highlight-color:transparent}
.pill.rs,.bars .go.rs{box-shadow:0 0 0 3px var(--mark)}
.tx.sheet .rs{cursor:pointer;user-select:none;-webkit-user-select:none}
.tx.sheet .rs:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.tx.sheet .rs.s-hide{background:var(--sheet) !important;color:transparent !important;border-color:var(--sheet) !important;box-shadow:none}
.tx.sheet .rs.s-hide.s-flag{background-image:linear-gradient(90deg,rgba(255,255,255,.8) 50%,transparent 50%);background-size:6px 3px;background-repeat:repeat-x;background-position:0 100%}
.tx.sheet .rs.s-hint{background:#F5E1E1 !important;color:var(--sheet) !important;border-color:var(--sheet) !important;box-shadow:none}
.tx.sheet .rs.s-hint .hd{display:inline-block;font-size:.72em;width:.82em;text-align:center}
.tx.sheet .rs.s-doubt{text-decoration:underline wavy var(--sheet);text-decoration-thickness:1.5px;text-underline-offset:3px;box-shadow:0 0 0 1.5px var(--sheet)}
`;

const html = '<style>' + css + '</style>' +
  '<div class="tx" data-part="1">' + p1 + '</div>' +
  '<div class="tx" data-part="2">' + p2 + '</div>';
fs.mkdirSync(new URL('../api/_ep-text/', import.meta.url), { recursive: true });
fs.writeFileSync(OUT, "'use strict';\n// build-ep1-text.mjs が作る。手で直さない。やさしいテキスト第1回（有料）。公開しない（api/_ は URL で取れない）。\nmodule.exports = " + JSON.stringify(html) + ';\n');
console.log('written', html.length, 'chars; rs part1=' + rsCount(p1), 'part2=' + rsCount(p2));
