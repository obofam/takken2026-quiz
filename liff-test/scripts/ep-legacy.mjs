// 第1回だけの「昔のスマホ幅の手当て」。第1回は手で作った版が本番に出ていて確認ずみなので、見た目・動きを変えないよう、そのまま持つ。
// （もとは build-ep1-text.mjs の中にあった。第2回以降は材料の _tools/sp_overrides.css を使う）

export const EP1_CSS_TAIL = `
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

const once = (h, from, to) => {
  const n = h.split(from).length - 1;
  if (n !== 1) throw new Error('not unique (' + n + '): ' + from);
  return h.replace(from, to);
};

/* 図7：字を大きくした分、枠と字の位置を少しだけずらす（図形の位置だけ。字は変えない） */
export const ep1FixPage2 = p2 => {
  p2 = once(p2, '<rect x="20" y="24" width="82" height="20" rx="3"', '<rect x="8" y="23" width="96" height="22" rx="3"');
  p2 = once(p2, '<text x="61" y="39" font-size="13"', '<text x="56" y="39" font-size="13"');
  p2 = once(p2, '<text x="176" y="94" font-size="13"', '<text x="176" y="91" font-size="13"');
  return p2;
};

/* 図5（横に長い svg.tm）を、横にスクロールできる箱に入れる（タグだけ。文言は変えない） */
export const ep1WrapTm = h => h.replace(/(<svg class="tm"[\s\S]*?<\/svg>)/, '<div class="xs" tabindex="0">$1</div>');
