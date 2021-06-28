import {allCommands} from 'app/client/components/commands';
import {ViewRec, ViewSectionRec} from 'app/client/models/DocModel';
import {testId} from 'app/client/ui2018/cssVars';
import {menuDivider, menuItemCmd, menuItemLink} from 'app/client/ui2018/menus';
import {dom} from 'grainjs';

/**
 * Returns a list of menu items for a view section.
 */
export function makeViewLayoutMenu(viewModel: ViewRec, viewSection: ViewSectionRec, isReadonly: boolean) {
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
      'Delete record',
      testId('section-delete-card'),
      dom.cls('disabled', isReadonly || isAddRow)),
    menuItemCmd(allCommands.copyLink,
      'Copy anchor link',
      testId('section-card-link'),
    ),
    menuDivider(),
  ];

  return [
    dom.maybe((use) => ['single'].includes(use(viewSection.parentKey)), () => contextMenu),
    menuItemCmd(allCommands.printSection, 'Print widget', testId('print-section')),
    menuItemLink({ href: gristDoc.getCsvLink(), target: '_blank', download: ''},
      'Download as CSV', testId('download-section')),
    dom.maybe((use) => ['detail', 'single'].includes(use(viewSection.parentKey)), () =>
      menuItemCmd(allCommands.editLayout, 'Edit Card Layout',
        dom.cls('disabled', isReadonly))),

    menuDivider(),
    menuItemCmd(allCommands.viewTabOpen, 'Widget options', testId('widget-options')),
    menuItemCmd(allCommands.sortFilterTabOpen, 'Advanced Sort & Filter'),
    menuItemCmd(allCommands.dataSelectionTabOpen, 'Data selection'),

    menuDivider(),
    menuItemCmd(allCommands.deleteSection, 'Delete widget',
      dom.cls('disabled', viewModel.viewSections().peekLength <= 1 || isReadonly),
      testId('section-delete')),
  ];
}
