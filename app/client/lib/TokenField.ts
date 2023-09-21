/**
 * A full-featured implementation of tokenfield (aka "pillbox", "tag list", etc).
 *
 * Supported features:
 * - Each token includes an "x" button to delete it.
 * - Click on a token to select;
 *   Shift+click to extend selection;
 *   Ctrl+click for non-contigous selection.
 * - Arrow keys to move selection.
 *   Shift + arrow keys to extend selection.
 * - Cmd+A to select all options.
 * - Delete/Backspace delete selection. If no selection, Backspace deletes the last item.
 * - Copy-cut is supported for a selection. By default CSV-encodes token labels.
 * - Paste is supported into input textbox, or to replace a selection.
 * - Tokens or a selection of tokens may be dragged to move within the tokenfield.
 * - Supports undo/redo for token changes.
 */
import { ACItem } from 'app/client/lib/ACIndex';
import { modKeyProp } from 'app/client/lib/browserInfo';
import { Autocomplete, IAutocompleteOptions } from 'app/client/lib/autocomplete';
import { colors, testId, theme } from 'app/client/ui2018/cssVars';
import { icon } from 'app/client/ui2018/icons';
import { csvDecodeRow, csvEncodeRow } from 'app/common/csvFormat';
import { computedArray, IDisposableCtor, IObsArraySplice, ObsArray, obsArray, Observable } from 'grainjs';
import { Disposable, dom, DomElementArg, Holder, styled } from 'grainjs';

export interface IToken {
  label: string;
}

export interface ITokenFieldOptions<Token extends IToken> {
  initialValue: Token[];
  renderToken: (token: Token) => DomElementArg;
  createToken: (inputText: string) => Token|undefined;
  acOptions?: IAutocompleteOptions<Token & ACItem>;
  openAutocompleteOnFocus?: boolean;
  styles?: ITokenFieldStyles;
  readonly?: boolean;
  trimLabels?: boolean;
  keyBindings?: ITokenFieldKeyBindings;

  // Allows overriding how tokens are copied to the clipboard, or retrieved from it.
  // By default, tokens are placed into clipboard as text/plain comma-separated token labels, with
  // CSV escaping, and pasted from clipboard by applying createToken() to parsed CSV text.
  tokensToClipboard?: (tokens: Token[], clipboard: DataTransfer) => void;
  clipboardToTokens?: (clipboard: DataTransfer) => Token[];

  // Defaults to horizontal.
  variant?: ITokenFieldVariant;
}

/**
 * Overrides for default TokenField shortcut bindings.
 *
 * Values should be Key Values (https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key/Key_Values).
 */
export interface ITokenFieldKeyBindings {
  previous?: string;
  next?: string;
}

export type ITokenFieldVariant = 'horizontal' | 'vertical';

const defaultKeyBindings: Required<ITokenFieldKeyBindings> = {
  previous: 'ArrowLeft',
  next: 'ArrowRight'
};

// TokenWrap serves to distinguish multiple instances of the same token in the list.
class TokenWrap<Token extends IToken> {
  constructor(public token: Token) {}
}

class UndoItem {
  constructor(public redo: () => void, public undo: () => void) {}
}

export class TokenField<Token extends IToken = IToken> extends Disposable {
  public static ctor<T extends IToken>(): IDisposableCtor<TokenField<T>, [ITokenFieldOptions<T>]> {
    return this;
  }

  public tokensObs: ObsArray<Token>;

  private _acHolder = Holder.create<Autocomplete<Token & ACItem>>(this);
  private _acOptions: IAutocompleteOptions<Token & ACItem>|undefined;
  private _rootElem: HTMLElement;
  private _textInput: HTMLInputElement;
  private _styles: Required<ITokenFieldStyles>;

  // ClipboardAPI events work as expected only when the focus is in an actual input.
  // This is where we place focus when we have some tokens selected.
  private _hiddenInput: HTMLInputElement;

  // Keys to navigate tokens. In a vertical list, these would be changed to Up/Down.
  private _keyBindings: Required<ITokenFieldKeyBindings>;

