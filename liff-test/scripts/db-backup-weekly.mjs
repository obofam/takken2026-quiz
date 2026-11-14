// 記録の控えを、日付のフォルダに書き出す（週1回の定期タスクから呼ぶ。手でも動かせる）。
// 無料枠のデータベースには自動の控えが無いので、手元に持つ。中身は db-dump.mjs と同じ（表ごとの JSON）。
// 使い方：node scripts/db-backup-weekly.mjs            … 既定の置き場（このリポジトリの外。宅建\_記録の控え_2027）へ
//         node scripts/db-backup-weekly.mjs <置き場>   … 置き場を変える（テスト用）
// やること：(1) 今日（日本時間）の日付のフォルダへ書き出す (2) 件数を数え直して確かめる (3) 前回より大きく減った表があれば知らせる
//           (4) 新しい順に KEEP 個だけ残し、それより古い日付のフォルダを消す（預かった記録を必要以上に持たない）
// 置き場は公開リポジトリの外。個人の記録が入るので、コミットしない・共有しない。年末に記録を消すときは、この控えも消す。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KEEP = 8; /* 残す数（週1回で約2か月ぶん） */
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2] || path.join(here, '..', '..', '..', '_記録の控え_2027'));
const DATED = /^\d{4}-\d{2}-\d{2}$/;
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date()); /* YYYY-MM-DD */
const fail = (msg) => { console.error('控えの書き出し：失敗　' + msg); process.exit(1); };

/* リポジトリの中には置かない（公開リポジトリに個人の記録を入れない） */
const repo = path.resolve(here, '..', '..');
if ((root + path.sep).startsWith(repo + path.sep)) fail('置き場がリポジトリの中です');

fs.mkdirSync(root, { recursive: true });
const dated = () => fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory() && DATED.test(d.name)).map(d => d.name).sort();
const prevName = dated().filter(n => n < today).pop();
const out = path.join(root, today);

/* (1) 書き出す。途中で失敗した半端なフォルダを控えと見まちがえないよう、いったん仮の名前に書く */
const tmp = out + '.tmp';
fs.rmSync(tmp, { recursive: true, force: true });
const r = spawnSync(process.execPath, [path.join(here, 'db-dump.mjs'), tmp], { encoding: 'utf8' });
if (r.status !== 0) { fs.rmSync(tmp, { recursive: true, force: true }); fail('db-dump が終わりませんでした'); }

/* (2) 数え直す */
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
let summary;
try { summary = readJson(path.join(tmp, '_summary.json')).tables; } catch { fs.rmSync(tmp, { recursive: true, force: true }); fail('まとめのファイルが読めません'); }
const names = Object.keys(summary);
if (names.length < 2) { fs.rmSync(tmp, { recursive: true, force: true }); fail('表が見つかりません'); }
const bad = [];
for (const t of names) {
  const n = summary[t];
  if (typeof n !== 'number') { bad.push(t + '（取れなかった）'); continue; }
  try { const rows = readJson(path.join(tmp, t + '.json')); if (!Array.isArray(rows) || rows.length !== n) bad.push(t + '（件数が合わない）'); } catch { bad.push(t + '（読めない）'); }
}
if (bad.length) { fs.rmSync(tmp, { recursive: true, force: true }); fail(bad.join('・')); }
fs.rmSync(out, { recursive: true, force: true }); /* 同じ日に2回動かしたら、新しいほうに置きかえる */
fs.renameSync(tmp, out);

/* (3) 前回と比べる（半分より少なくなった表。消した覚えがなければ、データベースを見る合図） */
const warn = [];
if (prevName) {
  try {
    const prev = readJson(path.join(root, prevName, '_summary.json')).tables;
    for (const t of names) { const a = prev[t], b = summary[t]; if (typeof a === 'number' && a >= 10 && b < a / 2) warn.push(t + ' ' + a + '→' + b); }
    for (const t of Object.keys(prev)) if (!(t in summary)) warn.push(t + '（表が無くなった）');
  } catch { /* 前回が読めなくても、今回の控えは有効 */ }
}

/* (4) 古い控えを消す。日付の名前のフォルダだけ。今回の書き出しが確かめられたあとにだけ行う */
const all = dated();
const drop = all.slice(0, Math.max(0, all.length - KEEP));
for (const n of drop) fs.rmSync(path.join(root, n), { recursive: true, force: true });

const total = names.reduce((s, t) => s + summary[t], 0);
console.log('控えの書き出し：成功　' + today + '　表 ' + names.length + '・行 ' + total + '（' + names.map(t => t + ' ' + summary[t]).join('、') + '）');
console.log('残している控え：' + dated().join('、') + (drop.length ? '　消した古い控え：' + drop.join('、') : ''));
if (warn.length) { console.log('注意：前回（' + prevName + '）より大きく減った表があります　' + warn.join('、')); process.exitCode = 2; }
