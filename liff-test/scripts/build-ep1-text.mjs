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
/* --- 赤シートのヒントの表（回ごとに1つ。全41回に広げるときは回の番号で足す） ---
   ヒントの種類は3つ。自動で決まるのは「数字」と「言葉」。「どっち」と「かける範囲の狭め直し」はこの表で指定する。
   1. 数字  ：数字だけを ○ にして、単位と前後の言葉はそのまま（例：5年 → ○年）。自動。
   2. どっち：選択肢が2〜3個に決まる語。選択肢を全角「／」で並べて見せる（choice）。選択肢はテキスト内で実際に使われている言い方だけ。
   3. 言葉  ：頭の1字＋残りを ○（1字の語は ○ だけ）。自動。6字を超える語は広すぎるので、核の語だけにかけ直す（narrow：答えの語 → かける範囲）。 */
const HINTS = {
  1: {
    choice: {
      '免許がいる': 'いる／いらない', 'いらない': 'いる／いらない',
      '知事': '知事／大臣', '大臣': '知事／大臣',
      '当たらない': '当たる／当たらない',
      '欠格にならない': '欠格になる／欠格にならない',
      '免許を受けられる': '受けられる／受けられない',
      'すぐ': 'すぐ／5年',
      '適用されない': '適用される／適用されない',
    },
    narrow: {
      '事務所の場所だけ': '事務所の場所',
      '復権の日から、すぐ': 'すぐ',
      '満了の日から、すぐ': 'すぐ',
      '罰金でも欠格になる罪': '欠格になる罪',
      '道路交通法の違反': '道路交通法',
      '控訴している間': '控訴',
    },
  },
};
const EP = 1;
const TABLE = HINTS[EP];
const CIRCLE = '\u25CB';
const hintOf = text => {
  if (TABLE.choice[text]) return TABLE.choice[text];
  const chars = Array.from(text);
  if (/[0-9０-９]/.test(text)) return chars.map(c => (/[0-9０-９]/.test(c) ? CIRCLE : c)).join('');
  const keep = c => '・、〜'.indexOf(c) >= 0 || /\s/.test(c);
  const n = chars.filter(c => !keep(c)).length, head = n <= 1 ? 0 : 1;
  let k = 0;
  return chars.map(c => (keep(c) ? c : (k++ < head ? c : CIRCLE))).join('');
};
/* かける範囲の狭め直し：rs が答えの語ぜんぶにかかっているものを、核の語だけにかけ直す（文言は変えない。タグだけ） */
const narrowAll = h => h.replace(/<(span|b)( class="([^"]*)")( role="button" tabindex="0")>([^<]*)<\/\1>/g, (m, tag, _c, cls, role, text) => {
  const core = TABLE.narrow[text]; if (!core) return m;
  const i = text.indexOf(core); if (i < 0) throw new Error('narrow: ' + text);
  const pre = text.slice(0, i), post = text.slice(i + core.length);
  const outer = cls.split(/\s+/).filter(c => c !== 'rs').join(' ');
  const inner = `<span class="rs"${role}>${core}</span>`;
  return tag === 'b' ? `<b>${pre}${inner}${post}</b>` : `<span class="${outer}">${pre}${inner}${post}</span>`;
});
const esc = t => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const hintAll = h => h.replace(/(<(?:span|b) class="[^"]*\brs\b[^"]*" role="button" tabindex="0")>([^<]*)</g, (m, open, text) => `${open} data-hint="${esc(hintOf(text))}">${text}<`);
const pill = (h, cls, text, ctx) => once(h, ctx, ctx.replace(`<span class="${cls}">${text}</span>`, `<span class="${cls} rs"${RS}>${text}</span>`));
const bold = (h, text) => once(h, `<b>${text}</b>`, `<b class="rs"${RS}>${text}</b>`);
/* 全文版（赤シートあり）と、無料の抜粋用（赤シートなし）を同じ手順で作る */
const make = withRs => {
let [p1, p2] = raw;
if (withRs) {
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
}
/* --- アイコンの <use> を、その場の svg に置き換える（Shadow DOM の中でも壊れない） --- */
/* 図7：字を大きくした分、枠と字の位置を少しだけずらす（図形の位置だけ。字は変えない） */
p2 = once(p2, '<rect x="20" y="24" width="82" height="20" rx="3"', '<rect x="8" y="23" width="96" height="22" rx="3"');
p2 = once(p2, '<text x="61" y="39" font-size="13"', '<text x="56" y="39" font-size="13"');
p2 = once(p2, '<text x="176" y="94" font-size="13"', '<text x="176" y="91" font-size="13"');
/* 図5（横に長い svg.tm）を、横にスクロールできる箱に入れる（タグだけ。文言は変えない） */
const wrapTm = h => h.replace(/(<svg class="tm"[\s\S]*?<\/svg>)/, '<div class="xs" tabindex="0">$1</div>');
p1 = wrapTm(p1); p2 = wrapTm(p2);
const inline = h => h.replace(/<svg( class="ic")?><use href="#([^"]+)"\/><\/svg>/g, (_, c, id) => {
  const s = symbols[id]; if (!s) throw new Error('no symbol ' + id);
  return `<svg${c || ''} viewBox="${s.vb}">${s.inner}</svg>`;
});
p1 = inline(p1); p2 = inline(p2);
if (/<use /.test(p1 + p2)) throw new Error('use left');
/* 帯は1つの塊として折り返されるので、前の「（開き括弧）と後ろの「。、」）」が帯から離れて行頭・行末に残らないよう、くっつけて折らない箱に入れる（タグだけ） */
const glue = h => h.replace(/([「『（]?)(<(span|b) class="[^"]*\brs\b[^"]*"[^>]*>[^<]*<\/\3>)([。、」』）]?)/g, (m, a, el, _t, z) => (a || z) ? `<span class="nb">${a}${el}${z}</span>` : m);
if (withRs) { p1 = glue(hintAll(narrowAll(p1))); p2 = glue(hintAll(narrowAll(p2))); }
return [p1, p2];
};
const [p1, p2] = make(true);
const [n1, n2] = make(false);

