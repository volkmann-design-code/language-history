import {
  type Dataset,
  type DayRecord,
  dimensionNames,
  linesSummary,
  project,
} from "@language-history/format";
import { type BandOptions, computeBands, OTHERS } from "./bands";
import { bandColor, type Scheme } from "./colors";

export type Theme = "auto" | "light" | "dark";

export interface SvgOptions extends BandOptions {
  width: number;
  height: number;
  /** `auto` follows prefers-color-scheme (light fallback); PNG output needs light or dark. */
  theme: Theme;
  title: string;
  /** Per-day hover tooltips (`<title>`); only useful where the SVG is interactive. */
  tooltips: boolean;
  /** The excluded files and lines in the header and tooltips, where the data has them. */
  showExcluded?: boolean;
  /** How many of the keys inside Others the legend names (it always gives their count). */
  othersListed: number;
  /** The dimension the bands stand for (default: `ext`); the others are summed up. */
  by?: string;
  /**
   * Colors by band key (extensions lower-case, no dot) or `Others`, as `#rgb` / `#rrggbb`; they
   * win over GitHub's language colors and apply to both themes.
   */
  colors?: Record<string, string>;
}

interface Palette {
  surface: string;
  primary: string;
  secondary: string;
  muted: string;
  grid: string;
  axis: string;
  hover: string;
  series: string[];
  others: string;
}

// Surfaces and text from the validated reference palette, light and dark each selected. `series`
// only colors extensions GitHub has no color for.
const PALETTES: Record<"light" | "dark", Palette> = {
  light: {
    surface: "#fcfcfb",
    primary: "#0b0b0b",
    secondary: "#52514e",
    muted: "#898781",
    grid: "#e1e0d9",
    axis: "#c3c2b7",
    hover: "rgba(11,11,11,0.10)",
    series: [
      "#2a78d6",
      "#eb6834",
      "#1baf7a",
      "#eda100",
      "#e87ba4",
      "#008300",
      "#6250d6",
      "#e34948",
    ],
    others: "#c3c2b7",
  },
  dark: {
    surface: "#1a1a19",
    primary: "#f0efec",
    secondary: "#c3c2b7",
    muted: "#898781",
    grid: "#2c2c2a",
    axis: "#383835",
    hover: "rgba(255,255,255,0.12)",
    series: [
      "#3987e5",
      "#d95926",
      "#199e70",
      "#c98500",
      "#d55181",
      "#008300",
      "#9085e9",
      "#e66767",
    ],
    others: "#45443f",
  },
};

/** Most named bands: more colors than this are hard to tell apart in a legend. */
export const MAX_BANDS = 8;

const FONT = `system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, 'DejaVu Sans', sans-serif`;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const r1 = (n: number) => Math.round(n * 10) / 10;

export function compact(n: number): string {
  if (n >= 1e6) {
    return `${trim(n / 1e6)}M`;
  }
  if (n >= 1e3) {
    return `${trim(n / 1e3)}k`;
  }
  return String(n);
}
const trim = (n: number) =>
  (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(0) : n.toFixed(1)).replace(/\.0$/, "");
const full = (n: number) => n.toLocaleString("en-US");

/**
 * Axis ticks from 0 to just above `max`: a 1/2/2.5/5 step with 3 to 6 intervals that leaves the
 * least room above `max` (fewer intervals on a tie).
 */
