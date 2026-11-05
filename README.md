# language-history

**GitHub's language bar over time, in your README.**

A stacked chart of the lines of code in a repository per file extension, one column per day, kept
up to date by a scheduled job and embedded as an SVG that follows the viewer's light/dark mode.

- **Leaves out generated and vendored files, like GitHub:** lock files, minified files,
  dependency folders and anything marked `linguist-generated` or `linguist-vendored` in
  `.gitattributes`. One lock file can otherwise outweigh years of hand-written code. See
  [Counting](#counting) for how this differs from GitHub's language bar.
- **One value per calendar day:** the last commit of each day on the branch's first-parent
  history, in a time zone you choose. Days without commits carry the previous value over.
- **Split by package or folder, too:** besides extensions, lines can be grouped by directory
  (`packages/*`) or by named globs (tests vs. code). One collect, a chart per split, see
  [Dimensions](#dimensions).
- **Data first:** `collect` writes plain JSONL, `render` turns it into SVG or PNG, `export` into
  CSV. Use any of them.
- **Fast and incremental:** reads git objects directly, caches counts per blob, and only measures
  new days. Angular's twelve years take under 3 minutes once, a daily update under a second
  (see [Benchmarks](#benchmarks)).

## Examples

<!-- examples:start -->

Each repository is collected once, with its config file; every chart renders that data with its own `by`. The settings are below each chart.

### [getkirby/kirby](https://github.com/getkirby/kirby)

![getkirby/kirby: per extension](examples/kirby.svg)<br>
<sub><b>Per extension</b> · `{ "exclude": ["cacert.pem"] }`</sub>

![getkirby/kirby: tests vs. code](examples/kirby-kind.svg)<br>
<sub><b>Tests vs. code</b> · `{ "exclude": ["cacert.pem"], "dimensions": { "kind": { "groups": { "tests": ["tests/**", "**/*.test.js", "**/*.spec.js"], "code": "**" } } }, "by": "kind" }`</sub>

### [angular/angular](https://github.com/angular/angular)

![angular/angular: per extension](examples/angular.svg)<br>
<sub><b>Per extension</b> · `{ "excludeExt": ["dic"] }`</sub>

![angular/angular: per package](examples/angular-package.svg)<br>
<sub><b>Per package</b> · `{ "excludeExt": ["dic"], "dimensions": { "package": { "dirs": "packages/*" } }, "by": "package" }`</sub>

### Benchmarks

| Repository | Commits | First-parent | Days | Measured | Lines today | Data file | Full collect | Daily update | Render | Peak memory |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| getkirby/kirby | 15,214 | 1,654 | 2,844 | 328 | 340,283 | 55 KB | 11 s | 0.2 s | 0.1 s | 153 MB |
| angular/angular | 39,236 | 38,250 | 4,432 | 3,093 | 1,666,671 | 951 KB | 2 min 37 s | 0.9 s | 0.1 s | 449 MB |

Measured on 2026-11-05 with an Apple M4 Pro (48 GB), Bun 1.4.2 and git 2.50.1 (Apple Git-155), time zone UTC. *First-parent* commits are the ones on the default branch itself: a merged pull request counts once, however many commits it had. *Measured* are the days with at least one of them. The data file is collected with the dimensions of the config (format version 2). *Daily update* is a second collect right after the full one: it measures the last stored day again, like a scheduled run. Peak memory is the Bun process, without the git processes it starts. Regenerate with `bun run examples`.

<!-- examples:end -->

## GitHub Action

```yaml
name: language-history
on:
  schedule:
    - cron: "0 3 * * *"
  workflow_dispatch:

permissions:
  contents: write # to commit the data and the chart

jobs:
  chart:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0 # every day's commit has to be readable
      - uses: volkmann-design-code/language-history@v1
        with:
          tz: Europe/Berlin
          data: docs/language-history.jsonl
          out: docs/language-history.svg
```

Then embed the chart in your README:

```markdown
![Lines of code over time](docs/language-history.svg)
```

Each run measures the days since the last run, renders the chart and, when anything changed,
commits both files (`chore: update language history [skip ci]`) to the branch the workflow runs
on. The first run measures the whole history. A shallow checkout works too, the action fetches
the rest, but `fetch-depth: 0` is faster.

| Input | Default | |
|---|---|---|
| `config` | | JSON config file with any setting (see [Configuration](#configuration)); the inputs below override it |
| `data` | `language-history.jsonl` | JSONL data file, committed so the next run is incremental |
| `out` | `language-history.svg` | Chart files (`.svg` or `.png`), comma- or newline-separated |
| `ref` | the checked-out `HEAD` | Branch or ref whose first-parent history is measured |
| `tz` | the runner's (UTC on GitHub-hosted runners) | IANA time zone that defines a day |
| `commit` | `true` | Commit and push the data and chart files when they changed |
| `commit-message` | `chore: update language history [skip ci]` | |
| `branch` | the branch the workflow runs on | Branch to push to; pull requests are never pushed |

Outputs: `total` (lines on the last day), `date` (last day), `changed`, `committed`, `data`,
`outputs`. The job summary lists the largest extensions.

## CLI

Until the package is published, run it from a checkout with [Bun](https://bun.sh):

```bash
bun install
# 1. data: one JSONL line per day (incremental)
bun language-history collect --repo ../my-repo --ref main --data my-repo.jsonl
# 2. chart: SVG and/or PNG
bun language-history render --data my-repo.jsonl -o my-repo.svg -o my-repo.png
# 3. or a table: one row per day, one column per extension
bun language-history export --data my-repo.jsonl -o my-repo.csv
```

`bun language-history --help` lists every option.

## Configuration

Every option can live in a JSON config file (`-c` for the CLI, `config` for the action); flags
and inputs win over it. Unknown keys are an error.

| Key | Default | |
|---|---|---|
| `data` | `language-history.jsonl` | JSONL data file |
| `repo` | `.` | Repository root |
| `ref` | `HEAD` | Branch or ref whose first-parent history is measured |
| `tz` | the machine's | IANA time zone that defines a day |
| `paths` | all | Only count these paths (git pathspecs) |
| `linguist` | `true` | Skip generated and vendored files: built-in rules and `.gitattributes` (see [Counting](#counting)) |
| `exclude` | | Globs to skip, e.g. `**/generated/**` |
| `excludeExt` | | Extensions to skip, e.g. `["svg", "json"]` |
| `compoundExt` | | Extensions of more than one part to count on their own, e.g. `["spec.ts"]` (see [Counting](#counting)) |
| `aliases` | see [Counting](#counting) | Count one extension as another, e.g. `{ "tsx": "ts" }` |
| `defaultAliases` | `true` | Keep the built-in aliases |
| `dimensions` | | Splits besides the extension, by name; see [Dimensions](#dimensions) |
| `until` | day of the newest commit | Fill days up to `YYYY-MM-DD` or `today` |
| `full` | `false` | Ignore existing data, collect everything again |
| `out` | `["language-history.svg"]` | Chart files, `.svg` or `.png` |
| `by` | `ext` | What the bands stand for: `ext` or the name of a dimension (CLI: `--by`) |
| `threshold` | `0.03` | Own band once an extension's peak reaches this share of the peak total |
| `maxBands` | `8` | Most named bands before the rest folds into "Others" (at most 8) |
| `othersListed` | `3` | Extensions named in the "Others" legend entry |
| `width`, `height` | `1200`, `460` | Chart size in pixels |
| `theme` | `auto` | `auto` (follows light/dark), `light` or `dark`; PNG uses light for `auto` |
| `title` | `Lines of code` | |
| `tooltips` | `true` | Per-day hover tooltips |
| `colors` | GitHub's | Band colors by extension (or dimension value) or `Others`, e.g. `{ "ts": "#3178c6", "Others": "#999" }` (CLI: `--color ts=#3178c6`) |
| `from`, `to` | | Limit the rendered range |

For example:

```json
{
  "ref": "main",
  "tz": "Europe/Berlin",
  "data": "docs/language-history.jsonl",
  "out": ["docs/language-history.svg"],
  "tooltips": false
}
```

## Dimensions

Lines are always counted per extension. `dimensions` adds more splits, each by name (see the
[examples](#examples) for charts made this way):

```json
{
  "dimensions": {
    "package": { "dirs": ["packages/*", "apps/*"] },
    "kind": { "groups": { "tests": ["tests/**", "**/*.test.ts"], "code": "**" } }
  }
}
```

- `dirs`: one value per directory matching a pattern, named by its path (`packages/core`). A file
  belongs to the first pattern whose directory it is in.
- `groups`: named groups of globs; a file belongs to the first group with a matching glob.
- Files no pattern or group matches count as `(rest)`.
- Every combination is counted (here package × kind × extension), so a chart can show any one of
  them without collecting again: `"by": "package"` sums up over kinds and extensions. Each chart
  is a separate `render` with its own `by` and `out`.
- Changing `dimensions` collects from scratch. Values other than extensions get the palette's
  colors in the order of their names, so they keep their color when their size changes.

## Data

```jsonl
{"meta":{"tool":"language-history","version":1,"ref":"main","tz":"Europe/Berlin","paths":[],"exclude":[],"excludeExt":[],"aliases":{"yaml":"yml"},"linguist":true,"linguistRules":1,"own":["language-history.jsonl","language-history.svg"],"attributes":".gitattributes:1234"}}
{"date":"2026-01-04","commit":"3f2a…","carried":false,"total":5210,"byExt":{"ts":4100,"md":1110}}
{"date":"2026-01-05","commit":"3f2a…","carried":true,"total":5210,"byExt":{"ts":4100,"md":1110}}
```

- The first line holds the settings. If they or the `.gitattributes` files change, the next
  `collect` starts from scratch; `--full` forces that.
- Days without a commit carry the previous values over (`carried: true`).
- `byExt` holds every extension after aliases. Grouping into "Others" happens at render time, so
  the chart can change without collecting again.

With [dimensions](#dimensions), the file uses format version 2, which only stores what changed:

```jsonl
{"meta":{"tool":"language-history","version":2,…,"dimensions":[{"name":"package","dirs":["packages/*"]},{"name":"ext"}],…}}
{"date":"2026-01-04","commit":"3f2a…","total":5210,"set":[["packages/app","ts",4100],["(rest)","md",1110]]}
{"date":"2026-01-07","commit":"9c1e…","total":5260,"set":[["packages/app","ts",4150]]}
{"date":"2026-01-09","carried":true}
```

- One line per day with a commit, holding the counts that changed since the previous line: the
  value of each dimension in order, then the lines. `0` means the combination is gone.
- Days in between carry the values over; a last `carried` line marks the end when `until` fills
  days after the last commit.
- A full table per day is a replay away: `parseDataset` in `@language-history/format` does it,
  `language-history export` writes it as CSV (`--by package` sums up to one dimension).
- Kirby split by top-level folder, kind and extension: 72 KB, against 1 MB for version 1 split by
  extension only. Files without dimensions stay version 1.

## Counting

- Non-blank lines per file. Binary files (a NUL byte in the first 8000 bytes, like git) count 0.
- Read straight from git objects (`ls-tree` + `cat-file --batch`), no checkout.
- A day is the committer date in `--tz`, by default the machine's time zone (UTC on GitHub
  runners).
- Generated and vendored files are skipped (`--no-linguist` counts them):
  - by built-in path rules modelled on [GitHub Linguist](https://github.com/github-linguist/linguist)'s:
    lock files (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `Cargo.lock`, `go.sum`, …),
    minified files and source maps, protobuf and GraphQL codegen output, and dependency or build
    folders (`node_modules/`, `vendor/`, `third_party/`, `dist/`, `.yarn/releases/`, Gradle and
    Maven wrappers, …). The full list is in
    [`libs/collect/src/linguist.ts`](libs/collect/src/linguist.ts).
  - by `linguist-generated` / `linguist-vendored` in `.gitattributes`, which also wins over the
    built-in rules in the other direction: `vendor/** -linguist-vendored` counts a folder again.
  - The checkout's `.gitattributes` apply to every day, so marking a file today removes it from
    the whole history.
- The tool's own files (the data file and the charts) are never counted, and a commit that only
  changes them is not a commit day, so updating the chart doesn't change the chart.
- Nothing else is excluded by default. Scope with `--path` (git pathspecs), skip with `--exclude`
  (globs) and `--exclude-ext`.
- How this differs from GitHub's language bar: GitHub measures bytes per language, counts only
  programming and markup languages (no JSON, YAML or Markdown), also leaves out documentation
  (`docs/`, …) and recognizes generated files by their content. language-history counts
  non-blank lines per file extension, of every text file, and only looks at paths.
- Extension = text after the last dot, lower-cased; dotfiles count as their name (`.gitignore` →
  `gitignore`), files without one as `(none)`. `compoundExt` adds extensions of more than one
  part: with `["spec.ts"]`, tests in `app.spec.ts` count as `spec.ts`, apart from the code in
  `app.ts`; the longest one a name ends with wins. Default aliases (`mjs`/`cjs` → `js`, `mts`/`cts` →
  `ts`, `yaml` → `yml`, …) can be extended (`--alias tsx=ts`), undone one by one
  (`--alias yaml=yaml`) or dropped (`--no-default-aliases`).

## Chart

- An extension gets its own band once its peak reaches `--threshold` (3 %) of the peak total; at
  most 8 named bands (one per palette hue), the rest is "Others". Its legend entry says how many
  extensions it holds and names the largest (`--others-listed`, default 3).
- Bands are ordered by their size on the last day, largest at the bottom.
- `by` picks what the bands stand for: extensions (default) or a [dimension](#dimensions).
- Each extension keeps its color in every chart, whatever its rank: the color GitHub's language
  bar uses for it (from [Linguist](https://github.com/github-linguist/linguist), regenerated with
  `bun run linguist-colors`). Extensions without one get a fixed color picked by their name. In
  dark mode, colors too dark to see on the background (JSON, Lua, Markdown, …) are lightened.
  A compound extension (`spec.ts`) gets a lighter shade of its last part's color.
  `colors` overrides any of them, `Others` included, in both themes.
- `--theme auto` (default) follows the viewer's light/dark setting through a media query inside
  the SVG, which also works when the SVG is embedded in a GitHub README. PNG gets one concrete
  theme.
- Per-day hover tooltips only work when the SVG is opened directly, not when it is embedded with
  `<img>`; turn them off there (`"tooltips": false`) for a much smaller file.

## Repository layout

An Nx monorepo on Bun workspaces. Libraries are imported by name (`@language-history/*`) through
`tsconfig.json` paths.

| Project | Path | What it is | Runs in |
|---|---|---|---|
| `@language-history/format` | `libs/format` | The JSONL data format: types, parse, serialize (`./file`: read/write files) | browser, Bun |
| `@language-history/collect` | `libs/collect` | Walks a git history and measures each day | Bun + git |
| `@language-history/chart` | `libs/chart` | Bands and the SVG chart (`./png`: rasterize, `./files`: render files) | browser, Bun |
| `@language-history/options` | `libs/options` | Settings: config file, overrides, defaults | Bun |
| `@language-history/cli` | `apps/cli` | The `language-history` command | Bun |
| `@language-history/action` | `apps/action` | The GitHub Action, run by the root `action.yml` | Bun + git |
| `@language-history/examples` | `apps/examples` | Regenerates the charts in `examples/` and the benchmarks (`bun run examples`) | Bun + git |

Entry points listed under `browserSafe` in a package's `package.json` must not import Node, Bun or
another package's non-browser entry point, so a web app can use them.

```bash
bun install            # also installs the lefthook git hooks
bun run check          # biome
bun run typecheck      # nx run-many -t typecheck
bun run test           # nx run-many -t test:unit
```

## Versions

`@v1` follows the newest 1.x release; pin `@v1.0.0` or a commit for an exact version. Within v1,
the action's inputs and outputs, the config keys, the CLI flags and the JSONL format only change
in compatible ways. A new release of the built-in rules for generated and vendored files can
change what is counted; the next run then collects from scratch. Releases and their notes:
[GitHub releases](https://github.com/volkmann-design-code/language-history/releases).

## Roadmap

- npm package with a bundled CLI (`bunx language-history`).
- Two dimensions in one chart (small multiples: one chart per package, colored by extension), and
  several charts from one config.
- Dimensions from line history: the year a line was written, its author (`git blame`).
- Web app: render any published JSONL, compare repositories.

## Prior art

- [git-of-theseus](https://github.com/erikbern/git-of-theseus): lines per extension and cohorts
  over time, matplotlib plots.
- [scc](https://github.com/boyter/scc) `--timeline`: languages over a commit window, HTML report.
- [git-loc](https://github.com/banteg/git-loc): per-language lines along first-parent history, CSV
  and line chart.
- [git strata](https://github.com/vdavid/gitstrata): in-browser analysis of public repos, stacked
  by language, interactive.
- [loc-graph-action](https://github.com/botforge-pro/loc-graph-action) and
  [lines-of-code-history](https://github.com/PaulGoldschmidt/lines-of-code-history): total lines
  over time as a README chart.
