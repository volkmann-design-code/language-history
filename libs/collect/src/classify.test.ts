import { describe, expect, test } from "bun:test";
import { createClassifier, DEFAULT_ALIASES, extensionOf, NO_EXTENSION } from "./classify";

describe("extensionOf", () => {
  test("last extension of the basename, lower-cased", () => {
    expect(extensionOf("src/app.component.ts")).toBe("ts");
    expect(extensionOf("docs/README.MD")).toBe("md");
    expect(extensionOf("some.dir/file.Json")).toBe("json");
  });

  test("dotfiles count as their name", () => {
    expect(extensionOf(".gitignore")).toBe("gitignore");
    expect(extensionOf("packages/a/.prettierrc")).toBe("prettierrc");
  });

  test("no dot or a trailing dot means no extension", () => {
    expect(extensionOf("Dockerfile")).toBe(NO_EXTENSION);
    expect(extensionOf("bin/run")).toBe(NO_EXTENSION);
    expect(extensionOf("a.dir/Makefile")).toBe(NO_EXTENSION);
    expect(extensionOf("odd.")).toBe(NO_EXTENSION);
  });

  test("compound extensions win over the last part, the longest first", () => {
    const compound = ["spec.ts", "ng.spec.ts", "d.ts"];
    expect(extensionOf("src/app.spec.ts", compound)).toBe("spec.ts");
    expect(extensionOf("src/App.NG.Spec.ts", compound)).toBe("ng.spec.ts");
    expect(extensionOf("src/app.ts", compound)).toBe("ts");
    expect(extensionOf("src/appspec.ts", compound)).toBe("ts");
    // The whole name is no extension
    expect(extensionOf("spec.ts", compound)).toBe("ts");
    expect(extensionOf(".spec.ts", compound)).toBe("ts");
  });
});

describe("createClassifier", () => {
  const classifier = (options: Partial<Parameters<typeof createClassifier>[0]> = {}) =>
    createClassifier({ aliases: DEFAULT_ALIASES, excludeExt: [], exclude: [], ...options });

  test("applies aliases", () => {
    const { classify } = classifier();
    expect(classify("a.mjs")).toBe("js");
    expect(classify("ci.yaml")).toBe("yml");
    expect(classify("a.tsx")).toBe("tsx");
  });

  test("custom aliases replace the defaults", () => {
    const { classify } = classifier({ aliases: { tsx: "ts" } });
    expect(classify("a.tsx")).toBe("ts");
    expect(classify("a.mjs")).toBe("mjs");
  });

  test("excluded extensions match the raw and the aliased extension, with or without dot", () => {
    expect(classifier({ excludeExt: [".YAML"] }).classify("a.yaml")).toBeNull();
    expect(classifier({ excludeExt: ["yaml"] }).classify("a.yml")).toBe("yml");
    // Excluding the alias target drops everything aliased to it
    expect(classifier({ excludeExt: ["yml"] }).classify("a.yaml")).toBeNull();
    expect(classifier({ excludeExt: ["(none)"] }).classify("Dockerfile")).toBeNull();
  });

  test("compound extensions, with or without dot, can be aliased and excluded", () => {
    expect(classifier({ compoundExt: [".Spec.TS"] }).classify("a.spec.ts")).toBe("spec.ts");
    const { classify } = classifier({
      compoundExt: ["spec.ts", "d.ts"],
      aliases: { "d.ts": "ts" },
    });
    expect(classify("a.d.ts")).toBe("ts");
    expect(classify("a.ts")).toBe("ts");
    expect(
      classifier({ compoundExt: ["spec.ts"], excludeExt: ["spec.ts"] }).classify("a.spec.ts"),
    ).toBeNull();
  });

  test("excluded globs match the full path", () => {
    const { classify } = classifier({ exclude: ["**/generated/**", "docs/*.svg"] });
    expect(classify("packages/x/generated/types.ts")).toBeNull();
    expect(classify("docs/chart.svg")).toBeNull();
    expect(classify("docs/img/chart.svg")).toBe("svg");
    expect(classify("packages/x/src/types.ts")).toBe("ts");
  });

  test("repeated calls return the same result", () => {
    const { classify } = classifier({ exclude: ["*.lock"] });
    expect(classify("yarn.lock")).toBeNull();
    expect(classify("yarn.lock")).toBeNull();
    expect(classify("a.ts")).toBe("ts");
    expect(classify("a.ts")).toBe("ts");
  });
});
