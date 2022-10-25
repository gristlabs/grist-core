import {makeT} from 'app/client/lib/localization';
import {allCommands} from 'app/client/components/commands';
import {ViewSectionRec} from 'app/client/models/DocModel';
import {urlState} from 'app/client/models/gristUrlState';
import {testId} from 'app/client/ui2018/cssVars';
import {menuDivider, menuItemCmd, menuItemLink} from 'app/client/ui2018/menus';
import {dom} from 'grainjs';

const t = makeT('ViewLayoutMenu');

/**
 * Returns a list of menu items for a view section.
 */
export function makeViewLayoutMenu(viewSection: ViewSectionRec, isReadonly: boolean) {
  const viewInstance = viewSection.viewInstance.peek()!;
  const gristDoc = viewInstance.gristDoc;

  // get current row index from cursor
  const cursorRow = viewInstance.cursor.rowIndex.peek();
  // get row id from current data
  // rowId can be string - it is wrongly typed in cursor and in viewData
  const rowId = (cursorRow !== null ? viewInstance.viewData.getRowId(cursorRow) : null) as string|null|number;
  const isAddRow = rowId === 'new';

  const contextMenu = [
    menuItemCmd(allCommands.deleteRecords,
      t('DeleteRecord'),
      testId('section-delete-card'),
      dom.cls('disabled', isReadonly || isAddRow)),
    menuItemCmd(allCommands.copyLink,
      t('CopyAnchorLink'),
      testId('section-card-link'),
    ),
    menuDivider(),
  ];

  const viewRec = viewSection.view();
  const isLight = urlState().state.get().params?.style === 'light';
  return [
    dom.maybe((use) => ['single'].includes(use(viewSection.parentKey)), () => contextMenu),
    dom.maybe((use) => !use(viewSection.isRaw) && !isLight,
      () => menuItemCmd(allCommands.showRawData, t('ShowRawData'), testId('show-raw-data')),
    ),
    menuItemCmd(allCommands.printSection, t('PrintWidget'), testId('print-section')),
    menuItemLink({ href: gristDoc.getCsvLink(), target: '_blank', download: ''},
      t('DownloadCSV'), testId('download-section')),
    menuItemLink({ href: gristDoc.getXlsxActiveViewLink(), target: '_blank', download: ''},
    t('DownloadXLSX'), testId('download-section')),
    dom.maybe((use) => ['detail', 'single'].includes(use(viewSection.parentKey)), () =>
      menuItemCmd(allCommands.editLayout, t('EditCardLayout'),
        dom.cls('disabled', isReadonly))),

    dom.maybe(!isLight, () => [
      menuDivider(),
      menuItemCmd(allCommands.viewTabOpen, t('WidgetOptions'), testId('widget-options')),
      menuItemCmd(allCommands.sortFilterTabOpen, t('AdvancedSortFilter')),
      menuItemCmd(allCommands.dataSelectionTabOpen, t('DataSelection')),
    ]),

    menuDivider(),
    dom.maybe((use) => use(viewSection.parentKey) === 'custom' && use(viewSection.hasCustomOptions), () =>
      menuItemCmd(allCommands.openWidgetConfiguration, t('OpenConfiguration'),
        testId('section-open-configuration')),
    ),
    menuItemCmd(allCommands.deleteSection, t('DeleteWidget'),
      dom.cls('disabled', !viewRec.getRowId() || viewRec.viewSections().peekLength <= 1 || isReadonly),
      testId('section-delete')),
  ];
}
