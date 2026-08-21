import { Suspense } from "react";
import type { Metadata } from "next";

import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/server";
import { PricingTierForm } from "@/components/pricing/pricing-tier-form";
import { AuditLog, type AuditLogEntry } from "@/components/pricing/audit-log";
import { DeleteLatestTierSet } from "@/components/pricing/delete-latest-tier-set";

export const metadata: Metadata = {
  title: "Pricing tiers — Safecypher Reporting",
};

type PricingTierAuditRow = {
  id: number;
  changed_by: string | null;
  changed_at: string;
  summary: string;
};

type LatestPricingTierSetRow = {
  id: string;
  effective_from: string;
};

function PageHeader() {
  return (
    <div className="flex flex-col gap-2 border-b border-border pb-4">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">
        Settings
      </p>
      <h1 className="text-2xl font-medium text-foreground">Pricing tiers</h1>
      <p className="max-w-2xl text-sm font-light text-muted-foreground">
        Configure the tier thresholds and rates used to compute revenue.
        Changes apply from the effective date you choose and never rewrite
        past revenue.
      </p>
    </div>
  );
}

function ErrorState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-border bg-destructive/5 p-12 text-center">
      <svg aria-hidden="true" className="size-8 text-destructive">
        <use href="/icons.svg#alert" />
      </svg>
      <h2 className="text-lg font-medium text-foreground">
        Pricing tiers could not be loaded
      </h2>
      <p className="max-w-md text-sm font-light text-muted-foreground">
        Something went wrong reading the pricing change history. Try
        refreshing the page.
      </p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 border-b border-border pb-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-96" />
      </div>
      <Skeleton className="h-[420px] w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

/**
 * Async Server Component reading pricing_tier_audit via the session-scoped
 * client (RLS: authenticated select-only) so change history is visible to
 * any logged-in user (L-06/D-06). No email-resolving view exists yet
 * (auth.users is not otherwise exposed in this codebase) — the acting
 * user's id is shown verbatim as a documented, non-blocking gap; see
 * SUMMARY "Known Stubs".
 */
async function PricingBody() {
  const supabase = await createClient();

  const [auditResult, latestSetResult] = await Promise.all([
    supabase
      .from("pricing_tier_audit")
      .select("id, changed_by, changed_at, summary")
      .order("changed_at", { ascending: false })
      .returns<PricingTierAuditRow[]>(),
    supabase
      .from("pricing_tier_sets")
      .select("id, effective_from")
      .order("effective_from", { ascending: false })
      .limit(1)
      .returns<LatestPricingTierSetRow[]>()
      .maybeSingle(),
  ]);

  if (auditResult.error || latestSetResult.error) {
    return (
      <>
        <PageHeader />
        <ErrorState />
      </>
    );
  }

  const entries: AuditLogEntry[] = (auditResult.data ?? []).map((row) => ({
    id: row.id,
    actor: row.changed_by ?? "Unknown user",
    summary: row.summary,
    changedAt: row.changed_at,
  }));

  const latestSet = latestSetResult.data;

  return (
    <>
      <PageHeader />
      <PricingTierForm />
      {latestSet && (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-6">
          <p className="text-sm font-medium text-foreground">
            Correct a mistake
          </p>
          <p className="max-w-2xl text-sm font-light text-muted-foreground">
            Accidentally saved the wrong tiers? You can remove only the most
            recent pricing tier set (effective {latestSet.effective_from}).
          </p>
          <DeleteLatestTierSet
            tierSetId={latestSet.id}
            effectiveFrom={latestSet.effective_from}
          />
        </div>
      )}
      <AuditLog entries={entries} />
    </>
  );
}

export default function PricingSettingsPage() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <Suspense fallback={<LoadingState />}>
        <PricingBody />
      </Suspense>
    </div>
  );
}
