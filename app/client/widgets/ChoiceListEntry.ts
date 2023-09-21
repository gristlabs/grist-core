import {IToken, TokenField} from 'app/client/lib/TokenField';
import {cssBlockedCursor} from 'app/client/ui/RightPanelStyles';
import {basicButton, primaryButton} from 'app/client/ui2018/buttons';
import {colorButton, ColorOption} from 'app/client/ui2018/ColorSelect';
import {testId, theme} from 'app/client/ui2018/cssVars';
import {editableLabel} from 'app/client/ui2018/editableLabel';
import {icon} from 'app/client/ui2018/icons';
import {ChoiceOptionsByName, IChoiceOptions} from 'app/client/widgets/ChoiceTextBox';
import {Computed, Disposable, dom, DomContents, DomElementArg, Holder, MultiHolder, Observable, styled} from 'grainjs';
import {createCheckers, iface, ITypeSuite, opt, union} from 'ts-interface-checker';
import isEqual = require('lodash/isEqual');
import uniqBy = require('lodash/uniqBy');

class RenameMap implements Record<string, string> {
  constructor(tokens: ChoiceItem[]) {
    for(const {label, previousLabel: id} of tokens.filter(x=> x.previousLabel)) {
      if (label === id) {
        continue;
      }
      this[id!] = label;
    }
  }
  [key: string]: string;
}


class ChoiceItem implements IToken {
  public static from(item: ChoiceItem) {
    return new ChoiceItem(item.label, item.previousLabel, item.options);
  }
  constructor(
    public label: string,
    // We will keep the previous label value for a token, to tell us which token
    // was renamed. For new tokens this should be null.
    public previousLabel: string | null,
    public options?: IChoiceOptions
  ) {}

  public rename(label: string) {
    return new ChoiceItem(label, this.previousLabel, this.options);
  }

  public changeStyle(options: IChoiceOptions) {
    return new ChoiceItem(this.label, this.previousLabel, {...this.options, ...options});
  }
}

const ChoiceItemType = iface([], {
  label: "string",
  previousLabel: union("string", "null"),
  options: opt("ChoiceOptionsType"),
});

const ChoiceOptionsType = iface([], {
  textColor: opt("string"),
  fillColor: opt("string"),
  fontBold: opt("boolean"),
  fontUnderline: opt("boolean"),
  fontItalic: opt("boolean"),
  fontStrikethrough: opt("boolean"),
});

const choiceTypes: ITypeSuite = {
  ChoiceItemType,
  ChoiceOptionsType,
};

const {ChoiceItemType: ChoiceItemChecker} = createCheckers(choiceTypes);

/**
 * ChoiceListEntry - Editor for choices and choice colors.
 *
 * The ChoiceListEntry can be in one of two modes: edit or view (default).
 *
 * When in edit mode, it displays a custom, vertical TokenField that allows for entry
 * of new choice values. Once changes are saved, the new values become valid choices,
 * and can be used in Choice and Choice List columns. Each choice in the TokenField
 * also includes a color picker button to customize the fill/text color of the choice.
 * The same capabilities of TokenField, such as undo/redo and rich copy/paste support,
 * are present in ChoiceListEntry as well.
 *
 * When in view mode, it looks similar to edit mode, but hides the bottom input and the
 * color picker dropdown buttons. Past 6 choices, it stops rendering individual choices
 * and only shows the total number of additional choices that are hidden, and can be
 * seen when edit mode is activated.
 *
 * Usage:
 * > dom.create(ChoiceListEntry, values, options, (vals, options) => {});
 */
export class ChoiceListEntry extends Disposable {
  private _isEditing: Observable<boolean> = Observable.create(this, false);
  private _tokenFieldHolder: Holder<TokenField<ChoiceItem>> = Holder.create(this);

  private _editorContainer: HTMLElement | null = null;
  private _editorSaveButtons: HTMLElement | null = null;

