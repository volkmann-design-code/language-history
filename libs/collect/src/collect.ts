import {
  type DayRecord,
  type Excluded,
  KEY_SEPARATOR,
  linesSummary,
  type Meta,
  nextDay,
  sameSettings,
} from "@language-history/format";
import { readDataset, writeDataset } from "@language-history/format/file";
import { createClassifier } from "./classify";
import { countNonBlankLines } from "./count";
import { createPathValue } from "./dimensions";
import {
  attributesFingerprint,
  booleanAttributes,
  firstParentCommits,
  listBlobs,
  readBlobs,
} from "./git";
import { LINGUIST_RULES, linguistDefaults } from "./linguist";

const LINGUIST_ATTRIBUTES = ["linguist-generated", "linguist-vendored"];

export interface CollectOptions {
  repo: string;
  out: string;
  /** `attributes` and `linguistRules` are filled in here. */
  meta: Omit<Meta, "attributes" | "linguistRules">;
  /** Last day to fill (YYYY-MM-DD); defaults to the day of the newest commit. */
  until?: string;
  /** Ignore existing data and collect everything again. */
  full: boolean;
  log: (message: string) => void;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * A copy of `text` that shares no memory with the string it was cut from. Paths come from
 * splitting git's output for a whole tree; keeping a slice would keep all of that output alive.
 */
function detach(text: string): string {
  return decoder.decode(encoder.encode(text));
}

export function dayFormatter(tz: string): (unixSeconds: number) => string {
  // en-CA formats as YYYY-MM-DD
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return (unixSeconds) => format.format(new Date(unixSeconds * 1000));
}

export async function collect(options: CollectOptions): Promise<void> {
  const { repo, log } = options;
  const toDay = dayFormatter(options.meta.tz);

  // Newest first, so the first commit seen per day is that day's last one.
  const commits = await firstParentCommits(repo, options.meta.ref, options.meta.own);
  if (commits.length === 0) {
    throw new Error(`No commits on ${options.meta.ref}`);
  }

  // The checkout's .gitattributes decide for the whole history, so marking a file as generated
  // now removes it from past days too.
  const attributes = options.meta.linguist ? await attributesFingerprint(repo) : "";
  const linguistRules = options.meta.linguist ? LINGUIST_RULES : 0;
  const meta: Meta = { ...options.meta, linguistRules, attributes };
  const lastCommitOfDay = new Map<string, string>();
  for (const commit of commits) {
    const day = toDay(commit.time);
    if (!lastCommitOfDay.has(day)) {
      lastCommitOfDay.set(day, commit.sha);
    }
  }
  const commitDays = [...lastCommitOfDay.keys()].sort();
  const firstDay = commitDays[0];
  const lastDay = options.until ?? commitDays[commitDays.length - 1];

  // Resume: keep everything before the last stored day, that day may have gained commits since.
  const existing = await readDataset(options.out);
  let days: DayRecord[] = [];
  const hasExcluded = existing.days.every((day) => day.excluded);
  if (!options.full && existing.meta && sameSettings(existing.meta, meta) && hasExcluded) {
    const resumeFrom = existing.days[existing.days.length - 1]?.date;
    days = existing.days.filter((day) => resumeFrom && day.date < resumeFrom);
    if (days.length) {
      log(`Resuming after ${days[days.length - 1].date} (${days.length} days kept)`);
    }
  } else if (existing.meta) {
    log(
      options.full
        ? "Full run requested"
        : hasExcluded
          ? "Settings changed, collecting from scratch"
          : "Data has no excluded counts yet, collecting from scratch",
    );
  }

  const classifier = createClassifier(meta);
  const own = new Set(meta.own);
  const linesByBlob = new Map<string, number | null>();
  // Per dimension: its value for a path, given the path's extension
  const valuesOf = (meta.dimensions ?? [{ name: "ext" }]).map((dimension) => {
    if (!("dirs" in dimension) && !("groups" in dimension)) {
      return (_path: string, ext: string) => ext;
    }
    const pathValue = createPathValue(dimension);
    return (path: string) => pathValue(path);
  });
  // Per path: the key its lines count towards, or null when it is skipped.
  const keyByPath = new Map<string, string | null>();
  // One detached string per key, shared by all paths with that key
  const keys = new Map<string, string>();
  const intern = (values: string[]) => {
    const key = values.join(KEY_SEPARATOR);
    let shared = keys.get(key);
    if (shared === undefined) {
      shared = detach(key);
      keys.set(shared, shared);
    }
    return shared;
  };

  async function classifyNew(paths: string[]): Promise<void> {
    const attrs =
      meta.linguist && attributes
        ? await booleanAttributes(repo, LINGUIST_ATTRIBUTES, paths)
        : undefined;
    for (const path of paths) {
      let ext = own.has(path) ? null : classifier.classify(path);
      if (ext !== null && meta.linguist) {
        const set = attrs?.get(path) ?? {};
        const defaults = linguistDefaults(path);
        const generated = set["linguist-generated"] ?? defaults.generated;
        const vendored = set["linguist-vendored"] ?? defaults.vendored;
        if (generated || vendored) {
          ext = null;
        }
      }
      keyByPath.set(
        detach(path),
        ext === null ? null : intern(valuesOf.map((value) => value(path, ext))),
      );
    }
  }

  async function measure(
    sha: string,
  ): Promise<{ counts: Record<string, number>; excluded: Excluded }> {
    const blobs = await listBlobs(repo, sha, meta.paths);
    await classifyNew(blobs.map((blob) => blob.path).filter((path) => !keyByPath.has(path)));
    // Excluded files are read too, for the excluded count; own files are not
    const read = blobs.filter((blob) => !own.has(blob.path));
    const unknown = new Map<string, number>();
    for (const blob of read) {
      if (!linesByBlob.has(blob.sha)) {
        unknown.set(blob.sha, blob.size);
      }
    }
    await readBlobs(
      repo,
      [...unknown].map(([sha, size]) => ({ sha, size })),
      (blobSha, content) => linesByBlob.set(blobSha, countNonBlankLines(content)),
    );
    const counts: Record<string, number> = {};
    const excluded: Excluded = { files: 0, lines: 0 };
    for (const blob of read) {
      const lines = linesByBlob.get(blob.sha);
      if (!lines) {
        continue; // binary or empty
      }
      const key = keyByPath.get(blob.path);
      if (key) {
        counts[key] = (counts[key] ?? 0) + lines;
      } else {
        excluded.files++;
        excluded.lines += lines;
      }
    }
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    return { counts: Object.fromEntries(sorted), excluded };
  }

  let previous = days[days.length - 1];
  let day = previous ? nextDay(previous.date) : firstDay;
  const started = performance.now();
  let measured = 0;
  while (day <= lastDay) {
    const sha = lastCommitOfDay.get(day);
    if (sha) {
      const { counts, excluded } = await measure(sha);
      const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
      previous = { date: day, commit: sha, carried: false, total, excluded, counts };
      measured++;
      if (measured % 50 === 0) {
        log(`${day}  ${measured} commits measured`);
      }
    } else if (previous) {
      previous = { ...previous, date: day, carried: true };
    }
    if (previous) {
      days.push(previous);
    }
    day = nextDay(day);
  }

  await writeDataset(options.out, { meta, days });
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  log(`Wrote ${days.length} days to ${options.out} (${measured} commits measured in ${seconds}s)`);
  const last = days[days.length - 1];
  if (last?.excluded) {
    log(`${last.date}: ${linesSummary(last.total, last.excluded)}`);
  }
}
