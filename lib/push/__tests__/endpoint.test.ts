import { describe, expect, it } from "vitest";

import {
  PUSH_FILE_FIELD,
  PUSH_MAX_REQUEST_MB,
  buildSenderInstructions,
  pushEndpointUrl,
} from "../endpoint";

describe("pushEndpointUrl", () => {
  it("appends the endpoint path to a clean origin", () => {
    expect(pushEndpointUrl("https://screporting.netlify.app")).toBe(
      "https://screporting.netlify.app/api/push",
    );
  });

  it("normalises a trailing slash rather than producing a double slash", () => {
    expect(pushEndpointUrl("https://screporting.netlify.app/")).toBe(
      "https://screporting.netlify.app/api/push",
    );
  });

  it("discards any path, query or fragment on the supplied origin", () => {
    expect(pushEndpointUrl("https://screporting.netlify.app/login?x=1#y")).toBe(
      "https://screporting.netlify.app/api/push",
    );
  });

  it("works for local development", () => {
    expect(pushEndpointUrl("http://localhost:3000")).toBe(
      "http://localhost:3000/api/push",
    );
  });

  it("returns null rather than a broken half-URL when no origin is known", () => {
    // A sender might actually paste whatever we render, so a partial URL is
    // worse than visibly having none.
    expect(pushEndpointUrl(null)).toBeNull();
    expect(pushEndpointUrl(undefined)).toBeNull();
    expect(pushEndpointUrl("")).toBeNull();
    expect(pushEndpointUrl("   ")).toBeNull();
    expect(pushEndpointUrl("not a url")).toBeNull();
  });

  it("rejects a non-http scheme", () => {
    expect(pushEndpointUrl("javascript:alert(1)")).toBeNull();
    expect(pushEndpointUrl("file:///etc/passwd")).toBeNull();
  });
});

describe("buildSenderInstructions", () => {
  const endpointUrl = "https://screporting.netlify.app/api/push";

  it("embeds the real token when one is supplied at mint time", () => {
    const out = buildSenderInstructions({
      sender: "TSYS",
      endpointUrl,
      token: "sc_live_a3f2b9c1deadbeef",
    });
    expect(out).toContain("Authorization: Bearer sc_live_a3f2b9c1deadbeef");
    expect(out).toContain("TSYS");
    expect(out).toContain(endpointUrl);
  });

  it("says the token is unrecoverable ONLY when the token is actually present", () => {
    const withToken = buildSenderInstructions({
      sender: "TSYS",
      endpointUrl,
      token: "sc_live_a3f2b9c1deadbeef",
    });
    expect(withToken).toContain("shown once and cannot be retrieved again");

    const without = buildSenderInstructions({ sender: "TSYS", endpointUrl });
    expect(without).not.toContain("shown once and cannot be retrieved again");
  });

  it("falls back to a placeholder when re-sent later without the token", () => {
    // D-05: the token is unrecoverable after the reveal dialog closes, so the
    // re-sendable form must not imply it can be looked up.
    for (const token of [undefined, null, "", "   "]) {
      const out = buildSenderInstructions({ sender: "Bit Addict", endpointUrl, token });
      expect(out).toContain("<the token issued to you separately>");
      expect(out).not.toContain("Bearer sc_live_");
    }
  });

  it("states the contract the route actually implements", () => {
    const out = buildSenderInstructions({ sender: "TSYS", endpointUrl });
    expect(out).toContain("POST ");
    expect(out).toContain("multipart/form-data");
    expect(out).toContain(`parts named "${PUSH_FILE_FIELD}"`);
    expect(out).toContain(`${PUSH_MAX_REQUEST_MB}MB`);
    for (const status of ["202", "207", "400", "401"]) {
      expect(out, `status ${status}`).toContain(status);
    }
  });

  it("distinguishes delivery from parsing, so a 202 is not read as 'it worked'", () => {
    const out = buildSenderInstructions({ sender: "TSYS", endpointUrl });
    expect(out).toContain("ARRIVED, not that it parsed");
  });

  it("includes a runnable curl example carrying the same field name and token", () => {
    const out = buildSenderInstructions({
      sender: "TSYS",
      endpointUrl,
      token: "sc_live_abc12345",
    });
    expect(out).toContain("curl -X POST https://screporting.netlify.app/api/push");
    expect(out).toContain('-H "Authorization: Bearer sc_live_abc12345"');
    expect(out).toContain(`-F "${PUSH_FILE_FIELD}=@daily-ver-report_2026-08-13.csv"`);
  });

  it("names the sender so a forwarded message is unambiguous", () => {
    expect(
      buildSenderInstructions({ sender: "Bit Addict", endpointUrl }),
    ).toContain("for Bit Addict");
  });
});