  constructor(
    private _values: Observable<string[]>,
    private _choiceOptionsByName: Observable<ChoiceOptionsByName>,
    private _onSave: (values: string[], choiceOptions: ChoiceOptionsByName, renames: Record<string, string>) => void,
    private _disabled: Observable<boolean>,
    private _mixed: Observable<boolean>,
  ) {
    super();

    // Since the saved values can be modified outside the ChoiceListEntry (via undo/redo),
    // add a listener to update edit status on changes.
    this.autoDispose(this._values.addListener(() => {
      this._cancel();
    }));

    this.onDispose(() => {
      if (!this._isEditing.get()) { return; }

      this._save();
    });
  }

  // Arg maxRows indicates the number of rows to display when the editor is inactive.
  public buildDom(maxRows: number = 6): DomContents {
    return dom.domComputed(this._isEditing, (editMode) => {
      if (editMode) {
        // If we have mixed values, we can't show any options on the editor.
        const initialValue = this._mixed.get() ? [] : this._values.get().map(label => {
          return new ChoiceItem(label, label, this._choiceOptionsByName.get().get(label));
        });
        const tokenField = TokenField.ctor<ChoiceItem>().create(this._tokenFieldHolder, {
          initialValue,
          renderToken: token => this._renderToken(token),
          createToken: label => new ChoiceItem(label, null),
          clipboardToTokens: clipboardToChoices,
          tokensToClipboard: (tokens, clipboard) => {
            // Save tokens as JSON for parts of the UI that support deserializing it properly (e.g. ChoiceListEntry).
            clipboard.setData('application/json', JSON.stringify(tokens));
            // Save token labels as newline-separated text, for general use (e.g. pasting into cells).
            clipboard.setData('text/plain', tokens.map(t => t.label).join('\n'));
          },
          openAutocompleteOnFocus: false,
          trimLabels: true,
          styles: {cssTokenField, cssToken, cssTokenInput, cssInputWrapper, cssDeleteButton, cssDeleteIcon},
          keyBindings: {
            previous: 'ArrowUp',
            next: 'ArrowDown'
          },
          variant: 'vertical',
        });

        return cssVerticalFlex(
          this._editorContainer = cssListBox(
            {tabIndex: '-1'},
            elem => {
              tokenField.attach(elem);
              this._focusOnOpen(tokenField.getTextInput());
            },
            dom.on('focusout', (ev) => {
              const hasActiveElement = (
                element: Element | null,
                activeElement = document.activeElement
              ) => {
                return element?.contains(activeElement);
              };

              // Save and close the editor when it loses focus.
              setTimeout(() => {
                // The editor may have already been closed via keyboard shortcut.
                if (!this._isEditing.get()) { return; }

                if (
                  // Don't close if focus hasn't left the editor.
                  hasActiveElement(this._editorContainer) ||
                  // Or if the token color picker has focus.
                  hasActiveElement(document.querySelector('.token-color-picker')) ||
                  // Or if Save or Cancel was clicked.
                  hasActiveElement(this._editorSaveButtons, ev.relatedTarget as Element | null)
                ) {
                  return;
                }

                this._save();
              }, 0);
            }),
            testId('choice-list-entry')
          ),
          this._editorSaveButtons = cssButtonRow(
            primaryButton('Save',
              dom.on('click', () => this._save() ),
              testId('choice-list-entry-save')
            ),
            basicButton('Cancel',
              dom.on('click', () => this._cancel()),
              testId('choice-list-entry-cancel')
            )
          ),
          dom.onKeyDown({Escape: () => this._cancel()}),
          dom.onKeyDown({Enter: () => this._save()}),
        );
      } else {
        const holder = new MultiHolder();
        const someValues = Computed.create(holder, this._values, (_use, values) =>
          values.length <= maxRows ? values : values.slice(0, maxRows - 1));
        const noChoices = Computed.create(holder, someValues, (_use, values) => values.length === 0);


        return cssVerticalFlex(
          dom.autoDispose(holder),
          dom.maybe(this._mixed, () => [
            cssListBoxInactive(
              dom.cls(cssBlockedCursor.className, this._disabled),
              row('Mixed configuration')
            )
          ]),
          dom.maybe(use => !use(this._mixed), () => [
            cssListBoxInactive(
              dom.cls(cssBlockedCursor.className, this._disabled),
              dom.maybe(noChoices, () => row('No choices configured')),
              dom.domComputed(this._choiceOptionsByName, (choiceOptions) =>
                dom.forEach(someValues, val => {
                  return row(
                    cssTokenColorInactive(
                      dom.style('background-color', getFillColor(choiceOptions.get(val)) || '#FFFFFF'),
                      dom.style('color', getTextColor(choiceOptions.get(val)) || '#000000'),
                      dom.cls('font-bold', choiceOptions.get(val)?.fontBold ?? false),
                      dom.cls('font-underline', choiceOptions.get(val)?.fontUnderline ?? false),
                      dom.cls('font-italic', choiceOptions.get(val)?.fontItalic ?? false),
                      dom.cls('font-strikethrough', choiceOptions.get(val)?.fontStrikethrough ?? false),
                      'T',
                      testId('choice-list-entry-color')
                    ),
                    cssTokenLabel(
                      val,
                      testId('choice-list-entry-label')
                    )
                  );
                }),
              ),
              // Show description row for any remaining rows
              dom.maybe(use => use(this._values).length > maxRows, () =>
                row(
                  dom('span',
                    testId('choice-list-entry-label'),
                    dom.text((use) => `+${use(this._values).length - (maxRows - 1)} more`)
                  )
                )
              ),
              dom.on('click', () => this._startEditing()),
              cssListBoxInactive.cls("-disabled", this._disabled),
              testId('choice-list-entry')
            ),
          ]),
          dom.maybe(use => !use(this._disabled), () => [
            cssButtonRow(
              primaryButton(
                dom.text(use => use(this._mixed) ? 'Reset' : 'Edit'),
                dom.on('click', () => this._startEditing()),
                testId('choice-list-entry-edit')
              ),
            ),
          ]),
        );
      }
    });
  }

