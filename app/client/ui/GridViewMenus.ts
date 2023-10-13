import {allCommands} from 'app/client/components/commands';
import {makeT} from 'app/client/lib/localization';
import {ViewFieldRec} from 'app/client/models/entities/ViewFieldRec';
import {testId, theme} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {
  enhanceBySearch,
  menuDivider,
  menuItem,
  menuItemCmd,
  menuItemSubmenu,
  menuSubHeader,
  menuText
} from 'app/client/ui2018/menus';
import {Sort} from 'app/common/SortSpec';
import {dom, DomElementArg, Observable, styled} from 'grainjs';
import {RecalcWhen} from "../../common/gristTypes";
import {GristDoc} from "../components/GristDoc";
import {ColumnRec} from "../models/entities/ColumnRec";
import {FieldBuilder} from "../widgets/FieldBuilder";
import isEqual = require('lodash/isEqual');

const t = makeT('GridViewMenus');

//encapsulation over the view that menu will be generated for
interface IView {
  gristDoc: GristDoc;
  //adding new column to the view, and return a FieldBuilder that can be used to further modify the column
  addNewColumn: () => Promise<null>;
  addNewColumnWithoutRenamePopup: () => Promise<FieldBuilder>;
  showColumn: (colId: number, atIndex: number) => void;
  //Add new colum to the view as formula column, with given column name and
  //formula equation.
  // Return a FieldBuilder that can be used to further modify the column
  addNewFormulaColumn(formula: string, columnName: string): Promise<FieldBuilder>;
}

interface IViewSection {
  viewFields: any;
  hiddenColumns: any;
  columns: any;
}

interface IColumnInfo{
  colId: string;
  label: string;
  index: number;
}


// Section for "Show hidden column" in a colum menu.
// If there are no hidden columns - don't show the section.
// If there is more that X - show submenu
function MenuHideColumnSection(gridView: IView, viewSection: IViewSection){
  //function to generate the list with name of hidden columns and unhinging them on click
  const listOfHiddenColumns = viewSection.hiddenColumns().map((col: any, index: number): IColumnInfo => { return {
    colId:col.id(), label: col.label(), index: viewSection.columns().findIndex((c: any) => c.id() === col.id()),
  }; });

  //Generating dom and hadling actions in menu section for hidden columns - allow to unhide it.
  const hiddenColumnMenu = () => {
    //if there is more than 5 hidden columns - show submenu
    if(listOfHiddenColumns.length > 5){
      return[
        menuItemSubmenu(
          (ctl: any)=>{
            // enhance this submenu by adding search bar on the top. enhanceBySearch is doing basically two things:
            // adding search bar, and expose searchCriteria observable to be used to generate list of items to be shown
            return enhanceBySearch((searchCriteria)=> {
              // put all hidden columns into observable
              const hiddenColumns: Array<IColumnInfo> = listOfHiddenColumns;
              const dynamicHiddenColumnsList =  Observable.create<any[]>(null, hiddenColumns);
              // when search criteria changes - filter the list of hidden columns and update the observable
              searchCriteria.addListener((sc: string) => {
                return dynamicHiddenColumnsList.set(
                  hiddenColumns.filter((c: IColumnInfo) => c.label.includes(sc)));
              });
              // generate a list of menu items from the observable
              return [
                // each hidden column is a menu item that will call showColumn on click
                // and place column at the end of the table
                dom.forEach(dynamicHiddenColumnsList,
                  (col: any) => menuItem(
                      ()=>{ gridView.showColumn(col.colId, viewSection.columns().length); },
                      col.label //column label as menu item text
                  )
                )
              ];
            });
          },
          {}, //options - we do not need any for this submenu
          t("Show hidden columns"), //text of the submenu
          {class: menuItem.className} // style of the submenu
        )
      ];
      // in case there are less than five hidden columns - show them all in the main level of the menu
    } else {
      // generate a list of menu items from the list of hidden columns
     return listOfHiddenColumns.map((col: any) =>
       menuItem(
         ()=> { gridView.showColumn(col.colId, viewSection.columns().length); },
         col.label, //column label as menu item text
         testId(`new-columns-menu-hidden-columns-${col.label.replace(' ', '-')}`)
       )
     );
    }
  };


  return dom.maybe(() => viewSection.hiddenColumns().length > 0, ()=>[
    menuDivider(),
    menuSubHeader(t("Hidden Columns"), testId('new-columns-menu-hidden-columns')),
    hiddenColumnMenu()]
  );
}

