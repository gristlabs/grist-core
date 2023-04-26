import {CursorPos} from 'app/client/components/Cursor';
import {makeT} from 'app/client/lib/localization';
import {ColumnRec} from 'app/client/models/DocModel';
import {autoGrow} from 'app/client/ui/forms';
import {textarea} from 'app/client/ui/inputs';
import {cssLabel, cssRow} from 'app/client/ui/RightPanelStyles';
import {testId, theme} from 'app/client/ui2018/cssVars';
import {dom, fromKo, MultiHolder, styled} from 'grainjs';

const t = makeT('FieldConfig');

export function buildDescriptionConfig(
    owner: MultiHolder,
    origColumn: ColumnRec,
    cursor: ko.Computed<CursorPos>,
  ) {

    // We will listen to cursor position and force a blur event on
    // the text input, which will trigger save before the column observable
    // will change its value.
    // Otherwise, blur will be invoked after column change and save handler will
    // update a different column.
    let editor: HTMLTextAreaElement | undefined;
    owner.autoDispose(
      cursor.subscribe(() => {
        editor?.blur();
      })
    );

    return [
      cssLabel(t("DESCRIPTION")),
      cssRow(
        editor = cssTextArea(fromKo(origColumn.description),
          { onInput: false },
          { rows: '3' },
          dom.on('blur', async (e, elem) => {
            await origColumn.description.setAndSave(elem.value.trim());
          }),
          testId('column-description'),
          autoGrow(fromKo(origColumn.description))
        )
      ),
    ];
  }

const cssTextArea = styled(textarea, `
  color: ${theme.inputFg};
  background-color: ${theme.mainPanelBg};
  border: 1px solid ${theme.inputBorder};
  width: 100%;
  outline: none;
  border-radius: 3px;
  padding: 3px 7px;
  min-height: calc(3em * 1.5);

  &::placeholder {
    color: ${theme.inputPlaceholderFg};
  }

  &[readonly] {
    background-color: ${theme.inputDisabledBg};
    color: ${theme.inputDisabledFg};
  }
`);
