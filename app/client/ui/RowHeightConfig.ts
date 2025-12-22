import { allCommands } from 'app/client/components/commands';
import { makeT } from 'app/client/lib/localization';
import { ViewSectionOptions, ViewSectionRec } from 'app/client/models/entities/ViewSectionRec';
import { SaveableObjObservable } from 'app/client/models/modelUtil';
import { cssNumericSpinner, cssRow } from 'app/client/ui/RightPanelStyles';
import { infoTooltip } from 'app/client/ui/tooltips';
import { textButton } from 'app/client/ui2018/buttons';
import { labeledSquareCheckbox } from 'app/client/ui2018/checkbox';
import { testId } from 'app/client/ui2018/cssVars';
import { Computed, dom, DomContents, DomElementArg, IDisposableOwner, styled, subscribeElem } from 'grainjs';

const t = makeT('RowHeightConfig');

/**
 * Builds the configuration UI to show in columns. It's only non-empty for grid sections
 * (widgetType 'record'). It shows minimal information and has a link to the actual configuration
 * UI in the table's creator panel.
 */
export function rowHeightConfigColumn(viewSection: ViewSectionRec): DomContents {
  const optionsObs: SaveableObjObservable<ViewSectionOptions> = viewSection.optionsObj;
  return dom.maybe(use => use(viewSection.widgetType) === 'record', () => [
    cssRowHeightText(t('Max row height'), ':',
      dom('b', dom.text(use => String(use(optionsObs).rowHeight || 'auto')),
        testId('row-height-label'),
      ),
    ),
    textButton(t('Change'), dom.on('click', allCommands.viewTabOpen.run),
      testId('row-height-change-link'),
    ),
  ]);
}

/**
 * Builds the configuration UI to how for the table, to show for GridView widgets.
 */
export function rowHeightConfigTable(
  owner: IDisposableOwner,
  optionsObs: SaveableObjObservable<ViewSectionOptions>,
): DomContents {
  const rowHeightObs = Computed.create<number|"">(owner, use => use(optionsObs).rowHeight || '');
  const setRowHeight = (rowHeight: number|undefined) => optionsObs.setAndSave({ ...optionsObs.peek(), rowHeight });

  const uniformRows = Computed.create<boolean>(owner, use => use(optionsObs).rowHeightUniform || false);
  uniformRows.onWrite((val: boolean) => optionsObs.setAndSave({ ...optionsObs.peek(), rowHeightUniform: val }));

  return [
    cssRow(
      cssRowHeightLabel(t('Max height'), infoTooltip('rowHeight'), { for: 'row-height-max-input' }),
      cssNumericSpinner(rowHeightObs,
        {
          minValue: 0,
          maxValue: 100,
          save: setRowHeight,
          inputArgs: [{ placeholder: 'auto', id: 'row-height-max-input' }, dom.style('width', '5em')],
        },
        testId('row-height-max'),
      ),
    ),
    cssRowExpandable(
      cssRowExpandable.cls('-expand', use => Boolean(use(rowHeightObs))),
      labeledSquareCheckbox(
        uniformRows,
        t('Expand all rows to this height'),
        testId('row-height-expand'),
        dom.boolAttr('disabled', use => !use(rowHeightObs)),
      ),
    ),
  ];
}

/**
 * Given row-heights configuration, applies it to a GridView section.
 */
export function applyRowHeightLimit(section: ViewSectionRec): DomElementArg {
  return [
    // We want dom.style('--row-height-lines', section.rowHeight), but it doesn't work for "custom
    // variable" properties, so we do it manually. TODO: fix grainjs to support this.
    elem => subscribeElem(elem, section.rowHeight,
      val => elem.style.setProperty('--row-height-lines', String(val))),
    dom.cls('row_height_set', use => Boolean(use(section.rowHeight) > 0)),
    dom.cls('row_height_uniform', section.rowHeightUniform),
  ];
}

const cssRowHeightTextBase = `
  flex: 1 0 auto;
  display: inline-flex;
  gap: 8px;
  margin-right: 16px;
`;
const cssRowHeightText = styled('span', cssRowHeightTextBase);

const cssRowHeightLabel = styled('label', cssRowHeightTextBase);

const cssRowExpandable = styled(cssRow, `
  transition: max-height 0.2s;
  max-height: 0;
  overflow: hidden;
  &-expand {
    /*
     * fit-content doesn't work with transitions on height.
     * In practice, height shouldn't exceed 32px, even when text wraps to a
     * second line.
     */
    max-height: 32px;
    overflow: visible;
  }
`);
