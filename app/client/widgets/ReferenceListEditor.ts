import { createGroup } from 'app/client/components/commands';
import { ACItem, ACResults, HighlightFunc, normalizeText } from 'app/client/lib/ACIndex';
import { IAutocompleteOptions } from 'app/client/lib/autocomplete';
import { IToken, TokenField, tokenFieldStyles } from 'app/client/lib/TokenField';
import { reportError } from 'app/client/models/errors';
import { colors, testId, theme } from 'app/client/ui2018/cssVars';
import { menuCssClass } from 'app/client/ui2018/menus';
import { cssChoiceToken } from 'app/client/widgets/ChoiceToken';
import { createMobileButtons, getButtonMargins } from 'app/client/widgets/EditorButtons';
import { EditorPlacement } from 'app/client/widgets/EditorPlacement';
import { FieldOptions, NewBaseEditor } from 'app/client/widgets/NewBaseEditor';
import { cssRefList, renderACItem } from 'app/client/widgets/ReferenceEditor';
import { ReferenceUtils } from 'app/client/lib/ReferenceUtils';
import { csvEncodeRow } from 'app/common/csvFormat';
import { CellValue } from "app/common/DocActions";
import { decodeObject, encodeObject } from 'app/plugin/objtypes';
import { dom, styled } from 'grainjs';

class ReferenceItem implements IToken, ACItem {
  /**
   * A slight misnomer: what actually gets shown inside the TokenField
   * is the `text`. Instead, `label` identifies a Token in the TokenField by either
   * its row id (if it has one) or its display text.
   *
   * TODO: Look into removing `label` from IToken altogether, replacing it with a solution
   * similar to getItemText() from IAutocompleteOptions.
   */
  public label: string = typeof this.rowId === 'number' ? String(this.rowId) : this.text;
  public cleanText: string = normalizeText(this.text);

  constructor(
    public text: string,
    public rowId: number | 'new' | 'invalid',
  ) {}
}

/**
 * A ReferenceListEditor offers an autocomplete of choices from the referenced table.
 */
export class ReferenceListEditor extends NewBaseEditor {
  protected cellEditorDiv: HTMLElement;
  protected commandGroup: any;

  private _enableAddNew: boolean;
  private _showAddNew: boolean = false;
  private _tokenField: TokenField<ReferenceItem>;
  private _textInput: HTMLInputElement;
  private _dom: HTMLElement;
  private _editorPlacement!: EditorPlacement;
  private _contentSizer: HTMLElement;   // Invisible element to size the editor with all the tokens
  private _inputSizer!: HTMLElement;     // Part of _contentSizer to size the text input
  private _alignment: string;
  private _utils: ReferenceUtils;

  constructor(protected options: FieldOptions) {
    super(options);

    const docData = options.gristDoc.docData;
    this._utils = new ReferenceUtils(options.field, docData);

    const vcol = this._utils.visibleColModel;
    this._enableAddNew = vcol && !vcol.isRealFormula() && !!vcol.colId();

    const acOptions: IAutocompleteOptions<ReferenceItem> = {
      menuCssClass: `${menuCssClass} ${cssRefList.className}`,
      search: this._doSearch.bind(this),
      renderItem: this._renderItem.bind(this),
      getItemText: (item) => item.text,
    };

    this.commandGroup = this.autoDispose(createGroup(options.commands, null, true));
    this._alignment = options.field.widgetOptionsJson.peek().alignment || 'left';

    // If starting to edit by typing in a string, ignore previous tokens.
    const cellValue = decodeObject(options.cellValue);
    const startRowIds: unknown[] = options.editValue !== undefined || !Array.isArray(cellValue) ? [] : cellValue;

    // If referenced table hasn't loaded yet, hold off on initializing tokens.
    const needReload = (options.editValue === undefined && !this._utils.tableData.isLoaded);
    const startTokens = needReload ?
      [] : startRowIds.map(id => new ReferenceItem(this._utils.idToText(id), typeof id === 'number' ? id : 'invalid'));

    this._tokenField = TokenField.ctor<ReferenceItem>().create(this, {
      initialValue: startTokens,
      renderToken: item => {
        const isBlankReference = item.cleanText === '';
        return [
          isBlankReference ? '[Blank]' : item.text,
          cssToken.cls('-blank', isBlankReference),
          cssChoiceToken.cls('-invalid', item.rowId === 'invalid')
        ];
      },
      createToken: text => new ReferenceItem(text, 'invalid'),
      acOptions,
      openAutocompleteOnFocus: true,
      readonly : options.readonly,
      trimLabels: true,
      styles: {cssTokenField, cssToken, cssDeleteButton, cssDeleteIcon},
    });

    this._dom = dom('div.default_editor',
      dom.cls("readonly_editor", options.readonly),
      dom.cls(cssReadonlyStyle.className, options.readonly),
      this.cellEditorDiv = cssCellEditor(testId('widget-text-editor'),
        this._contentSizer = cssContentSizer(),
        elem => this._tokenField.attach(elem),
      ),
      createMobileButtons(options.commands),
    );

    this._textInput = this._tokenField.getTextInput();
    dom.update(this._tokenField.getRootElem(),
      dom.style('justify-content', this._alignment),
    );
    dom.update(this._tokenField.getHiddenInput(),
      this.commandGroup.attach(),
    );
    dom.update(this._textInput,
      // Resize the editor whenever user types into the textbox.
      dom.on('input', () => this.resizeInput(true)),
      dom.prop('value', options.editValue || ''),
      this.commandGroup.attach(),
    );

    // The referenced table has probably already been fetched (because there must already be a
    // Reference widget instantiated), but it's better to avoid this assumption.
    docData.fetchTable(this._utils.refTableId).then(() => {
      if (this.isDisposed()) { return; }
      if (needReload) {
        this._tokenField.setTokens(
          startRowIds.map(id => new ReferenceItem(this._utils.idToText(id), typeof id === 'number' ? id : 'invalid'))
        );
        this.resizeInput();
      }
      const autocomplete = this._tokenField.getAutocomplete();
      if (autocomplete) {
        autocomplete.search();
      }
    })
    .catch(reportError);
  }

