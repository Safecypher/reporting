import { describe, expect, it } from "vitest";

import { EMPTY_ACTOR_EMAILS, type ActorEmailMap } from "@/lib/identity/profiles";

import {
  DELIVERY_REJECTED_STATUS_LABEL,
  FAILED_STATUS_LABEL,
  REJECTED_STATUS,
  formatCount,
  formatPendingCaption,
  mergeHistory,
  sourceLabel,
  type IngestedFileRow,
  type RejectionRow,
} from "../history";

// A fixed evaluation instant for every pre-existing test below, none of
// which exercises a pending row (the default status is "done") — the exact
// value is arbitrary as long as it postdates the fixtures' timestamps.
const NOW = new Date("2026-09-25T09:00:00.000Z");

function upload(overrides: Partial<IngestedFileRow> = {}): IngestedFileRow {
  return {
    id: "upload-1",
    file_name: "verification.csv",
    uploaded_at: "2026-09-25T06:00:00.000Z",
    uploaded_by: null,
    status: "done",
    rows_accepted: 10,
    rows_duplicate: 1,
    rows_rejected: 0,
    source: "manual",
    source_ref: null,
    push_credentials: null,
    processing_started_at: null,
    processing_attempts: 0,
    ...overrides,
  };
}

function rejection(overrides: Partial<RejectionRow> = {}): RejectionRow {
  return {
    id: "rejection-1",
    sender: "TSYS",
    file_name: "empty.csv",
    reason: "Empty file. This file has no content and was not accepted.",
    rejected_at: "2026-09-25T06:00:00.000Z",
    ...overrides,
  };
}

describe("sourceLabel", () => {
  it("returns the sender name verbatim for a pushed file", () => {
    expect(sourceLabel({ kind: "push", senderName: "TSYS" })).toBe("TSYS");
  });

  it("returns the sender name verbatim for a rejection", () => {
    expect(sourceLabel({ kind: "rejection", senderName: "Bit Addict" })).toBe("Bit Addict");
  });

  it("prefixes a manual upload with the uploader's email", () => {
    expect(sourceLabel({ kind: "manual", uploaderEmail: "mark.wright@safecypher.com" })).toBe(
      "Manual — mark.wright@safecypher.com"
    );
  });

  it("falls back to 'Manual — unknown user' when the identity cannot be resolved", () => {
    expect(sourceLabel({ kind: "manual", uploaderEmail: null })).toBe("Manual — unknown user");
  });
});

describe("formatCount", () => {
  it("renders an em dash for null", () => {
    expect(formatCount(null)).toBe("—");
  });

  it("renders an em dash for undefined", () => {
    expect(formatCount(undefined)).toBe("—");
  });

  it("renders a genuine zero as the number, not the dash", () => {
    expect(formatCount(0)).toBe("0");
  });

  it("renders a positive count as its number", () => {
    expect(formatCount(1234)).toBe("1,234");
  });
});

