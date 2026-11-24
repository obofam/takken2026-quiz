// 自動生成：liff-test/scripts/sync-prod.mjs。直さない（正本は liff-test 側）。
'use strict';
// 記録が3週間以上あいた人へ LINE でひとこと。環境変数が揃うまでは何もしない。返す・ログに出すのは人数と理由コードだけ（ID・ハッシュは出さない）。
const { createHash, randomUUID } = require('node:crypto');
const { NUDGE_TEXT } = require('./nudge-message');
const sha = v => createHash('sha256').update(v).digest('hex');
const DEFAULT_FLOOR = '2027-01-04T00:00:00+09:00';
const jstDay = ms => new Date(ms + 9 * 3600000).toISOString().slice(0, 10);

async function runNudge({ fetch: f = globalThis.fetch, env = process.env, now = Date.now() } = {}) {
  const today = jstDay(now);
  if (!env.LINE_MESSAGING_TOKEN) return { skipped: 'no_token' };
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
  const out = { candidates: c.data.length, matched: 0, sent: 0, failed: 0 };
  if (!c.data.length) return out;
  const bySubject = new Map(c.data.map(r => [r.subject, r.user_id]));
  const auth = { Authorization: 'Bearer ' + env.LINE_MESSAGING_TOKEN };
  const friends = []; // [userId(LINE), user_id(DB)]
  let start = null;
  do {
    const r = await f('https://api.line.me/v2/bot/followers/ids?limit=1000' + (start ? '&start=' + encodeURIComponent(start) : ''), { headers: auth, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return { ...out, followers_status: r.status };
    const j = await r.json().catch(() => ({}));
    for (const id of j.userIds || []) { const u = bySubject.get(sha(id)); if (u) friends.push([id, u]); }
    start = j.next || null;
  } while (start);
  out.matched = friends.length;
  if (dry) return { ...out, dry_run: true };
  for (const [to, userId] of friends.slice(0, max)) {
    let ok = false;
    try {
      const r = await f('https://api.line.me/v2/bot/message/push', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json', 'X-Line-Retry-Key': randomUUID() }, body: JSON.stringify({ to, messages: [{ type: 'text', text: NUDGE_TEXT }] }), signal: AbortSignal.timeout(10000) });
      ok = r.status === 200;
    } catch { ok = false; }
    if (!ok) { out.failed++; continue; }
    const m = await rpc('mark_nudged', { p_user_id: userId });
    if (m.ok) out.sent++; else out.failed++;
  }
  console.log('nudge', JSON.stringify(out));
  return out;
}
module.exports = { runNudge };
