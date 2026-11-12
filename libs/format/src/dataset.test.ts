import { describe, expect, test } from "bun:test";
import {
  type Dataset,
  type DayRecord,
  KEY_SEPARATOR,
  type Meta,
  nextDay,
  parseDataset,
  project,
  sameSettings,
  serializeDataset,
} from "./dataset";

const meta: Meta = {
  tool: "language-history",
  version: 1,
  ref: "main",
  tz: "UTC",
  paths: [],
  exclude: [],
  excludeExt: [],
  aliases: { yaml: "yml" },
  linguist: true,
  linguistRules: 1,
  own: [],
  attributes: "",
};

const dataset: Dataset = {
  meta,
  days: [
    { date: "2026-01-01", commit: "a", carried: false, total: 3, counts: { ts: 2, md: 1 } },
    { date: "2026-01-02", commit: "a", carried: true, total: 3, counts: { ts: 2, md: 1 } },
  ],
};

const key = (...values: string[]) => values.join(KEY_SEPARATOR);

describe("nextDay", () => {
  test("crosses month and year boundaries", () => {
    expect(nextDay("2026-01-31")).toBe("2026-02-01");
    expect(nextDay("2028-02-28")).toBe("2028-02-29");
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
  });
});

describe("version 1", () => {
  test("one JSON line for the settings, then one per day with every count", () => {
    const lines = serializeDataset(dataset).trimEnd().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0])).toEqual({ meta });
    expect(JSON.parse(lines[2])).toEqual({
      date: "2026-01-02",
      commit: "a",
      carried: true,
      total: 3,
      byExt: { ts: 2, md: 1 },
    });
  });

  test("round-trips", () => {
    expect(parseDataset(serializeDataset(dataset))).toEqual(dataset);
  });

  test("round-trips the excluded files, which older files don't have", () => {
    const [first, second] = dataset.days;
    const days = [first, { ...second, excluded: { files: 2, lines: 40 } }];
    const text = serializeDataset({ meta, days });
    expect(JSON.parse(text.trimEnd().split("\n")[2]).excluded).toEqual({ files: 2, lines: 40 });
    expect(parseDataset(text).days).toEqual(days);
  });

  test("blank lines are ignored and the settings line is optional", () => {
    const text = `\n${serializeDataset({ meta: null, days: [dataset.days[0]] })}\n`;
    expect(parseDataset(text)).toEqual({ meta: null, days: [dataset.days[0]] });
  });

  test("settings compare by value", () => {
    expect(sameSettings(meta, { ...meta })).toBe(true);
    expect(sameSettings(meta, { ...meta, tz: "Europe/Berlin" })).toBe(false);
  });
});

describe("version 2", () => {
  const meta2: Meta = {
    ...meta,
    version: 2,
    dimensions: [{ name: "package", dirs: ["packages/*"] }, { name: "ext" }],
  };
  const day = (
    date: string,
    commit: string,
    carried: boolean,
    counts: Record<string, number>,
  ): DayRecord => ({
    date,
    commit,
    carried,
    total: Object.values(counts).reduce((a, b) => a + b, 0),
    counts,
  });
  const first = { [key("packages/a", "ts")]: 10, [key("packages/b", "ts")]: 5 };
  const second = { [key("packages/a", "ts")]: 12, [key("packages/a", "md")]: 1 };
  const days = [
    day("2026-01-01", "a", false, first),
    day("2026-01-02", "a", true, first),
    day("2026-01-03", "a", true, first),
    day("2026-01-04", "b", false, second),
    day("2026-01-05", "b", true, second),
  ];
  const lines = serializeDataset({ meta: meta2, days }).trimEnd().split("\n");

  test("stores days with a commit as changes, and the last day when carried over", () => {
    expect(lines.slice(1).map((line) => JSON.parse(line))).toEqual([
      {
        date: "2026-01-01",
        commit: "a",
        total: 15,
        set: [
          ["packages/a", "ts", 10],
          ["packages/b", "ts", 5],
        ],
      },
      {
        date: "2026-01-04",
        commit: "b",
        total: 13,
        set: [
          ["packages/a", "md", 1],
          ["packages/a", "ts", 12],
          ["packages/b", "ts", 0],
        ],
      },
      { date: "2026-01-05", carried: true },
    ]);
  });

  test("round-trips, filling in the days without a commit", () => {
    const parsed = parseDataset(lines.join("\n"));
    expect(parsed.meta).toEqual(meta2);
    expect(parsed.days).toEqual(days);
  });

  test("stores the excluded files on the line of a day with a commit", () => {
    const withExcluded = days.map((d) => ({ ...d, excluded: { files: 3, lines: 70 } }));
    const text = serializeDataset({ meta: meta2, days: withExcluded });
    expect(JSON.parse(text.trimEnd().split("\n")[1])).toEqual({
      date: "2026-01-01",
      commit: "a",
      total: 15,
      excluded: { files: 3, lines: 70 },
      set: [
        ["packages/a", "ts", 10],
        ["packages/b", "ts", 5],
      ],
    });
    expect(parseDataset(text).days).toEqual(withExcluded);
  });

  test("a day without changes still gets a line", () => {
    const same = [day("2026-01-01", "a", false, first), day("2026-01-02", "b", false, first)];
    const text = serializeDataset({ meta: meta2, days: same });
    expect(text.trimEnd().split("\n")[2]).toBe(
      JSON.stringify({ date: "2026-01-02", commit: "b", total: 15, set: [] }),
    );
    expect(parseDataset(text).days).toEqual(same);
  });
});

describe("project", () => {
  const counts = {
    [key("packages/a", "ts")]: 10,
    [key("packages/a", "md")]: 2,
    [key("packages/b", "ts")]: 5,
  };
  const names = ["package", "ext"];

  test("sums over the dimensions left out", () => {
    expect(project(counts, names, ["ext"])).toEqual({ ts: 15, md: 2 });
    expect(project(counts, names, ["package"])).toEqual({ "packages/a": 12, "packages/b": 5 });
  });

  test("keeps or reorders keys", () => {
    expect(project(counts, names, names)).toBe(counts);
    expect(project(counts, names, ["ext", "package"])).toEqual({
      [key("ts", "packages/a")]: 10,
      [key("md", "packages/a")]: 2,
      [key("ts", "packages/b")]: 5,
    });
  });

  test("names the dimensions there are when one is missing", () => {
    expect(() => project(counts, names, ["author"])).toThrow(
      'The data has no dimension "author" (it has package, ext)',
    );
  });
});
