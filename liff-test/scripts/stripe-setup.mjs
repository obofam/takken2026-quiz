// 2027の商品（lib/products.js の8つ）の Stripe 商品と価格を、テストモードに作る。
// `node scripts/stripe-setup.mjs [--dry-run]`。.env.local の STRIPE_SECRET_KEY を読む（中身は表示しない）。
// sk_test_ / rk_test_ 以外のキーなら何もしない。lookup_key（takken2027_<コード>）で探し、あれば何もしない（冪等）。
// --dry-run も Stripe を呼ぶ（探すだけ・作らない）。
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PRODUCTS } = require('../lib/products.js');
const dry = process.argv.includes('--dry-run');
const env = {};
for (const l of fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) { const m = l.match(/^(\w+)=(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, ''); }
const key = env.STRIPE_SECRET_KEY;
if (typeof key !== 'string' || !/^(sk|rk)_test_[A-Za-z0-9_]+$/.test(key)) { console.error('STRIPE_SECRET_KEY がテストの鍵ではないため、何もしませんでした。'); process.exit(1); }
const stripe = new (require('stripe'))(key, { maxNetworkRetries: 1, timeout: 10000 });
const lines = [];
for (const p of PRODUCTS) {
  const found = await stripe.prices.list({ lookup_keys: [p.lookupKey], active: true, limit: 1 });
  if (found.data.length) { lines.push(p.code + '\t' + p.price + '円\tあった'); continue; }
  if (dry) { lines.push(p.code + '\t' + p.price + '円\t作る予定（' + p.lookupKey + '）'); continue; }
  const product = await stripe.products.create({ name: p.name + '（2027・テスト）', metadata: { code: p.code, plan: p.plan } });
  await stripe.prices.create({ product: product.id, currency: 'jpy', unit_amount: p.price, lookup_key: p.lookupKey, transfer_lookup_key: false });
  lines.push(p.code + '\t' + p.price + '円\t作った');
}
console.log((dry ? '[dry-run] ' : '') + lines.length + '件');
for (const l of lines) console.log(l);
