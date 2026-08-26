// Pure document state: what the editor knows about the ONE file it holds.
// No DOM, no Tauri, no CodeMirror — main.ts owns the mutable `doc` and
// patches it from the helpers here, which makes every "become another
// document" transition a single, testable expression instead of five sites
// resetting 5-8 fields by hand in different orders.

import { detectIndent, type IndentInfo } from "./indent";

export const EOL = { LF: "LF", CRLF: "CRLF" } as const;
export type Eol = (typeof EOL)[keyof typeof EOL];

export const ENCODING_UTF8 = "UTF-8";

/**
 * What the disk says about a file, as returned by the `read_file` command
 * (see `src-tauri/src/text_io.rs`). Lives here, not in ipc.ts, because it's
 * document knowledge that ipc.ts merely transports — the pure module must
 * not depend on the IPC one.
 */
export interface DecodedFile {
  contents: string;
  encoding: string;
  eol: Eol;
  mixed_eol: boolean;
  likely_binary: boolean;
  /** Mtime (ms) stat'ed BEFORE the read, so a change landing mid-read is detected by the next poll rather than swallowed. */
  mtime: number;
}

export interface CursorPos {
  line: number;
  col: number;
}

export interface DocState {
  path: string | null;
  dirty: boolean;
  mtime: number | null;
  encoding: string;
  eol: Eol;
  /** True when the file mixed LF and CRLF lines — `eol` is the majority, not the whole story. */
  mixedEol: boolean;
  /** True once a poll finds `path` gone (deleted or renamed elsewhere). */
  missing: boolean;
  indent: IndentInfo;
  /**
   * Content as of the last save/load — the baseline an undo/redo is compared
   * against so the dirty flag can clear itself on landing back on it, instead
   * of lying "unsaved" forever after. null when there's no disk state to
   * return to (untitled, or a path that doesn't exist yet): undoing to empty
   * still isn't "saved".
   */
  savedText: string | null;
  /** Last known cursor position, fed by the editor's `onCursorMoved`. */
  cursor: CursorPos;
  /**
   * Bumped every time the buffer becomes a different document (new, open,
   * restore, Save As). Async flows capture it before their await and bail if
   * it moved — the ONE staleness rule, instead of each flow re-deriving "did
   * the world change under me?" from path/dirty on its own. The helpers below
   * always return `gen: 0`: main.ts is the only place that increments it.
   */
  gen: number;
}

/** The fields that describe what's on disk, as opposed to the document's identity. */
export type DocFileFields = Pick<
  DocState,
  "dirty" | "mtime" | "encoding" | "eol" | "mixedEol" | "indent" | "savedText"
>;

/** A blank buffer. `path` is non-null for a CLI/"Open with..." target that doesn't exist on disk yet. */
export function emptyDoc(path: string | null): DocState {
  return {
    path,
    dirty: false,
    mtime: null,
    encoding: ENCODING_UTF8,
    eol: EOL.LF,
    mixedEol: false,
    missing: false,
    indent: detectIndent(""),
    savedText: null,
    cursor: { line: 1, col: 1 },
    gen: 0,
  };
}

/**
 * What a freshly read file contributes to the document. `contents` is what
 * actually goes into the buffer — normally `file.contents`, but a recovered
 * snapshot when the user accepted one. The disk copy stays the undo baseline
 * (`savedText`), and a buffer that differs from it is dirty from the start:
 * the recovered text only survives if it gets saved.
 */
export function fromDisk(file: DecodedFile, contents: string): DocFileFields {
  return {
    dirty: contents !== file.contents,
    mtime: file.mtime,
    encoding: file.encoding,
    eol: file.eol,
    mixedEol: file.mixed_eol,
    indent: detectIndent(contents),
    savedText: file.contents,
  };
}

/**
 * What a completed save contributes to the document. `written` is the text
 * handed to `write_file`; `current` is the buffer NOW, after the await. IO
 * commands run off the main thread, so the user can keep typing while the
 * write is in flight — those keystrokes are not on disk, and marking the
 * document clean would make Close skip its confirm and autosave skip its
 * tick: silent data loss. The undo baseline is what was written, not what's
 * on screen. Disk is always UTF-8 and single-style EOL after a save, so
 * showing the original encoding or "(mixed)" afterwards would be lying.
 */
export function afterWrite(
  written: string,
  current: string,
): Pick<DocState, "dirty" | "savedText" | "encoding" | "mixedEol"> {
  return {
    dirty: current !== written,
    savedText: written,
    encoding: ENCODING_UTF8,
    mixedEol: false,
  };
}

/** A document opened from an existing file (see `fromDisk` for the `contents` vs `file.contents` split). */
export function docFromFile(path: string, file: DecodedFile, contents: string): DocState {
  return { ...emptyDoc(path), ...fromDisk(file, contents) };
}

/**
 * A path that doesn't exist on disk yet, possibly with a recovery snapshot
 * left over from a previous session. Same "recovered ≠ disk ⇒ dirty" rule
 * as `fromDisk`, with an empty disk — but no `savedText`, since there's no
 * file for an undo to land back on.
 */
export function docFromRecovery(path: string, contents: string): DocState {
  return { ...emptyDoc(path), dirty: contents !== "", indent: detectIndent(contents) };
}

/**
 * Dirty flag after the buffer changed to `text`. A regular edit always
 * dirties; an undo/redo that lands exactly on the saved baseline clears it.
 */
export function nextDirty(prev: DocState, text: string, isHistoryTraversal: boolean): boolean {
  if (isHistoryTraversal && prev.savedText !== null && text === prev.savedText) return false;
  return true;
}

export const EXTERNAL_CHANGE = {
  NOOP: "noop",
  RELOAD: "reload",
  ASK: "ask",
  MISSING: "missing",
} as const;
export type ExternalChange = (typeof EXTERNAL_CHANGE)[keyof typeof EXTERNAL_CHANGE];

/**
 * What a poll of the file's mtime means for the document. `mtime` is null
 * when the stat failed (deleted, renamed, temporarily unreadable).
 *
 * - `missing`: the file just vanished — flag it once, no dialog.
 * - `noop`: nothing new (same mtime, or still missing).
 * - `reload`: disk changed and there's nothing local to lose.
 * - `ask`: disk changed AND the buffer has unsaved edits.
 *
 * A file that was `missing` and reappears is handled by the caller (it just
 * clears the flag); the mtime comparison then proceeds as usual.
 */
export function externalChangeDecision(
  mtime: number | null,
  doc: Pick<DocState, "mtime" | "dirty" | "missing">,
): ExternalChange {
  if (mtime === null) return doc.missing ? EXTERNAL_CHANGE.NOOP : EXTERNAL_CHANGE.MISSING;
  if (mtime === doc.mtime) return EXTERNAL_CHANGE.NOOP;
  return doc.dirty ? EXTERNAL_CHANGE.ASK : EXTERNAL_CHANGE.RELOAD;
}
