/* 第7回 過去問1選（LINEの中で開いた人だけに、ep/7/index.html が読み込む） */
(function () {
  'use strict';
  var esc = function (s) {
    return String(s).replace(/[&<>"]/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]; });
  };
  var KK = {"year": "令和7年", "no": 37, "revised": false, "stem": "宅地建物取引業者が行う宅地建物取引業法第35条に規定する重要事項の説明に関する次の記述のうち、正しいものはどれか。なお、説明の相手方は宅地建物取引業者ではないものとする。", "items": [{"m": "1", "t": "建物の貸借の媒介を行う場合、当該建物が都市計画法の準防火地域内にあり、建築基準法第61条第1項に基づく建物の構造に係る制限があるときは、その概要を説明しなければならない。", "ok": false, "r": [{"mark": "建物の貸借"}, {"del": "説明しなければならない", "to": "説明しなくてよい"}]}, {"m": "2", "t": "マンションの分譲を行う場合、建物の区分所有等に関する法律第2条第3項に規定する専用部分の用途その他の利用の制限に関する規約の定めが案の段階であるときは、説明する必要はない。", "ok": false, "r": [{"mark": "案の段階"}, {"del": "説明する必要はない", "to": "説明する必要がある"}]}, {"m": "3", "t": "建物の貸借の媒介を行う場合、借賃以外に授受される金銭の額、授受の目的及び保管方法を説明しなければならない。", "ok": false, "r": [{"mark": "保管方法"}]}, {"m": "4", "t": "鉄筋コンクリート造の既存の共同住宅の販売を行う場合、宅地建物取引業法第34条の2第1項第4号に規定する建物状況調査を1年6か月前に実施したときは、建物状況調査を実施したこと、その結果の概要について説明しなくてはならない。", "ok": true, "r": [{"mark": "1年6か月前"}]}], "buttons": ["1", "2", "3", "4"], "answer": 4, "lines": [{"m": "1", "t": "誤り。建物の貸借で説明する法令上の制限は新住宅市街地開発法等の3つだけ（令3条3項）。建築基準法61条は入らない。"}, {"m": "2", "t": "誤り。規約の定めは「案」を含み、案の段階でも説明する（施行規則16条の2第2号括弧書）。"}, {"m": "3", "t": "誤り。説明するのは授受される金銭の額と目的で、保管方法は入らない（法35条1項7号）。"}, {"m": "4", "t": "正しい。RC造等の共同住宅等は、建物状況調査が実施後2年以内なら対象で、1年6か月前なら対象（施行規則16条の2の2）。"}], "onair": "第6回と第7回で解ける（肢2が第7回＝規約は案を含む。肢1・3・4は第6回）"};
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
  var KAKO_EP = '7';
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
