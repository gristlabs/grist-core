import {createGroup} from 'app/client/components/commands';
import {ACIndexImpl, ACItem, ACResults,
        buildHighlightedDom, HighlightFunc, normalizeText} from 'app/client/lib/ACIndex';
import {IAutocompleteOptions} from 'app/client/lib/autocomplete';
import {IToken, TokenField, tokenFieldStyles} from 'app/client/lib/TokenField';
import {colors, testId, theme} from 'app/client/ui2018/cssVars';
import {menuCssClass} from 'app/client/ui2018/menus';
import {createMobileButtons, getButtonMargins} from 'app/client/widgets/EditorButtons';
import {EditorPlacement} from 'app/client/widgets/EditorPlacement';
import {FieldOptions, NewBaseEditor} from 'app/client/widgets/NewBaseEditor';
import {csvEncodeRow} from 'app/common/csvFormat';
import {CellValue} from "app/common/DocActions";
import {decodeObject, encodeObject} from 'app/plugin/objtypes';
import {ChoiceOptions, getRenderFillColor, getRenderTextColor} from 'app/client/widgets/ChoiceTextBox';
import {choiceToken, cssChoiceACItem, cssChoiceToken} from 'app/client/widgets/ChoiceToken';
import {icon} from 'app/client/ui2018/icons';
import {dom, styled} from 'grainjs';

export class ChoiceItem implements ACItem, IToken {
  public cleanText: string = normalizeText(this.label);
  constructor(
    public label: string,
    public isInvalid: boolean,  // If set, this token is not one of the valid choices.
    public isBlank: boolean,    // If set, this token is blank.
    public isNew?: boolean,     // If set, this is a choice to be added to the config.
  ) {}
}

export class ChoiceListEditor extends NewBaseEditor {
  protected cellEditorDiv: HTMLElement;
  protected commandGroup: any;

  private _tokenField: TokenField<ChoiceItem>;
  private _textInput: HTMLInputElement;
  private _dom: HTMLElement;
  private _editorPlacement!: EditorPlacement;
  private _contentSizer: HTMLElement;   // Invisible element to size the editor with all the tokens
  private _inputSizer!: HTMLElement;     // Part of _contentSizer to size the text input
  private _alignment: string;

  // Whether to include a button to show a new choice.
  // TODO: Disable when the user cannot change column configuration.
  private _enableAddNew: boolean = true;
  private _showAddNew: boolean = false;

  private _choiceOptionsByName: ChoiceOptions;

