import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, message, open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { createEditor, PLAIN_TEXT_LABEL } from "./editor";
import {
  detectIndent,
  type IndentInfo,
  indentLabel,
  indentUnitString,
  nextIndentPreset,
} from "./indent";
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

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`Missing element #${id}`);
  return node as T;
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

const EOL = { LF: "LF", CRLF: "CRLF" } as const;
type Eol = (typeof EOL)[keyof typeof EOL];
const ENCODING_UTF8 = "UTF-8";

/** Shape returned by the `read_file` command; see `src-tauri/src/text_io.rs`. */
interface DecodedFile {
  contents: string;
  encoding: string;
  eol: Eol;
  likely_binary: boolean;
}

/** Shape of `startup_file`'s return and the `open-file` event payload. */
interface StartupTarget {
  path: string;
  exists: boolean;
}

interface DocState {
  path: string | null;
  dirty: boolean;
  mtime: number | null;
  encoding: string;
  eol: Eol;
  /** True once a poll finds `path` gone (deleted or renamed elsewhere). */
  missing: boolean;
  indent: IndentInfo;
}

const doc: DocState = {
  path: null,
  dirty: false,
  mtime: null,
  encoding: ENCODING_UTF8,
  eol: EOL.LF,
  missing: false,
  indent: detectIndent(""),
};
const lastCursor = { line: 1, col: 1 };
let fontSize = parseFontSize(localStorage.getItem(FONT_KEY));
let wrapOn = localStorage.getItem(WRAP_KEY) === "true";

