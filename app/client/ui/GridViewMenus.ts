import {allCommands} from 'app/client/components/commands';
import GridView from 'app/client/components/GridView';
import {makeT} from 'app/client/lib/localization';
import {ViewSectionRec} from 'app/client/models/DocModel';
import {ViewFieldRec} from 'app/client/models/entities/ViewFieldRec';
import {testId, theme, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {
  menuDivider,
  menuIcon,
  menuItem,
  menuItemCmd,
  menuItemSubmenu,
  menuItemTrimmed,
  menuSubHeader,
  menuSubHeaderMenu,
  menuText,
  searchableMenu,
  SearchableMenuItem,
} from 'app/client/ui2018/menus';
import {Sort} from 'app/common/SortSpec';
import {dom, DomElementArg, styled} from 'grainjs';
import {RecalcWhen} from "app/common/gristTypes";
import {ColumnRec} from "app/client/models/entities/ColumnRec";
import * as weasel from 'popweasel';
import isEqual = require('lodash/isEqual');

const t = makeT('GridViewMenus');

// FIXME: remove once New Column menu is enabled by default.
export function buildOldAddColumnMenu(gridView: GridView, viewSection: ViewSectionRec) {
  return [
    menuItem(async () => { await gridView.insertColumn(); }, t("Add Column")),
    menuDivider(),
    ...viewSection.hiddenColumns().map((col: any) => menuItem(
      async () => {
        await gridView.showColumn(col.id());
      }, t("Show column {{- label}}", {label: col.label()})))
  ];
}

export function buildAddColumnMenu(gridView: GridView, index?: number) {
  return [
    menuItem(
      async () => { await gridView.insertColumn(null, {index}); },
      menuIcon('Plus'),
      t("Add Column"),
      testId('new-columns-menu-add-new'),
    ),
    buildHiddenColumnsMenuItems(gridView, index),
    buildLookupSection(gridView, index),
    buildShortcutsMenuItems(gridView, index),
  ];
}

function buildHiddenColumnsMenuItems(gridView: GridView, index?: number) {
  const {viewSection} = gridView;
  const hiddenColumns = viewSection.hiddenColumns();
  if (hiddenColumns.length === 0) { return null; }

  if (hiddenColumns.length <= 5) {
    return [
      menuDivider(),
      menuSubHeader(t('Hidden Columns'), testId('new-columns-menu-hidden-columns')),
      hiddenColumns.map((col: ColumnRec) =>
        menuItem(
          async () => {
            await gridView.showColumn(col.id(), index);
          },
          col.label(),
        )
      ),
    ];
  } else {
    return [
      menuDivider(),
      menuSubHeaderMenu(
        () => {
          return searchableMenu(
            hiddenColumns.map((col) => ({
              cleanText: col.label().trim().toLowerCase(),
              builder: () => menuItemTrimmed(() => gridView.showColumn(col.id(), index), col.label())
            })),
            {searchInputPlaceholder: t('Search columns')}
          );
        },
        {allowNothingSelected: true},
        t('Hidden Columns'),
      ),
    ];
  }
}

function buildShortcutsMenuItems(gridView: GridView, index?: number) {
  return [
    menuDivider(),
    menuSubHeader(t("Shortcuts"), testId('new-columns-menu-shortcuts')),
    buildTimestampMenuItems(gridView, index),
    buildAuthorshipMenuItems(gridView, index),
    buildDetectDuplicatesMenuItems(gridView, index),
    buildUUIDMenuItem(gridView, index),
  ];
}

function buildTimestampMenuItems(gridView: GridView, index?: number) {
  return menuItemSubmenu(() => [
    menuItem(
      async () => {
        await gridView.insertColumn(t('Created At'), {
          colInfo: {
            label: t('Created At'),
            type: `DateTime:${gridView.gristDoc.docModel.docInfoRow.timezone()}`,
            isFormula: false,
            formula: 'NOW()',
            recalcWhen: RecalcWhen.DEFAULT,
            recalcDeps: null,
          },
          index,
          skipPopup: true,
        });
      },
      t("Apply to new records"),
      testId('new-columns-menu-shortcuts-timestamp-new'),
    ),
    menuItem(
      async () => {
        await gridView.insertColumn(t('Last Updated At'), {
          colInfo: {
            label: t('Last Updated At'),
            type: `DateTime:${gridView.gristDoc.docModel.docInfoRow.timezone()}`,
            isFormula: false,
            formula: 'NOW()',
            recalcWhen: RecalcWhen.MANUAL_UPDATES,
            recalcDeps: null,
          },
          index,
          skipPopup: true,
        });
      },
      t("Apply on record changes"),
      testId('new-columns-menu-shortcuts-timestamp-change'),
    ),
  ], {}, t("Timestamp"), testId('new-columns-menu-shortcuts-timestamp'));
}

function buildAuthorshipMenuItems(gridView: GridView, index?: number) {
  return menuItemSubmenu(() => [
    menuItem(
      async () => {
        await gridView.insertColumn(t('Created By'), {
          colInfo: {
            label: t('Created By'),
            type: 'Text',
            isFormula: false,
            formula: 'user.Name',
            recalcWhen: RecalcWhen.DEFAULT,
            recalcDeps: null,
          },
          index,
          skipPopup: true,
        });
      },
      t("Apply to new records"),
      testId('new-columns-menu-shortcuts-author-new')
    ),
    menuItem(
      async () => {
        await gridView.insertColumn(t('Last Updated By'), {
          colInfo: {
            label: t('Last Updated By'),
            type: 'Text',
            isFormula: false,
            formula: 'user.Name',
            recalcWhen: RecalcWhen.MANUAL_UPDATES,
            recalcDeps: null,
          },
          index,
          skipPopup: true,
        });
      },
      t("Apply on record changes"),
      testId('new-columns-menu-shortcuts-author-change')
    ),
  ], {}, t("Authorship"), testId('new-columns-menu-shortcuts-author'));
}

function buildDetectDuplicatesMenuItems(gridView: GridView, index?: number) {
  const {viewSection} = gridView;
  return menuItemSubmenu(
    () => searchableMenu(
      viewSection.columns().map((col) => ({
        cleanText: col.label().trim().toLowerCase(),
        label: col.label(),
        action: async () => {
          await gridView.gristDoc.docData.bundleActions(t('Adding duplicates column'), async () => {
            const newColInfo = await gridView.insertColumn(
              t('Duplicate in {{- label}}', {label: col.label()}),
              {
                colInfo: {
                  label: t('Duplicate in {{- label}}', {label: col.label()}),
                  type: 'Bool',
                  isFormula: true,
                  formula: `True if len(${col.table().tableId()}.lookupRecords(` +
                    `${col.colId()}=$${col.colId()})) > 1 else False`,
                  recalcWhen: RecalcWhen.DEFAULT,
                  recalcDeps: null,
                  widgetOptions: JSON.stringify({
                    rulesOptions: [{
                      fillColor: '#ffc23d',
                      textColor: '#262633',
                    }],
                  }),
                },
                index,
                skipPopup: true,
              }
            );

            // TODO: do the steps below as part of the AddColumn action.
            const newField = viewSection.viewFields().all()
              .find(field => field.colId() === newColInfo.colId);
            if (!newField) {
              throw new Error(`Unable to find field for column ${newColInfo.colId}`);
            }

            await newField.addEmptyRule();
            const newRule = newField.rulesCols()[0];
            if (!newRule) {
              throw new Error(`Unable to find conditional rule for field ${newField.label()}`);
            }

            await newRule.formula.setAndSave(`$${newColInfo.colId}`);
          }, {nestInActiveBundle: true});
        },
      })),
      {searchInputPlaceholder: t('Search columns')}
    ),
    {allowNothingSelected: true},
    t('Detect Duplicates in...'),
    testId('new-columns-menu-shortcuts-duplicates'),
  );
}

function buildUUIDMenuItem(gridView: GridView, index?: number) {
  return menuItem(
    async () => {
      await gridView.gristDoc.docData.bundleActions(t('Adding UUID column'), async () => {
        // First create a formula column so that UUIDs are computed for existing cells.
        const {colRef} = await gridView.insertColumn(t('UUID'), {
          colInfo: {
            label: t('UUID'),
            type: 'Text',
            isFormula: true,
            formula: 'UUID()',
            recalcWhen: RecalcWhen.DEFAULT,
            recalcDeps: null,
          },
          index,
          skipPopup: true,
        });

        // Then convert it to a trigger formula, so that UUIDs aren't re-computed.
        //
        // TODO: remove this step and do it as part of the AddColumn action.
        await gridView.gristDoc.convertToTrigger(colRef, 'UUID()');
      }, {nestInActiveBundle: true});
    },
    t('UUID'),
    testId('new-columns-menu-shortcuts-uuid'),
  );
}

function menuLabelWithToast(label: string, toast: string) {
  return cssListLabel(
    cssListCol(label),
    cssListFun(toast));
}


function buildLookupSection(gridView: GridView, index?: number){
  function suggestAggregation(col: ColumnRec) {
    if (col.pureType() === 'Int' || col.pureType() === 'Numeric') {
      return [
        'sum', 'average', 'min', 'max',
      ];
    } else if (col.pureType() === 'Bool') {
      return [
        'count', 'percent'
      ];
    } else if (col.pureType() === 'Date' || col.pureType() === 'DateTime') {
      return [
        'list', 'min', 'max',
      ];
    } else {
      return [
        'list'
      ];
    }
  }
  //colTypeOverload allow to change created column type if default is wrong.
  function buildColumnInfo(
    fun: string,
    referenceToSource: string,
    col: ColumnRec) {
    function formula() {
      switch(fun) {
        case 'list': return `${referenceToSource}.${col.colId()}`;
        case 'average': return `AVERAGE(${referenceToSource}.${col.colId()})`;
        case 'min': return `MIN(${referenceToSource}.${col.colId()})`;
        case 'max': return `MAX(${referenceToSource}.${col.colId()})`;
        case 'count':
        case 'sum': return `SUM(${referenceToSource}.${col.colId()})`;
        case 'percent':
          return `AVERAGE(map(int, ${referenceToSource}.${col.colId()})) if ${referenceToSource} else 0`;
        default: return `${referenceToSource}`;
      }
    }

    function type() {
      switch(fun) {
        case 'average': return 'Numeric';
        case 'min': return col.type();
        case 'max': return col.type();
        case 'count': return 'Int';
        case 'sum': return col.type();
        case 'percent': return 'Numeric';
        case 'list': return 'Any';
        default: return 'Any';
      }
    }

    function widgetOptions() {
      switch(fun) {
        case 'percent': return {numMode: 'percent'};
        default: return {};
      }
    }

    return {
      formula: formula(),
      type: type(),
      widgetOptions: JSON.stringify(widgetOptions()),
      isFormula: true,
    };
  }



  function buildLookupsMenuItems() {
    // Function that builds a menu for one of our Ref columns, we will show all columns
// from the referenced table and offer to create a formula column with aggregation in case
// our column is RefList.
    function buildRefColMenu(
      ref: ColumnRec, col: ColumnRec): SearchableMenuItem {
      // Helper for searching for this entry.
      const cleanText = col.label().trim().toLowerCase();

      // Next the label we will show.
      let label: string|HTMLElement;
      // For Ref column we will just show the column name.
      if (ref.pureType() === 'Ref') {
        label = col.label();
      } else {
        // For RefList column we will show the column name and the aggregation function which is the first
        // on of suggested action (and a default action).
        label = menuLabelWithToast(col.label(), suggestAggregation(col)[0]);
      }

      return {
        cleanText,
        builder: buildItem
      };

      function buildItem() {
        if (ref.pureType() === 'Ref') {
          // Just insert a plain menu item that will insert a formula column with lookup.
          return menuItemTrimmed(() => insertPlainLookup(), col.label());
        } else {
          // Built nested menu.
          return menuItemSubmenu(
            () => suggestAggregation(col).map((fun) => menuItem(() => insertAggLookup(fun), fun)),
            {},
            label
          );
        }
      }

      function insertAggLookup(fun: string) {
        return gridView.insertColumn(`${ref.label()}_${col.label()}`, {
          colInfo: {
            label: `${ref.label()}_${col.label()}`,
            ...buildColumnInfo(
              fun,
              `$${ref.colId()}`,
              col,
            ),
            recalcDeps: null,
          },
          index,
          skipPopup: true,
        });
      }

      function insertPlainLookup() {
        return gridView.insertColumn(`${ref.label()}_${col.label()}`, {
          colInfo: {
            label: `${ref.label()}_${col.label()}`,
            isFormula: true,
            formula: `$${ref.colId()}.${col.colId()}`,
            recalcDeps: null,
            type: col.type(),
            widgetOptions: col.cleanWidgetOptionsJson()
          },
          index,
          skipPopup: true,
        });
      }
    }
    const {viewSection} = gridView;
    const columns = viewSection.columns();
    const onlyRefOrRefList = (c: ColumnRec) => c.pureType() === 'Ref' || c.pureType() === 'RefList';
    const references = columns.filter(onlyRefOrRefList);

    return references.map((ref) => menuItemSubmenu(
        () => searchableMenu(
          ref.refTable()?.visibleColumns().map(buildRefColMenu.bind(null, ref)) ?? [],
          {
            searchInputPlaceholder: t('Search columns')
          }
        ),
        {allowNothingSelected: true},
        ref.label(),
        testId(`new-columns-menu-lookups-${ref.colId()}`),
      )
    );
  }


  function buildReverseLookupsMenuItems() {
    interface refTable {
      tableId: string,
      columns: ColumnRec[],
      referenceFields: ColumnRec[]
    }

    const getReferencesToThisTable = (): refTable[] => {
      const {viewSection} = gridView;
      const otherTables = gridView.gristDoc.docModel.allTables.all()
        .filter((tab) => tab.tableId.peek() != viewSection.tableId());
      return otherTables.map((tab) => {
        return {
          tableId: tab.tableId(),
          columns: tab.visibleColumns(),
          referenceFields:
            tab.columns().peek().filter((c) => (c.pureType() === 'Ref' || c.pureType() == 'RefList') &&
              c.refTable()?.tableId() === viewSection.tableId())
        };
      })
        .filter((tab) => tab.referenceFields.length > 0);
    };

    const buildColumn = async (tab: refTable, col: any, refCol: any, aggregate: string) => {
      const formula = `${tab.tableId}.lookupRecords(${refCol.colId()}=
      ${refCol.pureType() == 'RefList' ? 'CONTAINS($id)' : '$id'})`;
      await gridView.insertColumn(`${tab.tableId}_${col.label()}`, {
        colInfo: {
          label: `${tab.tableId}_${col.label()}`,
          ...buildColumnInfo(aggregate,
            formula,
            col)
        },
        index,
        skipPopup: true
      });
    };

    const buildSubmenuForRevLookup = (tab: refTable, refCol: any) => {
      const buildSubmenuForRevLookupMenuItem = (col: ColumnRec): SearchableMenuItem => {
        const suggestedColumns = suggestAggregation(col);
        const primarySuggestedColumn = suggestedColumns[0];

        return {
          cleanText: col.label().trim().toLowerCase(),
          builder: () => {
            if (suggestedColumns.length === 1) {
              return menuItem(() => buildColumn(tab, col, refCol, primarySuggestedColumn),
                menuLabelWithToast(col.label(), primarySuggestedColumn));
            } else {
              return menuItemSubmenu((ctl) =>
                  suggestedColumns.map(fun =>
                    menuItem(async () =>
                      buildColumn(tab, col, refCol, fun), t(fun)))
                , {}, menuLabelWithToast(col.label(), primarySuggestedColumn));
            }
          }
        };
      };

      return menuItemSubmenu(
        () =>
          searchableMenu(
            tab.columns.map(col => buildSubmenuForRevLookupMenuItem(col)),
            {searchInputPlaceholder: t('Search columns')}
          ),
        {allowNothingSelected: true}, `${tab.tableId} By ${refCol.label()}`);
    };

    const tablesWithAnyRefColumn = getReferencesToThisTable();
    return tablesWithAnyRefColumn.map((tab: refTable) => tab.referenceFields.map((refCol) =>
      buildSubmenuForRevLookup(tab, refCol)
    ));
  }

  const lookupMenu  = buildLookupsMenuItems();
  const reverseLookupMenu = buildReverseLookupsMenuItems();

  const menuContent = (lookupMenu.length === 0 && reverseLookupMenu.length === 0)
  ? [ menuText(
      t('No reference columns.'),
      testId('new-columns-menu-lookups-none'),
    )]
    : [lookupMenu, reverseLookupMenu];

  return [
      menuDivider(),
      menuSubHeader(t("Lookups"), testId('new-columns-menu-lookups')),
    ...menuContent
    ];
}

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

export function buildColumnContextMenu(options: IColumnContextMenu) {
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
    buildMultiColumnMenu((options.disableFrozenMenu = true, options)),
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
export function buildMultiColumnMenu(options: IMultiColumnContextMenu) {
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

const cssListLabel = styled('div', `
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  flex: 1;
`);

const cssListCol = styled('div', `
  flex: 1 0 auto;
`);

const cssListFun = styled('div', `
  flex: 0 0 auto;
  margin-left: 8px;
  text-transform: lowercase;
  padding: 1px 4px;
  border-radius: 3px;
  background-color: ${theme.choiceTokenBg};
  font-size: ${vars.xsmallFontSize};
  min-width: 28px;
  text-align: center;
  .${weasel.cssMenuItem.className}-sel & {
    color: ${theme.choiceTokenFg};
  }
`);
