// Stripe（テストモード）の確認用。Webhook の宛先と、2027の価格（lookup_key）があるかを表示する。鍵は表示しない。
import fs from 'node:fs';
import Stripe from 'stripe';
const env = {}; for (const l of fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) { const m = l.match(/^(\w+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
const key = env.STRIPE_SECRET_KEY || '';
if (!/^(sk|rk)_test_/.test(key)) { console.error('テストの鍵ではないので何もしません'); process.exit(1); }
const stripe = new Stripe(key);
const hooks = await stripe.webhookEndpoints.list({ limit: 20 });
console.log('webhook', hooks.data.length + '件');
for (const h of hooks.data) console.log(' ', h.status, h.url, (h.enabled_events || []).join(','));
const prices = await stripe.prices.list({ active: true, limit: 100 });
for (const p of prices.data.filter(p => (p.lookup_key || '').startsWith('takken2027_'))) console.log(' ', p.lookup_key, p.unit_amount, p.currency, p.livemode ? 'LIVE' : 'test');
// 台帳にある価格の札（通常と、あればスタート）がそろっているか。金額が台帳とちがえば知らせる。
import { createRequire } from 'node:module';
const { PRODUCTS } = createRequire(import.meta.url)('../lib/products.js');
const byKey = new Map(prices.data.map(p => [p.lookup_key, p]));
const want = PRODUCTS.flatMap(p => [[p.lookupKey, p.price], ...(p.start ? [[p.start.lookupKey, p.start.price]] : [])]);
const missing = want.filter(([k]) => !byKey.has(k)).map(([k]) => k), wrong = want.filter(([k, n]) => byKey.has(k) && byKey.get(k).unit_amount !== n).map(([k]) => k);
console.log('札', want.length - missing.length + '/' + want.length, missing.length ? '足りない：' + missing.join('、') : 'そろっている', wrong.length ? '金額がちがう：' + wrong.join('、') : '');
