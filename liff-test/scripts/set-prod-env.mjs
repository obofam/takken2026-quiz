// 本番（リポジトリ直下の Vercel プロジェクト）の環境変数を入れる。秘密でない値と、ここで作る SESSION_SECRET だけ。
// Supabase の住所と鍵は apply-supabase-env.mjs --root が入れる。値は画面に出さない。
// 使い方：node scripts/set-prod-env.mjs           … まだ無いものだけ入れる（SESSION_SECRET は作り直さない）
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const run = (args, input) => spawnSync('vercel', args, { cwd: rootDir, shell: true, encoding: 'utf8', input });
const ls = run(['env', 'ls', 'production']);
const have = new Set((ls.stdout + ls.stderr).split(/\r?\n/).map(l => l.trim().split(/\s+/)[0]).filter(n => /^[A-Z][A-Z0-9_]+$/.test(n)));
console.log('いま入っている名前: ' + ([...have].sort().join(', ') || '（なし）'));

const plain = {
  LINE_CHANNEL_ID: '2012583516',
  ALLOWED_HOSTS: 'takken.mimiobo.com',
  OPEN_LOGIN: '1',
  STORAGE_PREFIX: 'mimiobo-v1-',
};
function set(name, value, { overwrite }) {
  if (have.has(name) && !overwrite) { console.log('  ' + name + ': すでにある（そのまま）'); return; }
  if (have.has(name)) run(['env', 'rm', name, 'production', '--yes']);
  const r = run(['env', 'add', name, 'production'], value);
  console.log('  ' + name + ': ' + (r.status === 0 ? '入れた' : '失敗'));
  if (r.status !== 0) process.exitCode = 1;
}
for (const [k, v] of Object.entries(plain)) set(k, v, { overwrite: true });
// セッションの署名用の秘密。本番専用に新しく作る。作り直すと全員がログアウトになるので、あれば触らない。
set('SESSION_SECRET', randomBytes(48).toString('base64url'), { overwrite: false });
console.log('終わり。反映にはデプロイが要ります');
