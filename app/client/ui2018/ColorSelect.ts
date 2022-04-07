import {basicButton, primaryButton} from 'app/client/ui2018/buttons';
import {isLight, swatches} from 'app/client/ui2018/ColorPalette';
import {colors, testId, vars} from 'app/client/ui2018/cssVars';
import {textInput} from 'app/client/ui2018/editableLabel';
import {IconName} from 'app/client/ui2018/IconList';
import {icon} from 'app/client/ui2018/icons';
import {cssSelectBtn} from 'app/client/ui2018/select';
import {isValidHex} from 'app/common/gutil';
import {Computed, Disposable, dom, Observable, onKeyDown, styled} from 'grainjs';
import {defaultMenuOptions, IOpenController, setPopupToCreateDom} from 'popweasel';

export interface StyleOptions {
  textColor: ColorOption,
  fillColor: ColorOption,
  fontBold: Observable<boolean|undefined>,
  fontUnderline: Observable<boolean|undefined>,
  fontItalic: Observable<boolean|undefined>,
  fontStrikethrough: Observable<boolean|undefined>,
}

export class ColorOption {
  constructor(
    public color: Observable<string|undefined>,
    // If the color accepts undefined/empty as a value. Controls empty selector in the picker.
    public allowsNone: boolean = false,
    // Default color to show when value is empty or undefined (itself can be empty).
    public defaultColor: string = '',
    // Text to be shown in the picker when color is not set.
    public noneText: string = '',
    // Preview color to show when value is undefined.
    public previewNoneColor: string = '',) {
      if (defaultColor && allowsNone) {
        throw new Error("Allowing an empty value is not compatible with a default color");
      }
  }
}

/**
 * colorSelect allows to select color for both fill and text cell color. It allows for fast
 * selection thanks to two color palette, `lighter` and `darker`, and also to pick custom color with
 * native color picker. Pressing Escape reverts to the saved value. Caller is expected to handle
 * logging of onSave() callback rejection. In case of rejection, values are reverted to their saved one.
 */
export function colorSelect(
  styleOptions: StyleOptions,
  onSave: () => Promise<void>,
  placeholder = 'Default cell style'): Element {
  const {
    textColor,
    fillColor,
  } = styleOptions;
  const selectBtn = cssSelectBtn(
    cssContent(
      cssButtonIcon(
        'T',
        dom.style('color', use => use(textColor.color) || textColor.previewNoneColor),
        dom.style('background-color', (use) => use(fillColor.color)?.slice(0, 7) || fillColor.previewNoneColor),
        dom.cls('font-bold', use => use(styleOptions.fontBold) ?? false),
        dom.cls('font-italic', use => use(styleOptions.fontItalic) ?? false),
        dom.cls('font-underline', use => use(styleOptions.fontUnderline) ?? false),
        dom.cls('font-strikethrough', use => use(styleOptions.fontStrikethrough) ?? false),
        cssLightBorder.cls(''),
        testId('btn-icon'),
      ),
      placeholder,
    ),
    icon('Dropdown'),
    testId('color-select'),
  );

  const domCreator = (ctl: IOpenController) => buildColorPicker(ctl, styleOptions, onSave);
  setPopupToCreateDom(selectBtn, domCreator, {...defaultMenuOptions, placement: 'bottom-end'});

  return selectBtn;
}

export function colorButton(
  styleOptions: StyleOptions,
  onSave: () => Promise<void>): Element {
  const { textColor, fillColor } = styleOptions;
  const iconBtn = cssIconBtn(
    'T',
    dom.style('color', use => use(textColor.color) || textColor.previewNoneColor),
    dom.style('background-color', (use) => use(fillColor.color)?.slice(0, 7) || fillColor.previewNoneColor),
    dom.cls('font-bold', use => use(styleOptions.fontBold) ?? false),
    dom.cls('font-italic', use => use(styleOptions.fontItalic) ?? false),
    dom.cls('font-underline', use => use(styleOptions.fontUnderline) ?? false),
    dom.cls('font-strikethrough', use => use(styleOptions.fontStrikethrough) ?? false),
    testId('color-button'),
  );

  const domCreator = (ctl: IOpenController) => buildColorPicker(ctl, styleOptions, onSave);
  setPopupToCreateDom(iconBtn, domCreator, { ...defaultMenuOptions, placement: 'bottom-end' });

  return iconBtn;
}

