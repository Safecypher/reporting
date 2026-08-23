import { describe, expect, it } from "vitest";

import { reconciliationStatusToRowClassName } from "./reconciliation-status";

describe("reconciliationStatusToRowClassName", () => {
  it("maps 'ok' to the success token classes", () => {
    const className = reconciliationStatusToRowClassName("ok");
    expect(className).toContain("border-l-4");
    expect(className).toContain("border-l-[color:var(--success)]");
    expect(className).toContain("bg-[color:var(--success)]/5");
  });

  it("maps 'needs_review' to the warning token classes", () => {
    const className = reconciliationStatusToRowClassName("needs_review");
    expect(className).toContain("border-l-4");
    expect(className).toContain("border-l-[color:var(--warning)]");
    expect(className).toContain("bg-[color:var(--warning)]/5");
  });

  it("maps 'mismatch' to the destructive token classes", () => {
    const className = reconciliationStatusToRowClassName("mismatch");
    expect(className).toContain("border-l-4");
    expect(className).toContain("border-l-destructive");
    expect(className).toContain("bg-destructive/5");
  });
});
