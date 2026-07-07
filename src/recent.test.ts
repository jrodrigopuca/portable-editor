import { describe, expect, it } from "vitest";
import {
  addRecent,
  parseRecent,
  RECENT_MAX,
  type RecentEntry,
  removeRecent,
  withCursor,
} from "./recent";

const entry = (path: string, line = 1, col = 1): RecentEntry => ({ path, line, col });

describe("parseRecent", () => {
  it("returns empty list for null storage", () => {
    expect(parseRecent(null)).toEqual([]);
  });

  it("returns empty list for invalid JSON", () => {
    expect(parseRecent("{oops")).toEqual([]);
  });

  it("returns empty list when the JSON is not an array", () => {
    expect(parseRecent('{"path":"/a"}')).toEqual([]);
  });

  it("drops malformed entries and keeps valid ones", () => {
    const raw = JSON.stringify([
      entry("/a.txt", 3, 7),
      { path: "/no-cursor.txt" },
      { line: 1, col: 1 },
      "garbage",
      null,
    ]);
    expect(parseRecent(raw)).toEqual([entry("/a.txt", 3, 7)]);
  });

  it("caps the list at RECENT_MAX", () => {
    const raw = JSON.stringify(
      Array.from({ length: RECENT_MAX + 5 }, (_, i) => entry(`/f${i}.txt`)),
    );
    expect(parseRecent(raw)).toHaveLength(RECENT_MAX);
  });
});

describe("addRecent", () => {
  it("inserts a new path at the front with a default cursor", () => {
    const result = addRecent([entry("/old.txt", 5, 2)], "/new.txt");
    expect(result[0]).toEqual(entry("/new.txt", 1, 1));
    expect(result).toHaveLength(2);
  });

  it("moves an existing path to the front preserving its cursor", () => {
    const result = addRecent([entry("/a.txt", 5, 2), entry("/b.txt", 9, 4)], "/b.txt");
    expect(result).toEqual([entry("/b.txt", 9, 4), entry("/a.txt", 5, 2)]);
  });

  it("caps the list at RECENT_MAX, evicting the oldest", () => {
    const full = Array.from({ length: RECENT_MAX }, (_, i) => entry(`/f${i}.txt`));
    const result = addRecent(full, "/new.txt");
    expect(result).toHaveLength(RECENT_MAX);
    expect(result[0]?.path).toBe("/new.txt");
    expect(result.some((e) => e.path === `/f${RECENT_MAX - 1}.txt`)).toBe(false);
  });
});

describe("removeRecent", () => {
  it("removes only the matching path", () => {
    const result = removeRecent([entry("/a.txt"), entry("/b.txt")], "/a.txt");
    expect(result).toEqual([entry("/b.txt")]);
  });

  it("is a no-op for unknown paths", () => {
    const list = [entry("/a.txt")];
    expect(removeRecent(list, "/nope.txt")).toEqual(list);
  });
});

describe("withCursor", () => {
  it("updates the cursor only for the matching path", () => {
    const result = withCursor([entry("/a.txt"), entry("/b.txt")], "/a.txt", 42, 7);
    expect(result).toEqual([entry("/a.txt", 42, 7), entry("/b.txt")]);
  });

  it("does not mutate the original entries", () => {
    const original = [entry("/a.txt")];
    withCursor(original, "/a.txt", 42, 7);
    expect(original[0]).toEqual(entry("/a.txt", 1, 1));
  });
});