describe("mergeHistory", () => {
  it("interleaves three uploads and two rejections into one correctly ordered list", () => {
    const uploads = [
      upload({ id: "u1", uploaded_at: "2026-09-25T08:00:00.000Z" }),
      upload({ id: "u2", uploaded_at: "2026-09-25T06:00:00.000Z" }),
      upload({ id: "u3", uploaded_at: "2026-09-25T04:00:00.000Z" }),
    ];
    const rejections = [
      rejection({ id: "r1", rejected_at: "2026-09-25T07:00:00.000Z" }),
      rejection({ id: "r2", rejected_at: "2026-09-25T05:00:00.000Z" }),
    ];

    const merged = mergeHistory(uploads, rejections, EMPTY_ACTOR_EMAILS, NOW);

    expect(merged.map((row) => row.id)).toEqual(["u1", "r1", "u2", "r2", "u3"]);
  });

  it("tie-breaks a shared timestamp deterministically: kind (upload before rejection) then id ascending, stable across a reversed input order", () => {
    const uploads = [upload({ id: "u2", uploaded_at: "2026-09-25T06:00:00.000Z" })];
    const rejections = [rejection({ id: "r1", rejected_at: "2026-09-25T06:00:00.000Z" })];

    const forward = mergeHistory(uploads, rejections, EMPTY_ACTOR_EMAILS, NOW);
    const reversed = mergeHistory([...uploads], [...rejections].reverse(), EMPTY_ACTOR_EMAILS, NOW);

    expect(forward.map((row) => row.id)).toEqual(["u2", "r1"]);
    expect(reversed.map((row) => row.id)).toEqual(["u2", "r1"]);
  });

  it("tie-breaks two same-kind rows sharing a timestamp by id ascending", () => {
    const uploads = [
      upload({ id: "u9", uploaded_at: "2026-09-25T06:00:00.000Z" }),
      upload({ id: "u2", uploaded_at: "2026-09-25T06:00:00.000Z" }),
    ];

    const merged = mergeHistory(uploads, [], EMPTY_ACTOR_EMAILS, NOW);

    expect(merged.map((row) => row.id)).toEqual(["u2", "u9"]);
  });

  it("returns a non-empty list when there are zero uploads and one or more rejections", () => {
    const merged = mergeHistory([], [rejection()], EMPTY_ACTOR_EMAILS, NOW);

    expect(merged).toHaveLength(1);
    expect(merged[0].kind).toBe("rejection");
  });

  it("returns an empty list when both inputs are empty", () => {
    expect(mergeHistory([], [], EMPTY_ACTOR_EMAILS, NOW)).toEqual([]);
  });

  it("derives the Source column from the sender for a pushed upload", () => {
    const merged = mergeHistory(
      [
        upload({
          id: "u1",
          source: "push",
          push_credentials: { sender: "TSYS" },
        }),
      ],
      [],
      EMPTY_ACTOR_EMAILS,
      NOW
    );

    expect(merged[0].source).toBe("TSYS");
  });

  it("derives the Source column as 'Manual — unknown user' when the uploader cannot be resolved (uploaded_by is null) -- this is the fallback condition, not a universal", () => {
    const merged = mergeHistory(
      [upload({ id: "u1", source: "manual" })],
      [],
      EMPTY_ACTOR_EMAILS,
      NOW
    );

    expect(merged[0].source).toBe("Manual — unknown user");
  });

  it("renders 'Manual — <email>' when uploaded_by resolves through the supplied map (G-09-1 regression guard)", () => {
    const uploaderEmails: ActorEmailMap = new Map([
      ["user-1", "mark.wright@safecypher.com"],
    ]);
    const merged = mergeHistory(
      [upload({ id: "u1", source: "manual", uploaded_by: "user-1" })],
      [],
      uploaderEmails,
      NOW
    );

    expect(merged[0].source).toBe("Manual — mark.wright@safecypher.com");
  });

  it("falls back to 'Manual — unknown user' when uploaded_by is present but absent from the supplied map", () => {
    const uploaderEmails: ActorEmailMap = new Map([
      ["user-1", "mark.wright@safecypher.com"],
    ]);
    const merged = mergeHistory(
      [upload({ id: "u1", source: "manual", uploaded_by: "user-99" })],
      [],
      uploaderEmails,
      NOW
    );

    expect(merged[0].source).toBe("Manual — unknown user");
  });

  it("leaves a pushed row's Source unaffected by the uploader-email map", () => {
    const uploaderEmails: ActorEmailMap = new Map([
      ["user-1", "mark.wright@safecypher.com"],
    ]);
    const merged = mergeHistory(
      [
        upload({
          id: "u1",
          source: "push",
          uploaded_by: "user-1",
          push_credentials: { sender: "TSYS" },
        }),
      ],
      [],
      uploaderEmails,
      NOW
    );

    expect(merged[0].source).toBe("TSYS");
  });

  it("derives the Source column from the rejection's own denormalised sender", () => {
    const merged = mergeHistory([], [rejection({ sender: "Bit Addict" })], EMPTY_ACTOR_EMAILS, NOW);

    expect(merged[0].source).toBe("Bit Addict");
  });

  it("gives a rejection row no counts and no source reference", () => {
    const merged = mergeHistory([], [rejection()], EMPTY_ACTOR_EMAILS, NOW);

    expect(merged[0].accepted).toBeNull();
    expect(merged[0].duplicate).toBeNull();
    expect(merged[0].rejected).toBeNull();
    expect(merged[0].sourceRef).toBeNull();
    expect(merged[0].status).toBe(REJECTED_STATUS);
    expect(merged[0].reason).toBe(rejection().reason);
  });

  it("carries the upload's source_ref through untouched", () => {
    const merged = mergeHistory(
      [upload({ id: "u1", source: "push", source_ref: "inbox/tsys/123-file.csv" })],
      [],
      EMPTY_ACTOR_EMAILS,
      NOW
    );

    expect(merged[0].sourceRef).toBe("inbox/tsys/123-file.csv");
  });
});

