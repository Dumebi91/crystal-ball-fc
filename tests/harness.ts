// Runs the real Supabase migrations in an in-memory Postgres (PGlite), with a stand-in for
// Supabase's auth schema and a clock the tests control.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const AUTH_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema auth;
  create table auth.users (id uuid primary key, phone text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
`;

const TEST_CLOCK = `
  create table public.test_clock (t timestamptz not null);
  insert into public.test_clock values ('2026-11-07 08:00:00+00');
  grant select on public.test_clock to anon, authenticated, service_role;
  create or replace function public.app_now() returns timestamptz
    language sql stable as $$ select t from public.test_clock limit 1 $$;
`;

export type Db = Awaited<ReturnType<typeof makeDb>>;

export async function makeDb() {
  const pg = new PGlite();
  await pg.exec(AUTH_STUB);
  const dir = join(__dirname, '..', 'supabase', 'migrations');
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    await pg.exec(readFileSync(join(dir, f), 'utf8'));
  }
  await pg.exec(TEST_CLOCK);

  async function one<T = any>(sql: string, params: unknown[] = []): Promise<T> {
    const r = await pg.query<any>(sql, params);
    const row = r.rows[0];
    return (row ? Object.values(row)[0] : undefined) as T;
  }
  async function rows<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await pg.query<T>(sql, params)).rows;
  }

  return {
    pg,
    one,
    rows,
    /** Set the game clock to a Lagos wall-clock time, e.g. '2026-11-07 09:00'. */
    async at(lagos: string) {
      await pg.query(`update public.test_clock set t = ($1::timestamp at time zone 'Africa/Lagos')`, [lagos]);
    },
    /** Move the clock forward by some milliseconds. */
    async tick(ms: number) {
      await pg.query(`update public.test_clock set t = t + make_interval(secs => $1::float8 / 1000)`, [ms]);
    },
    /** Act as a member (or as nobody with null). Runs as the database owner, like a security-definer call. */
    async as(uid: string | null) {
      await pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);
    },
    /** Create a login and a profile; returns the member's id. */
    async member(handle: string, city = 'Lagos') {
      const id = randomUUID();
      await pg.query(`insert into auth.users (id) values ($1)`, [id]);
      await pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [id]);
      await pg.query(`select public.create_profile($1, $2, null, true)`, [handle, city]);
      return id;
    },
    /** Run a query as the signed-in member's database role, so row-level security applies. */
    async asRole<T = any>(role: 'anon' | 'authenticated', sql: string, params: unknown[] = []) {
      await pg.exec(`set role ${role}`);
      try {
        return (await pg.query<T>(sql, params)).rows;
      } finally {
        await pg.exec(`reset role`);
      }
    },
  };
}

/** Expect a call to fail with a given database error message. */
export async function fails(p: Promise<unknown>, message: string) {
  try {
    await p;
  } catch (e: any) {
    if (String(e.message).includes(message)) return;
    throw new Error(`expected "${message}" but got "${e.message}"`);
  }
  throw new Error(`expected "${message}" but the call succeeded`);
}
