import { describe, expect, it, vi } from "vitest";
import { buildManualObjectKey, type InboxListEntry } from "@/lib/ingestion/inbox-object";
import {
  RECEIVED_EXPLANATION,
  RECEIVED_HEADING,
  RECEIVED_LIST_LIMIT,
  buildReceivedList,
  formatWaitingCaption,
  listReceivedManualObjects,
  type InboxStorageClient,
} from "@/lib/upload/inbox-received";

/**
 * 14-05 Task 3 (P14-08, D-10): the view model behind the "Received, not yet
 * processed" block on /uploads. Pure apart from listReceivedManualObjects, whose
 * Storage client is injected.
 */

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const AS_OF = new Date("2026-10-20T12:00:00.000Z");
const NONCE = "0123456789abcdef";

const minutesBefore = (n: number) => new Date(AS_OF.getTime() - n * 60_000).toISOString();

function entryFor(userId: string, fileName: string, mintedMinutesAgo: number, createdAt?: string | null): InboxListEntry {
  const minted = new Date(AS_OF.getTime() - mintedMinutesAgo * 60_000);
  const key = buildManualObjectKey(userId, fileName, minted, NONCE);
  return {
    name: key.slice("manual/".length),
    created_at: createdAt === undefined ? minted.toISOString() : createdAt,
    metadata: { size: 100 },
  };
}

describe("formatWaitingCaption (D-10)", () => {
  const caption = (secondsAgo: number) =>
    formatWaitingCaption(new Date(AS_OF.getTime() - secondsAgo * 1000).toISOString(), AS_OF);

  it.each<[string, number, string]>([
    ["20 seconds", 20, "Waiting under a minute"],
    ["5 minutes", 5 * 60, "Waiting 5 min"],
    ["1 hour", 60 * 60, "Waiting 1 hour"],
    ["3 hours", 3 * 3600, "Waiting 3 hours"],
    ["1 day", 24 * 3600, "Waiting 1 day"],
    ["2 days", 48 * 3600, "Waiting 2 days"],
  ])("%s reads %s", (_label, seconds, expected) => {
    expect(caption(seconds)).toBe(expected);
  });

  it("clamps a received time after asOf to under a minute rather than a negative duration", () => {
    expect(formatWaitingCaption(new Date(AS_OF.getTime() + 90_000).toISOString(), AS_OF)).toBe(
      "Waiting under a minute"
    );
  });

  it("rounds down at each boundary: 59 minutes is minutes, 23 hours is hours", () => {
    expect(caption(59 * 60)).toBe("Waiting 59 min");
    expect(caption(23 * 3600 + 59 * 60)).toBe("Waiting 23 hours");
  });
});

