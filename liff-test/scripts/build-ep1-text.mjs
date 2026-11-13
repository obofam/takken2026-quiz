// やさしいテキスト第1回（A4縦2ページの印刷用HTML）から、スマホで読む1列版を作る。
// 出力：api/_ep-text/ep1.js と、本番用に ../api/_ep-text/（同じ2ファイル。ep1.pdf も）（HTMLの文字列をexport。api/ の _ 始まりは公開されず、URLでは取れない）。
// 使い方：node scripts/build-ep1-text.mjs
// 元の文言は変えない：タグを除いた文字列が元と一致しなければ失敗する。赤シートの対象は class="rs" を付けるだけ。
import fs from 'node:fs';
const SRC = new URL('../../../6_有料PDF/やさしいテキスト_2027/第01回_宅建業と免許.html', import.meta.url);
const OUT = new URL('../api/_ep-text/ep1.js', import.meta.url);
const src = fs.readFileSync(SRC, 'utf8');

/* --- 部品を取り出す --- */
const symbols = {};
for (const m of src.matchAll(/<symbol id="([^"]+)" viewBox="([^"]+)">([\s\S]*?)<\/symbol>/g)) symbols[m[1]] = { vb: m[2], inner: m[3] };
const pages = [...src.matchAll(/<section class="page(?: p\d)?">([\s\S]*?)<\/section>\s*(?=<!--|<\/div>)/g)].map(m => m[1]);
if (pages.length !== 2) throw new Error('page count ' + pages.length);
let css = src.match(/<style>([\s\S]*?)<\/style>/)[1];

