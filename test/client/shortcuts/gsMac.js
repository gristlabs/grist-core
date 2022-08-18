// From https://support.google.com/docs/answer/181110?hl=en
exports.shortcuts = function() {
  return [{
    group: "Common actions",
    shortcuts: [
      "Ctrl + Space:  Select column ",
      "Shift + Space:  Select row",
      "⌘ + A, ⌘ + Shift + Space :  Select all",
      "⌘ + Shift + Backspace:  Hide background over selected cells ",
      "⌘ + Z:  Undo",
      "⌘ + Y, ⌘ + Shift + Z, Fn + F4 :  Redo",
      "⌘ + F:  Find",
      "⌘ + Shift + H:  Find and replace",
      "⌘ + Enter:  Fill range",
      "⌘ + D:  Fill down ",
      "⌘ + R:  Fill right",
      "⌘ + S:  Save; Every change is saved automatically in Drive",
      "⌘ + O:  Open",
      "⌘ + P:  Print ",
      "⌘ + C:  Copy",
      "⌘ + X:  Cut ",
      "⌘ + V:  Paste ",
      "⌘ + Shift + V:  Paste values only ",
      "⌘ + /:  Show common keyboard shortcuts",
      "Ctrl + Shift + F:  Compact controls",
      "⌘ + Shift + K:  Input tools on/off (available in spreadsheets in non-Latin languages)",
      "⌘ + Option + Shift + K:  Select input tools",
    ]
  }, {
    group: "Cell formatting",
    shortcuts: [
      "⌘ + B:  Bold",
      "⌘ + U:  Underline ",
      "⌘ + I:  Italic",
      "Option + Shift + 5:  Strikethrough ",
      "⌘ + Shift + E:  Center align",
      "⌘ + Shift + L:  Left align",
      "⌘ + Shift + R:  Right align ",
      "Option + Shift + 1:  Apply top border",
      "Option + Shift + 2:  Apply right border",
      "Option + Shift + 3:  Apply bottom border ",
      "Option + Shift + 4:  Apply left border ",
      "Option + Shift + 6:  Remove borders",
      "Option + Shift + 7:  Apply outer border",
      "⌘ + K:  Insert link ",
      "⌘ + Shift + ;:  Insert time ",
      "⌘ + ;:  Insert date ",
      "⌘ + Shift + 1:  Format as decimal ",
      "⌘ + Shift + 2:  Format as time",
      "⌘ + Shift + 3:  Format as date",
      "⌘ + Shift + 4:  Format as currency",
      "⌘ + Shift + 5:  Format as percentage",
      "⌘ + Shift + 6:  Format as exponent",
      "⌘ + \\:  Clear formatting",
    ]
  }, {
    group: "Spreadsheet navigation",
    shortcuts: [
      "Home, Fn + Left:  Move to beginning of row",
      "⌘ + Home, ⌘ + Fn + Left:  Move to beginning of sheet",
      "End, Fn + Right:  Move to end of row",
      "⌘ + End, ⌘ + Fn + Right:  Move to end of sheet",
      "⌘ + Backspace:  Scroll to active cell ",
      "⌘ + Shift + PageDown, ⌘ + Shift + Fn + Down:  Move to next sheet",
      "⌘ + Shift + PageUp, ⌘ + Shift + Fn + Up:  Move to previous sheet",
      "Option + Shift + K:  Display list of sheets",
      "Option + Enter:  Open hyperlink",
      "Ctrl + ⌘ + Shift + M:  Move focus out of spreadsheet ",
      "Option + Shift + Q:  Move to quicksum (when a range of cells is selected) ",
      "Ctrl+⌘ +E Ctrl+⌘ +P:  Move focus to popup (for links, bookmarks, and images)",
      "Ctrl + ⌘ + R:  Open drop-down menu on filtered cell",
      "⌘ + Option + Shift + G:  Open revision history ",
      "Shift + Esc:  Open chat inside the spreadsheet",
      "⌘ + Esc, Shift + Esc:  Close drawing editor",
    ]
  }, {
    group: "Notes and comments",
    shortcuts: [
      "Shift + Fn + F2:  Insert/edit note",
      "⌘ + Option + M:  Insert/edit comment ",
      "⌘ + Option + Shift + A:  Open comment discussion thread",
      "Ctrl+⌘ +E Ctrl+⌘ +C:  Enter current comment ",
      "Ctrl+⌘ +N Ctrl+⌘ +C:  Move to next comment",
      "Ctrl+⌘ +P Ctrl+⌘ +C:  Move to previous comment",

    ]
  }, {
    group: "Menus",
    shortcuts: [
      "Ctrl + Option + F:  File menu ",
      "Ctrl + Option + E:  Edit menu ",
      "Ctrl + Option + V:  View menu ",
      "Ctrl + Option + I:  Insert menu ",
      "Ctrl + Option + O:  Format menu ",
      "Ctrl + Option + D:  Data menu ",
      "Ctrl + Option + T:  Tools menu",
      "Ctrl + Option + M:  Form menu (present when the spreadsheet is connected to a form) ",
      "Ctrl + Option + N:  Add-ons menu (present in the new Google Sheets)",
      "Ctrl + Option + H:  Help menu ",
      "Ctrl + Option + A:  Accessibility menu (present when screen reader support is enabled) ",
      "Option + Shift + S:  Sheet menu(copy, delete, and other sheet actions) ",
      "⌘ + Shift + \\:  Context menu",

    ]
  }, {
    group: "Insert or delete rows or columns (via opening menu)",
    shortcuts: [
      "Ctrl+Option+I R:  Insert row above",
      "Ctrl+Option+I W:  Insert row below",
      "Ctrl+Option+I C:  Insert column to the left ",
      "Ctrl+Option+I G:  Insert column to the right",
      "Ctrl+Option+E D:  Delete row",
      "Ctrl+Option+E E:  Delete column ",

    ]
  }, {
    group: "Formulas",
    shortcuts: [
      "Ctrl + ~:  Show all formulas ",
      "⌘ + Shift + Enter:  Insert array formula",
      "⌘ + E:  Collapse an expanded array formula",
      "Shift + Fn + F1:  Show/hide formula help (when entering a formula) ",

    ]
  }, {
    group: "Screen reader support",
    shortcuts: [
      "⌘ + Option + Z:  Enable screen reader support",
      "⌘ + Option + Shift + C:  Read column ",
      "⌘ + Option + Shift + R:  Read row",
    ]
  }];
};
