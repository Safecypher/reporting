// RED STUB — intentionally wrong bodies so the RED test run fails on real
// assertions (not a module-not-found/collection error). Replaced by the real
// implementation in the GREEN commit.
import type { FreshnessResolution } from "@/lib/dashboard/freshness";

export interface OverdueGroupItem {
  label: string;
  lastCoveredDay: string;
}

export interface FailedToParseGroupItem {
  label: string;
  fileCount: number;
}

export interface NeverArrivedGroupItem {
  label: string;
}

export interface InboxStuckGroup {
  count: number;
  since: string | null;
}

export interface WrongStateGroups {
  overdue: OverdueGroupItem[];
  failedToParse: FailedToParseGroupItem[];
  neverArrived: NeverArrivedGroupItem[];
  inboxStuck: InboxStuckGroup | null;
  hasAnything: boolean;
}

export function groupWrongStates(
  _items: FreshnessResolution[],
  _stuckCount: number,
  _stuckSince: string | null,
): WrongStateGroups {
  return { overdue: [], failedToParse: [], neverArrived: [], inboxStuck: null, hasAnything: false };
}

export function formatSlackAlertText(_groups: WrongStateGroups): string | null {
  return "WRONG STUB TEXT";
}

export async function postSlackAlert(
  _webhookUrl: string,
  _text: string,
  _fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; status: number; body?: string; error?: string }> {
  return { ok: true, status: 999 };
}
