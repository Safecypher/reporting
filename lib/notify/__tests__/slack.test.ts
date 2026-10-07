import { describe, it, expect, vi } from "vitest";
import { groupWrongStates, formatSlackAlertText, postSlackAlert } from "../slack";
import type { FreshnessResolution } from "@/lib/dashboard/freshness";

/**
 * Builds a minimal `FreshnessResolution` for a given SOURCE_ORDER report
 * type. Only the fields `groupWrongStates` actually reads (`reportType`,
 * `label`, `badgeLabel`, `caption`) are meaningful; `badgeStatus` is filled
 * with a plausible value per badgeLabel purely to keep the fixture honest.
 */
function item(
  reportType: string,
  label: string,
  badgeLabel: FreshnessResolution["badgeLabel"],
  caption: string | null,
): FreshnessResolution {
  const badgeStatus =
    badgeLabel === "Current"
      ? "ok"
      : badgeLabel === "Overdue"
        ? "needs_review"
        : badgeLabel === "Failed to parse"
          ? "mismatch"
          : "no_source_data";
  return { reportType, label, badgeStatus, badgeLabel, caption };
}

const ALL_CURRENT: FreshnessResolution[] = [
  item("verification", "Verification", "Current", "Last covered Fri 26 Sep"),
  item("billing", "Billing", "Current", "Last covered Fri 26 Sep"),
  item("dcvv", "DCVV", "Current", "Last covered Fri 26 Sep"),
  item("card-inventory", "Card inventory", "Current", "Last covered Fri 26 Sep"),
  item("removed-cards", "Removed cards", "Current", "Last covered Fri 26 Sep"),
  item("apigee-stats", "APIGEE stats", "Current", "Last covered Fri 26 Sep"),
];

