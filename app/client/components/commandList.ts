export type CommandName =
  | 'shortcuts'
  | 'help'
  | 'undo'
  | 'redo'
  | 'accept'
  | 'cancel'
  | 'find'
  | 'findNext'
  | 'findPrev'
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
  | 'videoTourToolsOpen'
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
  | 'nextSection'
  | 'prevSection'
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
  | 'contextMenuCut'
  | 'contextMenuPaste'
  | 'fillSelectionDown'
  | 'clearValues'
  | 'input'
  | 'editLabel'
  | 'editLayout'
  | 'historyPrevious'
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
  ;

export interface CommandDef {
  name: CommandName;
  keys: string[];
  desc: string | null;
  bindKeys?: boolean;
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
      name: 'shortcuts',
      keys: ['F1', 'Mod+/'],
      desc: 'Display shortcuts pane'
    }, {
      name: 'help',
      keys: [],
      desc: 'Display Grist documentation'
    }, {
      name: 'undo',
      keys: ['Mod+z'],
      desc: 'Undo last action'
    }, {
      name: 'redo',
      keys: ['Mod+Shift+Z', 'Ctrl+y' ],
      desc: 'Redo last action'
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
      desc: 'Find',
    }, {
      name: 'findNext',
      keys: ['Mod+g'],
      desc: 'Find next occurrence',
    }, {
      name: 'findPrev',
      keys: ['Mod+Shift+G'],
      desc: 'Find previous occurrence',
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
    }

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
      desc: 'Shortcut to open document tab'
    },
    {
      name: 'viewTabOpen',
      keys: [],
      desc: 'Shortcut to open view tab'
    },
    {
      name: 'viewTabFocus',
      keys: [],
      desc: 'Shortcut to focus view tab if creator panel is open'
    },
    {
      name: 'fieldTabOpen',
      keys: [],
      desc: 'Shortcut to open field tab'
    },
    {
      name: 'sortFilterTabOpen',
      keys: [],
      desc: 'Shortcut to sort & filter tab'
    },
    {
      name: 'sortFilterMenuOpen',
      keys: [],
      desc: 'Shortcut to open sort & filter menu'
    },
    {
      name: 'dataSelectionTabOpen',
      keys: [],
      desc: 'Shortcut to data selection tab'
    },
    {
      name: 'printSection',
      keys: [],
      desc: 'Print currently selected page widget',
    },
    {
      name: 'showRawData',
      keys: [],
      desc: 'Show raw data widget for table of currently selected page widget',
    },
    {
      name: 'openWidgetConfiguration',
      keys: [],
      desc: 'Open Custom widget configuration screen',
    },
    {
      name: 'expandSection',
      keys: [],
      desc: 'Maximize the active section',
    },
    {
      name: 'leftPanelOpen',
      keys: [],
      desc: 'Shortcut to open the left panel',
    },
    {
      name: 'rightPanelOpen',
      keys: [],
      desc: 'Shortcut to open the right panel',
    },
    {
      name: 'videoTourToolsOpen',
      keys: [],
      desc: 'Shortcut to open video tour from home left panel',
    },
    {
      name: 'activateAssistant',
      keys: [],
      desc: 'Activate assistant',
    },
    {
      name: 'viewAsCard',
      keys: ['Space'],
      desc: 'Show the record card widget of the selected record',
    },
    {
      name: 'showPopup',
      keys:[],
      desc: 'showing a behavioral popup'
    },
    {
      name: 'createForm',
      keys: [],
      desc: 'Creates form for active table',
    },
    {
      name: 'insertField',
      keys: [],
      desc: 'Insert new column in default location',
    }
  ]
}, {
  group: 'Navigation',
  commands: [
    {
      name: 'cursorDown',
      keys: ['Down'],
      desc: 'Move downward to next record or field'
    }, {
      name: 'cursorUp',
      keys: ['Up'],
      desc: 'Move upward to previous record or field'
    }, {
      name: 'cursorRight',
      keys: ['Right'],
      desc: 'Move right to the next field'
    }, {
      name: 'cursorLeft',
      keys: ['Left'],
      desc: 'Move left to the previous field'
    }, {
      name: 'nextField',
      keys: ['Tab'],
      desc: 'Move to the next field, saving changes if editing a value'
    }, {
      name: 'prevField',
      keys: ['Shift+Tab'],
      desc: 'Move to the previous field, saving changes if editing a value'
    }, {
      name: 'pageDown',
      keys: ['PageDown'],
      desc: 'Move down one page of records, or to next record in a card list'
    }, {
      name: 'pageUp',
      keys: ['PageUp'],
      desc: 'Move up one page of records, or to previous record in a card list'
    }, {
      name: 'moveToFirstRecord',
      keys: ['Mod+Up'],
      desc: 'Move up to the first record',
    }, {
      name: 'moveToLastRecord',
      keys: ['Mod+Down'],
      desc: 'Move down to the last record',
    }, {
      name: 'moveToFirstField',
      keys: ['Home'],
      desc: 'Move to the first field or the beginning of a row'
    }, {
      name: 'moveToLastField',
      keys: ['End'],
      desc: 'Move to the last field or the end of a row'
    }, {
      // no longer used
      name: 'skipDown',
      keys: [],
      desc: 'Move downward five records'
    }, {
      // no longer used
      name: 'skipUp',
      keys: [],
      desc: 'Move upward five records'
    }, {
      name: 'setCursor',
      keys: [],
      desc: 'Moves the cursor to the correct location'
    }, {
      name: 'openDocumentList',
      keys: [],
      desc: 'Opens document list'
    }, {
      name: 'nextPage',
      keys: ['Alt+Down'],
      desc: 'Open next page'
    }, {
      name: 'prevPage',
      keys: ['Alt+Up'],
      desc: 'Open previous page'
    }, {
      name: 'nextSection',
      keys: ['Mod+o'],
      desc: 'Activate next page widget',
    }, {
      name: 'prevSection',
      keys: ['Mod+Shift+O'],
      desc: 'Activate previous page widget',
    }
  ],
}, {
  group: 'Selection',
  commands: [
    {
     name: 'shiftDown',
     keys: ['Shift+Down'],
     desc: 'Adds the element below the cursor to the selected range'
    }, {
     name: 'shiftUp',
     keys: ['Shift+Up'],
     desc: 'Adds the element above the cursor to the selected range'
    }, {
     name: 'shiftRight',
     keys: ['Shift+Right'],
     desc: 'Adds the element to the right of the cursor to the selected range'
    }, {
     name: 'shiftLeft',
     keys: ['Shift+Left'],
     desc: 'Adds the element to the left of the cursor to the selected range'
    }, {
      name: 'ctrlShiftDown',
      keys: ['Mod+Shift+Down'],
      desc: 'Adds all elements below the cursor to the selected range'
    }, {
      name: 'ctrlShiftUp',
      keys: ['Mod+Shift+Up'],
      desc: 'Adds all elements above the cursor to the selected range'
    }, {
      name: 'ctrlShiftRight',
      keys: ['Mod+Shift+Right'],
      desc: 'Adds all elements to the right of the cursor to the selected range'
    }, {
      name: 'ctrlShiftLeft',
      keys: ['Mod+Shift+Left'],
      desc: 'Adds all elements to the left of the cursor to the selected range'
    }, {
      name: 'selectAll',
      keys: ['Mod+A'],
      desc: 'Selects all currently displayed cells'
    }, {
      name: 'copyLink',
      keys: ['Mod+Shift+A'],
      desc: 'Copy anchor link'
    }, {
      name: 'clearCopySelection',
      keys: [],
      desc: 'Clears the current copy selection, if any'
    }
  ],
}, {
  group: 'Editing',
  commands: [
    {
      name: 'editField',
      keys: ['Enter', 'F2'],
      desc: 'Start editing the currently-selected cell'
    }, {
      name: 'fieldEditSave',
      keys: ['Enter'],
      desc: 'Finish editing a cell, saving the value'
    }, {
      name: 'detachEditor',
      keys: [],
      desc: 'Detach active editor'
    }, {
      name: 'fieldEditSaveHere',
      keys: [],
      desc: 'Finish editing a cell and save without moving to next record',
    }, {
      name: 'fieldEditCancel',
      keys: ['Escape'],
      desc: 'Discard changes to a cell value'
    }, {
      name: 'copy',
      keys: [],
      desc: 'Copy current selection to clipboard'
    }, {
      name: 'cut',
      keys: [],
      desc: 'Cut current selection to clipboard'
    }, {
      name: 'paste',
      keys: [],
      desc: 'Paste clipboard contents at cursor',
    }, {
      name: 'contextMenuCopy',
      keys: ['Mod+C'],
      desc: 'Copy current selection to clipboard',
      bindKeys: false,
    }, {
      name: 'contextMenuCut',
      keys: ['Mod+X'],
      desc: 'Cut current selection to clipboard',
      bindKeys: false,
    }, {
      name: 'contextMenuPaste',
      keys: ['Mod+V'],
      desc: 'Paste clipboard contents at cursor',
      bindKeys: false,
    }, {
      name: 'fillSelectionDown',
      keys: ['Mod+D'],
      desc: 'Fills current selection with the contents of the top row in the selection'
    }, {
      name: 'clearValues',
      keys: ['Backspace', 'Del'],
      desc: 'Clears the currently selected cells'
    }, {
      name: 'input',
      keys: [],
      desc: 'Enter text into currently-selected cell and start editing'
    }, {
      name: 'editLabel',
      keys: [],
      desc: 'Edit label of the currently-selected field'
    }, {
      name: 'editLayout',
      keys: [],
      desc: 'Edit record layout'
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
      desc: 'When typed at the start of a cell, make this a formula column',
    }, {
      name: 'unmakeFormula',
      keys: ['Backspace'],
      desc: null, // Undoes turning of column into a formula column, when pressed at start of a cell
    }, {
      name: 'insertCurrentDate',
      keys: ['Mod+;'],
      desc: 'Insert the current date',
    }, {
      name: 'insertCurrentDateTime',
      keys: ['Mod+Shift+;'],
      desc: 'Insert the current date and time',
    }, {
      name: 'datepickerFocus',
      keys: ['Up', 'Down'],
      desc: null, // While editing a date cell, switch keyboard focus to the datepicker
    }, {
      name: 'openDiscussion',
      keys: ['Mod+Alt+M'],
      desc: 'Comment',
    }
  ],
}, {
  group: 'Data manipulation',
  commands: [
    {
      name: 'insertRecordBefore',
      keys: ['Mod+Shift+Enter'],
      desc: 'Insert a new record, before the currently selected one in an unsorted table'
    }, {
      name: 'insertRecordAfter',
      keys: ['Mod+Enter'],
      desc: 'Insert a new record, after the currently selected one in an unsorted table',
    }, {
      name: 'deleteRecords',
      keys: ['Mod+Del', 'Mod+Backspace'],
      desc: 'Delete the currently selected record'
    }, {
      name: 'insertFieldBefore',
      keys: ['Alt+Shift+='],
      desc: 'Insert a new column, before the currently selected one'
    }, {
      name: 'insertFieldAfter',
      keys: ['Alt+='],
      desc: 'Insert a new column, after the currently selected one'
    }, {
      name: 'makeHeadersFromRow',
      keys: ['Mod+Shift+H'],
      desc: 'Use currently selected line as table headers'
    }, {
      name: 'renameField',
      keys: ['Ctrl+m'],
      desc: 'Rename the currently selected column'
    }, {
      name: 'hideFields',
      keys: ['Alt+Shift+-'],
      desc: 'Hide currently selected columns'
    }, {
      name: 'hideCardFields',
      keys: [],
      desc: 'Hide currently selected fields'
    }, {
      name: 'toggleFreeze',
      keys: [],
      desc: 'Freeze or unfreeze selected columns'
    }, {
      name: 'deleteFields',
      keys: ['Alt+-'],
      desc: 'Delete the currently selected columns'
    }, {
      name: 'clearColumns',
      keys: [],
      desc: 'Clear the selected columns'
    }, {
      name: 'clearCardFields',
      keys: [],
      desc: 'Clear the selected fields'
    }, {
      name: 'convertFormulasToData',
      keys: [],
      desc: 'Convert the selected columns from formula to data'
    }, {
      name: 'addSection',
      keys: [],
      desc: 'Add a new viewsection to the currently active view'
    }, {
      name: 'deleteSection',
      keys: [],
      desc: 'Delete the currently active viewsection'
    }, {
      name: 'collapseSection',
      keys: [],
      desc: 'Collapse the currently active viewsection'
    }, {
      name: 'restoreSection',
      keys: [],
      desc: 'Expand collapsed viewsection'
    }, {
      name: 'deleteCollapsedSection',
      keys: [],
      desc: 'Delete collapsed viewsection'
    }, {
      name: 'duplicateRows',
      keys: ['Mod+Shift+d'],
      desc: 'Duplicate selected rows'
    }, {
      name: 'showColumns',
      keys: [],
      desc: 'Show hidden columns'
    }
  ],
}, {
  group: 'Sorting',
  commands: [
    {
      name: 'sortAsc',
      keys: [],
      desc: 'Sort the view data by the currently selected field in ascending order'
    }, {
      name: 'sortDesc',
      keys: [],
      desc: 'Sort the view data by the currently selected field in descending order'
    }, {
      name: 'addSortAsc',
      keys: [],
      desc: 'Adds the currently selected column(ascending) to the current view\'s sort spec'
    }, {
      name: 'addSortDesc',
      keys: [],
      desc: 'Adds the currently selected column(descending) to the current view\'s sort spec'
    },

  ],
}, {
  group: 'Filtering',
  commands: [
    {
      name: 'filterByThisCellValue',
      keys: [],
      desc: `Filter this column by just this cell's value`,
    },
  ]
}, {
  group: 'Linking',
  commands: [
    {
      name: 'enterLinkMode',
      keys: [],
      desc: 'Enters section linking mode in the current view'
    }, {
      name: 'exitLinkMode',
      keys: [],
      desc: 'Exits section linking mode in the current view'
    }, {
      name: 'saveLinks',
      keys: [],
      desc: 'Saves the sections links in the current view'
    }, {
      name: 'revertLinks',
      keys: [],
      desc: 'Reverts the sections links to the saved links the current view'
    }, {
      name: 'clearLinks',
      keys: [],
      desc: 'Clears the section links in the current view'
    }, {
      name: 'clearSectionLinks',
      keys: [],
      desc: 'Clears the section links in the current viewsection'
    }
  ],
}, {
  group: 'Transforming',
  commands: [
    {
      // TODO: Use AceEditor internal save command instead of custom transform save command
      name: 'transformUpdate',
      keys: ['Shift+Enter'],
      desc: null // Updates the transform formula
    }
  ],
}];
