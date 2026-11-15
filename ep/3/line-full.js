/* 第3回 過去問1選（LINEの中で開いた人だけに、ep/3/index.html が読み込む） */
(function () {
  'use strict';
  var esc = function (s) {
    return String(s).replace(/[&<>"]/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]; });
  };
  var KK = {"year": "令和4年", "no": 33, "revised": false, "stem": "宅地建物取引士に関する次の記述のうち、宅地建物取引業法の規定によれば、正しいものはいくつあるか。", "items": [{"m": "ア", "t": "宅地建物取引士資格試験は未成年者でも受験することができるが、宅地建物取引士の登録は成年に達するまでいかなる場合にも受けることができない。", "ok": false, "r": [{"mark": "いかなる場合にも"}]}, {"m": "イ", "t": "甲県知事登録の宅地建物取引士が、宅地建物取引業者（乙県知事免許）の専任の宅地建物取引士に就任するためには、宅地建物取引士の登録を乙県に移転しなければならない。", "ok": false, "r": [{"del": "移転しなければならない", "to": "移転を申請することができる"}]}, {"m": "ウ", "t": "丙県知事登録の宅地建物取引士が、事務の禁止の処分を受けた場合、丁県に所在する宅地建物取引業者の事務所の業務に従事しようとするときでも、その禁止の期間が満了するまで、宅地建物取引士の登録の移転を丁県知事に申請することができない。", "ok": true, "r": [{"mark": "その禁止の期間が満了するまで"}]}, {"m": "エ", "t": "戊県知事登録の宅地建物取引士が、己県へ登録の移転の申請とともに宅地建物取引士証の交付を申請した場合、己県知事が宅地建物取引士証を交付するときは、戊県で交付された宅地建物取引士証の有効期間が経過するまでの期間を有効期間とする宅地建物取引士証を交付しなければならない。", "ok": true, "r": [{"mark": "有効期間が経過するまでの期間"}]}], "buttons": ["1 一つ", "2 二つ", "3 三つ", "4 四つ"], "answer": 2, "lines": [{"m": "ア", "t": "誤り。登録を受けられないのは、営業に関し成年者と同一の行為能力を有しない未成年者だけ（法18条1項1号）。"}, {"m": "イ", "t": "誤り。登録の移転は「申請することができる」で任意（法19条の2）。"}, {"m": "ウ", "t": "正しい。事務禁止の期間が満了していないときは移転を申請できない（法19条の2ただし書）。"}, {"m": "エ", "t": "正しい。移転後の知事は、従前の宅建士証の有効期間が経過するまでの期間を有効期間とする証を交付する（法22条の2第5項）。"}], "onair": "肢ア・イ・ウは第3回（図5の未成年者・図6の任意と事務禁止中）で解ける。肢エ（移転と同時に交付される宅建士証の有効期間）は第4回で扱う", "tail": "正しいものは ウ・エ の二つ。"};
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
  var KAKO_EP = '3';
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
