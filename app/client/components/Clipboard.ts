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

import {getHumanKey, isMac} from 'app/client/components/commands';
import type {CopySelection} from 'app/client/components/CopySelection';
import * as commands from 'app/client/components/commands';
import {copyToClipboard, readDataFromClipboard} from 'app/client/lib/clipboardUtils';
import {FocusLayer} from 'app/client/lib/FocusLayer';
import {makeT} from 'app/client/lib/localization';
import * as tableUtil from 'app/client/lib/tableUtil';
import type {App} from 'app/client/ui/App';
import {ShortcutKey, ShortcutKeyContent} from 'app/client/ui/ShortcutKey';
import {confirmModal} from 'app/client/ui2018/modals';
import type {TableData} from 'app/common/TableData';
import {tsvDecode} from 'app/common/tsvFormat';
import {Disposable, dom, styled} from 'grainjs';

const t = makeT('Clipboard');

/**
 * Paste object that should be returned by implementation of `copy`.
 */
export interface PasteObj {
  docName: string;
  tableId: string;
  data: TableData;
  selection: CopySelection;
  cutCallback?: () => unknown;
}


export class Clipboard extends Disposable {
  public static commands = {
    contextMenuCopy(this: Clipboard) { this._doContextMenuCopy(); },
    contextMenuCopyWithHeaders(this: Clipboard) { this._doContextMenuCopyWithHeaders(); },
    contextMenuCut(this: Clipboard) { this._doContextMenuCut(); },
    contextMenuPaste(this: Clipboard) { this._doContextMenuPaste().catch(reportError); },
  };

  /**
   * Helper to determine if the currently active element deserves to keep its own focus, and capture copy-paste events.
   *
   * By default, focus is automatically allowed if:
   *   - there is no clipboard commands registered,
   *   - the element is an input, textarea, select or iframe,
   *   - the element has a tabindex attribute[*]
   *
   * [*] tabindex automatic focus allowance can be bypassed by setting the 'ignore_tabindex' class on the element.
   *   This is useful when fine-tuning keyboard behavior of specific components, where you might end up
   *   needing to use tabindex but without wanting to interfere with the Clipboard or RegionFocusSwitcher.
   *
   * You can explicitly allow focus by setting different classes:
   *   - using the 'clipboard_allow_focus' class will allow focusing the element having the class,
   *   - using the 'clipboard_group_focus' class will allow focusing any descendant element of the one having the class
   */
  public static allowFocus(elem: Element): boolean {
    if (!elem) {
      return false;
    }
    if (elem.closest('.clipboard_group_focus') || elem.classList.contains('clipboard_allow_focus')) {
      return true;
    }
    if (elem.hasAttribute("tabindex") && elem.classList.contains('ignore_tabindex')) {
      return false;
    }
    return FOCUS_TARGET_TAGS.has(elem.tagName) || elem.hasAttribute("tabindex");
  }

  public readonly copypasteField: HTMLTextAreaElement;

  // In the event of a cut a callback is provided by the viewsection that is the target of the cut.
  // When called it returns the additional removal action needed for a cut.
  private _cutCallback: (() => unknown)|null = null;

  // The plaintext content of the cut callback. Used to verify that we are pasting the results
  // of the cut, rather than new data from outside.
  private _cutData: string|null = null;

