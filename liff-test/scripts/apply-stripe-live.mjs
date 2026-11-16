// 本番の Stripe をサーバー（リポジトリ直下の Vercel プロジェクト・production）につなぐ。Kei が自分で実行する。値は画面に出さない。
// やること：(1) 鍵の置き場のファイルから本番のシークレットキーを読む　(2) 値段の札が2つあるか確かめる
//          (3) Stripe に「支払いが済んだよ」の知らせ先（https://takken.mimiobo.com/api/stripe-webhook・checkout.session.completed だけ）を作る
//          (4) そのとき1回だけ出る合言葉（whsec_…）を、同じ置き場のファイルに書き足す
//          (5) Vercel の production に STRIPE_SECRET_KEY・STRIPE_WEBHOOK_SECRET・STRIPE_ALLOW_LIVE=1 を入れる
// 使い方：node scripts/apply-stripe-live.mjs --dry-run   … 確かめるだけ（何も作らない・何も入れない）
//         node scripts/apply-stripe-live.mjs             … 実行
//         node scripts/apply-stripe-live.mjs --renew     … 知らせ先を作り直す（合言葉が分からなくなったとき）
// 反映にはデプロイが要る（直下で vercel --prod）。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { find } = require('../lib/products.js');

const dry = process.argv.includes('--dry-run'), renew = process.argv.includes('--renew');
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = path.join('C:\\Claude', '_secrets', 'stripe_takken_live.env');
const URL_HOOK = 'https://takken.mimiobo.com/api/stripe-webhook';
const EVENTS = ['checkout.session.completed'];
const stop = m => { console.error(m); process.exit(1); };

if (!fs.existsSync(src)) stop('鍵のファイルが見つかりません（stripe_takken_live.env）');
let text = fs.readFileSync(src, 'utf8').replace(/^\uFEFF/, '');
const read = name => { const m = text.match(new RegExp('^\\s*' + name + '\\s*=\\s*(.*?)\\s*$', 'm')); return m ? m[1].replace(/^["']|["']$/g, '').trim() : ''; };
const key = read('STRIPE_SECRET_KEY');
if (!/^(sk|rk)_live_[A-Za-z0-9_]+$/.test(key)) stop('STRIPE_SECRET_KEY が本番の鍵の形ではありません（sk_live_ で始まる値）。何もしませんでした。');
let hook = read('STRIPE_WEBHOOK_SECRET');
if (hook && !/^whsec_\S+$/.test(hook)) stop('ファイルの STRIPE_WEBHOOK_SECRET の形が違います（whsec_ で始まる値）。何もしませんでした。');
console.log((dry ? '[確かめるだけ] ' : '') + '鍵：本番のシークレットキー（' + key.length + '文字）を読みました');

const stripe = new (require('stripe'))(key, { maxNetworkRetries: 1, timeout: 15000 });
// (2) 値段の札
const product = find('text');
for (const [label, lookupKey, amount] of [['通常', product.lookupKey, product.price], ['スタート価格', product.start.lookupKey, product.start.price]]) {
  const p = (await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 })).data[0];
  if (!p) stop('値段の札がありません：' + label + '（' + lookupKey + '）。先に stripe-setup.mjs --live --only text を実行してください。');
  if (p.unit_amount !== amount || p.currency !== 'jpy' || p.livemode !== true) stop('値段の札が台帳と違います：' + label + '（Stripe ' + p.unit_amount + ' ' + p.currency + '／台帳 ' + amount + ' 円）');
  console.log('値段：' + label + ' ' + amount + '円　あった');
}
// (3) 知らせ先
const all = (await stripe.webhookEndpoints.list({ limit: 100 })).data.filter(e => e.url === URL_HOOK);
console.log('知らせ先：' + (all.length ? 'すでに ' + all.length + ' 件ある' : 'まだ無い'));
if (all.length && !hook && !renew) stop('知らせ先はあるのに、合言葉（STRIPE_WEBHOOK_SECRET）がファイルにありません。--renew を付けて実行すると、知らせ先を作り直します。');
const make = !all.length || renew;
if (dry) {
  console.log('予定：' + (make ? (all.length ? '知らせ先を作り直す' : '知らせ先を作る') + '（' + URL_HOOK + '・' + EVENTS.join(', ') + '）' : '知らせ先はそのまま使う'));
  console.log('予定：Vercel（本番）に STRIPE_SECRET_KEY・STRIPE_WEBHOOK_SECRET・STRIPE_ALLOW_LIVE を入れる');
  console.log('確かめるだけなので、何も作っていません。');
  process.exit(0);
}
if (make) {
  for (const e of all) await stripe.webhookEndpoints.del(e.id);
  const created = await stripe.webhookEndpoints.create({ url: URL_HOOK, enabled_events: EVENTS, description: '耳で覚える宅建 2027 売り場' });
  if (!/^whsec_\S+$/.test(created.secret || '')) stop('知らせ先は作れましたが、合言葉を受け取れませんでした。--renew でやり直してください。');
  hook = created.secret;
  // (4) 合言葉は Stripe では二度と表示されないので、先に置き場のファイルへ書く
  text = /^\s*STRIPE_WEBHOOK_SECRET\s*=.*$/m.test(text) ? text.replace(/^\s*STRIPE_WEBHOOK_SECRET\s*=.*$/m, 'STRIPE_WEBHOOK_SECRET=' + hook) : text.replace(/\s*$/, '\r\nSTRIPE_WEBHOOK_SECRET=' + hook + '\r\n');
  fs.writeFileSync(src, text);
  console.log('知らせ先：作った。合言葉を置き場のファイルに書き足した');
}
// (5) Vercel（本番）
function vercelSet(name, value) {
  spawnSync('vercel', ['env', 'rm', name, 'production', '--yes'], { cwd: rootDir, shell: true, encoding: 'utf8' });
  const r = spawnSync('vercel', ['env', 'add', name, 'production'], { cwd: rootDir, shell: true, encoding: 'utf8', input: value });
  console.log('  サーバーの設定 ' + name + '：' + (r.status === 0 ? '入れた' : '失敗'));
  if (r.status !== 0) process.exitCode = 1;
}
vercelSet('STRIPE_SECRET_KEY', key);
vercelSet('STRIPE_WEBHOOK_SECRET', hook);
vercelSet('STRIPE_ALLOW_LIVE', '1');
console.log(process.exitCode ? '一部が失敗しました。この画面をそのまま Claude に見せてください。' : '終わり。3つとも入りました（効くのは、次に本番を出し直したときから）。');
