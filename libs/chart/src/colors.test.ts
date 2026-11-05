import { describe, expect, test } from "bun:test";
import { OTHERS } from "./bands";
import { bandColor, contrast, type SchemeColors, withContrast } from "./colors";

const light: SchemeColors = {
  surface: "#fcfcfb",
  series: ["#111111", "#222222"],
  others: "#c3c2b7",
};
const dark: SchemeColors = {
  surface: "#1a1a19",
  series: ["#333333", "#444444"],
  others: "#5a5955",
};

describe("bandColor", () => {
  test("GitHub's language color, by extension", () => {
    expect(bandColor("ts", "light", light)).toBe("#3178c6");
    expect(bandColor("php", "light", light)).toBe("#4f5d95");
    expect(bandColor("md", "light", light)).toBe("#083fa1");
  });

  test("near-black colors are lightened on the dark surface only", () => {
    expect(bandColor("json", "light", light)).toBe("#292929");
    const json = bandColor("json", "dark", dark);
    expect(json).not.toBe("#292929");
    expect(contrast(json, dark.surface)).toBeGreaterThanOrEqual(3);
    // Already visible colors stay GitHub's
    expect(bandColor("ts", "dark", dark)).toBe("#3178c6");
  });

  test("unknown extensions get a stable fallback, whatever else is in the chart", () => {
    const color = bandColor("zzz-unknown", "light", light);
    expect(light.series).toContain(color);
    expect(bandColor("zzz-unknown", "light", light)).toBe(color);
  });

  test("compound extensions get a lighter shade of their last part's color", () => {
    expect(bandColor("spec.ts", "light", light)).toBe("#98bce3");
    expect(bandColor("spec.ts", "dark", dark)).toBe("#98bce3");
    // Following an override of the last part, and overridable themselves
    expect(bandColor("spec.ts", "light", light, { ts: "#000000" })).toBe("#808080");
    expect(bandColor("spec.ts", "light", light, { "spec.ts": "#ff0000" })).toBe("#ff0000");
    expect(contrast(bandColor("min.json", "dark", dark), dark.surface)).toBeGreaterThanOrEqual(3);
  });

  test("overrides win in both schemes, Others included", () => {
    const overrides = { ts: "#ff0000", [OTHERS]: "#00ff00" };
    expect(bandColor("ts", "light", light, overrides)).toBe("#ff0000");
    expect(bandColor("ts", "dark", dark, overrides)).toBe("#ff0000");
    expect(bandColor(OTHERS, "dark", dark, overrides)).toBe("#00ff00");
    expect(bandColor(OTHERS, "dark", dark)).toBe(dark.others);
  });
});

describe("withContrast", () => {
  test("mixes towards white on dark and towards black on light surfaces", () => {
    expect(withContrast("#000000", "#1a1a19", 2)).not.toBe("#000000");
    expect(contrast(withContrast("#ffffff", "#fcfcfb", 1.2), "#fcfcfb")).toBeGreaterThanOrEqual(
      1.2,
    );
    expect(withContrast("#3178c6", "#fcfcfb", 1.2)).toBe("#3178c6");
  });
});
