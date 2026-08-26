import { describe, expect, it } from "vitest";
import {
  type DocState,
  docFromFile,
  docFromRecovery,
  ENCODING_UTF8,
  EOL,
  EXTERNAL_CHANGE,
  emptyDoc,
  externalChangeDecision,
  fromDisk,
  nextDirty,
} from "./document";
import { INDENT_TYPE } from "./indent";
import type { DecodedFile } from "./ipc";

const file = (contents: string, overrides: Partial<DecodedFile> = {}): DecodedFile => ({
  contents,
  encoding: "UTF-8",
  eol: EOL.LF,
  mixed_eol: false,
  likely_binary: false,
  ...overrides,
});

const docWith = (overrides: Partial<DocState>): DocState => ({
  ...emptyDoc("/a.txt"),
  ...overrides,
});

describe("emptyDoc", () => {
  it("is a clean, untitled, LF/UTF-8 buffer with no undo baseline", () => {
    const doc = emptyDoc(null);
    expect(doc.path).toBeNull();
    expect(doc.dirty).toBe(false);
    expect(doc.mtime).toBeNull();
    expect(doc.encoding).toBe(ENCODING_UTF8);
    expect(doc.eol).toBe(EOL.LF);
    expect(doc.mixedEol).toBe(false);
    expect(doc.missing).toBe(false);
    expect(doc.savedText).toBeNull();
    expect(doc.cursor).toEqual({ line: 1, col: 1 });
    expect(doc.gen).toBe(0);
  });

  it("keeps a path that doesn't exist on disk yet", () => {
    expect(emptyDoc("/new.md").path).toBe("/new.md");
  });

  it("returns a fresh object every time", () => {
    expect(emptyDoc(null)).not.toBe(emptyDoc(null));
  });
});

describe("docFromFile", () => {
  it("takes encoding, eol and mixed flag from the decoded file", () => {
    const doc = docFromFile(
      "/a.txt",
      file("x\r\ny", { encoding: "Windows-1252", eol: EOL.CRLF, mixed_eol: true }),
      "x\r\ny",
    );
    expect(doc.path).toBe("/a.txt");
    expect(doc.encoding).toBe("Windows-1252");
    expect(doc.eol).toBe(EOL.CRLF);
    expect(doc.mixedEol).toBe(true);
    expect(doc.missing).toBe(false);
    expect(doc.mtime).toBeNull();
  });

  it("is clean when the buffer matches the disk", () => {
    const doc = docFromFile("/a.txt", file("hello"), "hello");
    expect(doc.dirty).toBe(false);
    expect(doc.savedText).toBe("hello");
  });

  it("is dirty when a recovered buffer differs from the disk, keeping the disk as undo baseline", () => {
    const doc = docFromFile("/a.txt", file("hello"), "hello world");
    expect(doc.dirty).toBe(true);
    expect(doc.savedText).toBe("hello");
  });

  it("detects indentation from what goes into the buffer, not from the disk copy", () => {
    const doc = docFromFile("/a.txt", file("a\n  b\n"), "a\n\tb\n");
    expect(doc.indent.type).toBe(INDENT_TYPE.TABS);
  });
});

describe("fromDisk", () => {
  it("only carries the disk-derived fields (identity and mtime stay with the caller)", () => {
    expect(Object.keys(fromDisk(file("x"), "x")).sort()).toEqual(
      ["dirty", "encoding", "eol", "indent", "mixedEol", "savedText"].sort(),
    );
  });
});

describe("docFromRecovery", () => {
  it("is clean and has no undo baseline when nothing was recovered", () => {
    const doc = docFromRecovery("/new.md", "");
    expect(doc.path).toBe("/new.md");
    expect(doc.dirty).toBe(false);
    expect(doc.savedText).toBeNull();
  });

  it("is dirty when a recovery snapshot was accepted (disk is empty)", () => {
    const doc = docFromRecovery("/new.md", "draft");
    expect(doc.dirty).toBe(true);
    expect(doc.savedText).toBeNull();
    expect(doc.indent).toEqual(docFromFile("/x", file("draft"), "draft").indent);
  });
});

describe("nextDirty", () => {
  it("a regular edit always dirties, even if the text equals the saved baseline", () => {
    expect(nextDirty(docWith({ savedText: "abc" }), "abc", false)).toBe(true);
    expect(nextDirty(docWith({ savedText: "abc", dirty: true }), "abcd", false)).toBe(true);
  });

  it("an undo landing exactly on the saved baseline clears dirty", () => {
    expect(nextDirty(docWith({ savedText: "abc", dirty: true }), "abc", true)).toBe(false);
  });

  it("an undo landing elsewhere stays dirty", () => {
    expect(nextDirty(docWith({ savedText: "abc", dirty: false }), "ab", true)).toBe(true);
  });

  it("never clears when there's no baseline (untitled / not yet on disk)", () => {
    expect(nextDirty(docWith({ savedText: null, dirty: true }), "", true)).toBe(true);
  });
});

describe("externalChangeDecision", () => {
  it("noop when the mtime hasn't moved", () => {
    expect(externalChangeDecision(100, docWith({ mtime: 100 }))).toBe(EXTERNAL_CHANGE.NOOP);
  });

  it("reload when the disk changed and the buffer is clean", () => {
    expect(externalChangeDecision(200, docWith({ mtime: 100, dirty: false }))).toBe(
      EXTERNAL_CHANGE.RELOAD,
    );
  });

  it("ask when the disk changed and the buffer has unsaved edits", () => {
    expect(externalChangeDecision(200, docWith({ mtime: 100, dirty: true }))).toBe(
      EXTERNAL_CHANGE.ASK,
    );
  });

  it("missing the first time the stat fails", () => {
    expect(externalChangeDecision(null, docWith({ mtime: 100, missing: false }))).toBe(
      EXTERNAL_CHANGE.MISSING,
    );
  });

  it("noop while the file stays missing (flag it once, no nagging)", () => {
    expect(externalChangeDecision(null, docWith({ mtime: 100, missing: true }))).toBe(
      EXTERNAL_CHANGE.NOOP,
    );
  });

  it("a missing file that reappears is judged by its mtime like any other poll", () => {
    expect(externalChangeDecision(100, docWith({ mtime: 100, missing: true }))).toBe(
      EXTERNAL_CHANGE.NOOP,
    );
    expect(externalChangeDecision(300, docWith({ mtime: 100, missing: true, dirty: false }))).toBe(
      EXTERNAL_CHANGE.RELOAD,
    );
    expect(externalChangeDecision(300, docWith({ mtime: 100, missing: true, dirty: true }))).toBe(
      EXTERNAL_CHANGE.ASK,
    );
  });
});
