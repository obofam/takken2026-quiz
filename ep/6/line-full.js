/* 第6回 過去問1選（LINEの中で開いた人だけに、ep/6/index.html が読み込む） */
(function () {
  'use strict';
  var esc = function (s) {
    return String(s).replace(/[&<>"]/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]; });
  };
  var KK = {"year": "令和4年", "no": 34, "revised": true, "stem": "宅地建物取引業者が建物の売買の媒介の際に行う宅地建物取引業法第35条に規定する重要事項の説明に関する次の記述のうち、誤っているものはどれか。なお、説明の相手方は宅地建物取引業者ではないものとする。", "items": [{"m": "1", "t": "当該建物が既存の建物であるときは、宅地建物取引業法第34条の2第1項第4号に規定する建物状況調査を過去1年以内に実施しているかどうか、及びこれを実施している場合におけるその結果の概要を説明しなければならない。", "ok": true, "r": [{"mark": "結果の概要"}]}, {"m": "2", "t": "当該建物が宅地造成及び特定盛土等規制法の規定により指定された造成宅地防災区域内にあるときは、その旨を説明しなければならない。", "ok": true, "r": [{"mark": "造成宅地防災区域内"}]}, {"m": "3", "t": "当該建物について、石綿の使用の有無の調査の結果が記録されているときは、その内容を説明しなければならない。", "ok": true, "r": [{"mark": "石綿の使用の有無"}]}, {"m": "4", "t": "当該建物（昭和56年5月31日以前に新築の工事に着手したもの）が指定確認検査機関、建築士、登録住宅性能評価機関又は地方公共団体による耐震診断を受けたものであるときは、その旨を説明しなければならない。", "ok": false, "r": [{"del": "その旨", "to": "その内容"}]}], "buttons": ["1", "2", "3", "4"], "answer": 4, "lines": [{"m": "1", "t": "正しい。建物状況調査の実施の有無と結果の概要（法35条1項6号の2イ、施行規則16条の2の2）。"}, {"m": "2", "t": "正しい。造成宅地防災区域内にあるときはその旨（施行規則16条の4の3第1号）。"}, {"m": "3", "t": "正しい。石綿の使用の有無の調査結果が記録されているときはその内容（施行規則16条の4の3第4号）。"}, {"m": "4", "t": "誤り。耐震診断は「その旨」ではなく「その内容」を説明する（施行規則16条の4の3第5号）。"}], "onair": "第6回の後半（災害の区域・石綿・耐震診断「その内容」・建物状況調査1年以内）で4肢とも解ける"};
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
  var KAKO_EP = '6';
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
