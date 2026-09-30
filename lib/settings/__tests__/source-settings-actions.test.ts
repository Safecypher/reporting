import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `saveReportSourceSettings` / `saveDrainRunTime` (Phase 10 Plans 4/5,
 * FRESH-05/D-13/D-14) -- mirrors lib/settings/__tests__/alignment-settings.test.ts's
 * mocking style exactly: `@/lib/supabase/server` and `next/cache`'s
 * `revalidatePath` are mocked, and the REAL exported Server Actions are
 * invoked against a stubbed Supabase client, rather than re-deriving their
 * logic here.
 */

const updateMock = vi.fn();
const eqMock = vi.fn();
const selectMock = vi.fn();
const singleMock = vi.fn();
const rpcMock = vi.fn();
const getUserMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: getUserMock },
    from: vi.fn((table: string) => ({
      update: (payload: Record<string, unknown>) => {
        updateMock(table, payload);
        return { eq: eqMock };
      },
      select: (columns: string) => {
        selectMock(table, columns);
        return {
          eq: () => ({
            single: singleMock,
          }),
        };
      },
    })),
    rpc: rpcMock,
  })),
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

const { saveReportSourceSettings, saveDrainRunTime } = await import(
  "@/app/(dashboard)/settings/sources/actions"
);

const VALID_REPORT_SOURCE_INPUT = {
  reportType: "verification",
  expectedCadence: "daily-business",
  staleAfterHours: 24,
  enabled: true,
};

describe("saveReportSourceSettings", () => {
  beforeEach(() => {
    updateMock.mockClear();
    eqMock.mockReset().mockResolvedValue({ error: null });
    getUserMock.mockReset().mockResolvedValue({ data: { user: { id: "user-1" } } });
    revalidatePathMock.mockClear();
  });

  it("rejects an invalid input server-side before any Supabase call -- untrusted entry point (FRESH-05, D-13)", async () => {
    const result = await saveReportSourceSettings({
      reportType: "forged-source",
      expectedCadence: "daily-business",
      staleAfterHours: 24,
      enabled: true,
    });

    expect(result).toHaveProperty("error");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("goes through the session-scoped createClient client, scoped to the validated reportType, and returns success", async () => {
    const result = await saveReportSourceSettings(VALID_REPORT_SOURCE_INPUT);

    expect(result).toEqual({ success: true });
    expect(getUserMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledTimes(1);
    const [table, payload] = updateMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(table).toBe("report_sources");
    expect(payload.expected_cadence).toBe("daily-business");
    expect(payload.stale_after_hours).toBe(24);
    expect(payload.enabled).toBe(true);
    expect(payload.updated_by).toBe("user-1");
    expect(eqMock).toHaveBeenCalledWith("report_type", "verification");

    expect(revalidatePathMock).toHaveBeenCalledWith("/settings/sources");
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
    expect(revalidatePathMock).toHaveBeenCalledWith("/uploads");
  });

  it("returns the documented error shape when the database update fails", async () => {
    eqMock.mockResolvedValue({ error: { message: "constraint violation" } });

    const result = await saveReportSourceSettings(VALID_REPORT_SOURCE_INPUT);

    expect(result).toHaveProperty("error");
    if ("error" in result) {
      expect(typeof result.error).toBe("string");
    }
  });
});

describe("saveDrainRunTime", () => {
  beforeEach(() => {
    updateMock.mockClear();
    eqMock.mockReset().mockResolvedValue({ error: null });
    selectMock.mockClear();
    singleMock.mockReset().mockResolvedValue({
      data: { drain_cron_run_time: "16:00" },
      error: null,
    });
    rpcMock.mockReset().mockResolvedValue({ error: null });
    getUserMock.mockReset().mockResolvedValue({ data: { user: { id: "user-1" } } });
    revalidatePathMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects an invalid runTime server-side before any Supabase call", async () => {
    const result = await saveDrainRunTime({ runTime: "9:05" });

    expect(result).toHaveProperty("error");
    expect(updateMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("valid save updates app_settings and calls fn_set_drain_cron_schedule via the session-scoped client, then returns success", async () => {
    const result = await saveDrainRunTime({ runTime: "17:00" });

    expect(result).toEqual({ success: true });
    expect(getUserMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith(
      "app_settings",
      expect.objectContaining({ drain_cron_run_time: "17:00", updated_by: "user-1" }),
    );
    expect(rpcMock).toHaveBeenCalledWith("fn_set_drain_cron_schedule", {
      p_run_time: "17:00",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/settings/sources");
  });

  it("surfaces a failure, and restores the previous run time, when fn_set_drain_cron_schedule fails -- never silently reports success (T-10-23)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpcMock.mockResolvedValue({ error: { message: "rpc failed" } });

    const result = await saveDrainRunTime({ runTime: "18:00" });

    expect(result).toHaveProperty("error");
    if ("success" in result) {
      throw new Error("expected a failure result, got success");
    }

    // First update writes the new value; the compensating write restores the
    // previous value read back from app_settings ("16:00" per the mock).
    expect(updateMock).toHaveBeenCalledTimes(2);
    const [, firstPayload] = updateMock.mock.calls[0] as [string, Record<string, unknown>];
    const [, secondPayload] = updateMock.mock.calls[1] as [string, Record<string, unknown>];
    expect(firstPayload.drain_cron_run_time).toBe("18:00");
    expect(secondPayload.drain_cron_run_time).toBe("16:00");
  });
});
