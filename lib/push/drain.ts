/**
 * `drainInbox` — the pure drain core behind `POST /api/ingest/drain`
 * (AUTO-05). Pure over injected dependencies: acquire mutex, release mutex,
 * list prefixes, list objects within a prefix, download an object, remove
 * an object, and an ingest-one callback.
 */

export interface DrainObjectOutcome {
  key: string;
  /** "terminal" = the ingest-one callback resolved (done, failed, or alreadyUploaded alike) and the object was removed. "errored" = the callback (or the download) threw, and the object was deliberately left in place. */
  outcome: "terminal" | "errored";
  result?: unknown;
  error?: unknown;
}

export interface DrainDeps {
  /** False when a drain is already in progress — the caller answers 409 and does no Storage or ingest work. */
  tryAcquireLock(): Promise<boolean>;
  /** Always called in a finally block, including when the loop threw. */
  releaseLock(): Promise<void>;
  /** Lists the bucket root's credential-id prefixes (Storage's folder pseudo-entries). */
  listPrefixes(): Promise<string[]>;
  /** Lists object names within one prefix (not full paths). */
  listObjectsInPrefix(prefix: string): Promise<string[]>;
  downloadObject(objectKey: string): Promise<Uint8Array>;
  removeObject(objectKey: string): Promise<void>;
  /**
   * Called once per object with the object's key and bytes. Resolving
   * (whatever the ingest outcome — done, failed, or alreadyUploaded) is a
   * TERMINAL outcome and the object is removed. Throwing/rejecting is an
   * UNEXPECTED outcome and the object is deliberately left in place — the
   * original bytes are already persisted to `reports` by `recordFile` and
   * any outcome already reached is already in `ingested_files`, so nothing
   * is lost by leaving the inbox object as the signal Phase 10 reads.
   */
  ingestOne(objectKey: string, bytes: Uint8Array): Promise<unknown>;
}

export interface DrainResult {
  status: number;
  processed: number;
  outcomes: DrainObjectOutcome[];
}

export async function drainInbox(deps: DrainDeps): Promise<DrainResult> {
  const acquired = await deps.tryAcquireLock();
  if (!acquired) {
    // Held mutex: 409, no listing, no download, no ingest.
    return { status: 409, processed: 0, outcomes: [] };
  }

  const outcomes: DrainObjectOutcome[] = [];
  try {
    // Deterministic order: sender prefix ascending, then object name
    // ascending — so which of two identical-content objects wins the row
    // is decided by a stated rule, not by Storage listing luck.
    const prefixes = [...(await deps.listPrefixes())].sort();
    for (const prefix of prefixes) {
      const names = [...(await deps.listObjectsInPrefix(prefix))].sort();
      for (const name of names) {
        const key = `${prefix}/${name}`;
        try {
          const bytes = await deps.downloadObject(key);
          const result = await deps.ingestOne(key, bytes);
          await deps.removeObject(key);
          outcomes.push({ key, outcome: "terminal", result });
        } catch (error) {
          outcomes.push({ key, outcome: "errored", error });
        }
      }
    }
  } finally {
    // Always release, including when the loop above threw something this
    // function itself doesn't catch (e.g. listPrefixes/listObjectsInPrefix
    // failing) — a stuck mutex is a self-inflicted denial of service on a
    // job that runs once a day.
    await deps.releaseLock();
  }

  return {
    status: 200,
    processed: outcomes.filter((o) => o.outcome === "terminal").length,
    outcomes,
  };
}