function buildColorPicker(ctl: IOpenController,
  {
    textColor,
    fillColor,
    fontBold,
    fontUnderline,
    fontItalic,
    fontStrikethrough
  }: StyleOptions,
  onSave: () => Promise<void>): Element {
  const textColorModel = ColorModel.create(null, textColor.color);
  const fillColorModel = ColorModel.create(null, fillColor.color);
  const fontBoldModel = BooleanModel.create(null, fontBold);
  const fontUnderlineModel = BooleanModel.create(null, fontUnderline);
  const fontItalicModel = BooleanModel.create(null, fontItalic);
  const fontStrikethroughModel = BooleanModel.create(null, fontStrikethrough);

  const models = [textColorModel, fillColorModel, fontBoldModel, fontUnderlineModel,
                  fontItalicModel, fontStrikethroughModel];

  const notChanged = Computed.create(null, use => models.every(m => use(m.needsSaving) === false));

  function revert() {
    models.forEach(m => m.revert());
    ctl.close();
  }

  ctl.onDispose(async () => {
    if (!notChanged.get()) {
      try {
        // TODO: disable the trigger btn while saving
        await onSave();
      } catch (e) {
        /* Does no logging: onSave() callback is expected to handle their reporting */
        models.forEach(m => m.revert());
      }
    }
    models.forEach(m => m.dispose());
    notChanged.dispose();
  });

  return cssContainer(
    dom.create(FontComponent, {
      fontBoldModel,
      fontUnderlineModel,
      fontItalicModel,
      fontStrikethroughModel,
    }),
    cssVSpacer(),
    dom.create(PickerComponent, textColorModel, {
      title: 'text',
      ...textColor
    }),
    cssVSpacer(),
    dom.create(PickerComponent, fillColorModel, {
      title: 'fill',
      ...fillColor
    }),
    // gives focus and binds keydown events
    (elem: any) => { setTimeout(() => elem.focus(), 0); },
    onKeyDown({
      Escape: () => { revert(); },
      Enter: () => { ctl.close(); },
    }),

    cssButtonRow(
      primaryButton('Apply',
        dom.on('click', () => ctl.close()),
        dom.boolAttr("disabled", notChanged),
        testId('colors-save')
      ),
      basicButton('Cancel',
        dom.on('click', () => revert()),
        testId('colors-cancel')
      )
    ),

    // Set focus when `focusout` is bubbling from a children element. This is to allow to receive
    // keyboard event again after user interacted with the hex box text input.
    dom.on('focusout', (ev, elem) => (ev.target !== elem) && elem.focus()),
  );
}

// PickerModel is a helper model that helps keep track of the server value for an observable that
// needs to be changed locally without saving. To use, you must call `model.setValue(...)` instead
// of `obs.set(...)`. Then it offers `model.needsSaving()` that tells you whether current value
// needs saving, and `model.revert()` that reverts obs to the its server value.
class PickerModel<T extends boolean|string|undefined> extends Disposable {

  // Is current value different from the server value?
  public needsSaving: Observable<boolean>;
  private _serverValue: Observable<T>;
  private _localChange: boolean = false;
  constructor(public obs: Observable<T>) {
    super();
    this._serverValue = Observable.create(this, this.obs.get());
    this.needsSaving =  Computed.create(this, use => {
      const current = use(this.obs);
      const server = use(this._serverValue);
      // We support booleans and strings only for now, so if current is false and server
      // is undefined, we assume they are the same.
      // TODO: this probably should be a strategy method.
      return current !== (typeof current === 'boolean' ? (server ?? false) : server);
    });
    this.autoDispose(this.obs.addListener((val) => {
      if (this._localChange) { return; }
      this._serverValue.set(val);
    }));
  }

  // Set the value picked by the user
  public setValue(val: T) {
    this._localChange = true;
    this.obs.set(val);
    this._localChange = false;
  }

  // Revert obs to its server value
  public revert() {
    this.obs.set(this._serverValue.get());
  }
}

class ColorModel extends PickerModel<string|undefined> {}
class BooleanModel extends PickerModel<boolean|undefined> {}

interface PickerComponentOptions {
  title: string;
  allowsNone: boolean;
  // Default color to show when value is empty or undefined (itself can be empty).
  defaultColor: string;
  // Text to be shown in the picker when color is not set.
  noneText: string;
  // Preview color to show when value is undefined.
  previewNoneColor: string;
}
class PickerComponent extends Disposable {

  private _color = Computed.create(this,
    this._model.obs,
    (use, val) => (val || this._options.defaultColor).toUpperCase().slice(0, 7));

  constructor(
    private _model: PickerModel<string|undefined>,
    private _options: PickerComponentOptions) {
    super();
  }

