import {allCommands} from 'app/client/components/commands';
import {GristDoc} from 'app/client/components/GristDoc';
import {ViewFieldRec} from 'app/client/models/entities/ViewFieldRec';
import {Style} from 'app/client/models/Styles';
import {textButton} from 'app/client/ui2018/buttons';
import {ColorOption, colorSelect} from 'app/client/ui2018/ColorSelect';
import {theme, vars} from 'app/client/ui2018/cssVars';
import {ConditionalStyle} from 'app/client/widgets/ConditionalStyle';
import {Computed, Disposable, dom, DomContents, fromKo, MultiHolder, Observable, styled} from 'grainjs';

export class CellStyle extends Disposable {
  private _textColor: Observable<string|undefined>;
  private _fillColor: Observable<string|undefined>;
  private _fontBold: Observable<boolean|undefined>;
  private _fontUnderline: Observable<boolean|undefined>;
  private _fontItalic: Observable<boolean|undefined>;
  private _fontStrikethrough: Observable<boolean|undefined>;

  constructor(
    private _field: ViewFieldRec,
    private _gristDoc: GristDoc,
    private _defaultTextColor: string
  ) {
    super();
    this._textColor = fromKo(this._field.config.textColor);
    this._fillColor = fromKo(this._field.config.fillColor);
    this._fontBold = fromKo(this._field.config.fontBold);
    this._fontUnderline = fromKo(this._field.config.fontUnderline);
    this._fontItalic = fromKo(this._field.config.fontItalic);
    this._fontStrikethrough = fromKo(this._field.config.fontStrikethrough);
  }

  public buildDom(): DomContents {
    const holder = new MultiHolder();
    const hasMixedStyle = Computed.create(holder, use => {
      if (!use(this._field.config.multiselect)) { return false; }
      const commonStyle = [
        use(this._field.config.options.mixed('textColor')),
        use(this._field.config.options.mixed('fillColor')),
        use(this._field.config.options.mixed('fontBold')),
        use(this._field.config.options.mixed('fontUnderline')),
        use(this._field.config.options.mixed('fontItalic')),
        use(this._field.config.options.mixed('fontStrikethrough'))
      ];
      return commonStyle.some(Boolean);
    });
    let state: Style[]|null = null;
    return [
      cssLine(
        cssLabel('CELL STYLE', dom.autoDispose(holder)),
        cssButton('Open row styles', dom.on('click', allCommands.viewTabOpen.run)),
      ),
      cssRow(
        colorSelect(
          {
            textColor: new ColorOption(
              { color: this._textColor, defaultColor: this._defaultTextColor, noneText: 'default'}
            ),
            fillColor: new ColorOption(
              { color: this._fillColor, allowsNone: true, noneText: 'none'}
            ),
            fontBold: this._fontBold,
            fontItalic: this._fontItalic,
            fontUnderline: this._fontUnderline,
            fontStrikethrough: this._fontStrikethrough
          }, {
            // Calling `field.config.options.save()` saves all options at once.
            onSave: () => this._field.config.options.save(),
            onOpen: () => state = this._field.config.copyStyles(),
            onRevert: () => this._field.config.setStyles(state),
            placeholder: use => use(hasMixedStyle) ? 'Mixed style' : 'Default cell style'
          }
        )
      ),
      dom.create(ConditionalStyle, "Cell Style", this._field, this._gristDoc, fromKo(this._field.config.multiselect))
    ];
  }
}

const cssLine = styled('div', `
  display: flex;
  margin: 16px 16px 12px 16px;
  justify-content: space-between;
  align-items: baseline;
`);

const cssLabel = styled('div', `
  color: ${theme.text};
  text-transform: uppercase;
  font-size: ${vars.xsmallFontSize};
`);

const cssButton = styled(textButton, `
  font-size: ${vars.mediumFontSize};
`);

const cssRow = styled('div', `
  display: flex;
  margin: 8px 16px;
  align-items: center;
  &-top-space {
    margin-top: 24px;
  }
  &-disabled {
    color: ${theme.disabledText};
  }
`);
