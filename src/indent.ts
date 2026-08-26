export const INDENT_TYPE = { TABS: "tabs", SPACES: "spaces" } as const;
export type IndentType = (typeof INDENT_TYPE)[keyof typeof INDENT_TYPE];

export interface IndentInfo {
  type: IndentType;
  width: number;
}

const DEFAULT_SPACES: IndentInfo = { type: INDENT_TYPE.SPACES, width: 2 };
const DEFAULT_TABS_WIDTH = 4;

// Above this, skip the scan below entirely and assume the default — same
// threshold and reasoning as HIGHLIGHT_SIZE_LIMIT in main.ts: a full-text
// `split("\n")` over a huge document would cost real time on every open, and
// a wrong guess here just means clicking the indent button once. Declared
// independently rather than imported from main.ts: this is a performance
// bound on this specific scan, not the app's highlighting policy — they
// happen to agree today, but there's no reason they must stay coupled.
export const DETECT_INDENT_SIZE_LIMIT = 10 * 1024 * 1024;

/**
 * Heuristic, not a perfect detector: counts lines starting with a tab vs a
 * space, and for space-indented files guesses the unit width as the
 * smallest non-zero leading-space count found (the first indent level is
 * the most reliable signal — deeper levels are just multiples of it, but
 * noisy alignment/continuation lines can shrink that minimum, so this is a
 * best-effort guess, same spirit as the encoding fallback in text_io.rs).
 */
export function detectIndent(text: string): IndentInfo {
  if (text.length > DETECT_INDENT_SIZE_LIMIT) return DEFAULT_SPACES;

  let tabLines = 0;
  let spaceLines = 0;
  let minSpaceIndent = Number.POSITIVE_INFINITY;

  for (const line of text.split("\n")) {
    if (line.startsWith("\t")) {
      tabLines++;
      continue;
    }
    const leading = line.length - line.trimStart().length;
    if (leading > 0 && line[0] === " ") {
      spaceLines++;
      if (leading < minSpaceIndent) minSpaceIndent = leading;
    }
  }

  if (tabLines > spaceLines) {
    return { type: INDENT_TYPE.TABS, width: DEFAULT_TABS_WIDTH };
  }
  if (spaceLines === 0) {
    return DEFAULT_SPACES;
  }
  return { type: INDENT_TYPE.SPACES, width: minSpaceIndent };
}

export function indentUnitString(info: IndentInfo): string {
  return info.type === INDENT_TYPE.TABS ? "\t" : " ".repeat(info.width);
}

export function indentLabel(info: IndentInfo): string {
  return info.type === INDENT_TYPE.TABS ? "Tabs" : `Spaces: ${info.width}`;
}

export const INDENT_PRESETS: readonly IndentInfo[] = [
  { type: INDENT_TYPE.SPACES, width: 2 },
  { type: INDENT_TYPE.SPACES, width: 4 },
  { type: INDENT_TYPE.SPACES, width: 8 },
  { type: INDENT_TYPE.TABS, width: DEFAULT_TABS_WIDTH },
];

/** Cycles through INDENT_PRESETS; falls back to the first preset if `current` isn't one of them. */
export function nextIndentPreset(current: IndentInfo): IndentInfo {
  const index = INDENT_PRESETS.findIndex(
    (preset) => preset.type === current.type && preset.width === current.width,
  );
  return INDENT_PRESETS[(index + 1) % INDENT_PRESETS.length] ?? INDENT_PRESETS[0];
}
