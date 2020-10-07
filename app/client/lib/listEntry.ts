import {basicButton, primaryButton} from 'app/client/ui2018/buttons';
import {colors, testId} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {Computed, Disposable, dom, DomContents, DomElementArg, Observable, styled} from 'grainjs';
import isEqual = require('lodash/isEqual');
import uniq = require('lodash/uniq');

/**
 * ListEntry class to build a textarea of unique newline separated values, with a nice
 * display mode when the values are not being edited.
 *
 * Usage:
 * > dom.create(ListEntry, values, (vals) => choices.saveOnly(vals));
 */
export class ListEntry extends Disposable {
  // Should start in edit mode if there are no initial values.
  private _isEditing: Observable<boolean> = Observable.create(this, this._values.get().length === 0);
  private _textVal: Observable<string> = Observable.create(this, "");

  constructor(
    private _values: Observable<string[]>,
    private _onSave: (values: string[]) => void
  ) {
    super();

    // Since the saved values can be modified outside the ListEntry (via undo/redo),
    // add a listener to update edit status on changes.
    this.autoDispose(this._values.addListener(values => {
      if (values.length === 0) { this._textVal.set(""); }
      this._isEditing.set(values.length === 0);
    }));
  }

  // Arg maxRows indicates the number of rows to display when the textarea is inactive.
  public buildDom(maxRows: number = 6): DomContents {
    return dom.domComputed(this._isEditing, (editMode) => {
      if (editMode) {
        // Edit mode dom.
        let textArea: HTMLTextAreaElement;
        return cssVerticalFlex(
          cssListBox(
            textArea = cssListTextArea(
              dom.prop('value', this._textVal),
              dom.on('input', (ev, elem) => this._textVal.set(elem.value)),
              (elem) => this._focusOnOpen(elem),
              dom.on('blur', (ev, elem) => { setTimeout(() => this._save(elem), 0); }),
              dom.onKeyDown({Escape: (ev, elem) => this._save(elem)}),
              // Keep height to be two rows taller than the number of text rows
              dom.style('height', (use) => {
                const rows = use(this._textVal).split('\n').length;
                return `${(rows + 2) * 22}px`;
              })
            ),
            cssHelpLine(
              cssIdeaIcon('Idea'), 'Type one option per line'
            ),
            testId('list-entry')
          ),
          // Show buttons if the textArea has or had valid text content
          dom.maybe((use) => use(this._values).length > 0 || use(this._textVal).trim().length > 0, () =>
            cssButtonRow(
              primaryButton('Save', {style: 'margin-right: 8px;'},
                // Prevent textarea focus loss on mousedown
                dom.on('mousedown', (ev) => ev.preventDefault()),
                dom.on('click', () => this._save(textArea)),
                testId('list-entry-save')
              ),
              basicButton('Cancel',
                // Prevent textarea focus loss on mousedown
                dom.on('mousedown', (ev) => ev.preventDefault()),
                dom.on('click', () => this._cancel()),
                testId('list-entry-cancel')
              )
            )
          )
        );
      } else {
        // Inactive display dom.
        const someValues = Computed.create(null, this._values, (use, values) =>
          values.length <= maxRows ? values : values.slice(0, maxRows - 1));
        return cssListBoxInactive(
          dom.autoDispose(someValues),
          dom.forEach(someValues, val => this._row(val)),
          // Show description row for any remaining rows
          dom.maybe(use => use(this._values).length > maxRows, () =>
            this._row(
              dom.text((use) => `+${use(this._values).length - (maxRows - 1)} more`)
            )
          ),
          dom.on('click', () => this._startEditing()),
          testId('list-entry')
        );
      }
    });
  }

  // Build a display row with the given text value
  private _row(...domArgs: DomElementArg[]): Element {
    return cssListRow(
      ...domArgs,
      testId('list-entry-row')
    );
  }

  // Indicates whether the listEntry currently has saved values.
  private _hasValues(): boolean {
    return this._values.get().length > 0;
  }

  private _startEditing(): void {
    this._textVal.set(this._hasValues() ? (this._values.get().join('\n') + '\n') : '');
    this._isEditing.set(true);
  }

  private _save(elem: HTMLTextAreaElement): void {
    if (!this._isEditing.get()) { return; }
    const newValues = uniq(
      elem.value.split('\n')
      .map(val => val.trim())
      .filter(val => val !== '')
    );
    // Call user save function if the values have changed.
    if (!isEqual(this._values.get(), newValues)) {
      // Because of the listener on this._values, editing will stop if values are updated.
      this._onSave(newValues);
    } else {
      this._cancel();
    }
  }

  private _cancel(): void {
    if (this._hasValues()) {
      this._isEditing.set(false);
    } else {
      this._textVal.set("");
    }
  }

  private _focusOnOpen(elem: HTMLTextAreaElement): void {
    // Do not grab focus if the textArea is empty, since it indicates that the listEntry
    // started in edit mode, and was not set to be so by the user.
    if (this._textVal.get()) {
      setTimeout(() => focus(elem), 0);
    }
  }
}

// Helper to focus on the textarea and select/scroll to the bottom
function focus(elem: HTMLTextAreaElement) {
  elem.focus();
  elem.setSelectionRange(elem.value.length, elem.value.length);
  elem.scrollTo(0, elem.scrollHeight);
}

const cssListBox = styled('div', `
  width: 100%;
  background-color: white;
  padding: 1px;
  border: 1px solid ${colors.hover};
  border-radius: 4px;
`);

const cssListBoxInactive = styled(cssListBox, `
  cursor: pointer;
  border: 1px solid ${colors.darkGrey};

  &:hover {
    border: 1px solid ${colors.hover};
  }
`);

const cssListTextArea = styled('textarea', `
  width: 100%;
  max-height: 150px;
  padding: 2px 12px;
  line-height: 22px;
  border: none;
  outline: none;
  resize: none;
`);

const cssListRow = styled('div', `
  margin: 4px;
  padding: 4px 8px;
  color: ${colors.dark};
  background-color: ${colors.mediumGrey};
  border-radius: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
`);

const cssHelpLine = styled('div', `
  display: flex;
  margin: 2px 8px 8px 8px;
  color: ${colors.slate};
`);

const cssIdeaIcon = styled(icon, `
  background-color: ${colors.lightGreen};
  margin-right: 4px;
`);

const cssVerticalFlex = styled('div', `
  width: 100%;
  display: flex;
  flex-direction: column;
`);

const cssButtonRow = styled('div', `
  display: flex;
  margin: 16px 0;
`);
