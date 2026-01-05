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

import { getHumanKey, isMac } from "app/client/components/commands";
import * as commands from "app/client/components/commands";
import { copyToClipboard, readDataFromClipboard } from "app/client/lib/clipboardUtils";
import { FocusLayer } from "app/client/lib/FocusLayer";
import { makeT } from "app/client/lib/localization";
import { makePasteHtml, makePasteText, parsePasteHtml, PasteData } from "app/client/lib/tableUtil";
import { ShortcutKey, ShortcutKeyContent } from "app/client/ui/ShortcutKey";
import { confirmModal } from "app/client/ui2018/modals";
import { isNonNullish } from "app/common/gutil";
import { tsvDecode } from "app/common/tsvFormat";

import { Disposable, dom, styled } from "grainjs";

import type { CopySelection } from "app/client/components/CopySelection";
import type { App } from "app/client/ui/App";
import type { DocAction } from "app/common/DocActions";
import type { TableData } from "app/common/TableData";

const t = makeT("Clipboard");

/**
 * Paste object that should be returned by implementation of `copy`.
 */
export interface PasteObj {
  docName: string;
  tableId: string;
  data: TableData;
  selection: CopySelection;
  cutCallback?: CutCallback;
}

export type CutCallback = () => DocAction | null;

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
    if (elem.closest(".clipboard_group_focus") || elem.classList.contains("clipboard_allow_focus")) {
      return true;
    }
    if (elem.hasAttribute("tabindex") && elem.classList.contains("ignore_tabindex")) {
      return false;
    }
    return FOCUS_TARGET_TAGS.has(elem.tagName) || elem.hasAttribute("tabindex");
  }

  public readonly copypasteField: HTMLTextAreaElement;

  // In the event of a cut a callback is provided by the viewsection that is the target of the cut.
  // When called it returns the additional removal action needed for a cut.
  private _cutCallback: (() => unknown) | null = null;

  // The plaintext content of the cut callback. Used to verify that we are pasting the results
  // of the cut, rather than new data from outside.
  private _cutData: string | null = null;

  constructor(private _app: App) {
    super();
    this.copypasteField = dom("textarea", dom.cls("copypaste"), dom.cls("mousetrap"),
      dom.on("input", (event, elem) => {
        const value = elem.value;
        elem.value = "";
        event.stopPropagation();
        event.preventDefault();
        commands.allCommands.input.run(value);
      }),
      dom.on("copy", this._onCopy.bind(this)),
      dom.on("cut", this._onCut.bind(this)),
      dom.on("paste", this._onPaste.bind(this)),
    );
    document.body.appendChild(this.copypasteField);
    this.onDispose(() => { dom.domDispose(this.copypasteField); this.copypasteField.remove(); });

    FocusLayer.create(this, {
      defaultFocusElem: this.copypasteField,
      allowFocus: Clipboard.allowFocus,
      onDefaultFocus: () => {
        this.copypasteField.value = " ";
        this.copypasteField.select();
        this._app.trigger("clipboard_focus");
      },
      onDefaultBlur: () => {
        this._app.trigger("clipboard_blur");
      },
    });

    // Expose the grabber as a global to allow upload from tests to explicitly restore focus
    (window as any).gristClipboardGrabFocus = () => FocusLayer.grabFocus();

    // Some bugs may prevent Clipboard from re-grabbing focus. To limit the impact of such bugs on
    // the user, recover from a bad state in mousedown events. (At the moment of this comment, all
    // such known bugs are fixed.)
    dom.onElem(window, "mousedown", (ev) => {
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
    void this._copyToClipboard(pasteObj, "copy", false);
  }

  private _doContextMenuCopyWithHeaders() {
    const pasteObj = commands.allCommands.copy.run();
    void this._copyToClipboard(pasteObj, "copy", true);
  }

  private _onCut(event: ClipboardEvent, elem: HTMLTextAreaElement) {
    event.preventDefault();
    const pasteObj = commands.allCommands.cut.run();
    this._setCBdata(pasteObj, event.clipboardData!);
  }

  private _doContextMenuCut() {
    const pasteObj: PasteObj = commands.allCommands.cut.run();
    void this._copyToClipboard(pasteObj, "cut");
  }

  private _setCBdata(pasteObj: PasteObj, clipboardData: DataTransfer) {
    if (!pasteObj) { return; }

    const plainText = makePasteText(pasteObj.data, pasteObj.selection, false);
    clipboardData.setData("text/plain", plainText);
    const htmlText = makePasteHtml(pasteObj.data, pasteObj.selection, false);
    clipboardData.setData("text/html", htmlText);

    this._setCutCallback(pasteObj, plainText);
  }

  private async _copyToClipboard(pasteObj: PasteObj, action: "cut" | "copy", includeColHeaders: boolean = false) {
    if (!pasteObj) { return; }

    const plainText = makePasteText(pasteObj.data, pasteObj.selection, includeColHeaders);
    let data;
    if (typeof ClipboardItem === "function") {
      const htmlText = makePasteHtml(pasteObj.data, pasteObj.selection, includeColHeaders);
      data = new ClipboardItem({
        "text/plain": new Blob([plainText], { type: "text/plain" }),
        "text/html": new Blob([htmlText], { type: "text/html" }),
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
    const plainText = cb.getData("text/plain");
    const htmlText = cb.getData("text/html");
    // We process and filter cb.items because the promising-sounding cb.files may not be set for
    // paste events, even when items include files.
    // Note that on Firefox, this is limited to a single file due to an old Firefox bug:
    // https://bugzilla.mozilla.org/show_bug.cgi?id=864052
    const files = Array.from(cb.items, it => it.getAsFile()).filter(isNonNullish);
    const pasteData = getPasteData(plainText, htmlText, files);
    this._doPaste(pasteData, plainText);
  }

  private async _doContextMenuPaste() {
    let clipboardItems: ClipboardItem[];
    try {
      clipboardItems = await readDataFromClipboard();
    } catch {
      showUnavailableMenuCommandModal("paste");
      return;
    }
    const plainText = await getTextFromClipboardItem(clipboardItems[0], "text/plain");
    const htmlText = await getTextFromClipboardItem(clipboardItems[0], "text/html");
    const files = await getFilesFromClipboardItems(clipboardItems);
    const pasteData = getPasteData(plainText, htmlText, files);
    this._doPaste(pasteData, plainText);
  }

  private _doPaste(pasteData: PasteData, plainText: string) {
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
  "INPUT",
  "TEXTAREA",
  "SELECT",
  "IFRAME",
]);

/**
 * Returns data formatted as a 2D array of strings, suitable for pasting within Grist.
 *
 * Grist stores both text/html and text/plain when copying data. When pasting back, we first
 * check if text/html exists (should exist for Grist and other spreadsheet software), and fall
 * back to text/plain otherwise.
 */
function getPasteData(plainText: string, htmlText: string, fileItems: File[]): PasteData {
  try {
    return parsePasteHtml(htmlText);
  } catch (e) {
    const text = plainText.replace(/^\uFEFF/, "");
    if (text) {
      return tsvDecode(plainText.replace(/\r\n?/g, "\n").trimEnd());
    }
    if (fileItems.length > 0) {
      return [[fileItems]];
    }
    return [[""]];
  }
}

/**
 * Returns clipboard data of the given `type` from `clipboardItem` as text.
 *
 * Returns an empty string if `clipboardItem` is nullish or no data exists
 * for the given `type`.
 */
async function getTextFromClipboardItem(clipboardItem: ClipboardItem | undefined, type: string) {
  if (!clipboardItem) { return ""; }

  try {
    return (await clipboardItem.getType(type)).text();
  } catch {
    // No clipboard data exists for the MIME type.
    return "";
  }
}

/**
 * Returns a list of Blobs included among clipboardItems.
 */
async function getFilesFromClipboardItems(clipboardItems: ClipboardItem[]): Promise<File[]> {
  const blobs = await Promise.all(
    clipboardItems.map((item) => {
      // Find a non-text mime type, which should indicate a file.
      // Note that browsers may not support arbitrary files, but should support images on clipboard.
      const mimeType = item.types.find(mtime => !mtime.startsWith("text/"));
      return mimeType ? item.getType(mimeType) : null;
    })
      .filter(isNonNullish),
  );
  return blobs.map(blob => new File([blob], "from-clipboard", { type: blob.type }));
}

function showUnavailableMenuCommandModal(action: "cut" | "copy" | "paste") {
  let keys;
  switch (action) {
    case "cut": {
      keys = "Mod+X";
      break;
    }
    case "copy": {
      keys = "Mod+C";
      break;
    }
    case "paste": {
      keys = "Mod+V";
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
          "The {{action}} menu command is not available in this browser. You can still {{action}} \
by using the keyboard shortcut {{shortcut}}.",
          {
            action,
            shortcut: ShortcutKey(ShortcutKeyContent(getHumanKey(keys, isMac))),
          },
        ),
      ),
      hideCancel: true,
    },
  );
}

const cssModalContent = styled("div", `
  line-height: 18px;
`);