  private _tokens = this.autoDispose(obsArray<TokenWrap<Token>>());
  private _selection = Observable.create(this, new Set<TokenWrap<Token>>());
  private _selectionAnchor: TokenWrap<Token>|null = null;
  private _undoStack: UndoItem[] = [];
  private _undoIndex = 0;   // The last action done; next to undo.
  private _inUndoRedo = false;
  private _variant: ITokenFieldVariant = this._options.variant ?? 'horizontal';

  constructor(private _options: ITokenFieldOptions<Token>) {
    super();
    const addSelectedItem = this._addSelectedItem.bind(this);
    const openAutocomplete = this._openAutocomplete.bind(this);
    this._acOptions = _options.acOptions && {..._options.acOptions, onClick: addSelectedItem};

    this.setTokens(_options.initialValue);
    this.tokensObs = this.autoDispose(computedArray(this._tokens, t => t.token));
    this._keyBindings = {...defaultKeyBindings, ..._options.keyBindings};

    // We can capture undo info in a consistent way as long as we change _tokens using its
    // obsArray interface, by listening to the splice events.
    this.autoDispose(this._tokens.addListener(this._recordUndo.bind(this)));

    // Use overridden styles if any were provided.
    this._styles = {...tokenFieldStyles, ..._options.styles};
    const {cssTokenField, cssToken, cssInputWrapper, cssTokenInput, cssDeleteButton, cssDeleteIcon} = this._styles;

    function stop(ev: Event) {
      ev.stopPropagation();
      ev.preventDefault();
    }

    this._rootElem = cssTokenField(
      {tabIndex: '-1'},
      dom.forEach(this._tokens, (t) =>
        cssToken(this._options.renderToken(t.token),
          dom.cls('selected', (use) => use(this._selection).has(t)),
          _options.readonly ? null : [
            cssDeleteButton(
              // Ignore mousedown events, so that tokens aren't draggable by the delete button.
              dom.on('mousedown', (ev) => ev.stopPropagation()),
              cssDeleteIcon('CrossSmall'),
              testId('tokenfield-delete')
            ),
            dom.on('click', (ev) =>  this._onTokenClick(ev, t)),
            dom.on('mousedown', (ev) => this._onMouseDown(ev, t))
          ],
          testId('tokenfield-token')
        ),
      ),
      cssInputWrapper(
        this._textInput = cssTokenInput(
          dom.boolAttr("readonly", this._options.readonly ?? false),
          dom.on('focus', this._onInputFocus.bind(this)),
          dom.on('blur', () => { this._acHolder.clear(); }),
          (this._acOptions ?
            // Toggle the autocomplete on clicking the input box.
            dom.on('click', () => this._acHolder.isEmpty() ? openAutocomplete() : this._acHolder.clear()) :
            null
          ),
          dom.onKeyDown({
            Escape$: (ev) => { this._acHolder.clear(); },
            Enter$: (ev) => addSelectedItem() && stop(ev),
            ArrowDown$: openAutocomplete,
            Tab$: (ev) => addSelectedItem() && stop(ev),
          }),
          dom.on('input', openAutocomplete),
          testId('tokenfield-input'),
        ),
      ),
      dom.onKeyDown({
        a$: this._maybeSelectAllTokens.bind(this),
        Backspace$: this._maybeBackspace.bind(this),
        Delete$: this._maybeDelete.bind(this),
        [this._keyBindings.previous + '$']: (ev) => this._maybeAdvance(ev, -1),
        [this._keyBindings.next + '$']: (ev) => this._maybeAdvance(ev, +1),
        // ['Mod+z'] triggers undo; ['Mod+Shift+Z', 'Ctrl+y' ] trigger redo
        z$: (ev) => { if (ev[modKeyProp()]) { ev.shiftKey ? this._redo(ev) : this._undo(ev); } },
        y$: (ev) => { if (ev.ctrlKey && !ev.shiftKey) { this._redo(ev); } },
      }),
      this._hiddenInput = cssHiddenInput({type: 'text', tabIndex: '-1'},
        dom.on('blur', (ev) => {
          if (ev.relatedTarget && ev.relatedTarget !== this._rootElem) {
            this._selectionAnchor = null;
            this._selection.set(new Set());
          }
        }),
      ),
      dom.on('focus', () => this._hiddenInput.focus({preventScroll: true})),
      dom.on('copy', this._onCopyEvent.bind(this)),
      dom.on('cut', this._onCutEvent.bind(this)),
      dom.on('paste', this._onPasteEvent.bind(this)),
      testId('tokenfield'),
    );
  }

