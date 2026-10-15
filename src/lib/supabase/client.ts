'use client';
import { createBrowserClient } from '@supabase/ssr';

/** Supabase in the browser: acts as the signed-in member, so row-level security applies. */
export function supabaseBrowser() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