function MenuShortcuts(gridView: IView){
  return [
    menuDivider(),
    menuSubHeader(t("Shortcuts"), testId('new-columns-menu-shortcuts')),
    menuItemSubmenu((ctl: any)=>[
      menuItem(
        () => addNewColumnWithTimestamp(gridView, false), t("Apply to new records"),
        testId('new-columns-menu-shortcuts-timestamp-new')
      ),
      menuItem(
        () => addNewColumnWithTimestamp(gridView, true), t("Apply on record changes"),
        testId('new-columns-menu-shortcuts-timestamp-change')
      ),
    ], {}, t("Timestamp"), testId('new-columns-menu-shortcuts-timestamp')),
    menuItemSubmenu((ctl: any)=>[
      menuItem(
        () => addNewColumnWithAuthor(gridView, false), t("Apply to new records"),
        testId('new-columns-menu-shortcuts-author-new')
      ),
      menuItem(
        () => addNewColumnWithAuthor(gridView, true), t("Apply on record changes"),
        testId('new-columns-menu-shortcuts-author-change')
      ),

    ], {}, t("Authorship"), testId('new-columns-menu-shortcuts-author')),
  ]; }

function MenuLookups(viewSection: IViewSection, gridView: IView){
  return [
    menuDivider(),
    menuSubHeader(t("Lookups"), testId('new-columns-menu-lookups')),
    buildLookupsOptions(viewSection, gridView)
  ];
}

function buildLookupsOptions(viewSection: IViewSection, gridView: IView){
  const referenceCollection = viewSection.columns().filter((e: ColumnRec)=> e.pureType()=="Ref");

  if(referenceCollection.length == 0){
    return menuText(()=>{}, t("no reference column"), testId('new-columns-menu-lookups-none'));
  }
  //TODO: Make search work - right now enhanceBySearch searchQuery parameter is not subscribed and menu items are
  // not updated when search query changes. Filter the columns names based on search query observable (like in
  // MenuHideColumnSection)
  return referenceCollection.map((ref: any) => menuItemSubmenu((ctl) => {
    return enhanceBySearch((searchQuery) => [
      ...ref.refTable().columns().all().map((col: ColumnRec) =>
        menuItem(
          async () => {
            await gridView.addNewFormulaColumn(`$${ref.label()}.${col.label()}`,
              `${ref.label()}_${col.label()}`);
          }, col.label()
        )
      )
    ]);
  }, {}, ref.label(), {class: menuItem.className}, testId(`new-columns-menu-lookups-${ref.label()}`)));
}

// Old version of column menu
// TODO: This is only valid as long as feature flag GRIST_NEW_COLUMN_MENU is existing in the system.
//  Once it is removed (so production is working only with the new column menu, this function should be removed as well.
export function ColumnAddMenuOld(gridView: IView, viewSection: IViewSection) {
  return [
    menuItem(() => gridView.addNewColumn(), t("Add Column")),
    menuDivider(),
    ...viewSection.hiddenColumns().map((col: any) => menuItem(
      () => {
        gridView.showColumn(col.id(), viewSection.viewFields().peekLength);
        // .then(() => gridView.scrollPaneRight());
      }, t("Show column {{- label}}", {label: col.label()})))
  ];
}

/**
 * Creates a menu to add a new column.
 */
export function ColumnAddMenu(gridView: IView, viewSection: IViewSection) {
  return [
    menuItem(
      async () => { await gridView.addNewColumn(); },
      `+ ${t("Add Column")}`,
      testId('new-columns-menu-add-new')
    ),
    MenuHideColumnSection(gridView, viewSection),
    MenuLookups(viewSection, gridView),
    MenuShortcuts(gridView),
  ];
}

//TODO: figure out how to change columns names;
const addNewColumnWithTimestamp = async (gridView: IView, triggerOnUpdate: boolean) => {
  await gridView.gristDoc.docData.bundleActions('Add new column with timestamp', async () => {
    const column = await gridView.addNewColumnWithoutRenamePopup();
    if (!triggerOnUpdate) {
      await column.gristDoc.convertToTrigger(column.origColumn.id.peek(), 'NOW()', RecalcWhen.DEFAULT);
      await column.field.displayLabel.setAndSave(t('Created At'));
      await column.field.column.peek().type.setAndSave('DateTime');
    } else {
      await column.gristDoc.convertToTrigger(column.origColumn.id.peek(), 'NOW()', RecalcWhen.MANUAL_UPDATES);
      await column.field.displayLabel.setAndSave(t('Last Updated At'));
      await column.field.column.peek().type.setAndSave('DateTime');
    }
  }, {nestInActiveBundle: true});
};

