/* 第8回 過去問1選（LINEの中で開いた人だけに、ep/8/index.html が読み込む） */
(function () {
  'use strict';
  var esc = function (s) {
    return String(s).replace(/[&<>"]/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]; });
  };
  var KK = {"year": "令和5年", "no": 43, "revised": false, "stem": "宅地建物取引業者Ａが媒介により宅地の売買契約を成立させた場合における宅地建物取引業法第37条の規定により交付すべき書面（以下この問において「37条書面」という。）に関する次の記述のうち、正しいものはどれか。", "items": [{"m": "1", "t": "Ａは、買主が宅地建物取引業者であるときは、37条書面に移転登記の申請時期を記載しなくてもよい。", "ok": false, "r": [{"mark": "買主が宅地建物取引業者であるとき"}, {"del": "記載しなくてもよい", "to": "記載しなければならない"}]}, {"m": "2", "t": "Ａは、37条書面を売買契約成立前に、各当事者に交付しなければならない。", "ok": false, "r": [{"del": "成立前", "to": "成立後"}]}, {"m": "3", "t": "Ａは、37条書面を作成したときは、専任の宅地建物取引士をして37条書面に記名させる必要がある。", "ok": false, "r": [{"mark": "専任の"}]}, {"m": "4", "t": "Ａは、天災その他不可抗力による損害の負担に関する定めがあるときは、その内容を37条書面に記載しなければならない。", "ok": true, "r": [{"mark": "定めがあるとき"}]}], "buttons": ["1", "2", "3", "4"], "answer": 4, "lines": [{"m": "1", "t": "誤り。業者間取引でも37条は適用除外にならず、移転登記の申請の時期は書かなければならない（法78条2項、37条1項5号）。"}, {"m": "2", "t": "誤り。37条書面は成立後、遅滞なく交付する（法37条1項）。成立前に交付するのは35条書面。"}, {"m": "3", "t": "誤り。記名するのは宅建士で、専任は不要（法37条3項）。"}, {"m": "4", "t": "正しい。不可抗力による損害の負担は、定めがあるときだけ書く（法37条1項10号）。"}], "onair": "第8回の前半（成立後・遅滞なく／記名は専任でなくてよい／業者相手でも省略できない）と後半（不可抗力は定めがあるときだけ）で4肢とも解ける"};
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
      out += a.mark ? '<span class="sh-mk">' + esc(a.mark) + '</span>' : '<span class="sh-g" role="group" aria-label="' + esc('誤り「' + a.del + '」。正しくは「' + a.to + '」') + '"><del>' + esc(a.del) + '</del><ins aria-hidden="true">' + esc(a.to) + '</ins></span>';
      pos = x.i + x.w.length;
    });
    return out + esc(t.slice(pos));
  }
  /* 過去問を解いた結果を、回ごとに記録に残す（1=正解、2=不正解。解き直したら上書き）。端末の takken2027-kako に書き、ログインしている人はサーバーにも置く */
  var KAKO_EP = '8';
  function saveKako(ok) {
    var v = ok ? 1 : 2;
    try {
      var o = {};
      try { o = JSON.parse(localStorage.getItem('takken2027-kako') || '{}'); } catch (_) { o = {}; }
      if (!o || typeof o !== 'object' || Array.isArray(o)) { o = {}; }
      o[KAKO_EP] = v;
      localStorage.setItem('takken2027-kako', JSON.stringify(o));
    } catch (_) {}
    try { if (window.TakkenProgress) { window.TakkenProgress.set('kako', KAKO_EP, v); } } catch (_) {}
  }
  var STATES = ['', '○', '×', '？'];
  var STATE_NAMES = ['空白', '○', '×', '？'];
  function buildKakomon(k) {
    var box = document.createElement('div');
    box.className = 'kk';
    var marks = k.items.map(function () { return 0; });
    var items = k.items.map(function (it, i) {
      return '<div class="kk-item">' +
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
      items +
      '<div class="kk-btns' + (wide ? ' wide' : '') + '">' + btnHtml + '</div>' +
      '<div class="qres" hidden aria-live="polite"></div>' +
      '<div class="kk-again" hidden><button type="button" class="pill ghost">もう一度</button></div>' +
      '</div>' +
      '</div>';
    var dms = box.querySelectorAll('.kk-item .dm');
    var btns = box.querySelectorAll('.kk-btns .pill');
    var tspans = box.querySelectorAll('.kk-item > span:last-child');
    var kkNums = box.querySelectorAll('.kk-item > .kk-mark');
    function shuire(on) {
      Array.prototype.forEach.call(tspans, function (s, i) {
        var it = k.items[i];
        if (it.r) { s.innerHTML = on ? shuireHtml(it) : esc(it.t); }
        var mk = kkNums[i];
        if (mk) {
          mk.innerHTML = on
            ? '<span class="kk-no">' + esc(it.m) + '<span class="kk-jg ' + (it.ok ? 'kk-jg-o' : 'kk-jg-x') + '" aria-hidden="true"></span><span class="kk-sr">（' + (it.ok ? '正しい' : '誤り') + '）</span></span>'
            : esc(it.m);
        }
      });
    }
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
        saveKako(ok);
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
        res.hidden = false; shuire(true);
        again.hidden = false;
        refresh();
      });
    });
    again.querySelector('button').addEventListener('click', function () {
      Array.prototype.forEach.call(btns, function (x) { x.disabled = false; x.classList.remove('chosen'); });
      res.hidden = true; res.innerHTML = ''; again.hidden = true; shuire(false);
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
