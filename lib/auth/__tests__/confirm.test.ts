import { describe, expect, it } from "vitest";

import {
  SUPPORTED_TYPES,
  confirmDestination,
  isSupportedType,
  sanitizeNext,
} from "../confirm";

/**
 * These guards shipped in quick-260901-lea with no test coverage — the three
 * threats they close (T-quick260901-01 open redirect, -02 information
 * disclosure, -03 type spoofing) were asserted in comments only. Extracted
 * and pinned here by quick 261002-k0l.
 */

describe("isSupportedType (T-quick260901-03 — spoofing guard)", () => {
  it("accepts each of the five types this project's templates actually send", () => {
    for (const type of SUPPORTED_TYPES) {
      expect(isSupportedType(type)).toBe(true);
    }
  });

  it("has exactly five supported types — a sixth must be a deliberate decision", () => {
    expect(SUPPORTED_TYPES).toHaveLength(5);
  });

  it("rejects null, empty string and an unknown type", () => {
    expect(isSupportedType(null)).toBe(false);
    expect(isSupportedType("")).toBe(false);
    expect(isSupportedType("phone_change")).toBe(false);
    expect(isSupportedType("INVITE")).toBe(false);
  });
});

describe("sanitizeNext (T-quick260901-01 — open-redirect guard)", () => {
  it("accepts an ordinary same-origin relative path", () => {
    expect(sanitizeNext("/uploads")).toBe("/uploads");
    expect(sanitizeNext("/settings/sources?tab=1")).toBe("/settings/sources?tab=1");
  });

  it("rejects a protocol-relative path, where the browser reads the next segment as a HOST", () => {
    expect(sanitizeNext("//evil.example")).toBeNull();
    expect(sanitizeNext("//evil.example/uploads")).toBeNull();
  });

  it("rejects an absolute URL on any scheme", () => {
    expect(sanitizeNext("https://evil.example")).toBeNull();
    expect(sanitizeNext("http://evil.example")).toBeNull();
    expect(sanitizeNext("javascript://evil.example")).toBeNull();
  });

  it("rejects a path containing :// anywhere, not only at the start", () => {
    expect(sanitizeNext("/redirect?to=https://evil.example")).toBeNull();
  });

  it("rejects anything not starting with a slash", () => {
    expect(sanitizeNext("uploads")).toBeNull();
    expect(sanitizeNext("evil.example")).toBeNull();
  });

  it("returns null for null and empty string", () => {
    expect(sanitizeNext(null)).toBeNull();
    expect(sanitizeNext("")).toBeNull();
  });
});

describe("confirmDestination", () => {
  it("sends invite and recovery to /set-password, ignoring any next", () => {
    expect(confirmDestination("invite", null)).toBe("/set-password");
    expect(confirmDestination("recovery", null)).toBe("/set-password");
    expect(confirmDestination("invite", "/uploads")).toBe("/set-password");
    expect(confirmDestination("recovery", "/uploads")).toBe("/set-password");
  });

  it("honours a sanitized next for the other types, falling back to the root", () => {
    expect(confirmDestination("magiclink", "/uploads")).toBe("/uploads");
    expect(confirmDestination("magiclink", null)).toBe("/");
    expect(confirmDestination("email_change", null)).toBe("/");
    expect(confirmDestination("signup", "/cards")).toBe("/cards");
  });
});
