import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client — used in Client Components (e.g. the login form).
 * Only ever constructed with the publishable key; never import the secret
 * key here or anywhere under a 'use client' boundary.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
