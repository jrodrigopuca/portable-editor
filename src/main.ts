import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, message, open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  afterWrite,
  type DocState,
  docFromFile,
  docFromRecovery,
  EXTERNAL_CHANGE,
  emptyDoc,
  externalChangeDecision,
  fromDisk,
  nextDirty,
} from "./document";
import { createEditor, PLAIN_TEXT_LABEL } from "./editor";
import { indentLabel, indentUnitString, nextIndentPreset } from "./indent";
import { errorMessage, IO_ERROR_KIND, IO_OPERATION, isIoError, PLATFORM } from "./io-error";
import * as ipc from "./ipc";
import { isMenuAction, MENU_ACTION, type StartupTarget } from "./ipc";
import { basename } from "./paths";
import { clampFontSize, FONT_DEFAULT, parseFontSize } from "./prefs";
import {
  addRecent,
  parseRecent,
  RECENT_MAX,
  type RecentEntry,
  removeRecent,
  withCursor,
} from "./recent";
import { DEFAULT_THEME_ID, THEMES, themeById } from "./themes";

const APP_NAME = "portable-editor";
const THEME_KEY = "portable-editor:theme";
const FONT_KEY = "portable-editor:font-size";
const WRAP_KEY = "portable-editor:wrap";
const RECENT_KEY = "portable-editor:recent";
const MTIME_POLL_MS = 2000;
// Above this, skip syntax highlighting to keep the editor responsive. See
// docs/ROADMAP.md Fase 3 — read_file itself rejects anything past 100 MB.
const HIGHLIGHT_SIZE_LIMIT = 10 * 1024 * 1024;

const appWindow = getCurrentWindow();
// The editor ships for exactly two platforms; this drives key labels and
// platform-specific error hints, nothing that changes behaviour.
const isMac = navigator.userAgent.includes("Mac");
const platform = isMac ? PLATFORM.MACOS : PLATFORM.LINUX;

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`Missing element #${id}`);
  return node as T;
}

// `localStorage` can throw (disabled storage, full quota, a corrupted
// profile) — every caller below already degrades to a safe default when a
// key is simply absent (parseFontSize, parseRecent, themeById...), so a
// thrown read/write should read the same as "nothing saved" rather than
// crash init() or interrupt editing. Same best-effort spirit as autosave.
function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Best-effort: losing a preference write isn't worth interrupting editing.
  }
}

const el = {
  editor: byId<HTMLDivElement>("editor"),
  btnNew: byId<HTMLButtonElement>("btn-new"),
  btnOpen: byId<HTMLButtonElement>("btn-open"),
  btnSave: byId<HTMLButtonElement>("btn-save"),
  btnWrap: byId<HTMLButtonElement>("btn-wrap"),
  recentSelect: byId<HTMLSelectElement>("recent-select"),
  fileName: byId<HTMLSpanElement>("file-name"),
  dirtyDot: byId<HTMLSpanElement>("file-dirty"),
  cursorPos: byId<HTMLSpanElement>("cursor-pos"),
  language: byId<HTMLSpanElement>("language"),
  encoding: byId<HTMLSpanElement>("encoding"),
  eol: byId<HTMLSpanElement>("eol"),
  btnIndent: byId<HTMLButtonElement>("btn-indent"),
  themeSelect: byId<HTMLSelectElement>("theme-select"),
  shortcutsPanel: byId<HTMLDivElement>("shortcuts-panel"),
  shortcutsBackdrop: byId<HTMLDivElement>("shortcuts-backdrop"),
  shortcutsList: byId<HTMLTableElement>("shortcuts-list"),
  btnCloseShortcuts: byId<HTMLButtonElement>("btn-close-shortcuts"),
};

/** macOS "Open With" on a multi-selection hands the app every file at once;
 * only the first is opened (single-file identity), so this is the one place
 * the user learns the rest didn't just silently vanish. */
async function notifyExtraFilesIgnored(count: number): Promise<void> {
  if (count === 0) return;
  await message(
    `portable-editor opens one file at a time. ${count} other file${count === 1 ? " was" : "s were"} not opened.`,
    { title: APP_NAME },
  );
}

// Mutable on purpose: every flow reads `doc` at the moment it needs it, and
// the pure helpers in document.ts produce the next value it gets patched with.
const doc: DocState = emptyDoc(null);