  private _startEditing(): void {
    if (!this._disabled.get()) {
      this._isEditing.set(true);
    }
  }

  private _save(): void {
    const tokenField = this._tokenFieldHolder.get();
    if (!tokenField) { return; }

    const tokens = tokenField.tokensObs.get();
    const tokenInputVal = tokenField.getTextInputValue();
    if (tokenInputVal !== '') {
      tokens.push(new ChoiceItem(tokenInputVal, null));
    }

    const newTokens = uniqBy(tokens, t => t.label);
    const newValues = newTokens.map(t => t.label);
    const newOptions: ChoiceOptionsByName = new Map();
    const keys: Array<keyof IChoiceOptions> = [
      'fillColor', 'textColor', 'fontBold', 'fontItalic', 'fontStrikethrough', 'fontUnderline'
    ];
    for (const t of newTokens) {
      if (t.options) {
        const options: IChoiceOptions = {};
        keys.filter(k => t.options![k] !== undefined)
            .forEach(k => options[k] = t.options![k] as any);
        newOptions.set(t.label, options);
      }
    }

    // Call user save function if the values and/or options have changed.
    if (!isEqual(this._values.get(), newValues)
      || !isEqual(this._choiceOptionsByName.get(), newOptions)) {
      // Because of the listener on this._values, editing will stop if values are updated.
      this._onSave(newValues, newOptions, new RenameMap(newTokens));
    } else {
      this._cancel();
    }
  }

  private _cancel(): void {
    this._isEditing.set(false);
  }

  private _focusOnOpen(elem: HTMLInputElement): void {
    setTimeout(() => focus(elem), 0);
  }

