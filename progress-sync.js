// 自動生成：liff-test/scripts/sync-prod.mjs。直さない（正本は liff-test 側）。
'use strict';
/* 記録の同期（聴いた・復習・3問済・過去問1選の結果・○×1日1問の記録）。window.TakkenProgress。
   ログインしている人だけ、記録をサーバー（/api/progress）にも置く。ログインしていない人の動きは、今までと同じ（端末の localStorage だけ）。
   端末の記録は、これまでどおり画面側が書く。ここは「ログインの確認」「はじめての端末の合わせ込み」「変更の送信」「送れなかった変更の送り直し」だけ。
   例外はすべて握りつぶす（画面の動きを止めない）。 */
(function (root) {
  var K_L = 'takken2027-listened', K_D = 'takken2027-done', K_K = 'takken2027-kako', K_O = 'takken2027-ichimon', K_Q = 'takken2027-progress-queue', K_S = 'takken2027-synced-', K_H = 'takken2027-login-hint';
  var KEY = /^[A-Za-z0-9-]{1,40}$/, KEY_OX = /^o[0-9]{3}$/;
  function keyOk(kind, k) { return kind === 'ox' ? KEY_OX.test(k) : KEY.test(k); }
  /* ox の1件：{r: [0|1 を1〜10件・古い順], t: 'YYYY-MM-DD'}。ほかのフィールドは付けない（サーバーの検査に落ちるため） */
  function oxOk(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) { return false; }
    var ks = Object.keys(v); if (ks.length !== 2 || ks.indexOf('r') < 0 || ks.indexOf('t') < 0) { return false; }
    if (!Array.isArray(v.r) || v.r.length < 1 || v.r.length > 10) { return false; }
    for (var i = 0; i < v.r.length; i++) { if (v.r[i] !== 0 && v.r[i] !== 1) { return false; } }
    return typeof v.t === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v.t);
  }
  var state = 'local', provider = null, suffix = '', started = null, ready = false, onChange = null, early = [], chain = Promise.resolve();

  function lget(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lset(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function valid(kind, v) { if (kind === 'ox') { return oxOk(v); } return (kind === 'listened' || kind === 'kako') ? (v === 1 || v === 2) : (kind === 'done' ? v === true : false); }
  /* 端末の記録を読む。古い形（配列）も受ける。サーバーの検査に落ちるキー・値は送らない（落ちると全部が止まるため）。 */
  function readMap(storageKey, kind) {
    var out = {}, n = 0, v;
    try {
      v = JSON.parse(lget(storageKey) || '{}');
      if (kind !== 'ox' && Array.isArray(v)) { var o = {}; v.forEach(function (k) { o[k] = kind === 'listened' ? 1 : true; }); v = o; }
      if (v && typeof v === 'object') {
        Object.keys(v).forEach(function (k) {
          var x = v[k]; if (kind === 'done' && x === 1) { x = true; }
          if (n < 400 && keyOk(kind, k) && valid(kind, x)) { out[k] = x; n++; }
        });
      }
    } catch (_) {}
    return out;
  }
  function loadQueue() { try { var q = JSON.parse(lget(K_Q) || '[]'); return Array.isArray(q) ? q : []; } catch (_) { return []; } }
  function saveQueue(q) { lset(K_Q, JSON.stringify(q.slice(-400))); }
  function enqueue(kind, key, value) {
    var q = loadQueue().filter(function (i) { return !(i && i.u === suffix && i.kind === kind && i.key === key); });
    q.push({ u: suffix, kind: kind, key: key, value: value }); saveQueue(q);
  }
  function timeout(p, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
      Promise.resolve(p).then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }
  function api(url, method, body) {
    var opt = { method: method, credentials: 'same-origin' };
    if (body !== undefined) { opt.headers = { 'Content-Type': 'application/json' }; opt.body = JSON.stringify(body); }
    return timeout(fetch(url, opt), 15000).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, json: j || {} }; });
    });
  }
  /* 送り直しの待ち行列。この利用者の分を古い順に送る。成功した分と、検査に落ちた（400）分は消す。通信の失敗が出たら止める。 */
  function flush() {
    var mine = loadQueue().filter(function (i) { return i && i.u === suffix; });
    function next(i) {
      if (i >= mine.length) { return Promise.resolve(true); }
      var it = mine[i];
      return api('/api/progress', 'POST', { kind: it.kind, key: it.key, value: it.value }).then(function (r) {
        /* kako・ox の 400 は、サーバーがまだ知らないとき（画面の更新が先に届いたとき）に出る。捨てずに残して、次の機会に送る。 */
        if (r.status === 400 && (it.kind === 'kako' || it.kind === 'ox')) { return next(i + 1); }
        if (r.ok || r.status === 400) {
          saveQueue(loadQueue().filter(function (q) { return !(q && q.u === it.u && q.kind === it.kind && q.key === it.key && JSON.stringify(q.value) === JSON.stringify(it.value)); }));
          return next(i + 1);
        }
        return false;
      }, function () { return false; });
    }
    return next(0);
  }

  /* (a) LINEの中でログイン済みなら、IDトークンでセッションを作る。LINEの外で LINE ログインの画面へは飛ばさない。 */
  function viaLiff(opts) {
    var L = root.liff; if (!L) { return Promise.resolve(null); }
    return timeout(Promise.resolve().then(function () {
      if (!opts.sessionReady && opts.liffId) { return L.init({ liffId: opts.liffId }); }
    }).then(function () {
      if (!(L.isInClient() && L.isLoggedIn())) { return null; }
      if (opts.sessionReady) { return api('/api/session', 'GET').then(function (r) { return r.ok ? { storageKey: r.json.storageKey } : null; }); }
      var token = L.getIDToken(); if (!token) { return null; }
      return api('/api/session', 'POST', { idToken: token }).then(function (r) { return r.ok ? { storageKey: r.json.storageKey } : null; });
    }), 8000).then(function (r) { return r ? { provider: 'line', storageKey: r.storageKey } : null; }, function () { return null; });
  }
  /* (b) メールでログインした人：セッションがあれば 200 */
  function viaCookie(opts) {
    /* cookieHint を渡したページ（本番）：このブラウザでログインした印（auth-callback / LINE のログイン成功で付く）がなければ、問い合わせない。
       ログインしていない人に 401 を出させない（ブラウザのコンソールに赤い行が出るため）。 */
    if (opts && opts.cookieHint && !lget(K_H)) { return Promise.resolve(null); }
    return api('/api/session', 'GET').then(function (r) {
      if (!r.ok) { if (opts && opts.cookieHint && r.status === 401) { try { localStorage.removeItem(K_H); } catch (_) {} } return null; }
      var p = r.json.providers;
      return { provider: (Array.isArray(p) && p.length === 1 && p[0] === 'line') ? 'line' : 'email', storageKey: r.json.storageKey };
    }, function () { return null; });
  }
  function applyEarly(maps) {
    early.forEach(function (e) {
      var m = maps[e.kind]; if (!m) { return; }
      if (e.value === null || e.value === undefined) { delete m[e.key]; } else { m[e.key] = e.value; }
    });
  }
  function run(opts) {
    return viaLiff(opts).then(function (who) { return who || viaCookie(opts); }).then(function (who) {
      if (!who || typeof who.storageKey !== 'string' || !who.storageKey) { return; } /* (c) 端末だけのまま */
      provider = who.provider; suffix = who.storageKey.slice(-16);
      if (opts.cookieHint) { lset(K_H, '1'); }
      var mark = K_S + suffix;
      var step = Promise.resolve(true);
      if (!lget(mark)) {
        step = api('/api/progress', 'POST', { merge: true, listened: readMap(K_L, 'listened'), done: readMap(K_D, 'done'), kako: readMap(K_K, 'kako'), ox: readMap(K_O, 'ox') }).then(function (r) {
          if (!r.ok) { return false; }
          lset(mark, '1'); return true;
        });
      }
      return step.then(function (ok) { return ok ? flush() : false; }).then(function (ok) {
        if (!ok) { state = 'error'; return; }
        return api('/api/progress', 'GET').then(function (r) {
          if (!r.ok) { state = 'error'; return; }
          var maps = { listened: r.json.listened || {}, done: r.json.done || {} };
          /* 古いサーバー（kako を返さない）のときは、端末の kako にさわらない */
          if (r.json.kako && typeof r.json.kako === 'object' && !Array.isArray(r.json.kako)) { maps.kako = r.json.kako; }
          /* ox：同じキーは t が新しいほうを端末に残す（同じ t ならサーバーの値）。端末のほうが新しいキーはサーバーへ送り直す。古いサーバー（ox を返さない）のときは端末の ox にさわらない */
          var resend = [];
          if (r.json.ox && typeof r.json.ox === 'object' && !Array.isArray(r.json.ox)) {
            var dev = readMap(K_O, 'ox'); maps.ox = {};
            Object.keys(r.json.ox).forEach(function (k) { if (keyOk('ox', k) && oxOk(r.json.ox[k])) { maps.ox[k] = r.json.ox[k]; } });
            Object.keys(dev).forEach(function (k) {
              if (!maps.ox[k] || dev[k].t > maps.ox[k].t) { maps.ox[k] = dev[k]; resend.push(k); }
            });
          }
          applyEarly(maps);
          lset(K_L, JSON.stringify(maps.listened)); lset(K_D, JSON.stringify(maps.done));
          if (maps.kako) { lset(K_K, JSON.stringify(maps.kako)); }
          if (maps.ox) { lset(K_O, JSON.stringify(maps.ox)); }
          state = 'synced';
          var pending = early; early = []; ready = true;
          resend.forEach(function (k) { enqueue('ox', k, maps.ox[k]); });
          pending.forEach(function (e) { enqueue(e.kind, e.key, e.value); });
          if (typeof onChange === 'function') { try { onChange(); } catch (_) {} }
          if (pending.length || resend.length) { return flush(); }
        });
      });
    });
  }
  function init(opts) {
    opts = opts || {};
    if (started) { return started; }
    if (typeof opts.onChange === 'function') { onChange = opts.onChange; }
    started = Promise.resolve().then(function () { return run(opts); }).catch(function () { state = provider ? 'error' : 'local'; }).then(function () {
      if (provider && early.length) { early.forEach(function (e) { enqueue(e.kind, e.key, e.value); }); } /* 確認の途中で失敗：次の init で送り直す */
      early = []; ready = true;
    });
    return started;
  }
  /* 画面が記録を変えたときに呼ぶ（端末の localStorage は画面側が先に書く）。value が null ならそのキーを消す。 */
  function set(kind, key, value) {
    try {
      if (kind !== 'listened' && kind !== 'done' && kind !== 'kako' && kind !== 'ox') { return; }
      key = String(key); if (value === undefined) { value = null; }
      if (!keyOk(kind, key) || (value !== null && !valid(kind, value))) { return; }
      if (!started) { return; }
      if (!ready) { early.push({ kind: kind, key: key, value: value }); return; } /* まだ確認中：確認が終わってから送る */
      if (!provider) { return; }
      enqueue(kind, key, value);
      chain = chain.then(flush).then(function (ok) { state = ok ? 'synced' : 'error'; }).catch(function () { state = 'error'; });
    } catch (_) {}
  }
  root.TakkenProgress = { init: init, set: set, state: function () { return state; }, provider: function () { return provider; } };
})(typeof window !== 'undefined' ? window : this);
