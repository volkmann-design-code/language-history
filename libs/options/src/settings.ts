import { isAbsolute, relative, resolve } from "node:path";
import { MAX_BANDS, OTHERS, type Theme } from "@language-history/chart";
import type { RenderOptions } from "@language-history/chart/files";
import { type CollectOptions, DEFAULT_ALIASES } from "@language-history/collect";
import type { Dimension } from "@language-history/format";

/**
 * A dimension in a config file: `{ "dirs": "packages/*" }` (one group per matching directory) or
 * `{ "groups": { "app": "src/**", "tests": ["tests/**", "e2e/**"] } }` (first match wins).
 */
export type DimensionSetting =
  | { dirs: string | string[] }
  | { groups: Record<string, string | string[]> };

/**
 * Everything a run can be configured with: the keys of a JSON config file, and what CLI flags and
 * action inputs map to. Unset keys fall back to the defaults below.
 */
export interface Settings {
  /** JSONL data file. Default: language-history.jsonl */
  data?: string;
  // collect
  repo?: string;
  ref?: string;
  tz?: string;
  paths?: string[];
  linguist?: boolean;
  exclude?: string[];
  excludeExt?: string[];
  /** Extensions of more than one part to count on their own, e.g. `["spec.ts", "d.ts"]`. */
  compoundExt?: string[];
  /** Added to the default aliases; `{ "yaml": "yaml" }` undoes one. */
  aliases?: Record<string, string>;
  defaultAliases?: boolean;
  /**
   * Splits beyond the extension, by name (e.g. `package`), in the order they are given. Any
   * dimension switches the data file to format version 2.
   */
  dimensions?: Record<string, DimensionSetting>;
  /** Last day to fill, YYYY-MM-DD or "today". */
  until?: string;
  full?: boolean;
  // render
  out?: string[];
  /** The dimension the chart's bands stand for. Default: ext */
  by?: string;
  threshold?: number;
  maxBands?: number;
  othersListed?: number;
  width?: number;
  height?: number;
  theme?: Theme;
  title?: string;
  tooltips?: boolean;
  /** The excluded files and lines in the header and tooltips. Default: false */
  showExcluded?: boolean;
  /** Band colors by extension or "Others" (`#rgb` / `#rrggbb`), over GitHub's language colors. */
  colors?: Record<string, string>;
  from?: string;
  to?: string;
}

const KEYS: Record<
  keyof Settings,
  "string" | "number" | "boolean" | "list" | "record" | "dimensions"
> = {
  data: "string",
  repo: "string",
  ref: "string",
  tz: "string",
  paths: "list",
  linguist: "boolean",
  exclude: "list",
  excludeExt: "list",
  compoundExt: "list",
  aliases: "record",
  defaultAliases: "boolean",
  dimensions: "dimensions",
  until: "string",
  full: "boolean",
  out: "list",
  by: "string",
  threshold: "number",
  maxBands: "number",
  othersListed: "number",
  width: "number",
  height: "number",
  theme: "string",
  title: "string",
  tooltips: "boolean",
  showExcluded: "boolean",
  colors: "record",
  from: "string",
  to: "string",
};

export const DEFAULT_DATA = "language-history.jsonl";
export const DEFAULT_OUT = ["language-history.svg"];

/** Checks shape and values; `source` names the origin in error messages. */
export function validateSettings(value: unknown, source: string): Settings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${source}: expected a JSON object`);
  }
  for (const [key, v] of Object.entries(value)) {
    const kind = KEYS[key as keyof Settings];
    if (!kind) {
      throw new Error(`${source}: unknown setting "${key}"`);
    }
    if (kind === "dimensions") {
      validateDimensions(v, source);
      continue;
    }
    const ok =
      v === undefined ||
      (kind === "list"
        ? Array.isArray(v) && v.every((item) => typeof item === "string")
        : kind === "record"
          ? typeof v === "object" &&
            v !== null &&
            !Array.isArray(v) &&
            Object.values(v).every((item) => typeof item === "string")
          : typeof v === kind && (kind !== "number" || Number.isFinite(v)));
    if (!ok) {
      throw new Error(
        `${source}: "${key}" must be ${kind === "list" ? "a list of strings" : kind === "record" ? "an object of strings" : `a ${kind}`}`,
      );
    }
  }
  const settings = value as Settings;
  if (settings.theme !== undefined && !["auto", "light", "dark"].includes(settings.theme)) {
    throw new Error(`${source}: "theme" must be auto, light or dark`);
  }
  for (const ext of settings.compoundExt ?? []) {
    if (!/^\.?[^./]+(\.[^./]+)+$/.test(ext)) {
      throw new Error(
        `${source}: "compoundExt" takes extensions of two parts or more, like "spec.ts", got "${ext}"`,
      );
    }
  }
  for (const [ext, color] of Object.entries(settings.colors ?? {})) {
    if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) {
      throw new Error(`${source}: color for "${ext}" must be #rgb or #rrggbb, got "${color}"`);
    }
  }
  return settings;
}

const strings = (v: unknown) =>
  typeof v === "string" || (Array.isArray(v) && v.every((item) => typeof item === "string"));

