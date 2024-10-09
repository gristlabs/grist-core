/**
 * Clipboard component manages the copy/cut/paste events by capturing these events from the browser,
 * managing their state, and exposing an API to other components to get/set the data.
 *
 * When ClipboardEvent is detected, Clipboard captures the event and calls the corresponding
 * copy/cut/paste/input command actions, which will get called on the appropriate component.
 *
 * The Clipboard also handles triggering correctly the "input" command when any key is pressed.
 *
 * Usage:
 *    Components need to register copy/cut/paste actions with command.js:
 *      .copy() should return @pasteObj (defined below).
 *      .paste(plainText, [cutSelection]) should take a plainText value and an optional cutSelection
 *      parameter which will specify the selection that should be cleared as part of paste.
 *      .input(char) should take a single input character and will be called when the user types a
 *      visible character (useful if component wants to interpret typing into a cell, for example).
 */

/**
 * Paste object that should be returned by implementation of `copy`.
 *
 * @typedef pasteObj {{
 *    docName: string,
 *    tableId: string,
 *    data:    object,
 *    selection: object
 * }}
 */



/* global window, document */

var {getHumanKey, isMac} = require('app/client/components/commands');
var {copyToClipboard, readDataFromClipboard} = require('app/client/lib/clipboardUtils');
var {FocusLayer} = require('app/client/lib/FocusLayer');
var {makeT} = require('app/client/lib/localization');

var {tsvDecode} = require('app/common/tsvFormat');
var {ShortcutKey, ShortcutKeyContent} = require('app/client/ui/ShortcutKey');
var {confirmModal} = require('app/client/ui2018/modals');
var {styled} = require('grainjs');

var commands = require('./commands');
var Base = require('./Base');
var tableUtil = require('../lib/tableUtil');

const t = makeT('Clipboard');

function Clipboard(app) {
  Base.call(this, null);
  this._app = app;

  FocusLayer.create(this, {
    defaultFocusElem: document.body,
    onDefaultFocus: () => {
      this._app.trigger('clipboard_focus');
    },
    onDefaultBlur: () => {
      this._app.trigger('clipboard_blur');
    },
  });

  // Expose the grabber as a global to allow upload from tests to explicitly restore focus
  window.gristClipboardGrabFocus = () => FocusLayer.grabFocus();

  // Some bugs may prevent Clipboard from re-grabbing focus. To limit the impact of such bugs on
  // the user, recover from a bad state in mousedown events. (At the moment of this comment, all
  // such known bugs are fixed.)
  this.onEvent(window, 'mousedown', (ev) => {
    if (!document.activeElement || document.activeElement === document.body) {
      FocusLayer.grabFocus();
    }
  });

  // Listen for copy/cut/paste events and trigger the corresponding clipboard action.
  // Note that internally, before triggering the action, we check if the currently active element
  // doesn't already handle these events itself.
  // This allows to globally handle copy/cut/paste events, without impacting
  // inputs/textareas/selects where copy/cut/paste events should be left alone.
  this.onEvent(document, 'copy', (_, event) => this._onCopy(event));
  this.onEvent(document, 'cut', (_, event) => this._onCut(event));
  this.onEvent(document, 'paste', (_, event) => this._onPaste(event));

  // when typing a random printable character while not focusing an interactive element,
  // trigger the input command with it
  // @TODO: there is currently an issue, sometimes when typing something, that makes us focus a cell textarea,
  // and then we can mouseclick on a different cell: dom focus is still on textarea, visual table focus is on new cell.
  this.onEvent(document.body, 'keydown', (_, event) => {
    if (shouldAvoidClipboardShortcuts(document.activeElement)) {
      return;
    }
    const ev = event.originalEvent;
    const collapsesWithCommands = keypressCollapsesWithExistingCommand(ev);
    const isPrintableCharacter = keypressIsPrintableCharacter(ev);
    if (!collapsesWithCommands && isPrintableCharacter) {
      commands.allCommands.input.run(ev.key);
      event.preventDefault();
    } else {
      console.log(ev.key, ev.key.length, ev.code);
    }
  });

  // In the event of a cut a callback is provided by the viewsection that is the target of the cut.
  // When called it returns the additional removal action needed for a cut.
  this._cutCallback = null;
  // The plaintext content of the cut callback. Used to verify that we are pasting the results
  // of the cut, rather than new data from outside.
  this._cutData = null;

  this.autoDispose(commands.createGroup(Clipboard.commands, this, true));
}
Base.setBaseFor(Clipboard);

Clipboard.commands = {
  contextMenuCopy: function() { this._doContextMenuCopy(); },
  contextMenuCopyWithHeaders: function() { this._doContextMenuCopyWithHeaders(); },
  contextMenuCut: function() { this._doContextMenuCut(); },
  contextMenuPaste: function() { this._doContextMenuPaste(); },
};

/**
 * Internal helper fired on `copy` events. If a callback was registered from a component, calls the
 * callback to get selection data and puts it on the clipboard.
 */
