import { describe, expect, it } from "vitest";
import {
  DETECT_INDENT_SIZE_LIMIT,
  detectIndent,
  INDENT_TYPE,
  indentLabel,
  indentUnitString,
  nextIndentPreset,
} from "./indent";

describe("detectIndent", () => {
  it("detects 2-space indentation", () => {
    const text = "function f() {\n  return 1;\n}\n";
    expect(detectIndent(text)).toEqual({ type: INDENT_TYPE.SPACES, width: 2 });
  });

  it("detects 4-space indentation", () => {
    const text = "def f():\n    return 1\n";
    expect(detectIndent(text)).toEqual({ type: INDENT_TYPE.SPACES, width: 4 });
  });

  it("detects tabs when tab lines outnumber space lines", () => {
    const text = "function f() {\n\treturn 1;\n\tif (true) {\n\t\treturn 2;\n\t}\n}\n";
    expect(detectIndent(text)).toEqual({ type: INDENT_TYPE.TABS, width: 4 });
  });

  it("defaults to 2 spaces for flat text with no indentation", () => {
    expect(detectIndent("hello\nworld\n")).toEqual({ type: INDENT_TYPE.SPACES, width: 2 });
  });

  it("defaults to 2 spaces for empty text", () => {
    expect(detectIndent("")).toEqual({ type: INDENT_TYPE.SPACES, width: 2 });
  });

  it("picks the smallest non-zero indent as the unit width", () => {
    const text = "a\n  b\n    c\n";
    expect(detectIndent(text)).toEqual({ type: INDENT_TYPE.SPACES, width: 2 });
  });

  it("skips the scan and defaults to 2 spaces above DETECT_INDENT_SIZE_LIMIT", () => {
    // Tab-indented and well over the limit — if the scan ran, it would
    // detect tabs, not spaces. Confirms the guard short-circuits first.
    const text = "\t".repeat(DETECT_INDENT_SIZE_LIMIT + 1);
    expect(detectIndent(text)).toEqual({ type: INDENT_TYPE.SPACES, width: 2 });
  });
});

describe("indentUnitString", () => {
  it("returns a tab character for tabs", () => {
    expect(indentUnitString({ type: INDENT_TYPE.TABS, width: 4 })).toBe("\t");
  });

  it("returns N spaces for spaces", () => {
    expect(indentUnitString({ type: INDENT_TYPE.SPACES, width: 4 })).toBe("    ");
  });
});

describe("indentLabel", () => {
  it("labels tabs", () => {
    expect(indentLabel({ type: INDENT_TYPE.TABS, width: 4 })).toBe("Tabs");
  });

  it("labels spaces with their width", () => {
    expect(indentLabel({ type: INDENT_TYPE.SPACES, width: 4 })).toBe("Spaces: 4");
  });
});

describe("nextIndentPreset", () => {
  it("cycles spaces:2 -> spaces:4", () => {
    expect(nextIndentPreset({ type: INDENT_TYPE.SPACES, width: 2 })).toEqual({
      type: INDENT_TYPE.SPACES,
      width: 4,
    });
  });

  it("wraps from tabs back to spaces:2", () => {
    expect(nextIndentPreset({ type: INDENT_TYPE.TABS, width: 4 })).toEqual({
      type: INDENT_TYPE.SPACES,
      width: 2,
    });
  });

  it("falls back to the first preset for an unrecognized current value", () => {
    expect(nextIndentPreset({ type: INDENT_TYPE.SPACES, width: 3 })).toEqual({
      type: INDENT_TYPE.SPACES,
      width: 2,
    });
  });
});
