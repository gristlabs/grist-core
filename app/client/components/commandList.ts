import {makeT} from 'app/client/lib/localization';

const t = makeT('commandList');

export type CommandName =
  | 'accessibility'
  | 'shortcuts'
  | 'help'
  | 'undo'
  | 'redo'
  | 'accept'
  | 'cancel'
  | 'find'
  | 'findNext'
  | 'findPrev'
  | 'closeSearchBar'
  | 'historyBack'
  | 'historyForward'
  | 'reloadPlugins'
  | 'closeActiveMenu'
  | 'docTabOpen'
  | 'viewTabOpen'
  | 'viewTabFocus'
  | 'fieldTabOpen'
  | 'sortFilterTabOpen'
  | 'sortFilterMenuOpen'
  | 'dataSelectionTabOpen'
  | 'printSection'
  | 'showRawData'
  | 'openWidgetConfiguration'
  | 'expandSection'
  | 'leftPanelOpen'
  | 'rightPanelOpen'
  | 'cursorDown'
  | 'cursorUp'
  | 'cursorRight'
  | 'cursorLeft'
  | 'nextField'
  | 'prevField'
  | 'pageDown'
  | 'pageUp'
  | 'moveToFirstRecord'
  | 'moveToLastRecord'
  | 'moveToFirstField'
  | 'moveToLastField'
  | 'skipDown'
  | 'skipUp'
  | 'setCursor'
  | 'openDocumentList'
  | 'nextPage'
  | 'prevPage'
  | 'nextRegion'
  | 'prevRegion'
  | 'creatorPanel'
  | 'shiftDown'
  | 'shiftUp'
  | 'shiftRight'
  | 'shiftLeft'
  | 'ctrlShiftDown'
  | 'ctrlShiftUp'
  | 'ctrlShiftRight'
  | 'ctrlShiftLeft'
  | 'selectAll'
  | 'copyLink'
  | 'editField'
  | 'fieldEditSave'
  | 'fieldEditSaveHere'
  | 'fieldEditCancel'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'contextMenuCopy'
  | 'contextMenuCopyWithHeaders'
  | 'contextMenuCut'
  | 'contextMenuPaste'
  | 'fillSelectionDown'
  | 'clearValues'
  | 'input'
  | 'editLabel'
  | 'editLayout'
  | 'historyPrevious'
  | 'toggleCheckbox'
  | 'historyNext'
  | 'makeFormula'
  | 'unmakeFormula'
  | 'insertCurrentDate'
  | 'insertCurrentDateTime'
  | 'datepickerFocus'
  | 'openDiscussion'
  | 'insertRecordBefore'
  | 'insertRecordAfter'
  | 'deleteRecords'
  | 'insertFieldBefore'
  | 'insertFieldAfter'
  | 'makeHeadersFromRow'
  | 'renameField'
  | 'hideFields'
  | 'hideCardFields'
  | 'toggleFreeze'
  | 'deleteFields'
  | 'clearColumns'
  | 'clearCardFields'
  | 'convertFormulasToData'
  | 'addSection'
  | 'deleteSection'
  | 'duplicateSection'
  | 'collapseSection'
  | 'restoreSection'
  | 'deleteCollapsedSection'
  | 'duplicateRows'
  | 'sortAsc'
  | 'sortDesc'
  | 'showPopup'
  | 'addSortAsc'
  | 'addSortDesc'
  | 'filterByThisCellValue'
  | 'enterLinkMode'
  | 'exitLinkMode'
  | 'saveLinks'
  | 'revertLinks'
  | 'clearLinks'
  | 'clearSectionLinks'
  | 'transformUpdate'
  | 'clearCopySelection'
  | 'detachEditor'
  | 'activateAssistant'
  | 'viewAsCard'
  | 'showColumns'
  | 'createForm'
  | 'insertField'
  | 'pushUndoAction'
  ;

export interface CommandDef {
  name: CommandName;
  keys: string[];
  desc: (() => string) | null;
  bindKeys?: boolean;
  /**
   * When true, the command is always enabled, even in form inputs.
   */
  alwaysOn?: boolean;
  deprecated?: boolean;
}

export interface MenuCommand {
  humanKeys: string[];
  run: (...args: any[]) => any;
}

export interface CommendGroupDef {
  group: string;
  commands: CommandDef[];
}