/** Marks the buffer as a different document: every in-flight async flow that captured the previous generation must drop its result. */
function beginDocument(): void {
  doc.gen += 1;
}

/** True if the buffer stopped being the document `gen` was captured from. */
function isStale(gen: number): boolean {
  return gen !== doc.gen;
}

/**
 * The buffer becomes `next` — path, disk fields, cursor, all at once — and
 * every in-flight async flow drops out (see beginDocument). Synchronous by
 * design: callers must have finished their last await before this (invariant
 * #11 in CLAUDE.md).
 */
function becomeDocument(next: DocState): void {
  beginDocument();
  Object.assign(doc, next, { gen: doc.gen });
}
let fontSize = parseFontSize(safeGetItem(FONT_KEY));
let wrapOn = safeGetItem(WRAP_KEY) === "true";

const editor = createEditor(el.editor, {
  onDocChanged: (text, isHistoryTraversal) => {
    const dirty = nextDirty(doc, text, isHistoryTraversal);
    if (dirty !== doc.dirty) {
      doc.dirty = dirty;
      updateStatus();
    }
  },
  onCursorMoved: (line, col) => {
    doc.cursor = { line, col };
    el.cursorPos.textContent = `Ln ${line}, Col ${col}`;
  },
});

function fileLabel(): string {
  return doc.path === null ? "untitled" : basename(doc.path);
}

function updateStatus(): void {
  el.fileName.textContent = doc.missing ? `${fileLabel()} (deleted on disk)` : fileLabel();
  el.fileName.title = doc.path ?? "";
  el.dirtyDot.hidden = !doc.dirty;
  el.encoding.textContent = doc.encoding;
  el.eol.textContent = doc.mixedEol ? `${doc.eol} (mixed)` : doc.eol;
  void appWindow.setTitle(`${doc.dirty ? "● " : ""}${fileLabel()} — ${APP_NAME}`);
}

function applyIndent(): void {
  editor.setIndentUnit(indentUnitString(doc.indent));
  el.btnIndent.textContent = indentLabel(doc.indent);
}

async function applyLanguage(): Promise<void> {
  if (editor.getText().length > HIGHLIGHT_SIZE_LIMIT) {
    editor.setPlainText();
    el.language.textContent = `${PLAIN_TEXT_LABEL} (highlighting off, large file)`;
    return;
  }
  el.language.textContent = await editor.detectLanguage(doc.path);
}

async function confirmDiscard(): Promise<boolean> {
  if (!doc.dirty) return true;
  return ask("You have unsaved changes. Discard them?", { title: APP_NAME, kind: "warning" });
}

/**
 * Extra guard for opens triggered from OUTSIDE the app (second CLI
 * invocation, "Open with..." while running): unlike confirmDiscard(), this
 * also asks before replacing a real, unedited file. The user didn't choose
 * this from inside the app, so "nothing unsaved" isn't consent to swap out
 * what's currently on screen — single-instance means there's only one
 * window, so an external open would otherwise silently replace it.
 */
async function confirmExternalReplace(incomingPath: string): Promise<boolean> {
  if (doc.path === null || doc.dirty) return true; // confirmDiscard() already covers dirty
  return ask(`Open "${basename(incomingPath)}"? This replaces "${fileLabel()}" in this window.`, {
    title: APP_NAME,
    kind: "warning",
  });
}

/**
 * `read_file`'s `likely_binary` flag means the Windows-1252 fallback
 * decoded non-text data (image, executable, ...) as if it were legacy
 * text — it never fails outright, so this is the only signal we get.
 * Editing and saving that "text" would rewrite the original file as UTF-8
 * garbage. Ask before loading it into the editor at all.
 */
async function confirmOpenBinary(path: string): Promise<boolean> {
  return ask(
    `"${basename(path)}" doesn't look like a text file. Opening and saving it could corrupt it. Open anyway?`,
    { title: APP_NAME, kind: "warning" },
  );
}

// ---------- Recent files (pure logic lives in recent.ts) ----------

function loadRecent(): RecentEntry[] {
  return parseRecent(safeGetItem(RECENT_KEY));
}

