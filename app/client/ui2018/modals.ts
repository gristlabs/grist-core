import {FocusLayer} from 'app/client/lib/FocusLayer';
import {reportError} from 'app/client/models/errors';
import {cssInput} from 'app/client/ui/MakeCopyMenu';
import {bigBasicButton, bigPrimaryButton, cssButton} from 'app/client/ui2018/buttons';
import {colors, mediaSmall, testId, vars} from 'app/client/ui2018/cssVars';
import {loadingSpinner} from 'app/client/ui2018/loaders';
import {waitGrainObs} from 'app/common/gutil';
import {Computed, Disposable, dom, DomContents, DomElementArg, input, keyframes,
  MultiHolder, Observable, styled} from 'grainjs';

// IModalControl is passed into the function creating the body of the modal.
export interface IModalControl {
  // Observable for whether there is work in progress that's delaying the closing of the modal. It
  // is useful for disabling a Save or Close button.
  workInProgress: Computed<boolean>;

  // Focus the modal dialog.
  focus(): void;

  // Request to close, without waiting. It's possible for closing to get prevented.
  close(): void;

  // Returns true if closed, false if closing was prevented.
  closeAndWait(): Promise<boolean>;

  // Prevents closing, if close has been called and is pending. No-op otherwise.
  preventClose(): void;

  // Wraps the passed-in function, so that closing is delayed while the function is running. If
  // {close: true} is passed in, then requests closing of the modal when the function is done.
  //
  // With catchErrors set, errors are caught and reported, and prevent the dialog from closing.
  // Otherwise, only StayOpen exception prevents closing; other errors will be propagated.
  doWork<Args extends any[]>(
    func: (...args: Args) => Promise<unknown>,
    options?: {close?: boolean, catchErrors?: boolean},
  ): (...args: Args) => Promise<void>;
}

export class ModalControl extends Disposable implements IModalControl {
  private _inProgress = Observable.create<number>(this, 0);
  private _workInProgress = Computed.create(this, this._inProgress, (use, n) => (n > 0));
  private _closePromise: Promise<boolean>|undefined;
  private _shouldClose = false;

  constructor(
    private _doClose: () => void,
    private _doFocus?: () => void,
  ) {
    super();
  }

  public focus() {
    this._doFocus?.();
  }

  public close(): void {
    this.closeAndWait().catch(() => {});
  }

  public async closeAndWait(): Promise<boolean> {
    return this._closePromise || (this._closePromise = this._doCloseAndWait());
  }

  public preventClose(): void {
    this._shouldClose = false;
  }

  public get workInProgress() {
    return this._workInProgress;
  }

  public doWork<Args extends any[]>(
    func: (...args: Args) => Promise<unknown>,
    options: {close?: boolean, catchErrors?: boolean} = {},
  ): (...args: Args) => Promise<void> {
    return async (...args) => {
      this._inProgress.set(this._inProgress.get() + 1);
      const closePromise = options.close ? this.closeAndWait() : null;
      try {
        await func(...args);
      } catch (err) {
        if (err instanceof StayOpen) {
          this.preventClose();
        } else if (options.catchErrors) {
          reportError(err);
          this.preventClose();
        } else {
          throw err;
        }
      } finally {
        this._inProgress.set(this._inProgress.get() - 1);
        if (closePromise) {
          await closePromise;
        }
      }
    };
  }

  private async _doCloseAndWait(): Promise<boolean> {
    this._shouldClose = true;
    try {
      // Since some modals expect an immediate close; avoid an await when no work is pending.
      if (this.workInProgress.get()) {
        await waitGrainObs(this.workInProgress, wip => !wip);
      }
      if (this._shouldClose) { this._doClose(); }
      return this._shouldClose;
    } finally {
      this._closePromise = undefined;
    }
  }
}

export interface IModalOptions {
  noEscapeKey?: boolean;      // If set, escape key does not close the dialog
  noClickAway?: boolean;      // If set, clicking into background does not close dialog.

  // If given, call and wait for this before closing the dialog. If it returns false, don't close.
  // Error also prevents closing, and is reported as an unexpected error.
  beforeClose?: () => Promise<boolean>;
}