const addNewColumnWithAuthor = async (gridView: IView, triggerOnUpdate: boolean) => {
  await gridView.gristDoc.docData.bundleActions('Add new column with author', async () => {
    const column = await gridView.addNewColumnWithoutRenamePopup();
    if (!triggerOnUpdate) {
      await column.gristDoc.convertToTrigger(column.origColumn.id.peek(), 'user.Name', RecalcWhen.DEFAULT);
      await column.field.displayLabel.setAndSave(t('Created By'));
      await column.field.column.peek().type.setAndSave('Text');
    } else {
      await column.gristDoc.convertToTrigger(column.origColumn.id.peek(), 'user.Name', RecalcWhen.MANUAL_UPDATES);
      await column.field.displayLabel.setAndSave(t('Last Updated By'));
      await column.field.column.peek().type.setAndSave('Text');
    }
  }, {nestInActiveBundle: true});
};



export interface IMultiColumnContextMenu {
  // For multiple selection, true/false means the value applies to all columns, 'mixed' means it's
  // true for some columns, but not all.
  numColumns: number;
  numFrozen: number;
  disableModify: boolean|'mixed';  // If the columns are read-only. Mixed for multiple columns where some are read-only.
  isReadonly: boolean;
  isRaw: boolean;
  isFiltered: boolean;            // If this view shows a proper subset of all rows in the table.
  isFormula: boolean|'mixed';
  columnIndices: number[];
  totalColumnCount: number;
  disableFrozenMenu: boolean;
}

interface IColumnContextMenu extends IMultiColumnContextMenu {
  filterOpenFunc: () => void;
  sortSpec: Sort.SortSpec;
  colId: number;
}

export function calcFieldsCondition(fields: ViewFieldRec[], condition: (f: ViewFieldRec) => boolean): boolean|"mixed" {
  return fields.every(condition) ? true : (fields.some(condition) ? "mixed" : false);
}

export function ColumnContextMenu(options: IColumnContextMenu) {
  const { disableModify, filterOpenFunc, colId, sortSpec, isReadonly } = options;

  const disableForReadonlyColumn = dom.cls('disabled', Boolean(disableModify) || isReadonly);

  const addToSortLabel = getAddToSortLabel(sortSpec, colId);

  return [
    menuItemCmd(allCommands.fieldTabOpen, t("Column Options")),
    menuItem(filterOpenFunc, t("Filter Data")),
    menuDivider({style: 'margin-bottom: 0;'}),
    cssRowMenuItem(
      customMenuItem(
        allCommands.sortAsc.run,
        dom('span', t("Sort"), {style: 'flex: 1  0 auto; margin-right: 8px;'},
            testId('sort-label')),
        icon('Sort', dom.style('transform', 'scaley(-1)')),
        'A-Z',
        dom.style('flex', ''),
        cssCustomMenuItem.cls('-selected', Sort.containsOnly(sortSpec, colId, Sort.ASC)),
        testId('sort-asc'),
      ),
      customMenuItem(
        allCommands.sortDesc.run,
        icon('Sort'),
        'Z-A',
        cssCustomMenuItem.cls('-selected', Sort.containsOnly(sortSpec, colId, Sort.DESC)),
        testId('sort-dsc'),
      ),
      testId('sort'),
    ),
    addToSortLabel ? [
      cssRowMenuItem(
        customMenuItem(
          allCommands.addSortAsc.run,
          cssRowMenuLabel(addToSortLabel, testId('add-to-sort-label')),
          icon('Sort', dom.style('transform', 'scaley(-1)')),
          'A-Z',
          cssCustomMenuItem.cls('-selected', Sort.contains(sortSpec, colId, Sort.ASC)),
          testId('add-to-sort-asc'),
        ),
        customMenuItem(
          allCommands.addSortDesc.run,
          icon('Sort'),
          'Z-A',
          cssCustomMenuItem.cls('-selected', Sort.contains(sortSpec, colId, Sort.DESC)),
          testId('add-to-sort-dsc'),
        ),
        testId('add-to-sort'),
      ),
    ] : null,
    menuDivider({style: 'margin-bottom: 0; margin-top: 0;'}),
    menuItem(allCommands.sortFilterTabOpen.run, t("More sort options ..."), testId('more-sort-options')),
    menuDivider({style: 'margin-top: 0;'}),
    menuItemCmd(allCommands.renameField, t("Rename column"), disableForReadonlyColumn),
    freezeMenuItemCmd(options),
    menuDivider(),
    MultiColumnMenu((options.disableFrozenMenu = true, options)),
    testId('column-menu'),
  ];
}