function saveRecent(entries: RecentEntry[]): void {
  safeSetItem(RECENT_KEY, JSON.stringify(entries.slice(0, RECENT_MAX)));
}

function rememberRecent(path: string): void {
  saveRecent(addRecent(loadRecent(), path));
}

function forgetRecent(path: string): void {
  saveRecent(removeRecent(loadRecent(), path));
  renderRecent();
}

/** Persists the current file's cursor position into its recent-files entry. */
function syncRecentCursor(): void {
  if (doc.path === null) return;
  saveRecent(withCursor(loadRecent(), doc.path, doc.cursor.line, doc.cursor.col));
}

function renderRecent(): void {
  const entries = loadRecent();
  el.recentSelect.hidden = entries.length === 0;
  el.recentSelect.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.textContent = "Recent";
  placeholder.value = "";
  placeholder.disabled = true;
  placeholder.selected = true;
  el.recentSelect.appendChild(placeholder);
  for (const entry of entries) {
    const option = document.createElement("option");
    option.value = entry.path;
    option.textContent = basename(entry.path);
    option.title = entry.path;
    el.recentSelect.appendChild(option);
  }
}

// ---------- Open / save ----------

/** Best-effort cleanup — a failed clear just means a stale recovery file. */
async function clearRecovery(path: string | null): Promise<void> {
  if (path === null) return;
  try {
    await ipc.clearRecovery(path);
  } catch {
    // ignore
  }
}

/**
 * Compares `diskContents` against any leftover recovery snapshot for `path`
 * (from a crash/force-quit between autosaves — see AUTOSAVE_INTERVAL_MS
 * below). Identical or missing → just cleans up and returns `diskContents`.
 * Different → asks before using the recovered version.
 */
async function checkRecovery(path: string, diskContents: string): Promise<string> {
  let recovered: string | null;
  try {
    recovered = await ipc.readRecovery(path);
  } catch {
    return diskContents;
  }
  if (recovered === null || recovered === diskContents) return diskContents;

  const useRecovered = await ask(
    "portable-editor didn't close cleanly last time this file was open. Recover the unsaved changes?",
    { title: APP_NAME, kind: "warning" },
  );
  if (!useRecovered) {
    void clearRecovery(path);
    return diskContents;
  }
  return recovered;
}

/** Shared tail of every "a real file is now on screen" flow. It doesn't
 * touch `doc`'s identity fields: every caller already went through
 * becomeDocument() with the right path/dirty/missing. */
async function afterFileLoaded(path: string): Promise<void> {
  updateStatus();
  rememberRecent(path);
  renderRecent();
  await applyLanguage();
}

// ---------- The document queue ----------
//
// Every flow that can change WHICH document is on screen, or that puts a
// question to the user about it, runs here one at a time: New, Open (menu,
// button, drop, Recent, CLI, "Open with..."), Save, Save As, session restore,
// and the poll's reload. Tauri dialogs are async — the event loop keeps
// running while a sheet is up — so without this, "discard A?" could be
// answered after a drop already replaced A with B, and the consent would be
// applied to the wrong document. Serializing collapses that whole class:
// inside a queued flow the document can't change under you, so the flow
// doesn't need to re-check anything after its awaits. The generation counter
// (`doc.gen`) is only for the background flows that can't wait their turn:
// the mtime poll's stat and the autosave tick.
let documentQueue: Promise<unknown> = Promise.resolve();

/** Runs `task` after every previously queued flow has settled (pass or fail). */
function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = documentQueue.then(task, task);
  documentQueue = run.catch(() => {}); // one failed flow must not block the next
  return run;
}

// Public entry points. Anything already INSIDE a queued flow (init, the
// open-file listener, saveFile → saveFileAs) calls the run* functions
// directly — queueing from inside the queue would wait on itself forever.
const newFile = (): Promise<void> => exclusive(runNewFile);
const openFile = (presetPath?: string, external = false): Promise<void> =>
  exclusive(() => runOpenFile(presetPath, external));
const saveFile = (): Promise<void> => exclusive(runSaveFile);
const saveFileAs = (): Promise<void> => exclusive(runSaveFileAs);

