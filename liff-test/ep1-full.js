/* 第1回 過去問1選（登録している人だけに、ep1-dashiwake.html が読み込む） */
(function () {
  'use strict';
  var esc = function (s) {
    return String(s).replace(/[&<>"]/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]; });
  };
  var KK = {"year": "令和5年", "no": 29, "revised": true, "stem": "宅地建物取引業の免許（以下この問において「免許」という。）に関する次の記述のうち、宅地建物取引業法の規定によれば、正しいものはどれか。", "items": [{"m": "1", "t": "宅地建物取引業者Ａ社の使用人であって、Ａ社の宅地建物取引業を行う支店の代表者であるものが、道路交通法の規定に違反したことにより拘禁刑に処せられたとしても、Ａ社の免許は取り消されることはない。"}, {"m": "2", "t": "宅地建物取引業者Ｂ社の取締役が、所得税法の規定に違反したことにより罰金の刑に処せられたとしても、Ｂ社の免許は取り消されることはない。"}, {"m": "3", "t": "宅地建物取引業者である個人Ｃが、宅地建物取引業法の規定に違反したことにより罰金の刑に処せられたとしても、Ｃの免許は取り消されることはない。"}, {"m": "4", "t": "宅地建物取引業者Ｄ社の非常勤の取締役が、刑法第222条（脅迫）の罪を犯したことにより罰金の刑に処せられたとしても、Ｄ社の免許は取り消されることはない。"}], "buttons": ["1", "2", "3", "4"], "answer": 2, "lines": [{"m": "1", "t": "誤り。拘禁刑以上は罪の種類を問わず欠格で、使用人が該当すれば免許取消し（法5条1項5号、66条1項3号）。"}, {"m": "2", "t": "正しい。所得税法違反は、罰金で欠格になる罪（業法・暴対法・刑法の一部・暴力行為等処罰法）に入らない（法5条1項6号）。"}, {"m": "3", "t": "誤り。宅建業法違反の罰金は欠格で、個人が該当すれば取消し（法5条1項6号、66条1項1号）。"}, {"m": "4", "t": "誤り。脅迫（刑法222条）の罰金は欠格で、役員は常勤・非常勤を問わない（法5条1項6号・12号、66条1項3号）。"}], "onair": "第1回の後半「免許の基準」で解ける（拘禁刑以上は罪の種類を問わない、罰金で欠格になる罪、役員は常勤・非常勤を問わない）。"};
  var STATES = ['', '○', '×', '？'];
  var STATE_NAMES = ['空白', '○', '×', '？'];
  function buildKakomon(k) {
    var box = document.createElement('div');
    box.className = 'kk';
    var marks = k.items.map(function () { return 0; });
    var items = k.items.map(function (it, i) {
      return '<div class="kk-item"><button type="button" class="dm" data-i="' + i + '"></button>' +
        '<span class="kk-mark">' + esc(it.m) + '</span><span>' + esc(it.t) + '</span></div>';
    }).join('');
    var wide = k.buttons.some(function (b) { return b.length > 1; });
    var btnHtml = k.buttons.map(function (b, i) {
      return '<button type="button" class="pill" data-n="' + (i + 1) + '">' + esc(b) + '</button>';
    }).join('');
    box.innerHTML =
      '<div class="qcard">' +
      '<span class="kk-src">' + esc(k.year + ' 問' + k.no + (k.revised ? '（改題）' : '')) + '</span>' +
      '<p class="kk-stem">' + esc(k.stem) + '</p>' +
      '<div>' +
      '<p class="kk-memo">選択肢ごとに○×のメモをつけられます</p>' + items +
      '<div class="kk-btns' + (wide ? ' wide' : '') + '">' + btnHtml + '</div>' +
      '<div class="qres" hidden aria-live="polite"></div>' +
      '<div class="kk-again" hidden><button type="button" class="pill ghost">もう一度</button></div>' +
      '</div>' +
      '</div>';
    var dms = box.querySelectorAll('.kk-item .dm');
    var btns = box.querySelectorAll('.kk-btns .pill');
    var res = box.querySelector('.qres');
    var again = box.querySelector('.kk-again');
    function refresh() {
      Array.prototype.forEach.call(dms, function (d, i) {
        d.textContent = STATES[marks[i]];
        d.setAttribute('aria-label', '選択肢' + k.items[i].m + 'の下書きの印。いまは' + STATE_NAMES[marks[i]]);
      });
    }
    Array.prototype.forEach.call(dms, function (d, i) {
      d.addEventListener('click', function () { marks[i] = (marks[i] + 1) % STATES.length; refresh(); });
    });
    Array.prototype.forEach.call(btns, function (b) {
      b.addEventListener('click', function () {
        var ok = (parseInt(b.getAttribute('data-n'), 10) === k.answer);
        Array.prototype.forEach.call(btns, function (x) { x.disabled = true; });
        b.classList.add('chosen');
        var lines = k.lines.map(function (l) {
          return '<li><span class="kk-mark">' + esc(l.m) + '</span><span>' + esc(l.t) + '</span></li>';
        }).join('');
        res.className = 'qres ' + (ok ? 'ok' : 'ng');
        res.innerHTML =
          '<p class="verdict">' + (ok ? '正解' : '不正解') + '</p>' +
          '<p class="answer">正答　' + esc(k.buttons[k.answer - 1]) + '</p>' +
          '<ul class="kk-lines">' + lines + '</ul>' +
          (k.tail ? '<p class="kk-tail">' + esc(k.tail) + '</p>' : '') +
          '<p class="kk-onair-l">今日の放送のどこで解けるか</p>' +
          '<p class="kk-onair">' + esc(k.onair) + '</p>';
        res.hidden = false;
        again.hidden = false;
        refresh();
      });
    });
    again.querySelector('button').addEventListener('click', function () {
      Array.prototype.forEach.call(btns, function (x) { x.disabled = false; x.classList.remove('chosen'); });
      res.hidden = true; res.innerHTML = ''; again.hidden = true;
      marks = marks.map(function () { return 0; });
      refresh();
      box.scrollIntoView({block: 'nearest'});
    });
    refresh();
    return box;
  }
  var holder = document.getElementById('kkBox');
  if (holder) { holder.appendChild(buildKakomon(KK)); }
})();