/**
 * Note about available options. There is a difference between clearing values (writing empty
 * string, which makes cells blank, including Numeric cells) and converting a column to an empty
 * column (i.e. column with empty formula; in this case a Numeric column becomes all 0s today).
 *
 * We offer both options if data columns are selected. If only formulas, only the second option
 * makes sense.
 */
export function MultiColumnMenu(options: IMultiColumnContextMenu) {
  const disableForReadonlyColumn = dom.cls('disabled', Boolean(options.disableModify) || options.isReadonly);
  const disableForReadonlyView = dom.cls('disabled', options.isReadonly);
  const num: number = options.numColumns;
  const nameClearColumns = options.isFiltered ?
    t('Reset {{count}} entire columns', {count: num}) :
    t('Reset {{count}} columns', {count: num});
  const nameDeleteColumns = t('Delete {{count}} columns', {count: num});
  const nameHideColumns = t('Hide {{count}} columns', {count: num});
  const frozenMenu = options.disableFrozenMenu ? null : freezeMenuItemCmd(options);
  return [
    frozenMenu ? [frozenMenu, menuDivider()]: null,
    // Offered only when selection includes formula columns, and converts only those.
    (options.isFormula ?
      menuItemCmd(allCommands.convertFormulasToData, t("Convert formula to data"),
        disableForReadonlyColumn) : null),

    // With data columns selected, offer an additional option to clear out selected cells.
    (options.isFormula !== true ?
      menuItemCmd(allCommands.clearValues, t("Clear values"), disableForReadonlyColumn) : null),

    (!options.isRaw ? menuItemCmd(allCommands.hideFields, nameHideColumns, disableForReadonlyView) : null),
    menuItemCmd(allCommands.clearColumns, nameClearColumns, disableForReadonlyColumn),
    menuItemCmd(allCommands.deleteFields, nameDeleteColumns, disableForReadonlyColumn),

    menuDivider(),
    menuItemCmd(allCommands.insertFieldBefore, t("Insert column to the left"), disableForReadonlyView),
    menuItemCmd(allCommands.insertFieldAfter, t("Insert column to the right"), disableForReadonlyView)
  ];
}

