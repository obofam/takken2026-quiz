// 返金を帳簿に記録する。`node scripts/db-refund.mjs <cs_… か pi_…> <返金した額（円）> [--dry-run]`。.env.local を読む（鍵・値は表示しない）。
// Stripe の画面で返金したあとに使う（Stripe へは何も送らない）。RPC refund_purchase を呼ぶ。
// 全額（返金額 >= 支払った額）なら、その支払いの権利（entitlements の source = stripe:<cs_…>）も外す。一部なら権利は残す。
// --dry-run：該当の帳簿の行を表示するだけ（何も書かない）。
import fs from 'node:fs';
const argv = process.argv.slice(2), dry = argv.includes('--dry-run');
const [key, amountText] = argv.filter(a => !a.startsWith('--'));
if (!/^(cs|pi)_[A-Za-z0-9_]+$/.test(key || '') || !/^\d+$/.test(amountText || '')) {
  console.error('usage: node scripts/db-refund.mjs <cs_… か pi_…> <返金した額（円）> [--dry-run]'); process.exit(1);
}
const amount = Number(amountText);
const env = {}; for (const l of fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) { const m = l.match(/^(\w+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
const h = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };
const call = async (path, init = {}) => { const r = await fetch(env.SUPABASE_URL + '/rest/v1/' + path, { ...init, headers: { ...h, ...init.headers } }); if (!r.ok) { console.error('failed:', r.status); process.exit(1); } return r.status === 204 ? null : r.json(); };
const column = key.startsWith('cs_') ? 'stripe_session_id' : 'stripe_payment_intent';
if (dry) {
  const rows = await call('purchases?select=purchased_at,product,price_kind,amount,currency,livemode,refunded_at,refund_amount,stripe_session_id&' + column + '=eq.' + key);
  if (!rows.length) { console.log('該当なし（まだ帳簿にありません）'); process.exit(0); }
  for (const r of rows) console.log(`[dry-run] ${r.stripe_session_id}　${r.product}（${r.price_kind}）　支払い ${r.amount}${r.currency === 'jpy' ? '円' : r.currency}　${r.livemode ? '本番' : 'テスト'}　` + (r.refunded_at ? `返金の記録あり（${r.refund_amount}）` : `返金 ${amount}円 → ${amount >= r.amount ? '全額（権利を外す）' : '一部（権利は残す）'}`));
  process.exit(0);
}
const result = await call('rpc/refund_purchase', { method: 'POST', body: JSON.stringify({ p_key: key, p_refund_amount: amount, p_refunded_at: new Date().toISOString() }) });
const text = { refunded: '全額の返金を記録して、権利を外しました', partial: '一部の返金を記録しました（権利は残しています）', not_found: '帳簿に該当がありません（番号を確かめてください）', already: 'すでに返金の記録があるので、何もしませんでした' };
console.log(key.slice(0, 12) + '…　' + (text[result] || '想定外の結果：' + result));