/* --- 文言が変わっていないか --- */
const after = [p1, p2].map(plain);
if (before[0] !== after[0] || before[1] !== after[1]) throw new Error('text changed');
const afterN = [n1, n2].map(plain);
if (before[0] !== afterN[0] || before[1] !== afterN[1]) throw new Error('text changed (nukigaki base)');
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
/* スマホで読む：印刷用の「折り返さない」をやめる（はみ出して横に広がるのを防ぐ）。<br> は本文・説明・囲みでは効かせない（アイコン横の短い名札 .pp だけ残す） */
.nw{display:inline;white-space:normal}
.tx p br,.key br,.chip br,.aside br,.tk br,.pnl .m br{display:none}
/* 赤シートの対象は途中で折らない（折れると形がばらばらの四角になる）。折れる場合に備えて clone と上下の余白も付ける */
.rs{white-space:nowrap;-webkit-box-decoration-break:clone;box-decoration-break:clone}
span.rs:not(.pill):not(.go),b.rs{padding:.1em 2px;margin:0 -1px}
.tx .key .t{text-wrap:pretty}
.tx p,.chip,.tk,.aside p{text-wrap:pretty}
/* 図の中の字をスマホ幅でも11px前後に。図7は字を大きく、図5は横に長い図なので横にスクロールできる箱に入れる */
.tl svg text{font-size:15px}
.xs{overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;margin:0 -4px;padding:0 4px;overscroll-behavior-x:contain}
.xs svg.tm{width:560px;max-width:none;height:auto}
.tx.sheet .rs{cursor:pointer;user-select:none;-webkit-user-select:none}
.tx.sheet .rs:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.tx.sheet .rs{position:relative;display:inline-grid;justify-items:start;align-items:center}
.tx.sheet .rs.pill,.tx.sheet .rs.go{justify-items:center}
.tx.sheet .rs::before{content:"";position:absolute;left:-2px;right:-2px;top:-9px;bottom:-9px}
.tx.sheet .rs .av,.tx.sheet .rs .hv{grid-area:1/1;white-space:nowrap}
.nb{white-space:nowrap}
.tx.sheet .rs .hv{padding:0 2px;color:#fff !important;font-size:12px;font-weight:700;line-height:1.3;letter-spacing:0;pointer-events:none}
.tx.sheet .rs.s-hide{background:var(--sheet) !important;color:transparent !important;border-color:var(--sheet) !important;box-shadow:none}
.tx.sheet .rs.s-hide .av{visibility:hidden}
.tx.sheet .rs.s-open .hv{visibility:hidden}
.go .rs{box-shadow:none}
`;

const html = '<style>' + css + '</style>' +
  '<div class="tx" data-part="1">' + p1 + '</div>' +
  '<div class="tx" data-part="2">' + p2 + '</div>';
fs.mkdirSync(new URL('../api/_ep-text/', import.meta.url), { recursive: true });
fs.writeFileSync(OUT, "'use strict';\n// build-ep1-text.mjs が作る。手で直さない。やさしいテキスト第1回（有料）。公開しない（api/_ は URL で取れない）。\nmodule.exports = " + JSON.stringify(html) + ';\n');
/* 印刷用A4版（PDF）：api/_ep-text/ep1.pdf にコピー（購入者に api/ep-pdf.js が返す）。元が無ければここで止まる */
const PDF_SRC = new URL('../../../6_有料PDF/やさしいテキスト_2027/第01回_宅建業と免許.pdf', import.meta.url);
if (!fs.existsSync(PDF_SRC)) throw new Error('PDF の元がない: 第01回_宅建業と免許.pdf');
fs.copyFileSync(PDF_SRC, new URL('../api/_ep-text/ep1.pdf', import.meta.url));
console.log('written', html.length, 'chars; rs part1=' + rsCount(p1), 'part2=' + rsCount(p2));

/* ============================================================
   無料の抜粋（ep1-nukigaki.html）：図だけを、赤シートなしで。置き場所は公開してよい静的ファイル。
   1段目＝図1、2段目＝図1・3・5・6・8。図2・4・7は「この図はやさしいテキストに」の札だけ（中身は入れない）。
   図の番号はテキストのまま。図の外の文（芯・寄り道・囲み）は入れない。
   ============================================================ */
const FREE = [1, 3, 5, 6, 8];
const PAID_ONLY = [2, 4, 7];
const figsOf = h => [...h.matchAll(/<figure class="fig">[\s\S]*?<\/figure>/g)].map(m => m[0]);
const figNo = f => Number(f.match(/<span class="n">(\d+)<\/span>/)[1]);
const capTitle = f => f.match(/<div class="cap"><span class="n">\d+<\/span>([^<]*)/)[1];
const origFigs = {}; for (const h of raw) for (const f of figsOf(h)) origFigs[figNo(f)] = f;
const nukiFigs = {}; for (const h of [n1, n2]) for (const f of figsOf(h)) nukiFigs[figNo(f)] = f;
const allNos = Object.keys(origFigs).map(Number).sort((a, b) => a - b);
if (allNos.join() !== '1,2,3,4,5,6,7,8') throw new Error('figure numbers ' + allNos);
for (const n of FREE) {
  if (plain(origFigs[n]) !== plain(nukiFigs[n])) throw new Error('nukigaki text changed in fig ' + n);
  if (/\brs\b|role="button"/.test(nukiFigs[n])) throw new Error('rs in nukigaki fig ' + n);
  if (/<use /.test(nukiFigs[n])) throw new Error('use left in fig ' + n);
}
const TEXT_URL = 'https://takken.mimiobo.com/ep/1/text';
const card = n => '<a class="gcard" href="' + TEXT_URL + '" data-umami-event="ep-text" data-umami-event-ep="1"><span class="gno">' + n + '</span><span class="gm"><span class="gt">' + capTitle(origFigs[n]) + '</span><span class="gn">この図はやさしいテキストに</span></span></a>';
const fig = n => '<div class="tx" data-fig="' + n + '">' + nukiFigs[n] + '</div>';
/* 1〜5＝前半、6〜8＝後半。図の順に並べ、有料だけの図の所に札を置く */
const seq = nos => nos.map(n => FREE.includes(n) ? fig(n) : card(n)).join('\n');
const nukiHtml =
  '<!-- 第1回 図解：やさしいテキストからの抜粋（無料・LINE登録者向け）。scripts/build-ep1-text.mjs が作る。手で直さない。赤シートなし。 -->\n' +
  '<style data-nk="css">' + css.replace(/\/\*[\s\S]*?\*\//g, '') + '</style>\n' +
  '<div data-slot="fig1">\n' + fig(1) + '\n</div>\n' +
  '<div data-slot="cards1">\n' + seq([2, 3, 4, 5]) + '\n</div>\n' +
  '<div data-slot="cards2">\n' + seq([6, 7, 8]) + '\n</div>\n';
fs.writeFileSync(new URL('../ep1-nukigaki.html', import.meta.url), nukiHtml);
console.log('nukigaki', nukiHtml.length, 'chars; free figs', FREE.join(','), 'cards', PAID_ONLY.join(','));