Clipboard.prototype._onCopy = function(event) {
  if (shouldAvoidClipboardShortcuts(document.activeElement)) {
    return;
  }
  event.preventDefault();

  let pasteObj = commands.allCommands.copy.run();

  this._setCBdata(pasteObj, event.originalEvent.clipboardData);
};

Clipboard.prototype._doContextMenuCopy = function() {
  let pasteObj = commands.allCommands.copy.run();

  this._copyToClipboard(pasteObj, 'copy', false);
};

Clipboard.prototype._doContextMenuCopyWithHeaders = function() {
  let pasteObj = commands.allCommands.copy.run();

  this._copyToClipboard(pasteObj, 'copy', true);
};

Clipboard.prototype._onCut = function(event) {
  if (shouldAvoidClipboardShortcuts(document.activeElement)) {
    return;
  }

  event.preventDefault();

  let pasteObj = commands.allCommands.cut.run();

  this._setCBdata(pasteObj, event.originalEvent.clipboardData);
};

Clipboard.prototype._doContextMenuCut = function() {
  let pasteObj = commands.allCommands.cut.run();

  this._copyToClipboard(pasteObj, 'cut');
};

Clipboard.prototype._setCBdata = function(pasteObj, clipboardData) {
  if (!pasteObj) { return; }

  const plainText = tableUtil.makePasteText(pasteObj.data, pasteObj.selection, false);
  clipboardData.setData('text/plain', plainText);
  const htmlText = tableUtil.makePasteHtml(pasteObj.data, pasteObj.selection, false);
  clipboardData.setData('text/html', htmlText);

  this._setCutCallback(pasteObj, plainText);
};

Clipboard.prototype._copyToClipboard = async function(pasteObj, action, includeColHeaders) {
  if (!pasteObj) { return; }

  const plainText = tableUtil.makePasteText(pasteObj.data, pasteObj.selection, includeColHeaders);
  let data;
  if (typeof ClipboardItem === 'function') {
    const htmlText = tableUtil.makePasteHtml(pasteObj.data, pasteObj.selection, includeColHeaders);
    // eslint-disable-next-line no-undef
    data = new ClipboardItem({
      // eslint-disable-next-line no-undef
      'text/plain': new Blob([plainText], {type: 'text/plain'}),
      // eslint-disable-next-line no-undef
      'text/html': new Blob([htmlText], {type: 'text/html'}),
    });
  } else {
    data = plainText;
  }

  try {
    await copyToClipboard(data);
  } catch {
    showUnavailableMenuCommandModal(action);
    return;
  }

  this._setCutCallback(pasteObj, plainText);
};

/**
 * Sets the cut callback from the `pasteObj` if one exists. Otherwise clears the
 * cut callback.
 *
 * The callback is called on paste, and only if the pasted data matches the `cutData`
 * that was cut from within Grist. The callback handles removal of the data that was
 * cut.
 */
Clipboard.prototype._setCutCallback = function(pasteObj, cutData) {
  if (pasteObj.cutCallback) {
    this._cutCallback = pasteObj.cutCallback;
    this._cutData = cutData;
  } else {
    this._cutCallback = null;
    this._cutData = null;
  }
};

/**
 * Internal helper fired on `paste` events. If a callback was registered from a component, calls the
 * callback with data from the clipboard.
 */
Clipboard.prototype._onPaste = function(event) {
  if (shouldAvoidClipboardShortcuts(document.activeElement)) {
    return;
  }

  event.preventDefault();
  const cb = event.originalEvent.clipboardData;
  const plainText = cb.getData('text/plain');
  const htmlText = cb.getData('text/html');
  const pasteData = getPasteData(plainText, htmlText);
  this._doPaste(pasteData, plainText);
};


Clipboard.prototype._doContextMenuPaste = async function() {
  let clipboardItem;
  try {
    clipboardItem = (await readDataFromClipboard())?.[0];
  } catch {
    showUnavailableMenuCommandModal('paste');
    return;
  }
  const plainText = await getTextFromClipboardItem(clipboardItem, 'text/plain');
  const htmlText = await getTextFromClipboardItem(clipboardItem, 'text/html');
  const pasteData = getPasteData(plainText, htmlText);
  this._doPaste(pasteData, plainText);
};

Clipboard.prototype._doPaste = function(pasteData, plainText) {
  console.log(this._cutData, plainText, this._cutCallback);
  if (this._cutData === plainText) {
    if (this._cutCallback) {
      // Cuts should only be possible on the first paste after a cut and only if the data being
      // pasted matches the data that was cut.
      commands.allCommands.paste.run(pasteData, this._cutCallback);
    }
  } else {
    this._cutData = null;
    commands.allCommands.paste.run(pasteData, null);
  }
  // The cut callback should only be usable once so it needs to be cleared after every paste.
  this._cutCallback = null;
}

/**
 * Returns data formatted as a 2D array of strings, suitable for pasting within Grist.
 *
 * Grist stores both text/html and text/plain when copying data. When pasting back, we first
 * check if text/html exists (should exist for Grist and other spreadsheet software), and fall
 * back to text/plain otherwise.
 */