// A custom error type to signal to the modal that it should stay open, but not report any error
// (presumably because the error was already reported).
export class StayOpen extends Error {
}

export type ModalWidth =
  'normal' |          // Normal dialog, from 428px to 480px in width.
  'fixed-wide';       // Fixed 600px width.

/**
 * A simple modal. Shows up in the middle of the screen with a tinted backdrop.
 * Created with the given body content and width.
 *
 * Closed via clicking anywhere outside the modal. May also be closed by
 * calling ctl.close().
 *
 * The createFn callback may tie the disposal of temporary objects to its `owner` argument.
 *
 * Example usage:
 *  modal((ctl, owner) => [
 *    cssModalTitle(`Pin doc`),
 *    cssModalBody('Are you sure you want to pin doc?')
 *    cssModalButtons(
 *      primary('Yes', dom.on('click', () => { onClick(true); ctl.close(); })),
 *      secondary('Cancel', dom.on('click', () => { onClick(false); ctl.close(); }))
 *    )
 *  ])
 */
export function modal(
  createFn: (ctl: IModalControl, owner: MultiHolder) => DomElementArg,
  options: IModalOptions = {}
): void {

  function doClose() {
    if (!modalDom.isConnected) { return; }
    document.body.removeChild(modalDom);
    // Ensure we run the disposers for the DOM contained in the modal.
    dom.domDispose(modalDom);
  }
  let close = doClose;

  const modalDom = cssModalBacker(
    dom.create((owner) => {
      const focus = () => dialog.focus();
      const ctl = ModalControl.create(owner, doClose, focus);
      close = () => ctl.close();

      const dialog = cssModalDialog(
        createFn(ctl, owner),
        dom.on('click', (ev) => ev.stopPropagation()),
        options.noEscapeKey ? null : dom.onKeyDown({ Escape: close }),
        testId('modal-dialog')
      );
      FocusLayer.create(owner, {
        defaultFocusElem: dialog,
        allowFocus: (elem) => (elem !== document.body),
        // Pause mousetrap keyboard shortcuts while the modal is shown. Without this, arrow keys
        // will navigate in a grid underneath the modal, and Enter may open a cell there.
        pauseMousetrap: true
      });
      return dialog;
    }),
    options.noClickAway ? null : dom.on('click', () => close()),
  );


  document.body.appendChild(modalDom);
}

export interface ISaveModalOptions {
  title: DomElementArg;           // Normally just a string.
  body: DomElementArg;            // Content of the dialog.
  saveLabel?: DomElementArg;      // Normally just a string; defaults to "Save".
  saveDisabled?: Observable<boolean>;   // Optional observable for when to disable Save button.
  saveFunc: () => Promise<unknown>;     // Called on Save; dialog closes when promise is fulfilled.
  hideCancel?: boolean;           // If set, hide the Cancel button
  width?: ModalWidth;             // Set a width style for the dialog.
  modalArgs?: DomElementArg;      // Extra args to apply to the outer cssModalDialog element.
  extraButtons?: DomContents;     // More buttons!
}

/**
 * Creates a modal dialog with a title, body, and Save/Cancel buttons. The provided createFunc()
 * is called immediately to get the dialog's contents and options (see ISaveModalOptions for
 * details). For example:
 *
 *    saveModal((ctl, owner) => {
 *      const myObs = Computed.create(owner, ...);
 *      return {
 *        title: 'My Dialog',
 *        body: dom('div', 'Hello', dom.text(myObs)),
 *        saveDisabled: Computed.create(owner, (use) => !use(myObs)),
 *        saveFunc: () => server.ping(),
 *        modalArgs: {style: 'background-color: blue'},
 *      };
 *    });
 *
 * On Save, the dialog calls saveFunc(), disables the Save button, and stays open until saveFunc()
 * is resolved. It then closes on success, or reports the error and stays open on rejection. To
 * stay open without reporting an error (if one is already reported), throw StayOpen exception.
 *
 * The dialog interprets Enter/Escape keys as if the Save/Cancel buttons were clicked.
 *
 * Note that it's possible to close the dialog via Cancel while saveFunc() is pending. That's
 * probably desirable, but keep in mind that the dialog may be disposed before saveFunc() returns.
 *
 * Error handling examples:
 *  1.  saveFunc: doSomething
 *      (Most common) If doSomething fails, the error is reported and the dialog stays open.
 *  2.  saveFunc: () => doSomething().catch(reportError)
 *      If doSomething fails, the error is reported but the dialog closes anyway.
 *  3.  saveFunc: () => doSomething().catch((e) => { alert("BOOM"); throw new StayOpen(); })
 *      If doSomething fails, an alert is shown, and the dialog stays open.
 */