  public attach(cellElem: Element): void {
    // Attach the editor dom to page DOM.
    this._editorPlacement = EditorPlacement.create(this, this._dom, cellElem, {margins: getButtonMargins()});

    // Reposition the editor if needed for external reasons (in practice, window resize).
    this.autoDispose(this._editorPlacement.onReposition.addListener(() => this.resizeInput()));

    // Update the sizing whenever the tokens change. Delay it till next tick to give a chance for
    // DOM updates that happen around tokenObs changes, to complete.
    this.autoDispose(this._tokenField.tokensObs.addListener(() =>
      Promise.resolve().then(() => this.resizeInput())));

    this.setSizerLimits();

    // Once the editor is attached to DOM, resize it to content, focus, and set cursor.
    this.resizeInput();
    this._textInput.focus();
    const pos = Math.min(this.options.cursorPos, this._textInput.value.length);
    this._textInput.setSelectionRange(pos, pos);
  }

  public getDom(): HTMLElement {
    return this._dom;
  }

  public getCellValue(): CellValue {
    const rowIds = this._tokenField.tokensObs.get().map(t => typeof t.rowId === 'number' ? t.rowId : t.text);
    return encodeObject(rowIds);
  }

  public getTextValue(): string {
    const rowIds = this._tokenField.tokensObs.get().map(t => typeof t.rowId === 'number' ? String(t.rowId) : t.text);
    return csvEncodeRow(rowIds, {prettier: true});
  }

  public getCursorPos(): number {
    return this._textInput.selectionStart || 0;
  }

  /**
   * If any 'new' item are saved, add them to the referenced table first.
   */
  public async prepForSave() {
    const tokens = this._tokenField.tokensObs.get();
    const newValues = tokens.filter(t => t.rowId === 'new');
    if (newValues.length === 0) { return; }

    // Add the new items to the referenced table.
    const colInfo = {[this._utils.visibleColId]: newValues.map(t => t.text)};
    const rowIds = await this._utils.tableData.sendTableAction(
      ["BulkAddRecord", new Array(newValues.length).fill(null), colInfo]
    );

    // Update the TokenField tokens with the returned row ids.
    let i = 0;
    const newTokens = tokens.map(t => {
      return t.rowId === 'new' ? new ReferenceItem(t.text, rowIds[i++]) : t;
    });
    this._tokenField.setTokens(newTokens);
  }

  public setSizerLimits() {
    // Set the max width of the sizer to the max we could possibly grow to, so that it knows to wrap
    // once we reach it.
    const rootElem = this._tokenField.getRootElem();
    const maxSize = this._editorPlacement.calcSizeWithPadding(rootElem,
      {width: Infinity, height: Infinity}, {calcOnly: true});
    this._contentSizer.style.maxWidth = Math.ceil(maxSize.width) + 'px';
  }