  public attach(elem: HTMLElement): void {
    elem.appendChild(this._rootElem);
  }

  // Outer container for the tokens and new-entry input field.
  public getRootElem(): HTMLElement {
    return this._rootElem;
  }

  // The new-entry input field.
  public getTextInput(): HTMLInputElement {
    return this._textInput;
  }

  /**
   * Returns the current value of the text input.
   */
  public getTextInputValue(): string {
    return this._options.trimLabels ? this._textInput.value.trim() : this._textInput.value;
  }

  // The invisible input that has focus while we have some tokens selected.
  public getHiddenInput(): HTMLInputElement {
    return this._hiddenInput;
  }

  /**
   * Returns the Autocomplete instance used by the TokenField.
   */
  public getAutocomplete(): Autocomplete<Token & ACItem> | null {
    return this._acHolder.get();
  }

  /**
   * Sets the `tokens` that the TokenField should be populated with.
   *
   * Can be called after the TokenField is created to override the
   * stored tokens. This is useful for delayed token initialization,
   * where `tokens` may need to be set shortly after the TokenField
   * is opened (e.g. ReferenceListEditor).
   */
  public setTokens(tokens: Token[]): void {
    const formattedTokens = this._maybeTrimTokens(tokens);
    this._tokens.set(formattedTokens.map(t => new TokenWrap(t)));
  }

  // Replaces a token (if it exists).
  public replaceToken(label: string, newToken: Token): void {
    const tokenIdx = this._tokens.get().findIndex(t => t.token.label === label);
    if (tokenIdx === -1) { return; }
    this._tokens.splice(tokenIdx, 1, new TokenWrap(newToken));
  }

  // Open the autocomplete dropdown, if autocomplete was configured in the options.
  private _openAutocomplete() {
    // don't open dropdown in a readonly mode
    if (this._options.readonly) { return; }
    if (this._acOptions && this._acHolder.isEmpty()) {
      Autocomplete.create(this._acHolder, this._textInput, this._acOptions);
    }
  }

  // Adds the typed-in or selected item. If an item is selected in autocomplete dropdown, adds
  // that; otherwise if options.createToken is present, creates a token from text input value.
  private _addSelectedItem(): boolean {
    let item: Token|undefined = this._acHolder.get()?.getSelectedItem();
    const textInput = this.getTextInputValue();
    if (!item && this._options.createToken && textInput) {
      item = this._options.createToken(textInput);
    }
    if (item) {
      this._tokens.push(new TokenWrap(item));
      this._textInput.value = '';
      this._acHolder.clear();
      return true;
    }
    return false;
  }

  // Handler for when text input is focused: clears selection, optionally opens dropdown.
  private _onInputFocus() {
    this._selectionAnchor = null;
    this._selection.set(new Set());
    if (this._options.openAutocompleteOnFocus) {
      this._openAutocomplete();
    }
  }

  // Handle for a click on a token or the token's delete button. This handles selection, including
  // Shift+Click and Ctrl+Click.
  private _onTokenClick(ev: MouseEvent, t: TokenWrap<Token>) {
    const idx = this._tokens.get().indexOf(t);
    if (idx < 0) { return; }
    if (ev.target && (ev.target as HTMLElement).matches('.' + this._styles.cssDeleteIcon.className)) {
      // Delete token.
      this._tokens.splice(idx, 1);
    } else {
      const fromIdx = this._selectionAnchor ? this._tokens.get().indexOf(this._selectionAnchor) : -1;
      if (ev.shiftKey && fromIdx >= 0) {
        // Shift+Click selects range from selectionAnchor to the clicked token.
        const [first, last] = fromIdx <= idx ? [fromIdx, idx] : [idx, fromIdx];
        this._selection.set(new Set(this._tokens.get().slice(first, last + 1)));
      } else if (ev[modKeyProp()] && fromIdx >= 0) {
        // Ctrl+Click (or Command+Click on mac) toggles the clicked token.
        this._toggleTokenSelection(t);
      } else {
        // Plain click, or any click in the absence of an anchor element, sets the anchor and
        // selects just this element.
        this._resetTokenSelection(t);
      }
    }
    this._setFocus();
  }