  private _renderToken(token: ChoiceItem) {
    const fillColorObs = Observable.create(null, getFillColor(token.options));
    const textColorObs = Observable.create(null, getTextColor(token.options));
    const fontBoldObs = Observable.create(null, token.options?.fontBold);
    const fontItalicObs = Observable.create(null, token.options?.fontItalic);
    const fontUnderlineObs = Observable.create(null, token.options?.fontUnderline);
    const fontStrikethroughObs = Observable.create(null, token.options?.fontStrikethrough);
    const choiceText = Observable.create(null, token.label);

    const rename = async (to: string) => {
      const tokenField = this._tokenFieldHolder.get();
      if (!tokenField) { return; }

      to = to.trim();
      // If user removed the label, revert back to original one.
      if (!to) {
        choiceText.set(token.label);
      } else {
        tokenField.replaceToken(token.label, ChoiceItem.from(token).rename(to));
        // We don't need to update choiceText, since it will be replaced (rerendered).
      }
    };

    function stopPropagation(ev: Event) {
      ev.stopPropagation();
    }

    const focusOnNew = () => {
      const tokenField = this._tokenFieldHolder.get();
      if (!tokenField) { return; }
      focus(tokenField.getTextInput());
    };

    const tokenColorAndLabel: HTMLDivElement = cssColorAndLabel(
      dom.autoDispose(fillColorObs),
      dom.autoDispose(textColorObs),
      dom.autoDispose(choiceText),
      colorButton(
        {
          styleOptions: {
            textColor: new ColorOption({color: textColorObs, defaultColor: '#000000'}),
            fillColor: new ColorOption(
              {color: fillColorObs, allowsNone: true, noneText: 'none', defaultColor: '#FFFFFF'}),
            fontBold: fontBoldObs,
            fontItalic: fontItalicObs,
            fontUnderline: fontUnderlineObs,
            fontStrikethrough: fontStrikethroughObs
          },
          onSave: async () => {
            const tokenField = this._tokenFieldHolder.get();
            if (!tokenField) { return; }

            const fillColor = fillColorObs.get();
            const textColor = textColorObs.get();
            const fontBold = fontBoldObs.get();
            const fontItalic = fontItalicObs.get();
            const fontUnderline = fontUnderlineObs.get();
            const fontStrikethrough = fontStrikethroughObs.get();
            tokenField.replaceToken(token.label, ChoiceItem.from(token).changeStyle({
              fillColor,
              textColor,
              fontBold,
              fontItalic,
              fontUnderline,
              fontStrikethrough,
            }));
          },
          onClose: () => this._editorContainer?.focus(),
          colorPickerDomArgs: [
            dom.cls('token-color-picker'),
          ],
        },
      ),
      editableLabel(choiceText, {
        save: rename,
        inputArgs: [
          testId('token-label'),
          // Don't bubble up keyboard events, use them for editing the text.
          // Without this keys like Backspace, or Mod+a will propagate and modify all tokens.
          dom.on('keydown', stopPropagation),
          dom.on('copy', stopPropagation),
          dom.on('cut', stopPropagation),
          dom.on('paste', stopPropagation),
          dom.onKeyDown({
            // On enter, focus on the input element.
            Enter : focusOnNew,
            // On escape, focus on the token (i.e. the parent node of this element). That way
            // the browser will scroll the view if needed, and a subsequent escape will close
            // the editor.
            Escape: () => tokenColorAndLabel.parentElement?.focus(),
          }),
          // Don't bubble up click, as it would change focus.
          dom.on('click', stopPropagation),
          dom.cls(cssEditableLabelInput.className),
        ],
        args: [dom.cls(cssEditableLabel.className)],
      }),
    );

    return [
      tokenColorAndLabel,
      dom.onKeyDown({Escape$: () => this._cancel()}),
    ];
  }
}


// Helper to focus on the token input and select/scroll to the bottom
function focus(elem: HTMLInputElement) {
  elem.focus();
  elem.setSelectionRange(elem.value.length, elem.value.length);
  elem.scrollTo(0, elem.scrollHeight);
}

// Build a display row with the given DOM arguments
function row(...domArgs: DomElementArg[]): Element {
  return cssListRow(
    ...domArgs,
    testId('choice-list-entry-row')
  );
}

function getTextColor(choiceOptions?: IChoiceOptions) {
  return choiceOptions?.textColor;
}

function getFillColor(choiceOptions?: IChoiceOptions) {
  return choiceOptions?.fillColor;
}

