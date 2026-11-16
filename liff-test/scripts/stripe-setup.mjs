// 2027の商品（lib/products.js）の Stripe 商品と価格を作る。台帳に start（スタート価格）がある商品は、同じ商品の下に2つ目の Price（takken2027_<コード>_start）も作る。
// `node scripts/stripe-setup.mjs [--dry-run] [--only <コード>] [--live]`。.env.local の STRIPE_SECRET_KEY を読む（中身は表示しない）。
// 鍵と --live は必ず対にする：付けないときは sk_test_ / rk_test_ だけ、--live を付けたときは sk_live_ / rk_live_ だけ。合わないときは何もしない（本番に作るつもりがなくて作ってしまう事故を防ぐ）。
// lookup_key（takken2027_<コード>、スタートは _start 付き）で探し、あれば何もしない（冪等）。--only で1商品だけ。
// --dry-run も Stripe を呼ぶ（探すだけ・作らない）。
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PRODUCTS } = require('../lib/products.js');
const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const live = args.includes('--live');
const onlyAt = args.indexOf('--only');
const only = onlyAt >= 0 ? args[onlyAt + 1] : null;
if (onlyAt >= 0 && (!only || only.startsWith('--'))) { console.error('--only の後に商品コードを書いてください。'); process.exit(1); }
const targets = only ? PRODUCTS.filter(p => p.code === only) : PRODUCTS;
if (only && !targets.length) { console.error('その商品コードは台帳にありません：' + only + '（' + PRODUCTS.map(p => p.code).join('、') + '）'); process.exit(1); }
// 鍵の読み先：テストは .env.local。--live のときは .env.local を読まず、起動時の環境変数だけ（node --env-file=<本番の鍵を1行書いたファイル> で渡す。試し用のフォルダに本番の鍵を置かないため）。
const env = {};
if (!live) for (const l of fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) { const m = l.match(/^(\w+)=(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, ''); }
const key = live ? process.env.STRIPE_SECRET_KEY : env.STRIPE_SECRET_KEY;
const isTest = typeof key === 'string' && /^(sk|rk)_test_[A-Za-z0-9_]+$/.test(key);
const isLive = typeof key === 'string' && /^(sk|rk)_live_[A-Za-z0-9_]+$/.test(key);
if (live ? !isLive : !isTest) {
  console.error(live ? '--live が付いていますが、STRIPE_SECRET_KEY が本番の鍵ではないため、何もしませんでした。' : 'STRIPE_SECRET_KEY がテストの鍵ではないため、何もしませんでした（本番に作るときは --live を付けます）。');
  process.exit(1);
}
const stripe = new (require('stripe'))(key, { maxNetworkRetries: 1, timeout: 10000 });
const mode = live ? '本番' : 'テスト';
const find = async lookupKey => (await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 })).data[0] || null;
const lines = [];
for (const p of targets) {
  // 作る価格の一覧：通常（lookupKey）と、あればスタート（start.lookupKey）
  const wanted = [{ label: '通常', amount: p.price, lookupKey: p.lookupKey }];
  if (p.start) wanted.push({ label: 'スタート', amount: p.start.price, lookupKey: p.start.lookupKey });
  let productId = null;
  for (const w of wanted) {
    const found = await find(w.lookupKey);
    if (found) { productId ||= typeof found.product === 'string' ? found.product : found.product?.id; lines.push(p.code + '\t' + w.label + '\t' + w.amount + '円\t' + (found.unit_amount === w.amount ? 'あった' : 'あった。ただし Stripe 側は ' + found.unit_amount + '円（台帳と違う。Stripe の画面でこの値段を止めてから、もう一度）')); continue; }
    if (dry) { lines.push(p.code + '\t' + w.label + '\t' + w.amount + '円\t作る予定（' + w.lookupKey + '）'); continue; }
    // 同じ商品の下に並べる。通常かスタートのどちらかが先にあれば、その商品を使う。
    productId ||= (await stripe.products.create({ name: live ? '耳で覚える宅建2027 ' + p.name : p.name + '（2027・テスト）', metadata: { code: p.code, plan: p.plan } })).id;
    await stripe.prices.create({ product: productId, currency: 'jpy', unit_amount: w.amount, lookup_key: w.lookupKey, transfer_lookup_key: false });
    lines.push(p.code + '\t' + w.label + '\t' + w.amount + '円\t作った');
  }
}
console.log((dry ? '[dry-run] ' : '') + '[' + mode + '] ' + lines.length + '件');
for (const l of lines) console.log(l);
