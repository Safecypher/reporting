import { afterEach, describe, expect, it, vi } from "vitest";

import { getSiteOrigin } from "./site-url";

describe("getSiteOrigin", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses NEXT_PUBLIC_SITE_URL when set, regardless of headers/request.url", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://screporting.netlify.app");
    const request = new Request(
      "http://deploy-unique--screporting.netlify.app/auth/confirm",
      {
        headers: { "x-forwarded-host": "attacker.example" },
      },
    );
    expect(getSiteOrigin(request)).toBe("https://screporting.netlify.app");
  });

  it("strips a single trailing slash from NEXT_PUBLIC_SITE_URL", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://screporting.netlify.app/");
    const request = new Request("http://localhost:3000/auth/confirm");
    expect(getSiteOrigin(request)).toBe("https://screporting.netlify.app");
  });

  it("falls back to x-forwarded-host/proto when env var is unset", () => {
    const request = new Request("http://localhost:3000/auth/confirm", {
      headers: {
        "x-forwarded-host": "screporting.netlify.app",
        "x-forwarded-proto": "https",
      },
    });
    expect(getSiteOrigin(request)).toBe("https://screporting.netlify.app");
  });

  it("defaults proto to https when x-forwarded-proto is absent", () => {
    const request = new Request("http://localhost:3000/auth/confirm", {
      headers: { "x-forwarded-host": "screporting.netlify.app" },
    });
    expect(getSiteOrigin(request)).toBe("https://screporting.netlify.app");
  });

  it("falls back to the origin of request.url when no headers or env var present", () => {
    const request = new Request("http://localhost:3000/auth/confirm");
    expect(getSiteOrigin(request)).toBe("http://localhost:3000");
  });

  it("falls through to the next source when NEXT_PUBLIC_SITE_URL is malformed", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "not-a-url");
    const request = new Request("http://localhost:3000/auth/confirm", {
      headers: { "x-forwarded-host": "screporting.netlify.app" },
    });
    expect(getSiteOrigin(request)).toBe("https://screporting.netlify.app");
  });

  it("falls through to request.url when NEXT_PUBLIC_SITE_URL is empty after trim", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "   ");
    const request = new Request("http://localhost:3000/auth/confirm");
    expect(getSiteOrigin(request)).toBe("http://localhost:3000");
  });

  it("strips multiple trailing slashes from NEXT_PUBLIC_SITE_URL", () => {
    vi.stubEnv(
      "NEXT_PUBLIC_SITE_URL",
      "https://screporting.netlify.app///",
    );
    const request = new Request("http://localhost:3000/auth/confirm");
    expect(getSiteOrigin(request)).toBe("https://screporting.netlify.app");
  });
});