async function runNewFile(): Promise<void> {
  if (!(await confirmDiscard())) return;
  void clearRecovery(doc.path);
  syncRecentCursor();
  becomeDocument(emptyDoc(null));
  editor.setText("");
  updateStatus();
  await applyLanguage();
  applyIndent();
  editor.focus();
}

/**
 * A CLI/"Open with..." path that doesn't exist yet (e.g. `portable-editor
 * notes.md` before notes.md is created) — same as `newFile()` but keeps the
 * path, so Save writes straight there instead of prompting Save As. Matches
 * vim/nano/code: opening a nonexistent path creates it, doesn't error out.
 */
async function runOpenNewFileAt(path: string, external = false): Promise<void> {
  if (!(await confirmDiscard())) return;
  if (external && !(await confirmExternalReplace(path))) return;
  void clearRecovery(doc.path);
  syncRecentCursor();
  const contents = await checkRecovery(path, "");
  becomeDocument(docFromRecovery(path, contents));
  editor.setText(contents);
  updateStatus();
  await applyLanguage();
  applyIndent();
  editor.focus();
}

async function runOpenFile(presetPath?: string, external = false): Promise<void> {
  if (!(await confirmDiscard())) return;
  if (external && presetPath !== undefined && !(await confirmExternalReplace(presetPath))) return;
  const path = presetPath ?? (await openDialog({ multiple: false, title: "Open file" }));
  if (typeof path !== "string") return;

  try {
    const file = await ipc.readFile(path);
    if (file.likely_binary && !(await confirmOpenBinary(path))) return;
    void clearRecovery(doc.path);
    syncRecentCursor();
    // checkRecovery() may sit on a dialog for a while: don't touch `doc`
    // before it resolves, or a poll reloading the OLD file meanwhile would
    // overwrite these fields. Everything from here to afterFileLoaded() is
    // synchronous — one atomic "become another document" step.
    const contents = await checkRecovery(path, file.contents);
    becomeDocument(docFromFile(path, file, contents));
    editor.setText(contents);
    applyIndent();
    await afterFileLoaded(path);
    editor.focus();
  } catch (err) {
    await message(errorMessage(err, path, IO_OPERATION.READ, platform), {
      title: APP_NAME,
      kind: "error",
    });
    if (isGone(err)) forgetRecent(path);
  }
}

/** Only a file that no longer exists deserves eviction from Recent — a
 * too-large log or a not-yet-mounted volume is still worth remembering. */
function isGone(err: unknown): boolean {
  return isIoError(err) && err.kind === IO_ERROR_KIND.NOT_FOUND;
}

/** Reopens the last file from the previous session, at the same position. */
async function restoreSession(): Promise<void> {
  const [last] = loadRecent();
  if (last === undefined) return;
  try {
    const file = await ipc.readFile(last.path);
    const contents = await checkRecovery(last.path, file.contents);
    becomeDocument(docFromFile(last.path, file, contents)); // same ordering rationale as openFile()
    editor.setText(contents);
    applyIndent();
    await afterFileLoaded(last.path);
    editor.setCursor(last.line, last.col);
  } catch (err) {
    await message(errorMessage(err, last.path, IO_OPERATION.READ, platform), {
      title: APP_NAME,
      kind: "error",
    });
    if (isGone(err)) forgetRecent(last.path);
  }
}

async function runSaveFile(): Promise<void> {
  // No known-good path to overwrite: either untitled, or the file vanished
  // from under us (deleted/renamed) — let the user pick where it goes.
  if (doc.path === null || doc.missing) {
    await runSaveFileAs();
    return;
  }
  // Nothing changed: skip the write entirely. Matters most for a file that
  // was never real text to begin with (see confirmOpenBinary) — a reflexive
  // Mod+S with no edits must not re-encode and clobber it.
  if (!doc.dirty) return;
  if (await writeTo(doc.path)) updateStatus();
}

async function runSaveFileAs(): Promise<void> {
  const path = await saveDialog({ title: "Save as", defaultPath: doc.path ?? undefined });
  if (path === null) return;
  const previousPath = doc.path;
  if (!(await writeTo(path))) return;
  // writeTo() cleared the recovery for the NEW path; the old one (written by
  // autosaveTick while this doc was dirty) would otherwise linger and offer
  // "recover?" content the user already saved elsewhere.
  if (previousPath !== path) void clearRecovery(previousPath);
  // Same buffer, different identity: in-flight polls on the old path must
  // drop out, and the file is known to exist at its new path.
  becomeDocument({ ...doc, path, missing: false });
  await afterFileLoaded(path);
}

