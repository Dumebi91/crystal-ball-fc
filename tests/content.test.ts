import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeDb } from './harness';

it('the seed and the content template run cleanly on the real schema', async () => {
  const db = await makeDb();
  await db.pg.exec(readFileSync(join(__dirname, '..', 'supabase', 'seed.sql'), 'utf8'));
  await db.pg.exec(readFileSync(join(__dirname, '..', 'supabase', 'content-template.sql'), 'utf8'));
  expect(await db.one(`select count(*)::int from public.kb_questions`)).toBe(1);
  expect(await db.one(`select count(*)::int from public.polls`)).toBe(1);
  expect(await db.one(`select count(*)::int from public.takes`)).toBe(1);
});
