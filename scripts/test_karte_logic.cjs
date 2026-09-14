// karte_logic.js のテスト（Node.js / 標準ライブラリのみ）。
// karte.py（模試カルテの正本ロジック）が実データ（R6.json + M1_answers.csv）で
// 生成した out/M1_{name}_カルテ.md の数値を実行時にパースして突合する。
// 期待値はハードコードせず、CSV（wrong_list）とMarkdown（karte.py出力）から
// その都度導出する。
//
// 実行:
//   node scripts/test_karte_logic.cjs

const fs = require("fs");
const path = require("path");

const SITE_DIR = path.resolve(__dirname, "..");
const KARTE = require(path.join(SITE_DIR, "karte_logic.js"));

let checks = 0;
let failures = [];

function check(name, condition) {
  checks += 1;
  if (condition) {
    console.log("OK: " + name);
  } else {
    console.log("NG: " + name);
    failures.push(name);
  }
}

function assertEqual(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(name + `（実際=${JSON.stringify(actual)} / 期待=${JSON.stringify(expected)}）`, ok);
}

// ------------------------------------------------------------------
// 0. karte_data.js を読み込む（本番 R5/R6/R7 から生成済みのはず）
// ------------------------------------------------------------------
const dataPath = path.join(SITE_DIR, "karte_data.js");
check("karte_data.js が存在する", fs.existsSync(dataPath));
if (!fs.existsSync(dataPath)) {
  console.log("先に python scripts/build_karte_data.py を実行してください。");
  process.exit(1);
}

// window.KARTE_DATA を読み込むために簡易window環境を用意
const vm = require("vm");
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(dataPath, "utf-8"), sandbox);
const KARTE_DATA = sandbox.window.KARTE_DATA;
check("KARTE_DATA.years.R6 が存在する", !!(KARTE_DATA && KARTE_DATA.years && KARTE_DATA.years.R6));

const yearData = KARTE_DATA.years.R6;
const episodes = KARTE_DATA.episodes;

// ------------------------------------------------------------------
// 1. parseWrongNumbersInput / parseChosenInput 単体テスト
// ------------------------------------------------------------------
(function testParsers() {
  const r1 = KARTE.parseWrongNumbersInput("2, 3、5。7 8\n9,１０"); // 全角10も含む
  assertEqual("parseWrongNumbersInput: 各種区切り文字＋全角数字を解釈できる", r1.values, [2, 3, 5, 7, 8, 9, 10]);

  const r2 = KARTE.parseWrongNumbersInput("1,1,999,2");
  assertEqual("parseWrongNumbersInput: 重複はduplicatesへ", r2.values, [1, 2]);
  assertEqual("parseWrongNumbersInput: 重複の記録", r2.duplicates, [1]);
  assertEqual("parseWrongNumbersInput: 範囲外はoutOfRangeへ", r2.outOfRange, [999]);

  const r3 = KARTE.parseWrongNumbersInput("");
  assertEqual("parseWrongNumbersInput: 空文字は空配列", r3.values, []);

  const r4 = KARTE.parseWrongNumbersInput("abc, 3");
  assertEqual("parseWrongNumbersInput: 数値でない項目はinvalidへ、数値は拾う", r4.values, [3]);
  assertEqual("parseWrongNumbersInput: invalidの記録", r4.invalid, ["abc"]);

  // parse_chosen (karte.py) と同じ挙動
  assertEqual("parseChosenInput: 通常ケース", KARTE.parseChosenInput("3-2,17-4").map, { 3: 2, 17: 4 });
  assertEqual("parseChosenInput: 空文字", KARTE.parseChosenInput("").map, {});
  assertEqual("parseChosenInput: null", KARTE.parseChosenInput(null).map, {});
  assertEqual("parseChosenInput: 空白混じり", KARTE.parseChosenInput(" 3 - 2 , 17-4 ").map, { 3: 2, 17: 4 });
  assertEqual("parseChosenInput: 不正な項目は無視して例外を出さない", KARTE.parseChosenInput("abc,3-2").map, { 3: 2 });
})();

// ------------------------------------------------------------------
// 2. karte.py正本の実データ出力（Markdown）と突合するためのヘルパー
//    - wrong_list は M1_answers.csv から読み込む（ハードコードしない）
//    - 期待値は out/M1_{name}_カルテ.md をパースして得る（ハードコードしない）
// ------------------------------------------------------------------
const KARTE_PY_DIR = path.resolve(SITE_DIR, "..", "6_有料PDF", "最後まで伴走_商品設計", "模試カルテ");
const ANSWERS_CSV = path.join(KARTE_PY_DIR, "data", "M1_answers.csv");
const OUT_DIR = path.join(KARTE_PY_DIR, "out");

