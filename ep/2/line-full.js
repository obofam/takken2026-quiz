/* 第2回 過去問1選（LINEの中で開いた人だけに、ep/2/index.html が読み込む） */
(function () {
  'use strict';
  var esc = function (s) {
    return String(s).replace(/[&<>"]/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]; });
  };
  var KK = {"year": "令和6年", "no": 36, "revised": false, "stem": "営業保証金及び宅地建物取引業保証協会（以下この問において「保証協会」という。）に関する次の記述のうち、宅地建物取引業法の規定によれば、誤っているものはどれか。", "items": [{"m": "1", "t": "宅地建物取引業者で保証協会に加入しようとする者は、その加入しようとする日までに、政令で定める額の弁済業務保証金分担金を当該保証協会に納付しなければならない。", "r": [{"mark": "加入しようとする日までに"}]}, {"m": "2", "t": "保証協会の社員と宅地建物取引業に関し取引をした者（宅地建物取引業者に該当する者を除く。）は、その取引により生じた債権に関し、当該社員が社員ではないとしたならばその者が供託すべき営業保証金の額に相当する額の範囲内で弁済を受ける権利を有する。", "r": [{"mark": "営業保証金の額に相当する額"}]}, {"m": "3", "t": "宅地建物取引業者は、保証協会の社員の地位を失ったときは、保証協会が弁済業務保証金の還付請求権者に対し、一定期間内に宅地建物取引業法第64条の8第2項の規定による認証を受けるため申し出るべき旨の公告をした後でなければ、弁済業務保証金分担金の返還を受けることができない。", "r": [{"mark": "公告をした後でなければ"}]}, {"m": "4", "t": "宅地建物取引業者は、一部の事務所を廃止し営業保証金を取り戻そうとする場合には、供託した営業保証金につき還付を請求する権利を有する者に対し、公告をすることなく営業保証金を取り戻すことができる。", "r": [{"mark": "一部の事務所"}, {"del": "公告をすることなく", "to": "公告をして"}]}], "buttons": ["1", "2", "3", "4"], "answer": 4, "lines": [{"m": "1", "t": "正しい。分担金は加入しようとする日までに納付（法64条の9第1項1号）。"}, {"m": "2", "t": "正しい。還付の上限は、社員でなかったら供託すべき営業保証金の額に相当する範囲（法64条の8第1項）。"}, {"m": "3", "t": "正しい。社員の地位を失ったときは、6か月以上の公告の期間が過ぎてから分担金を返還（法64条の11第3項・4項）。"}, {"m": "4", "t": "誤り。営業保証金は、一部の事務所の廃止でも6か月以上の公告が必要（法30条1項後段・2項）。協会は、公告が要るのは社員の地位を失ったときだけ（法64条の11第1項・4項）で、一部の事務所の廃止では不要。ここが逆。"}], "onair": "第2回の前半（取戻しは6か月以上の公告）と後半（協会は地位を失ったときだけ公告・分担金は加入日まで・還付の上限）の対比で解ける"};
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
  var KAKO_EP = '2';
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
    function shuire(on) {
      Array.prototype.forEach.call(tspans, function (s, i) {
        var it = k.items[i];
        if (it.r) { s.innerHTML = on ? shuireHtml(it) : esc(it.t); }
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