export function saveModal(createFunc: (ctl: IModalControl, owner: MultiHolder) => ISaveModalOptions) {
  return modal((ctl, owner) => {
    const options = createFunc(ctl, owner);

    const isSaveDisabled = Computed.create(owner, (use) =>
      use(ctl.workInProgress) || (options.saveDisabled ? use(options.saveDisabled) : false));

    const save = ctl.doWork(options.saveFunc, {close: true, catchErrors: true});

    return [
      cssModalTitle(options.title, testId('modal-title')),
      cssModalBody(options.body),
      cssModalButtons(
        bigPrimaryButton(options.saveLabel || 'Save',
          dom.boolAttr('disabled', isSaveDisabled),
          dom.on('click', save),
          testId('modal-confirm'),
        ),
        options.extraButtons,
        options.hideCancel ? null : bigBasicButton('Cancel',
          dom.on('click', () => ctl.close()),
          testId('modal-cancel'),
        ),
      ),
      dom.onKeyDown({ Enter: () => isSaveDisabled.get() || save() }),
      options.width && cssModalWidth(options.width),
      options.modalArgs,
    ];
  });
}

/**
 * Builds a simple confirm modal with 'Enter' bound to the confirm action.
 *
 * See saveModal() for error handling notes that here apply to the onConfirm callback.
 */
export function confirmModal(
  title: string,
  btnText: string,
  onConfirm: () => Promise<void>,
  explanation?: Element|string,
  {hideCancel, extraButtons}: {hideCancel?: boolean, extraButtons?: DomContents} = {},
): void {
  return saveModal((ctl, owner): ISaveModalOptions => ({
    title,
    body: explanation || null,
    saveLabel: btnText,
    saveFunc: onConfirm,
    hideCancel,
    width: 'normal',
    extraButtons,
  }));
}


/**
 * Creates a simple prompt modal (replacement for the native one).
 * Closed via clicking anywhere outside the modal or Cancel button.
 *
 * Example usage:
 *  promptModal(
 *    "Enter your name",
 *    (name: string) => alert(`Hello ${name}`),
 *    "Ok" // Confirm button name,
 *    "John doe", // Initial text (can be empty or undefined)
 *    "Enter your name", // input placeholder
 *    () => console.log('User cancelled') // Called when user cancels, or clicks outside.
 *  )
 *
 * @param title: Prompt text.
 * @param onConfirm: Handler for Confirm button.
 * @param btnText: Text of the confirm button.
 * @param initial: Initial value in the input element.
 * @param placeholder: Placeholder for the input element.
 * @param onCancel: Optional cancel handler.
 */
export function promptModal(
  title: string,
  onConfirm: (text: string) => Promise<unknown>,
  btnText: string,
  initial?: string,
  placeholder?: string,
  onCancel?: () => void
): void {
  saveModal((ctl, owner): ISaveModalOptions => {
    let confirmed = false;
    const text = Observable.create(owner, initial ?? '');
    const txtInput = input(text, { onInput : true }, { placeholder }, cssInput.cls(''), testId('modal-prompt'));
    const options: ISaveModalOptions = {
      title,
      body: txtInput,
      saveLabel: btnText,
      saveFunc: () => {
        // Mark that confirm was invoked.
        confirmed = true;
        return onConfirm(text.get() || '');
      },
      width: 'normal'
    };
    owner.onDispose(() => {
      if (confirmed) { return; }
      onCancel?.();
    });
    setTimeout(() => txtInput.focus(), 10);
    return options;
  });
}

