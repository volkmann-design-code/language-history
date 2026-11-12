import { type Dataset, dimensionNames, KEY_SEPARATOR, project } from "./dataset";

const field = (value: string | number | boolean) => {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

/**
 * One row per day with one column per key of the dimensions `by` (default: all of them), largest
 * first, after the excluded files and lines (empty in data collected before they were measured). A key's column header joins its values with `/`, e.g. `packages/core/ts`.
 */
export function toCsv(dataset: Dataset, by = dimensionNames(dataset.meta)): string {
  const names = dimensionNames(dataset.meta);
  const rows = dataset.days.map((day) => ({ day, counts: project(day.counts, names, by) }));
  const peak = new Map<string, number>();
  for (const { counts } of rows) {
    for (const [key, lines] of Object.entries(counts)) {
      peak.set(key, Math.max(peak.get(key) ?? 0, lines));
    }
  }
  const keys = [...peak].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([k]) => k);
  const lines = [
    [
      "date",
      "commit",
      "carried",
      "total",
      "excludedFiles",
      "excludedLines",
      ...keys.map((key) => key.split(KEY_SEPARATOR).join("/")),
    ]
      .map(field)
      .join(","),
    ...rows.map(({ day, counts }) =>
      [
        day.date,
        day.commit,
        day.carried,
        day.total,
        day.excluded?.files ?? "",
        day.excluded?.lines ?? "",
        ...keys.map((key) => counts[key] ?? 0),
      ]
        .map(field)
        .join(","),
    ),
  ];
  return `${lines.join("\n")}\n`;
}
