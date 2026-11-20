/* 回のページ・ロードマップの Umami 計測に「どの入口から来たか」を付ける共通の部品（公開物。秘密は入っていない）。
   Umami のトラッカー（cloud.umami.is/script.js）のあとに defer で読む。

   付ける物（イベントのプロパティ）
     ent  来た入口：to2027（2026の回の概要欄）／stf（2027の概要欄のロードマップなど）／youtube（YouTube講義の概要欄＝mark lecture・固定コメント＝mark pin）／note／mail／line／direct（目印なし）／roadmap（サイト内などの src）
     mark 概要欄の印（utm_content。ep2・hokyo1・gaiyou など）。無ければ付けない
     view 表示の種類：waku（配信前の枠）／junbi（配信後で中身が無い・準備中）／nakami（中身あり）／roadmap／text（やさしいテキストの見本）
     ep   回の番号（URL の /ep/N から。すでに付いていれば触らない）
   入口は、そのブラウザのタブの間は覚えておく（sessionStorage）。外から来た目印（to2027・stf・note・mail）が新しく付いたときだけ上書きする。
   → 回のページからロードマップへ移ったあとも、「どの2026の回から来た人か」が追える。
   決まりの一覧：1_配信運用/2026と2027の対応表/README.md「Umami での読み方」 */
(function () {
  'use strict';
  var KEY = 'ep-ctx', EXT = { to2027: 1, stf: 1, note: 1, mail: 1, youtube: 1 };
  var path = location.pathname;

  function fromUrl() {
    var q;
    try { q = new URLSearchParams(location.search); } catch (_) { return null; }
    var us = q.get('utm_source'), um = q.get('utm_medium'), uc = (q.get('utm_content') || '').slice(0, 40), s = q.get('src') || '';
    if (us === 'stf') { return { ent: um === 'to2027' ? 'to2027' : 'stf', mark: uc }; }
    if (us === 'note' || s === 'note') { return { ent: 'note', mark: uc }; }
    if (us === 'youtube') { return { ent: 'youtube', mark: um === 'pin' ? 'pin' : 'lecture' }; }
    if (s === 'mail' || q.get('m')) { return { ent: 'mail', mark: '' }; }
    s = s.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20);
    if (s) { return { ent: s, mark: '' }; }
    if (q.has('liff.state') || /Line\//.test(navigator.userAgent || '')) { return { ent: 'line', mark: '' }; }
    return null;
  }
  function readStore() { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (_) { return null; } }
  function writeStore(o) { try { sessionStorage.setItem(KEY, JSON.stringify(o)); } catch (_) {} }

  var u = fromUrl(), st = readStore(), ctx;
  if (u && EXT[u.ent]) { ctx = u; }
  else if (st && st.ent) { ctx = st; }
  else { ctx = u || { ent: 'direct', mark: '' }; }
  writeStore(ctx);

  var cl = document.documentElement.classList;
  var view = /^\/roadmap/.test(path) ? 'roadmap'
    : /^\/ep\/\d+\/text/.test(path) ? 'text'
    : (cl.contains('ep-before') || cl.contains('ep-closed')) ? 'waku'
    : cl.contains('ep-after') ? 'junbi'
    : 'nakami';
  var m = /^\/ep\/(\d+)/.exec(path);
  var ep = m ? m[1] : '';

  /* いま開いているページの文脈。sendView などが、送る直前に読む */
  window.__epCtx = { ent: ctx.ent, mark: ctx.mark, view: view, ep: ep };
  window.__epCtxProps = function (extra) {
    var o = { view: view, ent: ctx.ent };
    if (ctx.mark) { o.mark = ctx.mark; }
    if (extra) { for (var k in extra) { if (Object.prototype.hasOwnProperty.call(extra, k)) { o[k] = extra[k]; } } }
    return o;
  };

  /* data-umami-event のあるものを押したとき、Umami の処理より先に（window の捕捉段階で）プロパティを足す。あとから描かれるボタンにも効く */
  window.addEventListener('click', function (e) {
    var t = e.target;
    var el = t && t.closest ? t.closest('[data-umami-event]') : null;
    if (!el) { return; }
    if (!el.hasAttribute('data-umami-event-view')) { el.setAttribute('data-umami-event-view', view); }
    if (!el.hasAttribute('data-umami-event-ent')) { el.setAttribute('data-umami-event-ent', ctx.ent); }
    if (ctx.mark && !el.hasAttribute('data-umami-event-mark')) { el.setAttribute('data-umami-event-mark', ctx.mark); }
    if (ep && view !== 'roadmap' && !el.hasAttribute('data-umami-event-ep')) { el.setAttribute('data-umami-event-ep', ep); }
  }, true);

  /* 予告ページ（枠）は自分では ep-view を送らないので、ここで1回送る。本物の回のページは、ページ側が見え方（tier）と一緒に送る */
  if (document.documentElement.hasAttribute('data-yokoku')) {
    var n = 0;
    (function send() {
      try {
        if (window.umami && typeof window.umami.track === 'function') { window.umami.track('ep-view', window.__epCtxProps({ ep: ep })); return; }
      } catch (_) { return; }
      if (++n < 20) { setTimeout(send, 250); }
    })();
  }
})();
