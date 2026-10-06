'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

test('Sprint 1 + 2 migrations and database access / identity / answer / entitlement regression', async () => {
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
    const { rows } = await db.query('select count(*)::int as count from public.users');
    assert.equal(rows[0].count, 0, 'SQL regression fixtures must roll back');
  } finally {
    await db.close();
  }
});
