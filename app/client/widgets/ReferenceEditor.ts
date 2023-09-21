import { ACResults, buildHighlightedDom, HighlightFunc, normalizeText } from 'app/client/lib/ACIndex';
import { Autocomplete } from 'app/client/lib/autocomplete';
import { ICellItem } from 'app/client/models/ColumnACIndexes';
import { reportError } from 'app/client/models/errors';
import { testId, theme, vars } from 'app/client/ui2018/cssVars';
import { icon } from 'app/client/ui2018/icons';
import { menuCssClass } from 'app/client/ui2018/menus';
import { FieldOptions } from 'app/client/widgets/NewBaseEditor';
import { NTextEditor } from 'app/client/widgets/NTextEditor';
import { nocaseEqual, ReferenceUtils } from 'app/client/lib/ReferenceUtils';
import { undef } from 'app/common/gutil';
import { styled } from 'grainjs';


/**
 * A ReferenceEditor offers an autocomplete of choices from the referenced table.
 */
export class ReferenceEditor extends NTextEditor {
  private _enableAddNew: boolean;
  private _showAddNew: boolean = false;
  private _autocomplete?: Autocomplete<ICellItem>;
  private _utils: ReferenceUtils;

  constructor(options: FieldOptions) {
    super(options);

    const docData = options.gristDoc.docData;
    this._utils = new ReferenceUtils(options.field, docData);

    const vcol = this._utils.visibleColModel;
    this._enableAddNew = vcol && !vcol.isRealFormula() && !!vcol.colId();

    // Decorate the editor to look like a reference column value (with a "link" icon).
    // But not on readonly mode - here we will reuse default decoration
    if (!options.readonly) {
      this.cellEditorDiv.classList.add(cssRefEditor.className);
      this.cellEditorDiv.appendChild(cssRefEditIcon('FieldReference'));
    }

    this.textInput.value = undef(options.state, options.editValue, this._idToText());

    const needReload = (options.editValue === undefined && !this._utils.tableData.isLoaded);

    // The referenced table has probably already been fetched (because there must already be a
    // Reference widget instantiated), but it's better to avoid this assumption.
    docData.fetchTable(this._utils.refTableId).then(() => {
      if (this.isDisposed()) { return; }
      if (needReload && this.textInput.value === '') {
        this.textInput.value = undef(options.state, options.editValue, this._idToText());
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
      const colInfo = {[this._utils.visibleColId]: this.textInput.value};
      selectedItem.rowId = await this._utils.tableData.sendTableAction(["AddRecord", null, colInfo]);
    }
  }

  public getCellValue() {
    const selectedItem = this._autocomplete && this._autocomplete.getSelectedItem();

    if (selectedItem) {
      // Selected from the autocomplete dropdown; so we know the *value* (i.e. rowId).
      return selectedItem.rowId;
    } else if (nocaseEqual(this.textInput.value, this._idToText())) {
      // Unchanged from what's already in the cell.
      return this.options.cellValue;
    }

    return super.getCellValue();
  }

  private _idToText() {
    return this._utils.idToText(this.options.cellValue);
  }

  /**
   * If the search text does not match anything exactly, adds 'new' item to it.
   *
   * Also see: prepForSave.
   */
  private async _doSearch(text: string): Promise<ACResults<ICellItem>> {
    const result = this._utils.autocompleteSearch(text);

    this._showAddNew = false;
    if (!this._enableAddNew || !text) { return result; }

    const cleanText = normalizeText(text);
    if (result.items.find((item) => item.cleanText === cleanText)) {
      return result;
    }

    result.items.push({rowId: 'new', text, cleanText});
    this._showAddNew = true;

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


const cssRefEditor = styled('div', `
  & > .celleditor_text_editor, & > .celleditor_content_measure {
    padding-left: 18px;
  }
`);

// Set z-index to be higher than the 1000 set for .cell_editor.
export const cssRefList = styled('div', `
  z-index: 1001;
  overflow-y: auto;
  padding: 8px 0 0 0;
  --weaseljs-menu-item-padding: 8px 16px;
`);

// We need to now the height of the sticky "+" element.
const addNewHeight = '37px';

const cssRefItem = styled('li', `
  display: block;
  font-family: ${vars.fontFamily};
  white-space: pre;
  overflow: hidden;
  text-overflow: ellipsis;
  outline: none;
  padding: var(--weaseljs-menu-item-padding, 8px 24px);
  cursor: pointer;
  color: ${theme.menuItemFg};

  &.selected {
    background-color: ${theme.menuItemSelectedBg};
    color:            ${theme.menuItemSelectedFg};
  }
  &-with-new {
    scroll-margin-bottom: ${addNewHeight};
  }
  &-new {
    display: flex;
    align-items: center;
    color: ${theme.lightText};
    position: sticky;
    bottom: 0px;
    height: ${addNewHeight};
    background-color: ${theme.menuBg};
    border-top: 1px solid ${theme.menuBorder};
    scroll-margin-bottom: initial;
  }
  &-new.selected {
    color: ${theme.menuItemSelectedFg};
  }
`);

export const cssPlusButton = styled('div', `
  display: flex;
  width: 20px;
  height: 20px;
  border-radius: 20px;
  margin-right: 8px;
  align-items: center;
  justify-content: center;
  background-color: ${theme.autocompleteAddNewCircleBg};
  color: ${theme.autocompleteAddNewCircleFg};

  .selected > & {
    background-color: ${theme.autocompleteAddNewCircleSelectedBg};
  }
`);

export const cssPlusIcon = styled(icon, `
  background-color: ${theme.autocompleteAddNewCircleFg};
`);

const cssRefEditIcon = styled(icon, `
  background-color: ${theme.lightText};
  position: absolute;
  top: 0;
  left: 0;
  margin: 3px 3px 0 3px;
`);

const cssMatchText = styled('span', `
  color: ${theme.autocompleteMatchText};
  .selected > & {
    color: ${theme.autocompleteSelectedMatchText};
  }
`);
