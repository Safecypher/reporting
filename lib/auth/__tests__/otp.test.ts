import { describe, expect, it } from "vitest";

import {
  CODE_TYPES,
  OTP_MAX_LENGTH,
  OTP_MIN_LENGTH,
  isCodeType,
  isValidOtpShape,
  normalizeEmail,
  normalizeOtp,
  resolveCodeType,
} from "../otp";

describe("normalizeOtp", () => {
  it("passes a clean code through unchanged", () => {
    expect(normalizeOtp("06771769")).toBe("06771769");
  });

  it("strips the spaces people paste codes with", () => {
    expect(normalizeOtp("0677 1769")).toBe("06771769");
    expect(normalizeOtp(" 06771769 ")).toBe("06771769");
    expect(normalizeOtp("067 717 69")).toBe("06771769");
  });

  it("strips the characters mail clients insert when wrapping", () => {
    // non-breaking space, soft hyphen, zero-width space
    expect(normalizeOtp("0677 1769")).toBe("06771769");
    expect(normalizeOtp("0677­1769")).toBe("06771769");
    expect(normalizeOtp("0677​1769")).toBe("06771769");
    expect(normalizeOtp("0677-1769")).toBe("06771769");
  });

  it("preserves leading zeros — a code is a string, never a number", () => {
    expect(normalizeOtp("00001234")).toBe("00001234");
    expect(normalizeOtp("0677 1769")).not.toBe("6771769");
  });

  it("returns empty for null and for input with no digits at all", () => {
    expect(normalizeOtp(null)).toBe("");
    expect(normalizeOtp("")).toBe("");
    expect(normalizeOtp("abcdef")).toBe("");
  });

  it("never invents digits — a short code stays short and fails validation", () => {
    expect(isValidOtpShape(normalizeOtp("123"))).toBe(false);
  });
});

describe("isValidOtpShape", () => {
  it("accepts this project's actual 8-digit codes", () => {
    expect(isValidOtpShape("06771769")).toBe(true);
    expect(isValidOtpShape("42410895")).toBe(true);
  });

  it("accepts the whole configurable range, not just 8", () => {
    // MAILER_OTP_LENGTH is a Dashboard setting; changing it must not start
    // rejecting every valid code.
    expect(isValidOtpShape("1".repeat(OTP_MIN_LENGTH))).toBe(true);
    expect(isValidOtpShape("1".repeat(OTP_MAX_LENGTH))).toBe(true);
  });

  it("rejects codes outside the range", () => {
    expect(isValidOtpShape("1".repeat(OTP_MIN_LENGTH - 1))).toBe(false);
    expect(isValidOtpShape("1".repeat(OTP_MAX_LENGTH + 1))).toBe(false);
    expect(isValidOtpShape("")).toBe(false);
  });

  it("rejects anything non-numeric", () => {
    expect(isValidOtpShape("06771a69")).toBe(false);
    expect(isValidOtpShape("abcdefgh")).toBe(false);
  });
});

describe("isCodeType / resolveCodeType", () => {
  it("accepts each supported type", () => {
    for (const type of CODE_TYPES) {
      expect(isCodeType(type)).toBe(true);
    }
  });

  it("rejects an unknown or absent type", () => {
    expect(isCodeType("signup_x")).toBe(false);
    expect(isCodeType(null)).toBe(false);
    expect(isCodeType("")).toBe(false);
  });

  it("falls back to recovery rather than erroring, since the code is what authenticates", () => {
    expect(resolveCodeType(null)).toBe("recovery");
    expect(resolveCodeType("nonsense")).toBe("recovery");
    expect(resolveCodeType("")).toBe("recovery");
  });

  it("honours a valid type when one is given", () => {
    expect(resolveCodeType("invite")).toBe("invite");
    expect(resolveCodeType("magiclink")).toBe("magiclink");
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases so a copy-paste stray space cannot fail the verify", () => {
    expect(normalizeEmail("  Michael.Ward@Safecypher.com ")).toBe(
      "michael.ward@safecypher.com",
    );
  });

  it("returns empty for null", () => {
    expect(normalizeEmail(null)).toBe("");
    expect(normalizeEmail("")).toBe("");
  });
});
