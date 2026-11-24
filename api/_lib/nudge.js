// 自動生成：liff-test/scripts/sync-prod.mjs。直さない（正本は liff-test 側）。
'use strict';
// 記録が3週間以上あいた人を、運営者1人にだけ LINE で知らせる（本人には送らない）。名前はログインのとき預かった LINE の表示名（line_names）。環境変数が揃うまでは何もしない。
// 返す・ログに出すのは人数と理由コードだけ（名前・ID・ハッシュは出さない。名前は DB に保存しない）。
const { randomUUID } = require('node:crypto');
const { buildNotice } = require('./nudge-message');
const DEFAULT_FLOOR = '2027-01-04T00:00:00+09:00';
const NO_NAME = '（名前なし）';
const jstDay = ms => new Date(ms + 9 * 3600000).toISOString().slice(0, 10);

async function runNudge({ fetch: f = globalThis.fetch, env = process.env, now = Date.now() } = {}) {
  const today = jstDay(now);
  if (!env.LINE_MESSAGING_TOKEN) return { skipped: 'no_token' };
  if (!env.NUDGE_NOTIFY_TO) return { skipped: 'no_notify_to' };
  if (!env.NUDGE_OPEN_FROM || !/^\d{4}-\d{2}-\d{2}$/.test(env.NUDGE_OPEN_FROM) || today < env.NUDGE_OPEN_FROM) return { skipped: 'not_open_yet' };
  if (env.NUDGE_OPEN_UNTIL && today > env.NUDGE_OPEN_UNTIL) return { skipped: 'closed' };
  const dry = env.NUDGE_DRY_RUN === '1';
  const max = Number.isInteger(Number(env.NUDGE_MAX)) && Number(env.NUDGE_MAX) > 0 ? Number(env.NUDGE_MAX) : 30;
  const base = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const sbHeaders = { apikey: env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };
  const rpc = async (name, body) => {
    const r = await f(base + '/rest/v1/rpc/' + name, { method: 'POST', headers: sbHeaders, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    if (!r.ok) return { ok: false };
    return { ok: true, data: await r.json().catch(() => null) };
  };
  const c = await rpc('nudge_candidates', { p_days: 21, p_floor: env.NUDGE_FLOOR || DEFAULT_FLOOR });
  if (!c.ok || !Array.isArray(c.data)) return { error: 'database_unavailable' };
  const out = { candidates: c.data.length, notified: 0, failed: 0 };
  if (!c.data.length) return out;
  if (dry) return { ...out, dry_run: true };
  const picked = c.data.slice(0, max); // 古い順（SQL 側で並べてある）
  const people = picked.map(row => ({ name: row.display_name || NO_NAME, lastAt: Date.parse(row.last_at), listened: row.listened_count ?? 0 }));
  const auth = { Authorization: 'Bearer ' + env.LINE_MESSAGING_TOKEN };
  let ok = false;
  try {
    const r = await f('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json', 'X-Line-Retry-Key': randomUUID() }, body: JSON.stringify({ to: env.NUDGE_NOTIFY_TO, messages: [{ type: 'text', text: buildNotice(people) }] }), signal: AbortSignal.timeout(10000) });
    ok = r.status === 200;
  } catch { ok = false; }
  if (!ok) { out.failed = picked.length; console.log('nudge', JSON.stringify(out)); return out; }
  for (const row of picked) {
    const m = await rpc('mark_nudged', { p_user_id: row.user_id });
    if (m.ok) out.notified++; else out.failed++;
  }
  console.log('nudge', JSON.stringify(out));
  return out;
}
module.exports = { runNudge };
