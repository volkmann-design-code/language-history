import { appendFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { compact } from "@language-history/chart";
import { renderFiles } from "@language-history/chart/files";
import { collect } from "@language-history/collect";
import { dimensionNames, linesSummary, project } from "@language-history/format";
import { readDataset } from "@language-history/format/file";
import {
  collectOptions,
  loadSettings,
  mergeSettings,
  renderOptions,
  type Settings,
  validateSettings,
} from "@language-history/options";

type Env = Record<string, string | undefined>;

export interface ActionOutputs {
  /** Lines on the last day. */
  total: number;
  /** Text files left out on the last day, and their lines. */
  excludedFiles: number;
  excludedLines: number;
  /** Last day in the data (YYYY-MM-DD). */
  date: string;
  /** The data or chart files differ from what is committed. */
  changed: boolean;
  /** They were committed and pushed. */
  committed: boolean;
  data: string;
  outputs: string[];
}

const input = (env: Env, name: string) => {
  const value = env[`INPUT_${name.toUpperCase().replace(/-/g, "_")}`]?.trim();
  return value ? value : undefined;
};
const list = (value: string | undefined) =>
  value
    ?.split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

async function git(cwd: string, args: string[], env: Env): Promise<{ code: number; out: string }> {
  const proc = Bun.spawn(["git", ...args], { cwd, env, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0 && code !== 1) {
    throw new Error(`git ${args.join(" ")} failed (${code}): ${err.trim()}`);
  }
  return { code, out: out.trim() };
}

async function gitOk(cwd: string, args: string[], env: Env): Promise<string> {
  const { code, out } = await git(cwd, args, env);
  if (code !== 0) {
    throw new Error(`git ${args.join(" ")} failed`);
  }
  return out;
}

/**
 * Runs the action: settings from the config file with the inputs on top, full history if the
 * checkout is shallow, collect, render, then commit and push the data and chart files.
 */
export async function runAction({ env, cwd }: { env: Env; cwd: string }): Promise<ActionOutputs> {
  const log = (message: string) => console.log(message);
  const at = (path: string) => (isAbsolute(path) ? path : join(cwd, path));

  const fromInputs = validateSettings(
    {
      data: input(env, "data"),
      out: list(input(env, "out")),
      ref: input(env, "ref"),
      tz: input(env, "tz"),
    },
    "inputs",
  );
  const configPath = input(env, "config");
  const settings: Settings = mergeSettings(
    await loadSettings(configPath && at(configPath)),
    fromInputs,
  );

  const collecting = collectOptions(settings, log, cwd);
  const rendering = renderOptions(settings, log);
  const repo = at(collecting.repo);
  const data = at(collecting.out);
  const outputs = rendering.outputs.map(at);

  // Every day's commit has to be there; a default actions/checkout only fetches one
  if ((await gitOk(repo, ["rev-parse", "--is-shallow-repository"], env)) === "true") {
    log("Shallow checkout, fetching the full history (set fetch-depth: 0 to skip this)");
    await gitOk(repo, ["fetch", "--unshallow", "--quiet"], env);
  }

  await collect({ ...collecting, repo, out: data });
  await renderFiles({ ...rendering, input: data, outputs });

  const { meta, days } = await readDataset(data);
  const last = days[days.length - 1];
  // Only files inside the checkout can be committed
  const paths = [data, ...outputs].filter((path) => {
    const rel = relative(cwd, path);
    return !rel.startsWith("..") && !isAbsolute(rel);
  });
  const status = paths.length
    ? await gitOk(cwd, ["status", "--porcelain", "--", ...paths], env)
    : "";
  const result: ActionOutputs = {
    total: last?.total ?? 0,
    excludedFiles: last?.excluded?.files ?? 0,
    excludedLines: last?.excluded?.lines ?? 0,
    date: last?.date ?? "",
    changed: status !== "",
    committed: false,
    data: collecting.out,
    outputs: rendering.outputs,
  };

  if (!result.changed) {
    log("Data and chart are up to date");
  } else if ((input(env, "commit") ?? "true") === "true") {
    result.committed = await commitAndPush({
      cwd,
      env,
      paths,
      message: input(env, "commit-message") ?? "chore: update language history [skip ci]",
      branch: input(env, "branch"),
      log,
    });
  }

  writeOutputs(env, result);
  writeSummary(env, result, last ? project(last.counts, dimensionNames(meta), ["ext"]) : {});
  return result;
}

async function commitAndPush(options: {
  cwd: string;
  env: Env;
  paths: string[];
  message: string;
  branch: string | undefined;
  log: (message: string) => void;
}): Promise<boolean> {
  const { cwd, env, paths, log } = options;
  const branch =
    options.branch ??
    (env.GITHUB_EVENT_NAME?.startsWith("pull_request") ? undefined : env.GITHUB_REF_NAME);
  if (!branch) {
    log(
      "No branch to push to (pull request or no GITHUB_REF_NAME): files are updated, not committed",
    );
    return false;
  }
  // The environment wins over `-c user.name`, so the bot identity goes there
  const bot = {
    ...env,
    GIT_AUTHOR_NAME: "github-actions[bot]",
    GIT_AUTHOR_EMAIL: "41898282+github-actions[bot]@users.noreply.github.com",
    GIT_COMMITTER_NAME: "github-actions[bot]",
    GIT_COMMITTER_EMAIL: "41898282+github-actions[bot]@users.noreply.github.com",
  };
  await gitOk(cwd, ["add", "--", ...paths], env);
  await gitOk(
    cwd,
    ["-c", "commit.gpgsign=false", "commit", "--quiet", "-m", options.message, "--", ...paths],
    bot,
  );
  // Another job may have pushed in the meantime
  await gitOk(
    cwd,
    ["-c", "commit.gpgsign=false", "pull", "--rebase", "--quiet", "origin", branch],
    bot,
  );
  await gitOk(cwd, ["push", "--quiet", "origin", `HEAD:${branch}`], env);
  log(`Committed and pushed to ${branch}`);
  return true;
}

function writeOutputs(env: Env, result: ActionOutputs): void {
  if (!env.GITHUB_OUTPUT) {
    return;
  }
  const lines = [
    `total=${result.total}`,
    `excluded-files=${result.excludedFiles}`,
    `excluded-lines=${result.excludedLines}`,
    `date=${result.date}`,
    `changed=${result.changed}`,
    `committed=${result.committed}`,
    `data=${result.data}`,
    `outputs=${result.outputs.join(",")}`,
  ];
  appendFileSync(env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
}

function writeSummary(env: Env, result: ActionOutputs, byExt: Record<string, number>): void {
  if (!env.GITHUB_STEP_SUMMARY) {
    return;
  }
  const top = Object.entries(byExt)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([ext, lines]) => `| .${ext} | ${compact(lines)} |`);
  const summary = [
    `### language-history: ${linesSummary(result.total, { files: result.excludedFiles, lines: result.excludedLines })} on ${result.date}`,
    "",
    "| Extension | Lines |",
    "|---|---|",
    ...top,
    "",
    result.committed
      ? "Committed the updated data and chart."
      : result.changed
        ? "Data and chart changed, not committed."
        : "Data and chart were up to date.",
    "",
  ];
  appendFileSync(env.GITHUB_STEP_SUMMARY, summary.join("\n"));
}
