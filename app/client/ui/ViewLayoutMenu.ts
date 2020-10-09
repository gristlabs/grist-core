import {allCommands} from 'app/client/components/commands';
import {ViewRec, ViewSectionRec} from 'app/client/models/DocModel';
import {testId} from 'app/client/ui2018/cssVars';
import {menuDivider, menuItemCmd} from 'app/client/ui2018/menus';
import {dom} from 'grainjs';

/**
 * Returns a list of menu items for a view section.
 */
export function makeViewLayoutMenu(viewModel: ViewRec, viewSection: ViewSectionRec, isReadonly: boolean) {
  return [
    menuItemCmd(allCommands.printSection, 'Print widget', testId('print-section')),
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
