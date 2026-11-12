import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAction } from "./action";

// Runs the action against throwaway repositories that push to a local bare remote.

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const gitEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

function git(cwd: string, args: string[], date?: string): string {
  const result = Bun.spawnSync(["git", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    env: { ...gitEnv, ...(date && { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }) },
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  }
  return result.stdout.toString().trim();
}

/** A bare remote with two days of history, and a full clone of it. */
function setup() {
  const root = mkdtempSync(join(tmpdir(), "language-history-action-"));
  roots.push(root);
  const remote = join(root, "remote.git");
  const seed = join(root, "seed");
  git(root, ["init", "-q", "--bare", "-b", "main", remote]);
  git(root, ["clone", "-q", remote, seed]);
  writeFileSync(join(seed, "a.ts"), "a\nb\n");
  // Left out by the built-in rules
  writeFileSync(join(seed, "yarn.lock"), "x\ny\nz\n");
  git(seed, ["add", "-A"]);
  git(seed, ["commit", "-q", "-m", "one"], "2026-01-01T12:00:00Z");
  writeFileSync(join(seed, "b.md"), "c\n");
  git(seed, ["add", "-A"]);
  git(seed, ["commit", "-q", "-m", "two"], "2026-01-03T12:00:00Z");
  git(seed, ["push", "-q", "origin", "main"]);
  const work = join(root, "work");
  git(root, ["clone", "-q", remote, work]);
  return { root, remote, work };
}

function actionEnv(
  root: string,
  inputs: Record<string, string>,
  extra: Record<string, string> = {},
) {
  const output = join(root, "github-output");
  const summary = join(root, "github-summary");
  writeFileSync(output, "");
  writeFileSync(summary, "");
  const env: Record<string, string | undefined> = {
    ...gitEnv,
    GITHUB_OUTPUT: output,
    GITHUB_STEP_SUMMARY: summary,
    GITHUB_EVENT_NAME: "schedule",
    GITHUB_REF_NAME: "main",
    INPUT_TZ: "UTC",
    ...extra,
  };
  for (const [name, value] of Object.entries(inputs)) {
    env[`INPUT_${name.toUpperCase().replace(/-/g, "_")}`] = value;
  }
  return {
    env,
    output: () => readFileSync(output, "utf8"),
    summary: () => readFileSync(summary, "utf8"),
  };
}

describe("runAction", () => {
  test("collects, renders, commits and pushes; a second run has nothing to do", async () => {
    const { root, remote, work } = setup();
    const { env, output, summary } = actionEnv(root, {});

    const result = await runAction({ env, cwd: work });

    expect(result).toEqual({
      total: 3,
      excludedFiles: 1,
      excludedLines: 3,
      date: "2026-01-03",
      changed: true,
      committed: true,
      data: "language-history.jsonl",
      outputs: ["language-history.svg"],
    });
    expect(output()).toContain(
      "total=3\nexcluded-files=1\nexcluded-lines=3\ndate=2026-01-03\nchanged=true\ncommitted=true\n",
    );
    expect(summary()).toContain("3 lines · 3 excluded in 1 file on 2026-01-03");
    expect(git(root, ["--git-dir", remote, "log", "-1", "--format=%s %an"])).toBe(
      "chore: update language history [skip ci] github-actions[bot]",
    );
    expect(git(root, ["--git-dir", remote, "ls-tree", "--name-only", "main"]).split("\n")).toEqual([
      "a.ts",
      "b.md",
      "language-history.jsonl",
      "language-history.svg",
      "yarn.lock",
    ]);

    const again = await runAction({ env: actionEnv(root, {}).env, cwd: work });
    expect(again.changed).toBe(false);
    expect(again.committed).toBe(false);
    expect(git(root, ["--git-dir", remote, "rev-list", "--count", "main"])).toBe("3");
  });

  test("rebases onto commits pushed in the meantime", async () => {
    const { root, remote, work } = setup();
    const other = join(root, "other");
    git(root, ["clone", "-q", remote, other]);
    writeFileSync(join(other, "c.txt"), "x\n");
    git(other, ["add", "-A"]);
    git(other, ["commit", "-q", "-m", "meanwhile"]);
    git(other, ["push", "-q", "origin", "main"]);

    const result = await runAction({ env: actionEnv(root, {}).env, cwd: work });

    expect(result.committed).toBe(true);
    expect(git(root, ["--git-dir", remote, "log", "--format=%s", "main"]).split("\n")).toEqual([
      "chore: update language history [skip ci]",
      "meanwhile",
      "two",
      "one",
    ]);
  });

  test("fetches the full history of a shallow checkout", async () => {
    const { root, remote } = setup();
    const shallow = join(root, "shallow");
    git(root, ["clone", "-q", "--depth", "1", `file://${remote}`, shallow]);

    const result = await runAction({ env: actionEnv(root, { commit: "false" }).env, cwd: shallow });

    expect(git(shallow, ["rev-parse", "--is-shallow-repository"])).toBe("false");
    const lines = readFileSync(join(shallow, "language-history.jsonl"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(4); // settings + 3 days
    expect(result.changed).toBe(true);
    expect(result.committed).toBe(false);
  });

  test("never pushes from a pull request", async () => {
    const { root, remote, work } = setup();
    const { env } = actionEnv(
      root,
      {},
      { GITHUB_EVENT_NAME: "pull_request", GITHUB_REF_NAME: "1/merge" },
    );

    const result = await runAction({ env, cwd: work });

    expect(result).toMatchObject({ changed: true, committed: false });
    expect(git(root, ["--git-dir", remote, "rev-list", "--count", "main"])).toBe("2");
  });

  test("inputs override the config file", async () => {
    const { root, work } = setup();
    mkdirSync(join(work, "docs"));
    writeFileSync(
      join(work, "docs/config.json"),
      JSON.stringify({ data: "docs/history.jsonl", out: ["docs/a.svg"], excludeExt: ["md"] }),
    );
    const { env } = actionEnv(root, {
      config: "docs/config.json",
      out: "docs/b.svg, docs/b.png",
      commit: "false",
    });

    const result = await runAction({ env, cwd: work });

    expect(result).toMatchObject({
      total: 2,
      data: "docs/history.jsonl",
      outputs: ["docs/b.svg", "docs/b.png"],
    });
    expect(existsSync(join(work, "docs/b.png"))).toBe(true);
    expect(existsSync(join(work, "docs/a.svg"))).toBe(false);
  });

  test("files outside the checkout are written but not committed", async () => {
    const { root, remote, work } = setup();
    const outside = join(root, "elsewhere.svg");
    const { env } = actionEnv(root, { out: outside });

    const result = await runAction({ env, cwd: work });

    expect(result.committed).toBe(true);
    expect(existsSync(outside)).toBe(true);
    expect(git(root, ["--git-dir", remote, "ls-tree", "--name-only", "main"])).not.toContain(
      "elsewhere.svg",
    );
  });

  test("a bad config fails with its path and key", async () => {
    const { root, work } = setup();
    writeFileSync(join(work, "config.json"), JSON.stringify({ output: "x.svg" }));
    const { env } = actionEnv(root, { config: "config.json" });

    await expect(runAction({ env, cwd: work })).rejects.toThrow('unknown setting "output"');
  });
});
