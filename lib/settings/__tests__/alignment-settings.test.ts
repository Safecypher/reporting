import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { createClient } from "@/lib/supabase/server";

import { DEFAULT_ALIGNMENT_SETTINGS, fetchAlignmentSettings } from "../alignment-settings";

/**
 * Task 1 (WR-02): asserts `saveAlignmentSettings`'s `.update()` payload no
 * longer names `tsys_live_cards_baseline_as_of` -- that column is owned by
 * the `trg_app_settings_baseline_as_of` BEFORE UPDATE trigger (0033), and a
 * value this action supplied for it would be silently ignored by design.
 * The point of this test is not that the payload's VALUES are right -- the
 * database decides that -- but that the application is provably no longer
 * competing for the column.
 *
 * Task 2 (WR-03) extends this file with `fetchAlignmentSettings`'s three
 * discriminated-result states.
 *
 * `createClient` (`@/lib/supabase/server`) and `next/cache`'s
 * `revalidatePath` are mocked because `saveAlignmentSettings` is a real
 * Next.js Server Action -- invoking it directly against a stubbed Supabase
 * client (rather than re-deriving its logic) is what proves the actual
 * shipped code, not a parallel description of it.
 */

const updateMock = vi.fn();
const eqMock = vi.fn();
const getUserMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: getUserMock },
    from: vi.fn(() => ({
      update: (payload: Record<string, unknown>) => {
        updateMock(payload);
        return { eq: eqMock };
      },
    })),
  })),
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

const { saveAlignmentSettings } = await import(
  "@/app/(dashboard)/settings/general/actions"
);

describe("saveAlignmentSettings", () => {
  beforeEach(() => {
    updateMock.mockClear();
    eqMock.mockReset().mockResolvedValue({ error: null });
    getUserMock.mockReset().mockResolvedValue({ data: { user: { id: "user-1" } } });
    revalidatePathMock.mockClear();
  });

  it("writes exactly the four expected keys -- offset, tolerance, updated_by, updated_at -- and never the as-of column", async () => {
    const result = await saveAlignmentSettings({ baselineOffset: 5, toleranceCount: 2 });

    expect(result).toEqual({ success: true });
    expect(updateMock).toHaveBeenCalledTimes(1);

    const payload = updateMock.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(
      ["alignment_tolerance", "tsys_live_cards_baseline_offset", "updated_at", "updated_by"].sort(),
    );
    expect(payload).not.toHaveProperty("tsys_live_cards_baseline_as_of");
  });

  it("writes the same key set regardless of which fields actually changed -- a tolerance-only edit still omits the as-of column", async () => {
    await saveAlignmentSettings({ baselineOffset: 0, toleranceCount: 9 });

    const payload = updateMock.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("tsys_live_cards_baseline_as_of");
    expect(payload.tsys_live_cards_baseline_offset).toBe(0);
    expect(payload.alignment_tolerance).toBe(9);
  });
});

/**
 * Task 2 (WR-03): `fetchAlignmentSettings`'s three exit paths, kept
 * distinguishable rather than collapsed to two -- an admin who genuinely
 * configured zero tolerance and a settings read that failed must never
 * produce the same discriminated result.
 */

type FakeSupabase = Awaited<ReturnType<typeof createClient>>;

function makeFakeSupabase(result: {
  data: unknown;
  error: { message: string } | null;
}): FakeSupabase {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve(result),
        }),
      }),
    }),
  } as unknown as FakeSupabase;
}

describe("fetchAlignmentSettings", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("query error -- resolves to the defaults with a non-null error, and logs server-side", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const supabase = makeFakeSupabase({
      data: null,
      error: { message: "connection refused" },
    });

    const result = await fetchAlignmentSettings(supabase);

    expect(result).toEqual({
      settings: DEFAULT_ALIGNMENT_SETTINGS,
      error: "connection refused",
    });
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });

  it("absent row -- resolves to the defaults with a NULL error (the documented pre-edit default, not a failure)", async () => {
    const supabase = makeFakeSupabase({ data: null, error: null });

    const result = await fetchAlignmentSettings(supabase);

    expect(result).toEqual({ settings: DEFAULT_ALIGNMENT_SETTINGS, error: null });
  });

  it("present row -- resolves to that row's three values with a NULL error", async () => {
    const supabase = makeFakeSupabase({
      data: {
        tsys_live_cards_baseline_offset: 12,
        tsys_live_cards_baseline_as_of: "2026-09-01",
        alignment_tolerance: 3,
      },
      error: null,
    });

    const result = await fetchAlignmentSettings(supabase);

    expect(result).toEqual({
      settings: { baselineOffset: 12, baselineAsOf: "2026-09-01", toleranceCount: 3 },
      error: null,
    });
  });

  it("never throws, in any of the three cases", async () => {
    const errorSupabase = makeFakeSupabase({ data: null, error: { message: "boom" } });
    const absentSupabase = makeFakeSupabase({ data: null, error: null });
    const presentSupabase = makeFakeSupabase({
      data: {
        tsys_live_cards_baseline_offset: 1,
        tsys_live_cards_baseline_as_of: null,
        alignment_tolerance: 1,
      },
      error: null,
    });

    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(fetchAlignmentSettings(errorSupabase)).resolves.toBeDefined();
    await expect(fetchAlignmentSettings(absentSupabase)).resolves.toBeDefined();
    await expect(fetchAlignmentSettings(presentSupabase)).resolves.toBeDefined();
  });
});
