import { describe, expect, it } from "vitest";

import { DATA_WINDOW_START, DATA_WINDOW_START_TS, clampToDataWindow } from "../data-window";

describe("DATA_WINDOW_START / DATA_WINDOW_START_TS", () => {
  it("the calendar-date and timestamptz forms name the same instant", () => {
    expect(DATA_WINDOW_START).toBe("2026-08-13");
    expect(DATA_WINDOW_START_TS).toBe("2026-08-13T00:00:00Z");
    expect(DATA_WINDOW_START_TS.startsWith(DATA_WINDOW_START)).toBe(true);
  });
});

describe("clampToDataWindow", () => {
  it("clamps a date before the floor up to the floor", () => {
    expect(clampToDataWindow("2026-01-01")).toBe(DATA_WINDOW_START);
    expect(clampToDataWindow("2020-12-31")).toBe(DATA_WINDOW_START);
  });

  it("leaves a date at the floor unchanged", () => {
    expect(clampToDataWindow("2026-08-13")).toBe("2026-08-13");
  });

  it("leaves a date after the floor unchanged", () => {
    expect(clampToDataWindow("2026-09-01")).toBe("2026-09-01");
    expect(clampToDataWindow("2099-01-01")).toBe("2099-01-01");
  });
});
