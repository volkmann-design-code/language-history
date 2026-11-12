import { describe, expect, test } from "bun:test";
import { toCsv } from "./csv";
import type { Dataset, Meta } from "./dataset";

const meta = {
  version: 2,
  dimensions: [{ name: "package", dirs: ["packages/*"] }, { name: "ext" }],
} as Meta;
const counts = { "packages/a\u0000ts": 10, "packages/a\u0000md": 2, 'say, "hi"\u0000ts': 5 };
const dataset: Dataset = {
  meta,
  days: [
    // Collected before excluded files were counted
    { date: "2026-01-01", commit: "a", carried: false, total: 17, counts },
    {
      date: "2026-01-02",
      commit: "b",
      carried: false,
      total: 17,
      excluded: { files: 2, lines: 40 },
      counts,
    },
  ],
};

describe("toCsv", () => {
  test("the excluded files and lines, then a column per key of all dimensions, largest first, quoted where needed", () => {
    expect(toCsv(dataset)).toBe(
      [
        'date,commit,carried,total,excludedFiles,excludedLines,packages/a/ts,"say, ""hi""/ts",packages/a/md',
        "2026-01-01,a,false,17,,,10,5,2",
        "2026-01-02,b,false,17,2,40,10,5,2",
        "",
      ].join("\n"),
    );
  });

  test("summed up to some of the dimensions", () => {
    expect(toCsv(dataset, ["ext"]).split("\n").slice(0, 2)).toEqual([
      "date,commit,carried,total,excludedFiles,excludedLines,ts,md",
      "2026-01-01,a,false,17,,,15,2",
    ]);
  });
});