export function freezeAction(options: IMultiColumnContextMenu): { text: string; numFrozen: number; } | null {
 /**
   * When user clicks last column - don't offer freezing
   * When user clicks on a normal column - offer him to freeze all the columns to the
   * left (inclusive).
   * When user clicks on a frozen column - offer him to unfreeze all the columns to the
   * right (inclusive)
   * When user clicks on a set of columns then:
   * - If the set of columns contains the last columns that are frozen - offer unfreezing only those columns
   * - If the set of columns is right after the frozen columns or spans across - offer freezing only those columns
   *
   * All of the above are a single command - toggle freeze
   */

  const length = options.numColumns;

  // make some assertions - number of columns selected should always be > 0
  if (length === 0) { return null; }

  const indices = options.columnIndices;
  const firstColumnIndex = indices[0];
  const lastColumnIndex = indices[indices.length - 1];
  const numFrozen = options.numFrozen;

  // if set has last column in it - don't offer freezing
  if (lastColumnIndex == options.totalColumnCount - 1) {
    return null;
  }

  const isNormalColumn = length === 1 && (firstColumnIndex + 1) > numFrozen;
  const isFrozenColumn = length === 1 && (firstColumnIndex+ 1) <= numFrozen;
  const isSet = length > 1;
  const isLastFrozenSet = isSet && lastColumnIndex + 1 === numFrozen;
  const isFirstNormalSet = isSet && firstColumnIndex === numFrozen;
  const isSpanSet = isSet && firstColumnIndex <= numFrozen && lastColumnIndex >= numFrozen;

  let text = '';

  if (!isSet) {
    if (isNormalColumn) {
      // text to show depends on what user selected and how far are we from
      // last frozen column

      // if user clicked the first column or a column just after frozen set
      if (firstColumnIndex === 0 || firstColumnIndex === numFrozen) {
        text = t('Freeze {{count}} columns', {count: 1});
      } else {
        // else user clicked any other column that is farther, offer to freeze
        // proper number of column
        const properNumber = firstColumnIndex - numFrozen + 1;
        text = numFrozen ?
          t('Freeze {{count}} more columns', {count: properNumber}) :
          t('Freeze {{count}} columns', {count: properNumber});
      }
      return {
        text,
        numFrozen : firstColumnIndex + 1
      };
    } else if (isFrozenColumn) {
      // when user clicked last column in frozen set - offer to unfreeze this column
      if (firstColumnIndex + 1 === numFrozen) {
        text = t('Unfreeze {{count}} columns', {count: 1});
      } else {
        // else user clicked column that is not the last in a frozen set
        // offer to unfreeze proper number of columns
        const properNumber = numFrozen - firstColumnIndex;
        text = properNumber === numFrozen ?
          t('Unfreeze all columns') :
          t('Unfreeze {{count}} columns', {count: properNumber});
      }
      return {
        text,
        numFrozen : indices[0]
      };
    } else {
      return null;
    }
  } else {
    if (isLastFrozenSet) {
      text = t('Unfreeze {{count}} columns', {count: length});
      return {
        text,
        numFrozen : numFrozen - length
      };
    } else if (isFirstNormalSet) {
      text = t('Freeze {{count}} columns', {count: length});
      return {
        text,
        numFrozen : numFrozen + length
      };
    } else if (isSpanSet) {
      const toFreeze = lastColumnIndex + 1 - numFrozen;
      text = t('Freeze {{count}} more columns', {count: toFreeze});
      return {
        text,
        numFrozen : numFrozen + toFreeze
      };
    }  else {
      return null;
    }
  }
}

function freezeMenuItemCmd(options: IMultiColumnContextMenu) {
  // calculate action available for this options
  const toggle = freezeAction(options);
  // if we can't offer freezing - don't create a menu at all
  // this shouldn't happen - as current design offers some action on every column
  if (!toggle) { return null; }
  // create menu item if we have something to offer
  return menuItemCmd(allCommands.toggleFreeze, toggle.text);
}

// Returns 'Add to sort' is there are columns in the sort spec but colId is not part of it. Returns
// undefined if colId is the only column in the spec. Otherwise returns `Sorted (#N)` where #N is
// the position (1 based) of colId in the spec.
function getAddToSortLabel(sortSpec: Sort.SortSpec, colId: number): string|undefined {
  const columnsInSpec = sortSpec.map((n) =>Sort.getColRef(n));
  if (sortSpec.length !== 0 && !isEqual(columnsInSpec, [colId])) {
    const index = columnsInSpec.indexOf(colId);
    if (index > -1) {
      return t("Sorted (#{{count}})", {count: index + 1});
    } else {
      return t("Add to sort");
    }
  }
}

const cssRowMenuItem = styled((...args: DomElementArg[]) => dom('li', {tabindex: '-1'}, ...args), `
  display: flex;
  outline: none;
`);

const cssRowMenuLabel = styled('div', `
  margin-right: 8px;
  flex: 1 0 auto;
`);

const cssCustomMenuItem = styled('div', `
  padding: 8px 8px;
  display: flex;
  &:not(:hover) {
    background-color: ${theme.menuBg};
    color: ${theme.menuItemFg};
    --icon-color: ${theme.menuItemFg};
  }
  &:last-of-type {
    padding-right: 24px;
    flex: 0 0 auto;
  }
  &:first-of-type {
    padding-left: 24px;
    flex: 1 0 auto;
  }
  &-selected, &-selected:not(:hover) {
    background-color: ${theme.menuItemSelectedBg};
    color: ${theme.menuItemSelectedFg};
    --icon-color: ${theme.menuItemSelectedFg};
  }
`);

function customMenuItem(action: () => void, ...args: DomElementArg[]) {
  const element: HTMLElement = cssCustomMenuItem(
    ...args,
    dom.on('click', () => action()),
  );
  return element;
}
