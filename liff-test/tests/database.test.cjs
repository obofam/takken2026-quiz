'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

test('Sprint 1 + 2 + 4 migrations and database access / identity / answer / entitlement regression', async () => {
  const db = new PGlite();
  try {
    // Supabase provides these roles. BYPASSRLS models server secret-key access.
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      grant usage on schema public to anon, authenticated, service_role;
    `);
    const root = path.resolve(__dirname, '..');
    await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/202609170001_sprint1.sql'), 'utf8'));
    await db.exec(fs.readFileSync(path.join(root, 'supabase/tests/sprint1.sql'), 'utf8'));
    // Sprint 2 applies on top of the Sprint 1 schema, exactly as in the test Supabase project.
    await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/202610060001_sprint2.sql'), 'utf8'));
    await db.exec(fs.readFileSync(path.join(root, 'supabase/tests/sprint2.sql'), 'utf8'));
    // Sprint 4 relaxes quiz_id / question_id from a fixed ep10 list to a shape check. Rows already stored for
    // ep10 (committed, as in the real database) must pass the new constraints and stay readable.
    await db.exec(`
      insert into public.users(id) values ('00000000-0000-4000-8000-000000000010');
      insert into public.attempts(id, user_id, quiz_id, started_at)
        values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000010', 'ep10', now());
      insert into public.answers(attempt_id, user_id, quiz_id, question_id, value, answered_at) values
        ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000010', 'ep10', 'ep10-money', true, now()),
        ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000010', 'ep10', 'ep10-join', false, now()),
        ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000010', 'ep10', 'ep10-add', null, now());
    `);
    await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/202610060002_sprint4_catalog.sql'), 'utf8'));
    const kept = await db.query("select question_id, value from public.answers where quiz_id = 'ep10' order by question_id");
    assert.deepEqual(kept.rows, [{ question_id: 'ep10-add', value: null }, { question_id: 'ep10-join', value: false }, { question_id: 'ep10-money', value: true }]);
    await db.exec(fs.readFileSync(path.join(root, 'supabase/tests/sprint4.sql'), 'utf8'));
    await db.exec("delete from public.answers; delete from public.attempts; delete from public.users where id = '00000000-0000-4000-8000-000000000010';");
    const { rows } = await db.query('select count(*)::int as count from public.users');
    assert.equal(rows[0].count, 0, 'SQL regression fixtures must roll back');
  } finally {
    await db.close();
  }
});