  private _maybeSelectAllTokens(ev: KeyboardEvent) {
    if (ev[modKeyProp()] && this._textInput.value === '') {
      ev.stopPropagation();
      ev.preventDefault();
      const tokens = this._tokens.get();
      this._selection.set(new Set(tokens));
      this._selectionAnchor = tokens ? tokens[0] : null;
      this._setFocus();
    }
  }

  // Set focus appropriately to the textInput or to the outer container.
  private _setFocus() {
    if (this._selection.get().size === 0) {
      this._textInput.focus();
    } else {
      this._hiddenInput.focus();
    }
  }

  private _maybeBackspace(ev: KeyboardEvent) {
    if (this._textInput.value === '') {
      ev.stopPropagation();
      ev.preventDefault();
      if (ev.repeat) { return; }
      if (this._selection.get().size === 0) {
        this._tokens.pop();
      } else {
        this._deleteTokens(this._selection.get(), -1);
      }
    }
  }

  private _maybeDelete(ev: KeyboardEvent) {
    if (this._textInput.value === '' && this._selection.get().size > 0) {
      ev.stopPropagation();
      ev.preventDefault();
      this._deleteTokens(this._selection.get(), 1);
    }
  }

  // Handle arrow and shift+arrow keys, when the text input is empty.
  private _maybeAdvance(ev: KeyboardEvent, advance: 1|-1): void {
    if (this._textInput.value !== '') {
      return;
    }
    const tokens = this._tokens.get();
    const anchorIdx = this._selectionAnchor ? tokens.indexOf(this._selectionAnchor) : -1;

    if (ev.shiftKey && this._selection.get().size > 0 && anchorIdx >= 0) {
      // For shift+arrows, we either extend or reduce the selection, depending on whether we are
      // walking away from the anchor or back towards it.
      const [first, last] = this._getSelectedIndexRange(this._selection.get());
      if (last < 0) { return; }
      const toggleIdx = (advance > 0) ?
        (last === anchorIdx && first < anchorIdx ? first : last + 1) :
        (first === anchorIdx && last > anchorIdx ? last : first - 1);
      const t = tokens[toggleIdx];
      if (t) {
        ev.stopPropagation();
        ev.preventDefault();
        this._toggleTokenSelection(t);
        this._setFocus();
      }
    } else {
      // For arrow keys, move to the next token after the selection.
      let next: TokenWrap<Token>|null = null;
      if (this._selection.get().size > 0) {
        next = this._getNextToken(this._selection.get(), advance);
      } else if (advance < 0 && tokens.length > 0) {
        next = tokens[tokens.length - 1];
      }
      // If no next token and we are moving to the right, we should end up back in the text input.
      if (next || advance > 0) {
        ev.stopPropagation();
        ev.preventDefault();
        this._resetTokenSelection(next);
        this._setFocus();
      }
    }
  }

  private _toggleTokenSelection(token: TokenWrap<Token>) {
    const selection = this._selection.get();
    if (selection.has(token)) {
      selection.delete(token);
    } else {
      selection.add(token);
    }
    // We use .setAndTrigger() to set a value that's identical (by reference) to the previous one.
    this._selection.setAndTrigger(selection);
  }

  private _resetTokenSelection(token: TokenWrap<Token>|null) {
    this._selectionAnchor = token;
    this._selection.set(token ? new Set([token]) : new Set());
  }

  // Delete the given set of tokens, and select either the following or the preceding one.
  private _deleteTokens(toDelete: Set<TokenWrap<Token>>, advance: 1|-1|0) {
    if (this._selection.get().size === 0) { return; }
    const selectAfter = advance ? this._getNextToken(toDelete, advance) : null;
    this._tokens.set(this._tokens.get().filter(t => !toDelete.has(t)));
    this._resetTokenSelection(selectAfter);
    this._setFocus();
  }

  private _getNextToken(selection: Set<TokenWrap<Token>>, advance: 1|-1): TokenWrap<Token>|null {
    const [first, last] = this._getSelectedIndexRange(selection);
    if (last < 0) { return null; }
    return this._tokens.get()[advance > 0 ? last + 1 : first - 1] || null;
  }