function validateDimensions(value: unknown, source: string): void {
  if (value === undefined) {
    return;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${source}: "dimensions" must be an object of dimensions by name`);
  }
  for (const [name, dimension] of Object.entries(value)) {
    const at = `${source}: dimension "${name}"`;
    if (!/^[a-z][a-z0-9_-]*$/i.test(name) || name === "ext") {
      throw new Error(`${at}: names are letters, digits, - and _, and "ext" is built in`);
    }
    const kinds =
      typeof dimension === "object" && dimension !== null && !Array.isArray(dimension)
        ? Object.keys(dimension)
        : [];
    if (kinds.length !== 1 || !["dirs", "groups"].includes(kinds[0])) {
      throw new Error(`${at} must be { "dirs": ... } or { "groups": ... }`);
    }
    const { dirs, groups } = dimension as { dirs?: unknown; groups?: unknown };
    if (kinds[0] === "dirs" && !strings(dirs)) {
      throw new Error(`${at}: "dirs" must be a glob or a list of globs`);
    }
    if (
      kinds[0] === "groups" &&
      (typeof groups !== "object" ||
        groups === null ||
        Array.isArray(groups) ||
        !Object.values(groups).every(strings))
    ) {
      throw new Error(`${at}: "groups" must map group names to a glob or a list of globs`);
    }
  }
}

const list = (value: string | string[]) => (typeof value === "string" ? [value] : value);

/** The dimensions as stored in the data: the configured ones, then the extension. */
export function dimensionsOf(settings: Settings): Dimension[] {
  const configured = Object.entries(settings.dimensions ?? {}).map(
    ([name, dimension]): Dimension =>
      "dirs" in dimension
        ? { name, dirs: list(dimension.dirs) }
        : {
            name,
            groups: Object.fromEntries(
              Object.entries(dimension.groups).map(([group, globs]) => [group, list(globs)]),
            ),
          },
  );
  return [...configured, { name: "ext" }];
}

/** Reads a JSON config file; no path means no settings. */
export async function loadSettings(path: string | undefined): Promise<Settings> {
  if (!path) {
    return {};
  }
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`Config file not found: ${path}`);
  }
  return validateSettings(await file.json(), path);
}

/** Later layers win; unset values don't override. `aliases` add up instead of replacing. */
export function mergeSettings(...layers: Settings[]): Settings {
  const merged: Record<string, unknown> = {};
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer)) {
      if (value === undefined) {
        continue;
      }
      merged[key] =
        key === "aliases" || key === "colors"
          ? { ...(merged[key] as Record<string, string>), ...value }
          : value;
    }
  }
  return merged as Settings;
}

const today = () => new Intl.DateTimeFormat("en-CA").format(new Date());

/**
 * The data file and chart outputs relative to the repository root (`repo` has to be the root),
 * leaving out those outside the repository. Paths are relative to `cwd`.
 */
export function ownFiles(settings: Settings, cwd: string): string[] {
  const root = resolve(cwd, settings.repo ?? ".");
  const files = [settings.data ?? DEFAULT_DATA, ...(settings.out ?? DEFAULT_OUT)]
    .map((path) => relative(root, resolve(cwd, path)).split("\\").join("/"))
    .filter((path) => path && !path.startsWith("../") && !isAbsolute(path));
  return [...new Set(files)].sort();
}

export function collectOptions(
  settings: Settings,
  log: (message: string) => void,
  cwd = process.cwd(),
): CollectOptions {
  const aliases: Record<string, string> = {
    ...((settings.defaultAliases ?? true) ? DEFAULT_ALIASES : {}),
    ...Object.fromEntries(
      Object.entries(settings.aliases ?? {}).map(([from, to]) => [
        from.replace(/^\./, ""),
        to.replace(/^\./, ""),
      ]),
    ),
  };
  for (const [from, to] of Object.entries(aliases)) {
    if (from === to) {
      delete aliases[from];
    }
  }
  const dimensions = dimensionsOf(settings);
  const compoundExt = [
    ...new Set((settings.compoundExt ?? []).map((ext) => ext.replace(/^\./, "").toLowerCase())),
  ].sort();
  return {
    repo: settings.repo ?? ".",
    out: settings.data ?? DEFAULT_DATA,
    meta: {
      tool: "language-history",
      // Version 1 data stays as it is, it can only be split by extension
      version: dimensions.length > 1 ? 2 : 1,
      ref: settings.ref ?? "HEAD",
      tz: settings.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      paths: settings.paths ?? [],
      exclude: settings.exclude ?? [],
      excludeExt: settings.excludeExt ?? [],
      // Only when set, so data collected before the setting existed stays valid
      ...(compoundExt.length > 0 && { compoundExt }),
      aliases: Object.fromEntries(Object.entries(aliases).sort()),
      ...(dimensions.length > 1 && { dimensions }),
      linguist: settings.linguist ?? true,
      own: ownFiles(settings, cwd),
    },
    until: settings.until === "today" ? today() : settings.until,
    full: settings.full ?? false,
    log,
  };
}

export function renderOptions(settings: Settings, log: (message: string) => void): RenderOptions {
  const by = settings.by ?? "ext";
  return {
    input: settings.data ?? DEFAULT_DATA,
    outputs: settings.out ?? DEFAULT_OUT,
    threshold: settings.threshold ?? 0.03,
    maxBands: Math.min(MAX_BANDS, settings.maxBands ?? MAX_BANDS),
    othersListed: settings.othersListed ?? 3,
    width: settings.width ?? 1200,
    height: settings.height ?? 460,
    theme: settings.theme ?? "auto",
    title: settings.title ?? "Lines of code",
    by,
    tooltips: settings.tooltips ?? true,
    showExcluded: settings.showExcluded ?? false,
    colors: Object.fromEntries(
      Object.entries(settings.colors ?? {}).map(([key, color]) => [
        key.toLowerCase() === OTHERS.toLowerCase()
          ? OTHERS
          : by === "ext"
            ? key.replace(/^\./, "").toLowerCase()
            : key,
        color,
      ]),
    ),
    from: settings.from,
    to: settings.to,
    log,
  };
}
