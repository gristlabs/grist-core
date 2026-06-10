import { setupAceEditorCompletions } from "app/client/components/AceEditorCompletions";
import { expandAndFilterSuggestions, ISuggestionWithSubAttrs } from "app/client/lib/Suggestions";
import { theme } from "app/client/ui2018/cssVars";
import { gristThemeObs } from "app/client/ui2018/theme";
import { ISuggestionWithValue } from "app/common/ActiveDocAPI";
import { Theme } from "app/common/ThemePrefs";

import ace, { Ace } from "ace-builds";
import { dom, DomArg, Observable, styled } from "grainjs";
import debounce from "lodash/debounce";

export interface ACLFormulaOptions {
  initialValue: string;
  readOnly: boolean;
  placeholder: DomArg;
  setValue: (value: string) => void;
  getSuggestions: () => ISuggestionWithSubAttrs[];
  customiseEditor?: (editor: Ace.Editor) => void;
}

export function aclFormulaEditor(options: ACLFormulaOptions) {
  // Create an element and an editor within it.
  const editorElem = dom("div");
  const editor: Ace.Editor = ace.edit(editorElem);

  // Set various editor options.
  function setAceTheme(newTheme: Theme) {
    const { appearance } = newTheme;
    const aceTheme = appearance === "dark" ? "dracula" : "chrome";
    editor.setTheme(`ace/theme/${aceTheme}`);
  }
  setAceTheme(gristThemeObs().get());
  const themeListener = gristThemeObs().addListener((newTheme) => {
    setAceTheme(newTheme);
  });
  // With maxLines set, the ACE editor normally resizes automatically, but see the heal()
  // logic below for a case where it gets stuck.
  editor.setOptions({ enableLiveAutocompletion: true, maxLines: 10 });
  editor.renderer.setShowGutter(false);       // Default line numbers to hidden
  editor.renderer.setPadding(5);
  editor.renderer.setScrollMargin(4, 4, 0, 0);
  (editor as any).$blockScrolling = Infinity;
  editor.setReadOnly(options.readOnly);
  editor.setFontSize("12");
  editor.setHighlightActiveLine(false);

  const session = editor.getSession();
  session.setMode("ace/mode/python");
  session.setTabSize(2);
  session.setUseWrapMode(true);

  // Implement placeholder text since the version of ACE we use doesn't support one.
  const showPlaceholder = Observable.create(null, !options.initialValue.length);
  editor.renderer.scroller.appendChild(
    cssAcePlaceholder(dom.show(showPlaceholder), options.placeholder),
  );
  editor.on("change", () => showPlaceholder.set(!editor.getValue().length));

  async function getSuggestions(prefix: string): Promise<ISuggestionWithValue[]> {
    return [
      // The few Python keywords and constants we support.
      "and", "or", "not", "in", "is", "True", "False", "None",
      // Some grist-specific constants:
      "OWNER", "EDITOR", "VIEWER",
      // The common variables.
      "user", "rec", "newRec",
    ]
      .map<ISuggestionWithValue>(suggestion => [suggestion, null])   // null means no example value
      .concat(
      // Other completions that depend on doc schema or other rules.
        expandAndFilterSuggestions(prefix, options.getSuggestions())
          .map<ISuggestionWithValue>(s => [s.value, s.example || null]),
      );
  }

  setupAceEditorCompletions(editor, { getSuggestions });

  // Save on blur.
  editor.on("blur", () => options.setValue(editor.getValue()));

  // Save changes every 1 second
  const save = debounce(() => options.setValue(editor.getValue()), 1000);
  editor.on("change", save);

  // Blur (and save) on Enter key.
  editor.commands.addCommand({
    name: "onEnter",
    bindKey: { win: "Enter", mac: "Enter" },
    exec: () => editor.blur(),
  });
  // Disable Tab/Shift+Tab commands to restore their regular behavior.
  (editor.commands as any).removeCommands(["indent", "outdent"]);

  // Set the editor's initial value.
  editor.setValue(options.initialValue);

  if (options.customiseEditor) {
    options.customiseEditor(editor);
  }

  // The editor is created while editorElem is detached, so ACE's initial render bails out and
  // parks its pending changes with nothing left scheduled to flush them. With maxLines set, ACE
  // controls the element's height itself, so the editor can get stuck at zero height with its
  // content invisible and effectively uneditable (in Firefox this happens reliably at <100%
  // browser zoom; see #2082). Watch for the element getting laid out and heal it then.
  let healTimer: ReturnType<typeof setTimeout> | undefined;
  const heal = () => {
    healTimer = undefined;
    if (editorElem.clientWidth === 0 || editorElem.clientHeight > 0) {
      return;
    }
    const renderer = editor.renderer as any;
    if (renderer.lineHeight > 1) {
      // Escape ACE's zero-height trap: with a zero cached height, $renderChanges detours to
      // onResize(), which ignores a zero measured height and bails out before rendering, so no
      // number of resize()/updateFull() calls can recover. $autosize() sets the container
      // height directly and refreshes the cached size; the forced updateFull() then repaints
      // the text layers.
      renderer.$autosize();
      renderer.updateFull(true);
    }
    if (editorElem.clientHeight === 0) {
      // ACE's font metrics may not be measured yet (lineHeight <= 1); try again shortly.
      healTimer = setTimeout(heal, 50);
    }
  };
  const resizeObserver = new ResizeObserver(heal);
  resizeObserver.observe(editorElem);

  return cssConditionInputAce(
    dom.autoDispose(themeListener ?? null),
    dom.onDispose(() => { resizeObserver.disconnect(); if (healTimer) { clearTimeout(healTimer); } }),
    cssConditionInputAce.cls("-disabled", options.readOnly),
    // ACE editor calls preventDefault on clicks into the scrollbar area, which prevents focus
    // being set when the click happens to be into there. To ensure we can focus on such clicks
    // anyway, listen to the mousedown event in the capture phase.
    dom.on("mousedown", () => { editor.focus(); }, { useCapture: true }),
    dom.onDispose(() => editor.destroy()),
    dom.onDispose(() => save.cancel()),
    editorElem,
  );
}

const cssConditionInputAce = styled("div", `
  width: 100%;
  min-height: 28px;
  padding: 1px;
  border-radius: 3px;
  border: 1px solid transparent;
  cursor: pointer;

  &:hover {
    border: 1px solid ${theme.accessRulesFormulaEditorBorderHover};
  }
  &:not(&-disabled):focus-within {
    box-shadow: inset 0 0 0 1px ${theme.accessRulesFormulaEditorFocus};
    border-color: ${theme.accessRulesFormulaEditorFocus};
  }
  &:not(:focus-within) .ace_scroller, &-disabled .ace_scroller {
    cursor: unset;
  }
  &-disabled, &-disabled:hover {
    background-color: ${theme.accessRulesFormulaEditorBgDisabled};
    box-shadow: unset;
    border-color: transparent;
  }
  & .ace-chrome, & .ace-dracula {
    background-color: ${theme.accessRulesFormulaEditorBg};
  }
  &:not(:focus-within) .ace_print-margin {
    width: 0px;
  }
  &-disabled .ace-chrome, &-disabled .ace-dracula {
    background-color: ${theme.accessRulesFormulaEditorBgDisabled};
  }
  & .ace_marker-layer, & .ace_cursor-layer {
    display: none;
  }
  &:not(&-disabled) .ace_focus .ace_marker-layer, &:not(&-disabled) .ace_focus .ace_cursor-layer {
    display: block;
  }
`);

const cssAcePlaceholder = styled("div", `
  padding: 4px 5px;
  opacity: 0.5;
`);
