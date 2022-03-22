import { darker, lighter } from "app/client/ui2018/ColorPalette";
import { colors, testId, vars } from 'app/client/ui2018/cssVars';
import { textInput } from "app/client/ui2018/editableLabel";
import { icon } from "app/client/ui2018/icons";
import { isValidHex } from "app/common/gutil";
import { cssSelectBtn } from 'app/client/ui2018/select';
import { Computed, Disposable, dom, DomArg, Observable, onKeyDown, styled } from "grainjs";
import { defaultMenuOptions, IOpenController, setPopupToCreateDom } from "popweasel";

/**
 * colorSelect allows to select color for both fill and text cell color. It allows for fast
 * selection thanks to two color palette, `lighter` and `darker`, and also to pick custom color with
 * native color picker. Pressing Escape reverts to the saved value. Caller is expected to handle
 * logging of onSave() callback rejection. In case of rejection, values are reverted to their saved one.
 */
export function colorSelect(textColor: Observable<string|undefined>, fillColor: Observable<string|undefined>,
                            onSave: () => Promise<void>, allowNone = false): Element {
  const selectBtn = cssSelectBtn(
    cssContent(
      cssButtonIcon(
        'T',
        dom.style('color', use => use(textColor) || ''),
        dom.style('background-color', (use) => use(fillColor)?.slice(0, 7) || ''),
        cssLightBorder.cls(''),
        testId('btn-icon'),
      ),
      'Cell Color',
    ),
    icon('Dropdown'),
    testId('color-select'),
  );

  const domCreator = (ctl: IOpenController) => buildColorPicker(ctl, textColor, fillColor, onSave, allowNone);
  setPopupToCreateDom(selectBtn, domCreator, {...defaultMenuOptions, placement: 'bottom-end'});

  return selectBtn;
}

export function colorButton(textColor: Observable<string|undefined>, fillColor: Observable<string|undefined>,
  onSave: () => Promise<void>): Element {
  const iconBtn = cssIconBtn(
    icon(
      'Dropdown',
      dom.style('background-color', use => use(textColor) || ''),
      testId('color-button-dropdown')
    ),
    dom.style('background-color', (use) => use(fillColor)?.slice(0, 7) || ''),
    dom.on('click', (e) => { e.stopPropagation(); e.preventDefault(); }),
    testId('color-button'),
  );

  const domCreator = (ctl: IOpenController) => buildColorPicker(ctl, textColor, fillColor, onSave);
  setPopupToCreateDom(iconBtn, domCreator, { ...defaultMenuOptions, placement: 'bottom-end' });

  return iconBtn;
}

function buildColorPicker(ctl: IOpenController, textColor: Observable<string|undefined>,
                          fillColor: Observable<string|undefined>,
                          onSave: () => Promise<void>,
                          allowNone = false): Element {
  const textColorModel = PickerModel.create(null, textColor);
  const fillColorModel = PickerModel.create(null, fillColor);

  function revert() {
    textColorModel.revert();
    fillColorModel.revert();
    ctl.close();
  }

  ctl.onDispose(async () => {
    if (textColorModel.needsSaving() || fillColorModel.needsSaving()) {
      try {
        // TODO: disable the trigger btn while saving
        await onSave();
      } catch (e) {
        /* Does no logging: onSave() callback is expected to handle their reporting */
        textColorModel.revert();
        fillColorModel.revert();
      }
    }
    textColorModel.dispose();
    fillColorModel.dispose();
  });

  const colorSquare = (...args: DomArg[]) => cssColorSquare(
    ...args,
    dom.style('color', use => use(textColor) || ''),
    dom.style('background-color', use => use(fillColor) || ''),
    cssLightBorder.cls(''),
  );

  return cssContainer(
    dom.create(PickerComponent, fillColorModel, {
      colorSquare: colorSquare(),
      title: 'fill',
      defaultMode: 'lighter',
      allowNone
    }),
    cssVSpacer(),
    dom.create(PickerComponent, textColorModel, {
      colorSquare: colorSquare('T'),
      title: 'text',
      defaultMode: 'darker',
      allowNone
    }),

    // gives focus and binds keydown events
    (elem: any) => { setTimeout(() => elem.focus(), 0); },
    onKeyDown({
      Escape: () => { revert(); },
      Enter: () => { ctl.close(); },
    }),

    // Set focus when `focusout` is bubbling from a children element. This is to allow to receive
    // keyboard event again after user interacted with the hex box text input.
    dom.on('focusout', (ev, elem) => (ev.target !== elem) && elem.focus()),
  );
}

interface PickerComponentOptions {
  colorSquare: Element;
  title: string;
  defaultMode: 'darker'|'lighter';
  allowNone?: boolean;
}

// PickerModel is a helper model that helps keep track of the server value for an observable that
// needs to be changed locally without saving. To use, you must call `model.setValue(...)` instead
// of `obs.set(...)`. Then it offers `model.needsSaving()` that tells you whether current value
// needs saving, and `model.revert()` that reverts obs to the its server value.
class PickerModel extends Disposable {
  private _serverValue = this.obs.get();
  private _localChange: boolean = false;
  constructor(public obs: Observable<string|undefined>) {
    super();
    this.autoDispose(this.obs.addListener((val) => {
      if (this._localChange) { return; }
      this._serverValue = val;
    }));
  }