const editor = createEditor(el.editor, {
  onDocChanged: () => {
    if (!doc.dirty) {
      doc.dirty = true;
      updateStatus();
    }
  },
  onCursorMoved: (line, col) => {
    lastCursor.line = line;
    lastCursor.col = col;
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
  el.eol.textContent = doc.eol;
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
  return parseRecent(localStorage.getItem(RECENT_KEY));
}

function saveRecent(entries: RecentEntry[]): void {
  localStorage.setItem(RECENT_KEY, JSON.stringify(entries.slice(0, RECENT_MAX)));
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
  saveRecent(withCursor(loadRecent(), doc.path, lastCursor.line, lastCursor.col));
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
    await invoke("clear_recovery", { path });
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
    recovered = await invoke<string | null>("read_recovery", { path });
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

async function afterFileLoaded(path: string): Promise<void> {
  doc.path = path;
  doc.dirty = false;
  doc.missing = false;
  updateStatus();
  rememberRecent(path);
  renderRecent();
  await applyLanguage();
  await refreshMtime();
}

async function newFile(): Promise<void> {
  if (!(await confirmDiscard())) return;
  void clearRecovery(doc.path);
  syncRecentCursor();
  editor.setText("");
  doc.path = null;
  doc.dirty = false;
  doc.mtime = null;
  doc.encoding = ENCODING_UTF8;
  doc.eol = EOL.LF;
  doc.missing = false;
  doc.indent = detectIndent("");
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
async function openNewFileAt(path: string, external = false): Promise<void> {
  if (!(await confirmDiscard())) return;
  if (external && !(await confirmExternalReplace(path))) return;
  void clearRecovery(doc.path);
  syncRecentCursor();
  const contents = await checkRecovery(path, "");
  editor.setText(contents);
  doc.path = path;
  doc.dirty = false;
  doc.mtime = null;
  doc.encoding = ENCODING_UTF8;
  doc.eol = EOL.LF;
  doc.missing = false;
  doc.indent = detectIndent(contents);
  updateStatus();
  await applyLanguage();
  applyIndent();
  if (contents !== "") {
    doc.dirty = true;
    updateStatus();
  }
  editor.focus();
}

async function openFile(presetPath?: string, external = false): Promise<void> {
  if (!(await confirmDiscard())) return;
  if (external && presetPath !== undefined && !(await confirmExternalReplace(presetPath))) return;
  const path = presetPath ?? (await openDialog({ multiple: false, title: "Open file" }));
  if (typeof path !== "string") return;

  try {
    const file = await invoke<DecodedFile>("read_file", { path });
    if (file.likely_binary && !(await confirmOpenBinary(path))) return;
    void clearRecovery(doc.path);
    syncRecentCursor();
    doc.encoding = file.encoding;
    doc.eol = file.eol;
    const contents = await checkRecovery(path, file.contents);
    doc.indent = detectIndent(contents);
    editor.setText(contents);
    applyIndent();
    await afterFileLoaded(path);
    if (contents !== file.contents) {
      doc.dirty = true;
      updateStatus();
    }
    editor.focus();
  } catch (err) {
    await message(String(err), { title: APP_NAME, kind: "error" });
    forgetRecent(path);
  }
}

/** Reopens the last file from the previous session, at the same position. */
async function restoreSession(): Promise<void> {
  const [last] = loadRecent();
  if (last === undefined) return;
  try {
    const file = await invoke<DecodedFile>("read_file", { path: last.path });
    doc.encoding = file.encoding;
    doc.eol = file.eol;
    const contents = await checkRecovery(last.path, file.contents);
    doc.indent = detectIndent(contents);
    editor.setText(contents);
    applyIndent();
    await afterFileLoaded(last.path);
    editor.setCursor(last.line, last.col);
    if (contents !== file.contents) {
      doc.dirty = true;
      updateStatus();
    }
  } catch {
    forgetRecent(last.path);
  }
}

async function saveFile(): Promise<void> {
  // No known-good path to overwrite: either untitled, or the file vanished
  // from under us (deleted/renamed) — let the user pick where it goes.
  if (doc.path === null || doc.missing) {
    await saveFileAs();
    return;
  }
  // Nothing changed: skip the write entirely. Matters most for a file that
  // was never real text to begin with (see confirmOpenBinary) — a reflexive
  // Mod+S with no edits must not re-encode and clobber it.
  if (!doc.dirty) return;
  if (await writeTo(doc.path)) {
    updateStatus();
    await refreshMtime();
  }
}

async function saveFileAs(): Promise<void> {
  const path = await saveDialog({ title: "Save as", defaultPath: doc.path ?? undefined });
  if (path === null) return;
  if (await writeTo(path)) await afterFileLoaded(path);
}

async function writeTo(path: string): Promise<boolean> {
  try {
    await invoke("write_file", { path, contents: editor.getText(), eol: doc.eol });
    doc.dirty = false;
    // Save policy: always UTF-8 on disk, regardless of the source encoding.
    doc.encoding = ENCODING_UTF8;
    void clearRecovery(path);
    return true;
  } catch (err) {
    await message(String(err), { title: APP_NAME, kind: "error" });
    return false;
  }
}

// ---------- External changes (mtime polling) ----------

async function refreshMtime(): Promise<void> {
  if (doc.path === null) {
    doc.mtime = null;
    return;
  }
  try {
    doc.mtime = await invoke<number>("file_mtime", { path: doc.path });
  } catch {
    doc.mtime = null;
  }
}

async function reloadFromDisk(): Promise<void> {
  if (doc.path === null) return;
  const file = await invoke<DecodedFile>("read_file", { path: doc.path });
  doc.encoding = file.encoding;
  doc.eol = file.eol;
  doc.indent = detectIndent(file.contents);
  editor.replaceText(file.contents);
  applyIndent();
  doc.dirty = false;
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
  try {
    await invoke("save_recovery", { path: doc.path, contents: editor.getText() });
  } catch {
    // Best-effort safety net; a failed autosave shouldn't interrupt editing.
  }
}

let checkingExternal = false;

async function checkExternalChange(): Promise<void> {
  if (checkingExternal || doc.path === null || doc.mtime === null) return;
  checkingExternal = true;
  try {
    const mtime = await invoke<number>("file_mtime", { path: doc.path });
    if (doc.missing) {
      // Reappeared (e.g. another app's own atomic rename finished mid-poll).
      doc.missing = false;
      updateStatus();
    }
    if (mtime === doc.mtime) return;
    doc.mtime = mtime; // recorded: don't prompt again for the same change
    if (!doc.dirty) {
      await reloadFromDisk();
      return;
    }
    const reload = await ask(
      "The file changed on disk and you have unsaved changes. Reload it and discard them?",
      { title: APP_NAME, kind: "warning" },
    );
    if (reload) await reloadFromDisk();
  } catch {
    // Deleted, renamed, or temporarily unreadable: don't nag with a dialog,
    // just flag it so the next save asks where to put the file instead of
    // silently writing to a path that's no longer there.
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
  localStorage.setItem(FONT_KEY, String(fontSize));
}

function adjustFont(delta: number): void {
  fontSize = clampFontSize(fontSize + delta);
  applyFont();
}

function applyWrap(): void {
  editor.setWrap(wrapOn);
  el.btnWrap.textContent = `Wrap: ${wrapOn ? "on" : "off"}`;
  localStorage.setItem(WRAP_KEY, String(wrapOn));
}

function toggleWrap(): void {
  wrapOn = !wrapOn;
  applyWrap();
}

function applyTheme(id: string): void {
  const theme = themeById(id);
  editor.setTheme(theme.id);
  document.body.dataset.dark = String(theme.dark);
  localStorage.setItem(THEME_KEY, theme.id);
}

function initThemes(): void {
  for (const theme of THEMES) {
    const option = document.createElement("option");
    option.value = theme.id;
    option.textContent = theme.label;
    el.themeSelect.appendChild(option);
  }
  const initial = themeById(localStorage.getItem(THEME_KEY) ?? DEFAULT_THEME_ID);
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

const isMac = navigator.userAgent.includes("Mac");

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
    const result = await invoke<string>("install_cli_command");
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
  if (doc.dirty && !(await confirmDiscard())) event.preventDefault();
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
// (single-instance): both emit open-file from Rust
void listen<StartupTarget>("open-file", (event) => {
  const { path, exists } = event.payload;
  void (exists ? openFile(path, true) : openNewFileAt(path, true));
});

// Native File menu clicks/accelerators (see src-tauri/src/lib.rs build_menu)
void listen<string>("menu-action", (event) => {
  switch (event.payload) {
    case "new":
      void newFile();
      break;
    case "open":
      void openFile();
      break;
    case "save":
      void saveFile();
      break;
    case "save_as":
      void saveFileAs();
      break;
    case "shortcuts":
      openShortcuts();
      break;
    case "install-cli":
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
  const startup = await invoke<StartupTarget | null>("startup_file");
  if (startup !== null) {
    await (startup.exists ? openFile(startup.path, true) : openNewFileAt(startup.path, true));
  } else {
    updateStatus();
    await applyLanguage();
    await restoreSession();
  }
  window.setInterval(() => void checkExternalChange(), MTIME_POLL_MS);
  window.setInterval(() => void autosaveTick(), AUTOSAVE_INTERVAL_MS);
  window.addEventListener("focus", () => void checkExternalChange());
  editor.focus();
  void invoke("signal_ready");
}

void init();
