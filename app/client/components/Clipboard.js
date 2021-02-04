/**
 * Clipboard component manages the copy/cut/paste events by capturing these events from the browser,
 * managing their state, and exposing an API to other components to get/set the data.
 *
 * Because of a lack of standardization of ClipboardEvents between browsers, the way Clipboard
 * captures the events is by creating a hidden textarea element that's always focused with some text
 * selected. Here is a good write-up of this:
 * https://www.lucidchart.com/techblog/2014/12/02/definitive-guide-copying-pasting-javascript/
 *
 * When ClipboardEvent is detected, Clipboard captures the event and calls the corresponding
 * copy/cut/paste/input command actions, which will get called on the appropriate component.
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

var {tsvDecode} = require('app/common/tsvFormat');
var {FocusLayer} = require('app/client/lib/FocusLayer');

var commands = require('./commands');
var dom = require('../lib/dom');
var Base = require('./Base');
var tableUtil = require('../lib/tableUtil');

function Clipboard(app) {
  Base.call(this, null);
  this._app = app;
  this.copypasteField = this.autoDispose(dom('textarea.copypaste.mousetrap', ''));
  this.timeoutId = null;

  this.onEvent(this.copypasteField, 'input', function(elem, event) {
    var value = elem.value;
    elem.value = '';
    commands.allCommands.input.run(value);
    return false;
  });
  this.onEvent(this.copypasteField, 'copy',  this._onCopy);
  this.onEvent(this.copypasteField, 'cut',   this._onCut);
  this.onEvent(this.copypasteField, 'paste', this._onPaste);

  document.body.appendChild(this.copypasteField);

  FocusLayer.create(this, {
    defaultFocusElem: this.copypasteField,
    allowFocus: allowFocus,
    onDefaultFocus: () => {
      this.copypasteField.value = ' ';
      this.copypasteField.select();
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

  // In the event of a cut a callback is provided by the viewsection that is the target of the cut.
  // When called it returns the additional removal action needed for a cut.
  this._cutCallback = null;
  // The plaintext content of the cut callback. Used to verify that we are pasting the results
  // of the cut, rather than new data from outside.
  this._cutData = null;
}
Base.setBaseFor(Clipboard);

/**
 * Internal helper fired on `copy` events. If a callback was registered from a component, calls the
 * callback to get selection data and puts it on the clipboard.
 */
Clipboard.prototype._onCopy = function(elem, event) {
  event.preventDefault();

  let pasteObj = commands.allCommands.copy.run();

  this._setCBdata(pasteObj, event.originalEvent.clipboardData);
};

Clipboard.prototype._onCut = function(elem, event) {
  event.preventDefault();

  let pasteObj = commands.allCommands.cut.run();

  this._setCBdata(pasteObj, event.originalEvent.clipboardData);
};

Clipboard.prototype._setCBdata = function(pasteObj, clipboardData) {

  if (!pasteObj) {
    return;
  }

  let plainText = tableUtil.makePasteText(pasteObj.data, pasteObj.selection);
  clipboardData.setData('text/plain', plainText);
  let htmlText = tableUtil.makePasteHtml(pasteObj.data, pasteObj.selection);
  clipboardData.setData('text/html', htmlText);

  if (pasteObj.cutCallback) {
    this._cutCallback = pasteObj.cutCallback;
    this._cutData = plainText;
  } else {
    this._cutCallback = null;
    this._cutData = null;
  }
};

/**
 * Internal helper fired on `paste` events. If a callback was registered from a component, calls the
 * callback with data from the clipboard.
 */
Clipboard.prototype._onPaste = function(elem, event) {
  event.preventDefault();
  let cb = event.originalEvent.clipboardData;
  let plainText = cb.getData('text/plain');
  let htmlText = cb.getData('text/html');
  let data;

  // Grist stores both text/html and text/plain when copying data. When pasting back, we first
  // check if text/html exists (should exist for Grist and other spreadsheet software), and fall
  // back to text/plain otherwise.
  try {
    data = tableUtil.parsePasteHtml(htmlText);
  } catch (e) {
    if (plainText === '' || plainText.charCodeAt(0) === 0xFEFF) {
      data = [['']];
    } else {
      data = tsvDecode(plainText.replace(/\r\n?/g, "\n"));
    }
  }

  if (this._cutData === plainText) {
    if (this._cutCallback) {
      // Cuts should only be possible on the first paste after a cut and only if the data being
      // pasted matches the data that was cut.
      commands.allCommands.paste.run(data, this._cutCallback);
    }
  } else {
    this._cutData = null;
    commands.allCommands.paste.run(data, null);
  }
  // The cut callback should only be usable once so it needs to be cleared after every paste.
  this._cutCallback = null;
};

var FOCUS_TARGET_TAGS = {
  'INPUT': true,
  'TEXTAREA': true,
  'SELECT': true,
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

Clipboard.allowFocus = allowFocus;

module.exports = Clipboard;
