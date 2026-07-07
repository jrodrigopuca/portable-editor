// Pure view-preference helpers: storage-agnostic, fully unit-testable.

export const FONT_DEFAULT = 14;
export const FONT_MIN = 9;
export const FONT_MAX = 28;

export function clampFontSize(size: number): number {
  return Math.min(FONT_MAX, Math.max(FONT_MIN, size));
}

/** Parses a persisted font size, falling back to the default on garbage. */
export function parseFontSize(raw: string | null): number {
  const value = Number(raw);
  return Number.isFinite(value) && value >= FONT_MIN && value <= FONT_MAX ? value : FONT_DEFAULT;
}
