import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

/** Supabase in server components and route handlers, acting as the member whose cookies came with the request. */
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Called from a server component, where cookies are read-only. The middleware refreshes sessions instead.
        }
      },
    },
  });
}
