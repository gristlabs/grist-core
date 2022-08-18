// This is from http://www.shortcutworld.com/shortcuts.php?l=en&p=win&application=Excel_2010
exports.shortcuts = function() {
  return [{
    group: 'Navigate inside worksheets',
    shortcuts: [
      "Left,Up,Right,Down:  Move one cell up, down, left, or right in a worksheet.",
      "PageDown,PageUp:  Move one screen down / one screen up in a worksheet.",
      "Alt+PageDown,Alt+PageUp:  Move one screen to the right / to the left in a worksheet.",
      "Tab,Shift+Tab:  Move one cell to the right / to the left in a worksheet.",
      "Ctrl+Left,Ctrl+Up,Ctrl+Right,Ctrl+Down:  Move to the edge of next data region (cells that contains data)",
      "Home:  Move to the beginning of a row in a worksheet.",
      "Ctrl+Home:  Move to the beginning of a worksheet.",
      "Ctrl+End:  Move to the last cell with content on a worksheet.",
      "Ctrl+f:  Display the Find and Replace dialog box (with Find selected).",
      "Ctrl+h:  Display the Find and Replace dialog box (with Replace selected).",
      "Shift+F4:  Repeat last find.",
      "Ctrl+g,F5:  Display the 'Go To' dialog box.",
      "Ctrl+Left,Ctrl+Right:  Inside a cell: Move one word to the left / to the right.",
      "Home,End:  Inside a cell: Move to the beginning / to the end of a cell entry.",
      "Alt+Down:  Display the AutoComplete list e.g. in cell with dropdowns or autofilter.",
      "End:  Turn 'End' mode on. In End mode, press arrow keys to move to the next nonblank cell in the same column or row as the active cell. From here use arrow keys to move by blocks of data, home to move to last cell, or enter to move to the last cell to the right.",
    ]
  }, {
    group: 'Select cells',
    shortcuts: [
      "Shift+Space:  Select the entire row.",
      "Ctrl+Space:  Select the entire column.",
      "Ctrl+Shift+*:  (asterisk) Select the current region around the active cell.",
      "Ctrl+a,Ctrl+Shift+Space:  Select the entire worksheet or the data-containing area. Pressing Ctrl+a a second time then selects entire worksheet.",
      "Ctrl+Shift+PageUp:  Select the current and previous sheet in a workbook.",
      "Ctrl+Shift+o:  Select all cells with comments.",
      "Shift+Left,Shift+Up,Shift+Right,Shift+Down:  Extend the selection by one cell.",
      "Ctrl+Shift+Left,Ctrl+Shift+Up,Ctrl+Shift+Right,Ctrl+Shift+Down:  Extend the selection to the last cell with content in row or column.",
      "Shift+PageDown,Shift+PageUp:  Extend the selection down one screen /up one screen.",
      "Shift+Home:  Extend the selection to the beginning of the row.",
      "Ctrl+Shift+Home:  Extend the selection to the beginning of the worksheet.",
      "Ctrl+Shift+End:  Extend the selection to the last used cell on the worksheet (lower-right corner).",
    ]
  }, {
    group: 'Manage Active Selections',
    shortcuts: [
      "F8:  Turn on extension of selection with arrow keys without having to keep pressing Shift.",
      "Shift+F8:  Add another (adjacent or non-adjacent) range of cells to the selection. Use arrow keys and Shift+arrow keys to add to selection.",
      "Shift+Backspace:  Select only the active cell when multiple cells are selected.",
      "Ctrl+Backspace:  Show active cell within selection.",
      "Ctrl+.:  (period) Move clockwise to the next corner of the selection.",
      "Enter,Shift+Enter:  Move active cell down / up in a selection.",
      "Tab,Shift+Tab:  Move active cell right / left in a selection.",
      "Ctrl+Alt+Right,Ctrl+Alt+Left:  Move to the right / to the left between non-adjacent selections (with multiple ranges selected).",
      "Esc:  Cancel Selection.",
    ]
  }, {
    group: 'Select inside cells',
    shortcuts: [
      "Shift+Left,Shift+Right:  Select or unselect one character to the left / to the right.",
      "Ctrl+Shift+Left,Ctrl+Shift+Right:  Select or unselect one word to the left / to the right.",
      "Shift+Home,Shift+End:  Select from the insertion point to the beginning / to the end of the cell.",
    ]
  }, {
    group: "Undo / Redo Shortcuts",
    shortcuts: [
      "Ctrl+z:  Undo last action (multiple levels).",
      "Ctrl+y:  Redo last action (multiple levels).",
    ]
  }, {
    group: "Work with Clipboard",
    shortcuts: [
      "Ctrl+c:  Copy contents of selected cells.",
      "Ctrl+x:  Cut contents of selected cells.",
      "Ctrl+v:  Paste content from clipboard into selected cell.",
      "Ctrl+Alt+v:  If data exists in clipboard: Display the Paste Special dialog box.",
      "Ctrl+Shift+Plus:  If data exists in clipboard: Display the Insert dialog box to insert blank cells.",
    ]
  }, {
    group: "Edit Inside Cells",
    shortcuts: [
      "F2:  Edit the active cell with cursor at end of the line.",
      "Alt+Enter:  Start a new line in the same cell.",
      "Enter:  Complete a cell entry and move down in the selection. With multiple cells selected: fill cell range with current cell.",
      "Shift+Enter:  Complete a cell entry and move up in the selection.",
      "Tab,Shift+Tab:  Complete a cell entry and move to the right / to the left in the selection.",
      "Esc:  Cancel a cell entry.",
      "Backspace:  Delete the character to the left of the insertion point, or delete the selection.",
      "Del:  Delete the character to the right of the insertion point, or delete the selection.",
      "Ctrl+Del:  Delete text to the end of the line.",
      "Ctrl+;:  (semicolon) Insert current date.",
      "Ctrl+Shift+::  Insert current time.",
      "Ctrl+t:  Show all content as standard numbers. (So 14:15 becomes 14.25 etc for the entire file) To undo press Ctrl + t again",
    ]
  }, {
    group: "Edit Active or Selected Cells",
    shortcuts: [
      "Ctrl+d:  Fill complete cell down (Copy above cell).",
      "Ctrl+r:  Fill complete cell to the right (Copy cell from the left).",
      "Ctrl+\":  Fill cell values down and edit (Copy above cell values).",
      "Ctrl+':  (apostrophe) Fill cell formulas down and edit (Copy above cell formulas).",
      "Ctrl+l:  Insert a table (display Create Table dialog box).",
      "Ctrl+-:  Delete Cell/Row/Column Menu, or do the action with row/column selected",
      "Ctrl+Shift+Plus:  Insert Cell/Row/Column Menu, or do the action with row/column selected",
      "Shift+F2:  Insert / Edit a cell comment.",
      "Shift+f10 m:  Delete comment.",
      "Alt+F1:  Create and insert chart with data in current range as embedded Chart Object.",
      "F11:  Create and insert chart with data in current range in a separate Chart sheet.",
      "Ctrl+k:  Insert a hyperlink.",
      "Enter:  (in a cell with a hyperlink) Activate a hyperlink.",
    ]
  }, {
    group: "Hide and Show Elements",
    shortcuts: [
      "Ctrl+9:  Hide the selected rows.",
      "Ctrl+Shift+9:  Unhide any hidden rows within the selection.",
      "Ctrl+0:  Hide the selected columns.",
      "Ctrl+Shift+0:  Unhide any hidden columns within the selection*.",
      "Ctrl+`:  (grave accent)  Alternate between displaying cell values and displaying cell formulas. Accent grave /not a quotation mark.",
      "Alt+Shift+Right:  Group rows or columns.",
      "Alt+Shift+Left:  Ungroup rows or columns.",
      "Ctrl+6:  Alternate between hiding and displaying objects.",
      "Ctrl+8:  Display or hides the outline symbols.",
      "Ctrl+6:  Alternate between hiding objects, displaying objects, and displaying placeholders for objects.",
    ]
  }, {
    group: "Adjust Column Width and Row Height",
    shortcuts: [
      "Alt+o c a:  Adjust Column width to fit content. Select complete column with Ctrl+Space first, otherwise column adjusts to content of current cell). Remember Format, Column Adjust.",
      "Alt+o c w:  Adjust Columns width to specific value: Option, Cow, width",
      "Alt+o r a:  Adjust Row height to fit content: Option, Row, Adjust",
      "Alt+o r e:  Adjust Row height to specific value: Option, Row, Height",
    ]
  }, {
    group: "Format Cells",
    shortcuts: [
      "Ctrl+1:  Format cells dialog.",
      "Ctrl+b, Ctrl+2:  Apply or remove bold formatting.",
      "Ctrl+i, Ctrl+3:  Apply or remove italic formatting.",
      "Ctrl+u, Ctrl+4:  Apply or remove an underline.",
      "Ctrl+5:  Apply or remove strikethrough formatting.",
      "Ctrl+Shift+f:  Display the Format Cells with Fonts Tab active. Press tab 3x to get to font-size. Used to be Ctrl+Shift+p, but that seems just get to the Font Tab in 2010.",
      "Alt+':  (apostrophe / single quote) Display the Style dialog box.",
    ]
  }, {
    group: "Number Formats",
    shortcuts: [
      "Ctrl+Shift+$:  Apply the Currency format with two decimal places.",
      "Ctrl+Shift+~:  Apply the General number format.",
      "Ctrl+Shift+%:  Apply the Percentage format with no decimal places.",
      "Ctrl+Shift+#:  Apply the Date format with the day, month, and year.",
      "Ctrl+Shift+@:  Apply the Time format with the hour and minute, and indicate A.M. or P.M.",
      "Ctrl+Shift+!:  Apply the Number format with two decimal places, thousands separator, and minus sign (-) for negative values.",
      "Ctrl+Shift+^:  Apply the Scientific number format with two decimal places.",
      "F4:  Repeat last formatting action: Apply previously applied Cell Formatting to a different Cell",
    ]
  }, {
    group: "Apply Borders to Cells",
    shortcuts: [
      "Ctrl+Shift+&:  Apply outline border from cell or selection",
      "Ctrl+Shift+_:  (underscore) Remove outline borders from cell or selection",
      "Ctrl+1:  Access border menu in 'Format Cell' dialog. Once border was selected, it will show up directly on the next Ctrl+1",
      "Alt+t:  Set top border",
      "Alt+b:  Set bottom Border",
      "Alt+l:  Set left Border",
      "Alt+r:  Set right Border",
      "Alt+d:  Set diagonal and down border",
      "Alt+u:  Set diagonal and up border",
    ]
  }, {
    group: "Align Cells",
    shortcuts: [
      "Alt+h a r:  Align Right",
      "Alt+h a c:  Align Center",
      "Alt+h a l:  Align Left",
    ]
  }, {
    group: "Formulas",
    shortcuts: [
      "=:   Start a formula.",
      "Alt+=:  Insert the AutoSum formula.",
      "Shift+F3:  Display the Insert Function dialog box.",
      "Ctrl+a:  Display Formula Window after typing formula name.",
      "Ctrl+Shift+a:  Insert Arguments in formula after typing formula name. .",
      "Shift+F3:  Insert a function into a formula .",
      "Ctrl+Shift+Enter:  Enter a formula as an array formula.",
      "F4:  After typing cell reference (e.g. =E3) makes reference absolute (=$E$4)",
      "F9:  Calculate all worksheets in all open workbooks.",
      "Shift+F9:  Calculate the active worksheet.",
      "Ctrl+Alt+F9:  Calculate all worksheets in all open workbooks, regardless of whether they have changed since the last calculation.",
      "Ctrl+Alt+Shift+F9:  Recheck dependent formulas, and then calculates all cells in all open workbooks, including cells not marked as needing to be calculated.",
      "Ctrl+Shift+u:  Toggle expand or collapse formula bar.",
      "Ctrl+`:  Toggle Show formula in cell instead of values",
    ]
  }, {
    group: "Names",
    shortcuts: [
      "Ctrl+F3:  Define a name or dialog.",
      "Ctrl+Shift+F3:  Create names from row and column labels.",
      "F3:  Paste a defined name into a formula.",
    ]
  }, {
    group: "Manage Multipe Worksheets",
    shortcuts: [
      "Shift+F11,Alt+Shift+F1:  Insert a new worksheet in current workbook.",
      "Ctrl+PageDown,Ctrl+PageUp:  Move to the next / previous worksheet in current workbook.",
      "Shift+Ctrl+PageDown,Shift+Ctrl+PageUp:  Select the current and next sheet(s) / select and previous sheet(s).",
      "Alt+o h r:  Rename current worksheet (format, sheet, rename)",
      "Alt+e l:  Delete current worksheet (Edit, delete)",
      "Alt+e m:  Move current worksheet (Edit, move)",
    ]
  }, {
    group: "Manage Multiple Workbooks",
    shortcuts: [
      "F6,Shift+F6:  Move to the next pane / previous pane in a workbook that has been split.",
      "Ctrl+F4:  Close the selected workbook window.",
      "Ctrl+n:  Create a new blank workbook (Excel File)",
      "Ctrl+Tab,Ctrl+Shift+Tab:  Move to next / previous workbook window.",
      "Alt+Space:  Display the Control menu for Main Excel window.",
      "Ctrl+F9:  Minimize current workbook window to an icon. Also restores ('un-maximizes') all workbook windows.",
      "Ctrl+F10:  Maximize or restores the selected workbook window.",
      "Ctrl+F7:  Move Workbook Windows which are not maximized.",
      "Ctrl+F8:  Perform size command for workbook windows which are not maximzed.",
      "Alt+F4:  Close Excel.",
    ]
  }, {
    group: "Various Excel Features",
    shortcuts: [
      "Ctrl+o:  Open File.",
      "Ctrl+s:  Save the active file with its current file name, location, and file format.",
      "F12:  Display the Save As dialog box.",
      "F10, Alt:  Turn key tips on or off.",
      "Ctrl+p:  Print File (Opens print menu).",
      "F1:  Display the Excel Help task pane.",
      "F7:  Display the Spelling dialog box.",
      "Shift+F7:  Display the Thesaurus dialog box.",
      "Alt+F8:  Display the Macro dialog box.",
      "Alt+F11:  Open the Visual Basic Editor to create Macros.",
    ]
  }, {
    group: "Work with the Excel Ribbon",
    shortcuts: [
      "Ctrl+F1:  Minimize or restore the Ribbon.s",
      "Alt,F10:  Select the active tab of the Ribbon and activate the access keys. Press either of these keys again to move back to the document and cancel the access keys. and then arrow left or arrow right",
      "Shift+F10:  Display the shortcut menu for the selected command.",
      "Space,Enter:  Activate the selected command or control in the Ribbon, Open the selected menu or gallery in the Ribbon..",
      "Enter:  Finish modifying a value in a control in the Ribbon, and move focus back to the document.",
      "F1:  Get help on the selected command or control in the Ribbon. (If no Help topic is associated with the selected command, the Help table of contents for that program is shown instead.)",
    ]
  }, {
    group: "Data Forms",
    shortcuts: [
      "Tab,Shift+Tab:  Move to the next / previous field which can be edited.",
      "Enter,Shift+Enter:  Move to the first field in the next / previous record.",
      "PageDown,PageUp:  Move to the same field 10 records forward / back.",
      "Ctrl+PageDown:  Move to a new record.",
      "Ctrl+PageUp:  Move to the first record.",
      "Home,End:  Move to the beginning / end of a field.",
    ]
  }, {
    group: "Pivot Tables",
    shortcuts: [
      "Left,Up,Right,Down:  Navigate inside Pivot tables.",
      "Home,End:  Select the first / last visible item in the list.",
      "Alt+c:  Move the selected field into the Column area.",
      "Alt+d:  Move the selected field into the Data area.",
      "Alt+l:  Display the PivotTable Field dialog box.",
      "Alt+p:  Move the selected field into the Page area.",
      "Alt+r:  Move the selected field into the Row area.",
      "Ctrl+Shift+*:  (asterisk) Select the entire PivotTable report.",
      "Alt+Down:  Display the list for the current field in a PivotTable report.",
      "Alt+Down:  Display the list for the current page field in a PivotChart report.",
      "Enter:  Display the selected item.",
      "Space:  Select or clear a check box in the list.",
      "Ctrl+Tab Ctrl+Shift+Tab:  select the PivotTable toolbar.",
      "Down,Up:  After 'Enter', on a field button: select the area you want to move the selected field to.",
      "Alt+Shift+Right:  Group selected PivotTable items.",
      "Alt+Shift+Left:  Ungroup selected PivotTable items.",
    ]
  }, {
    group: "Dialog Boxes",
    shortcuts: [
      "Left,Up,Right,Down:  Move between options in the active drop-down list box or between some options in a group of options.",
      "Ctrl+Tab,Ctrl+Shift+Tab:  Switch to the next/ previous tab in dialog box.",
      "Space:  In a dialog box: perform the action for the selected button, or select/clear a check box.",
      "Tab,Shift+Tab:  Move to the next / previous option.",
      "a ... z:  Move to an option in a drop-down list box starting with the letter",
      "Alt+a ... Alt+z:  Select an option, or select or clear a check box.",
      "Alt+Down:  Open the selected drop-down list box.",
      "Enter:  Perform the action assigned to the default command button in the dialog box.",
      "Esc:  Cancel the command and close the dialog box.",
    ]
  }, {
    group: "Auto Filter",
    shortcuts: [
      "Alt+Down:  On the field with column head, display the AutoFilter list for the current column .",
      "Down,Up:  Select the next item / previous item in the AutoFilter list.",
      "Alt+Up:  Close the AutoFilter list for the current column.",
      "Home,End:  Select the first item / last item in the AutoFilter list.",
      "Enter:  Filter the list by using the selected item in the AutoFilter list.",
      "Ctrl+Shift+L:  Apply filter on selected column headings.",
    ]
  }, {
    group: "Work with Smart Art Graphics",
    shortcuts: [
      "Left,Up,Right,Down:  Select elements.",
      "Esc:  Remove Focus from Selection.",
      "F2:  Edit Selection Text in if possible (in formula bar).",
    ]
  }];
};