/* --- ページごとに、印刷用の枠（ページ上の帯・題・下の帯）を外す --- */
const strip = (html, withTitle) => {
  /* 印刷用A4版だけにある「今回の数字」の帯は読み飛ばす（スマホ用は下で data.json から作った節を1つだけ出す＝二重にしない） */
  html = html.replace(/\s*<!-- 今回の数字:ここから -->[\s\S]*?<!-- 今回の数字:ここまで -->/g, '');
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
  if (/[0-9０-９]/.test(text)) return text.replace(/[0-9０-９]+/g, CIRCLE);
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
/* --- 今回の数字（有料だけ。無料の抜粋・1段目・2段目には入れない）。元は data.json。見本ページ（ep/1/text/index.html）も、この p3 から書き出す --- */
const NUM_DIR = '../../../6_有料PDF/やさしいテキスト_2027/直感図解/第01回_宅建業と免許/';
const numData = JSON.parse(fs.readFileSync(new URL(NUM_DIR + 'data.json', import.meta.url), 'utf8')).numbers;
if (numData.length !== 6) throw new Error('今回の数字は6組のはず');
const p3 = '<h2 class="numh">今回の数字</h2><div class="nl">' + numData.map(x => `<div class="nr"><span class="nv rs"${RS} data-hint="${esc(hintOf(x.n))}">${x.n}</span><span class="nk">${x.k}</span></div>`).join('') + '</div>';
const [p1, p2] = make(true);
const [n1, n2] = make(false);

/* --- 文言が変わっていないか --- */
const after = [p1, p2].map(plain);
if (before[0] !== after[0] || before[1] !== after[1]) throw new Error('text changed');
const afterN = [n1, n2].map(plain);
if (before[0] !== afterN[0] || before[1] !== afterN[1]) throw new Error('text changed (nukigaki base)');
if (plain(p3) !== plain('今回の数字' + numData.map(x => x.n + x.k).join(''))) throw new Error('text changed (numbers)');
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

const numCss = `
/* 今回の数字（有料だけ。抜粋には入れない） */
.numh{font-size:22px;font-weight:900;color:var(--ink);line-height:1.3}
.nl{display:flex;flex-direction:column;gap:8px}
.nr{display:flex;flex-direction:column;align-items:flex-start;gap:2px;background:#fff;border:1px solid var(--line);border-radius:12px;padding:8px 12px}
.nv{font-size:24px;font-weight:900;color:var(--ink);line-height:1.3}
.nr .nk{font-size:16px;line-height:1.5}
`;
const html = '<style>' + css + numCss + '</style>' +
  '<div class="tx" data-part="1">' + p1 + '</div>' +
  '<div class="tx" data-part="2">' + p2 + '</div>' +
  '<div class="tx" data-part="3">' + p3 + '</div>';
fs.mkdirSync(new URL('../api/_ep-text/', import.meta.url), { recursive: true });
fs.writeFileSync(OUT, "'use strict';\n// build-ep1-text.mjs が作る。手で直さない。やさしいテキスト第1回（有料）。公開しない（api/_ は URL で取れない）。\nmodule.exports = " + JSON.stringify(html) + ';\n');
/* 印刷用A4版（PDF）：api/_ep-text/ep1.pdf にコピー（購入者に api/ep-pdf.js が返す）。元が無ければここで止まる */
const PDF_SRC = new URL('../../../6_有料PDF/やさしいテキスト_2027/第01回_宅建業と免許.pdf', import.meta.url);
if (!fs.existsSync(PDF_SRC)) throw new Error('PDF の元がない: 第01回_宅建業と免許.pdf');
fs.copyFileSync(PDF_SRC, new URL('../api/_ep-text/ep1.pdf', import.meta.url));
/* 本番（リポジトリ直下の api/_ep-text/）にも同じ2ファイルを書く。直下の .gitignore で公開リポジトリには入らず、.vercelignore では除外されないのでデプロイには載る */
fs.mkdirSync(new URL('../../api/_ep-text/', import.meta.url), { recursive: true });
fs.copyFileSync(OUT, new URL('../../api/_ep-text/ep1.js', import.meta.url));
fs.copyFileSync(PDF_SRC, new URL('../../api/_ep-text/ep1.pdf', import.meta.url));
console.log('written', html.length, 'chars; rs part1=' + rsCount(p1), 'part2=' + rsCount(p2), 'part3=' + rsCount(p3));

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
const card = n => '<div class="gcard"><span class="gno">' + n + '</span><span class="gm"><span class="gt">' + capTitle(origFigs[n]) + '</span><span class="gn">この図は、<a href="' + TEXT_URL + '" data-umami-event="ep-text" data-umami-event-ep="1">やさしいテキスト（有料）</a>に</span></span></div>';
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

/* 本番用の写し：同じ抜粋を、公開サイトの ep/1/tsuzuki.html に書き出す（手で写さない）。
   ep/1/index.html が、LINE登録者と判定されたあとに fetch して差し込む。
   書き出すのは無料の抜粋（nukiHtml）だけ。有料の全文（api/_ep-text/）は本番側に絶対に書き出さない。
   書き出す前に、有料だけの語・赤シート・今回の数字が入っていないことを確かめる。 */
const PROD_OUT = new URL('../../ep/1/tsuzuki.html', import.meta.url);
if (/_ep-text/.test(PROD_OUT.pathname) || !/\/ep\/1\/tsuzuki\.html$/.test(PROD_OUT.pathname)) throw new Error('本番用の書き出し先が想定と違う: ' + PROD_OUT.pathname);
if (/class="[^"]*\brs\b[^"]*"|role="button"|data-hint|data-part=|今回の数字|ワンポイント|data-hint/.test(nukiHtml)) throw new Error('本番用の抜粋に有料の中身が入っている');
for (const w of ['転貸', '又貸し', '適用されない', '事務所に数える', '継続して業務ができる施設', '取消しの理由', '聴聞の公示', '駆け込み廃業も取消し']) {
  if (nukiHtml.includes(w)) throw new Error('本番用の抜粋に有料の語が入っている: ' + w);
}
fs.writeFileSync(PROD_OUT, nukiHtml);
console.log('production copy written: ep/1/tsuzuki.html', nukiHtml.length, 'chars');

/* ============================================================
   見本ページ（ep/1/text/index.html）：購入者の画面と同じ中身を、そのまま見本として見せる。
   中身は上で組んだ p1・p2・p3（購入者の画面と同じ文字列）をページに直接入れる（API は呼ばない・第1回だけ）。
   赤シートの動き（setupSheet）と帯・ヒントのCSSは、購入者の画面 ep1-3dan.html から切り出して同じものを使う。
   表と下の枠は roadmap/index.html の同じ部分に合わせる。公開してよい有料の中身は、この見本ページ（ep/1/text/）だけ。
   ============================================================ */
const read = rel => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const must = (m, what) => { if (!m) throw new Error('見本ページ：' + what + ' が見つからない'); return m; };
const dan = read('../ep1-3dan.html');
const sheetJs = must(dan.match(/  function esc\(s\)[\s\S]*?(?=\n  function showBuyer\(html\))/), 'ep1-3dan.html の setupSheet')[0];
const sheetCss = must(dan.match(/\.sbar2\{[\s\S]*?\.sb2:focus-visible\{[^}]*\}/), 'ep1-3dan.html の赤シートの帯のCSS')[0];
const pdfCss = must(dan.match(/\.pdfrow\{[^}]*\}\n\.pdfbtn\{[^}]*\}/), 'ep1-3dan.html のPDFボタンのCSS')[0];
const full = read('../ep1-full.html');
const cores = [...full.matchAll(/<div class="core"><h2>今日のポイント<\/h2><p>[^<]*<\/p><\/div>/g)].map(m => m[0]);
if (cores.length !== 2) throw new Error('見本ページ：今日のポイントが2つ見つからない');
/* 今日のポイントは、各半分の「芯」と同じ文であること（タグを除いた文字列で照合） */
const keyText = h => must(h.match(/<div class="key">[\s\S]*?<span class="t">([\s\S]*?)<\/span><\/div>/), '芯')[1];
const plainOf = h => h.replace(/<[^>]+>/g, '').replace(/\s+/g, '');
[p1, p2].forEach((p, i) => { if (plainOf(keyText(p)) !== plainOf(cores[i].replace(/<h2>[^<]*<\/h2>/, ''))) { throw new Error('見本ページ：今日のポイントが芯と違う ' + (i + 1)); } });
const road = read('../../roadmap/index.html');
const tiers = must(road.match(/<section class="tiers"[\s\S]*?<\/section>/), 'roadmap の表')[0].replace(/\s*<p class="tt-note">[\s\S]*?<\/p>/, '');
if ((tiers.match(/<tbody>[\s\S]*<\/tbody>/)[0].match(/<tr>/g) || []).length !== 8) throw new Error('見本ページ：表の行は8つのはず');

