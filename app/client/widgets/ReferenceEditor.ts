import {ACResults, buildHighlightedDom, HighlightFunc} from 'app/client/lib/ACIndex';
import {Autocomplete} from 'app/client/lib/autocomplete';
import {ICellItem} from 'app/client/models/ColumnACIndexes';
import {reportError} from 'app/client/models/errors';
import {TableData} from 'app/client/models/TableData';
import {colors, testId, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {menuCssClass} from 'app/client/ui2018/menus';
import {Options} from 'app/client/widgets/NewBaseEditor';
import {NTextEditor} from 'app/client/widgets/NTextEditor';
import {CellValue} from 'app/common/DocActions';
import {removePrefix, undef} from 'app/common/gutil';
import {BaseFormatter} from 'app/common/ValueFormatter';
import {styled} from 'grainjs';


/**
 * A ReferenceEditor offers an autocomplete of choices from the referenced table.
 */
export class ReferenceEditor extends NTextEditor {
  private _tableData: TableData;
  private _formatter: BaseFormatter;
  private _enableAddNew: boolean;
  private _showAddNew: boolean = false;
  private _visibleCol: string;
  private _autocomplete?: Autocomplete<ICellItem>;

  constructor(options: Options) {
    super(options);

    const field = options.field;

    // Get the table ID to which the reference points.
    const refTableId = removePrefix(field.column().type(), "Ref:");
    if (!refTableId) {
      throw new Error("ReferenceEditor used for non-Reference column");
    }

    const docData = options.gristDoc.docData;
    const tableData = docData.getTable(refTableId);
    if (!tableData) {
      throw new Error("ReferenceEditor: invalid referenced table");
    }
    this._tableData = tableData;

    // Construct the formatter for the displayed values using the options from the target column.
    this._formatter = field.createVisibleColFormatter();

    // Whether we should enable the "Add New" entry to allow adding new items to the target table.
    const vcol = field.visibleColModel();
    this._enableAddNew = vcol && !vcol.isRealFormula();

    this._visibleCol = vcol.colId() || 'id';

    // Decorate the editor to look like a reference column value (with a "link" icon).
    // But not on readonly mode - here we will reuse default decoration
    if (!options.readonly) {
      this.cellEditorDiv.classList.add(cssRefEditor.className);
      this.cellEditorDiv.appendChild(cssRefEditIcon('FieldReference'));
    }

    this.textInput.value = undef(options.state, options.editValue, this._idToText(options.cellValue));

    const needReload = (options.editValue === undefined && !tableData.isLoaded);

    // The referenced table has probably already been fetched (because there must already be a
    // Reference widget instantiated), but it's better to avoid this assumption.
    docData.fetchTable(refTableId).then(() => {
      if (this.isDisposed()) { return; }
      if (needReload && this.textInput.value === '') {
        this.textInput.value = undef(options.state, options.editValue, this._idToText(options.cellValue));
        this.resizeInput();
      }
      if (this._autocomplete) {
        if (options.editValue === undefined) {
          this._autocomplete.search((items) => items.findIndex((item) => item.rowId === options.cellValue));
        } else {
          this._autocomplete.search();
        }
      }
    })
    .catch(reportError);
  }

  public attach(cellElem: Element): void {
    super.attach(cellElem);
    // don't create autocomplete for readonly mode
    if (this.options.readonly) { return; }
    this._autocomplete = this.autoDispose(new Autocomplete<ICellItem>(this.textInput, {
      menuCssClass: menuCssClass + ' ' + cssRefList.className,
      search: this._doSearch.bind(this),
      renderItem: this._renderItem.bind(this),
      getItemText: (item) => item.text,
      onClick: () => this.options.commands.fieldEditSaveHere(),
    }));
  }

  /**
   * If the 'new' item is saved, add it to the referenced table first. See _buildSourceList
   */
  public async prepForSave() {
    const selectedItem = this._autocomplete && this._autocomplete.getSelectedItem();
    if (selectedItem &&
        selectedItem.rowId === 'new' &&
        selectedItem.text === this.textInput.value) {
      const colInfo = {[this._visibleCol]: this.textInput.value};
      selectedItem.rowId = await this._tableData.sendTableAction(["AddRecord", null, colInfo]);
    }
  }

  public getCellValue() {
    const selectedItem = this._autocomplete && this._autocomplete.getSelectedItem();

    if (selectedItem) {
      // Selected from the autocomplete dropdown; so we know the *value* (i.e. rowId).
      return selectedItem.rowId;
    } else if (nocaseEqual(this.textInput.value, this._idToText(this.options.cellValue))) {
      // Unchanged from what's already in the cell.
      return this.options.cellValue;
    }

    // Search for textInput's value, or else use the typed value itself (as alttext).
    if (this.textInput.value === '') {
      return 0;   // This is the default value for a reference column.
    }
    const searchFunc = (value: any) => nocaseEqual(value, this.textInput.value);
    const matches = this._tableData.columnSearch(this._visibleCol, this._formatter, searchFunc, 1);
    if (matches.length > 0) {
      return matches[0].value;
    } else {
      return this.textInput.value;
    }
  }

  private _idToText(value: CellValue) {
    if (typeof value === 'number') {
      return this._formatter.formatAny(this._tableData.getValue(value, this._visibleCol));
    }
    return String(value || '');
  }

  private async _doSearch(text: string): Promise<ACResults<ICellItem>> {
    const acIndex = this._tableData.columnACIndexes.getColACIndex(this._visibleCol, this._formatter);
    const result = acIndex.search(text);
    // If the search text does not match anything exactly, add 'new' item for it. See also prepForSave.
    this._showAddNew = false;
    if (this._enableAddNew && text) {
      const cleanText = text.trim().toLowerCase();
      if (!result.items.find((item) => item.cleanText === cleanText)) {
        result.items.push({rowId: 'new', text, cleanText});
        this._showAddNew = true;
      }
    }
    return result;
  }

  private _renderItem(item: ICellItem, highlightFunc: HighlightFunc) {
    return renderACItem(item.text, highlightFunc, item.rowId === 'new', this._showAddNew);
  }
}

export function renderACItem(text: string, highlightFunc: HighlightFunc, isAddNew: boolean, withSpaceForNew: boolean) {
  if (isAddNew) {
    return cssRefItem(cssRefItem.cls('-new'),
      cssPlusButton(cssPlusIcon('Plus')), text,
      testId('ref-editor-item'), testId('ref-editor-new-item'),
    );
  }
  return cssRefItem(cssRefItem.cls('-with-new', withSpaceForNew),
    buildHighlightedDom(text, highlightFunc, cssMatchText),
    testId('ref-editor-item'),
  );
}

function nocaseEqual(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

const cssRefEditor = styled('div', `
  & > .celleditor_text_editor, & > .celleditor_content_measure {
    padding-left: 18px;
  }
`);

export const cssRefList = styled('div', `
  overflow-y: auto;
  padding: 8px 0 0 0;
  --weaseljs-menu-item-padding: 8px 16px;
`);

// We need to now the height of the sticky "+" element.
const addNewHeight = '37px';

const cssRefItem = styled('li', `
  display: block;
  font-family: ${vars.fontFamily};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  outline: none;
  padding: var(--weaseljs-menu-item-padding, 8px 24px);
  cursor: pointer;

  &.selected {
    background-color: var(--weaseljs-selected-background-color, #5AC09C);
    color:            var(--weaseljs-selected-color, white);
  }
  &-with-new {
    scroll-margin-bottom: ${addNewHeight};
  }
  &-new {
    color: ${colors.slate};
    position: sticky;
    bottom: 0px;
    height: ${addNewHeight};
    background-color: white;
    border-top: 1px solid ${colors.mediumGrey};
    scroll-margin-bottom: initial;
  }
  &-new.selected {
    color: ${colors.lightGrey};
  }
`);

const cssPlusButton = styled('div', `
  display: inline-block;
  width: 20px;
  height: 20px;
  border-radius: 20px;
  margin-right: 8px;
  text-align: center;
  background-color: ${colors.lightGreen};
  color: ${colors.light};

  .selected > & {
    background-color: ${colors.darkGreen};
  }
`);

const cssPlusIcon = styled(icon, `
  background-color: ${colors.light};
`);

const cssRefEditIcon = styled(icon, `
  background-color: ${colors.slate};
  position: absolute;
  top: 0;
  left: 0;
  margin: 3px 3px 0 3px;
`);

const cssMatchText = styled('span', `
  color: ${colors.lightGreen};
  .selected > & {
    color: ${colors.lighterGreen};
  }
`);