  private _getSelectedIndexRange(selection: Set<TokenWrap<Token>>): [number, number] {
    const tokens = this._tokens.get();
    let first = -1, last = -1;
    for (let i = 0; i < tokens.length; i++) {
      if (selection.has(tokens[i])) {
        if (first === -1) { first = i; }
        last = i;
      }
    }
    return [first, last];
  }

  private _onCopyEvent(ev: ClipboardEvent): boolean {
    if (!ev.clipboardData || !this._selection.get().size) { return false; }
    ev.preventDefault();  // Required for overriding: https://www.w3.org/TR/clipboard-apis/#override-copy

    const selected = this._selection.get();
    const tokens = this._tokens.get().filter(t => selected.has(t));
    if (this._options.tokensToClipboard) {
      this._options.tokensToClipboard(tokens.map(t => t.token), ev.clipboardData);
    } else {
      const values = tokens.map(t => t.token.label);
      ev.clipboardData.setData('text/plain', csvEncodeRow(values, {prettier: true}));
    }
    return true;
  }

  private _onCutEvent(ev: ClipboardEvent) {
    if (this._onCopyEvent(ev)) {
      this._deleteTokens(this._selection.get(), 0);
    }
  }

  private _onPasteEvent(ev: ClipboardEvent) {
    if (!ev.clipboardData) { return; }
    ev.preventDefault();
    let tokens: Token[];
    if (this._options.clipboardToTokens) {
      tokens = this._options.clipboardToTokens(ev.clipboardData);
    } else {
      const text = ev.clipboardData.getData('text/plain');
      const values = csvDecodeRow(text);
      tokens = values.map(v => this._options.createToken(v)).filter((t): t is Token => Boolean(t));
    }
    if (!tokens.length) { return; }
    tokens = this._maybeTrimTokens(tokens);
    tokens = this._getNonEmptyTokens(tokens);
    const wrappedTokens = tokens.map(t => new TokenWrap(t));
    this._combineUndo(() => {
      this._deleteTokens(this._selection.get(), 1);
      const anchorIdx = this._selectionAnchor ? this._tokens.get().indexOf(this._selectionAnchor) : -1;
      if (anchorIdx >= 0) {
        this._tokens.splice(anchorIdx, 0, ...wrappedTokens);
        this._selectionAnchor = wrappedTokens[0];
        this._selection.set(new Set(wrappedTokens));
      } else {
        this._tokens.push(...wrappedTokens);
        this._resetTokenSelection(null);
      }
    });
    this._setFocus();
  }

