"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

/**
 * Signs the current user out via the browser Supabase client, then routes
 * to /login. Non-destructive action — no confirmation dialog needed
 * (01-UI-SPEC.md Copywriting Contract: "Sign out ... needs no confirmation").
 */
export function SignOutButton() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.refresh();
    router.push("/login");
  }

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={signingOut}
      onClick={handleSignOut}
      className="w-full"
    >
      Sign out
    </Button>
  );
}