// 簡易CSVパーサ（ダブルクォート内のカンマ・""エスケープに対応）
function parseCsvLine(line) {
  const result = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuotes = false; }
      } else {
        cur += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { result.push(cur); cur = ""; }
      else cur += c;
    }
  }
  result.push(cur);
  return result;
}

function loadAnswersCsv(csvPath) {
  const raw = fs.readFileSync(csvPath, "utf-8").replace(/\r\n/g, "\n");
  const lines = raw.split("\n").filter((l) => l.length > 0);
  const header = parseCsvLine(lines[0]);
  const byName = {};
  lines.slice(1).forEach((line) => {
    const cols = parseCsvLine(line);
    const obj = {};
    header.forEach((h, i) => { obj[h] = cols[i] !== undefined ? cols[i] : ""; });
    byName[obj.name] = obj;
  });
  return byName;
}

function wrongListFromCsvRow(row) {
  if (!row || !row.wrong_list) return [];
  return row.wrong_list
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => parseInt(s, 10));
}

// karte.py出力Markdownの簡易パーサ。
// "## 見出し" から次の "## " 直前までの行を返す。
function extractSection(mdLines, headerText) {
  const startIdx = mdLines.findIndex((l) => l.trim() === headerText);
  if (startIdx === -1) return [];
  const rest = mdLines.slice(startIdx + 1);
  const endIdx = rest.findIndex((l) => l.trim().indexOf("## ") === 0);
  return endIdx === -1 ? rest : rest.slice(0, endIdx);
}

function parseKarteMd(mdPath) {
  const raw = fs.readFileSync(mdPath, "utf-8").replace(/\r\n/g, "\n");
  const lines = raw.split("\n");

  // 【結果】総得点・分野別テーブル
  const resultSection = extractSection(lines, "## 結果");
  const totalLine = resultSection.find((l) => l.indexOf("総得点:") === 0) || "";
  const totalMatch = totalLine.match(/総得点:\s*(\d+)\/(\d+)点/);
  const totalScore = totalMatch ? parseInt(totalMatch[1], 10) : null;
  const maxScore = totalMatch ? parseInt(totalMatch[2], 10) : null;

  const fieldTable = {};
  resultSection.forEach((l) => {
    const cells = l.split("|").map((s) => s.trim());
    if (cells.length < 4) return;
    const field = cells[1];
    const m = (cells[2] || "").match(/^(\d+)\/(\d+)$/);
    if (!field || !m) return;
    fieldTable[field] = { correct: parseInt(m[1], 10), total: parseInt(m[2], 10) };
  });

  // 【落とした問題の分解】難度列（A/B/C）を集計
  const breakdownSection = extractSection(lines, "## 落とした問題の分解");
  let countA = 0, countB = 0, countC = 0;
  breakdownSection.forEach((l) => {
    const cells = l.split("|").map((s) => s.trim());
    if (cells.length < 6) return;
    const diff = cells[4];
    if (diff === "A") countA += 1;
    else if (diff === "B") countB += 1;
    else if (diff === "C") countC += 1;
  });

  // 【傾向】
  const trendSection = extractSection(lines, "## 傾向");
  const trendBullets = trendSection
    .map((l) => l.trim())
    .filter((l) => l.indexOf("- ") === 0)
    .map((l) => l.slice(2));

  // 【聞き直すならこの回】
  const epSection = extractSection(lines, "## 聞き直すならこの回");
  const topEpisodes = [];
  epSection.forEach((l) => {
    const m = l.trim().match(/^-\s*ep(\d+):\s*.*（(\d+)問）$/);
    if (m) topEpisodes.push({ ep: parseInt(m[1], 10), count: parseInt(m[2], 10) });
  });

  // 【残り期間の配点表（たたき台）】見込み正解・サマリ行
  const scoringSection = extractSection(lines, "## 残り期間の配点表（たたき台）");
  const scoringExpected = {};
  let scoringSummaryLine = null;
  scoringSection.forEach((l) => {
    const cells = l.split("|").map((s) => s.trim());
    if (cells.length >= 7 && cells[1] && cells[1] !== "分野" && !/^-+$/.test(cells[1])) {
      const m = (cells[6] || "").match(/^(\d+)\/(\d+)$/);
      if (m) scoringExpected[cells[1]] = parseInt(m[1], 10);
    }
    if (l.trim().indexOf("現在 ") === 0) scoringSummaryLine = l.trim();
  });

  return {
    totalScore: totalScore,
    maxScore: maxScore,
    fieldTable: fieldTable,
    breakdown: { A: countA, B: countB, C: countC, total: countA + countB + countC },
    trendBullets: trendBullets,
    topEpisodes: topEpisodes,
    scoringExpected: scoringExpected,
    scoringSummaryLine: scoringSummaryLine
  };
}

