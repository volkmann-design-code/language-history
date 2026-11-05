/**
 * What lines are split by. Every count belongs to one value per dimension, e.g. a package and an
 * extension. `ext` is the file extension; the others group files by their path.
 */
export type Dimension = ExtDimension | DirsDimension | GroupsDimension;

export interface ExtDimension {
  name: "ext";
}

/** One group per directory matching a pattern (`packages/*`), named by its path. */
export interface DirsDimension {
  name: string;
  dirs: string[];
}

/** Named groups of globs; a file belongs to the first group with a matching glob. */
export interface GroupsDimension {
  name: string;
  groups: Record<string, string[]>;
}

/** The group of files no directory pattern or group glob matches. */
export const REST = "(rest)";

/** Joins the values of a key, one per dimension; a key with a single dimension is just its value. */
export const KEY_SEPARATOR = "\u0000";

/** First line of the JSONL file: the settings the data was collected with. */
export interface Meta {
  tool: "language-history";
  /**
   * 1: one line per day with every count (`byExt`), split by extension only.
   * 2: split by `dimensions`; only days with a commit, each with the counts that changed.
   */
  version: 1 | 2;
  ref: string;
  tz: string;
  paths: string[];
  exclude: string[];
  excludeExt: string[];
  /** Extensions of more than one part, e.g. `spec.ts`. Absent when there are none. */
  compoundExt?: string[];
  aliases: Record<string, string>;
  /** Version 2 only, in the order of the values in a key. Version 1 is `[{ name: "ext" }]`. */
  dimensions?: Dimension[];
  /**
   * Skip generated and vendored files: by the built-in path rules and by linguist-generated /
   * linguist-vendored in the checkout's .gitattributes.
   */
  linguist: boolean;
  /** Version of the built-in path rules (0 when `linguist` is off), so changes trigger a full run. */
  linguistRules: number;
  /**
   * The tool's own files (data, charts), repo-relative: never counted, and commits that change
   * only them don't count as commits.
   */
  own: string[];
  /** Fingerprint of the checkout's .gitattributes files, so edits to them trigger a full run. */
  attributes: string;
}

/** One per calendar day, in memory; the file stores them as described at `Meta.version`. */
export interface DayRecord {
  date: string;
  /** Last first-parent commit of that day, or of the last day with a commit when `carried`. */
  commit: string;
  /** No commit on this day; values are carried over from the previous one. */
  carried: boolean;
  total: number;
  /** Lines per key (see `KEY_SEPARATOR`); keys without lines are left out. */
  counts: Record<string, number>;
}

export interface Dataset {
  meta: Meta | null;
  days: DayRecord[];
}

/** A version 2 line: the counts that changed since the previous day with a commit. */
interface ChangeRow {
  date: string;
  commit: string;
  total: number;
  /** `[...values, lines]` per changed key; 0 lines means the key is gone. */
  set: (string | number)[][];
}

export function dimensionNames(meta: Meta | null): string[] {
  return meta?.dimensions?.map((dimension) => dimension.name) ?? ["ext"];
}

export function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Sums `counts` (keyed by the dimensions `names`) up to keys of the dimensions `by`, e.g. lines
 * per package and extension to lines per package.
 */
export function project(
  counts: Record<string, number>,
  names: string[],
  by: string[],
): Record<string, number> {
  const indices = by.map((name) => {
    const index = names.indexOf(name);
    if (index < 0) {
      throw new Error(`The data has no dimension "${name}" (it has ${names.join(", ")})`);
    }
    return index;
  });
  if (indices.length === names.length && indices.every((index, i) => index === i)) {
    return counts;
  }
  const result: Record<string, number> = {};
  for (const [key, lines] of Object.entries(counts)) {
    const values = key.split(KEY_SEPARATOR);
    const target = indices.map((index) => values[index]).join(KEY_SEPARATOR);
    result[target] = (result[target] ?? 0) + lines;
  }
  return result;
}

const byLines = (counts: Map<string, number>) =>
  Object.fromEntries([...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)));

export function parseDataset(text: string): Dataset {
  let meta: Meta | null = null;
  const days: DayRecord[] = [];
  // Version 2: the counts as of the last line, and the days between lines are carried over
  const state = new Map<string, number>();
  const carryUntil = (date: string) => {
    let previous = days[days.length - 1];
    while (previous && nextDay(previous.date) < date) {
      previous = { ...previous, date: nextDay(previous.date), carried: true };
      days.push(previous);
    }
  };
  for (const line of text.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const row = JSON.parse(line);
    if (row.meta) {
      meta = row.meta;
    } else if (row.byExt) {
      const { byExt, ...rest } = row;
      days.push({ ...rest, counts: byExt });
    } else if (row.set) {
      const change = row as ChangeRow;
      carryUntil(change.date);
      for (const entry of change.set) {
        const lines = entry[entry.length - 1] as number;
        const key = entry.slice(0, -1).join(KEY_SEPARATOR);
        if (lines) {
          state.set(key, lines);
        } else {
          state.delete(key);
        }
      }
      days.push({
        date: change.date,
        commit: change.commit,
        carried: false,
        total: change.total,
        counts: byLines(state),
      });
    } else if (row.carried) {
      carryUntil(nextDay(row.date));
    }
  }
  return { meta, days };
}

export function serializeDataset(dataset: Dataset): string {
  const lines = dataset.meta ? [JSON.stringify({ meta: dataset.meta })] : [];
  if (dataset.meta?.version === 2) {
    lines.push(...changeRows(dataset.days));
  } else {
    for (const { counts, ...day } of dataset.days) {
      lines.push(JSON.stringify({ ...day, byExt: counts }));
    }
  }
  return `${lines.join("\n")}\n`;
}

/** Version 2 lines: days with a commit as changes, and the last day when it is carried over. */
function changeRows(days: DayRecord[]): string[] {
  const rows: string[] = [];
  let previous: Record<string, number> = {};
  for (const day of days) {
    if (day.carried) {
      continue;
    }
    const set: (string | number)[][] = [];
    const keys = new Set([...Object.keys(previous), ...Object.keys(day.counts)]);
    for (const key of [...keys].sort()) {
      const lines = day.counts[key] ?? 0;
      if (lines !== (previous[key] ?? 0)) {
        set.push([...key.split(KEY_SEPARATOR), lines]);
      }
    }
    const row: ChangeRow = { date: day.date, commit: day.commit, total: day.total, set };
    rows.push(JSON.stringify(row));
    previous = day.counts;
  }
  const last = days[days.length - 1];
  if (last?.carried) {
    rows.push(JSON.stringify({ date: last.date, carried: true }));
  }
  return rows;
}

export function sameSettings(a: Meta, b: Meta): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
