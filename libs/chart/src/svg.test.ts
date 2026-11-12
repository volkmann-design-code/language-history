import { describe, expect, test } from "bun:test";
import type { Dataset, DayRecord } from "@language-history/format";
import { compact, niceTicks, othersSummary, renderSvg, type SvgOptions, stepEdge } from "./svg";

describe("niceTicks", () => {
  test("takes the step that leaves the least room above the maximum", () => {
    expect(niceTicks(422_886)).toEqual([0, 100_000, 200_000, 300_000, 400_000, 500_000]);
    expect(niceTicks(1_234_567)).toEqual([0, 250_000, 500_000, 750_000, 1_000_000, 1_250_000]);
  });

  test("a maximum on a tick ends the axis there", () => {
    expect(niceTicks(400)).toEqual([0, 100, 200, 300, 400]);
  });

  test("small and empty values", () => {
    expect(niceTicks(7)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(0)).toEqual([0]);
  });
});

describe("stepEdge", () => {
  const end = (i: number) => (i + 1) * 10;

  test("one horizontal segment per run of equal levels", () => {
    expect(stepEdge([5, 5, 3, 3, 3, 7], end)).toBe("H20V3H50V7H60");
  });

  test("a constant edge is a single segment", () => {
    expect(stepEdge([4, 4, 4, 4], end)).toBe("H40");
    expect(stepEdge([4], end)).toBe("H10");
  });

  test("every change produces a step", () => {
    expect(stepEdge([1, 2, 1], end)).toBe("H10V2H20V1H30");
  });
});

describe("othersSummary", () => {
  test("count, then the first extensions and how many are left", () => {
    expect(othersSummary(["yml", "json", "scss", "sh", "css"], 3)).toBe(
      "5 extensions: .yml, .json, .scss and 2 more",
    );
    expect(othersSummary(["yml", "json"], 3)).toBe("2 extensions: .yml, .json");
    expect(othersSummary(["yml"], 3)).toBe("1 extension: .yml");
    expect(othersSummary(["yml", "json"], 0)).toBe("2 extensions");
  });

  test("other dimensions use their name and plain values", () => {
    expect(othersSummary(["packages/a", "packages/b"], 1, "package")).toBe(
      "2 packages: packages/a and 1 more",
    );
    expect(othersSummary(["docs"], 1, "layer")).toBe("1 layer: docs");
  });
});

describe("compact", () => {
  test("abbreviates thousands and millions", () => {
    expect(compact(0)).toBe("0");
    expect(compact(999)).toBe("999");
    expect(compact(1500)).toBe("1.5k");
    expect(compact(2000)).toBe("2k");
    expect(compact(12_345)).toBe("12k");
    expect(compact(345_678)).toBe("346k");
    expect(compact(1_200_000)).toBe("1.2M");
  });
});

