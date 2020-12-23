import {setupAceEditorCompletions} from 'app/client/components/AceEditorCompletions';
import {colors} from 'app/client/ui2018/cssVars';
import * as ace from 'brace';
import {dom, DomArg, Observable, styled} from 'grainjs';

export interface ACLFormulaOptions {
  initialValue: string;
  readOnly: boolean;
  placeholder: DomArg;
  setValue: (value: string) => void;
  getSuggestions: (prefix: string) => string[];
}

export function aclFormulaEditor(options: ACLFormulaOptions) {
  // Create an element and an editor within it.
  const editorElem = dom('div');
  const editor: ace.Editor = ace.edit(editorElem);

  // Set various editor options.
  editor.setTheme('ace/theme/chrome');
  editor.setOptions({enableLiveAutocompletion: true});
  editor.renderer.setShowGutter(false);       // Default line numbers to hidden
  editor.renderer.setPadding(0);
  editor.$blockScrolling = Infinity;
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

  async function getSuggestions(prefix: string) {
    return [
      // The few Python keywords and constants we support.
      'and', 'or', 'not', 'in', 'is', 'True', 'False', 'None',
      // The common variables.
      'user', 'rec',
      // Other completions that depend on doc schema or other rules.
      ...options.getSuggestions(prefix),
    ];
  }
  setupAceEditorCompletions(editor, {getSuggestions});

  // Save on blur.
  editor.on("blur", () => options.setValue(editor.getValue()));

  // Blur (and save) on Enter key.
  editor.commands.addCommand({
    name: 'onEnter',
    bindKey: {win: 'Enter', mac: 'Enter'},
    exec: () => editor.blur(),
  });
  // Disable Tab/Shift+Tab commands to restore their regular behavior.
  (editor.commands as any).removeCommands(['indent', 'outdent']);

  function resize() {
    if (editor.renderer.lineHeight === 0) {
      // Reschedule the resize, since it's not ready yet. Seems to happen occasionally.
      setTimeout(resize, 50);
    }
    editorElem.style.width = 'auto';
    editorElem.style.height = (Math.max(1, session.getScreenLength()) * editor.renderer.lineHeight) + 'px';
    editor.resize();
  }

  // Set the editor's initial value.
  editor.setValue(options.initialValue);

  // Resize the editor on change, and initially once it's attached to the page.
  editor.on('change', resize);
  setTimeout(resize, 0);

  return cssConditionInputAce(
    cssConditionInputAce.cls('-disabled', options.readOnly),
    dom.onDispose(() => editor.destroy()),
    editorElem,
  );
}

const cssConditionInputAce = styled('div', `
  width: 100%;
  min-height: 28px;
  padding: 5px 6px 5px 6px;
  border-radius: 3px;
  border: 1px solid transparent;
  cursor: pointer;

  &:hover {
    border: 1px solid ${colors.darkGrey};
  }
  &:not(&-disabled):focus-within {
    box-shadow: inset 0 0 0 1px ${colors.cursor};
    border-color: ${colors.cursor};
  }
  &:not(:focus-within) .ace_scroller, &-disabled .ace_scroller {
    cursor: unset;
  }
  &-disabled, &-disabled:hover {
    background-color: ${colors.mediumGreyOpaque};
    box-shadow: unset;
    border-color: transparent;
  }
  &-disabled .ace-chrome {
    background-color: ${colors.mediumGreyOpaque};
  }
  & .ace_marker-layer, & .ace_cursor-layer {
    display: none;
  }
  &:not(&-disabled) .ace_focus .ace_marker-layer, &:not(&-disabled) .ace_focus .ace_cursor-layer {
    display: block;
  }
`);

const cssAcePlaceholder = styled('div', `
  opacity: 0.5;
`);