describe("buildReceivedList (D-10)", () => {
  const emails = new Map([
    [USER_A, "andy@safecypher.com"],
    [USER_B, "richard@safecypher.com"],
  ]);

  it("returns rows newest first", () => {
    const older = entryFor(USER_A, "older.csv", 300);
    const newer = entryFor(USER_B, "newer.csv", 30);

    const rows = buildReceivedList([older, newer], AS_OF, emails);

    expect(rows.map((r) => r.fileName)).toEqual(["newer.csv", "older.csv"]);
  });

  it("labels the uploader from the key's user id, and falls back to unknown user when the email is unresolved", () => {
    const known = entryFor(USER_A, "known.csv", 10);
    const unknown = entryFor(USER_B, "unknown.csv", 20);

    const rows = buildReceivedList([known, unknown], AS_OF, new Map([[USER_A, "andy@safecypher.com"]]));

    expect(rows[0].uploaderLabel).toBe("Manual — andy@safecypher.com");
    expect(rows[1].uploaderLabel).toBe("Manual — unknown user");
  });

  it("keeps an unparseable manual name, with an unknown uploader and its created_at as the received time", () => {
    const odd: InboxListEntry = { name: "hand-dropped.csv", created_at: minutesBefore(45), metadata: { size: 5 } };

    const rows = buildReceivedList([odd], AS_OF, emails);

    expect(rows).toEqual([
      {
        key: "manual/hand-dropped.csv",
        fileName: "hand-dropped.csv",
        uploaderLabel: "Manual — unknown user",
        receivedAt: minutesBefore(45),
        waitingCaption: "Waiting 45 min",
      },
    ]);
  });

  it("uses created_at as the received time, and the key's minted instant when created_at is null", () => {
    const withCreated = entryFor(USER_A, "a.csv", 120, minutesBefore(100));
    const withoutCreated = entryFor(USER_B, "b.csv", 60, null);

    const rows = buildReceivedList([withCreated, withoutCreated], AS_OF, emails);

    const byName = Object.fromEntries(rows.map((r) => [r.fileName, r]));
    expect(byName["a.csv"].receivedAt).toBe(minutesBefore(100));
    expect(byName["b.csv"].receivedAt).toBe("2026-10-20T11:00:00Z");
    expect(byName["b.csv"].waitingCaption).toBe("Waiting 1 hour");
  });

  it("skips folder entries and dot-files", () => {
    const real = entryFor(USER_A, "real.csv", 10);
    const entries: InboxListEntry[] = [
      { name: ".emptyFolderPlaceholder", created_at: minutesBefore(900), metadata: { size: 0 } },
      { name: "nested", created_at: null, metadata: null },
      real,
    ];

    const rows = buildReceivedList(entries, AS_OF, emails);

    expect(rows).toHaveLength(1);
    expect(rows[0].fileName).toBe("real.csv");
    expect(rows[0].key).toBe(`manual/${real.name}`);
  });

  it("returns an empty list for no entries", () => {
    expect(buildReceivedList([], AS_OF, emails)).toEqual([]);
  });
});

describe("listReceivedManualObjects (P14-08)", () => {
  function storageWith(list: ReturnType<typeof vi.fn>): InboxStorageClient {
    return { from: vi.fn(() => ({ list })) } as unknown as InboxStorageClient;
  }

  it("lists the manual prefix of the inbox bucket, newest first, with the page limit", async () => {
    const data: InboxListEntry[] = [{ name: "x.csv", created_at: null, metadata: { size: 1 } }];
    const list = vi.fn(async () => ({ data, error: null }));
    const storage = storageWith(list);

    const result = await listReceivedManualObjects(storage);

    expect(storage.from).toHaveBeenCalledWith("inbox");
    expect(list).toHaveBeenCalledExactlyOnceWith("manual", {
      limit: 100,
      sortBy: { column: "created_at", order: "desc" },
    });
    expect(RECEIVED_LIST_LIMIT).toBe(100);
    expect(result).toEqual({ entries: data, error: null });
  });

  it("returns the error message and no entries when Storage reports an error", async () => {
    const list = vi.fn(async () => ({ data: null, error: { message: "bucket unavailable" } }));

    expect(await listReceivedManualObjects(storageWith(list))).toEqual({ entries: [], error: "bucket unavailable" });
  });

  it("never rejects: a throwing list returns the same shape", async () => {
    const list = vi.fn(async () => {
      throw new Error("network down");
    });

    await expect(listReceivedManualObjects(storageWith(list))).resolves.toEqual({
      entries: [],
      error: "network down",
    });
  });

  it("treats a null data with no error as an empty listing", async () => {
    const list = vi.fn(async () => ({ data: null, error: null }));

    expect(await listReceivedManualObjects(storageWith(list))).toEqual({ entries: [], error: null });
  });
});

describe("copy", () => {
  it("pins the heading and the explanation", () => {
    expect(RECEIVED_HEADING).toBe("Received, not yet processed");
    expect(RECEIVED_EXPLANATION).toBe(
      "These files reached the system but have not been checked yet. The next daily run processes them automatically; nothing needs re-uploading."
    );
  });
});
