import 'server-only';
import { createClient } from '@supabase/supabase-js';

/** Service-role client for scheduled jobs only. Bypasses row-level security: never use it for a member's request. */
export function supabaseAdmin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
