import ace, {Ace} from 'ace-builds';
import {setupAceEditorCompletions} from 'app/client/components/AceEditorCompletions';
import {theme} from 'app/client/ui2018/cssVars';
import {Theme} from 'app/common/ThemePrefs';
import {getGristConfig} from 'app/common/urlUtils';
import {Computed, dom, DomArg, Listener, Observable, styled} from 'grainjs';
import debounce from 'lodash/debounce';

export interface ACLFormulaOptions {
  gristTheme: Computed<Theme>;
  initialValue: string;
  readOnly: boolean;
  placeholder: DomArg;
  setValue: (value: string) => void;
  getSuggestions: (prefix: string) => string[];
  customiseEditor?: (editor: Ace.Editor) => void;
}

export function aclFormulaEditor(options: ACLFormulaOptions) {
  // Create an element and an editor within it.
  const editorElem = dom('div');
  const editor: Ace.Editor = ace.edit(editorElem);

  // Set various editor options.
  function setAceTheme(gristTheme: Theme) {
    const {enableCustomCss} = getGristConfig();
    const gristAppearance = gristTheme.appearance;
    const aceTheme = gristAppearance === 'dark' && !enableCustomCss ? 'dracula' : 'chrome';
    editor.setTheme(`ace/theme/${aceTheme}`);
  }
  setAceTheme(options.gristTheme.get());
  let themeListener: Listener | undefined;
  if (!getGristConfig().enableCustomCss) {
    themeListener = options.gristTheme.addListener((gristTheme) => {
      setAceTheme(gristTheme);
    });
  }
  // ACE editor resizes automatically when maxLines is set.
  editor.setOptions({enableLiveAutocompletion: true, maxLines: 10});
  editor.renderer.setShowGutter(false);       // Default line numbers to hidden
  editor.renderer.setPadding(5);
  editor.renderer.setScrollMargin(4, 4, 0, 0);
  (editor as any).$blockScrolling = Infinity;
  editor.setReadOnly(options.readOnly);
  editor.setFontSize('12');
  editor.setHighlightActiveLine(false);

  const session = editor.getSession();
  session.setMode('ace/mode/python');
  session.setTabSize(2);
  session.setUseWrapMode(false);

  // Implement placeholder text since the version of ACE we use doesn't support one.
  const showPlaceholder = Observable.create(null, !options.initialValue.length);
  editor.renderer.scroller.appendChild(
    cssAcePlaceholder(dom.show(showPlaceholder), options.placeholder)
  );
  editor.on("change", () => showPlaceholder.set(!editor.getValue().length));

  async function getSuggestions(prefix: string): Promise<Array<[string, null]>> {
    return [
      // The few Python keywords and constants we support.
      'and', 'or', 'not', 'in', 'is', 'True', 'False', 'None',
      // Some grist-specific constants:
      'OWNER', 'EDITOR', 'VIEWER',
      // The common variables.
      'user', 'rec', 'newRec',
      // Other completions that depend on doc schema or other rules.
      ...options.getSuggestions(prefix),
    ].map(suggestion => [suggestion, null]);  // null means no example value
  }
  setupAceEditorCompletions(editor, {getSuggestions});

  // Save on blur.
  editor.on("blur", () => options.setValue(editor.getValue()));

  // Save changes every 1 second
  const save = debounce(() => options.setValue(editor.getValue()), 1000);
  editor.on("change", save);

  // Blur (and save) on Enter key.
  editor.commands.addCommand({
    name: 'onEnter',
    bindKey: {win: 'Enter', mac: 'Enter'},
    exec: () => editor.blur(),
  });
  // Disable Tab/Shift+Tab commands to restore their regular behavior.
  (editor.commands as any).removeCommands(['indent', 'outdent']);

  // Set the editor's initial value.
  editor.setValue(options.initialValue);

  if (options.customiseEditor) {
    options.customiseEditor(editor);
  }

  return cssConditionInputAce(
    dom.autoDispose(themeListener ?? null),
    cssConditionInputAce.cls('-disabled', options.readOnly),
    // ACE editor calls preventDefault on clicks into the scrollbar area, which prevents focus
    // being set when the click happens to be into there. To ensure we can focus on such clicks
    // anyway, listen to the mousedown event in the capture phase.
    dom.on('mousedown', () => { editor.focus(); }, {useCapture: true}),
    dom.onDispose(() => editor.destroy()),
    dom.onDispose(() => save.cancel()),
    editorElem,
  );
}

const cssConditionInputAce = styled('div', `
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

const cssAcePlaceholder = styled('div', `
  padding: 4px 5px;
  opacity: 0.5;
`);
