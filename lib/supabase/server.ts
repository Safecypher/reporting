import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server Component / Route Handler Supabase client. Uses next/headers
 * cookies() with the getAll/setAll adapter (the only interface @supabase/ssr
 * 0.12.4 supports — never the deprecated single-cookie get/set/remove shape).
 *
 * Only ever constructed with the publishable key here; the secret key is
 * used exclusively by server-side writes that need to bypass RLS, and never
 * belongs in this shared read-path client.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // setAll called from a Server Component — safe to ignore since
            // proxy.ts already refreshes the session on every request.
          }
        },
      },
    },
  );
}
