import { Suspense } from "react";
import type { Metadata } from "next";

import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/server";
import {
  PricingTierForm,
  type PricingTierSetWithTiers,
} from "@/components/pricing/pricing-tier-form";
import { AuditLog, type AuditLogEntry } from "@/components/pricing/audit-log";

export const metadata: Metadata = {
  title: "Pricing tiers — Safecypher Reporting",
};

/** Cap on the pricing_tier_audit read (matches /settings/general's
 * AUDIT_ROW_CAP precedent, 05-03). */
const AUDIT_ROW_CAP = 50;

type PricingTierAuditRow = {
  id: number;
  changed_by: string | null;
  changed_at: string;
  summary: string;
};

type PricingTierSetRow = {
  id: string;
  effective_from: string;
  reset_window: string;
};

type PricingTierRow = {
  tier_set_id: string;
  tier_order: number;
  upper_bound: number | null;
  rate: number;
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
        Select an existing tier set to correct it in place, or add a new
        one — a change that touches an already-elapsed day is audited and
        confirmed before it restates revenue.
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
 * Async Server Component reading pricing_tier_audit + every pricing_tier_sets
 * row (with its tiers) via the session-scoped client (RLS: authenticated
 * select-only) so change history and the full tier-set-to-edit list are
 * visible to any logged-in user (L-06/D-06/D-17). No email-resolving view
 * exists yet (auth.users is not otherwise exposed in this codebase) — the
 * acting user's id is shown verbatim as a documented, non-blocking gap; see
 * SUMMARY "Known Stubs".
 */
async function PricingBody() {
  const supabase = await createClient();

  const [auditResult, tierSetsResult, tiersResult] = await Promise.all([
    supabase
      .from("pricing_tier_audit")
      .select("id, changed_by, changed_at, summary")
      .order("changed_at", { ascending: false })
      .limit(50) // AUDIT_ROW_CAP — literal at the call site (05-03 precedent)
      .returns<PricingTierAuditRow[]>(),
    supabase
      .from("pricing_tier_sets")
      .select("id, effective_from, reset_window")
      .order("effective_from", { ascending: false })
      .returns<PricingTierSetRow[]>(),
    supabase
      .from("pricing_tiers")
      .select("tier_set_id, tier_order, upper_bound, rate")
      .order("tier_set_id", { ascending: true })
      .order("tier_order", { ascending: true })
      .returns<PricingTierRow[]>(),
  ]);

  if (auditResult.error || tierSetsResult.error || tiersResult.error) {
    return (
      <>
        <PageHeader />
        <ErrorState />
      </>
    );
  }

  const auditRows = auditResult.data ?? [];
  const entries: AuditLogEntry[] = auditRows.map((row) => ({
    id: row.id,
    actor: row.changed_by ?? "Unknown user",
    summary: row.summary,
    changedAt: row.changed_at,
  }));
  const atCap = auditRows.length === AUDIT_ROW_CAP;

  const tiersBySetId = new Map<string, { upperBound: number | null; rate: number }[]>();
  for (const tier of tiersResult.data ?? []) {
    const list = tiersBySetId.get(tier.tier_set_id) ?? [];
    list.push({ upperBound: tier.upper_bound, rate: tier.rate });
    tiersBySetId.set(tier.tier_set_id, list);
  }

  const tierSets: PricingTierSetWithTiers[] = (tierSetsResult.data ?? []).map((row) => ({
    id: row.id,
    effectiveFrom: row.effective_from,
    resetWindow: row.reset_window,
    tiers: tiersBySetId.get(row.id) ?? [],
  }));

  return (
    <>
      <PageHeader />
      <PricingTierForm tierSets={tierSets} />
      <div className="flex flex-col gap-2">
        <AuditLog entries={entries} />
        {atCap && (
          <p className="text-xs font-light text-muted-foreground">
            Showing the {AUDIT_ROW_CAP} most recent changes.
          </p>
        )}
      </div>
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