describe("renderSvg", () => {
  const days = (count: number): DayRecord[] =>
    Array.from({ length: count }, (_, i) => {
      const date = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
      const counts = { ts: 100 + i, md: 50 };
      return { date, commit: `c${i}`, carried: i % 3 === 1, total: 150 + i, counts };
    });
  const options: SvgOptions = {
    width: 1200,
    height: 460,
    theme: "auto",
    title: "Lines <of> code",
    tooltips: true,
    threshold: 0.03,
    maxBands: 8,
    othersListed: 3,
  };
  const render = (dataset: Partial<Dataset>, overrides: Partial<SvgOptions> = {}) =>
    renderSvg({ meta: null, days: [], ...dataset }, { ...options, ...overrides });

  test("throws without data", () => {
    expect(() => render({})).toThrow("No data");
  });

  test("a band's color follows its extension, not its rank", () => {
    const day = (counts: Record<string, number>): DayRecord => ({
      date: "2026-01-01",
      commit: "c",
      carried: false,
      total: Object.values(counts).reduce((a, b) => a + b, 0),
      counts,
    });
    const legendFill = (svg: string, ext: string) =>
      new RegExp(`fill="(#[0-9a-f]{6})"/>\\s*<text[^>]*><tspan[^>]*>\\.${ext}<`).exec(svg)?.[1];
    const tsFirst = render({ days: [day({ ts: 100, md: 50 })] }, { theme: "light" });
    const mdFirst = render({ days: [day({ md: 100, ts: 50 })] }, { theme: "light" });
    expect(legendFill(tsFirst, "ts")).toBe("#3178c6");
    expect(legendFill(mdFirst, "ts")).toBe("#3178c6");
    expect(legendFill(mdFirst, "md")).toBe("#083fa1");

    const custom = render(
      { days: [day({ ts: 100 })] },
      { theme: "light", colors: { ts: "#abcdef" } },
    );
    expect(legendFill(custom, "ts")).toBe("#abcdef");
  });

  test("few days: one rect per column and band", () => {
    const svg = render({ days: days(10) });
    const band = svg.match(/<g class="s0" fill="[^"]+">(.*?)<\/g>/)?.[1] ?? "";
    expect(band.match(/<rect /g)).toHaveLength(10);
    expect(svg).not.toContain("<path");
  });

  test("many days: one step path per band, with a seam between bands", () => {
    const svg = render({ days: days(400) });
    expect(svg.match(/<path d="[^"]+" class="s\d"/g)).toHaveLength(2);
    expect(svg.match(/class="seam"/g)).toHaveLength(1);
  });

  test("legend names the bands with their latest value", () => {
    const svg = render({ days: days(10) });
    expect(svg).toContain(">.ts</tspan>");
    expect(svg).toContain(">.md</tspan>");
    expect(svg).toContain(">109</tspan>");
    expect(svg).toContain(">50</tspan>");
  });

  test("the Others legend entry counts and names its extensions", () => {
    const dataset = {
      days: [
        {
          date: "2026-01-01",
          commit: "c",
          carried: false,
          total: 1000,
          counts: { ts: 900, yml: 50, json: 30, scss: 15, sh: 5 },
        },
      ],
    };
    expect(render(dataset, { threshold: 0.1 })).toContain(
      ">100 · 4 extensions: .yml, .json, .scss and 1 more</tspan>",
    );
    expect(render(dataset, { threshold: 0.1, othersListed: 0 })).toContain(
      ">100 · 4 extensions</tspan>",
    );
  });

  test("bands by another dimension: summed up, named as they are, no language colors", () => {
    const meta = {
      version: 2,
      paths: [],
      dimensions: [{ name: "package", dirs: ["packages/*"] }, { name: "ext" }],
    } as unknown as Dataset["meta"];
    const counts = { "go\u0000ts": 60, "go\u0000md": 10, "web\u0000ts": 30 };
    const dataset = {
      meta,
      days: [{ date: "2026-01-01", commit: "c", carried: false, total: 100, counts }],
    };

    const byPackage = render(dataset, { by: "package", theme: "light" });
    expect(byPackage).toContain(">go</tspan> <tspan");
    expect(byPackage).toContain(">70</tspan>");
    expect(byPackage).toContain(">web</tspan>");
    // A package named like a language does not get that language's color; packages get distinct
    // palette colors in the order of their names
    expect(byPackage).not.toContain("#00add8");
    const fill = (svg: string, label: string) =>
      new RegExp(`fill="(#[0-9a-f]{6})"/>\\s*<text[^>]*><tspan[^>]*>${label}<`).exec(svg)?.[1];
    expect(fill(byPackage, "go")).toBeDefined();
    expect(fill(byPackage, "go")).not.toBe(fill(byPackage, "web"));
    const swapped = { ...dataset.days[0], counts: { "go\u0000ts": 10, "web\u0000ts": 90 } };
    const webFirst = render({ meta, days: [swapped] }, { by: "package", theme: "light" });
    expect(fill(webFirst, "go")).toBe(fill(byPackage, "go"));

    const byExt = render(dataset, { theme: "light" });
    expect(byExt).toContain(">.ts</tspan>");
    expect(byExt).toContain(">90</tspan>");

    expect(() => render(dataset, { by: "author" })).toThrow('no dimension "author"');
  });

  test("escapes the title", () => {
    expect(render({ days: days(3) })).toContain("Lines &lt;of&gt; code");
  });

  test("the header and tooltips name the excluded files when the data has them", () => {
    const excluded = days(3).map((day) => ({ ...day, excluded: { files: 1200, lines: 34_567 } }));
    const svg = render({ days: excluded });
    expect(svg).toContain("152 lines · 34,567 excluded in 1,200 files</text>");
    expect(svg).toContain("Excluded 34,567 in 1,200 files");
    const without = render({ days: days(3) });
    expect(without).toContain("· 152 lines</text>");
    expect(without).not.toContain("Excluded");
  });

  test("tooltips mark carried days and can be turned off", () => {
    expect(render({ days: days(3) })).toContain("2026-01-02 (no commit, carried over)");
    expect(render({ days: days(3) }, { tooltips: false })).not.toContain("<title>");
  });

  test("auto theme adds dark-mode rules, fixed themes do not", () => {
    expect(render({ days: days(3) })).toContain("@media (prefers-color-scheme: dark)");
    expect(render({ days: days(3) }, { theme: "dark" })).not.toContain("@media");
  });
});
