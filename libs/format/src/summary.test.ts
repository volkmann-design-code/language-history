import { describe, expect, test } from "bun:test";
import { linesSummary } from "./summary";

describe("linesSummary", () => {
  test("the lines, then what was left out", () => {
    expect(linesSummary(152_300, { files: 37, lines: 8_410 })).toBe(
      "152,300 lines · 8,410 excluded in 37 files",
    );
    expect(linesSummary(5, { files: 1, lines: 3 })).toBe("5 lines · 3 excluded in 1 file");
  });

  test("only the lines when nothing was left out, or the data doesn't say", () => {
    expect(linesSummary(5, { files: 0, lines: 0 })).toBe("5 lines");
    expect(linesSummary(5)).toBe("5 lines");
  });
});
