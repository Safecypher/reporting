import { beforeEach, describe, expect, it, vi } from "vitest";

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