describe("groupWrongStates", () => {
  it("all six items Current, stuckCount 0 -> nothing wrong, hasAnything is false", () => {
    const groups = groupWrongStates(ALL_CURRENT, 0, null, 0, null);
    expect(groups.hasAnything).toBe(false);
    expect(groups.overdue).toEqual([]);
    expect(groups.failedToParse).toEqual([]);
    expect(groups.neverArrived).toEqual([]);
    expect(groups.inboxStuck).toBeNull();
    expect(groups.stuckPending).toBeNull();
  });

  it("two items Overdue -> one overdue group listing both, in SOURCE_ORDER order regardless of input order, each with its last covered day", () => {
    // Input deliberately reversed relative to SOURCE_ORDER (dcvv before verification).
    const items = ALL_CURRENT.map((i) => ({ ...i }));
    const dcvvIdx = items.findIndex((i) => i.reportType === "dcvv");
    const verIdx = items.findIndex((i) => i.reportType === "verification");
    items[dcvvIdx] = item("dcvv", "DCVV", "Overdue", "Last covered Thu 25 Sep");
    items[verIdx] = item("verification", "Verification", "Overdue", "Last covered Fri 26 Sep");
    // Reverse the whole array so dcvv (SOURCE_ORDER index 2) precedes
    // verification (SOURCE_ORDER index 0) in the INPUT.
    const reversed = [...items].reverse();

    const groups = groupWrongStates(reversed, 0, null, 0, null);
    expect(groups.hasAnything).toBe(true);
    expect(groups.overdue).toEqual([
      { label: "Verification", lastCoveredDay: "Fri 26 Sep" },
      { label: "DCVV", lastCoveredDay: "Thu 25 Sep" },
    ]);
  });

  it('one item "Failed to parse" -> a failedToParse group naming it; that item does NOT also appear in overdue even if its underlying row had stale: true', () => {
    const items = ALL_CURRENT.map((i) => ({ ...i }));
    const billingIdx = items.findIndex((i) => i.reportType === "billing");
    items[billingIdx] = item("billing", "Billing", "Failed to parse", "Arrived Sat 26 Sep, 08:14");

    const groups = groupWrongStates(items, 0, null, 0, null);
    expect(groups.hasAnything).toBe(true);
    expect(groups.failedToParse).toEqual([{ label: "Billing", fileCount: 1 }]);
    expect(groups.overdue).toEqual([]);
  });

  it('items marked "Disabled" never appear in any group', () => {
    const items = ALL_CURRENT.map((i) => ({ ...i }));
    const idx = items.findIndex((i) => i.reportType === "removed-cards");
    items[idx] = item("removed-cards", "Removed cards", "Disabled", "Monitoring off");

    const groups = groupWrongStates(items, 0, null, 0, null);
    expect(groups.hasAnything).toBe(false);
    expect(groups.overdue).toEqual([]);
    expect(groups.failedToParse).toEqual([]);
    expect(groups.neverArrived).toEqual([]);
  });

  it('items marked "No report received" appear in a neverArrived group, not in overdue', () => {
    const items = ALL_CURRENT.map((i) => ({ ...i }));
    const idx = items.findIndex((i) => i.reportType === "apigee-stats");
    items[idx] = item("apigee-stats", "APIGEE stats", "No report received", null);

    const groups = groupWrongStates(items, 0, null, 0, null);
    expect(groups.hasAnything).toBe(true);
    expect(groups.neverArrived).toEqual([{ label: "APIGEE stats" }]);
    expect(groups.overdue).toEqual([]);
  });

  it("stuckCount 3 with everything else healthy -> hasAnything is true and only the inbox group is populated", () => {
    const groups = groupWrongStates(ALL_CURRENT, 3, "2026-09-26T06:14:00Z", 0, null);
    expect(groups.hasAnything).toBe(true);
    expect(groups.overdue).toEqual([]);
    expect(groups.failedToParse).toEqual([]);
    expect(groups.neverArrived).toEqual([]);
    expect(groups.inboxStuck).toEqual({ count: 3, since: "2026-09-26T06:14:00Z" });
    expect(groups.stuckPending).toBeNull();
  });

  it("a zero stuck-pending count produces a null group, and the has-anything flag is unchanged by it", () => {
    const groups = groupWrongStates(ALL_CURRENT, 0, null, 0, "2026-09-26T06:14:00Z");
    expect(groups.stuckPending).toBeNull();
    expect(groups.hasAnything).toBe(false);
  });

  it("a stuck-pending count of two with everything else healthy makes the has-anything flag true with only that group populated", () => {
    const groups = groupWrongStates(ALL_CURRENT, 0, null, 2, "2026-09-26T06:14:00Z");
    expect(groups.hasAnything).toBe(true);
    expect(groups.overdue).toEqual([]);
    expect(groups.failedToParse).toEqual([]);
    expect(groups.neverArrived).toEqual([]);
    expect(groups.inboxStuck).toBeNull();
    expect(groups.stuckPending).toEqual({ count: 2, since: "2026-09-26T06:14:00Z" });
  });

  it("the stuck-pending count and since are carried through unchanged -- no age arithmetic of its own", () => {
    const groups = groupWrongStates(ALL_CURRENT, 0, null, 7, "2026-01-01T00:00:00.000Z");
    expect(groups.stuckPending).toEqual({ count: 7, since: "2026-01-01T00:00:00.000Z" });
  });

  it("a non-null stuck-pending since carries through even when the count argument alone would already make hasAnything true via inboxStuck", () => {
    const groups = groupWrongStates(ALL_CURRENT, 3, "2026-09-25T00:00:00Z", 1, null);
    expect(groups.inboxStuck).toEqual({ count: 3, since: "2026-09-25T00:00:00Z" });
    expect(groups.stuckPending).toEqual({ count: 1, since: null });
  });
});

