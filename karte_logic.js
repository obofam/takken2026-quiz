/*
 * karte_logic.js
 * 模試ふりかえりカルテの診断ロジック（純粋関数のみ・DOM非依存）。
 *
 * 正本: C:\Claude\宅建\6_有料PDF\最後まで伴走_商品設計\模試カルテ\karte.py
 * このファイルはkarte.pyの判定ルールをJavaScriptに忠実に移植したもの。
 * ブラウザでは window.KarteLogic として、Node.js では module.exports として使える。
 */
(function (root, factory) {
  "use strict";
  var mod = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = mod;
  }
  if (root) {
    root.KarteLogic = mod;
  }
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this), function () {
  "use strict";

  // ----------------------------------------------------------------------
  // 定数（karte.pyのFIELD_RANGES / HARD_TYPE_ADVICE等と同一）
  // ----------------------------------------------------------------------

  var FIELD_RANGES = [
    ["権利", 1, 14],
    ["法令", 15, 22],
    ["税", 23, 25],
    ["業法", 26, 45],
    ["免除", 46, 50]
  ];
  var FIELD_ORDER = FIELD_RANGES.map(function (r) { return r[0]; });

  var DIFFICULTY_ORDER = { A: 0, B: 1, C: 2 };

  var HARD_TYPE_ADVICE = {
    "判決文読解": "判決文の結論部だけ先に読んで、各肢を結論と照らす",
    "細かい知識": "深追いしない。Aランクの取りこぼしを優先",
    "定番の取り違え": "直前対策PDFの横断ひっかけペア表で対になる制度を並べて覚える",
    "数字": "数字だけを抜き出した一覧を作る",
    "個数問題": "1肢ずつ○×をつけてから数える。1肢でも迷えば捨てて次へ",
    "複合事例": "登場人物と権利関係を余白に図にしてから肢を読む",
    "統計": "数値の暗記でなく増減の方向だけ押さえる",
    "計算": "式を1つに決めて手で書く"
  };

  var FORM_CORRECT = "正しいもの";
  var FORM_WRONG = "誤っているものはどれか";
  var PASS_LINE_NOTE = "合格ライン目安は50問で36点（免除者は45問で31点）";

  // ----------------------------------------------------------------------
  // 基本ユーティリティ
  // ----------------------------------------------------------------------

  function getFieldByNo(no) {
    for (var i = 0; i < FIELD_RANGES.length; i++) {
      var f = FIELD_RANGES[i][0];
      var lo = FIELD_RANGES[i][1];
      var hi = FIELD_RANGES[i][2];
      if (no >= lo && no <= hi) return f;
    }
    return null;
  }

  function applicableFields(exempt) {
    return exempt ? FIELD_ORDER.filter(function (f) { return f !== "免除"; }) : FIELD_ORDER.slice();
  }

  function maxScoreFor(exempt) {
    return exempt ? 45 : 50;
  }

  // 全角数字 → 半角数字
  function zenkakuToHankaku(str) {
    return String(str).replace(/[０-９]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
    });
  }

  // ----------------------------------------------------------------------
  // 入力パース（自由記述 → 問番号配列 / chosenマップ）
  // ----------------------------------------------------------------------

  // 区切り文字: 半角/全角カンマ、読点「、」、句点「。」、ピリオド、空白（改行含む）
  var WRONG_SPLIT_RE = /[,\uFF0C\u3001\u3002.\s]+/;

  function parseWrongNumbersInput(raw) {
    var result = { values: [], outOfRange: [], duplicates: [], invalid: [] };
    if (raw === null || raw === undefined) return result;
    var normalized = zenkakuToHankaku(raw).trim();
    if (!normalized) return result;
    var parts = normalized.split(WRONG_SPLIT_RE).filter(function (s) { return s.length > 0; });
    var seen = {};
    parts.forEach(function (part) {
      if (!/^\d+$/.test(part)) {
        result.invalid.push(part);
        return;
      }
      var n = parseInt(part, 10);
      if (n < 1 || n > 50) {
        result.outOfRange.push(n);
        return;
      }
      if (seen[n]) {
        result.duplicates.push(n);
        return;
      }
      seen[n] = true;
      result.values.push(n);
    });
    result.values.sort(function (a, b) { return a - b; });
    return result;
  }

  // "3-2, 17-4" -> { map: {3:2, 17:4}, invalid: [] }
  function parseChosenInput(raw) {
    var result = { map: {}, invalid: [] };
    if (raw === null || raw === undefined) return result;
    var normalized = zenkakuToHankaku(raw).trim();
    if (!normalized) return result;
    var parts = normalized.split(",").map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 0; });
    parts.forEach(function (part) {
      var m = part.match(/^(\d+)\s*-\s*(\d+)$/);
      if (!m) {
        result.invalid.push(part);
        return;
      }
      var no = parseInt(m[1], 10);
      var choice = parseInt(m[2], 10);
      result.map[no] = choice;
    });
    return result;
  }

  // ----------------------------------------------------------------------
  // 分野別集計
  // ----------------------------------------------------------------------

  function buildWrongByField(wrongNos, exempt) {
    var byField = {};
    FIELD_ORDER.forEach(function (f) { byField[f] = []; });
    wrongNos.forEach(function (no) {
      var f = getFieldByNo(no);
      if (!f) return;
      if (exempt && f === "免除") return;
      byField[f].push(no);
    });
    FIELD_ORDER.forEach(function (f) { byField[f].sort(function (a, b) { return a - b; }); });
    return byField;
  }

  function buildFieldTotals(questions) {
    var totals = {};
    FIELD_ORDER.forEach(function (f) { totals[f] = 0; });
    questions.forEach(function (q) {
      var f = getFieldByNo(q.no);
      if (f) totals[f] += 1;
    });
    return totals;
  }

  function computeFormDenominators(questions) {
    var correctFormTotal = 0, wrongFormTotal = 0;
    questions.forEach(function (q) {
      if (q.form === FORM_CORRECT) correctFormTotal += 1;
      else if (q.form === FORM_WRONG) wrongFormTotal += 1;
    });
    return { correctFormTotal: correctFormTotal, wrongFormTotal: wrongFormTotal };
  }

  // 件数の多い順（同数は先に現れた順を優先＝安定ソート。CounterのCPython実装と同じ挙動）
  function topByCountStable(entries) {
    // entries: [{key, count}] 出現順で渡すこと
    var indexed = entries.map(function (e, i) { return { e: e, i: i }; });
    indexed.sort(function (a, b) {
      if (b.e.count !== a.e.count) return b.e.count - a.e.count;
      return a.i - b.i;
    });
    return indexed.map(function (x) { return x.e; });
  }

  // ----------------------------------------------------------------------
  // メイン診断ロジック
  // ----------------------------------------------------------------------

  /**
   * @param {Object} opts
   * @param {Object} opts.yearData - {label, year, exam, questions:[...]}
   * @param {Array} opts.episodes - [{ep, date, field, title, law}]
   * @param {boolean} opts.exempt - 5問免除
   * @param {number[]} opts.wrongNos - 間違えた問番号（1-50、重複なし推奨。内部で範囲外/免除は無視）
   * @param {Object} [opts.chosenMap] - {問番号: 選んだ肢番号}
   * @returns {Object} result
   */
  function generateKarte(opts) {
    var yearData = opts.yearData;
    var episodes = opts.episodes || [];
    var exempt = !!opts.exempt;
    var wrongNos = (opts.wrongNos || []).slice().sort(function (a, b) { return a - b; });
    var chosenMap = opts.chosenMap || {};

    var questions = yearData.questions || [];
    var qByNo = {};
    questions.forEach(function (q) { qByNo[q.no] = q; });

    var applicable = applicableFields(exempt);
    var maxScore = maxScoreFor(exempt);
    var wrongByField = buildWrongByField(wrongNos, exempt);
    var fieldTotals = buildFieldTotals(questions);

    var totalWrong = 0;
    applicable.forEach(function (f) { totalWrong += wrongByField[f].length; });
    var totalScore = maxScore - totalWrong;

    // ---- 結果テーブル ----
    var fieldTable = applicable.map(function (f) {
      var total = fieldTotals[f] || 0;
      var wrongs = wrongByField[f];
      return {
        field: f,
        correct: total - wrongs.length,
        total: total,
        wrongNos: wrongs.slice()
      };
    });

    // ---- 落とした問題の分解 ----
    var allWrong = []; // [{no, field, q}] applicable順・問番号昇順
    applicable.forEach(function (f) {
      wrongByField[f].forEach(function (no) {
        var q = qByNo[no];
        if (q) allWrong.push({ no: no, field: f, q: q });
      });
    });

    var breakdown = allWrong.map(function (item) {
      var q = item.q;
      var chosen = null;
      if (Object.prototype.hasOwnProperty.call(chosenMap, item.no)) {
        var choiceN = chosenMap[item.no];
        var choiceObj = (q.choices || []).filter(function (c) { return c.n === choiceN; })[0];
        if (choiceObj) {
          chosen = { choice: choiceN, why: choiceObj.why || "", trap: choiceObj.trap || "" };
        }
      }
      return {
        no: item.no,
        field: item.field,
        topic: q.topic || "",
        difficulty: q.difficulty || "",
        hardType: q.hard_type || "",
        studyHint: q.study_hint || "",
        isA: q.difficulty === "A",
        chosen: chosen
      };
    });
    breakdown.sort(function (a, b) {
      var da = DIFFICULTY_ORDER.hasOwnProperty(a.difficulty) ? DIFFICULTY_ORDER[a.difficulty] : 9;
      var db = DIFFICULTY_ORDER.hasOwnProperty(b.difficulty) ? DIFFICULTY_ORDER[b.difficulty] : 9;
      if (da !== db) return da - db;
      return a.no - b.no;
    });

    // ---- 傾向 ----
    var trendBullets = [];
    if (allWrong.length > 0) {
      // a. Aランク取りこぼし
      var aWrongNos = allWrong.filter(function (x) { return x.q.difficulty === "A"; }).map(function (x) { return x.no; });
      if (aWrongNos.length > 0) {
        var n = aWrongNos.length;
        trendBullets.push("Aランクを" + n + "問落としています。全部取れれば+" + n + "点で" + (totalScore + n) + "点になります。");
      }

      // b. 同一topicで2問以上
      var topicCounter = {};
      var topicOrder = [];
      allWrong.forEach(function (x) {
        var t = x.q.topic || "";
        if (!t) return;
        if (!topicCounter.hasOwnProperty(t)) { topicCounter[t] = 0; topicOrder.push(t); }
        topicCounter[t] += 1;
      });
      var repeatTopics = topicOrder.filter(function (t) { return topicCounter[t] >= 2; });
      if (repeatTopics.length > 0) {
        trendBullets.push("「" + repeatTopics.join("」「") + "」で複数回落としています。同じ論点でのつまずきなので重点的に見直すと効きます。");
      }

      // c. hard_type最多
      var hardCounterMap = {};
      var hardOrder = [];
      allWrong.forEach(function (x) {
        var h = x.q.hard_type;
        if (!h) return;
        if (!hardCounterMap.hasOwnProperty(h)) { hardCounterMap[h] = 0; hardOrder.push(h); }
        hardCounterMap[h] += 1;
      });
      if (hardOrder.length > 0) {
        var hardEntries = hardOrder.map(function (h) { return { key: h, count: hardCounterMap[h] }; });
        var topHardEntry = topByCountStable(hardEntries)[0];
        var advice = HARD_TYPE_ADVICE.hasOwnProperty(topHardEntry.key) ? HARD_TYPE_ADVICE[topHardEntry.key] : "対策を個別に検討しましょう";
        trendBullets.push("一番多い失点パターンは「" + topHardEntry.key + "」（" + topHardEntry.count + "問）です。" + advice + "。");
      }

      // d. form別分析（正しいもの/誤っているものの失点率比較。分母は全問題から算出）
      var formDenoms = computeFormDenominators(questions);
      var wrongCountCorrectForm = allWrong.filter(function (x) { return x.q.form === FORM_CORRECT; }).length;
      var wrongCountWrongForm = allWrong.filter(function (x) { return x.q.form === FORM_WRONG; }).length;
      var rateCorrectForm = formDenoms.correctFormTotal ? (wrongCountCorrectForm / formDenoms.correctFormTotal) : 0;
      var rateWrongForm = formDenoms.wrongFormTotal ? (wrongCountWrongForm / formDenoms.wrongFormTotal) : 0;
      if (rateWrongForm > rateCorrectForm) {
        trendBullets.push(
          "「誤っているものはどれか」形式の失点率（" + wrongCountWrongForm + "/" + formDenoms.wrongFormTotal + "）が" +
          "「正しいもの」形式（" + wrongCountCorrectForm + "/" + formDenoms.correctFormTotal + "）より高く、" +
          "問い方の読み違え疑いがあります。"
        );
      }

      // e. Cランク安心材料
      var cWrongNos = allWrong.filter(function (x) { return x.q.difficulty === "C"; }).map(function (x) { return x.no; });
      if (cWrongNos.length > 0) {
        trendBullets.push("問" + cWrongNos.join("、") + "はCランク（難問）です。ここは捨てていい問題なので気にしなくて大丈夫です。");
      }

      trendBullets = trendBullets.slice(0, 5);
    }

    // ---- 聞き直すならこの回（ep上位3） ----
    var epCounterMap = {};
    var epOrder = [];
    allWrong.forEach(function (x) {
      (x.q.ep || []).forEach(function (ep) {
        if (!epCounterMap.hasOwnProperty(ep)) { epCounterMap[ep] = 0; epOrder.push(ep); }
        epCounterMap[ep] += 1;
      });
    });
    var epEntries = epOrder.map(function (ep) { return { key: ep, count: epCounterMap[ep] }; });
    var topEpisodes = topByCountStable(epEntries).slice(0, 3).map(function (e) {
      var row = episodes.filter(function (r) { return r.ep === e.key; })[0];
      return { ep: e.key, count: e.count, title: row ? row.title : "(タイトル不明)" };
    });

    // ---- 残り期間の配点表 ----
    var scoringRows = [];
    var expectedTotal = 0;
    applicable.forEach(function (f) {
      var total = fieldTotals[f] || 0;
      var wrongs = wrongByField[f];
      var current = total - wrongs.length;
      var diffs = wrongs.map(function (no) { return qByNo[no] ? qByNo[no].difficulty : null; });
      var countA = diffs.filter(function (d) { return d === "A"; }).length;
      var countB = diffs.filter(function (d) { return d === "B"; }).length;
      var countC = diffs.filter(function (d) { return d === "C"; }).length;
      var recoveredA = countA;
      var recoveredB = Math.floor(countB / 2);
      var recoveredC = 0;
      var expected = current + recoveredA + recoveredB + recoveredC;
      expectedTotal += expected;
      scoringRows.push({
        field: f, total: total, current: current,
        recoveredA: recoveredA, countA: countA,
        recoveredB: recoveredB, countB: countB,
        recoveredC: recoveredC, countC: countC,
        expected: expected
      });
    });
    var scoringSummaryLine = "現在 " + totalScore + " → " +
      scoringRows.map(function (r) { return r.field + r.current + "→" + r.expected; }).join("・") +
      " ＝ " + expectedTotal + "点前後";

    // ---- 選んだ肢から見える間違い方 ----
    var trapSection = null;
    var chosenNos = Object.keys(chosenMap);
    if (chosenNos.length > 0) {
      var trapEntries = [];
      chosenNos.forEach(function (key) {
        var no = parseInt(key, 10);
        var choice = chosenMap[key];
        var q = qByNo[no];
        if (!q) return;
        var choiceObj = (q.choices || []).filter(function (c) { return c.n === choice; })[0];
        if (!choiceObj) return;
        trapEntries.push({ no: no, choice: choice, trap: choiceObj.trap || "", why: choiceObj.why || "" });
      });
      if (trapEntries.length > 0) {
        var trapCounterMap = {};
        var trapOrder = [];
        trapEntries.forEach(function (t) {
          if (!t.trap) return;
          if (!trapCounterMap.hasOwnProperty(t.trap)) { trapCounterMap[t.trap] = 0; trapOrder.push(t.trap); }
          trapCounterMap[t.trap] += 1;
        });
        if (trapOrder.length > 0) {
          var trapEntriesForSort = trapOrder.map(function (t) { return { key: t, count: trapCounterMap[t] }; });
          var topTrapEntry = topByCountStable(trapEntriesForSort)[0];
          var matchingLines = trapEntries.filter(function (t) { return t.trap === topTrapEntry.key; });
          trapSection = {
            topTrap: topTrapEntry.key,
            topCount: topTrapEntry.count,
            entries: matchingLines
          };
        }
      }
    }

    return {
      yearLabel: yearData.label,
      exempt: exempt,
      maxScore: maxScore,
      totalScore: totalScore,
      totalWrong: totalWrong,
      fieldTable: fieldTable,
      breakdown: breakdown,
      trendBullets: trendBullets,
      topEpisodes: topEpisodes,
      scoringRows: scoringRows,
      expectedTotal: expectedTotal,
      scoringSummaryLine: scoringSummaryLine,
      passLineNote: PASS_LINE_NOTE,
      trapSection: trapSection,
      hasRecords: allWrong.length > 0
    };
  }

  // ----------------------------------------------------------------------
  // プレーンテキスト（クリップボードコピー用）
  // ----------------------------------------------------------------------

  function renderKarteText(result) {
    var lines = [];
    lines.push("■ " + result.yearLabel + " ふりかえりカルテ");
    lines.push("");
    lines.push("【結果】総得点 " + result.totalScore + "/" + result.maxScore + "点");
    result.fieldTable.forEach(function (row) {
      var nosStr = row.wrongNos.length ? row.wrongNos.join("、") : "なし";
      lines.push("・" + row.field + " " + row.correct + "/" + row.total + "（落とした問: " + nosStr + "）");
    });
    lines.push("");

    lines.push("【落とした問題の分解】");
    if (!result.hasRecords) {
      lines.push("間違えた問番号が入力されていません。");
    } else {
      result.breakdown.forEach(function (row) {
        var mark = row.isA ? "★" : "";
        lines.push(mark + "問" + row.no + "（" + row.field + "／" + row.difficulty + "） " + row.topic +
          " ｜落とし方: " + row.hardType + " ｜次に取るには: " + row.studyHint);
        if (row.chosen) {
          lines.push("　→ 選んだ肢" + row.chosen.choice + ": " + row.chosen.why);
        }
      });
    }
    lines.push("");

    lines.push("【傾向】");
    if (result.trendBullets.length > 0) {
      result.trendBullets.forEach(function (b) { lines.push("・" + b); });
    } else {
      lines.push("特筆すべき傾向は見られませんでした。");
    }
    lines.push("");

    lines.push("【聞き直すならこの回】");
    if (result.topEpisodes.length > 0) {
      result.topEpisodes.forEach(function (e) {
        lines.push("・ep" + e.ep + ": " + e.title + "（" + e.count + "問）");
      });
    } else {
      lines.push("該当する回はありませんでした。");
    }
    lines.push("");

    lines.push("【残り期間の配点表（たたき台）】");
    result.scoringRows.forEach(function (r) {
      lines.push("・" + r.field + " " + r.current + "/" + r.total +
        " → +" + r.recoveredA + "(A) +" + r.recoveredB + "(B" + r.countB + "問中) +" + r.recoveredC + "(C" + r.countC + "問中) ＝ " + r.expected);
    });
    lines.push(result.scoringSummaryLine);
    lines.push("（" + result.passLineNote + "）");
    lines.push("");

    if (result.trapSection) {
      lines.push("【選んだ肢から見える間違い方】");
      lines.push("もっとも多かった間違え方は「" + result.trapSection.topTrap + "」です（" + result.trapSection.topCount + "件）。");
      result.trapSection.entries.forEach(function (e) {
        lines.push("・問" + e.no + " 肢" + e.choice + ": " + e.why);
      });
      lines.push("");
    }

    lines.push("※このカルテは自動生成のたたき台です。伴走参加の方はKeiのコメントと合わせて読んでください。");

    return lines.join("\n");
  }

  return {
    FIELD_RANGES: FIELD_RANGES,
    FIELD_ORDER: FIELD_ORDER,
    DIFFICULTY_ORDER: DIFFICULTY_ORDER,
    HARD_TYPE_ADVICE: HARD_TYPE_ADVICE,
    FORM_CORRECT: FORM_CORRECT,
    FORM_WRONG: FORM_WRONG,
    PASS_LINE_NOTE: PASS_LINE_NOTE,
    getFieldByNo: getFieldByNo,
    applicableFields: applicableFields,
    maxScoreFor: maxScoreFor,
    zenkakuToHankaku: zenkakuToHankaku,
    parseWrongNumbersInput: parseWrongNumbersInput,
    parseChosenInput: parseChosenInput,
    buildWrongByField: buildWrongByField,
    buildFieldTotals: buildFieldTotals,
    computeFormDenominators: computeFormDenominators,
    generateKarte: generateKarte,
    renderKarteText: renderKarteText
  };
});
