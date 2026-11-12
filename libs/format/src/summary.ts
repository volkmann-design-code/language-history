import type { Excluded } from "./dataset";

const full = (n: number) => n.toLocaleString("en-US");

/** `152,300 lines · 8,410 excluded in 37 files`; the excluded part only when there is one. */
export function linesSummary(total: number, excluded?: Excluded): string {
  const lines = `${full(total)} lines`;
  if (!excluded?.files) {
    return lines;
  }
  const files = excluded.files === 1 ? "1 file" : `${full(excluded.files)} files`;
  return `${lines} · ${full(excluded.lines)} excluded in ${files}`;
}