const pageCss = `
:root{--sky:#17C5E8;--ink:#0A6477;--soft:#E3F8FC;--bg:#F4FAFC;--text:#141B21;--sub:#6B6B76;--line:#DCEEF3;--sheet:#8E3B3B;--font:"Noto Sans JP","Hiragino Sans","Yu Gothic",sans-serif;--shadow:0 2px 8px rgba(20,27,33,.05);--navh:0px}
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
${sheetCss}
${pdfCss}
.to-quiz{font-size:15px;line-height:1.8;text-align:center}
.pdfthumb{display:block;width:120px;margin:10px auto 0;border:1px solid #ececec;border-radius:8px;overflow:hidden;background:#fff;line-height:0}
.pdfthumb img{display:block;width:100%;height:auto}
.links{display:flex;flex-direction:column;gap:8px;align-items:center}
.links a{display:flex;align-items:center;justify-content:center;width:100%;max-width:360px;min-height:44px;padding:9px 18px;font-size:15px;font-weight:700;line-height:1.4;color:var(--ink);background:#fff;border:1.5px solid var(--sky);border-radius:999px;text-decoration:none;text-align:center}
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
}
@media (max-width:520px){html{scrollbar-width:none}html::-webkit-scrollbar{display:none}}
`;

const sampleScript = `
(function () {
  'use strict';
  /* 赤シート：購入者の画面（ep1-3dan.html）と同じ関数。build-ep1-text.mjs が切り出して入れる */
${sheetJs}
  var cssT = document.getElementById('tpl-css');
  var roots = [];
  Array.prototype.forEach.call(document.querySelectorAll('.thost[data-tpl]'), function (h) {
    var root = h.attachShadow({mode: 'open'});
    root.appendChild(cssT.content.cloneNode(true));
    root.appendChild(document.getElementById(h.getAttribute('data-tpl')).content.cloneNode(true));
    roots.push(root);
  });
  try { setupSheet(roots, document.getElementById('sbar')); } catch (e) { console.warn(e); }
  /* LINE・メールの枠：配信前（2027-01-04より前）の文言（roadmap/index.html と同じ） */
  var d = new Date(), t = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  if (t < 20270104) {
    document.getElementById('lineHead').innerHTML = '<span class="nb">始まったら、</span><span class="nb">LINEかメールでお知らせします</span>';
    document.getElementById('lineBody').innerHTML = '<span class="nb">図解の続きと過去問1選を、</span><span class="nb">毎週月曜にお届けします（予定）。</span><br><span class="nb">登録無料です。</span>';
  }
})();
`;

