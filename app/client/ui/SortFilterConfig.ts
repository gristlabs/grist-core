import {GristDoc} from 'app/client/components/GristDoc';
import {makeT} from 'app/client/lib/localization';
import {ViewSectionRec} from 'app/client/models/DocModel';
import {FilterConfig} from 'app/client/ui/FilterConfig';
import {cssLabel, cssSaveButtonsRow} from 'app/client/ui/RightPanelStyles';
import {SortConfig} from 'app/client/ui/SortConfig';
import {basicButton, primaryButton} from 'app/client/ui2018/buttons';
import {Computed, Disposable, dom, makeTestId, styled} from 'grainjs';

const testId = makeTestId('test-sort-filter-config-');

const t = makeT('SortFilterConfig');

export class SortFilterConfig extends Disposable {
  private _docModel = this._gristDoc.docModel;
  private _isReadonly = this._gristDoc.isReadonly;

  private _hasChanges: Computed<boolean> = Computed.create(this, (use) => (
    use(this._section.filterSpecChanged) || !use(this._section.activeSortJson.isSaved)
  ));

  constructor(private _section: ViewSectionRec, private _gristDoc: GristDoc) {
    super();
  }

  public buildDom() {
    return [
      cssLabel(t('Sort')),
      dom.create(SortConfig, this._section, this._gristDoc, {
        menuOptions: {attach: 'body'},
      }),
      cssLabel(t('Filter')),
      dom.create(FilterConfig, this._section, {
        menuOptions: {attach: 'body'},
      }),
      dom.maybe(this._hasChanges, () => [
        cssSaveButtonsRow(
          cssSaveButton(t('Save'),
            dom.on('click', () => this._save()),
            dom.boolAttr('disabled', this._isReadonly),
            testId('save'),
          ),
          basicButton(t('Revert'),
            dom.on('click', () => this._revert()),
            testId('revert'),
          ),
          testId('save-btns'),
        ),
      ]),
    ];
  }

  private async _save() {
    await this._docModel.docData.bundleActions(t('Update Sort & Filter settings'), () => Promise.all([
      this._section.activeSortJson.save(),
      this._section.saveFilters(),
    ]));
  }

  private _revert() {
    this._section.activeSortJson.revert();
    this._section.revertFilters();
  }
}

const cssSaveButton = styled(primaryButton, `
  margin-right: 8px;
`);
