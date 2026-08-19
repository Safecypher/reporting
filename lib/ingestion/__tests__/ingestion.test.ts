import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Papa from "papaparse";
import { classify } from "../classify";
import { sha256 } from "../hash";

const FIXTURE_PATH = join(__dirname, "verification.fixture.csv");
const fixtureBytes = new Uint8Array(readFileSync(FIXTURE_PATH));

function parseFixtureHeaderRow(): string[] {
  const text = new TextDecoder("utf-8").decode(fixtureBytes);
  const parsed = Papa.parse<Record<string, string>>(text, { header: true });
  return parsed.meta.fields ?? [];
}

describe("classify", () => {
  it("classifies the verification report from the real fixture header (BOM-tolerant)", () => {
    const headerRow = parseFixtureHeaderRow();
    // PapaParse strips the BOM from the first field when parsing the decoded
    // string (Pitfall 4) — assert that explicitly before trusting classify().
    expect(headerRow[0]).toBe("CreatedAt");
    expect(classify("daily-ver-report_2026-08-13.csv", headerRow)).toBe("verification");
  });

  it("classifies by header signature alone, even with an unrelated filename", () => {
    const headerRow = parseFixtureHeaderRow();
    expect(classify("upload.csv", headerRow)).toBe("verification");
  });

  it("returns null for an unrecognised header/filename", () => {
    expect(classify("random.csv", ["a", "b"])).toBeNull();
  });
});

describe("sha256", () => {
  it("returns a stable 64-char hex string for identical bytes", () => {
    const h1 = sha256(fixtureBytes);
    const h2 = sha256(fixtureBytes);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).toBe(h2);
  });

  it("returns a different hash for different bytes", () => {
    const other = new TextEncoder().encode("not the same content");
    expect(sha256(fixtureBytes)).not.toBe(sha256(other));
  });
});
