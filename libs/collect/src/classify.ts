export const NO_EXTENSION = "(none)";

export const DEFAULT_ALIASES: Record<string, string> = {
  cjs: "js",
  mjs: "js",
  cts: "ts",
  mts: "ts",
  yaml: "yml",
  htm: "html",
  markdown: "md",
  jsonc: "json",
  jpeg: "jpg",
};

export interface ClassifyOptions {
  /** Extensions of more than one part (`spec.ts`), counted on their own. */
  compoundExt?: string[];
  aliases: Record<string, string>;
  excludeExt: string[];
  exclude: string[];
}

export interface Classifier {
  /** The (aliased) extension a path counts towards, or `null` when it is excluded. */
  classify(path: string): string | null;
}

/**
 * Lower-cased extension; dotfiles count as their name (`.gitignore` -> `gitignore`). The longest of
 * `compound` the name ends with wins over the last part (`a.spec.ts` -> `spec.ts`).
 */
export function extensionOf(path: string, compound: string[] = []): string {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const longest = compound
    .filter((ext) => name.length > ext.length + 1 && name.endsWith(`.${ext}`))
    .sort((a, b) => b.length - a.length)[0];
  if (longest) {
    return longest;
  }
  const dot = name.lastIndexOf(".");
  if (dot === 0) {
    return name.slice(1);
  }
  if (dot < 0 || dot === name.length - 1) {
    return NO_EXTENSION;
  }
  return name.slice(dot + 1);
}

export function createClassifier(options: ClassifyOptions): Classifier {
  const excludedExt = new Set(options.excludeExt.map(normalizeExt));
  const globs = options.exclude.map((pattern) => new Bun.Glob(pattern));
  const compound = (options.compoundExt ?? []).map(normalizeExt);
  return {
    classify(path) {
      const raw = extensionOf(path, compound);
      const ext = options.aliases[raw] ?? raw;
      const excluded =
        excludedExt.has(raw) || excludedExt.has(ext) || globs.some((glob) => glob.match(path));
      return excluded ? null : ext;
    },
  };
}

/** `.Spec.TS` -> `spec.ts` */
function normalizeExt(ext: string): string {
  return ext.replace(/^\./, "").toLowerCase();
}