  // Set the value picked by the user
  public setValue(val: string|undefined) {
    this._localChange = true;
    this.obs.set(val);
    this._localChange = false;
  }

  // Revert obs to its server value
  public revert() {
    this.obs.set(this._serverValue);
  }

  // Is current value different from the server value?
  public needsSaving() {
    return this.obs.get() !== this._serverValue;
  }
}

class PickerComponent extends Disposable {

  private _color = Computed.create(this, this._model.obs, (use, val) => (val || '').toUpperCase().slice(0, 7));
  private _mode = Observable.create<'darker'|'lighter'>(this, this._guessMode());

  constructor(private _model: PickerModel, private _options: PickerComponentOptions) {
    super();
  }

  public buildDom() {
    const title = this._options.title;
    return [
      cssHeaderRow(
        cssColorPreview(
          dom.update(
            this._options.colorSquare,
            cssColorInput(
              {type: 'color'},
              dom.attr('value', this._color),
              dom.on('input', (ev, elem) => this._setValue(elem.value || undefined)),
              testId(`${title}-input`),
            ),
          ),
          cssHexBox(
            this._color,
            async (val) => {
              if ((this._options.allowNone && !val) || isValidHex(val)) {
                this._model.setValue(val);
              }
            },
            testId(`${title}-hex`),
            // select the hex value on click. Doing it using settimeout allows to avoid some
            // sporadically losing the selection just after the click.
            dom.on('click', (ev, elem) => setTimeout(() => elem.select(), 0)),
          )
        ),
        title,
        cssBrickToggle(
          cssBrick(
            cssBrick.cls('-selected', (use) => use(this._mode) === 'darker'),
            dom.on('click', () => this._mode.set('darker')),
            testId(`${title}-darker-brick`),
          ),
          cssBrick(
            cssBrick.cls('-lighter'),
            cssBrick.cls('-selected', (use) => use(this._mode) === 'lighter'),
            dom.on('click', () => this._mode.set('lighter')),
            testId(`${title}-lighter-brick`),
          ),
        ),
      ),
      cssPalette(
        dom.domComputed(this._mode, (mode) => (mode === 'lighter' ? lighter : darker).map(color => (
          cssColorSquare(
            dom.style('background-color', color),
            cssLightBorder.cls('', (use) => use(this._mode) === 'lighter'),
            cssColorSquare.cls('-selected', (use) => use(this._color) === color),
            dom.style('outline-color', (use) => use(this._mode) === 'lighter' ? '' : color),
            dom.on('click', () => {
              // Clicking same color twice - removes the selection.
              if (this._model.obs.get() === color &&
                  this._options.allowNone) {
                this._setValue(undefined);
              } else {
                this._setValue(color);
              }
            }),
            testId(`color-${color}`),
          )
        ))),
        testId(`${title}-palette`),
      ),
    ];
  }

  private _setValue(val: string|undefined) {
    this._model.setValue(val);
  }

  private _guessMode(): 'darker'|'lighter' {
    if (lighter.indexOf(this._color.get()) > -1) {
      return 'lighter';
    }
    if (darker.indexOf(this._color.get()) > -1) {
      return 'darker';
    }
    return this._options.defaultMode;
  }
}

const cssColorInput = styled('input', `
  opacity: 0;
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  padding: 0;
  border: none;
`);

const cssBrickToggle = styled('div', `
  display: flex;
`);

const cssBrick = styled('div', `
  height: 20px;
  width: 34px;
  background-color: #414141;
  box-shadow: inset 0 0 0 2px #FFFFFF;
  &-selected {
    border: 1px solid #414141;
    box-shadow: inset 0 0 0 1px #FFFFFF;
  }
  &-lighter {
    background-color: #DCDCDC;
  }
`);

const cssColorPreview = styled('div', `
  display: flex;
`);

const cssHeaderRow = styled('div', `
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  text-transform: capitalize;
`);


const cssPalette = styled('div', `
  width: 236px;
  height: 68px;
  display: flex;
  flex-direction: column;
  flex-wrap: wrap;
  justify-content: space-between;
  align-content: space-between;
`);

const cssVSpacer = styled('div', `
  height: 12px;
`);

const cssContainer = styled('div', `
  padding: 18px 16px;
  background-color: white;
  box-shadow: 0 2px 16px 0 rgba(38,38,51,0.6);
  z-index: 20;
  margin: 2px 0;
  &:focus {
    outline: none;
  }
`);

const cssContent = styled('div', `
  display: flex;
  align-items: center;
`);

const cssHexBox = styled(textInput, `
  border: 1px solid #D9D9D9;
  border-left: none;
  font-size: ${vars.smallFontSize};
  display: flex;
  align-items: center;
  color: ${colors.slate};
  width: 56px;
  outline: none;
  padding: 0 3px;
  height: unset;
  border-radius: unset;
`);

const cssLightBorder = styled('div', `
  border: 1px solid #D9D9D9;
`);

const cssColorSquare = styled('div', `
  width: 20px;
  height: 20px;
  display: flex;
  justify-content: center;
  align-items: center;
  position: relative;
  &-selected {
    outline: 1px solid #D9D9D9;
    outline-offset: 1px;
  }
`);

const cssButtonIcon = styled(cssColorSquare, `
  margin-right: 6px;
  margin-left: 4px;
`);

const cssIconBtn = styled('div', `
  min-width: 18px;
  width: 18px;
  height: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
`);
