"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ComponentPropsWithoutRef } from "react";

import { serializeDrillParams, type DrillFilter } from "@/lib/dashboard/drill-params";
import { cn } from "@/lib/utils";

/** Every key `serializeDrillParams` can ever emit — used to clear a drill cleanly. */
const DRILL_KEYS = ["drill", "date", "authenticated", "tierOrder"] as const;

/**
 * URL-synced drill-down state (D-10). `openDrill`/`closeDrill` both use
 * `router.replace` — never `push` — so opening/closing a drill never
 * pollutes browser history. Any component calling this hook (via
 * `useSearchParams` under the hood) must be rendered inside a `<Suspense>`
 * boundary at its usage site, or `next build` fails (Pitfall 3).
 */
export function useDrill() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function openDrill(filter: DrillFilter) {
    const params = new URLSearchParams(searchParams.toString());
    const serialized = serializeDrillParams(filter);
    for (const [key, value] of Object.entries(serialized)) {
      params.set(key, value);
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function closeDrill() {
    const params = new URLSearchParams(searchParams.toString());
    for (const key of DRILL_KEYS) {
      params.delete(key);
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return { openDrill, closeDrill };
}

interface DrillableMetricProps extends ComponentPropsWithoutRef<"button"> {
  filter: DrillFilter;
}

/**
 * Wraps a clickable summary metric (KPI, tier row, breach row, verification
 * count) with the drill-open behaviour. A real `<button>` so it is
 * keyboard-operable by default (Enter/Space) and picks up the app's global
 * `:focus-visible` ring (`--focus-ring`, app/globals.css) with no extra
 * classes needed.
 */
export function DrillableMetric({
  filter,
  className,
  children,
  ...props
}: DrillableMetricProps) {
  const { openDrill } = useDrill();

  return (
    <button
      type="button"
      onClick={() => openDrill(filter)}
      className={cn("cursor-pointer text-left", className)}
      {...props}
    >
      {children}
    </button>
  );
}
