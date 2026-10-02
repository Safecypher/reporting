"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  PUSH_FILE_FIELD,
  PUSH_MAX_REQUEST_MB,
  buildSenderInstructions,
} from "@/lib/push/endpoint";

/**
 * The integration details a sender needs, always on screen.
 *
 * Added by quick-261002-p6r. Issuing a credential previously gave you the
 * token and nothing else — the endpoint URL, the field name and the response
 * contract lived only in the code and the README, so whoever onboarded a
 * sender had to reconstruct them. This panel is re-readable at any time,
 * unlike the token itself, which is shown once (D-05).
 *
 * `endpointUrl` is resolved on the server from NEXT_PUBLIC_SITE_URL and may
 * be null — in which case this renders what to fix rather than a half-built
 * URL that a sender might paste and try.
 */
export function EndpointInstructions({
  endpointUrl,
}: {
  endpointUrl: string | null;
}) {
  const [copied, setCopied] = useState(false);

  if (!endpointUrl) {
    return (
      <div className="rounded-lg border border-[color:var(--warning-border)] bg-[color:var(--warning-bg)] p-4">
        <p className="text-sm text-[color:var(--warning)]">
          The endpoint URL can&apos;t be shown because{" "}
          <code className="font-mono text-xs">NEXT_PUBLIC_SITE_URL</code> is not
          set for this deployment. Set it in Netlify (Site configuration →
          Environment variables) to the app&apos;s canonical origin, with no
          trailing slash.
        </p>
      </div>
    );
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(
        buildSenderInstructions({
          sender: "your organisation",
          endpointUrl: endpointUrl!,
        }),
      );
      setCopied(true);
      toast("Instructions copied");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Copy failed — select the text and copy manually");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <dl className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-4">
        <Row label="Endpoint">
          <code className="break-all font-mono text-xs text-foreground">
            POST {endpointUrl}
          </code>
        </Row>
        <Row label="Authentication">
          <code className="break-all font-mono text-xs text-foreground">
            Authorization: Bearer &lt;token&gt;
          </code>
        </Row>
        <Row label="Body">
          <code className="break-all font-mono text-xs text-foreground">
            multipart/form-data — one or more parts named &quot;
            {PUSH_FILE_FIELD}&quot;
          </code>
        </Row>
        <Row label="Size limit">
          <span className="text-xs text-foreground">
            {PUSH_MAX_REQUEST_MB}MB per request
          </span>
        </Row>
        <Row label="Responses">
          <span className="text-xs text-foreground">
            202 all accepted · 207 mixed · 400 none accepted or malformed · 401
            token missing, unknown or revoked
          </span>
        </Row>
      </dl>

      <p className="max-w-2xl text-sm font-light text-muted-foreground">
        A 202 means the file <strong>arrived</strong>, not that it parsed.
        Files are interpreted on a daily schedule after delivery, so a parse
        problem is reported separately and is never a failure of the
        sender&apos;s upload request.
      </p>

      <div>
        <Button type="button" variant="outline" onClick={handleCopy}>
          {copied ? "Copied" : "Copy instructions"}
        </Button>
      </div>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:gap-4">
      <dt className="shrink-0 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground sm:w-32">
        {label}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
