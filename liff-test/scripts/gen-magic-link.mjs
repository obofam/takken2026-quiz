// メールを送らずにログイン用リンクを作る（管理API）。テストでメール上限に当たったとき用。
// 使い方: node scripts/gen-magic-link.mjs [email]  → 表示された URL の redirect_to を
//   https://mimiobo-liff-test.vercel.app/auth-callback.html に付け替えてブラウザで開く（1回限り・許可リストのメールのみ）
import fs from 'node:fs';
const env = {}; for (const l of fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) { const m = l.match(/^(\w+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
const email = process.argv[2] || 'ayako.fujishima@gmail.com';
const r = await fetch(env.SUPABASE_URL + '/auth/v1/admin/generate_link', { method: 'POST', headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email, options: { redirect_to: 'https://mimiobo-liff-test.vercel.app/auth-callback.html' } }) });
const b = await r.json();
if (!b.action_link) { console.log('failed:', r.status, JSON.stringify(b).slice(0, 200)); process.exit(1); }
const u = new URL(b.action_link); u.searchParams.set('redirect_to', 'https://mimiobo-liff-test.vercel.app/auth-callback.html');
console.log(u.toString());
