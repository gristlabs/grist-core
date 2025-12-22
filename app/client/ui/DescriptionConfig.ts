import {makeT} from 'app/client/lib/localization';
import {KoSaveableObservable} from 'app/client/models/modelUtil';
import {autoGrow} from 'app/client/ui/forms';
import {textarea, textInput} from 'app/client/ui/inputs';
import {cssLabel, cssRow} from 'app/client/ui/RightPanelStyles';
import {textButton} from 'app/client/ui2018/buttons';
import {testId, theme} from 'app/client/ui2018/cssVars';
import {tokens} from 'app/common/ThemePrefs';
import {CursorPos} from 'app/plugin/GristAPI';
import {dom, DomArg, fromKo, MultiHolder, Observable, styled} from 'grainjs';

const t = makeT('DescriptionConfig');

export function buildDescriptionConfig(
  owner: MultiHolder,
  description: KoSaveableObservable<string>,
  options: {
    cursor: ko.Computed<CursorPos>,
    testPrefix: string,
  },
) {

  // We will listen to cursor position and force a blur event on
  // the text input, which will trigger save before the column observable
  // will change its value.
  // Otherwise, blur will be invoked after column change and save handler will
  // update a different column.
  let editor: HTMLTextAreaElement | undefined;
  owner.autoDispose(
    options.cursor.subscribe(() => {
      editor?.blur();
    }),
  );

  let preview: HTMLDivElement | undefined;
  const editing = Observable.create(owner, false);

  async function save(value: string) {
    value = value.trim();
    if (value !== description.peek()) {
      await description.setAndSaveOrRevert(value);
    }
    closeEditor();
  }
  function closeEditor() {
    if (editor === document.activeElement) {
      // If the editor was focused, keep preview focused now, so as to maintain the tab position.
      setTimeout(() => { preview?.focus(); }, 0);
    }
    // Restore editor value, to avoid a "save" attempt if this triggers the 'blur' event.
    if (editor) {
      editor.value = description.peek();
    }
    editing.set(false);
  }
  function openEditor() {
    editing.set(true);
    setTimeout(() => { editor?.focus(); editor?.select(); }, 0);
  }

  return dom.domComputed(editing, (isEditing) => {
    editor = preview = undefined;
    if (isEditing) {
      const rows = String(description.peek().split('\n').length);
      return [
        cssLabel(t("DESCRIPTION"), {for: `${options.testPrefix}-description-input`}),
        cssRow(
          editor = cssTextArea(fromKo(description), { onInput: false, save },
            {rows, placeholder: "Enter description", id: `${options.testPrefix}-description-input`},
            dom.onKeyDown({
              Enter$: (ev, elem) => { if (!ev.shiftKey) { return save(elem.value); } },
              Escape: closeEditor,
            }),
            dom.on('blur', (ev, elem) => save(elem.value)),
            testId(`${options.testPrefix}-description`),
            autoGrow(fromKo(description)),
          ),
        ),
      ];
    }
    else {
      return dom.domComputed(use => Boolean(use(description)), (haveDescription) => {
        preview = undefined;
        if (haveDescription) {
          return [
            cssLabel(t("DESCRIPTION"), {for: `${options.testPrefix}-description-preview`}),
            cssRow(
              preview = cssPreview(
                cssTextInput.cls(''),
                dom.text(description),
                {tabIndex: '0', id: `${options.testPrefix}-description-preview`},
                dom.onKeyDown({Enter: openEditor}),
                dom.on("click", openEditor),
                testId('description-preview'),
              ),
            ),
          ];
        }
        else {
          return cssRow(cssTextButton(
            t("Set description"),
            dom.on("click", openEditor),
            testId('description-add'),
          ),
          );
        }
      });
    }
  });
}

/**
 * A generic version of buildDescriptionConfig that can be used for any text input.
 */
export function buildTextInput(
  owner: MultiHolder,
  options: {
    label: string,
    value: KoSaveableObservable<any>,
    cursor?: ko.Computed<CursorPos>,
    placeholder?: ko.Computed<string>,
  },
  ...args: DomArg[]
) {
  if (options.cursor) {
    owner.autoDispose(
      options.cursor.subscribe(() => {
        options.value.save().catch(reportError);
      }),
    );
  }
  return [
    cssLabel(options.label),
    cssRow(
      cssTextInput(fromKo(options.value),
        dom.on('blur', () => {
          return options.value.save();
        }),
        dom.prop('placeholder', options.placeholder || ''),
        ...args,
      ),
    ),
  ];
}

const cssTextInput = styled(textInput, `
  color: ${theme.inputFg};
  background-color: ${theme.mainPanelBg};
  border: 1px solid ${theme.inputBorder};
  width: 100%;
  outline: none;
  height: 28px;
  border-radius: 3px;
  padding: 0px 6px;
  &::placeholder {
    color: ${theme.inputPlaceholderFg};
  }

  &[readonly] {
    background-color: ${theme.inputDisabledBg};
    color: ${theme.inputDisabledFg};
  }
`);

const cssTextArea = styled(textarea, `
  color: ${theme.inputFg};
  background-color: ${theme.mainPanelBg};
  border: 1px solid ${theme.inputBorder};
  width: 100%;
  outline: none;
  border-radius: 3px;
  padding: 3px 7px;
  min-height: calc(3em * 1.5);
  resize: none;

  &::placeholder {
    color: ${theme.inputPlaceholderFg};
  }

  &[readonly] {
    background-color: ${theme.inputDisabledBg};
    color: ${theme.inputDisabledFg};
  }
`);

const cssTextButton = styled(textButton, `
  margin-top: 8px;
`);

const cssPreview = styled('div', `
  background-color: ${tokens.bgTertiary};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  line-height: 2;
  &:focus {
    box-shadow: 0px 0px 2px 2px ${theme.inputFocus};
  }
`);