// ------------------------------------------------------------------
// 3. Aya / まつもと / makiko の3名で karte.py 出力と突合
//    （R7はタグ付け作業中のため対象に含めない。R6のみ使用）
//
//    既知の差: makiko は業法で「自己申告13正解」と「記録された誤答6問
//    （＝正解14）」が食い違っている（M1_answers.csvのnote列に記載の
//    記録漏れの可能性）。karte.pyの分野別テーブル・総得点・配点表は
//    自己申告値を使うのに対し、Web版(karte_logic.js)は「出題数−記録
//    誤答数」で正解数を出す仕様のため、業法の行・総得点・配点表の
//    業法行とサマリ行だけ両者が一致しない。これはロジックのバグではなく
//    入力データ側の既知の食い違いなので、該当箇所だけ比較をスキップする。
// ------------------------------------------------------------------
const answersByName = loadAnswersCsv(ANSWERS_CSV);
const results = {};

["Aya", "まつもと", "makiko"].forEach((name) => {
  const row = answersByName[name];
  const wrongNos = wrongListFromCsvRow(row);
  const result = KARTE.generateKarte({
    yearData: yearData,
    episodes: episodes,
    exempt: false,
    wrongNos: wrongNos,
    chosenMap: {}
  });
  results[name] = result;

  const mdPath = path.join(OUT_DIR, `M1_${name}_カルテ.md`);
  const expected = parseKarteMd(mdPath);
  const isMakiko = name === "makiko";
  const skipFields = isMakiko ? ["業法"] : [];

  if (!isMakiko) {
    assertEqual(`${name}: 総得点がkarte.py出力と一致`, [result.totalScore, result.maxScore], [expected.totalScore, expected.maxScore]);
  } else {
    console.log(`SKIP: ${name}: 総得点（業法1問の自己申告と記録誤答数の食い違いによる既知の差のため比較スキップ）`);
  }

  const fieldMapActual = {};
  result.fieldTable.forEach((r) => { fieldMapActual[r.field] = { correct: r.correct, total: r.total }; });
  Object.keys(expected.fieldTable).forEach((field) => {
    if (skipFields.indexOf(field) !== -1) {
      console.log(`SKIP: ${name}: 分野別テーブル(${field})（既知の差のため比較スキップ）`);
      return;
    }
    assertEqual(`${name}: 分野別テーブル(${field})がkarte.py出力と一致`, fieldMapActual[field], expected.fieldTable[field]);
  });

  const countA = result.breakdown.filter((r) => r.difficulty === "A").length;
  const countB = result.breakdown.filter((r) => r.difficulty === "B").length;
  const countC = result.breakdown.filter((r) => r.difficulty === "C").length;
  assertEqual(`${name}: 落とした問題の難度別内訳(A/B/C)がkarte.py出力と一致`, [countA, countB, countC], [expected.breakdown.A, expected.breakdown.B, expected.breakdown.C]);
  assertEqual(`${name}: 落とした問題の総数がkarte.py出力と一致`, result.breakdown.length, expected.breakdown.total);

  if (!isMakiko) {
    assertEqual(`${name}: 傾向の文言がkarte.py出力と一致`, result.trendBullets, expected.trendBullets);
  } else {
    // makikoの「Aランクを○問落としています…△点になります」の△部分は
    // totalScoreに1問分の既知の差が波及するため、その数値だけ正規化して比較する。
    const normalize = (bullets) => bullets.map((b) => b.replace(/\d+点になります。$/, "N点になります。"));
    assertEqual(
      `${name}: 傾向の文言がkarte.py出力と一致（Aランク文の見込み点数は既知の差により正規化）`,
      normalize(result.trendBullets),
      normalize(expected.trendBullets)
    );
  }

  const topEpActual = result.topEpisodes.map((e) => ({ ep: e.ep, count: e.count }));
  assertEqual(`${name}: 聞き直すならこの回トップ3がkarte.py出力と一致`, topEpActual, expected.topEpisodes);

  const scoringActual = {};
  result.scoringRows.forEach((r) => { scoringActual[r.field] = r.expected; });
  Object.keys(expected.scoringExpected).forEach((field) => {
    if (skipFields.indexOf(field) !== -1) {
      console.log(`SKIP: ${name}: 配点表見込み正解(${field})（既知の差のため比較スキップ）`);
      return;
    }
    assertEqual(`${name}: 配点表見込み正解(${field})がkarte.py出力と一致`, scoringActual[field], expected.scoringExpected[field]);
  });

  if (!isMakiko) {
    check(`${name}: 配点表サマリ行の文言がkarte.py出力と一致`, result.scoringSummaryLine === expected.scoringSummaryLine);
  } else {
    console.log(`SKIP: ${name}: 配点表サマリ行（業法の既知の差が波及するため比較スキップ）`);
  }
});