describe("formatSlackAlertText", () => {
  it("emits the two-source overdue line, comma-joined, each with its covered day in parentheses", () => {
    const text = formatSlackAlertText({
      overdue: [
        { label: "verification", lastCoveredDay: "Fri 26 Sep" },
        { label: "dcvv", lastCoveredDay: "Thu 25 Sep" },
      ],
      failedToParse: [],
      neverArrived: [],
      inboxStuck: null,
      stuckPending: null,
      hasAnything: true,
    });
    expect(text).toBe(
      "Overdue: verification (last covered Fri 26 Sep), dcvv (last covered Thu 25 Sep)\n" +
        "https://screporting.netlify.app/uploads",
    );
  });

  it("emits a count suffix only when more than one file failed for a source", () => {
    const twoFiles = formatSlackAlertText({
      overdue: [],
      failedToParse: [{ label: "billing", fileCount: 2 }],
      neverArrived: [],
      inboxStuck: null,
      stuckPending: null,
      hasAnything: true,
    });
    expect(twoFiles).toBe("Failed to parse: billing (2 files)\nhttps://screporting.netlify.app/uploads");

    const oneFile = formatSlackAlertText({
      overdue: [],
      failedToParse: [{ label: "billing", fileCount: 1 }],
      neverArrived: [],
      inboxStuck: null,
      stuckPending: null,
      hasAnything: true,
    });
    expect(oneFile).toBe("Failed to parse: billing\nhttps://screporting.netlify.app/uploads");
  });

  it("emits the inbox-stuck line", () => {
    const text = formatSlackAlertText({
      overdue: [],
      failedToParse: [],
      neverArrived: [],
      inboxStuck: { count: 3, since: "2026-09-26T06:14:00Z" },
      stuckPending: null,
      hasAnything: true,
    });
    expect(text).toBe("Inbox: 3 objects stuck\nhttps://screporting.netlify.app/uploads");
  });

  it("omits a group's line entirely when that group is empty -- never 'Overdue: ' with nothing after it", () => {
    const text = formatSlackAlertText({
      overdue: [],
      failedToParse: [{ label: "billing", fileCount: 1 }],
      neverArrived: [],
      inboxStuck: null,
      stuckPending: null,
      hasAnything: true,
    });
    expect(text).not.toContain("Overdue:");
    expect(text).not.toContain("No report received:");
    expect(text).not.toContain("Inbox:");
    expect(text).not.toContain("Stuck pending:");
  });

  it("always ends with the /uploads link on its own final line", () => {
    const text = formatSlackAlertText({
      overdue: [{ label: "verification", lastCoveredDay: "Fri 26 Sep" }],
      failedToParse: [{ label: "billing", fileCount: 2 }],
      neverArrived: [{ label: "apigee-stats" }],
      inboxStuck: { count: 3, since: "2026-09-26T06:14:00Z" },
      stuckPending: { count: 2, since: "2026-09-26T06:14:00Z" },
      hasAnything: true,
    });
    const lines = text!.split("\n");
    expect(lines[lines.length - 1]).toBe("https://screporting.netlify.app/uploads");
    expect(lines).toEqual([
      "Overdue: verification (last covered Fri 26 Sep)",
      "Failed to parse: billing (2 files)",
      "No report received: apigee-stats",
      "Inbox: 3 objects stuck",
      "Stuck pending: 2 uploads never finished processing, oldest arrived 2026-09-26T06:14:00Z",
      "https://screporting.netlify.app/uploads",
    ]);
  });

  it("returns null when nothing is wrong, so a caller cannot accidentally post an empty message", () => {
    const text = formatSlackAlertText({
      overdue: [],
      failedToParse: [],
      neverArrived: [],
      inboxStuck: null,
      stuckPending: null,
      hasAnything: false,
    });
    expect(text).toBeNull();
  });

  it("emits a stuck-pending line naming the count, using singular and plural correctly at one and at two", () => {
    const one = formatSlackAlertText({
      overdue: [],
      failedToParse: [],
      neverArrived: [],
      inboxStuck: null,
      stuckPending: { count: 1, since: null },
      hasAnything: true,
    });
    expect(one).toBe("Stuck pending: 1 upload never finished processing\nhttps://screporting.netlify.app/uploads");

    const two = formatSlackAlertText({
      overdue: [],
      failedToParse: [],
      neverArrived: [],
      inboxStuck: null,
      stuckPending: { count: 2, since: null },
      hasAnything: true,
    });
    expect(two).toBe("Stuck pending: 2 uploads never finished processing\nhttps://screporting.netlify.app/uploads");
  });

  it("names when the oldest one arrived when a since is present, and omits that clause entirely when it is null", () => {
    const withSince = formatSlackAlertText({
      overdue: [],
      failedToParse: [],
      neverArrived: [],
      inboxStuck: null,
      stuckPending: { count: 1, since: "2026-10-05T12:00:00.000Z" },
      hasAnything: true,
    });
    expect(withSince).toBe(
      "Stuck pending: 1 upload never finished processing, oldest arrived 2026-10-05T12:00:00.000Z\n" +
        "https://screporting.netlify.app/uploads",
    );

    const withoutSince = formatSlackAlertText({
      overdue: [],
      failedToParse: [],
      neverArrived: [],
      inboxStuck: null,
      stuckPending: { count: 1, since: null },
      hasAnything: true,
    });
    expect(withoutSince).not.toContain("oldest arrived");
    expect(withoutSince).not.toContain("null");
  });

  it("the stuck-pending line appears AFTER the inbox line and BEFORE the trailing link", () => {
    const text = formatSlackAlertText({
      overdue: [],
      failedToParse: [],
      neverArrived: [],
      inboxStuck: { count: 1, since: null },
      stuckPending: { count: 1, since: null },
      hasAnything: true,
    });
    const lines = text!.split("\n");
    const inboxIdx = lines.findIndex((l) => l.startsWith("Inbox:"));
    const stuckPendingIdx = lines.findIndex((l) => l.startsWith("Stuck pending:"));
    const linkIdx = lines.indexOf("https://screporting.netlify.app/uploads");
    expect(inboxIdx).toBeGreaterThanOrEqual(0);
    expect(stuckPendingIdx).toBeGreaterThan(inboxIdx);
    expect(linkIdx).toBeGreaterThan(stuckPendingIdx);
  });

  it("the stuck-pending line is omitted entirely when the group is null", () => {
    const text = formatSlackAlertText({
      overdue: [],
      failedToParse: [],
      neverArrived: [],
      inboxStuck: { count: 1, since: null },
      stuckPending: null,
      hasAnything: true,
    });
    expect(text).not.toContain("Stuck pending:");
  });

  it("a stuck-pending count of two with everything else null still produces a message (it alone is sufficient reason to post)", () => {
    const text = formatSlackAlertText({
      overdue: [],
      failedToParse: [],
      neverArrived: [],
      inboxStuck: null,
      stuckPending: { count: 2, since: "2026-10-06T00:00:00.000Z" },
      hasAnything: true,
    });
    expect(text).not.toBeNull();
    expect(text).toContain("Stuck pending: 2 uploads never finished processing");
  });
});

