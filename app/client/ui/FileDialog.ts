/**
 * Utility to simplify file uploads via the browser-provided file picker. It takes care of
 * maintaining an invisible <input type=file>, to make usage very simple:
 *
 *    FileDialog.open({ multiple: true }, files => { do stuff with files });
 *
 * Promise interface allows this:
 *
 *    const fileList = await FileDialog.openFilePicker({multiple: true});
 *
 * (Note that in either case, it's possible for the callback to never be called, or for the
 * Promise to never resolve; see comments for openFilePicker.)
 *
 * Note that interacting with a file dialog is difficult with WebDriver, but
 * test/browser/gristUtils.js provides a `gu.fileDialogUpload()` to make it easy.
 */

import * as browserGlobals from 'app/client/lib/browserGlobals';
import dom from 'app/client/lib/dom';
const G = browserGlobals.get('document', 'window');

export interface FileDialogOptions {
  multiple?: boolean;   // Whether multiple files may be selected.
  accept?: string;      // Comma-separated list of content-type specifiers,
                        // e.g. ".jpg,.png", "text/plain", "audio/*", "video/*", "image/*".
}

type FilesCB = (files: File[]) => void;

function noop() { /* no-op */ }

let _fileForm: HTMLFormElement;
let _fileInput: HTMLInputElement;
let _currentCB: FilesCB = noop;

/**
 * Opens the file picker dialog, and returns a Promise for the list of selected files.
 * WARNING: The Promise might NEVER resolve. If the user dismisses the dialog without picking a
 *          file, there is no good way to detect that in order to resolve the promise.
 *          Do NOT rely on the promise resolving, e.g. on .finally() getting called.
 *          The implementation MAY resolve with an empty list in this case, when possible.
 *
 * This does not cause indefinite memory leaks. If the dialog is opened again, the reference to
 * the previous callback is cleared, and GC can collect the forgotten promise and related memory.
 *
 * Ideally we'd know when the dialog is dismissed without a selection, but that seems impossible
 * today. See https://stackoverflow.com/questions/4628544/how-to-detect-when-cancel-is-clicked-on-file-input
 * (tricks using click, focus, blur, etc are unreliable even in one browser, much less cross-platform).
 */
export function openFilePicker(options: FileDialogOptions): Promise<File[]> {
  return new Promise(resolve => open(options, resolve));
}

/**
 * Opens the file picker dialog. If files are selected, calls the provided callback.
 * If no files are selected, will call the callback with an empty list if possible, or more
 * typically not call it at all.
 */
export function open(options: FileDialogOptions, callback: FilesCB): void {
  if (!_fileInput) {
    // The IDs are only needed for the sake of browser tests.
    _fileForm = dom('form#file_dialog_form', {style: 'position: absolute; top: 0; display: none'},
      _fileInput = dom('input#file_dialog_input', {type: 'file'}));

    G.document.body.appendChild(_fileForm);

    _fileInput.addEventListener('change', (ev) => {
      _currentCB(_fileInput.files ? Array.from(_fileInput.files) : []);
      _currentCB = noop;
    });
  }

  // Clear the input, to make sure that selecting the same file as previously still
  // triggers a 'change' event.
  _fileForm.reset();
  _fileInput.multiple = Boolean(options.multiple);
  _fileInput.accept = options.accept || '';
  _currentCB = callback;

  // .click() is a well-supported shorthand for dispatching a mouseclick event on input elements.
  // We do it in a separate tick to work around a rare Firefox bug.
  setTimeout(() => _fileInput.click(), 0);
}