async function writeTo(path: string): Promise<boolean> {
  try {
    const contents = editor.getText();
    const mtime = await ipc.writeFile(path, contents, doc.eol);
    // Recorded in the same tick as the dirty decision: a poll between
    // "written" and "mtime known" used to see our own save as an external
    // change. The buffer may have moved while the write was in flight —
    // afterWrite() keeps the doc dirty in that case (see document.ts).
    doc.mtime = mtime;
    Object.assign(doc, afterWrite(contents, editor.getText()));
    if (doc.dirty) {
      // Keystrokes landed during the write: the snapshot on disk (from an
      // autosave tick BEFORE this save) is now older than the file itself.
      // A crash in the next 10 s would offer to "recover" backwards. Replace
      // it with the buffer as it is now; best-effort like every autosave.
      void ipc.saveRecovery(path, editor.getText()).catch(() => {});
    } else {
      void clearRecovery(path);
    }
    return true;
  } catch (err) {
    await message(errorMessage(err, path, IO_OPERATION.SAVE, platform), {
      title: APP_NAME,
      kind: "error",
    });
    return false;
  }
}

// ---------- External changes (mtime polling) ----------

/** Shared prompt for "disk changed, you have unsaved changes" — asked both
 * up front (checkExternalChange, already dirty) and after the fact
 * (reloadFromDisk, if a race made it dirty mid-read — see there). */
async function confirmReloadDiscard(): Promise<boolean> {
  return ask("The file changed on disk and you have unsaved changes. Reload it and discard them?", {
    title: APP_NAME,
    kind: "warning",
  });
}

/** Inside the queue: acts on the disk's mtime as of the poll, judged
 * against the document as it is NOW. */
async function applyExternalChange(mtime: number): Promise<void> {
  switch (externalChangeDecision(mtime, doc)) {
    case EXTERNAL_CHANGE.NOOP:
    case EXTERNAL_CHANGE.MISSING:
      return; // our own save caught up, or the poll will re-flag it
    case EXTERNAL_CHANGE.RELOAD:
      doc.mtime = mtime; // recorded: don't prompt again for the same change
      await reloadFromDisk();
      return;
    case EXTERNAL_CHANGE.ASK:
      doc.mtime = mtime;
      if (await confirmReloadDiscard()) await reloadFromDisk();
      return;
  }
}

/** Always called from inside the document queue: the document can't change
 * identity during its awaits, so there's no generation check here. */
async function reloadFromDisk(): Promise<void> {
  if (doc.path === null) return;
  const dirtyBeforeRead = doc.dirty;
  const file = await ipc.readFile(doc.path);
  // The read above is the only await in here — if the user typed while it
  // was in flight, doc.dirty flips to true DURING this call, with no caller
  // aware of it. Silently overwriting would discard that edit with nothing
  // beyond a bare Ctrl+Z the user has no reason to reach for. Only ask here
  // if THIS call is what caused dirty to turn true: if the caller already
  // confirmed discarding (checkExternalChange's dirty branch), doc.dirty
  // was already true going in, so this is a no-op for that path.
  if (!dirtyBeforeRead && doc.dirty && !(await confirmReloadDiscard())) return;
  // replaceText() is tagged as a reload, so onDocChanged stays quiet and the
  // dirty flag is decided only here: same identity, fresh contents, clean.
  editor.replaceText(file.contents);
  Object.assign(doc, fromDisk(file, file.contents));
  applyIndent();
  updateStatus();
  // Disk now matches memory: any pending recovery snapshot is stale.
  void clearRecovery(doc.path);
}

// ---------- Autosave (crash/force-quit recovery) ----------

// Dumps the buffer to a recovery file every 10s while dirty, so an
// interruption between saves (crash, force-quit, power loss) loses at most
// this much work. Only for files with a real path — untitled buffers have no
// stable key to recover against on the next launch (see ROADMAP Fase 4).
const AUTOSAVE_INTERVAL_MS = 10_000;