const tpl = (id, inner) => '<template id="' + id + '">' + inner + '</template>';
const styleOnly = html.match(/^<style>[\s\S]*?<\/style>/)[0];
const samplePage = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>やさしいテキスト 第1回（見本）｜耳で覚える宅建2027</title>
<!-- Umami analytics (page: ep1 やさしいテキスト見本) -->
<script defer src="https://cloud.umami.is/script.js" data-website-id="99a5370c-5fbd-4ceb-9d35-7734d7c580ec"></script>
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
    <div class="sbar2" id="sbar"><span class="sb2-lab">赤シート</span><span class="seg"><button type="button" class="sb2" data-r="on" aria-pressed="true" aria-label="赤シートをかける（全部の語をかくす）">かける</button><button type="button" class="sb2" data-r="off" aria-pressed="false" aria-label="赤シートをはずす（全部の語を見せる）">はずす</button></span><span class="sb2-cnt" data-r="hid"></span></div>
    <p class="shint"><span class="nb">赤い所を押すと答えが出ます。</span><span class="nb">もう一度押すと、またかくれます。</span></p>
    <div class="textwrap">
      <section class="sec" id="text1"><div class="thost" data-tpl="tpl-1"></div></section>
      <section class="sec" id="text2"><div class="thost" data-tpl="tpl-2"></div></section>
      <section class="sec" id="point">
        ${cores.join('\n        ')}
      </section>
      <section class="sec" id="numbers"><div class="thost" data-tpl="tpl-3"></div></section>
    </div>
    <p class="to-quiz"><span class="nb">○×3問と過去問は、</span><a href="/ep/1" data-umami-event="text-back" data-umami-event-to="ep1"><span class="nb">【図解と3問】のページで解けます。</span></a></p>
    <div class="pdfrow">
      <a class="pdfbtn" href="/ep/1/text/yasashii-text-01-a4.pdf" target="_blank" rel="noopener" data-umami-event="text-a4-pdf" data-umami-event-ep="1">印刷用のA4版（PDF）を開く</a>
      <a class="pdfthumb" href="/ep/1/text/yasashii-text-01-a4.pdf" target="_blank" rel="noopener" data-umami-event="text-a4-pdf" data-umami-event-ep="1" tabindex="-1" aria-hidden="true"><img src="/ep/1/text/a4-p1.webp" width="800" height="1133" loading="lazy" alt=""></a>
    </div>
  </div>

  <nav class="links" aria-label="ほかのページ">
    <a href="/ep/1" data-umami-event="text-back" data-umami-event-to="ep1">【図解と3問】第1回へ</a>
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
const SAMPLE_OUT = new URL('../../ep/1/text/index.html', import.meta.url);
if (!/\/ep\/1\/text\/index\.html$/.test(SAMPLE_OUT.pathname)) throw new Error('見本ページの書き出し先が想定と違う: ' + SAMPLE_OUT.pathname);
const sampleRs = (samplePage.match(/class="[^"]*\brs\b/g) || []).length;
if (sampleRs !== 30) throw new Error('見本ページ：赤シートが30か所でない ' + sampleRs);
if (/△/.test(samplePage)) throw new Error('見本ページに△がある');
fs.writeFileSync(SAMPLE_OUT, samplePage);
console.log('sample page written: ep/1/text/index.html', samplePage.length, 'chars; rs=' + sampleRs);
