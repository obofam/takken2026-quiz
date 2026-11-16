// テスト用の権利付与。`node scripts/db-grant.mjs <利用者id先頭8文字> <ume|take|matsu|text|haru|natsu|last30|zenbu|bansou> [--revoke]`。.env.local を読む（鍵・値は表示しない）。
// 付与は grant_entitlement RPC（valid_until=2027-10-17、source は manual:test:<利用者id>:<plan>）。--revoke は同じ source の行だけ消す。
// source が一意制約（entitlements_source_key）なので、利用者・プランごとに末尾を変えている。
import fs from 'node:fs';
const [prefix, plan, flag] = process.argv.slice(2);
if (!/^[0-9a-f]{8}$/i.test(prefix || '') || !['ume', 'take', 'matsu', 'text', 'haru', 'natsu', 'last30', 'zenbu', 'bansou'].includes(plan) || (flag && !['--revoke', '--list', '--revoke-any'].includes(flag))) {
  console.error('usage: node scripts/db-grant.mjs <利用者id先頭8文字> <ume|take|matsu|text|haru|natsu|last30|zenbu|bansou> [--revoke]'); process.exit(1);
}
const env = {}; for (const l of fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) { const m = l.match(/^(\w+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
const h = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };
const call = async (path, init = {}) => { const r = await fetch(env.SUPABASE_URL + '/rest/v1/' + path, { ...init, headers: { ...h, ...init.headers } }); if (!r.ok) { console.error('failed:', r.status); process.exit(1); } return r.status === 204 ? null : r.json(); };
const users = (await call('users?select=id')).filter(u => u.id.toLowerCase().startsWith(prefix.toLowerCase()));
if (users.length !== 1) { console.error(users.length ? 'ambiguous prefix (' + users.length + ' users)' : 'no such user'); process.exit(1); }
const id = users[0].id, source = 'manual:test:' + id + ':' + plan;
// --list：その利用者・プランの権利の行の出どころ（source の先頭）を表示するだけ。--revoke-any：出どころを問わず、その利用者・プランの行を消す（合流で利用者の番号が変わった行や、テスト決済で付いた行を外すとき）。
if (flag === '--list' || flag === '--revoke-any') {
  const rows = await call('entitlements?user_id=eq.' + id + '&plan=eq.' + plan + '&select=source,valid_until', flag === '--list' ? {} : { method: 'DELETE', headers: { Prefer: 'return=representation' } });
  console.log(id.slice(0, 8), plan, (flag === '--list' ? 'rows=' : 'revoked rows=') + rows.length);
  for (const r of rows) console.log('  ' + String(r.source).slice(0, 28) + (String(r.source).length > 28 ? '…' : '') + '　' + (r.valid_until || '期限なし'));
} else if (flag === '--revoke') {
  const gone = await call('entitlements?user_id=eq.' + id + '&plan=eq.' + plan + '&source=eq.' + encodeURIComponent(source), { method: 'DELETE', headers: { Prefer: 'return=representation' } });
  console.log(id.slice(0, 8), plan, 'revoked rows=' + gone.length);
} else {
  const result = await call('rpc/grant_entitlement', { method: 'POST', body: JSON.stringify({ p_user_id: id, p_plan: plan, p_valid_until: '2027-10-17T14:59:59Z', p_source: source, p_event_id: source }) });
  console.log(id.slice(0, 8), plan, result);
}