async function autosaveTick(): Promise<void> {
  if (doc.path === null || !doc.dirty) return;
  const path = doc.path;
  const gen = doc.gen;
  try {
    await ipc.saveRecovery(path, editor.getText());
    // A real save, a Save As or a discard can complete while the write above
    // was in flight — each already cleared the recovery file for `path`, but
    // that clear can land BEFORE this (now-stale) write does, leaving a
    // snapshot that would offer "recover this?" content already saved (or
    // deliberately thrown away). Unless THIS same document is still dirty,
    // what we just wrote is garbage: clean up after ourselves.
    if (isStale(gen) || !doc.dirty) void clearRecovery(path);
  } catch {
    // Best-effort safety net; a failed autosave shouldn't interrupt editing.
  }
}

let checkingExternal = false;

async function checkExternalChange(): Promise<void> {
  if (checkingExternal || doc.path === null || doc.mtime === null) return;
  checkingExternal = true;
  const gen = doc.gen;
  try {
    // Deleted, renamed, or temporarily unreadable → null: no dialog for
    // that, just a flag (MISSING below) so the next save asks where to put
    // the file instead of silently writing to a path that's no longer there.
    let mtime: number | null;
    try {
      mtime = await ipc.fileMtime(doc.path);
    } catch {
      mtime = null;
    }
    // Stat of the OLD path landed after the user switched documents: its
    // mtime (or its failure) says nothing about this doc.
    if (isStale(gen)) return;
    if (mtime !== null && doc.missing) {
      // Reappeared (e.g. another app's own atomic rename finished mid-poll).
      doc.missing = false;
      updateStatus();
    }
    switch (externalChangeDecision(mtime, doc)) {
      case EXTERNAL_CHANGE.NOOP:
        return;
      case EXTERNAL_CHANGE.MISSING:
        doc.missing = true;
        updateStatus();
        return;
      case EXTERNAL_CHANGE.RELOAD:
      case EXTERNAL_CHANGE.ASK:
        // Queued: if a "discard A?" dialog is already up, this waits for it
        // instead of stacking a second, contradictory question on top. By
        // the time it runs, the world may have moved — another document on
        // screen (isStale), keystrokes that make a silent reload a data
        // loss, or our OWN save having landed (its stat can overtake
        // write_file's response on the async runtime, and then the "change"
        // is ours and the doc is clean). So the decision is re-derived HERE,
        // with the current dirty/mtime, and `doc.mtime` is recorded here
        // too — not at poll time, where the information was already stale.
        if (mtime === null) return; // unreachable: both decisions need a stat; narrows the type
        await exclusive(async () => {
          if (isStale(gen)) return;
          await applyExternalChange(mtime);
        });
        return;
    }
  } catch {
    // The file vanished between the stat and reloadFromDisk()'s read: same
    // treatment as a failed stat.
    if (isStale(gen)) return; // the OLD path vanished, not this one
    if (!doc.missing) {
      doc.missing = true;
      updateStatus();
    }
  } finally {
    checkingExternal = false;
  }
}

// ---------- View preferences ----------

function applyFont(): void {
  document.documentElement.style.setProperty("--editor-font-size", `${fontSize}px`);
  safeSetItem(FONT_KEY, String(fontSize));
}

function adjustFont(delta: number): void {
  fontSize = clampFontSize(fontSize + delta);
  applyFont();
}

function applyWrap(): void {
  editor.setWrap(wrapOn);
  el.btnWrap.textContent = `Wrap: ${wrapOn ? "on" : "off"}`;
  safeSetItem(WRAP_KEY, String(wrapOn));
}

function toggleWrap(): void {
  wrapOn = !wrapOn;
  applyWrap();
}

function applyTheme(id: string): void {
  const theme = themeById(id);
  editor.setTheme(theme.id);
  document.body.dataset.dark = String(theme.dark);
  safeSetItem(THEME_KEY, theme.id);
}

function initThemes(): void {
  for (const theme of THEMES) {
    const option = document.createElement("option");
    option.value = theme.id;
    option.textContent = theme.label;
    el.themeSelect.appendChild(option);
  }
  const initial = themeById(safeGetItem(THEME_KEY) ?? DEFAULT_THEME_ID);
  el.themeSelect.value = initial.id;
  applyTheme(initial.id);
  el.themeSelect.addEventListener("change", () => {
    applyTheme(el.themeSelect.value);
    editor.focus();
  });
}

