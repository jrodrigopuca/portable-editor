import { indentWithTab } from "@codemirror/commands";
import { indentUnit, LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { basename } from "./paths";
import { DEFAULT_THEME_ID, themeById } from "./themes";

export interface EditorCallbacks {
  /** `isHistoryTraversal` is true for undo/redo, false for a regular edit —
   * lets the caller tell "back to some earlier state" apart from "changed". */
  onDocChanged: (text: string, isHistoryTraversal: boolean) => void;
  onCursorMoved: (line: number, col: number) => void;
}

export interface EditorHandle {
  getText: () => string;
  setText: (text: string) => void;
  replaceText: (text: string) => void;
  setTheme: (id: string) => void;
  setWrap: (enabled: boolean) => void;
  setCursor: (line: number, col: number) => void;
  detectLanguage: (path: string | null) => Promise<string>;
  setPlainText: () => void;
  setIndentUnit: (unit: string) => void;
  focus: () => void;
}

export const PLAIN_TEXT_LABEL = "Plain text";

// Single font family and size controlled via CSS variables (see styles.css)
const baseTheme = EditorView.theme({
  "&": { height: "100%", fontSize: "var(--editor-font-size, 14px)" },
  ".cm-scroller": { fontFamily: "var(--editor-font, monospace)" },
});

export function createEditor(parent: HTMLElement, callbacks: EditorCallbacks): EditorHandle {
  const themeConfig = new Compartment();
  const languageConfig = new Compartment();
  const wrapConfig = new Compartment();
  const indentConfig = new Compartment();
  let currentTheme: Extension = themeById(DEFAULT_THEME_ID).extension;
  let currentLanguage: Extension = [];
  let currentWrap = false;
  let currentIndentUnit = "  ";
  let languageToken = 0;

  const buildExtensions = (): Extension[] => [
    basicSetup,
    keymap.of([indentWithTab]),
    baseTheme,
    themeConfig.of(currentTheme),
    languageConfig.of(currentLanguage),
    wrapConfig.of(currentWrap ? EditorView.lineWrapping : []),
    indentConfig.of(indentUnit.of(currentIndentUnit)),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const isHistoryTraversal = update.transactions.some(
          (tr) => tr.isUserEvent("undo") || tr.isUserEvent("redo"),
        );
        callbacks.onDocChanged(update.state.doc.toString(), isHistoryTraversal);
      }
      if (update.docChanged || update.selectionSet) {
        const head = update.state.selection.main.head;
        const line = update.state.doc.lineAt(head);
        callbacks.onCursorMoved(line.number, head - line.from + 1);
      }
    }),
  ];

  const view = new EditorView({
    parent,
    state: EditorState.create({ doc: "", extensions: buildExtensions() }),
  });

  const clearLanguage = (): void => {
    currentLanguage = [];
    view.dispatch({ effects: languageConfig.reconfigure(currentLanguage) });
  };

  return {
    getText: () => view.state.doc.toString(),

    setText: (text) => {
      // Fresh state on purpose: discards the previous file's undo history
      view.setState(EditorState.create({ doc: text, extensions: buildExtensions() }));
      callbacks.onCursorMoved(1, 1);
    },

    replaceText: (text) => {
      // Unlike setText, keeps cursor and undo history: meant for reloading
      // the same file after it changed on disk
      const head = view.state.selection.main.head;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: Math.min(head, text.length) },
        scrollIntoView: true,
      });
    },

    setTheme: (id) => {
      currentTheme = themeById(id).extension;
      view.dispatch({ effects: themeConfig.reconfigure(currentTheme) });
    },

    setWrap: (enabled) => {
      currentWrap = enabled;
      view.dispatch({
        effects: wrapConfig.reconfigure(enabled ? EditorView.lineWrapping : []),
      });
    },

    setCursor: (line, col) => {
      const docState = view.state.doc;
      const target = docState.line(Math.max(1, Math.min(line, docState.lines)));
      const pos = Math.min(target.from + Math.max(0, col - 1), target.to);
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    },

    detectLanguage: async (path) => {
      const token = ++languageToken;
      const filename = path === null ? "" : basename(path);
      const description =
        filename === "" ? null : LanguageDescription.matchFilename(languages, filename);

      if (description === null) {
        clearLanguage();
        return PLAIN_TEXT_LABEL;
      }

      const support = await description.load();
      if (token !== languageToken) return description.name;
      currentLanguage = support;
      view.dispatch({ effects: languageConfig.reconfigure(currentLanguage) });
      return description.name;
    },

    // Skips the (async) language package load entirely: used for files too
    // large to make syntax highlighting worth the perf cost. Bumps the
    // token so a still-in-flight detectLanguage() from a previous file
    // can't clobber this afterwards.
    setPlainText: () => {
      languageToken++;
      clearLanguage();
    },

    setIndentUnit: (unit) => {
      currentIndentUnit = unit;
      view.dispatch({ effects: indentConfig.reconfigure(indentUnit.of(currentIndentUnit)) });
    },

    focus: () => view.focus(),
  };
}
