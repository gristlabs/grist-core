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
import { colors, testId } from 'app/client/ui2018/cssVars';
import { icon } from 'app/client/ui2018/icons';
import { csvDecodeRow, csvEncodeRow } from 'app/common/csvFormat';
import { computedArray, IObsArraySplice, ObsArray, obsArray, Observable } from 'grainjs';
import { Disposable, dom, DomContents, Holder, styled } from 'grainjs';

export interface IToken {
  label: string;
}

export interface ITokenFieldOptions {
  initialValue: IToken[];
  renderToken: (token: IToken) => DomContents;
  createToken: (inputText: string) => IToken|undefined;
  acOptions?: IAutocompleteOptions<IToken & ACItem>;
  openAutocompleteOnFocus?: boolean;

  // Allows overriding how tokens are copied to the clipboard, or retrieved from it.
  // By default, tokens are placed into clipboard as text/plain comma-separated token labels, with
  // CSV escaping, and pasted from clipboard by applying createToken() to parsed CSV text.
  tokensToClipboard?: (tokens: IToken[], clipboard: DataTransfer) => void;
  clipboardToTokens?: (clipboard: DataTransfer) => IToken[];
}

// TokenWrap serves to distinguish multiple instances of the same token in the list.
class TokenWrap {
  constructor(public token: IToken) {}
}

class UndoItem {
  constructor(public redo: () => void, public undo: () => void) {}
}

export class TokenField extends Disposable {
  public tokensObs: ObsArray<IToken>;

  private _acHolder = Holder.create<Autocomplete<IToken & ACItem>>(this);
  private _acOptions: IAutocompleteOptions<IToken & ACItem>|undefined;
  private _rootElem: HTMLElement;
  private _textInput: HTMLInputElement;

  // ClipboardAPI events work as expected only when the focus is in an actual input.
  // This is where we place focus when we have some tokens selected.
  private _hiddenInput: HTMLInputElement;

  // Keys to navigate tokens. In a vertical list, these would be changed to Up/Down.
  // TODO Support a vertical list.
  private _keyPrev = 'ArrowLeft';
  private _keyNext = 'ArrowRight';

  private _tokens = this.autoDispose(obsArray<TokenWrap>());
  private _selection = Observable.create(this, new Set<TokenWrap>());
  private _selectionAnchor: TokenWrap|null = null;
  private _undoStack: UndoItem[] = [];
  private _undoIndex = 0;   // The last action done; next to undo.
  private _inUndoRedo = false;

