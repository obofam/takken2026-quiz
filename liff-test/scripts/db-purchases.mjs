// 帳簿（purchases）を CSV で標準出力へ。`node scripts/db-purchases.mjs [--year 2027] > 帳簿_2027.csv`。.env.local を読む（鍵・値は表示しない）。
// 列：買った日（日本時間）・商品・値段の種類・金額・取引番号・セッションの番号・返金の日（日本時間）・返金の額・本番かテストか。
// --year：買った日（日本時間）の年で絞る。表は人を指す列を持たないので、利用者を消したあとでも出せる（7年残す）。
import fs from 'node:fs';
const argv = process.argv.slice(2);
const yearAt = argv.indexOf('--year');
const year = yearAt >= 0 ? argv[yearAt + 1] : null;
if (yearAt >= 0 && !/^\d{4}$/.test(year || '')) { console.error('usage: node scripts/db-purchases.mjs [--year 2027]'); process.exit(1); }
const env = {}; for (const l of fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) { const m = l.match(/^(\w+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
const base = env.SUPABASE_URL.replace(/\/$/, '');
const h = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY };
const range = year ? '&and=(purchased_at.gte.' + encodeURIComponent(year + '-01-01T00:00:00+09:00') + ',purchased_at.lt.' + encodeURIComponent((Number(year) + 1) + '-01-01T00:00:00+09:00') + ')' : '';
const rows = []; let from = 0;
for (;;) {
  const r = await fetch(base + '/rest/v1/purchases?select=*&order=purchased_at.asc,id.asc' + range, { headers: { ...h, Range: from + '-' + (from + 999), 'Range-Unit': 'items' } });
  if (!r.ok) { console.error('failed:', r.status); process.exit(1); }
  const part = await r.json(); rows.push(...part);
  if (part.length < 1000) break;
  from += 1000;
}
const jst = v => v ? new Date(Date.parse(v) + 9 * 3600000).toISOString().slice(0, 10) : '';
const cell = v => { const t = v == null ? '' : String(v); return /[",\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
const kind = { tsujo: '通常', start: 'スタート', sagaku: '差額' };
const out = [['買った日', '商品', '値段の種類', '金額', '取引番号', 'セッションの番号', '返金の日', '返金の額', '本番かテストか']];
for (const r of rows) out.push([jst(r.purchased_at), r.product, kind[r.price_kind] || r.price_kind, r.amount, r.stripe_payment_intent, r.stripe_session_id, jst(r.refunded_at), r.refund_amount, r.livemode ? '本番' : 'テスト']);
process.stdout.write('﻿' + out.map(l => l.map(cell).join(',')).join('\r\n') + '\r\n');
console.error(rows.length + '件' + (year ? '（' + year + '年）' : ''));
