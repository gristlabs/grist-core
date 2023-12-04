import { makeT } from 'app/client/lib/localization';
import {allCommands} from 'app/client/components/commands';
import {GristDoc} from 'app/client/components/GristDoc';
import {ViewFieldRec} from 'app/client/models/entities/ViewFieldRec';
import {textButton} from 'app/client/ui2018/buttons';
import {ColorOption, colorSelect} from 'app/client/ui2018/ColorSelect';
import {testId, theme, vars} from 'app/client/ui2018/cssVars';
import {ConditionalStyle} from 'app/client/widgets/ConditionalStyle';
import {Computed, Disposable, dom, DomContents, fromKo, styled} from 'grainjs';

const t = makeT('CellStyle');

export class CellStyle extends Disposable {

  constructor(
    private _field: ViewFieldRec,
    private _gristDoc: GristDoc,
    private _defaultTextColor: string|undefined
  ) {
    super();
  }

  public buildDom(): DomContents {
    const isTableWidget = this._field.viewSection().parentKey() === 'record';
    return [
      dom.maybe(use => isTableWidget, () => {
        return [
          cssLine(
            cssLabel(t('HEADER STYLE')),
          ),
          cssRow(
            testId('header-color-select'),
            dom.domComputedOwned(fromKo(this._field.config.headerStyle), (holder, options) => {
              const headerTextColor = fromKo(options.prop("headerTextColor"));
              const headerFillColor = fromKo(options.prop("headerFillColor"));
              const headerFontBold = fromKo(options.prop("headerFontBold"));
              const headerFontUnderline = fromKo(options.prop("headerFontUnderline"));
              const headerFontItalic = fromKo(options.prop("headerFontItalic"));
              const headerFontStrikethrough = fromKo(options.prop("headerFontStrikethrough"));
              const hasMixedStyle = Computed.create(holder, use => {
                if (!use(this._field.config.multiselect)) { return false; }
                const commonStyle = [
                  use(options.mixed('headerTextColor')),
                  use(options.mixed('headerFillColor')),
                  use(options.mixed('headerFontBold')),
                  use(options.mixed('headerFontUnderline')),
                  use(options.mixed('headerFontItalic')),
                  use(options.mixed('headerFontStrikethrough'))
                ];
                return commonStyle.some(Boolean);
              });
              return colorSelect(
                {
                  textColor: new ColorOption({
                    color: headerTextColor,
                    defaultColor: theme.tableHeaderFg.toString(),
                    allowsNone: true,
                    noneText: 'default',
                  }),
                  fillColor: new ColorOption({
                    color: headerFillColor,
                    allowsNone: true,
                    noneText: 'none',
                  }),
                  fontBold: headerFontBold,
                  fontItalic: headerFontItalic,
                  fontUnderline: headerFontUnderline,
                  fontStrikethrough: headerFontStrikethrough
                },
                {
                  onSave: () => options.save(),
                  onRevert: () => options.revert(),
                  placeholder: use => use(hasMixedStyle) ? t('Mixed style') : t('Default header style')
                }
              );
            }),
          )];
      }),
      cssLine(
        cssLabel(t('CELL STYLE')),
        cssButton(
          t('Open row styles'),
          dom.on('click', allCommands.viewTabOpen.run),
          dom.hide(!isTableWidget),
        ),
      ),
      cssRow(
        testId('cell-color-select'),
        dom.domComputedOwned(fromKo(this._field.config.style), (holder, options) => {
          const textColor = fromKo(options.prop("textColor"));
          const fillColor = fromKo(options.prop("fillColor"));
          const fontBold = fromKo(options.prop("fontBold"));
          const fontUnderline = fromKo(options.prop("fontUnderline"));
          const fontItalic = fromKo(options.prop("fontItalic"));
          const fontStrikethrough = fromKo(options.prop("fontStrikethrough"));
          const hasMixedStyle = Computed.create(holder, use => {
            if (!use(this._field.config.multiselect)) { return false; }
            const commonStyle = [
              use(options.mixed('textColor')),
              use(options.mixed('fillColor')),
              use(options.mixed('fontBold')),
              use(options.mixed('fontUnderline')),
              use(options.mixed('fontItalic')),
              use(options.mixed('fontStrikethrough'))
            ];
            return commonStyle.some(Boolean);
          });
          return colorSelect(
            {
              textColor: new ColorOption({
                color: textColor,
                defaultColor: this._defaultTextColor,
                allowsNone: true,
                noneText: 'default',
              }),
              fillColor: new ColorOption({
                color: fillColor,
                allowsNone: true,
                noneText: 'none',
              }),
              fontBold: fontBold,
              fontItalic: fontItalic,
              fontUnderline: fontUnderline,
              fontStrikethrough: fontStrikethrough
            }, {
              onSave: () => options.save(),
              onRevert: () => options.revert(),
              placeholder: use => use(hasMixedStyle) ? t('Mixed style') : t('Default cell style')
            }
          );
        }),
      ),
      dom.create(ConditionalStyle, t("Cell Style"), this._field, this._gristDoc, fromKo(this._field.config.multiselect))
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
