/* 自動生成：liff-test/scripts/build-ep1-text.mjs（正本は liff-test/ep1-3dan.html）。直さない。
   やさしいテキスト購入者の見え方の動き（赤シート・テキストの差し込み・近道）。ep/1/index.html が、購入の確認（テキストのAPI）で 200 が返った人にだけ読み込む。
   有料の中身は入れない（テキストの HTML は引数で受け取る）。 */
(function () {
  'use strict';
  var body = document.body;
  var mihon = window.__epMihon || null; /* 試し用だけ、?mihon=kounyu のとき ep/N/index.html が入れる（PDF も見本の入口になる）。本番では常に null */
  var epNo = (/\/ep\/(\d+)(?:\/|$)/.exec(location.pathname) || [0, '1'])[1]; /* 回の番号は住所（/ep/N）から読む。build-ep.mjs が作る */
  var buyerShown = false;
  function setTier() {}
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]; }); }

  /* 赤シート：かけた状態では、赤い帯の中にヒント（白い字）が見える。押す＝答え。もう一度押す＝またかくれる。「かける｜はずす」は全部に一斉に効く */
  function setupSheet(roots, bar) {
    var items = [];
    roots.forEach(function (root) {
      Array.prototype.forEach.call(root.querySelectorAll('.rs'), function (el) {
        items.push({el: el, html: el.innerHTML, hint: el.getAttribute('data-hint') || '', open: false});
      });
    });
    var on = true;
    var elOn = bar.querySelector('[data-r="on"]'), elOff = bar.querySelector('[data-r="off"]'), elHid = bar.querySelector('[data-r="hid"]');
    function paint(it) {
      var el = it.el;
      el.classList.remove('s-hide', 's-open');
      if (!on) { el.innerHTML = it.html; el.removeAttribute('aria-label'); return; }
      if (it.open) {
        el.classList.add('s-open'); el.innerHTML = '<span class="av">' + it.html + '</span><span class="hv" aria-hidden="true">' + esc(it.hint) + '</span>'; el.setAttribute('aria-label', '答え。もう一度押すとかくれます');
      } else {
        el.classList.add('s-hide'); el.innerHTML = '<span class="av">' + it.html + '</span><span class="hv" aria-hidden="true">' + esc(it.hint) + '</span>'; el.setAttribute('aria-label', 'かくれています。押すと答え');
      }
    }
    function count() {
      var hid = 0;
      items.forEach(function (it) { if (on && !it.open) { hid += 1; } });
      elHid.textContent = 'かくれている ' + hid;
    }
    function render() {
      roots.forEach(function (r) { var w = r.querySelector('.tx'); if (w) { w.classList.toggle('sheet', on); } });
      items.forEach(paint);
      count();
      elOn.setAttribute('aria-pressed', on ? 'true' : 'false');
      elOff.setAttribute('aria-pressed', on ? 'false' : 'true');
    }
    items.forEach(function (it) {
      function step() {
        if (!on) { return; }
        it.open = !it.open;
        paint(it); count();
      }
      it.el.addEventListener('click', step);
      it.el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); step(); } });
    });
    elOn.addEventListener('click', function () { on = true; items.forEach(function (it) { it.open = false; }); render(); });
    elOff.addEventListener('click', function () { on = false; render(); });
    render();
    return items.length;
  }

  function showBuyer(html) {
    if (buyerShown) { return; }
    /* 先に部品を全部作る（ここで失敗しても、登録者の表示には触らない） */
    var tpl = document.createElement('template');
    tpl.innerHTML = html;
    var style = tpl.content.querySelector('style');
    var t1 = tpl.content.querySelector('[data-part="1"]'), t2 = tpl.content.querySelector('[data-part="2"]'), t3 = tpl.content.querySelector('[data-part="3"]');
    if (!style || !t1 || !t2) { throw new Error('テキストの形が想定と違う'); }
    var q1 = document.getElementById('q1'), q2 = document.getElementById('q2'), honban = document.getElementById('honban');
    if (!q1 || !q2 || !honban) { throw new Error('3問の組が見つからない'); }
    function host(part) {
      var h = document.createElement('div');
      h.className = 'thost';
      var root = h.attachShadow({mode: 'open'});
      root.appendChild(style.cloneNode(true));
      root.appendChild(part);
      return {el: h, root: root};
    }
    var h1 = host(t1), h2 = host(t2), h3 = t3 ? host(t3) : null;
    var sec3 = document.createElement('section'); sec3.className = 'sec'; sec3.id = 'numbers'; if (h3) { sec3.appendChild(h3.el); }
    var sec1 = document.createElement('section'); sec1.className = 'sec'; sec1.id = 'text1';
    var sec2 = document.createElement('section'); sec2.className = 'sec'; sec2.id = 'text2';
    var bar = document.createElement('div');
    bar.className = 'sbar2';
    bar.innerHTML = '<span class="sb2-lab">赤シート</span><span class="seg"><button type="button" class="sb2" data-r="on" aria-pressed="true" aria-label="赤シートをかける（全部の語をかくす）">かける</button><button type="button" class="sb2" data-r="off" aria-pressed="false" aria-label="赤シートをはずす（全部の語を見せる）">はずす</button></span><span class="sb2-cnt" data-r="hid"></span>';
    var point = document.createElement('section'); point.className = 'sec'; point.id = 'point';
    Array.prototype.forEach.call(document.querySelectorAll('#zukai .core'), function (c) { point.appendChild(c); });
    /* ここから画面を変える */
    sec1.appendChild(h1.el); sec1.appendChild(q1);
    sec2.appendChild(h2.el); sec2.appendChild(q2);
    /* 赤シートの帯は前半・後半の両方で上に残るよう、2つの節をまとめる箱の先頭に置く */
    var tw = document.createElement('div'); tw.className = 'textwrap';
    var hint = document.createElement('p'); hint.className = 'shint';
    hint.innerHTML = '<span class="nk">赤い所を押すと答えが出ます。</span><span class="nk">もう一度押すと、またかくれます。</span>';
    var pdfRow = document.createElement('div'); pdfRow.className = 'pdfrow';
    var pdfUrl = '/api/ep-pdf?ep=' + epNo + (mihon === 'kounyu' ? '&mihon=1' : '');
    pdfRow.innerHTML = '<a class="pdfbtn" id="pdfbtn" href="' + pdfUrl + '" target="_blank" rel="noopener" data-umami-event="ep-pdf" data-umami-event-ep="' + epNo + '">印刷用のA4版（PDF）を開く</a>';
    /* LINEの中ではPDFが開きにくいことがある。試作は同じ画面内で開く。将来は liff.openWindow({url, external:true}) で外のブラウザに出す（外にはログインのクッキーが無いので、別の仕組みが要る） */
    pdfRow.firstChild.addEventListener('click', function (e) {
      var inClient = false;
      try { inClient = !!(window.liff && liff.isInClient && liff.isInClient()); } catch (_) {}
      if (inClient) { e.preventDefault(); location.href = pdfUrl; }
    });
    tw.appendChild(bar); tw.appendChild(hint); tw.appendChild(sec1); tw.appendChild(sec2); tw.appendChild(pdfRow);
    var zukai = document.getElementById('zukai');
    zukai.parentNode.insertBefore(tw, zukai);
    if (point.children.length) { zukai.parentNode.insertBefore(point, honban); }
    if (h3) { zukai.parentNode.insertBefore(sec3, honban); }
    body.classList.add('is-buyer');
    var jump = document.getElementById('jump');
    if (jump) { jump.innerHTML = '<a class="jb" href="#text1">前半</a><a class="jb" href="#text2">後半</a><a class="jb" href="#honban">過去問1選</a>'; }
    var a1 = q1.querySelector('.line-inv a'), a2 = q2.querySelector('.line-inv a');
    if (a1) { a1.setAttribute('href', '#text2'); a1.textContent = '後半のテキストへ'; }
    if (a2) { a2.setAttribute('href', point.children.length ? '#point' : '#honban'); a2.textContent = point.children.length ? '今日のポイントへ' : '過去問1選について'; }
    var n = 0;
    try { n = setupSheet(h3 ? [h1.root, h2.root, h3.root] : [h1.root, h2.root], bar); } catch (e) { console.warn(e); }
    buyerShown = true;
    setTier('3段目（やさしいテキスト購入者）');
    return n;
  }
  /* 図解で確かめる（#zukai）：購入者の表示では図解の節がないので、その組のテキストへ */
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href="#zukai"]') : null;
    if (!a || !body.classList.contains('is-buyer')) { return; }
    e.preventDefault();
    var inQ2 = !!a.closest('#q2');
    var t = document.getElementById(inQ2 ? 'text2' : 'text1');
    if (t) { t.scrollIntoView({block: 'start'}); }
  });

  window.TakkenTextView = { show: showBuyer };
})();
