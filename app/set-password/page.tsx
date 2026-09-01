"use client";

import { useState, type FormEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// supabase/config.toml has no [auth] minimum_password_length override —
// Supabase's own project default may differ; confirm with Dashboard >
// Auth > Policies before relying on this client-side check as the sole
// gate (Supabase's own server-side check is the real enforcement).
const MIN_PASSWORD_LENGTH = 8;

/**
 * Post-invite/recovery password set (AUTH-INVITE-01). Reached only via
 * /auth/confirm's verifyOtp redirect, which has already established a
 * session — this route stays behind the proxy.ts auth gate (unchanged), so
 * an unauthenticated direct visit never renders this component at all. No
 * signup UI here either (D-01) — this is strictly invite/recovery
 * completion, not account creation.
 */
export default function SetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      );
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);

    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({
      password,
    });

    if (updateError) {
      setSubmitting(false);
      // /set-password is behind the proxy auth gate, so an unauthenticated
      // direct visit already redirects to /login before this component
      // renders. This branch only covers the edge case where the session
      // established by verifyOtp expires/is revoked between the redirect
      // and this submit.
      setError(
        "Your session has expired. Ask an admin to re-send the invite.",
      );
      return;
    }

    router.refresh();
    router.push("/");
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-background px-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        <Image
          src="/logo.svg"
          alt="Safecypher"
          width={142}
          height={30}
          priority
        />
        <Card className="w-full">
          <CardHeader className="items-center gap-1 text-center">
            <h1 className="text-lg font-medium text-foreground">
              Set your password
            </h1>
            <p className="text-sm font-light text-muted-foreground">
              Create a password to finish setting up your Safecypher
              Reporting account.
            </p>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={handleSubmit}
              noValidate
              className="flex flex-col gap-4"
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  aria-invalid={error ? true : undefined}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className={cn(error && "border-destructive")}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="confirmPassword">Confirm password</Label>
                <Input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  aria-invalid={error ? true : undefined}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className={cn(error && "border-destructive")}
                />
              </div>
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              <Button
                type="submit"
                disabled={submitting}
                className="mt-2 h-9 w-full"
              >
                {submitting ? "Saving…" : "Set password"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
