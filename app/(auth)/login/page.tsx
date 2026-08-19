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

/**
 * Email/password sign-in (AUTH-01). No signup UI in Phase 1 (D-01) — the
 * ~4 internal accounts are seeded manually in Supabase. On success, refresh
 * the router (picks up the new session cookie) and navigate to the
 * authenticated shell; proxy.ts + the dashboard layout guard handle the
 * redirect back to /login for anyone unauthenticated.
 */
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setSubmitting(false);
      setError(
        "Invalid email or password. Check your credentials and try again.",
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
              Sign in to Safecypher Reporting
            </h1>
            <p className="text-sm font-light text-muted-foreground">
              Internal team access only.
            </p>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={handleSubmit}
              noValidate
              className="flex flex-col gap-4"
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  aria-invalid={error ? true : undefined}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className={cn(error && "border-destructive")}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  aria-invalid={error ? true : undefined}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
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
                {submitting ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