export function niceTicks(max: number): number[] {
  if (max <= 0) {
    return [0];
  }
  const pow = 10 ** Math.floor(Math.log10(max));
  const candidates = [pow / 10, pow, pow * 10]
    .flatMap((p) => [1, 2, 2.5, 5].map((m) => m * p))
    .filter((step) => Number.isInteger(step))
    .map((step) => ({ step, intervals: Math.ceil(max / step) }))
    .filter(({ intervals }) => intervals >= 3 && intervals <= 6)
    .sort((a, b) => a.step * a.intervals - b.step * b.intervals || a.intervals - b.intervals);
  const { step, intervals } = candidates[0] ?? { step: pow, intervals: 10 };
  return Array.from({ length: intervals + 1 }, (_, i) => i * step);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Month starts inside the range, thinned to fit; `index` is the day offset from `dates[0]`. */
function monthTicks(dates: string[], maxTicks: number): { index: number; label: string }[] {
  const starts = dates.flatMap((date, index) => (date.endsWith("-01") ? [{ index, date }] : []));
  const step = [1, 2, 3, 6, 12, 24].find((s) => starts.length / s <= maxTicks) ?? 24;
  return starts
    .filter(({ date }) => (Number(date.slice(5, 7)) - 1) % step === 0)
    .map(({ index, date }, i) => {
      const month = Number(date.slice(5, 7)) - 1;
      const year = date.slice(0, 4);
      const withYear = month === 0 || i === 0;
      return {
        index,
        label: step >= 12 ? year : withYear ? `${MONTHS[month]} ${year}` : MONTHS[month],
      };
    });
}

/** How a band key reads: `.ts` for extensions, the value itself for other dimensions. */
export function keyLabel(key: string, by = "ext"): string {
  return key === OTHERS || by !== "ext" ? key : `.${key}`;
}

/** "12 extensions: .yml, .json, .scss and 9 more"; the count alone when `listed` is 0. */
export function othersSummary(others: string[], listed: number, by = "ext"): string {
  const noun = by === "ext" ? "extension" : by;
  const count = `${others.length} ${others.length === 1 || noun.endsWith("s") ? noun : `${noun}s`}`;
  const shown = others.slice(0, Math.max(0, listed)).map((key) => keyLabel(key, by));
  if (!shown.length) {
    return count;
  }
  const rest = others.length - shown.length;
  return `${count}: ${shown.join(", ")}${rest ? ` and ${rest} more` : ""}`;
}

/**
 * Path commands for a step edge over `ys` (one level per column, in drawing order), starting at
 * the current point on column 0's level. `end(i)` is the x where column i ends.
 * Runs of equal levels collapse into one horizontal segment.
 */
export function stepEdge(ys: number[], end: (i: number) => number): string {
  let d = "";
  for (let i = 0; i < ys.length; i++) {
    const next = ys[i + 1];
    if (next === ys[i]) {
      continue;
    }
    d += `H${end(i)}`;
    if (next !== undefined) {
      d += `V${next}`;
    }
  }
  return d;
}

/** The days with their counts summed up to the dimension `by`. */
export function daysBy(dataset: Dataset, by: string): DayRecord[] {
  const names = dimensionNames(dataset.meta);
  // Carried days share their counts with the day they carry, so each is summed up once
  const summed = new Map<Record<string, number>, Record<string, number>>();
  return dataset.days.map((day) => {
    let counts = summed.get(day.counts);
    if (!counts) {
      counts = project(day.counts, names, [by]);
      summed.set(day.counts, counts);
    }
    return counts === day.counts ? day : { ...day, counts };
  });
}

export function renderSvg(dataset: Dataset, options: SvgOptions): string {
  const by = options.by ?? "ext";
  const days = daysBy(dataset, by);
  if (days.length === 0) {
    throw new Error("No data to render");
  }
  const bands = computeBands(days, options);
  const base = PALETTES[options.theme === "dark" ? "dark" : "light"];
  const scheme = options.theme === "dark" ? "dark" : "light";
  // GitHub's language colors only mean something for extensions. Other keys take the palette's
  // colors in the order of their names: distinct, and independent of their size.
  const slots = new Map(
    by === "ext"
      ? []
      : [...bands.keys]
          .filter((key) => key !== OTHERS)
          .sort()
          .map((key, i) => [key, i]),
  );
  const color = (s: Scheme, k: number) =>
    bandColor(bands.keys[k], s, PALETTES[s], options.colors, slots.get(bands.keys[k]));
  const W = options.width;
  const H = options.height;
  const pad = 16;
  const parts: string[] = [];

  // Header
  const first = days[0].date;
  const last = days[days.length - 1];
  const scope = dataset.meta?.paths.length ? ` in ${dataset.meta.paths.join(", ")}` : "";
  parts.push(
    `<text x="${pad}" y="30" class="t-primary" fill="${base.primary}" font-size="16" font-weight="600">${esc(options.title)}</text>`,
    `<text x="${pad}" y="50" class="t-secondary" fill="${base.secondary}" font-size="12">${esc(
      `Non-blank lines${scope}, last commit per day · ${first} – ${last.date} · ${linesSummary(last.total, options.showExcluded ? last.excluded : undefined)}`,
    )}</text>`,
  );

  // Legend, largest band (bottom of the stack) first, Others last
  let lx = pad;
  let ly = 74;
  for (let k = 0; k < bands.keys.length; k++) {
    const key = bands.keys[k];
    const label = keyLabel(key, by);
    let value = compact(bands.values[bands.values.length - 1][k]);
    if (key === OTHERS && bands.others.length) {
      value += ` · ${othersSummary(bands.others, options.othersListed, by)}`;
    }
    const width = 10 + 6 + (label.length + value.length + 1) * 6.6 + 16;
    if (lx + width > W - pad) {
      lx = pad;
      ly += 18;
    }
    parts.push(
      `<rect x="${lx}" y="${ly - 9}" width="10" height="10" rx="2" class="s${k}" fill="${color(scheme, k)}"/>`,
      `<text x="${lx + 16}" y="${ly}" font-size="12"><tspan class="t-primary" fill="${base.primary}">${esc(
        label,
      )}</tspan> <tspan class="t-muted" fill="${base.muted}">${esc(value)}</tspan></text>`,
    );
    lx += width;
  }

  // Plot area
  const top = ly + 22;
  const bottom = H - 28;
  const left = 52;
  const right = W - pad;
  const n = days.length;
  const colW = (right - left) / n;
  const yMax = Math.max(...days.map((d) => d.total));
  const ticks = niceTicks(yMax);
  const scaleMax = ticks[ticks.length - 1];
  const y = (v: number) => bottom - (v / scaleMax) * (bottom - top);
  const x = (i: number) => left + i * colW;

  for (const t of ticks) {
    parts.push(
      `<line x1="${left}" x2="${right}" y1="${r1(y(t))}" y2="${r1(y(t))}" class="${t === 0 ? "axis" : "grid"}" stroke="${
        t === 0 ? base.axis : base.grid
      }" stroke-width="1"/>`,
      `<text x="${left - 8}" y="${r1(y(t)) + 4}" text-anchor="end" font-size="11" class="t-muted tabular" fill="${
        base.muted
      }">${compact(t)}</text>`,
    );
  }
  for (const tick of monthTicks(
    days.map((d) => d.date),
    Math.floor((right - left) / 70),
  )) {
    const tx = r1(x(tick.index));
    parts.push(
      `<line x1="${tx}" x2="${tx}" y1="${bottom}" y2="${bottom + 4}" class="axis" stroke="${base.axis}"/>`,
      `<text x="${tx}" y="${bottom + 17}" text-anchor="middle" font-size="11" class="t-muted" fill="${base.muted}">${tick.label}</text>`,
    );
  }

  // Stacked bands: lower[i] / upper[i] are the cumulative sums below / including band k
  const lower = new Array<number>(n).fill(0);
  const discrete = colW >= 8;
  for (let k = 0; k < bands.keys.length; k++) {
    const upper = lower.map((v, i) => v + bands.values[i][k]);
    const fill = color(scheme, k);
    if (discrete) {
      // Wide enough for real columns: 2px gap between columns and between stacked segments
      const rects = upper.map((u, i) => {
        const h = y(lower[i]) - y(u) - 2;
        return h > 0
          ? `<rect x="${r1(x(i) + 1)}" y="${r1(y(u))}" width="${r1(colW - 2)}" height="${r1(h)}"/>`
          : "";
      });
      parts.push(`<g class="s${k}" fill="${fill}">${rects.join("")}</g>`);
    } else {
      // Too narrow for gaps: one step-shaped area per band, identical to gapless columns
      const top = stepEdge(
        upper.map((v) => r1(y(v))),
        (i) => r1(x(i + 1)),
      );
      // Right to left: reversed column j is column n-1-j, which ends (leftwards) at x(n-1-j)
      const bottomEdge = stepEdge(
        [...lower].reverse().map((v) => r1(y(v))),
        (j) => r1(x(n - 1 - j)),
      );
      parts.push(
        `<path d="M${r1(x(0))},${r1(y(upper[0]))}${top}V${r1(y(lower[n - 1]))}${bottomEdge}Z" class="s${k}" fill="${fill}"/>`,
      );
      if (k < bands.keys.length - 1) {
        // Surface-colored seam on the band's top edge separates it from the next band
        parts.push(
          `<path d="M${r1(x(0))},${r1(y(upper[0]))}${top}" class="seam" fill="none" stroke="${base.surface}" stroke-width="1"/>`,
        );
      }
    }
    lower.splice(0, n, ...upper);
  }

  // Hover targets: full-height column per day with a native tooltip
  if (options.tooltips) {
    const hits = days.map((day, i) => {
      const lines = [
        `${day.date}${day.carried ? " (no commit, carried over)" : ` · ${day.commit.slice(0, 9)}`}`,
        `Total ${full(day.total)}`,
        ...(options.showExcluded && day.excluded?.files
          ? [`Excluded ${full(day.excluded.lines)} in ${full(day.excluded.files)} files`]
          : []),
        ...bands.keys
          .map((key, k) => ({ key, v: bands.values[i][k] }))
          .reverse()
          .map(({ key, v }) => `${keyLabel(key, by)} ${full(v)}`),
      ];
      return `<rect x="${r1(x(i))}" y="${r1(top)}" width="${r1(colW)}" height="${r1(
        bottom - top,
      )}"><title>${esc(lines.join("\n"))}</title></rect>`;
    });
    parts.push(`<g class="hit" fill="transparent">${hits.join("")}</g>`);
  }

  const css = [
    `.hit rect:hover{fill:${base.hover}}`,
    `.tabular{font-variant-numeric:tabular-nums}`,
  ];
  if (options.theme === "auto") {
    const dark = PALETTES.dark;
    const rules = [
      `.bg{fill:${dark.surface}}`,
      `.t-primary{fill:${dark.primary}}`,
      `.t-secondary{fill:${dark.secondary}}`,
      `.t-muted{fill:${dark.muted}}`,
      `.grid{stroke:${dark.grid}}`,
      `.axis{stroke:${dark.axis}}`,
      `.seam{stroke:${dark.surface}}`,
      `.hit rect:hover{fill:${dark.hover}}`,
      ...bands.keys.map((_, k) => `.s${k}{fill:${color("dark", k)}}`),
    ];
    css.push(`@media (prefers-color-scheme: dark){${rules.join("")}}`);
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${esc(
      FONT,
    )}" role="img" aria-label="${esc(`${options.title}: ${full(last.total)} lines on ${last.date}`)}">`,
    `<style>${css.join("")}</style>`,
    `<rect width="${W}" height="${H}" rx="6" class="bg" fill="${base.surface}"/>`,
    ...parts,
    `</svg>`,
  ].join("\n");
}