// ---------- Keyboard shortcuts panel ----------

interface ShortcutEntry {
  keys: string;
  action: string;
}

// Keep in sync with the "Atajos" table in README.md.
const SHORTCUTS: readonly ShortcutEntry[] = [
  { keys: "Mod+O", action: "Open file" },
  { keys: "Mod+S", action: "Save" },
  { keys: "Mod+Shift+S", action: "Save as" },
  { keys: "Mod+N", action: "New file" },
  { keys: "Mod+F", action: "Find / replace" },
  { keys: "Mod+Alt+G", action: "Go to line" },
  { keys: "Mod+Z", action: "Undo" },
  { keys: "Mod+Shift+Z", action: "Redo" },
  { keys: "Mod+/", action: "Toggle line comment" },
  { keys: "Mod+D", action: "Select next occurrence" },
  { keys: "Alt+click", action: "Add cursor" },
  { keys: "Mod+=", action: "Increase font size" },
  { keys: "Mod+-", action: "Decrease font size" },
  { keys: "Mod+0", action: "Reset font size" },
  { keys: "Alt+Z", action: "Toggle word wrap" },
  { keys: "Mod+Shift+/", action: "Show this panel" },
];

function formatKeys(keys: string): string {
  const symbols: Record<string, string> = {
    Mod: isMac ? "⌘" : "Ctrl",
    Alt: isMac ? "⌥" : "Alt",
    Shift: isMac ? "⇧" : "Shift",
  };
  return keys
    .split("+")
    .map((part) => symbols[part] ?? part)
    .join(isMac ? "" : "+");
}

function renderShortcuts(): void {
  el.shortcutsList.replaceChildren();
  for (const { keys, action } of SHORTCUTS) {
    const row = document.createElement("tr");
    const keysCell = document.createElement("td");
    keysCell.className = "shortcut-keys";
    keysCell.textContent = formatKeys(keys);
    const actionCell = document.createElement("td");
    actionCell.textContent = action;
    row.append(keysCell, actionCell);
    el.shortcutsList.appendChild(row);
  }
}

function openShortcuts(): void {
  el.shortcutsPanel.hidden = false;
}

function closeShortcuts(): void {
  el.shortcutsPanel.hidden = true;
}

/** Help → "Install 'portable-editor' Command" (macOS only; see lib.rs). */
async function installCliCommand(): Promise<void> {
  try {
    const result = await ipc.installCliCommand();
    await message(result, { title: APP_NAME });
  } catch (err) {
    await message(String(err), { title: APP_NAME, kind: "error" });
  }
}

// ---------- UI events ----------

window.addEventListener(
  "keydown",
  (event) => {
    if (event.key === "Escape" && !el.shortcutsPanel.hidden) {
      event.preventDefault();
      event.stopPropagation();
      closeShortcuts();
      return;
    }
    if (event.altKey && event.code === "KeyZ") {
      event.preventDefault();
      toggleWrap();
      return;
    }
    if (!(event.metaKey || event.ctrlKey)) return;
    const key = event.key.toLowerCase();

    // New/Open/Save/Save As are handled by the native File menu (see
    // src-tauri/src/lib.rs) — not duplicated here to avoid double-firing
    // (e.g. two "Save as" dialogs).
    if (key === "=" || key === "+") {
      event.preventDefault();
      adjustFont(1);
    } else if (key === "-") {
      event.preventDefault();
      adjustFont(-1);
    } else if (key === "0") {
      event.preventDefault();
      fontSize = FONT_DEFAULT;
      applyFont();
    }
  },
  { capture: true },
);

void appWindow.onCloseRequested(async (event) => {
  syncRecentCursor();
  if (!doc.dirty) return;
  if (!(await confirmDiscard())) {
    event.preventDefault();
    return;
  }
  // The user threw these edits away on purpose: without this, the next
  // launch would claim "didn't close cleanly" and offer to recover them.
  // Awaited, so the window doesn't go down with the delete still in flight.
  await clearRecovery(doc.path);
});