describe("mergeHistory — pending state derivation (plan 13-04, INGEST-10)", () => {
  it("gives a done upload row a null pending state", () => {
    const merged = mergeHistory([upload({ id: "u1", status: "done" })], [], EMPTY_ACTOR_EMAILS, NOW);

    expect(merged[0].pendingState).toBeNull();
    expect(merged[0].pendingSince).toBeNull();
  });

  it("gives a failed upload row a null pending state", () => {
    const merged = mergeHistory(
      [upload({ id: "u1", status: "failed" })],
      [],
      EMPTY_ACTOR_EMAILS,
      NOW
    );

    expect(merged[0].pendingState).toBeNull();
    expect(merged[0].pendingSince).toBeNull();
  });

  it("gives a rejection row a null pending state, pending-since and attempt count", () => {
    const merged = mergeHistory([], [rejection()], EMPTY_ACTOR_EMAILS, NOW);

    expect(merged[0].pendingState).toBeNull();
    expect(merged[0].pendingSince).toBeNull();
    expect(merged[0].attemptCount).toBeNull();
  });

  it("reads a pending row uploaded two minutes before the instant, with no lease, as processing", () => {
    const asOf = new Date("2026-09-25T06:02:00.000Z");
    const merged = mergeHistory(
      [
        upload({
          id: "u1",
          status: "pending",
          uploaded_at: "2026-09-25T06:00:00.000Z",
          processing_started_at: null,
        }),
      ],
      [],
      EMPTY_ACTOR_EMAILS,
      asOf
    );

    expect(merged[0].pendingState).toBe("processing");
  });

  it("reads a pending row uploaded three days before the instant, with no lease, as stuck, with pending-since equal to its upload time", () => {
    const uploadedAt = "2026-09-22T06:00:00.000Z";
    const asOf = new Date("2026-09-25T06:00:00.000Z");
    const merged = mergeHistory(
      [
        upload({
          id: "u1",
          status: "pending",
          uploaded_at: uploadedAt,
          processing_started_at: null,
        }),
      ],
      [],
      EMPTY_ACTOR_EMAILS,
      asOf
    );

    expect(merged[0].pendingState).toBe("stuck");
    expect(merged[0].pendingSince).toBe(uploadedAt);
  });

  it("reads a pending row uploaded three days before the instant, whose lease was taken ten seconds ago, as processing", () => {
    const asOf = new Date("2026-09-25T06:00:00.000Z");
    const merged = mergeHistory(
      [
        upload({
          id: "u1",
          status: "pending",
          uploaded_at: "2026-09-22T06:00:00.000Z",
          processing_started_at: "2026-09-25T05:59:50.000Z",
        }),
      ],
      [],
      EMPTY_ACTOR_EMAILS,
      asOf
    );

    expect(merged[0].pendingState).toBe("processing");
    expect(merged[0].pendingSince).toBeNull();
  });

  it("carries the attempt count through from the row for an upload, regardless of status", () => {
    const merged = mergeHistory(
      [upload({ id: "u1", status: "done", processing_attempts: 2 })],
      [],
      EMPTY_ACTOR_EMAILS,
      NOW
    );

    expect(merged[0].attemptCount).toBe(2);
  });

  it("leaves ordering, tie-break, source-label and count behaviour unchanged when pending/stuck rows are present", () => {
    const merged = mergeHistory(
      [
        upload({ id: "u1", status: "pending", uploaded_at: "2026-09-25T08:00:00.000Z" }),
        upload({ id: "u2", status: "done", uploaded_at: "2026-09-25T06:00:00.000Z" }),
      ],
      [rejection({ id: "r1", rejected_at: "2026-09-25T07:00:00.000Z" })],
      EMPTY_ACTOR_EMAILS,
      NOW
    );

    expect(merged.map((row) => row.id)).toEqual(["u1", "r1", "u2"]);
    expect(merged[1].source).toBe("TSYS");
    expect(merged[2].accepted).toBe(10);
  });
});

describe("formatPendingCaption", () => {
  it("returns null for a row with no pending state", () => {
    expect(
      formatPendingCaption({ pendingState: null, pendingSince: null, attemptCount: null }, NOW)
    ).toBeNull();
  });

  it("returns null for a processing row on its first attempt", () => {
    expect(
      formatPendingCaption(
        { pendingState: "processing", pendingSince: null, attemptCount: 1 },
        NOW
      )
    ).toBeNull();
  });

  it("names the attempt number for a processing row on a later attempt", () => {
    expect(
      formatPendingCaption(
        { pendingState: "processing", pendingSince: null, attemptCount: 2 },
        NOW
      )
    ).toBe("Attempt 2");
  });

  it("names the duration in whole days for a row stuck since three days ago", () => {
    const pendingSince = "2026-09-22T06:00:00.000Z";
    const asOf = new Date("2026-09-25T06:00:00.000Z");

    expect(
      formatPendingCaption({ pendingState: "stuck", pendingSince, attemptCount: 1 }, asOf)
    ).toBe("Stuck for 3 days");
  });

  it("names the duration in whole hours for a row stuck since eight hours ago", () => {
    const pendingSince = "2026-09-25T00:00:00.000Z";
    const asOf = new Date("2026-09-25T08:00:00.000Z");

    expect(
      formatPendingCaption({ pendingState: "stuck", pendingSince, attemptCount: 1 }, asOf)
    ).toBe("Stuck for 8 hours");
  });

  it("never emits a negative duration or a raw ISO timestamp, clamping clock skew to the smallest duration", () => {
    const pendingSince = "2026-09-25T06:00:00.000Z";
    // The instant is marginally BEFORE the stored pending-since — clock skew
    // between a server render and a stored value.
    const asOf = new Date("2026-09-25T05:00:00.000Z");

    const caption = formatPendingCaption(
      { pendingState: "stuck", pendingSince, attemptCount: 1 },
      asOf
    );

    expect(caption).toBe("Stuck for 0 hours");
    expect(caption).not.toContain("-");
    expect(caption).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

describe("status label constants", () => {
  it("are distinct, non-empty exported strings", () => {
    expect(FAILED_STATUS_LABEL).toBe("Failed");
    expect(DELIVERY_REJECTED_STATUS_LABEL).toBe("Delivery rejected");
    expect(FAILED_STATUS_LABEL).not.toBe(DELIVERY_REJECTED_STATUS_LABEL);
  });
});