describe("postSlackAlert", () => {
  it("a 200 with body 'ok' returns { ok: true, status: 200, body: 'ok' }", async () => {
    const fakeFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "ok",
    })) as unknown as typeof fetch;

    const result = await postSlackAlert("https://hooks.slack.com/services/SECRET", "hello", fakeFetch);
    expect(result).toEqual({ ok: true, status: 200, body: "ok" });
  });

  it("a 404 with body 'channel_not_found' returns { ok: false, status: 404, body: 'channel_not_found' } and does not throw", async () => {
    const fakeFetch = vi.fn(async () => ({
      ok: false,
      status: 404,
      text: async () => "channel_not_found",
    })) as unknown as typeof fetch;

    const result = await postSlackAlert("https://hooks.slack.com/services/SECRET", "hello", fakeFetch);
    expect(result).toEqual({ ok: false, status: 404, body: "channel_not_found" });
  });

  it("a fetch that rejects (simulated abort) returns { ok: false, status: 0, error } and does not throw", async () => {
    const fakeFetch = vi.fn(async () => {
      throw new DOMException("The operation was aborted.", "TimeoutError");
    }) as unknown as typeof fetch;

    const result = await postSlackAlert("https://hooks.slack.com/services/SECRET", "hello", fakeFetch);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(typeof result.error).toBe("string");
    expect(result.error!.length).toBeGreaterThan(0);
  });

  it("the returned object never contains the webhook URL in any field", async () => {
    const webhookUrl = "https://hooks.slack.com/services/T00/B00/SUPERSECRET";
    const fakeFetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => "no_service",
    })) as unknown as typeof fetch;

    const result = await postSlackAlert(webhookUrl, "hello", fakeFetch);
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain("SUPERSECRET");
    expect(serialised).not.toContain(webhookUrl);
  });

  it("calls fetch exactly once, with method POST, Content-Type application/json, a body that JSON-parses to { text }, and a signal", async () => {
    const fakeFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "ok",
    })) as unknown as typeof fetch;

    await postSlackAlert("https://hooks.slack.com/services/SECRET", "hello world", fakeFetch);

    expect(fakeFetch).toHaveBeenCalledTimes(1);
    const [url, init] = (fakeFetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://hooks.slack.com/services/SECRET");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ text: "hello world" });
    expect(init.signal).toBeDefined();
  });
});
