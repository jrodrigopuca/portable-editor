import { indentWithTab } from "@codemirror/commands";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { DEFAULT_THEME_ID, themeById } from "./themes";

export interface EditorCallbacks {
  onDocChanged: () => void;
  onCursorMoved: (line: number, col: number) => void;
}

export interface EditorHandle {
  getText: () => string;
  setText: (text: string) => void;
  setTheme: (id: string) => void;
  detectLanguage: (path: string | null) => Promise<string>;
  focus: () => void;
}

export const PLAIN_TEXT_LABEL = "Texto plano";

// Fuente única y tamaño controlados por variables CSS (ver styles.css)
const baseTheme = EditorView.theme({
  "&": { height: "100%", fontSize: "var(--editor-font-size, 14px)" },
  ".cm-scroller": { fontFamily: "var(--editor-font, monospace)" },
});

export function createEditor(parent: HTMLElement, callbacks: EditorCallbacks): EditorHandle {
  const themeConfig = new Compartment();
  const languageConfig = new Compartment();
  let currentTheme: Extension = themeById(DEFAULT_THEME_ID).extension;
  let currentLanguage: Extension = [];
  let languageToken = 0;

  const buildExtensions = (): Extension[] => [
    basicSetup,
    keymap.of([indentWithTab]),
    baseTheme,
    themeConfig.of(currentTheme),
    languageConfig.of(currentLanguage),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) callbacks.onDocChanged();
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

  return {
    getText: () => view.state.doc.toString(),

    setText: (text) => {
      // Estado nuevo a propósito: descarta el historial de undo del archivo anterior
      view.setState(EditorState.create({ doc: text, extensions: buildExtensions() }));
      callbacks.onCursorMoved(1, 1);
    },

    setTheme: (id) => {
      currentTheme = themeById(id).extension;
      view.dispatch({ effects: themeConfig.reconfigure(currentTheme) });
    },

    detectLanguage: async (path) => {
      const token = ++languageToken;
      const filename = path?.split("/").pop() ?? "";
      const description =
        filename === "" ? null : LanguageDescription.matchFilename(languages, filename);

      if (description === null) {
        currentLanguage = [];
        view.dispatch({ effects: languageConfig.reconfigure(currentLanguage) });
        return PLAIN_TEXT_LABEL;
      }

      const support = await description.load();
      if (token !== languageToken) return description.name;
      currentLanguage = support;
      view.dispatch({ effects: languageConfig.reconfigure(currentLanguage) });
      return description.name;
    },

    focus: () => view.focus(),
  };
}
