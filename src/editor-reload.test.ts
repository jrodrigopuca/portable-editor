import { history, redo, undo } from "@codemirror/commands";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { RELOAD_USER_EVENT, reloadTransaction } from "./editor";

// Pins the CodeMirror semantics main.ts relies on after a reload from disk:
// the change is in history (undo is the escape hatch), it carries the tag
// the update listener uses to stay quiet, and the cursor survives clamped.
// `undo`/`redo` are commands: they take a view-like { state, dispatch }.

function stateWith(text: string, cursor: number): EditorState {
  return EditorState.create({
    doc: text,
    selection: EditorSelection.cursor(cursor),
    extensions: [history()],
  });
}

function apply(state: EditorState, command: typeof undo): EditorState {
  let next = state;
  command({ state, dispatch: (tr) => (next = tr.state) });
  return next;
}

describe("reloadTransaction", () => {
  it("is tagged as a reload and swaps the whole buffer", () => {
    const state = stateWith("old text", 3);
    const tr = state.update(reloadTransaction(state, "new"));
    expect(tr.isUserEvent(RELOAD_USER_EVENT)).toBe(true);
    expect(tr.state.doc.toString()).toBe("new");
  });

  it("clamps the cursor to the new length instead of throwing", () => {
    const state = stateWith("a long line", 9);
    const next = state.update(reloadTransaction(state, "ab")).state;
    expect(next.selection.main.head).toBe(2);
  });

  it("undo after a reload restores the pre-reload text; redo brings the disk text back", () => {
    const state = stateWith("before", 2);
    const reloaded = state.update(reloadTransaction(state, "after")).state;
    const undone = apply(reloaded, undo);
    expect(undone.doc.toString()).toBe("before");
    expect(apply(undone, redo).doc.toString()).toBe("after");
  });
});
