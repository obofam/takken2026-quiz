// 利用者一覧（identities と回答数）。`node scripts/db-users.mjs`。.env.local を読む。メールは伏せて表示。
import fs from 'node:fs';
const env = {}; for (const l of fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) { const m = l.match(/^(\w+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
const h = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY };
const get = async p => (await fetch(env.SUPABASE_URL + '/rest/v1/' + p, { headers: h })).json();
const users = await get('users?select=id,created_at&order=created_at');
const ids = await get('identities?select=user_id,provider,subject');
const answers = await get('answers?select=user_id');
for (const u of users) {
  const mine = ids.filter(i => i.user_id === u.id).map(i => i.provider + ':' + (i.provider === 'email' ? i.subject.replace(/^(.).*@/, '$1***@') : i.subject.slice(0, 8) + '…'));
  console.log(u.id.slice(0, 8), u.created_at.slice(0, 19).replace('T', ' ') + 'Z', 'identities=[' + mine.join(', ') + ']', 'answers=' + answers.filter(a => a.user_id === u.id).length);
}
if (!users.length) console.log('(no users)');
