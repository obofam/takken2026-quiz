// 販売パートナー経由で売れたお客さまに、メールアドレスで教材の権限を付ける道具。帳簿（purchases）には入らない（会社相手の請求で別に記帳する）。
// 使い方（.env.local を読む。鍵・メールアドレスは画面に出さない）:
//   node scripts/partner-grant.mjs <メールアドレス> <text|last30|bansou> --partner <パートナーの短い名前> [--until YYYY-MM-DD] [--dry-run]
//   node scripts/partner-grant.mjs <メールアドレス> <plan> --partner <名前> --revoke      … 同じ source の行だけ消す
//   node scripts/partner-grant.mjs --list --partner <名前>                                … そのパートナーの行を、メールを伏せて表示
// ・そのメールの identities(email) があればその利用者に付ける。無ければ users と identities を先に作ってから付ける
//   （あとでその人がメールでログインすると resolve_identity が同じ identities を見つけて同じ利用者に入る）。
// ・source は partner:<名前>:<plan>:<メールの sha256 先頭12桁>。同じ指定をもう一度やると duplicate（増えない）。
// ・期限の既定は 2027-10-17T14:59:59Z（日本時間 2027-10-17 23:59:59）。--until は日本時間のその日の終わり。
// ・--dry-run は何も書かず、やることだけ表示する。
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const PLANS = ['text', 'last30', 'bansou'];
export const DEFAULT_UNTIL = '2027-10-17T14:59:59Z';

export function normalizeEmail(v) {
  if (typeof v !== 'string') throw new Error('invalid_email');
  const e = v.trim().toLowerCase();
  if (e.length > 254 || !/^[^\s@,()<>]+@[^\s@,()<>]+\.[^\s@,()<>]+$/.test(e)) throw new Error('invalid_email');
  return e;
}
export function checkPartner(v) {
  if (typeof v !== 'string' || !/^[A-Za-z0-9-]{1,32}$/.test(v)) throw new Error('invalid_partner');
  return v;
}
export function checkPlan(v) {
  if (!PLANS.includes(v)) throw new Error('invalid_plan');
  return v;
}
export function untilOf(date) {
  if (date === undefined || date === null) return DEFAULT_UNTIL;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '');
  if (!m) throw new Error('invalid_until');
  const d = new Date(`${date}T23:59:59+09:00`);
  if (Number.isNaN(d.getTime()) || new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDate() !== +m[3]) throw new Error('invalid_until');
  return d.toISOString().replace('.000Z', 'Z');
}
export const emailHash = email => crypto.createHash('sha256').update(email).digest('hex').slice(0, 12);
export const sourceOf = (partner, plan, email) => `partner:${partner}:${plan}:${emailHash(email)}`;
export function maskEmail(e) {
  const at = String(e || '').lastIndexOf('@');
  return at < 1 ? '(メールなし)' : e[0] + '***@' + e.slice(at + 1);
}

// io: { findUser(email)->uuid|null, createUser(email)->uuid, grant(userId,plan,until,source)->'granted'|'duplicate'|'unknown_user', revoke(source)->件数, list(partner)->[{plan,valid_until,email|null}] }
export async function run(io, o) {
  if (o.list) {
    const partner = checkPartner(o.partner);
    const rows = await io.list(partner);
    return { action: 'list', rows: rows.map(r => ({ plan: r.plan, valid_until: r.valid_until, email: maskEmail(r.email) })) };
  }
  const email = normalizeEmail(o.email), partner = checkPartner(o.partner), plan = checkPlan(o.plan);
  const source = sourceOf(partner, plan, email);
  if (o.revoke) {
    if (o.dryRun) return { action: 'revoke', dryRun: true, source };
    return { action: 'revoke', removed: await io.revoke(source), source };
  }
  const until = untilOf(o.until);
  const userId = await io.findUser(email);
  if (o.dryRun) return { action: 'grant', dryRun: true, source, until, existingUser: !!userId, willCreateUser: !userId };
  const id = userId || await io.createUser(email);
  const result = await io.grant(id, plan, until, source);
  return { action: 'grant', result, source, until, createdUser: !userId };
}

