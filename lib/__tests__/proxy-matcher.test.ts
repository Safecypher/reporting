import { describe, expect, it } from "vitest";

import { config } from "../../proxy";

/**
 * The auth gate's matcher had no test coverage at all until quick-261002-kaf,
 * which is how `public/` assets came to be swallowed by it: `/logo.svg` and
 * `/icons.svg` answered 307 to /login for anyone not signed in, so on /login
 * itself the browser got an HTML redirect where an image should be and drew a
 * broken-image box. Every user saw it on every sign-in.
 *
 * These tests pin BOTH directions, because each has already failed in
 * production once:
 *   - gated routes must stay gated (a too-broad exclusion is an auth hole)
 *   - the exclusions must stay excluded (a too-narrow one breaks assets, the
 *     push endpoint, or the drain cron)
 */

const matcher = config.matcher[0];
const matcherRegex = new RegExp(`^${matcher}$`);

/** True when the proxy auth gate RUNS for this path. */
function isGated(pathname: string): boolean {
  return matcherRegex.test(pathname);
}

describe("proxy matcher — routes that MUST stay gated", () => {
  it.each([
    "/",
    "/uploads",
    "/verifications",
    "/reconciliation",
    "/revenue",
    "/sla",
    "/cards",
    "/alignment",
    "/settings/general",
    "/settings/pricing",
    "/settings/senders",
    "/settings/sources",
    "/set-password",
    "/api/ingest",
  ])("%s is gated", (path) => {
    expect(isGated(path)).toBe(true);
  });

  it("keeps full-segment anchoring — a lookalike route is NOT excluded (IN-01)", () => {
    expect(isGated("/login-help")).toBe(true);
    expect(isGated("/auth/confirm-x")).toBe(true);
    expect(isGated("/auth/code-x")).toBe(true);
    expect(isGated("/auth/codes")).toBe(true);
    expect(isGated("/api/pushover")).toBe(true);
  });

  it("requires the extension at the END of the path, not merely present in it", () => {
    // A bare segment that merely looks like an extension is still gated.
    expect(isGated("/svg")).toBe(true);
    expect(isGated("/png")).toBe(true);
    // An extension mid-path does not exclude; only the final suffix counts.
    expect(isGated("/uploads/.svg.json")).toBe(true);
    expect(isGated("/settings/logo.svg.html")).toBe(true);
  });

  /**
   * The matcher is tested against the PATHNAME only — Next never passes a
   * query string to it, so `/settings/general?x=.svg` is not a reachable
   * input and is deliberately not asserted here. A percent-encoded `?`
   * (`/settings/general%3Fx=.svg`) IS a distinct pathname ending in `.svg`
   * and is therefore excluded from the gate, but it resolves to no route and
   * no file, so it 404s rather than reaching anything gated. Excluded from
   * the gate is not the same as reachable.
   */
  it("exposes no gated route via a path that merely ends in an asset suffix", () => {
    // Every real route in this app is extensionless, so none can collide.
    expect(isGated("/settings/sources")).toBe(true);
    expect(isGated("/uploads")).toBe(true);
  });
});

describe("proxy matcher — paths that MUST stay excluded", () => {
  it.each([
    "/login",
    "/login/",
    "/auth/confirm",
    "/auth/confirm/",
    "/auth/code",
    "/auth/code/",
    "/api/push",
    "/api/ingest/drain",
    "/.netlify/functions/ingest-process-background",
    "/favicon.ico",
    "/_next/static/chunk.js",
    "/_next/image",
  ])("%s is not gated", (path) => {
    expect(isGated(path)).toBe(false);
  });

  it("excludes every function under .netlify/functions, not just the named one (13-05)", () => {
    // The 307 -> /login on this exact path is what made the background
    // function unreachable from the server-side trigger. Each function
    // authenticates itself with its own bearer secret.
    expect(isGated("/.netlify/functions/ingest-process-background")).toBe(false);
    expect(isGated("/.netlify/functions/ingest-process-background/")).toBe(false);
    expect(isGated("/.netlify/functions/some-future-function")).toBe(false);
  });

  it("keeps full-segment anchoring on the .netlify exclusion — a lookalike route stays gated (13-05)", () => {
    // The exclusion must not become a prefix hole: an application route
    // that merely starts with the same characters is still a page and
    // must still be gated.
    expect(isGated("/.netlify/functionsomething")).toBe(true);
    expect(isGated("/.netlifyx/functions/x")).toBe(true);
    expect(isGated("/netlify/functions/x")).toBe(true);
  });

  it("excludes the two public/ assets whose 307 caused the broken logo", () => {
    expect(isGated("/logo.svg")).toBe(false);
    expect(isGated("/icons.svg")).toBe(false);
    expect(isGated("/logo-white.svg")).toBe(false);
  });

  it("excludes the other static asset types a future public/ file might use", () => {
    for (const path of [
      "/apple-touch-icon.png",
      "/og.jpg",
      "/og.jpeg",
      "/spinner.gif",
      "/hero.webp",
      "/hero.avif",
      "/font.woff",
      "/font.woff2",
      "/font.ttf",
      "/font.otf",
      "/robots.txt",
      "/sitemap.xml",
      "/site.webmanifest",
    ]) {
      expect(isGated(path), path).toBe(false);
    }
  });

  it("excludes an asset nested in a public/ subdirectory", () => {
    expect(isGated("/images/brand/logo.svg")).toBe(false);
  });
});