  constructor(protected options: FieldOptions) {
    super(options);

    const choices: string[] = options.field.widgetOptionsJson.peek().choices || [];
    this._choiceOptionsByName = options.field.widgetOptionsJson
      .peek().choiceOptions || {};
    const acItems = choices.map(c => new ChoiceItem(c, false, false));
    const choiceSet = new Set(choices);

    const acIndex = new ACIndexImpl<ChoiceItem>(acItems);
    const acOptions: IAutocompleteOptions<ChoiceItem> = {
      menuCssClass: `${menuCssClass} ${cssChoiceList.className} test-autocomplete`,
      search: async (term: string) => this._maybeShowAddNew(acIndex.search(term), term),
      renderItem: (item, highlightFunc) => this._renderACItem(item, highlightFunc),
      getItemText: (item) => item.label,
    };

    this.commandGroup = this.autoDispose(createGroup(options.commands, null, true));
    this._alignment = options.field.widgetOptionsJson.peek().alignment || 'left';

    // If starting to edit by typing in a string, ignore previous tokens.
    const cellValue = decodeObject(options.cellValue);
    const startLabels: unknown[] = options.editValue !== undefined || !Array.isArray(cellValue) ? [] : cellValue;
    const startTokens = startLabels.map(label => new ChoiceItem(
      String(label),
      !choiceSet.has(String(label)),
      String(label).trim() === ''
    ));

    this._tokenField = TokenField.ctor<ChoiceItem>().create(this, {
      initialValue: startTokens,
      renderToken: item => [
        item.isBlank ? '[Blank]' : item.label,
        dom.style('background-color', getRenderFillColor(this._choiceOptionsByName[item.label])),
        dom.style('color', getRenderTextColor(this._choiceOptionsByName[item.label])),
        dom.cls('font-bold', this._choiceOptionsByName[item.label]?.fontBold ?? false),
        dom.cls('font-underline', this._choiceOptionsByName[item.label]?.fontUnderline ?? false),
        dom.cls('font-italic', this._choiceOptionsByName[item.label]?.fontItalic ?? false),
        dom.cls('font-strikethrough', this._choiceOptionsByName[item.label]?.fontStrikethrough ?? false),
        cssChoiceToken.cls('-invalid', item.isInvalid),
        cssChoiceToken.cls('-blank', item.isBlank),
      ],
      createToken: label => new ChoiceItem(label, !choiceSet.has(label), label.trim() === ''),
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
    return encodeObject(this._tokenField.tokensObs.get().map(item => item.label));
  }

  public getTextValue() {
    const values = this._tokenField.tokensObs.get().map(t => t.label);
    return csvEncodeRow(values, {prettier: true});
  }

  public getCursorPos(): number {
    return this._textInput.selectionStart || 0;
  }

  /**
   * Updates list of valid choices with any new ones that may have been
   * added from directly inside the editor (via the "add new" item in autocomplete).
   */
  public async prepForSave() {
    const tokens = this._tokenField.tokensObs.get();
    const newChoices = tokens.filter(t => t.isNew).map(t => t.label);
    if (newChoices.length > 0) {
      const choices = this.options.field.widgetOptionsJson.prop('choices');
      await choices.saveOnly([...(choices.peek() || []), ...new Set(newChoices)]);
    }
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
  private _maybeShowAddNew(result: ACResults<ChoiceItem>, text: string): ACResults<ChoiceItem> {
    this._showAddNew = false;
    const trimmedText = text.trim();
    if (!this._enableAddNew || !trimmedText) { return result; }

    const addNewItem = new ChoiceItem(trimmedText, false, false, true);
    if (result.items.find((item) => item.cleanText === addNewItem.cleanText)) {
      return result;
    }

    result.items.push(addNewItem);
    this._showAddNew = true;

    return result;
  }

  private _renderACItem(item: ChoiceItem, highlightFunc: HighlightFunc) {
    const options = this._choiceOptionsByName[item.label];

    return cssChoiceACItem(
      (item.isNew ?
        [cssChoiceACItem.cls('-new'), cssPlusButton(cssPlusIcon('Plus'))] :
        [cssChoiceACItem.cls('-with-new', this._showAddNew)]
      ),
      choiceToken(
        buildHighlightedDom(item.label, highlightFunc, cssMatchText),
        options || {},
        dom.style('max-width', '100%'),
        testId('choice-list-editor-item-label')
      ),
      testId('choice-list-editor-item'),
      item.isNew ? testId('choice-list-editor-new-item') : null,
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
  color: black;
  flex-wrap: wrap;
`);

export const cssToken = styled(tokenFieldStyles.cssToken, `
  padding: 1px 4px;
  margin: 2px;
  line-height: 16px;
  white-space: pre;

  &.selected {
    box-shadow: inset 0 0 0 1px ${theme.choiceTokenSelectedBorder};
  }
`);

export const cssDeleteButton = styled(tokenFieldStyles.cssDeleteButton, `
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

export const cssDeleteIcon = styled(tokenFieldStyles.cssDeleteIcon, `
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

// Set z-index to be higher than the 1000 set for .cell_editor.
export const cssChoiceList = styled('div', `
  z-index: 1001;
  box-shadow: 0 0px 8px 0 ${theme.menuShadow};
  overflow-y: auto;
  padding: 8px 0 0 0;
  --weaseljs-menu-item-padding: 8px 16px;
`);

const cssReadonlyStyle = styled('div', `
  padding-left: 16px;
  background: ${theme.cellEditorBg};
`);

export const cssMatchText = styled('span', `
  text-decoration: underline;
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