function getPasteData(plainText, htmlText) {
  try {
    return tableUtil.parsePasteHtml(htmlText);
  } catch (e) {
    if (plainText === '' || plainText.charCodeAt(0) === 0xFEFF) {
      return [['']];
    } else {
      return tsvDecode(plainText.replace(/\r\n?/g, "\n").trimEnd());
    }
  }
}

/**
 * Returns clipboard data of the given `type` from `clipboardItem` as text.
 *
 * Returns an empty string if `clipboardItem` is nullish or no data exists
 * for the given `type`.
 */
async function getTextFromClipboardItem(clipboardItem, type) {
  if (!clipboardItem) { return ''; }

  try {
    return (await clipboardItem.getType(type)).text();
  } catch {
    // No clipboard data exists for the MIME type.
    return '';
  }
}

const CLIPBOARD_TAGS = {
  'INPUT': true,
  'TEXTAREA': true,
  'SELECT': true,
};

const FOCUS_TARGET_TAGS = {
  ...CLIPBOARD_TAGS,
  'IFRAME': true,
};

/**
 * Helper to determine if the currently active element deserves to keep its own focus, and capture
 * copy-paste events. Besides inputs and textareas, any element can be marked to be a valid
 * copy-paste target by adding 'clipboard_focus' class to it.
 */
function allowFocus(elem) {
  return elem && (FOCUS_TARGET_TAGS.hasOwnProperty(elem.tagName) ||
    elem.hasAttribute("tabindex") ||
    elem.classList.contains('clipboard_focus'));
}

/**
 * Helper to determine if the given element is a valid target for copy-cut-paste actions.
 *
 * It slightly differs from allowFocus: here we exclusively check for clipboard-related actions,
 * not focus-related ones.
 */
function shouldAvoidClipboardShortcuts(elem) {
  return elem && CLIPBOARD_TAGS.hasOwnProperty(elem.tagName)
}

Clipboard.allowFocus = allowFocus;

function showUnavailableMenuCommandModal(action) {
  let keys;
  switch (action) {
    case 'cut': {
      keys = 'Mod+X'
      break;
    }
    case 'copy': {
      keys = 'Mod+C'
      break;
    }
    case 'paste': {
      keys = 'Mod+V'
      break;
    }
    default: {
      throw new Error(`Clipboard: unrecognized action ${action}`);
    }
  }

  confirmModal(
    t("Unavailable Command"),
    t("Got it"),
    () => {},
    {
      explanation: cssModalContent(
        t(
          'The {{action}} menu command is not available in this browser. You can still {{action}}' +
          ' by using the keyboard shortcut {{shortcut}}.',
          {
            action,
            shortcut: ShortcutKey(ShortcutKeyContent(getHumanKey(keys, isMac))),
          }
        ),
      ),
      hideCancel: true,
    },
  );
}


/**
 * Helper to know if a keypress from a keydown/keypress/etc event is an actually printable character.
 *
 * This is useful in the Clipboard where we listen for keypresses outside of an input field,
 * trying to know if the keypress should be handled by the application or not.
 *
 * @param {KeyboardEvent} event
 * @returns {boolean}
 */
function keypressIsPrintableCharacter(event) {
  // We assume that any 'action' modifier key pressed will not result in a printable character.
  // This allows us to avoid stuff like "ctrl+r" (action), while keeping stuff like "altgr+r" (printable char).
  if (event.getModifierState('Control') || event.getModifierState('Meta')) {
    return false;
  }

  // Stop early if the key press does nothing, in order to prevent entering in a cell with no character.
  if (event.key === "") {
    return false;
  }

  // Count the number of characters in the key, using a spread operator trick to correctly count unicode characters.
  const keyLength = [...event.key].length;

  // From testing in various languages, we can assume all keys represented by a single character are printable.
  // Stop early in that case.
  if (keyLength === 1) {
    return true;
  }

  // When here, `event.key` could be a non-printable character like `ArrowUp`, `Enter`, `F3`…
  // or a printable character with length > 1, like `لا` in Arabic.
  // We want to avoid the first case.

  // Only special keys like `ArrowUp` etc are listed with uppercases when typed in lowercase.
  // Make tests around that depending on Shift key press.
  if (!event.getModifierState('Shift') && event.key.toLocaleLowerCase() === event.key
      || (
        event.getModifierState('Shift')
        && event.key.toLocaleLowerCase() === event.key
        && event.key.toLocaleUpperCase() === event.key
      )
  ) {
    return true;
  }

  // If we are here, it means the key is like `ArrowUp` and others, those are not printable.
  return false;
}

/**
 * Helper to know if a given keypress matches an existing command shortcut.
 *
 * @param {KeyboardEvent} event
 * @returns {boolean}
 */
function keypressCollapsesWithExistingCommand(event) {
  const shortcut = commands.getShortcutFromKeypress(event);
  return !!shortcut && shortcut.stopsPropagation;
}

module.exports = Clipboard;

const cssModalContent = styled('div', `
  line-height: 18px;
`);