// The top-level groups, and the ordering within them are for user-facing documentation.
export const groups: CommendGroupDef[] = [{
  group: 'General',
  commands: [
    {
      name: 'accessibility',
      keys: ['F4'],
      desc: () => t('Show accessibility options'),
    },
    {
      name: 'shortcuts',
      keys: ['F1', 'Mod+/'],
      desc: () => t('Display shortcuts pane'),
    }, {
      name: 'help',
      keys: [],
      desc: () => t('Display Grist documentation'),
    }, {
      name: 'undo',
      keys: ['Mod+z'],
      desc: () => t('Undo last action'),
    }, {
      name: 'redo',
      keys: ['Mod+Shift+Z', 'Ctrl+y'],
      desc: () => t('Redo last action'),
    }, {
      name: 'accept',
      keys: ['Enter'],
      desc: null, // Accept the action of the dialog box
    }, {
      name: 'cancel',
      keys: ['Escape'],
      desc: null, // Cancel the action of the dialog box
    }, {
      name: 'find',
      keys: ['Mod+f'],
      desc: () => t('Find'),
    }, {
      name: 'findNext',
      keys: ['Mod+g'],
      desc: () => t('Find next occurrence'),
    }, {
      name: 'findPrev',
      keys: ['Mod+Shift+G'],
      desc: () => t('Find previous occurrence'),
    }, {
      name: 'closeSearchBar',
      keys: ['Mod+Enter'],
      desc: () => t('When in the search bar, close it and focus the current match'),
      alwaysOn: true,
    }, {
      // Without this, when focus in on Clipboard, this shortcut would only move the cursor.
      name: 'historyBack',
      keys: ['Mod+Left'],
      desc: null, // Move back in history, same as clicking the Back button
    }, {
      // Without this, when focus in on Clipboard, this shortcut would only move the cursor.
      name: 'historyForward',
      keys: ['Mod+Right'],
      desc: null, // Move forward in history, same as clicking the Forward button
    }, {
      name: 'reloadPlugins',
      keys: ['Mod+Alt+P'],
      desc: null, // reload plugins
    },

  ],
}, {
  group: 'Menu shortcuts',
  commands: [
    {
      name: 'closeActiveMenu',
      keys: ['Esc'],
      desc: null, // Shortcut to close active menu
    },
    {
      name: 'docTabOpen',
      keys: [],
      desc: () => t('Shortcut to open document tab'),
    },
    {
      name: 'viewTabOpen',
      keys: [],
      desc: () => t('Shortcut to open view tab'),
    },
    {
      name: 'viewTabFocus',
      keys: [],
      desc: () => t('Shortcut to focus view tab if creator panel is open'),
    },
    {
      name: 'fieldTabOpen',
      keys: [],
      desc: () => t('Shortcut to open field tab'),
    },
    {
      name: 'sortFilterTabOpen',
      keys: [],
      desc: () => t('Shortcut to sort & filter tab'),
    },
    {
      name: 'sortFilterMenuOpen',
      keys: [],
      desc: () => t('Shortcut to open sort & filter menu'),
    },
    {
      name: 'dataSelectionTabOpen',
      keys: [],
      desc: () => t('Shortcut to data selection tab'),
    },
    {
      name: 'printSection',
      keys: [],
      desc: () => t('Print currently selected page widget'),
    },
    {
      name: 'showRawData',
      keys: [],
      desc: () => t('Show raw data widget for table of currently selected page widget'),
    },
    {
      name: 'openWidgetConfiguration',
      keys: [],
      desc: () => t('Open Custom widget configuration screen'),
    },
    {
      name: 'expandSection',
      keys: [],
      desc: () => t('Maximize the active section'),
    },
    {
      name: 'leftPanelOpen',
      keys: [],
      desc: () => t('Shortcut to open the left panel'),
    },
    {
      name: 'rightPanelOpen',
      keys: [],
      desc: () => t('Shortcut to open the right panel'),
    },
    {
      name: 'activateAssistant',
      keys: [],
      desc: () => t('Activate assistant'),
    },
    {
      name: 'showPopup',
      keys: [],
      desc: () => t('showing a behavioral popup'),
    },
    {
      name: 'createForm',
      keys: [],
      desc: () => t('Creates form for active table'),
    },
    {
      name: 'insertField',
      keys: [],
      desc: () => t('Insert new column in default location'),
    },
  ],
}, {
  group: 'Navigation',
  commands: [
    {
      name: 'cursorDown',
      keys: ['Down'],
      desc: () => t('Move downward to next record or field'),
    }, {
      name: 'cursorUp',
      keys: ['Up'],
      desc: () => t('Move upward to previous record or field'),
    }, {
      name: 'cursorRight',
      keys: ['Right'],
      desc: () => t('Move right to the next field'),
    }, {
      name: 'cursorLeft',
      keys: ['Left'],
      desc: () => t('Move left to the previous field'),
    }, {
      name: 'nextField',
      keys: ['Tab'],
      desc: () => t('Move to the next field, saving changes if editing a value'),
    }, {
      name: 'prevField',
      keys: ['Shift+Tab'],
      desc: () => t('Move to the previous field, saving changes if editing a value'),
    }, {
      name: 'pageDown',
      keys: ['PageDown'],
      desc: () => t('Move down one page of records, or to next record in a card list'),
    }, {
      name: 'pageUp',
      keys: ['PageUp'],
      desc: () => t('Move up one page of records, or to previous record in a card list'),
    }, {
      name: 'moveToFirstRecord',
      keys: ['Mod+Up'],
      desc: () => t('Move up to the first record'),
    }, {
      name: 'moveToLastRecord',
      keys: ['Mod+Down'],
      desc: () => t('Move down to the last record'),
    }, {
      name: 'moveToFirstField',
      keys: ['Home'],
      desc: () => t('Move to the first field or the beginning of a row'),
    }, {
      name: 'moveToLastField',
      keys: ['End'],
      desc: () => t('Move to the last field or the end of a row'),
    }, {
      // no longer used
      name: 'skipDown',
      keys: [],
      desc: () => t('Move downward five records'),
    }, {
      // no longer used
      name: 'skipUp',
      keys: [],
      desc: () => t('Move upward five records'),
    }, {
      name: 'setCursor',
      keys: [],
      desc: () => t('Moves the cursor to the correct location'),
    }, {
      name: 'openDocumentList',
      keys: [],
      desc: () => t('Opens document list'),
    }, {
      name: 'nextPage',
      keys: ['Alt+Down'],
      desc: () => t('Open next page'),
    }, {
      name: 'prevPage',
      keys: ['Alt+Up'],
      desc: () => t('Open previous page'),
    }, {
      name: 'nextRegion',
      keys: ['Mod+o'],
      desc: () => t('Focus next page panel or widget'),
      alwaysOn: true,
    }, {
      name: 'prevRegion',
      keys: ['Mod+Shift+O'],
      desc: () => t('Focus previous page panel or widget'),
      alwaysOn: true,
    }, {
      name: 'creatorPanel',
      keys: ['Mod+Alt+o'],
      desc: () => t('Toggle creator panel keyboard focus'),
      alwaysOn: true,
    }, {
      name: 'viewAsCard',
      keys: ['Space'],
      desc: () => t('Show the record card widget of the selected record'),
    },
  ],
}, {
  group: 'Selection',
  commands: [
    {
      name: 'shiftDown',
      keys: ['Shift+Down'],
      desc: () => t('Adds the element below the cursor to the selected range'),
    }, {
      name: 'shiftUp',
      keys: ['Shift+Up'],
      desc: () => t('Adds the element above the cursor to the selected range'),
    }, {
      name: 'shiftRight',
      keys: ['Shift+Right'],
      desc: () => t('Adds the element to the right of the cursor to the selected range'),
    }, {
      name: 'shiftLeft',
      keys: ['Shift+Left'],
      desc: () => t('Adds the element to the left of the cursor to the selected range'),
    }, {
      name: 'ctrlShiftDown',
      keys: ['Mod+Shift+Down'],
      desc: () => t('Adds all elements below the cursor to the selected range'),
    }, {
      name: 'ctrlShiftUp',
      keys: ['Mod+Shift+Up'],
      desc: () => t('Adds all elements above the cursor to the selected range'),
    }, {
      name: 'ctrlShiftRight',
      keys: ['Mod+Shift+Right'],
      desc: () => t('Adds all elements to the right of the cursor to the selected range'),
    }, {
      name: 'ctrlShiftLeft',
      keys: ['Mod+Shift+Left'],
      desc: () => t('Adds all elements to the left of the cursor to the selected range'),
    }, {
      name: 'selectAll',
      keys: ['Mod+A'],
      desc: () => t('Selects all currently displayed cells'),
    }, {
      name: 'copyLink',
      keys: ['Mod+Shift+A'],
      desc: () => t('Copy anchor link'),
    }, {
      name: 'clearCopySelection',
      keys: [],
      desc: () => t('Clears the current copy selection, if any'),
    },
  ],
}, {
  group: 'Editing',
  commands: [
    {
      name: 'editField',
      keys: ['Enter', 'F2'],
      desc: () => t('Start editing the currently-selected cell'),
    }, {
      name: 'fieldEditSave',
      keys: ['Enter'],
      desc: () => t('Finish editing a cell, saving the value'),
    }, {
      // This only gets its own command so it can be listed as separate keyboard shortcut.
      name: 'toggleCheckbox',
      keys: ['Enter'],
      desc: () => t('Toggle the currently selected checkbox or switch cell'),
    }, {
      name: 'detachEditor',
      keys: [],
      desc: () => t('Detach active editor'),
    }, {
      name: 'fieldEditSaveHere',
      keys: [],
      desc: () => t('Finish editing a cell and save without moving to next record'),
    }, {
      name: 'fieldEditCancel',
      keys: ['Escape'],
      desc: () => t('Discard changes to a cell value'),
    }, {
      name: 'copy',
      keys: [],
      desc: () => t('Copy current selection to clipboard'),
    }, {
      name: 'cut',
      keys: [],
      desc: () => t('Cut current selection to clipboard'),
    }, {
      name: 'paste',
      keys: [],
      desc: () => t('Paste clipboard contents at cursor'),
    }, {
      name: 'contextMenuCopy',
      keys: ['Mod+C'],
      desc: () => t('Copy current selection to clipboard'),
      bindKeys: false,
    }, {
      name: 'contextMenuCopyWithHeaders',
      keys: [],
      desc: () => t('Copy current selection to clipboard including headers'),
    }, {
      name: 'contextMenuCut',
      keys: ['Mod+X'],
      desc: () => t('Cut current selection to clipboard'),
      bindKeys: false,
    }, {
      name: 'contextMenuPaste',
      keys: ['Mod+V'],
      desc: () => t('Paste clipboard contents at cursor'),
      bindKeys: false,
    }, {
      name: 'fillSelectionDown',
      keys: ['Mod+D'],
      desc: () => t('Fills current selection with the contents of the top row in the selection'),
    }, {
      name: 'clearValues',
      keys: ['Backspace', 'Del'],
      desc: () => t('Clears the currently selected cells'),
    }, {
      name: 'input',
      keys: [],
      desc: () => t('Enter text into currently-selected cell and start editing'),
    }, {
      name: 'editLabel',
      keys: [],
      desc: () => t('Edit label of the currently-selected field'),
    }, {
      name: 'editLayout',
      keys: [],
      desc: () => t('Edit record layout'),
    }, {
      name: 'historyPrevious',
      keys: ['Up'],
      desc: null, // Fetches the previous command from the history list, moving back in the list
    }, {
      name: 'historyNext',
      keys: ['Down'],
      desc: null, // Fetches the next command from the history list, moving forward in the list
    }, {
      name: 'makeFormula',
      keys: ["="],
      desc: () => t('When typed at the start of a cell, make this a formula column'),
    }, {
      name: 'unmakeFormula',
      keys: ['Backspace'],
      desc: null, // Undoes turning of column into a formula column, when pressed at start of a cell
    }, {
      name: 'insertCurrentDate',
      keys: ['Mod+;'],
      desc: () => t('Insert the current date'),
    }, {
      name: 'insertCurrentDateTime',
      keys: ['Mod+Shift+;'],
      desc: () => t('Insert the current date and time'),
    }, {
      name: 'datepickerFocus',
      keys: ['Up', 'Down'],
      desc: null, // While editing a date cell, switch keyboard focus to the datepicker
    }, {
      name: 'openDiscussion',
      keys: ['Mod+Alt+M'],
      desc: () => t('Open comment thread'),
    },
  ],
}, {
  group: 'Data manipulation',
  commands: [
    {
      name: 'insertRecordBefore',
      keys: ['Mod+Shift+Enter'],
      desc: () => t('Insert a new record, before the currently selected one in an unsorted table'),
    }, {
      name: 'insertRecordAfter',
      keys: ['Mod+Enter'],
      desc: () => t('Insert a new record, after the currently selected one in an unsorted table'),
    }, {
      name: 'duplicateRows',
      keys: ['Mod+Shift+d'],
      desc: () => t('Duplicate the currently selected record(s)'),
    }, {
      name: 'deleteRecords',
      keys: ['Mod+Backspace', 'Mod+Del'],
      desc: () => t('Delete the currently selected record(s)'),
    }, {
      name: 'insertFieldBefore',
      keys: ['Alt+Shift+='],
      desc: () => t('Insert a new column, before the currently selected one'),
    }, {
      name: 'insertFieldAfter',
      keys: ['Alt+='],
      desc: () => t('Insert a new column, after the currently selected one'),
    }, {
      name: 'makeHeadersFromRow',
      keys: ['Mod+Shift+H'],
      desc: () => t('Use the currently selected row as table headers'),
    }, {
      name: 'renameField',
      keys: ['Ctrl+m'],
      desc: () => t('Rename the currently selected column'),
    }, {
      name: 'hideFields',
      keys: ['Alt+Shift+-'],
      desc: () => t('Hide the currently selected columns'),
    }, {
      name: 'hideCardFields',
      keys: [],
      desc: () => t('Hide the currently selected fields'),
    }, {
      name: 'toggleFreeze',
      keys: [],
      desc: () => t('Freeze or unfreeze selected columns'),
    }, {
      name: 'deleteFields',
      keys: ['Alt+-'],
      desc: () => t('Delete the currently selected columns'),
    }, {
      name: 'clearColumns',
      keys: [],
      desc: () => t('Clear the selected columns'),
    }, {
      name: 'convertFormulasToData',
      keys: [],
      desc: () => t('Convert the selected columns from formula to data'),
    }, {
      name: 'addSection',
      keys: [],
      desc: () => t('Add a new viewsection to the currently active view'),
    }, {
      name: 'deleteSection',
      keys: [],
      desc: () => t('Delete the currently active viewsection'),
    }, {
      name: 'duplicateSection',
      keys: [],
      desc: () => t('Duplicate the currently active viewsection'),
    }, {
      name: 'collapseSection',
      keys: [],
      desc: () => t('Collapse the currently active viewsection'),
    }, {
      name: 'restoreSection',
      keys: [],
      desc: () => t('Expand collapsed viewsection'),
    }, {
      name: 'deleteCollapsedSection',
      keys: [],
      desc: () => t('Delete collapsed viewsection'),
    }, {
      name: 'showColumns',
      keys: [],
      desc: () => t('Show hidden columns'),
    }, {
      name: 'pushUndoAction',
      keys: [],
      desc: () => t('Push an undo action'),
    },
  ],
}, {
  group: 'Sorting',
  commands: [
    {
      name: 'sortAsc',
      keys: [],
      desc: () => t('Sort the view data by the currently selected field in ascending order'),
    }, {
      name: 'sortDesc',
      keys: [],
      desc: () => t('Sort the view data by the currently selected field in descending order'),
    }, {
      name: 'addSortAsc',
      keys: [],
      desc: () => t('Adds the currently selected column(ascending) to the current view\'s sort spec'),
    }, {
      name: 'addSortDesc',
      keys: [],
      desc: () => t('Adds the currently selected column(descending) to the current view\'s sort spec'),
    },

  ],
}, {
  group: 'Filtering',
  commands: [
    {
      name: 'filterByThisCellValue',
      keys: [],
      desc: () => t("Filter this column by just this cell's value"),
    },
  ],
}, {
  group: 'Linking',
  commands: [
    {
      name: 'enterLinkMode',
      keys: [],
      desc: () => t('Enters section linking mode in the current view'),
    }, {
      name: 'exitLinkMode',
      keys: [],
      desc: () => t('Exits section linking mode in the current view'),
    }, {
      name: 'saveLinks',
      keys: [],
      desc: () => t('Saves the sections links in the current view'),
    }, {
      name: 'revertLinks',
      keys: [],
      desc: () => t('Reverts the sections links to the saved links the current view'),
    }, {
      name: 'clearLinks',
      keys: [],
      desc: () => t('Clears the section links in the current view'),
    }, {
      name: 'clearSectionLinks',
      keys: [],
      desc: () => t('Clears the section links in the current viewsection'),
    },
  ],
}, {
  group: 'Transforming',
  commands: [
    {
      // TODO: Use AceEditor internal save command instead of custom transform save command
      name: 'transformUpdate',
      keys: ['Shift+Enter'],
      desc: null, // Updates the transform formula
    },
  ],
}];
