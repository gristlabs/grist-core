import {t} from 'app/client/lib/localization';
import {GristDoc} from 'app/client/components/GristDoc';
import {cssInput} from 'app/client/ui/cssInput';
import {cssField} from 'app/client/ui/MakeCopyMenu';
import {labeledSquareCheckbox} from 'app/client/ui2018/checkbox';
import {colors} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {cssLink} from 'app/client/ui2018/links';
import {saveModal} from 'app/client/ui2018/modals';
import {commonUrls} from 'app/common/gristUrls';
import {Computed, Disposable, dom, input, makeTestId, Observable, styled} from 'grainjs';

const translate = (x: string, args?: any): string => t(`DuplicateTable.${x}`, args);

const testId = makeTestId('test-duplicate-table-');

/**
 * Response returned by a DuplicateTable user action.
 */
export interface DuplicateTableResponse {
  /** Row id of the new table. */
  id: number;
  /** Table id of the new table. */
  table_id: string;
  /** Row id of the new raw view section. */
  raw_section_id: number;
}

export interface DuplicateTableOptions {
  onSuccess?(response: DuplicateTableResponse): void;
}

/**
 * Shows a modal with options for duplicating the table `tableId`.
 */
export function duplicateTable(
  gristDoc: GristDoc,
  tableId: string,
  {onSuccess}: DuplicateTableOptions = {}
) {
  saveModal((_ctl, owner) => {
    const duplicateTableModal = DuplicateTableModal.create(owner, gristDoc, tableId);
    return {
      title: 'Duplicate Table',
      body: duplicateTableModal.buildDom(),
      saveFunc: async () =>  {
        const response = await duplicateTableModal.save();
        onSuccess?.(response);
      },
      saveDisabled: duplicateTableModal.saveDisabled,
      width: 'normal',
    };
  });
}

class DuplicateTableModal extends Disposable {
  private _newTableName = Observable.create<string>(this, '');
  private _includeData = Observable.create<boolean>(this, false);
  private _saveDisabled = Computed.create(this, this._newTableName, (_use, name) => !name.trim());

  constructor(private _gristDoc: GristDoc, private _tableId: string) {
    super();
  }

  public get saveDisabled() { return this._saveDisabled; }

  public save() {
    return this._duplicateTable();
  }

  public buildDom() {
    return [
      cssField(
        input(
          this._newTableName,
          {onInput: true},
          {placeholder: translate('NewName')},
          (elem) => { setTimeout(() => { elem.focus(); }, 20); },
          dom.on('focus', (_ev, elem) => { elem.select(); }),
          dom.cls(cssInput.className),
          testId('name'),
        ),
      ),
      cssWarning(
        cssWarningIcon('Warning'),

        dom('div',
         translate("AdviceWithLink", {link: cssLink({href: commonUrls.helpLinkingWidgets, target: '_blank'}, 'Read More.')})
        ), //TODO: i18next
      ),
      cssField(
        cssCheckbox(
          this._includeData,
          translate('CopyAllData'),
          testId('copy-all-data'),
        ),
      ),
      dom.maybe(this._includeData, () => cssWarning(
        cssWarningIcon('Warning'),
        dom('div', translate('WarningACL')),
        testId('acl-warning'),
      )),
    ];
  }

  private _duplicateTable() {
    const {docData} = this._gristDoc;
    const [newTableName, includeData] = [this._newTableName.get(), this._includeData.get()];
    return docData.sendAction(['DuplicateTable', this._tableId, newTableName, includeData]);
  }
}

const cssCheckbox = styled(labeledSquareCheckbox, `
  margin-top: 8px;
`);

const cssWarning = styled('div', `
  display: flex;
  column-gap: 8px;
`);

const cssWarningIcon = styled(icon, `
  --icon-color: ${colors.orange};
  flex-shrink: 0;
`);