  public buildDom() {
    const title = this._options.title;
    const colorText = Computed.create(null, use => use(this._color) || this._options.noneText);
    return [
      cssHeaderRow(title),
      cssControlRow(
        cssColorPreview(
          dom.update(
            cssColorSquare(
              cssLightBorder.cls(''),
              dom.style('background-color', this._color),
              cssNoneIcon('Empty',
                dom.hide(use => Boolean(use(this._color)) === true)
              ),
            ),
            cssColorInput(
              {type: 'color'},
              dom.attr('value', this._color),
              dom.on('input', (ev, elem) => this._setValue(elem.value || undefined)),
              testId(`${title}-input`),
            ),
          ),
          cssHexBox(
            colorText,
            async (val) => {
              if (!val || isValidHex(val)) {
                this._model.setValue(val || undefined);
              }
            },
            dom.autoDispose(colorText),
            testId(`${title}-hex`),
            // select the hex value on click. Doing it using settimeout allows to avoid some
            // sporadically losing the selection just after the click.
            dom.on('click', (ev, elem) => setTimeout(() => elem.select(), 0)),
          )
        ),
        cssEmptyBox(
          cssEmptyBox.cls('-selected', (use) => !use(this._color)),
          dom.on('click', () => this._setValue(undefined)),
          dom.hide(!this._options.allowsNone),
          cssNoneIcon('Empty'),
          testId(`${title}-empty`),
        )
      ),
      cssPalette(
        swatches.map((color, index) => (
          cssColorSquare(
            dom.style('background-color', color),
            cssLightBorder.cls('', isLight(index)),
            cssColorSquare.cls('-selected', (use) => use(this._color) === color),
            dom.style('outline-color', isLight(index) ? '' : color),
            dom.on('click', () => this._setValue(color)),
            testId(`color-${color}`),
          )
        )),
        testId(`${title}-palette`),
      ),
    ];
  }

  private _setValue(val: string|undefined) {
    this._model.setValue(val);
  }
}

class FontComponent extends Disposable {
  constructor(
    private _options: {
      fontBoldModel: BooleanModel,
      fontUnderlineModel: BooleanModel,
      fontItalicModel: BooleanModel,
      fontStrikethroughModel: BooleanModel,
    }
  ) {
    super();
  }

  public buildDom() {
    function option(iconName: IconName, model: BooleanModel) {
      return cssFontOption(
        cssFontIcon(iconName),
        dom.on('click', () => model.setValue(!model.obs.get())),
        cssFontOption.cls('-selected', use => use(model.obs) ?? false),
        testId(`font-option-${iconName}`)
      );
    }
    return cssFontOptions(
      option('FontBold', this._options.fontBoldModel),
      option('FontUnderline', this._options.fontUnderlineModel),
      option('FontItalic', this._options.fontItalicModel),
      option('FontStrikethrough', this._options.fontStrikethroughModel),
    );
  }
}

const cssFontOptions = styled('div', `
  display: flex;
  gap: 1px;
  background: ${colors.darkGrey};
  border: 1px solid ${colors.darkGrey};
`);

const cssFontOption = styled('div', `
  display: grid;
  place-items: center;
  flex-grow: 1;
  background: white;
  height: 24px;
  cursor: pointer;
  &:hover:not(&-selected) {
    background: ${colors.lightGrey};
  }
  &-selected {
    background: ${colors.dark};
    --icon-color: ${colors.light}
  }
`);

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

const cssColorPreview = styled('div', `
  display: flex;
`);

const cssControlRow = styled('div', `
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
`);

const cssHeaderRow = styled('div', `
  text-transform: uppercase;
  font-size: ${vars.smallFontSize};
  margin-bottom: 12px;
`);

const cssPalette = styled('div', `
  width: 236px;
  height: calc(4 * 20px + 3 * 4px);
  display: flex;
  flex-direction: column;
  flex-wrap: wrap;
  justify-content: space-between;
  align-content: space-between;
`);

const cssVSpacer = styled('div', `
  height: 24px;
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
  border: 1px solid ${colors.darkGrey};
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

const cssEmptyBox = styled(cssColorSquare, `
  --icon-color: ${colors.error};
  border: 1px solid #D9D9D9;
  &-selected {
    outline: 1px solid ${colors.dark};
    outline-offset: 1px;
  }
`);

const cssFontIcon = styled(icon, `
  height: 12px;
  width: 12px;
`);

const cssNoneIcon = styled(icon, `
  height: 100%;
  width: 100%;
  --icon-color: ${colors.error}
`);

const cssButtonIcon = styled(cssColorSquare, `
  margin-right: 6px;
  margin-left: 4px;
`);

const cssIconBtn = styled(cssColorSquare, `
  min-width: 18px;
  width: 18px;
  height: 18px;
  cursor: pointer;
  display: grid;
  place-items: center;
`);

const cssButtonRow = styled('div', `
  gap: 8px;
  display: flex;
  margin-top: 24px;
`);