export function parseArgs(argv) {
  const o = { dryRun: false, revoke: false, list: false }, pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') o.dryRun = true;
    else if (a === '--revoke') o.revoke = true;
    else if (a === '--list') o.list = true;
    else if (a === '--partner' || a === '--until') { const v = argv[++i]; if (v === undefined || v.startsWith('--')) throw new Error('usage'); o[a.slice(2)] = v; }
    else if (a.startsWith('--')) throw new Error('usage');
    else pos.push(a);
  }
  if (o.list) { if (pos.length) throw new Error('usage'); return o; }
  if (pos.length !== 2) throw new Error('usage');
  [o.email, o.plan] = pos;
  return o;
}

// Supabase REST 版の io（本番／試し用どちらでも .env.local の先を使う。テストでは使わない）。
export function restIo(env, fetchFn = fetch) {
  const base = env.SUPABASE_URL + '/rest/v1/';
  const h = { apikey: env.SUPABASE_SECRET_KEY, Authorization: 'Bearer ' + env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };
  const call = async (path, init = {}) => {
    const r = await fetchFn(base + path, { ...init, headers: { ...h, ...init.headers } });
    if (!r.ok) throw new Error('failed:' + r.status);
    return r.status === 204 ? null : r.json();
  };
  const q = s => encodeURIComponent(s);
  return {
    async findUser(email) {
      const r = await call(`identities?select=user_id&provider=eq.email&subject=eq.${q(email)}&limit=1`);
      return r.length ? r[0].user_id : null;
    },
    async createUser(email) {
      const [u] = await call('users?select=id', { method: 'POST', headers: { Prefer: 'return=representation' }, body: '{}' });
      try {
        await call('identities', { method: 'POST', body: JSON.stringify({ user_id: u.id, provider: 'email', subject: email }) });
      } catch (e) {
        await call(`users?id=eq.${u.id}`, { method: 'DELETE' }).catch(() => {});
        throw e;
      }
      return u.id;
    },
    grant: (userId, plan, until, source) => call('rpc/grant_entitlement', { method: 'POST', body: JSON.stringify({ p_user_id: userId, p_plan: plan, p_valid_until: until, p_source: source, p_event_id: source }) }),
    async revoke(source) {
      const gone = await call(`entitlements?source=eq.${q(source)}&select=source`, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
      return gone.length;
    },
    async list(partner) {
      const rows = await call(`entitlements?source=like.${q('partner:' + partner + ':*')}&select=user_id,plan,valid_until&order=valid_until.asc`);
      const ids = [...new Set(rows.map(r => r.user_id))];
      const mails = {};
      if (ids.length) for (const i of await call(`identities?select=user_id,subject&provider=eq.email&user_id=in.(${ids.join(',')})`)) mails[i.user_id] = i.subject;
      return rows.map(r => ({ plan: r.plan, valid_until: r.valid_until, email: mails[r.user_id] || null }));
    }
  };
}

const MSG = { invalid_email: 'メールアドレスの形が正しくありません', invalid_partner: '--partner は英数字とハイフンだけ（32文字まで）', invalid_plan: 'plan は ' + PLANS.join(' / ') + ' のどれか', invalid_until: '--until は YYYY-MM-DD（実在する日付）', usage: '使い方: node scripts/partner-grant.mjs <メール> <' + PLANS.join('|') + '> --partner <名前> [--until YYYY-MM-DD] [--dry-run|--revoke]  /  --list --partner <名前>' };

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL('file:///' + process.argv[1].replace(/\\/g, '/')))) {
  try {
    const o = parseArgs(process.argv.slice(2));
    const env = {};
    for (const l of fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) { const m = l.match(/^(\w+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
    const r = await run(restIo(env), o);
    if (r.action === 'list') { console.log('rows=' + r.rows.length); for (const x of r.rows) console.log('  ' + x.email + '　' + x.plan + '　' + (x.valid_until || '期限なし')); }
    else console.log(JSON.stringify(r));
  } catch (e) {
    console.error(MSG[e.message] || ('failed: ' + String(e.message).slice(0, 40)));
    process.exit(1);
  }
}
