// データベースの中身を、表ごとに JSON で手元へ書き出す（控え用）。鍵は表示しない。件数だけ表示する。
// 使い方：node scripts/db-dump.mjs <書き出し先のフォルダ>
import fs from 'node:fs';
import path from 'node:path';
const out = process.argv[2];
if (!out) { console.error('usage: node scripts/db-dump.mjs <out-dir>'); process.exit(1); }
const env = {}; for (const l of fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) { const m = l.match(/^(\w+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
const base = env.SUPABASE_URL.replace(/\/$/, '');
const h = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY };
fs.mkdirSync(out, { recursive: true });
const spec = await (await fetch(base + '/rest/v1/', { headers: h })).json();
const tables = Object.keys(spec.definitions || {}).sort();
const summary = {};
for (const t of tables) {
  const rows = []; let from = 0;
  for (;;) {
    const r = await fetch(base + '/rest/v1/' + t + '?select=*', { headers: { ...h, Range: from + '-' + (from + 999), 'Range-Unit': 'items' } });
    if (!r.ok) { summary[t] = 'failed:' + r.status; break; }
    const part = await r.json(); rows.push(...part);
    if (part.length < 1000) { summary[t] = rows.length; break; }
    from += 1000;
  }
  fs.writeFileSync(path.join(out, t + '.json'), JSON.stringify(rows, null, 1));
}
// ログイン（Supabase Auth）の利用者の一覧も控える
try {
  const r = await fetch(base + '/auth/v1/admin/users?per_page=1000', { headers: h });
  const j = await r.json(); const users = j.users || [];
  fs.writeFileSync(path.join(out, '_auth_users.json'), JSON.stringify(users, null, 1));
  summary._auth_users = users.length;
} catch (e) { summary._auth_users = 'failed'; }
fs.writeFileSync(path.join(out, '_openapi.json'), JSON.stringify(spec));
fs.writeFileSync(path.join(out, '_summary.json'), JSON.stringify({ at: new Date().toISOString(), host: new URL(base).host, tables: summary }, null, 1));
console.log('tables', tables.length); for (const [k, v] of Object.entries(summary)) console.log(' ', k, v);
console.log('rpc', Object.keys(spec.paths || {}).filter(p => p.startsWith('/rpc/')).map(p => p.slice(5)).sort().join(', '));
