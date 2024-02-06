import {makeT} from 'app/client/lib/localization';
import {KoSaveableObservable} from 'app/client/models/modelUtil';
import {autoGrow} from 'app/client/ui/forms';
import {textarea, textInput} from 'app/client/ui/inputs';
import {cssLabel, cssRow} from 'app/client/ui/RightPanelStyles';
import {testId, theme} from 'app/client/ui2018/cssVars';
import {CursorPos} from 'app/plugin/GristAPI';
import {dom, DomArg, fromKo, MultiHolder, styled} from 'grainjs';

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
    })
  );

  return [
    cssLabel(t("DESCRIPTION")),
    cssRow(
      editor = cssTextArea(fromKo(description),
        { onInput: false },
        { rows: '3' },
        dom.on('blur', async (e, elem) => {
          await description.saveOnly(elem.value);
        }),
        testId(`${options.testPrefix}-description`),
        autoGrow(fromKo(description))
      )
    ),
  ];
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
      })
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
        ...args
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
