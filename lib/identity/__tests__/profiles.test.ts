import { afterEach, describe, expect, it, vi } from "vitest";
import type { createClient } from "@/lib/supabase/server";

import {
  EMPTY_ACTOR_EMAILS,
  UNKNOWN_ACTOR_LABEL,
  actorLabel,
  fetchActorEmails,
} from "../profiles";

/**
 * Task 3 (G-09-1 closure): `fetchActorEmails`/`actorLabel`'s full behaviour
 * contract, mocking `@/lib/supabase/server` exactly as
 * `lib/settings/__tests__/alignment-settings.test.ts` does for
 * `fetchAlignmentSettings` -- a fake client whose `.from().select().in()`
 * chain resolves to a scripted `{ data, error }` pair, so the real query
 * shape is exercised rather than a parallel description of it.
 */

type FakeSupabase = Awaited<ReturnType<typeof createClient>>;

function makeFakeSupabase(result: { data: unknown; error: { message: string } | null }) {
  const inMock = vi.fn(() => Promise.resolve(result));
  const selectMock = vi.fn(() => ({ in: inMock }));
  const fromMock = vi.fn(() => ({ select: selectMock }));
  const supabase = { from: fromMock } as unknown as FakeSupabase;
  return { supabase, fromMock, selectMock, inMock };
}

describe("fetchActorEmails", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the shared empty map and a null error for an empty id list, without calling from", async () => {
    const { supabase, fromMock } = makeFakeSupabase({ data: [], error: null });

    const result = await fetchActorEmails(supabase, []);

    expect(result).toEqual({ emails: EMPTY_ACTOR_EMAILS, error: null });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns the shared empty map for an id list of only nulls/undefineds, without calling from", async () => {
    const { supabase, fromMock } = makeFakeSupabase({ data: [], error: null });

    const result = await fetchActorEmails(supabase, [null, undefined, null]);

    expect(result).toEqual({ emails: EMPTY_ACTOR_EMAILS, error: null });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("dedupes a repeated id so the `in` filter receives it exactly once", async () => {
    const { supabase, inMock } = makeFakeSupabase({
      data: [{ id: "user-1", email: "mark.wright@safecypher.com" }],
      error: null,
    });

    await fetchActorEmails(supabase, ["user-1", "user-1", "user-1"]);

    expect(inMock).toHaveBeenCalledTimes(1);
    expect(inMock).toHaveBeenCalledWith("id", ["user-1"]);
  });

  it("maps each returned row's id to its email", async () => {
    const { supabase } = makeFakeSupabase({
      data: [
        { id: "user-1", email: "mark.wright@safecypher.com" },
        { id: "user-2", email: "richard@safecypher.com" },
      ],
      error: null,
    });

    const result = await fetchActorEmails(supabase, ["user-1", "user-2"]);

    expect(result.error).toBeNull();
    expect(result.emails.get("user-1")).toBe("mark.wright@safecypher.com");
    expect(result.emails.get("user-2")).toBe("richard@safecypher.com");
  });

  it("omits a row whose email is null rather than mapping it to an empty string", async () => {
    const { supabase } = makeFakeSupabase({
      data: [{ id: "user-1", email: null }],
      error: null,
    });

    const result = await fetchActorEmails(supabase, ["user-1"]);

    expect(result.emails.has("user-1")).toBe(false);
  });

  it("query error -- returns the empty map, a non-null error carrying the message, and logs server-side", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { supabase } = makeFakeSupabase({
      data: null,
      error: { message: "connection refused" },
    });

    const result = await fetchActorEmails(supabase, ["user-1"]);

    expect(result).toEqual({ emails: EMPTY_ACTOR_EMAILS, error: "connection refused" });
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });
});

describe("actorLabel", () => {
  it("returns the mapped email for a known id", () => {
    const emails = new Map([["user-1", "mark.wright@safecypher.com"]]);

    expect(actorLabel("user-1", emails)).toBe("mark.wright@safecypher.com");
  });

  it("returns the unresolved label for a null id", () => {
    expect(actorLabel(null, EMPTY_ACTOR_EMAILS)).toBe(UNKNOWN_ACTOR_LABEL);
  });

  it("returns the unresolved label -- never the raw id -- for an id absent from the map", () => {
    const emails = new Map([["user-1", "mark.wright@safecypher.com"]]);

    expect(actorLabel("user-99", emails)).toBe(UNKNOWN_ACTOR_LABEL);
    expect(actorLabel("user-99", emails)).not.toBe("user-99");
  });
});