  constructor(private _options: ITokenFieldOptions) {
    super();
    const addSelectedItem = this._addSelectedItem.bind(this);
    const openAutocomplete = this._openAutocomplete.bind(this);
    this._acOptions = _options.acOptions && {..._options.acOptions, onClick: addSelectedItem};
    this._tokens.set(_options.initialValue.map(t => new TokenWrap(t)));
    this.tokensObs = this.autoDispose(computedArray(this._tokens, t => t.token));

    // We can capture undo info in a consistent way as long as we change _tokens using its
    // obsArray interface, by listening to the splice events.
    this.autoDispose(this._tokens.addListener(this._recordUndo.bind(this)));

    this._rootElem = cssTokenField(
      {tabIndex: '-1'},
      dom.forEach(this._tokens, (t) =>
        cssToken(this._options.renderToken(t.token),
          cssDeleteIcon('CrossSmall', testId('tokenfield-delete')),
          dom.cls('selected', (use) => use(this._selection).has(t)),
          dom.on('click', (ev) => this._onTokenClick(ev, t)),
          dom.on('mousedown', (ev) => this._onMouseDown(ev, t)),
          testId('tokenfield-token')
        ),
      ),
      cssInputWrapper(
        this._textInput = cssTokenInput(
          dom.on('focus', this._onInputFocus.bind(this)),
          dom.on('blur', () => { this._acHolder.clear(); }),
          dom.onKeyDown({
            Escape: () => { this._acHolder.clear(); },
            Enter: addSelectedItem,
            ArrowDown$: openAutocomplete,
            Tab$: (ev) => {
              // Only treat tab specially if there is some token-adding in progress.
              if (this._textInput.value !== '' || !this._acHolder.isEmpty()) {
                ev.stopPropagation();
                ev.preventDefault();
                addSelectedItem();
              }
            },
          }),
          dom.on('input', openAutocomplete),
          testId('tokenfield-input'),
        ),
      ),
      dom.onKeyDown({
        a$: this._maybeSelectAllTokens.bind(this),
        Backspace$: this._maybeBackspace.bind(this),
        Delete$: this._maybeDelete.bind(this),
        [this._keyPrev + '$']: (ev) => this._maybeAdvance(ev, -1),
        [this._keyNext + '$']: (ev) => this._maybeAdvance(ev, +1),
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
      dom.on('focus', () => this._hiddenInput.focus()),
      dom.on('copy', this._onCopyEvent.bind(this)),
      dom.on('cut', this._onCutEvent.bind(this)),
      dom.on('paste', this._onPasteEvent.bind(this)),
      testId('tokenfield'),
    );
  }

  public attach(elem: HTMLElement): void {
    elem.appendChild(this._rootElem);
  }

  // Open the autocomplete dropdown, if autocomplete was configured in the options.
  private _openAutocomplete() {
    if (this._acOptions && this._acHolder.isEmpty()) {
      Autocomplete.create(this._acHolder, this._textInput, this._acOptions);
    }
  }

  // Adds the typed-in or selected item. If an item is selected in autocomplete dropdown, adds
  // that; otherwise if options.createToken is present, creates a token from text input value.
  private _addSelectedItem() {
    let item: IToken|undefined = this._acHolder.get()?.getSelectedItem();
    if (!item && this._options.createToken && this._textInput.value) {
      item = this._options.createToken(this._textInput.value);
    }
    if (item) {
      this._tokens.push(new TokenWrap(item));
      this._textInput.value = '';
      this._acHolder.clear();
    }
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
  private _onTokenClick(ev: MouseEvent, t: TokenWrap) {
    const idx = this._tokens.get().indexOf(t);
    if (idx < 0) { return; }
    if (ev.target && (ev.target as HTMLElement).matches('.' + cssDeleteIcon.className)) {
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
      let next: TokenWrap|null = null;
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

  private _toggleTokenSelection(token: TokenWrap) {
    const selection = this._selection.get();
    if (selection.has(token)) {
      selection.delete(token);
    } else {
      selection.add(token);
    }
    // We use .setAndTrigger() to set a value that's identical (by reference) to the previous one.
    this._selection.setAndTrigger(selection);
  }

  private _resetTokenSelection(token: TokenWrap|null) {
    this._selectionAnchor = token;
    this._selection.set(token ? new Set([token]) : new Set());
  }

  // Delete the given set of tokens, and select either the following or the preceding one.
  private _deleteTokens(toDelete: Set<TokenWrap>, advance: 1|-1|0) {
    if (this._selection.get().size === 0) { return; }
    const selectAfter = advance ? this._getNextToken(toDelete, advance) : null;
    this._tokens.set(this._tokens.get().filter(t => !toDelete.has(t)));
    this._resetTokenSelection(selectAfter);
    this._setFocus();
  }

  private _getNextToken(selection: Set<TokenWrap>, advance: 1|-1): TokenWrap|null {
    const [first, last] = this._getSelectedIndexRange(selection);
    if (last < 0) { return null; }
    return this._tokens.get()[advance > 0 ? last + 1 : first - 1] || null;
  }

  private _getSelectedIndexRange(selection: Set<TokenWrap>): [number, number] {
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
    let tokens: IToken[];
    if (this._options.clipboardToTokens) {
      tokens = this._options.clipboardToTokens(ev.clipboardData);
    } else {
      const text = ev.clipboardData.getData('text/plain');
      const values = csvDecodeRow(text);
      tokens = values.map(v => this._options.createToken(v)).filter((t): t is IToken => Boolean(t));
    }
    if (!tokens.length) { return; }
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
  private _onMouseDown(startEvent: MouseEvent, t: TokenWrap) {
    const xInitial = startEvent.clientX;
    const yInitial = startEvent.clientY;
    const dragTargetSelector = `.${cssToken.className}, .${cssInputWrapper.className}`;

    let started = false;
    let allTargets: HTMLElement[];
    let tokenList: HTMLElement[];

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
        allTargets.forEach(el => el.classList.add(cssDragTarget.className));

        // Get a list of element we are dragging, and add a CSS class to show them as dragged.
        tokenList = allTargets.filter(el => el.matches('.selected'));
        tokenList.forEach(el => el.classList.add('token-dragging'));
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
      allTargets.forEach(el => el.classList.remove(cssDragTarget.className));
      tokenList.forEach(el => el.classList.remove('token-dragging'));
      tokenList.forEach(el => { el.style.transform = ''; });

      // Find the token before which we are inserting the dragged elements. If inserting at the
      // end (just before or over the input box), destToken will be undefined.
      const index = allTargets.indexOf(ev.target as HTMLElement);
      if (index < 0) { return; }
      const destToken: TokenWrap|undefined = this._tokens.get()[index];

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

  private _recordUndo(val: TokenWrap[], prev: TokenWrap[], change?: IObsArraySplice<TokenWrap>) {
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
}

const cssTokenField = styled('div', `
  display: flex;
  border: 1px solid ${colors.darkGrey};
  border-radius: 3px;
  padding: 0 4px;

  &.token-dragactive {
    cursor: grabbing;
  }
`);

const cssToken = styled('div', `
  position: relative;
  flex: none;
  border-radius: 3px;
  background-color: ${colors.mediumGreyOpaque};
  padding: 4px;
  margin: 3px 2px;
  line-height: 16px;
  user-select: none;
  cursor: grab;

  &.selected {
    background-color: ${colors.darkGrey};
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
  flex: auto;
  -webkit-appearance: none;
  -moz-appearance: none;
  padding: 0;
  border: none;
  outline: none;
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
    background-color: ${colors.lightGreen};
    width: 2px;
    top: 0px;
    bottom: 0px;
    left: -4px;
  }
`);

const cssHiddenInput = styled('input', `
  left: -10000px;
  width: 1px;
  position: absolute;
`);

const cssDeleteIcon = styled(icon, `
  vertical-align: bottom;
  margin-left: 4px;
  cursor: pointer;
  --icon-color: ${colors.slate};
  &:hover {
    --icon-color: ${colors.dark};
  }
  .${cssTokenField.className}.token-dragactive & {
    cursor: unset;
  }
`);
