// テスト利用者を丸ごと削除（answers→attempts→link_tickets→identities→entitlements→users）。
// 使い方: node scripts/db-delete-user.mjs <user_id の先頭8文字>   ※テスト環境専用
import fs from 'node:fs';
const env = {}; for (const l of fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) { const m = l.match(/^(\w+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
const h = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, Prefer: 'return=representation' };
const prefix = process.argv[2];
if (!prefix) { console.log('usage: node scripts/db-delete-user.mjs <id prefix>'); process.exit(1); }
const users = await (await fetch(env.SUPABASE_URL + '/rest/v1/users?select=id', { headers: h })).json();
const target = users.filter(u => u.id.startsWith(prefix));
if (target.length !== 1) { console.log('target not unique:', target.length); process.exit(1); }
const id = target[0].id;
for (const t of ['answers', 'attempts', 'link_tickets', 'identities', 'entitlements', 'users']) {
  const filter = t === 'users' ? 'id=eq.' + id : 'user_id=eq.' + id;
  const r = await fetch(env.SUPABASE_URL + '/rest/v1/' + t + '?' + filter, { method: 'DELETE', headers: h });
  const b = await r.json().catch(() => []);
  console.log(t, r.status, 'deleted', Array.isArray(b) ? b.length : '?');
}