el.btnNew.addEventListener("click", () => void newFile());
el.btnOpen.addEventListener("click", () => void openFile());
el.btnSave.addEventListener("click", () => void saveFile());
el.btnWrap.addEventListener("click", () => {
  toggleWrap();
  editor.focus();
});
el.btnIndent.addEventListener("click", () => {
  doc.indent = nextIndentPreset(doc.indent);
  applyIndent();
  editor.focus();
});

el.recentSelect.addEventListener("change", () => {
  const path = el.recentSelect.value;
  el.recentSelect.selectedIndex = 0;
  if (path !== "") void openFile(path);
});

// Files dropped onto the window (the webview drop event carries real paths)
void getCurrentWebview().onDragDropEvent((event) => {
  if (event.payload.type !== "drop") return;
  const [path] = event.payload.paths;
  if (path !== undefined) void openFile(path);
});

// "Open with..." while the app is running (macOS) or a second CLI invocation
// (single-instance): both emit open-file from Rust. Two invocations arriving
// close together (e.g. two `portable-editor file.txt` in quick succession)
// would otherwise run their confirm dialogs and doc-state mutations
// concurrently, with the resolution order depending on whichever dialog the
// user closes first — unlike checkExternalChange()'s checkingExternal guard,
// dropping the second one here isn't an option: there's no next poll to
// catch it later, so it'd just discard a file the user explicitly asked to
// open. Chain them through a serial queue instead — same order they arrived
// in, one fully settled before the next starts.
void listen<StartupTarget>("open-file", (event) => {
  const { path, exists, extra_ignored } = event.payload;
  void exclusive(async () => {
    await (exists ? runOpenFile(path, true) : runOpenNewFileAt(path, true));
    await notifyExtraFilesIgnored(extra_ignored);
  });
});

// Rust could not even build a target for a file it was asked to open (today:
// a path that isn't valid UTF-8 — see startup.rs). Same two producers as
// open-file; the payload is the finished sentence.
void listen<string>("open-file-error", (event) => {
  void exclusive(async () => {
    await message(event.payload, { title: APP_NAME, kind: "error" });
  });
});

// Native File menu clicks/accelerators (see src-tauri/src/lib.rs build_menu)
void listen<string>("menu-action", (event) => {
  const action = event.payload;
  if (!isMenuAction(action)) return;
  switch (action) {
    case MENU_ACTION.NEW:
      void newFile();
      break;
    case MENU_ACTION.OPEN:
      void openFile();
      break;
    case MENU_ACTION.SAVE:
      void saveFile();
      break;
    case MENU_ACTION.SAVE_AS:
      void saveFileAs();
      break;
    case MENU_ACTION.SHORTCUTS:
      openShortcuts();
      break;
    case MENU_ACTION.INSTALL_CLI:
      void installCliCommand();
      break;
  }
});

el.btnCloseShortcuts.addEventListener("click", () => closeShortcuts());
el.shortcutsBackdrop.addEventListener("click", () => closeShortcuts());

// ---------- Init ----------

async function init(): Promise<void> {
  applyFont();
  applyWrap();
  applyIndent();
  initThemes();
  renderRecent();
  renderShortcuts();
  // The safety nets go up BEFORE anything that can throw: if startup_file
  // rejected with these registered after it, the whole session would run
  // with no external-change polling and no autosave, and no visible symptom.
  // Both are no-ops until a document with a path exists, so there's nothing
  // to gain by delaying them.
  window.setInterval(() => void checkExternalChange(), MTIME_POLL_MS);
  window.setInterval(() => void autosaveTick(), AUTOSAVE_INTERVAL_MS);
  window.addEventListener("focus", () => void checkExternalChange());
  try {
    const startup = await ipc.startupFile();
    if (startup !== null) {
      await (startup.exists
        ? runOpenFile(startup.path, true)
        : runOpenNewFileAt(startup.path, true));
      await notifyExtraFilesIgnored(startup.extra_ignored);
    } else {
      updateStatus();
      await applyLanguage();
      await restoreSession();
    }
  } catch (err) {
    await message(String(err), { title: APP_NAME, kind: "error" });
  }
  editor.focus();
  void ipc.signalReady();
}

// init() is the first item in the document queue: the open-file listener is
// live from module evaluation, so a CLI invocation landing during startup
// waits for restoreSession() instead of running concurrently with it.
void exclusive(init);
