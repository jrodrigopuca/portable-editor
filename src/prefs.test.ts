import { describe, expect, it } from "vitest";
import { clampFontSize, FONT_DEFAULT, FONT_MAX, FONT_MIN, parseFontSize } from "./prefs";

describe("parseFontSize", () => {
  it("falls back to the default for null storage", () => {
    expect(parseFontSize(null)).toBe(FONT_DEFAULT);
  });

  it("falls back to the default for garbage", () => {
    expect(parseFontSize("banana")).toBe(FONT_DEFAULT);
  });

  it("falls back to the default for out-of-range values", () => {
    expect(parseFontSize(String(FONT_MAX + 1))).toBe(FONT_DEFAULT);
    expect(parseFontSize(String(FONT_MIN - 1))).toBe(FONT_DEFAULT);
  });

  it("accepts values within range", () => {
    expect(parseFontSize("12")).toBe(12);
  });
});

describe("clampFontSize", () => {
  it("clamps below the minimum", () => {
    expect(clampFontSize(FONT_MIN - 10)).toBe(FONT_MIN);
  });

  it("clamps above the maximum", () => {
    expect(clampFontSize(FONT_MAX + 10)).toBe(FONT_MAX);
  });

  it("keeps values within range untouched", () => {
    expect(clampFontSize(FONT_DEFAULT)).toBe(FONT_DEFAULT);
  });
});
