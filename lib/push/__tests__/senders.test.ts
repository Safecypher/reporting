import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  mintCredentialSchema,
  revokeCredentialSchema,
} from "../schema";
import {
  distinctSenders,
  formatLastUsed,
  isSoleLiveCredential,
  rotatingSenders,
  sortCredentials,
  type PushCredentialRow,
} from "../credentials";

/**
 * lib/push/__tests__/senders.test.ts — Task 1's own test coverage for the
 * /settings/senders write path: the shared Zod schemas, every pure
 * list-presentation rule in lib/push/credentials.ts, and the shape
 * guarantee that the complete token exists on exactly one return path.
 *
 * `@/lib/supabase/server` is mocked the way
 * `lib/settings/__tests__/alignment-settings.test.ts` already mocks it —
 * invoking the real Server Action against a stubbed Supabase client proves
 * the actual shipped code, not a parallel description of it.
 */

describe("mintCredentialSchema", () => {
  it("trims a sender name with surrounding whitespace", () => {
    const result = mintCredentialSchema.safeParse({ sender: "  TSYS  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sender).toBe("TSYS");
    }
  });

  it("rejects an empty sender name", () => {
    expect(mintCredentialSchema.safeParse({ sender: "" }).success).toBe(false);
  });

  it("rejects a whitespace-only sender name", () => {
    expect(mintCredentialSchema.safeParse({ sender: "   " }).success).toBe(
      false,
    );
  });

  it("rejects a 101-character sender name", () => {
    expect(
      mintCredentialSchema.safeParse({ sender: "a".repeat(101) }).success,
    ).toBe(false);
  });

  it("accepts a 100-character sender name", () => {
    expect(
      mintCredentialSchema.safeParse({ sender: "a".repeat(100) }).success,
    ).toBe(true);
  });
});

describe("revokeCredentialSchema", () => {
  it("rejects a non-uuid credential id", () => {
    expect(
      revokeCredentialSchema.safeParse({ id: "not-a-uuid" }).success,
    ).toBe(false);
  });

  it("accepts a valid uuid", () => {
    expect(
      revokeCredentialSchema.safeParse({
        id: "123e4567-e89b-12d3-a456-426614174000",
      }).success,
    ).toBe(true);
  });
});

function makeRow(overrides: Partial<PushCredentialRow>): PushCredentialRow {
  return {
    id: "id-default",
    sender: "TSYS",
    token_prefix: "sc_live_aaaaaaaa",
    created_at: "2026-09-01T00:00:00.000Z",
    last_used_at: null,
    revoked_at: null,
    ...overrides,
  };
}

describe("sortCredentials", () => {
  it("orders by sender ascending, then created-at descending within a sender", () => {
    const rows = [
      makeRow({ id: "b-old", sender: "Bit Addict", created_at: "2026-09-01T00:00:00.000Z" }),
      makeRow({ id: "t-new", sender: "TSYS", created_at: "2026-09-10T00:00:00.000Z" }),
      makeRow({ id: "t-old", sender: "TSYS", created_at: "2026-09-05T00:00:00.000Z" }),
      makeRow({ id: "b-new", sender: "Bit Addict", created_at: "2026-09-08T00:00:00.000Z" }),
    ];

    const sorted = sortCredentials(rows).map((row) => row.id);

    expect(sorted).toEqual(["b-new", "b-old", "t-new", "t-old"]);
  });

  it("is stable for equal sender and created-at", () => {
    const rows = [
      makeRow({ id: "first", sender: "TSYS", created_at: "2026-09-01T00:00:00.000Z" }),
      makeRow({ id: "second", sender: "TSYS", created_at: "2026-09-01T00:00:00.000Z" }),
    ];

    expect(sortCredentials(rows).map((row) => row.id)).toEqual([
      "first",
      "second",
    ]);
  });
});

describe("rotatingSenders", () => {
  it("fires at two live credentials for one sender", () => {
    const rows = [
      makeRow({ id: "a", sender: "TSYS", revoked_at: null }),
      makeRow({ id: "b", sender: "TSYS", revoked_at: null }),
    ];

    expect(rotatingSenders(rows).has("TSYS")).toBe(true);
  });

  it("does not fire at one live plus one revoked credential", () => {
    const rows = [
      makeRow({ id: "a", sender: "TSYS", revoked_at: null }),
      makeRow({ id: "b", sender: "TSYS", revoked_at: "2026-09-02T00:00:00.000Z" }),
    ];

    expect(rotatingSenders(rows).has("TSYS")).toBe(false);
  });
});

describe("isSoleLiveCredential", () => {
  it("is true for the last live credential", () => {
    const rows = [
      makeRow({ id: "a", sender: "TSYS", revoked_at: null }),
      makeRow({ id: "b", sender: "TSYS", revoked_at: "2026-09-02T00:00:00.000Z" }),
    ];

    expect(isSoleLiveCredential(rows, "a")).toBe(true);
  });

  it("is false when a sibling credential is also live", () => {
    const rows = [
      makeRow({ id: "a", sender: "TSYS", revoked_at: null }),
      makeRow({ id: "b", sender: "TSYS", revoked_at: null }),
    ];

    expect(isSoleLiveCredential(rows, "a")).toBe(false);
  });
});

describe("distinctSenders", () => {
  it("keeps differently-cased sender names as separate entries", () => {
    const rows = [
      makeRow({ id: "a", sender: "TSYS" }),
      makeRow({ id: "b", sender: "tsys" }),
      makeRow({ id: "c", sender: "Bit Addict" }),
    ];

    const senders = distinctSenders(rows);

    expect(senders).toContain("TSYS");
    expect(senders).toContain("tsys");
    expect(senders).toContain("Bit Addict");
    expect(senders).toHaveLength(3);
  });
});

describe("formatLastUsed", () => {
  it("returns null for a null timestamp", () => {
    expect(formatLastUsed(null)).toBeNull();
  });

  it("returns a formatted string for a non-null timestamp", () => {
    expect(typeof formatLastUsed("2026-09-01T12:00:00.000Z")).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// Route-level: the shape guarantee that the complete token exists on exactly
// one return path, and every other path is auth/error/already-revoked.
// ---------------------------------------------------------------------------

const insertMock = vi.fn();
const updateEqIsSelectMock = vi.fn();
const getUserMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: getUserMock },
    from: vi.fn(() => ({
      insert: insertMock,
      update: () => ({
        eq: () => ({
          is: () => ({
            select: updateEqIsSelectMock,
          }),
        }),
      }),
    })),
  })),
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

const { issuePushCredential, revokePushCredential } = await import(
  "@/app/(dashboard)/settings/senders/actions"
);

describe("issuePushCredential", () => {
  beforeEach(() => {
    insertMock.mockReset().mockResolvedValue({ error: null });
    getUserMock
      .mockReset()
      .mockResolvedValue({ data: { user: { id: "user-1" } } });
    revalidatePathMock.mockClear();
  });

  it("refuses an unauthenticated caller before touching the database", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    const result = await issuePushCredential({ sender: "TSYS" });

    expect(result).toEqual({ error: "Unauthorized" });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("returns the complete token exactly once, alongside the prefix and sender", async () => {
    const result = await issuePushCredential({ sender: "TSYS" });

    expect(result).toMatchObject({ success: true, sender: "TSYS" });
    if ("success" in result) {
      expect(typeof result.token).toBe("string");
      expect(result.token.startsWith("sc_live_")).toBe(true);
      expect(result.prefix.startsWith("sc_live_")).toBe(true);
    } else {
      throw new Error("expected a success result");
    }
  });

  it("persists only the digest and the prefix — never the complete token", async () => {
    await issuePushCredential({ sender: "TSYS" });

    expect(insertMock).toHaveBeenCalledTimes(1);
    const payload = insertMock.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toHaveProperty("token_sha256");
    expect(payload).toHaveProperty("token_prefix");
    expect(payload).not.toHaveProperty("token");
  });

  it("a validation failure never carries a token-shaped value", async () => {
    const result = await issuePushCredential({ sender: "" });

    expect(result).not.toHaveProperty("token");
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("a database error never carries a token-shaped value", async () => {
    insertMock.mockResolvedValue({ error: { message: "boom" } });

    const result = await issuePushCredential({ sender: "TSYS" });

    expect(result).not.toHaveProperty("token");
    expect(result).toHaveProperty("error");
  });
});

describe("revokePushCredential", () => {
  const validId = "123e4567-e89b-12d3-a456-426614174000";

  beforeEach(() => {
    updateEqIsSelectMock.mockReset().mockResolvedValue({
      data: [{ id: validId }],
      error: null,
    });
    getUserMock
      .mockReset()
      .mockResolvedValue({ data: { user: { id: "user-1" } } });
    revalidatePathMock.mockClear();
  });

  it("refuses an unauthenticated caller before touching the database", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    const result = await revokePushCredential({ id: validId });

    expect(result).toEqual({ error: "Unauthorized" });
    expect(updateEqIsSelectMock).not.toHaveBeenCalled();
  });

  it("succeeds when the update affects a row and never carries a token", async () => {
    const result = await revokePushCredential({ id: validId });

    expect(result).toEqual({ success: true });
    expect(result).not.toHaveProperty("token");
  });

  it("returns an explicit already-revoked result, not a silent success, when zero rows match", async () => {
    updateEqIsSelectMock.mockResolvedValue({ data: [], error: null });

    const result = await revokePushCredential({ id: validId });

    expect(result).toEqual({ error: "This credential is already revoked." });
    expect(result).not.toEqual({ success: true });
  });
});