  // For a mousedown on a token, register events for mousemove/mouseup, and start dragging as soon
  // as mousemove occurs.
  private _onMouseDown(startEvent: MouseEvent, t: TokenWrap<Token>) {
    const xInitial = startEvent.clientX;
    const yInitial = startEvent.clientY;
    const dragTargetSelector = `.${this._styles.cssToken.className}, .${this._styles.cssInputWrapper.className}`;
    const dragTargetStyle = this._variant === 'horizontal' ? cssDragTarget : cssVerticalDragTarget;

    let started = false;
    let allTargets: HTMLElement[];
    let tokenList: HTMLElement[];
    let nextUnselectedToken: HTMLElement|undefined;

    const onMove = (ev: MouseEvent) => {
      if (!started) {
        started = true;
        // If we started dragging an element that's not part of the selection, reset the selection
        // to just that element. After this, we are always dragging the active selection.
        if (!this._selection.get().has(t)) {
          this._resetTokenSelection(t);
        }

        this._rootElem.classList.add('token-dragactive');

        // Get a list of all drag targets, and add a CSS class that shows drop location on hover.
        allTargets = Array.prototype.filter.call(this._rootElem.children, el => el.matches(dragTargetSelector));
        allTargets.forEach(el => el.classList.add(dragTargetStyle.className));

        // Get a list of element we are dragging, and add a CSS class to show them as dragged.
        tokenList = allTargets.filter(el => el.matches('.selected'));
        tokenList.forEach(el => el.classList.add('token-dragging'));

        // Add a CSS class to the first unselected token after the current selection; we use it for showing
        // the drag/drop markers when hovering over a token.
        nextUnselectedToken = allTargets.find(el => el.previousElementSibling === tokenList[tokenList.length - 1]);
        nextUnselectedToken?.classList.add(dragTargetStyle.className + "-next");
        nextUnselectedToken?.style.setProperty('--count', String(tokenList.length));
      }
      const xOffset = ev.clientX - xInitial;
      const yOffset = ev.clientY - yInitial;
      const transform = `translate(${xOffset}px, ${yOffset}px)`;
      tokenList.forEach(el => { el.style.transform = transform; });
    };

    const onStop = (ev: MouseEvent) => {
      moveLis.dispose();
      stopLis.dispose();

      // Stop here if dragging never started.
      if (!started) { return; }

      // Restore all style changes.
      this._rootElem.classList.remove('token-dragactive');
      allTargets.forEach(el => el.classList.remove(dragTargetStyle.className));
      tokenList.forEach(el => el.classList.remove('token-dragging'));
      tokenList.forEach(el => { el.style.transform = ''; });
      nextUnselectedToken?.classList.remove(dragTargetStyle.className + "-next");

      // Find the token before which we are inserting the dragged elements. If inserting at the
      // end (just before or over the input box), destToken will be undefined.
      const index = allTargets.findIndex((target) => target.contains(ev.target as Node));
      if (index < 0) { return; }

      const destToken: TokenWrap<Token>|undefined = this._tokens.get()[index];

      const selection = this._selection.get();
      if (selection.has(destToken)) { return; }   // Not actually moving anywhere new.

      const movedTokens = this._tokens.get().filter(tok => selection.has(tok));
      if (!movedTokens.length) { return; }        // Didn't find any tokens to move.

      this._combineUndo(() => {
        this._deleteTokens(selection, 0);
        // Find destination again after the deletion (it's likely to have changed).
        const destIndex = destToken ? this._tokens.get().indexOf(destToken) : this._tokens.get().length;
        // Move the tokens and mark them as selected.
        this._tokens.splice(destIndex, 0, ...movedTokens);
        this._selectionAnchor = movedTokens[0];
        this._selection.set(new Set(movedTokens));
      });
    };

    const moveLis = dom.onElem(document, 'mousemove', onMove, {useCapture: true});
    const stopLis = dom.onElem(document, 'mouseup', onStop, {useCapture: true});
  }

  private _recordUndo(val: TokenWrap<Token>[], prev: TokenWrap<Token>[], change?: IObsArraySplice<TokenWrap<Token>>) {
    if (this._inUndoRedo) { return; }
    const splice = change || {start: 0, numAdded: val.length, deleted: [...prev]};
    const newTokens = val.slice(splice.start, splice.start + splice.numAdded);
    const redo = () => this._tokens.splice(splice.start, splice.deleted.length, ...newTokens);
    const undo = () => this._tokens.splice(splice.start, splice.numAdded, ...splice.deleted);
    this._undoIndex = Math.min(this._undoIndex + 1, this._undoStack.length);
    this._undoStack.splice(this._undoIndex, this._undoStack.length, new UndoItem(redo, undo));
  }

  private _combineUndo(callback: () => void) {
    const nextAction = this._undoIndex + 1;
    try {
      callback();
    } finally {
      if (this._undoStack.length > nextAction + 1) {
        // If multiple actions were added, combine them into one.
        const actions = this._undoStack.slice(nextAction);
        const redo = () => actions.forEach(a => a.redo());
        const undo = () => actions.slice().reverse().forEach(a => a.undo());
        this._undoIndex = nextAction;
        this._undoStack.splice(this._undoIndex, actions.length, new UndoItem(redo, undo));
      }
    }
  }

  private _undo(ev: KeyboardEvent): void {
    if (this._textInput.value === '' && this._undoIndex >= 0 && this._undoIndex < this._undoStack.length) {
      ev.stopPropagation();
      ev.preventDefault();
      this._inUndoRedo = true;
      try {
        this._undoStack[this._undoIndex].undo();
        this._undoIndex--;
      } finally {
        this._inUndoRedo = false;
      }
    }
  }

