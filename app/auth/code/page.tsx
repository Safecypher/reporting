import Image from "next/image";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { confirmDestination } from "@/lib/auth/confirm";
import {
  OTP_FORMAT_MESSAGE,
  OTP_MAX_LENGTH,
  isValidOtpShape,
  normalizeEmail,
  normalizeOtp,
  resolveCodeType,
} from "@/lib/auth/otp";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const runtime = "nodejs";

/**
 * /auth/code — sign in with the code from the email.
 *
 * WHY (quick-261002-mu7). A token in a URL can be spent by anything that
 * opens the URL. Microsoft Defender Safe Links detonates links in a sandbox
 * that renders the page and clicks its buttons: michael.ward's
 * `email_confirmed_at` was stamped at 14:51:43 by a successful verify while
 * his own Continue click was the 14:51:50 failure, seven seconds later. The
 * `/auth/confirm` interstitial stops passive prefetch and CDN retries; it
 * cannot stop a sandbox that clicks.
 *
 * Nothing on this page's URL authenticates anything. `type` is a hint only,
 * and the code — which exists solely in the body of the email — is what
 * verifies. There is nothing here for a scanner to burn.
 *
 * `/auth/confirm` is kept, not replaced: a pasted link still works, and that
 * is the path two users were onboarded through today.
 */
export default async function CodePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const type = resolveCodeType(firstValue(params.type));
  const prefillEmail = normalizeEmail(firstValue(params.email));
  const errorMessage = errorFor(firstValue(params.error));

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
              Enter your sign-in code
            </h1>
            <p className="text-sm font-light text-muted-foreground">
              We emailed you a code. Type it below to continue.
            </p>
          </CardHeader>
          <CardContent>
            <form action={submitCode} className="flex flex-col gap-4">
              <input type="hidden" name="type" value={type} />
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  defaultValue={prefillEmail}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="code">Code from the email</Label>
                <Input
                  id="code"
                  name="code"
                  // `text` with a numeric inputMode, not type="number":
                  // number strips leading zeros and offers a spinner, and
                  // these codes can legitimately start with 0 (e.g. 06771769).
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={OTP_MAX_LENGTH + 4}
                  required
                  placeholder="12345678"
                />
              </div>
              {errorMessage ? (
                <p role="alert" className="text-sm text-destructive">
                  {errorMessage}
                </p>
              ) : null}
              <Button type="submit" className="mt-2 h-9 w-full">
                Sign in
              </Button>
              <p className="text-xs font-light text-muted-foreground">
                Codes expire 24 hours after they are sent, and each one can
                only be used once. Spaces are ignored.
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/**
 * The Server Action validates every input itself. This is an independent
 * untrusted entry point, exactly like the one in `/auth/confirm` — the hidden
 * `type` field is user-controllable and is re-resolved, never trusted.
 *
 * Redirects are relative so the browser resolves them against the origin it
 * is already on, which is what keeps the session cookie and the destination
 * on the same host (see the note in app/auth/confirm/page.tsx).
 */
async function submitCode(formData: FormData) {
  "use server";

  const type = resolveCodeType(formDataString(formData, "type"));
  const email = normalizeEmail(formDataString(formData, "email"));
  const code = normalizeOtp(formDataString(formData, "code"));

  if (!email) {
    redirect(codePath(type, email, "missing_email"));
  }

  if (!isValidOtpShape(code)) {
    redirect(codePath(type, email, "bad_code"));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ email, token: code, type });

  if (error) {
    redirect(codePath(type, email, "rejected"));
  }

  redirect(confirmDestination(type === "invite" ? "invite" : "recovery", null));
}

/**
 * Errors are rendered from a closed set of codes, never from raw Supabase
 * text — the same information-disclosure guard `/auth/confirm` applies
 * (T-quick260901-02). The email is echoed back so a failed attempt does not
 * make the person retype it.
 */
function codePath(type: string, email: string, error: string): string {
  const query = new URLSearchParams({ type, error });
  if (email) query.set("email", email);
  return `/auth/code?${query.toString()}`;
}

const CODE_ERRORS: Record<string, string> = {
  missing_email: "Enter the email address the code was sent to.",
  bad_code: OTP_FORMAT_MESSAGE,
  rejected:
    "That code was not accepted. It may have expired, already been used, or belong to a different email address. Ask an admin to send a fresh one.",
};

function errorFor(code: string | null): string | null {
  if (!code) return null;
  return CODE_ERRORS[code] ?? null;
}

function firstValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function formDataString(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === "string" && value.length > 0 ? value : null;
}
