import { describe, it, expect, vi } from "vitest";
import {
  INGEST_PROCESS_FUNCTION_PATH,
  verifyIngestProcessSecret,
  triggerBackgroundProcessing,
} from "../process-trigger";

const SECRET = "test-ingest-process-secret";

describe("verifyIngestProcessSecret", () => {
  it("verifies a presented bearer equal to the configured secret", () => {
    expect(verifyIngestProcessSecret(`Bearer ${SECRET}`, SECRET)).toBe("verified");
  });

  it("does not verify a presented bearer differing in one character", () => {
    expect(verifyIngestProcessSecret(`Bearer ${SECRET}x`, SECRET)).toBe("unauthorized");
    expect(
      verifyIngestProcessSecret(`Bearer ${SECRET.slice(0, -1)}y`, SECRET)
    ).toBe("unauthorized");
  });

  it("does not verify an absent Authorization header", () => {
    expect(verifyIngestProcessSecret(undefined, SECRET)).toBe("unauthorized");
    expect(verifyIngestProcessSecret(null, SECRET)).toBe("unauthorized");
  });

  it("does not verify an empty Authorization header", () => {
    expect(verifyIngestProcessSecret("", SECRET)).toBe("unauthorized");
  });

  it("does not verify a header without the bearer scheme", () => {
    expect(verifyIngestProcessSecret(SECRET, SECRET)).toBe("unauthorized");
    expect(verifyIngestProcessSecret(`Basic ${SECRET}`, SECRET)).toBe("unauthorized");
  });

  it("returns a distinct not-configured result for an absent configured secret, fail closed", () => {
    expect(verifyIngestProcessSecret(`Bearer ${SECRET}`, undefined)).toBe("not-configured");
    expect(verifyIngestProcessSecret(undefined, undefined)).toBe("not-configured");
    expect(verifyIngestProcessSecret(`Bearer ${SECRET}`, "")).toBe("not-configured");
  });

  it("compares equal-length digests so a differently-sized presented value cannot throw instead of returning false", () => {
    expect(() => verifyIngestProcessSecret("Bearer short", SECRET)).not.toThrow();
    expect(verifyIngestProcessSecret("Bearer short", SECRET)).toBe("unauthorized");
    expect(() =>
      verifyIngestProcessSecret(`Bearer ${SECRET}${"x".repeat(500)}`, SECRET)
    ).not.toThrow();
    expect(verifyIngestProcessSecret(`Bearer ${SECRET}${"x".repeat(500)}`, SECRET)).toBe(
      "unauthorized"
    );
  });

  it("never returns or throws a value containing the secret or the presented token", () => {
    const wrongToken = "a-completely-different-presented-value";
    let threw: unknown = null;
    let result: string | null = null;
    try {
      result = verifyIngestProcessSecret(`Bearer ${wrongToken}`, SECRET);
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeNull();
    expect(result).toBe("unauthorized");
    expect(String(result)).not.toContain(SECRET);
    expect(String(result)).not.toContain(wrongToken);
  });
});

describe("triggerBackgroundProcessing", () => {
  const ORIGIN = "https://screporting.netlify.app";
  const FILE_ID = "11111111-2222-3333-4444-555555555555";

  it("posts to the shared path constant with a bearer header and a JSON body carrying the file id, reporting fired", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    const result = await triggerBackgroundProcessing(FILE_ID, {
      fetchImpl,
      origin: ORIGIN,
      secret: SECRET,
    });
    expect(result).toEqual({ outcome: "fired" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${ORIGIN}${INGEST_PROCESS_FUNCTION_PATH}`);
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${SECRET}`);
    expect(JSON.parse(init.body as string)).toEqual({ fileId: FILE_ID });
  });

  it("never throws — a rejecting fetch reports a failed outcome carrying a message", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network blip"));
    let threw: unknown = null;
    let result: unknown = null;
    try {
      result = await triggerBackgroundProcessing(FILE_ID, {
        fetchImpl,
        origin: ORIGIN,
        secret: SECRET,
      });
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeNull();
    expect(result).toEqual({ outcome: "failed", message: expect.any(String) });
  });

  it("reports a failed outcome rather than fired for a non-2xx response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    const result = await triggerBackgroundProcessing(FILE_ID, {
      fetchImpl,
      origin: ORIGIN,
      secret: SECRET,
    });
    expect(result.outcome).toBe("failed");
  });

  it("reports not-configured without calling fetch at all when the origin is absent", async () => {
    const fetchImpl = vi.fn();
    const result = await triggerBackgroundProcessing(FILE_ID, {
      fetchImpl,
      origin: undefined,
      secret: SECRET,
    });
    expect(result).toEqual({ outcome: "not-configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports not-configured without calling fetch at all when the secret is absent", async () => {
    const fetchImpl = vi.fn();
    const result = await triggerBackgroundProcessing(FILE_ID, {
      fetchImpl,
      origin: ORIGIN,
      secret: undefined,
    });
    expect(result).toEqual({ outcome: "not-configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("carries an abort signal with a timeout, so a hung invocation cannot hold the caller open", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    await triggerBackgroundProcessing(FILE_ID, { fetchImpl, origin: ORIGIN, secret: SECRET });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("never puts the secret or the Authorization header in a failed outcome's message", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error(`failed with secret ${SECRET} leaked`));
    const result = await triggerBackgroundProcessing(FILE_ID, {
      fetchImpl,
      origin: ORIGIN,
      secret: SECRET,
    });
    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") {
      expect(result.message).not.toContain(SECRET);
    }
  });
});