  constructor(private _app: App) {
    super();
    this.copypasteField = dom('textarea', dom.cls('copypaste'), dom.cls('mousetrap'),
      dom.on('input', (event, elem) => {
        const value = elem.value;
        elem.value = '';
        event.stopPropagation();
        event.preventDefault();
        commands.allCommands.input.run(value);
      }),
      dom.on('copy', this._onCopy.bind(this)),
      dom.on('cut', this._onCut.bind(this)),
      dom.on('paste', this._onPaste.bind(this)),
    );
    document.body.appendChild(this.copypasteField);
    this.onDispose(() => { dom.domDispose(this.copypasteField); this.copypasteField.remove(); });

    FocusLayer.create(this, {
      defaultFocusElem: this.copypasteField,
      allowFocus: Clipboard.allowFocus,
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
    (window as any).gristClipboardGrabFocus = () => FocusLayer.grabFocus();

    // Some bugs may prevent Clipboard from re-grabbing focus. To limit the impact of such bugs on
    // the user, recover from a bad state in mousedown events. (At the moment of this comment, all
    // such known bugs are fixed.)
    dom.onElem(window, 'mousedown', (ev) => {
      if (!document.activeElement || document.activeElement === document.body) {
        FocusLayer.grabFocus();
      }
    });

    this.autoDispose(commands.createGroup(Clipboard.commands, this, true));
  }

  /**
   * Internal helper fired on `copy` events. If a callback was registered from a component, calls the
   * callback to get selection data and puts it on the clipboard.
   */
  private _onCopy(event: ClipboardEvent, elem: HTMLTextAreaElement) {
    event.preventDefault();
    const pasteObj = commands.allCommands.copy.run();
    this._setCBdata(pasteObj, event.clipboardData!);
  }

  private _doContextMenuCopy() {
    const pasteObj = commands.allCommands.copy.run();
    void this._copyToClipboard(pasteObj, 'copy', false);
  }

  private _doContextMenuCopyWithHeaders() {
    const pasteObj = commands.allCommands.copy.run();
    void this._copyToClipboard(pasteObj, 'copy', true);
  }

  private _onCut(event: ClipboardEvent, elem: HTMLTextAreaElement) {
    event.preventDefault();
    const pasteObj = commands.allCommands.cut.run();
    this._setCBdata(pasteObj, event.clipboardData!);
  }

  private _doContextMenuCut() {
    const pasteObj: PasteObj = commands.allCommands.cut.run();
    void this._copyToClipboard(pasteObj, 'cut');
  }

  private _setCBdata(pasteObj: PasteObj, clipboardData: DataTransfer) {
    if (!pasteObj) { return; }

    const plainText = tableUtil.makePasteText(pasteObj.data, pasteObj.selection, false);
    clipboardData.setData('text/plain', plainText);
    const htmlText = tableUtil.makePasteHtml(pasteObj.data, pasteObj.selection, false);
    clipboardData.setData('text/html', htmlText);

    this._setCutCallback(pasteObj, plainText);
  }

  private async _copyToClipboard(pasteObj: PasteObj, action: 'cut'|'copy', includeColHeaders: boolean = false) {
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
  }

  /**
   * Sets the cut callback from the `pasteObj` if one exists. Otherwise clears the
   * cut callback.
   *
   * The callback is called on paste, and only if the pasted data matches the `cutData`
   * that was cut from within Grist. The callback handles removal of the data that was
   * cut.
   */
  private _setCutCallback(pasteObj: PasteObj, cutData: string) {
    if (pasteObj.cutCallback) {
      this._cutCallback = pasteObj.cutCallback;
      this._cutData = cutData;
    } else {
      this._cutCallback = null;
      this._cutData = null;
    }
  }

  /**
   * Internal helper fired on `paste` events. If a callback was registered from a component, calls the
   * callback with data from the clipboard.
   */
  private _onPaste(event: ClipboardEvent, elem: HTMLTextAreaElement) {
    event.preventDefault();
    const cb = event.clipboardData!;
    const plainText = cb.getData('text/plain');
    const htmlText = cb.getData('text/html');
    const pasteData = getPasteData(plainText, htmlText);
    this._doPaste(pasteData, plainText);
  }

  private async _doContextMenuPaste() {
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
  }

  private _doPaste(pasteData: PasteData, plainText: string) {
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
}

const FOCUS_TARGET_TAGS = new Set([
  'INPUT',
  'TEXTAREA',
  'SELECT',
  'IFRAME',
]);

type PasteData = string[][] | tableUtil.RichPasteObject[][];

/**
 * Returns data formatted as a 2D array of strings, suitable for pasting within Grist.
 *
 * Grist stores both text/html and text/plain when copying data. When pasting back, we first
 * check if text/html exists (should exist for Grist and other spreadsheet software), and fall
 * back to text/plain otherwise.
 */
function getPasteData(plainText: string, htmlText: string): PasteData {
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
async function getTextFromClipboardItem(clipboardItem: ClipboardItem, type: string) {
  if (!clipboardItem) { return ''; }

  try {
    return (await clipboardItem.getType(type)).text();
  } catch {
    // No clipboard data exists for the MIME type.
    return '';
  }
}

function showUnavailableMenuCommandModal(action: 'cut'|'copy'|'paste') {
  let keys;
  switch (action) {
    case 'cut': {
      keys = 'Mod+X';
      break;
    }
    case 'copy': {
      keys = 'Mod+C';
      break;
    }
    case 'paste': {
      keys = 'Mod+V';
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
          'The {{action}} menu command is not available in this browser. You can still {{action}} \
by using the keyboard shortcut {{shortcut}}.',
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

const cssModalContent = styled('div', `
  line-height: 18px;
`);