/**
 * Wraps prompt modal in a promise that is resolved either when user confirms or cancels.
 * When user cancels the returned value is always undefined.
 *
 * Example usage:
 *  async handler() {
 *    const name = await invokePrompt("Please enter your name");
 *    if (name !== undefined) alert(`Hello ${name}`);
 *  }
 *
 * @param title: Prompt text.
 * @param btnText: Text of the confirm button, default is "Ok".
 * @param initial: Initial value in the input element.
 * @param placeholder: Placeholder for the input element.
 */
export function invokePrompt(
  title: string,
  btnText?: string,
  initial?: string,
  placeholder?: string
): Promise<string|undefined> {
  let onResolve: (text: string|undefined) => any;
  const prom = new Promise<string|undefined>((resolve) => {
    onResolve = resolve;
  });
  promptModal(title, onResolve!, btnText ?? 'Ok', initial, placeholder, () => {
    if (onResolve) {
      onResolve(undefined);
    }
  });
  return prom;
}

/**
 * Builds a simple spinner modal. The modal gets removed when `promise` resolves.
 */
export async function spinnerModal<T>(
  title: string,
  promise: Promise<T>): Promise<T> {

  modal((ctl, owner) => {

    // `finally` is missing from es2016, below is a work-around.
    const close = () => ctl.close();
    promise.then(close, close);

    return [
      cssModalSpinner.cls(''),
      cssModalTitle(
        title,
        testId('modal-spinner-title'),
      ),
      cssSpinner(loadingSpinner()),
      testId('modal-spinner'),
    ];
  }, {
    noClickAway: true,
    noEscapeKey: true,
  });
  return await promise;
}

/**
 * Apply this to a modal as
 *    modal(() => [cssModalBody(...), cssModalWidth('normal')])
 * or
 *    saveModal(() => {..., width: 'normal'})
 */
export function cssModalWidth(style: ModalWidth) {
  return cssModalDialog.cls('-' + style);
}

/* CSS styled components */

// For centering, we use 'margin: auto' on the flex item instead of 'justify-content: center' on
// the flex container, to ensure the full item can be scrolled in case of overflow.
// See https://stackoverflow.com/a/33455342/328565
const cssModalDialog = styled('div', `
  background-color: white;
  min-width: 428px;
  color: black;
  margin: auto;
  border-radius: 3px;
  box-shadow: 0 2px 18px 0 rgba(31,37,50,0.31), 0 0 1px 0 rgba(76,86,103,0.24);
  padding: 40px 64px;
  outline: none;

  &-normal {
    max-width: 480px;
  }
  &-fixed-wide {
    width: 600px;
  }
  @media ${mediaSmall} {
    & {
      width: unset;
      min-width: unset;
      padding: 24px 16px;
    }
  }
`);

export const cssModalTitle = styled('div', `
  font-size: ${vars.xxxlargeFontSize};
  font-weight: ${vars.headerControlTextWeight};
  color: ${colors.dark};
  margin: 0 0 16px 0;
  line-height: 32px;
  overflow-wrap: break-word;
`);

export const cssModalBody = styled('div', `
  margin: 16px 0;
`);

export const cssModalButtons = styled('div', `
  margin: 40px 0 0 0;

  & > button,
  & > .${cssButton.className} {
    margin: 0 8px 0 0;
  }
`);

const cssFadeIn = keyframes(`
  from {background-color: transparent}
`);

const cssModalBacker = styled('div', `
  position: fixed;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  top: 0;
  left: 0;
  padding: 16px;
  z-index: 999;
  background-color: ${colors.backdrop};
  overflow-y: auto;
  animation-name: ${cssFadeIn};
  animation-duration: 0.4s;
`);

const cssSpinner = styled('div', `
  display: flex;
  align-items: center;
  height: 80px;
  margin: auto;
`);

const cssModalSpinner = styled('div', `
  display: flex;
  flex-direction: column;
`);