  /**
   * Helper which resizes the token-field to match its content.
   */
  protected resizeInput(onlyTextInput: boolean = false) {
    if (this.isDisposed()) { return; }

    const rootElem = this._tokenField.getRootElem();

    // To size the content, we need both the tokens and the text typed into _textInput. We
    // re-create the tokens using cloneNode(true) copies all styles and properties, but not event
    // handlers. We can skip this step when we know that only _textInput changed.
    if (!onlyTextInput || !this._inputSizer) {
      this._contentSizer.innerHTML = '';

      dom.update(this._contentSizer,
        dom.update(rootElem.cloneNode(true) as HTMLElement,
          dom.style('width', ''),
          dom.style('height', ''),
          this._inputSizer = cssInputSizer(),

          // Remove the testId('tokenfield') from the cloned element, to simplify tests (so that
          // selecting .test-tokenfield only returns the actual visible tokenfield container).
          dom.cls('test-tokenfield', false),
        )
      );
    }

    // Use a separate sizer to size _textInput to the text inside it.
    // \u200B is a zero-width space; so the sizer will have height even when empty.
    this._inputSizer.textContent = this._textInput.value + '\u200B';
    const rect = this._contentSizer.getBoundingClientRect();

    const size = this._editorPlacement.calcSizeWithPadding(rootElem, rect);
    rootElem.style.width = size.width + 'px';
    rootElem.style.height = size.height + 'px';
    this._textInput.style.width = this._inputSizer.getBoundingClientRect().width + 'px';
  }

  /**
   * If the search text does not match anything exactly, adds 'new' item to it.
   *
   * Also see: prepForSave.
   */
   private async _doSearch(text: string): Promise<ACResults<ReferenceItem>> {
    const {items, selectIndex, highlightFunc} = this._utils.autocompleteSearch(text);
    const result: ACResults<ReferenceItem> = {
      selectIndex,
      highlightFunc,
      items: items.map(i => new ReferenceItem(i.text, i.rowId))
    };

    this._showAddNew = false;
    if (!this._enableAddNew || !text) { return result; }

    const cleanText = normalizeText(text);
    if (result.items.find((item) => item.cleanText === cleanText)) {
      return result;
    }

    result.items.push(new ReferenceItem(text, 'new'));
    this._showAddNew = true;

    return result;
  }

  private _renderItem(item: ReferenceItem, highlightFunc: HighlightFunc) {
    return renderACItem(
      item.text,
      highlightFunc,
      item.rowId === 'new',
      this._showAddNew
    );
  }
}

const cssCellEditor = styled('div', `
  background-color: ${theme.cellEditorBg};
  font-family: var(--grist-font-family-data);
  font-size: var(--grist-medium-font-size);
`);

const cssTokenField = styled(tokenFieldStyles.cssTokenField, `
  border: none;
  align-items: start;
  align-content: start;
  padding: 0 3px;
  height: min-content;
  min-height: 22px;
  flex-wrap: wrap;
`);

const cssToken = styled(tokenFieldStyles.cssToken, `
  padding: 1px 4px;
  margin: 2px;
  line-height: 16px;
  white-space: pre;
  color: ${theme.choiceTokenFg};

  &.selected {
    box-shadow: inset 0 0 0 1px ${theme.choiceTokenSelectedBorder};
  }

  &-blank {
    color: ${theme.lightText};
  }
`);

const cssDeleteButton = styled(tokenFieldStyles.cssDeleteButton, `
  position: absolute;
  top: -8px;
  right: -6px;
  border-radius: 16px;
  background-color: ${colors.dark};
  width: 14px;
  height: 14px;
  cursor: pointer;
  z-index: 1;
  display: none;
  align-items: center;
  justify-content: center;

  .${cssToken.className}:hover & {
    display: flex;
  }
  .${cssTokenField.className}.token-dragactive & {
    cursor: unset;
  }
`);

const cssDeleteIcon = styled(tokenFieldStyles.cssDeleteIcon, `
  --icon-color: ${colors.light};
  &:hover {
    --icon-color: ${colors.darkGrey};
  }
`);

const cssContentSizer = styled('div', `
  position: absolute;
  left: 0;
  top: -100px;
  border: none;
  visibility: hidden;
  overflow: visible;
  width: max-content;

  & .${tokenFieldStyles.cssInputWrapper.className} {
    display: none;
  }
`);

const cssInputSizer = styled('div', `
  flex: auto;
  min-width: 24px;
  margin: 3px 2px;
`);

const cssReadonlyStyle = styled('div', `
  padding-left: 16px;
  background: white;
`);
