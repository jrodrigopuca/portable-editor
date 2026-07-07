// Pure recent-files logic: storage-agnostic, fully unit-testable.

export interface RecentEntry {
  path: string;
  line: number;
  col: number;
}

export const RECENT_MAX = 8;

export function isRecentEntry(value: unknown): value is RecentEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<RecentEntry>;
  return (
    typeof entry.path === "string" &&
    typeof entry.line === "number" &&
    typeof entry.col === "number"
  );
}

/** Parses the persisted recent-files list, dropping anything malformed. */
export function parseRecent(raw: string | null): RecentEntry[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isRecentEntry).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

/** Moves (or inserts) the path to the front, preserving its stored cursor. */
export function addRecent(entries: RecentEntry[], path: string): RecentEntry[] {
  const existing = entries.find((entry) => entry.path === path);
  const rest = entries.filter((entry) => entry.path !== path);
  return [existing ?? { path, line: 1, col: 1 }, ...rest].slice(0, RECENT_MAX);
}

export function removeRecent(entries: RecentEntry[], path: string): RecentEntry[] {
  return entries.filter((entry) => entry.path !== path);
}

/** Returns the list with the cursor position updated for the given path. */
export function withCursor(
  entries: RecentEntry[],
  path: string,
  line: number,
  col: number,
): RecentEntry[] {
  return entries.map((entry) => (entry.path === path ? { ...entry, line, col } : entry));
}