const ayaResult = results["Aya"];
const ayaWrong = wrongListFromCsvRow(answersByName["Aya"]);

// ------------------------------------------------------------------
// 4. 免除フラグのテスト（Ayaのデータで免除ONにすると46-50が除外される）
// ------------------------------------------------------------------
(function testExempt() {
  const wrongWithExempt = ayaWrong; // 免除範囲(46-50)の問題も含むデータで検証
  const r = KARTE.generateKarte({
    yearData: yearData,
    episodes: episodes,
    exempt: true,
    wrongNos: wrongWithExempt,
    chosenMap: {}
  });
  check("免除ON: 満点は45", r.maxScore === 45);
  check("免除ON: 分野テーブルに免除が含まれない", !r.fieldTable.some((row) => row.field === "免除"));
  // 免除範囲(46-50)に含まれる誤答は集計対象から除外される
  const exemptWrongCount = ayaWrong.filter((no) => no >= 46 && no <= 50).length;
  const nonExemptWrongCount = ayaWrong.length - exemptWrongCount;
  assertEqual("免除ON: 総得点は免除範囲を除いた誤答数から算出される", r.totalScore, 45 - nonExemptWrongCount);
})();

// ------------------------------------------------------------------
// 5. chosen（選んだ肢）のテスト
//    trap値は実データ(karte_data.js)から動的に取得し、ハードコードしない。
// ------------------------------------------------------------------
(function testChosen() {
  const q2 = (yearData.questions || []).filter((q) => q.no === 2)[0];
  const q2choice2 = q2 ? (q2.choices || []).filter((c) => c.n === 2)[0] : null;
  const expectedTrap = q2choice2 ? (q2choice2.trap || "") : null;

  const r = KARTE.generateKarte({
    yearData: yearData,
    episodes: episodes,
    exempt: false,
    wrongNos: [2],
    chosenMap: { 2: 2 }
  });
  check("chosen: trapSectionが生成される", !!r.trapSection);
  if (r.trapSection) {
    check(`chosen: topTrapが問2肢2のtrap(実データ=${expectedTrap})と一致`, r.trapSection.topTrap === expectedTrap);
    check("chosen: 該当行に問2が含まれる", r.trapSection.entries.some((e) => e.no === 2 && e.choice === 2));
  }
  // breakdown側にもchosen情報が展開用に付与されていること
  const row2 = r.breakdown.find((b) => b.no === 2);
  check("chosen: breakdown行にも選んだ肢の情報が付与される", !!(row2 && row2.chosen && row2.chosen.choice === 2));
})();

// ------------------------------------------------------------------
// 6. renderKarteText がエラーなく文字列を返すこと（クリップボードコピー用）
// ------------------------------------------------------------------
(function testRenderText() {
  const text = KARTE.renderKarteText(ayaResult);
  check("renderKarteText: 文字列が返る", typeof text === "string" && text.length > 0);
  check("renderKarteText: 総得点の行を含む", text.indexOf(`総得点 ${ayaResult.totalScore}/${ayaResult.maxScore}点`) !== -1);
  check("renderKarteText: 末尾注記を含む", text.indexOf("このカルテは自動生成のたたき台です") !== -1);
})();

// ------------------------------------------------------------------
// 7. 入力空・記録なしのケース
// ------------------------------------------------------------------
(function testEmpty() {
  const r = KARTE.generateKarte({
    yearData: yearData,
    episodes: episodes,
    exempt: false,
    wrongNos: [],
    chosenMap: {}
  });
  check("空入力: hasRecordsがfalse", r.hasRecords === false);
  check("空入力: 総得点は満点(50)", r.totalScore === 50);
  check("空入力: 傾向は空配列", r.trendBullets.length === 0);
})();

// ------------------------------------------------------------------
// 結果表示
// ------------------------------------------------------------------
console.log("");
console.log(`合計 ${checks} 件中 ${checks - failures.length} 件成功、${failures.length} 件失敗`);
if (failures.length > 0) {
  console.log("失敗した項目:");
  failures.forEach((f) => console.log("  - " + f));
  process.exit(1);
} else {
  console.log("すべてのテストにパスしました。");
}
