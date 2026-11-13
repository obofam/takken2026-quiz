// 新しい Supabase の住所と鍵を、(1) liff-test/.env.local と (2) Vercel の環境変数（production）に入れる。
// 値は鍵の置き場のファイルから読み、画面には出さない（長さと先頭の種類だけ表示）。
// 使い方：node scripts/apply-supabase-env.mjs            … 試し用（このフォルダの Vercel プロジェクト）
//         node scripts/apply-supabase-env.mjs --root     … 本番（リポジトリ直下の Vercel プロジェクト）にも同じ2つを入れる
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const liffDir = path.resolve(here, '..');
const rootDir = path.resolve(liffDir, '..');
const src = path.join('C:\\Claude', '_secrets', 'supabase_takken_honban.env');
if (!fs.existsSync(src)) { console.error('鍵のファイルが見つかりません（supabase_takken_honban.env）'); process.exit(1); }
const kv = {};
for (const l of fs.readFileSync(src, 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*(\w+)\s*=\s*(.*?)\s*$/); if (m) kv[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
const url = kv.SUPABASE_URL, key = kv.SUPABASE_SECRET_KEY;
if (!url || !/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url)) { console.error('SUPABASE_URL の形が違います（https://xxxx.supabase.co）'); process.exit(1); }
if (!key || !key.startsWith('sb_secret_')) { console.error('SUPABASE_SECRET_KEY の形が違います（sb_secret_ で始まる値）'); process.exit(1); }
console.log('読み込み: host=' + new URL(url).host + ' / key=sb_secret_…（' + key.length + '文字）');

// (0) つながるか確かめる
const ping = await fetch(url.replace(/\/$/, '') + '/rest/v1/', { headers: { apikey: key, Authorization: 'Bearer ' + key } });
console.log('接続の確認: ' + ping.status);
if (!ping.ok) { console.error('つながりません。鍵か住所を確かめてください'); process.exit(1); }

// (1) .env.local
const envPath = path.join(liffDir, '.env.local');
let env = fs.readFileSync(envPath, 'utf8');
const put = (name, value) => { const re = new RegExp('^' + name + '=.*$', 'm'); env = re.test(env) ? env.replace(re, name + '=' + value) : env.replace(/\s*$/, '\n' + name + '=' + value + '\n'); };
put('SUPABASE_URL', url.replace(/\/$/, '')); put('SUPABASE_SECRET_KEY', key);
fs.writeFileSync(envPath, env);
console.log('.env.local を更新');

// (2) Vercel の環境変数
function vercelSet(cwd, name, value) {
  spawnSync('vercel', ['env', 'rm', name, 'production', '--yes'], { cwd, shell: true, encoding: 'utf8' });
  const r = spawnSync('vercel', ['env', 'add', name, 'production'], { cwd, shell: true, encoding: 'utf8', input: value });
  console.log('  ' + path.basename(cwd) + ' ' + name + ': ' + (r.status === 0 ? 'ok' : '失敗'));
  if (r.status !== 0) process.exitCode = 1;
}
const targets = [liffDir]; if (process.argv.includes('--root')) targets.push(rootDir);
for (const cwd of targets) { vercelSet(cwd, 'SUPABASE_URL', url.replace(/\/$/, '')); vercelSet(cwd, 'SUPABASE_SECRET_KEY', key); }
console.log('終わり。反映にはデプロイが要ります');
