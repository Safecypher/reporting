import Image from "next/image";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  type SafeErrorCode,
  confirmDestination,
  isSupportedType,
  sanitizeNext,
} from "@/lib/auth/confirm";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export const runtime = "nodejs";

/**
 * GET /auth/confirm — the interstitial. It does NOT consume the token.
 *
 * WHY THIS IS NOT A ROUTE HANDLER ANY MORE (quick 261002-k0l)
 *
 * It used to be, and it called verifyOtp directly on GET. Measured live on
 * 2026-10-02, a single click produced two near-simultaneous GETs landing on
 * two different Netlify function instances:
 *
 *     13:17:19  /verify  200              from 18.225.113.104
 *     13:17:19  /verify  403 otp_expired  from 18.218.233.75
 *
 * Both called verifyOtp with the same single-use token. One won and was
 * handed the session; the other lost. The user's browser received the
 * loser's response, so they were told the link had expired while the
 * database recorded them as confirmed, with a session whose user_agent is
 * "node" and whose IP is the Netlify function — a session that was never
 * theirs and that they could not use.
 *
 * The duplication is systematic: every click in the logs produced two or
 * more hits. Whether the second request comes from email-client prefetch, a
 * link scanner or a Netlify cold-start retry was never established — and
 * this fix deliberately does not depend on knowing. A GET now costs nothing,
 * which neutralises all three at once. Only the POST below spends the token,
 * and only a human clicking Continue issues one.
 *
 * `/auth/confirm` stays excluded from the proxy.ts auth gate (it is the
 * route that ESTABLISHES the session, so it cannot require one), while
 * `/set-password` stays behind it — unchanged by this rewrite.
 */
export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const tokenHash = firstValue(params.token_hash);
  const rawType = firstValue(params.type);
  const next = sanitizeNext(firstValue(params.next));

  // Bail before rendering anything if the link is malformed. This costs no
  // token — nothing has been sent to Supabase at this point.
  if (!tokenHash || !isSupportedType(rawType)) {
    redirect(loginPath("missing_params"));
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
              {rawType === "recovery" ? "Reset your password" : "Confirm your account"}
            </h1>
            <p className="text-sm font-light text-muted-foreground">
              Continue to finish signing in to Safecypher Reporting.
            </p>
          </CardHeader>
          <CardContent>
            <form action={confirmAction} className="flex flex-col gap-4">
              <input type="hidden" name="token_hash" value={tokenHash} />
              <input type="hidden" name="type" value={rawType} />
              {next ? <input type="hidden" name="next" value={next} /> : null}
              <Button type="submit" className="h-9 w-full">
                Continue
              </Button>
              <p className="text-xs font-light text-muted-foreground">
                This link can only be used once. Open it on the device where
                you want to sign in.
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/**
 * The Server Action — a POST — is the ONLY thing that consumes the token.
 *
 * It re-validates every input from scratch rather than trusting the hidden
 * fields the page rendered. Those fields are user-controllable, so this is an
 * independent untrusted entry point and the T-quick260901-01/-03 guards must
 * hold here on their own merits, exactly as they do in the Server Actions
 * under /settings/sources.
 *
 * Redirects are RELATIVE, which supersedes the getSiteOrigin helper that
 * quick-260902-ksy added for the Route Handler. `NextResponse.redirect`
 * required an absolute URL, and `request.url` reported a deploy-unique
 * Netlify host that did not match the session cookie's host — stranding the
 * invitee on a different origin with the token already spent. A relative
 * Location is resolved by the browser against the origin it is already on, so
 * that class of bug cannot occur here at all.
 */
async function confirmAction(formData: FormData) {
  "use server";

  const tokenHash = formDataString(formData, "token_hash");
  const rawType = formDataString(formData, "type");
  const next = sanitizeNext(formDataString(formData, "next"));

  if (!tokenHash || !isSupportedType(rawType)) {
    redirect(loginPath("missing_params"));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    type: rawType,
    token_hash: tokenHash,
  });

  if (error) {
    redirect(loginPath("invalid_or_expired"));
  }

  redirect(confirmDestination(rawType, next));
}

function loginPath(error: SafeErrorCode): string {
  return `/login?error=${error}`;
}

/**
 * A repeated query param (`?type=invite&type=recovery`) arrives as an array.
 * Take the first value rather than letting an array reach the type guard,
 * where it would stringify to something that is never a supported type but
 * for a confusing reason.
 */
function firstValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function formDataString(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === "string" && value.length > 0 ? value : null;
}
