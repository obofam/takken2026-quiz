// 実際にログインメールを1通送る（SMTP の疎通確認用）。`node scripts/probe-otp.mjs [email]`
import fs from 'node:fs';
const env = {}; for (const l of fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) { const m = l.match(/^(\w+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
const email = process.argv[2] || 'ayako.fujishima@gmail.com';
const r = await fetch(env.SUPABASE_URL + '/auth/v1/otp?redirect_to=' + encodeURIComponent('https://mimiobo-liff-test.vercel.app/auth-callback.html'), { method: 'POST', headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, create_user: true }) });
console.log('otp ->', r.status, (await r.text()).slice(0, 300));