/**
 * Converts clipboard contents (if any) to choices.
 *
 * Attempts to convert from JSON first, if clipboard contains valid JSON.
 * If conversion is not possible, falls back to converting from newline-separated plaintext.
 */
function clipboardToChoices(clipboard: DataTransfer): ChoiceItem[] {
  const maybeTokens = clipboard.getData('application/json');
  if (maybeTokens && isJSON(maybeTokens)) {
    const tokens: ChoiceItem[] = JSON.parse(maybeTokens);
    if (Array.isArray(tokens) && tokens.every((t): t is ChoiceItem => ChoiceItemChecker.test(t))) {
      tokens.forEach(t => t.previousLabel = null);
      return tokens;
    }
  }

  const maybeText = clipboard.getData('text/plain');
  if (maybeText) {
    return maybeText.split('\n').map(label => new ChoiceItem(label, null));
  }

  return [];
}

function isJSON(string: string) {
  try {
    JSON.parse(string);
    return true;
  } catch {
    return false;
  }
}

const cssListBox = styled('div', `
  width: 100%;
  padding: 1px;
  line-height: 1.5;
  padding-left: 4px;
  padding-right: 4px;
  border: 1px solid ${theme.choiceEntryBorderHover};
  border-radius: 4px;
  background-color: ${theme.choiceEntryBg};
`);

const cssListBoxInactive = styled(cssListBox, `
  cursor: pointer;
  border: 1px solid ${theme.choiceEntryBorder};

  &:hover:not(&-disabled) {
    border: 1px solid ${theme.choiceEntryBorderHover};
  }
  &-disabled {
    opacity: 0.4;
  }
`);

const cssListRow = styled('div', `
  display: flex;
  margin-top: 4px;
  margin-bottom: 4px;
  padding: 4px 8px;
  color: ${theme.choiceTokenFg};
  background-color: ${theme.choiceTokenBg};
  border-radius: 3px;
  text-overflow: ellipsis;
`);

const cssTokenField = styled('div', `
  &.token-dragactive {
    cursor: grabbing;
  }
`);

const cssToken = styled(cssListRow, `
  position: relative;
  display: flex;
  justify-content: space-between;
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
  &:focus {
    outline: none;
  }
`);

const cssTokenColorInactive = styled('div', `
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
`);

const cssTokenLabel = styled('span', `
  margin-left: 6px;
  display: inline-block;
  text-overflow: ellipsis;
  white-space: pre;
  overflow: hidden;
`);

const cssEditableLabelInput = styled('input', `
  display: inline-block;
  text-overflow: ellipsis;
  white-space: pre;
  overflow: hidden;
`);

const cssEditableLabel = styled('div', `
  margin-left: 6px;
  text-overflow: ellipsis;
  white-space: pre;
  overflow: hidden;
`);

const cssTokenInput = styled('input', `
  background-color: ${theme.choiceEntryBg};
  padding-top: 4px;
  padding-bottom: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: auto;
  -webkit-appearance: none;
  -moz-appearance: none;
  border: none;
  outline: none;
`);

const cssInputWrapper = styled('div', `
  margin-top: 4px;
  margin-bottom: 4px;
  position: relative;
  flex: auto;
  display: flex;
`);

const cssFlex = styled('div', `
  display: flex;
`);

const cssColorAndLabel = styled(cssFlex, `
  max-width: calc(100% - 20px);
`);

const cssVerticalFlex = styled('div', `
  width: 100%;
  display: flex;
  flex-direction: column;
`);

const cssButtonRow = styled('div', `
  gap: 8px;
  display: flex;
  margin-top: 8px;
  margin-bottom: 16px;
`);

const cssDeleteButton = styled('div', `
  display: inline;
  float: right;
  margin-left: 4px;
  cursor: pointer;
  .${cssTokenField.className}.token-dragactive & {
    cursor: unset;
  }
`);

 const cssDeleteIcon = styled(icon, `
   --icon-color: ${theme.text};
   opacity: 0.6;
   &:hover {
     opacity: 1.0;
   }
 `);