  private _redo(ev: KeyboardEvent): void {
    if (this._undoIndex + 1 < this._undoStack.length) {
      ev.stopPropagation();
      ev.preventDefault();
      this._inUndoRedo = true;
      try {
        this._undoIndex += 1;
        this._undoStack[this._undoIndex].redo();
      } finally {
        this._inUndoRedo = false;
      }
    }
  }

  /**
   * Returns an array of tokens formatted according to the `trimLabels` option.
   */
  private _maybeTrimTokens(tokens: Token[]): Token[] {
    if (!this._options.trimLabels) { return tokens; }
    return tokens.map(t => ({...t, label: t.label.trim()}));
  }

  /**
   * Returns a filtered array of tokens that don't have empty labels.
   */
  private _getNonEmptyTokens(tokens: Token[]): Token[] {
    return tokens.filter(t => t.label !== '');
  }
}

const cssTokenField = styled('div', `
  display: flex;
  border: 1px solid ${colors.darkGrey};
  border-radius: 3px;
  padding: 0 4px;
  line-height: 16px;

  &.token-dragactive {
    cursor: grabbing;
  }
`);

const cssToken = styled('div', `
  position: relative;
  flex: none;
  border-radius: 3px;
  background-color: ${theme.choiceTokenBg};
  padding: 4px;
  margin: 3px 2px;
  user-select: none;
  cursor: grab;

  &.selected {
    background-color: ${theme.choiceTokenSelectedBg};
  }
  &.token-dragging {
    pointer-events: none;
    z-index: 1;
    opacity: 0.7;
  }
  .${cssTokenField.className}.token-dragactive & {
    cursor: unset;
  }
`);

const cssInputWrapper = styled('div', `
  position: relative;
  flex: auto;
  margin: 3px 2px;
  display: flex;
`);

const cssTokenInput = styled('input', `
  color: ${theme.cellEditorFg};
  background-color: ${theme.cellEditorBg};
  flex: auto;
  -webkit-appearance: none;
  -moz-appearance: none;
  padding: 0;
  border: none;
  outline: none;
  line-height: inherit;
`);

// This class is applied to tokens and the input box on start of dragging, to use them as drag
// targets. Insertion point will always be to the left of them. While dragging, these include a
// transparent pseudo-element to cover some area to the left, to know when it's a suitable drop
// position. While the drag is over the element (or its extension), it gets shifted to show
// the user the location of the drop using another pseudo-element.
const cssDragTarget = styled('div', `
  &::before {
    content: "";
    position: absolute;
    left: -8px;
    right: 50%;
    top: 0px;
    bottom: 0px;
  }
  &:hover {
    transform: translateX(2px);
  }
  &:hover::after {
    content: "";
    position: absolute;
    background-color: ${theme.controlFg};
    width: 2px;
    top: 0px;
    bottom: 0px;
    left: -4px;
  }
`);

const cssVerticalDragTarget = styled('div', `
  /* This pseudo-element prevents small, flickering height changes when
   * dragging the selection over targets. */
  &::before {
    content: "";
    position: absolute;
    top: -8px;
    bottom: 0px;
    left: 0px;
    right: 0px;
  }
  &-next::before {
    /* 27.75px is the height of a token. */
    top: calc(-27.75px * var(--count, 1) - 8px);
  }
  &:hover {
    transform: translateY(4px);
    margin-bottom: 8px;
  }
  &:hover::after {
    content: "";
    position: absolute;
    background-color: ${theme.controlFg};
    height: 2px;
    top: -5px;
    bottom: 0px;
    left: 0px;
    right: 0px;
  }
`);

const cssHiddenInput = styled('input', `
  left: -10000px;
  width: 1px;
  position: absolute;
`);

const cssDeleteButton = styled('div', `
  display: inline;
  margin-left: 4px;
  vertical-align: bottom;
  line-height: 1;
  cursor: pointer;
  .${cssTokenField.className}.token-dragactive & {
    cursor: unset;
  }
`);

const cssDeleteIcon = styled(icon, `
  --icon-color: ${colors.slate};
  &:hover {
    --icon-color: ${colors.dark};
  }
`);

export const tokenFieldStyles = {
  cssTokenField,
  cssToken,
  cssInputWrapper,
  cssTokenInput,
  cssDeleteButton,
  cssDeleteIcon,
};

export type ITokenFieldStyles = Partial<typeof tokenFieldStyles>;
