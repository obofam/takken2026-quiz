// テスト用の権利付与。`node scripts/db-grant.mjs <利用者id先頭8文字> <ume|take|matsu> [--revoke]`。.env.local を読む（鍵・値は表示しない）。
// 付与は grant_entitlement RPC（valid_until=2027-10-17、source は manual:test:<利用者id>:<plan>）。--revoke は同じ source の行だけ消す。
// source が一意制約（entitlements_source_key）なので、利用者・プランごとに末尾を変えている。
import fs from 'node:fs';
const [prefix, plan, flag] = process.argv.slice(2);
if (!/^[0-9a-f]{8}$/i.test(prefix || '') || !['ume', 'take', 'matsu'].includes(plan) || (flag && flag !== '--revoke')) {
  console.error('usage: node scripts/db-grant.mjs <利用者id先頭8文字> <ume|take|matsu> [--revoke]'); process.exit(1);
}
const env = {}; for (const l of fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) { const m = l.match(/^(\w+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
const h = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };
const call = async (path, init = {}) => { const r = await fetch(env.SUPABASE_URL + '/rest/v1/' + path, { ...init, headers: { ...h, ...init.headers } }); if (!r.ok) { console.error('failed:', r.status); process.exit(1); } return r.status === 204 ? null : r.json(); };
const users = (await call('users?select=id')).filter(u => u.id.toLowerCase().startsWith(prefix.toLowerCase()));
if (users.length !== 1) { console.error(users.length ? 'ambiguous prefix (' + users.length + ' users)' : 'no such user'); process.exit(1); }
const id = users[0].id, source = 'manual:test:' + id + ':' + plan;
if (flag === '--revoke') {
  const gone = await call('entitlements?user_id=eq.' + id + '&plan=eq.' + plan + '&source=eq.' + encodeURIComponent(source), { method: 'DELETE', headers: { Prefer: 'return=representation' } });
  console.log(id.slice(0, 8), plan, 'revoked rows=' + gone.length);
} else {
  const result = await call('rpc/grant_entitlement', { method: 'POST', body: JSON.stringify({ p_user_id: id, p_plan: plan, p_valid_until: '2027-10-17T14:59:59Z', p_source: source, p_event_id: source }) });
  console.log(id.slice(0, 8), plan, result);
}
