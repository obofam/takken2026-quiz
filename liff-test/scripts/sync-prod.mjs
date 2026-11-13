// 本番（リポジトリ直下の api/）用のコードを、この liff-test の正本から作る。手で直さない。
// 使い方：node scripts/sync-prod.mjs（作る） / node scripts/sync-prod.mjs --check（ずれがないか確かめる。tests/prod-api.test.cjs が使う）
// 正本は liff-test（lib/*.js・api/*.js・quiz-catalog.js）。本番側は ../api/_lib/（共通）と ../api/*.js（入口）で、写しを作る。
// 違いは require の相対パスだけ（入口は ../lib/ → ./_lib/、../quiz-catalog → ./_lib/quiz-catalog）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const test = path.resolve(here, '..'), prod = path.resolve(here, '..', '..');
const HEADER = '// 自動生成：liff-test/scripts/sync-prod.mjs。直さない（正本は liff-test 側）。\n';
export function expected() {
  const out = new Map();
  for (const f of ['server.js', 'stripe.js', 'products.js'])
    out.set(path.join(prod, 'api/_lib', f), HEADER + fs.readFileSync(path.join(test, 'lib', f), 'utf8'));
  out.set(path.join(prod, 'api/_lib/quiz-catalog.js'), HEADER + fs.readFileSync(path.join(test, 'quiz-catalog.js'), 'utf8'));
  for (const f of fs.readdirSync(path.join(test, 'api')).filter(n => n.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(test, 'api', f), 'utf8')
      .replaceAll("require('../lib/", "require('./_lib/").replaceAll("require('../quiz-catalog')", "require('./_lib/quiz-catalog')");
    out.set(path.join(prod, 'api', f), HEADER + src);
  }
  return out;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  let bad = 0;
  for (const [file, text] of expected()) {
    const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (cur === text) continue;
    if (check) { console.error('ずれ: ' + file); bad++; } else { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); console.log('write ' + file); }
  }
  if (bad) process.exit(1);
}
