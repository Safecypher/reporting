import { describe, expect, it } from "vitest";

import type { createClient } from "@/lib/supabase/server";
import { fetchVerificationDrillRows } from "../verification-drill";

/**
 * WR-03 (08-01): `fetchVerificationDrillRows`'s `.gte("created_at", ...)`
 * floor. Stubs the Supabase client by hand, following
 * `lib/settings/__tests__/alignment-settings.test.ts`'s existing convention
 * — the Supabase module itself is never module-mocked.
 */
type FakeSupabase = Awaited<ReturnType<typeof createClient>>;

function makeFakeSupabase(): { supabase: FakeSupabase; gteArgs: unknown[] } {
  const gteArgs: unknown[] = [];
  const builder = {
    select: () => builder,
    gte: (_col: string, val: unknown) => {
      gteArgs.push(val);
      return builder;
    },
    lt: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    returns: () => Promise.resolve({ data: [], error: null, count: 0 }),
  };
  const supabase = { from: () => builder } as unknown as FakeSupabase;
  return { supabase, gteArgs };
}

describe("fetchVerificationDrillRows (WR-03: floor clamp, never a bare ternary)", () => {
  it("clamps a range.start before the floor up to the floor, never emitting a lower gte bound", async () => {
    const { supabase, gteArgs } = makeFakeSupabase();

    await fetchVerificationDrillRows(supabase, undefined, { start: "2026-01-01", end: null });

    expect(gteArgs[0]).toBe("2026-08-13T00:00:00Z");
  });

  it("passes through a range.start at or after the floor unchanged", async () => {
    const { supabase, gteArgs } = makeFakeSupabase();

    await fetchVerificationDrillRows(supabase, undefined, { start: "2026-09-01", end: null });

    expect(gteArgs[0]).toBe("2026-09-01T00:00:00Z");
  });

  it("defaults to the floor when no range is given at all", async () => {
    const { supabase, gteArgs } = makeFakeSupabase();

    await fetchVerificationDrillRows(supabase, undefined, undefined);

    expect(gteArgs[0]).toBe("2026-08-13T00:00:00Z");
  });
});
