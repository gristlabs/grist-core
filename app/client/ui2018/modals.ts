import {FocusLayer} from 'app/client/lib/FocusLayer';
import {makeT} from 'app/client/lib/localization';
import {reportError} from 'app/client/models/errors';
import {cssInput} from 'app/client/ui/cssInput';
import {prepareForTransition, TransitionWatcher} from 'app/client/ui/transitions';
import {bigBasicButton, bigPrimaryButton, cssButton} from 'app/client/ui2018/buttons';
import {labeledSquareCheckbox} from 'app/client/ui2018/checkbox';
import {mediaSmall, testId, theme, vars} from 'app/client/ui2018/cssVars';
import {loadingSpinner} from 'app/client/ui2018/loaders';
import {cssMenuElem} from 'app/client/ui2018/menus';
import {waitGrainObs} from 'app/common/gutil';
import {MaybePromise} from 'app/plugin/gutil';
import {Computed, Disposable, dom, DomContents, DomElementArg, input, keyframes,
  MultiHolder, Observable, styled} from 'grainjs';
import {IOpenController, IPopupOptions, PopupControl, popupOpen} from 'popweasel';

const t = makeT('modals');

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

/**
 * The modal variant.
 *
 * Fade-in modals open with a fade-in background animation, and close immediately.
 *
 * Collapsing modals open with a expanding animation from a referenced DOM element, and
 * close with a collapsing animation into the referenced element.
 */
export type IModalVariant = 'fade-in' | 'collapsing';

export interface IModalOptions {
  // The modal variant. Defaults to "fade-in".
  variant?: IModalVariant;
  // Required for "collapsing" variant modals. This is the anchor element for animations.
  refElement?: HTMLElement;
  // If set, escape key does not close the dialog.
  noEscapeKey?: boolean;
  // If set, clicking into background does not close dialog.
  noClickAway?: boolean;
  // DOM arguments to pass to the modal backer.
  backerDomArgs?: DomElementArg[];
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
  const {
    noEscapeKey,
    noClickAway,
    refElement = document.body,
    variant = 'fade-in',
    backerDomArgs = [],
  } = options;

  function doClose() {
    if (!modalDom.isConnected) { return; }

    variant === 'collapsing' ? collapseAndCloseModal() : closeModal();
  }

  function closeModal() {
    document.body.removeChild(modalDom);
    // Ensure we run the disposers for the DOM contained in the modal.
    dom.domDispose(modalDom);
  }

  function collapseAndCloseModal() {
    const watcher = new TransitionWatcher(dialogDom);
    watcher.onDispose(() => closeModal());
    modalDom.classList.add(cssModalBacker.className + '-collapsing');
    collapseModal();
  }

  function expandModal() {
    prepareForTransition(dialogDom, () => collapseModal());
    Object.assign(dialogDom.style, {
      transform: '',
      opacity: '',
      visibility: 'visible',
    });
  }

  function collapseModal() {
    const rect = dialogDom.getBoundingClientRect();
    const collapsedRect = refElement.getBoundingClientRect();
    const originX = (collapsedRect.left + collapsedRect.width / 2) - rect.left;
    const originY = (collapsedRect.top + collapsedRect.height / 2) - rect.top;
    Object.assign(dialogDom.style, {
      transform: `scale(${collapsedRect.width / rect.width}, ${collapsedRect.height / rect.height})`,
      transformOrigin: `${originX}px ${originY}px`,
      opacity: '0',
    });
  }

  let close = doClose;
  let dialogDom: HTMLElement;

  const modalDom = cssModalBacker(
    dom.create((owner) => {
      const focus = () => dialogDom.focus();
      const ctl = ModalControl.create(owner, doClose, focus);
      close = () => ctl.close();

      dialogDom = cssModalDialog(
        createFn(ctl, owner),
        cssModalDialog.cls('-collapsing', variant === 'collapsing'),
        dom.on('click', (ev) => ev.stopPropagation()),
        noEscapeKey ? null : dom.onKeyDown({ Escape: close }),
        testId('modal-dialog'),
      );
      FocusLayer.create(owner, {
        defaultFocusElem: dialogDom,
        allowFocus: (elem) => (elem !== document.body),
        // Pause mousetrap keyboard shortcuts while the modal is shown. Without this, arrow keys
        // will navigate in a grid underneath the modal, and Enter may open a cell there.
        pauseMousetrap: true
      });
      return dialogDom;
    }),
    noClickAway ? null : dom.on('click', () => close()),
    ...backerDomArgs,
  );

  document.body.appendChild(modalDom);
  if (variant === 'collapsing') { expandModal(); }
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
export function saveModal(
  createFunc: (ctl: IModalControl, owner: MultiHolder) => ISaveModalOptions,
  modalOptions?: IModalOptions
) {
  return modal((ctl, owner) => {
    const options = createFunc(ctl, owner);

    const isSaveDisabled = Computed.create(owner, (use) =>
      use(ctl.workInProgress) || (options.saveDisabled ? use(options.saveDisabled) : false));

    const save = ctl.doWork(options.saveFunc, {close: true, catchErrors: true});

    return [
      cssModalTitle(options.title, testId('modal-title')),
      cssModalBody(options.body),
      cssModalButtons(
        bigPrimaryButton(options.saveLabel || t("Save"),
          dom.boolAttr('disabled', isSaveDisabled),
          dom.on('click', save),
          testId('modal-confirm'),
        ),
        options.extraButtons,
        options.hideCancel ? null : bigBasicButton(t("Cancel"),
          dom.on('click', () => ctl.close()),
          testId('modal-cancel'),
        ),
      ),
      dom.onKeyDown({ Enter: () => isSaveDisabled.get() || save() }),
      options.width && cssModalWidth(options.width),
      options.modalArgs,
    ];
  }, modalOptions);
}

export interface ConfirmModalOptions {
  explanation?: DomElementArg,
  hideCancel?: boolean;
  /** Defaults to true. */
  hideDontShowAgain?: boolean;
  extraButtons?: DomContents;
  modalOptions?: IModalOptions;
  saveDisabled?: Observable<boolean>;
  width?: ModalWidth;
}

/**
 * Builds a simple confirm modal with 'Enter' bound to the confirm action.
 *
 * See saveModal() for error handling notes that here apply to the onConfirm callback.
 */
export function confirmModal(
  title: DomElementArg,
  btnText: DomElementArg,
  onConfirm: (dontShowAgain?: boolean) => MaybePromise<void>,
  options: ConfirmModalOptions = {},
): void {
  const {
    explanation,
    hideCancel,
    hideDontShowAgain = true,
    extraButtons,
    modalOptions,
    saveDisabled,
    width
  } = options;
  return saveModal((_ctl, owner): ISaveModalOptions => {
    const dontShowAgain = Observable.create(owner, false);
    return {
      title,
      body: [
        explanation || null,
        hideDontShowAgain ? null : dom('div',
          cssDontShowAgainCheckbox(
            dontShowAgain,
            cssDontShowAgainCheckboxLabel(t("Don't show again")),
            testId('modal-dont-show-again'),
          ),
        ),
      ],
      saveLabel: btnText,
      saveFunc: async () => onConfirm(hideDontShowAgain ? undefined : dontShowAgain.get()),
      hideCancel,
      width: width ?? 'normal',
      extraButtons,
      saveDisabled,
    };
  }, modalOptions);
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
  promptModal(title, onResolve!, btnText ?? t("Ok"), initial, placeholder, () => {
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

/**
 * Shows a little modal as a tooltip.
 *
 * Example:
 * dom.on('click', (_, element) => modalTooltip(element, (ctl) => {
 *  return dom('div', 'Hello world', dom.on('click', () => ctl.close()));
 * }))
 */
export function modalTooltip(
  reference: Element,
  domCreator: (ctl: IOpenController) => DomElementArg,
  options: IPopupOptions = {}
): PopupControl {
  return popupOpen(reference, (ctl: IOpenController) => {
    const element = cssModalTooltip(
      domCreator(ctl)
    );
    return element;
  }, options);
}

/* CSS styled components */

export const cssModalTooltip = styled(cssMenuElem, `
  padding: 16px 24px;
  background: ${theme.modalBg};
  border-radius: 3px;
  outline: none;
  & > div {
    outline: none;
  }
`);

export const cssModalTopPadding = styled('div', `
  padding-top: var(--css-modal-dialog-padding-vertical);
`);

export const cssModalBottomPadding = styled('div', `
  padding-bottom: var(--css-modal-dialog-padding-vertical);
`);

export const cssModalHorizontalPadding = styled('div', `
  padding-left: var(--css-modal-dialog-padding-horizontal);
  padding-right: var(--css-modal-dialog-padding-horizontal);
`);

// For centering, we use 'margin: auto' on the flex item instead of 'justify-content: center' on
// the flex container, to ensure the full item can be scrolled in case of overflow.
// See https://stackoverflow.com/a/33455342/328565
//
// If you want to control the padding yourself, use the cssModalTopPadding and other classes above and add -full-body
// variant to the modal.
export const cssModalDialog = styled('div', `
  --css-modal-dialog-padding-horizontal: 64px;
  --css-modal-dialog-padding-vertical: 40px;
  background-color: ${theme.modalBg};
  min-width: 428px;
  color: ${theme.darkText};
  margin: auto;
  border-radius: 3px;
  box-shadow: 0 2px 18px 0 ${theme.modalInnerShadow}, 0 0 1px 0 ${theme.modalOuterShadow};
  padding: var(--css-modal-dialog-padding-vertical) var(--css-modal-dialog-padding-horizontal);
  outline: none;

  &-normal {
    max-width: 480px;
  }
  &-fixed-wide {
    width: 600px;
  }
  &-collapsing {
    transition-property: opacity, transform;
    transition-duration: 0.4s;
    transition-timing-function: ease-in-out;
  }
  @media ${mediaSmall} {
    & {
      width: unset;
      min-width: unset;
      --css-modal-dialog-padding-horizontal: 16px;
      --css-modal-dialog-padding-vertical: 24px;
    }
  }
  &-full-body {
    padding: 0;
  }
`);

export const cssModalTitle = styled('div', `
  font-size: ${vars.xxxlargeFontSize};
  font-weight: ${vars.headerControlTextWeight};
  color: ${theme.text};
  margin: 0 0 16px 0;
  line-height: 32px;
  overflow-wrap: break-word;
`);

export const cssModalBody = styled('div', `
  color: ${theme.text};
  margin: 16px 0;
`);

export const cssModalButtons = styled('div', `
  margin: 40px 0 0 0;

  & > button,
  & > .${cssButton.className} {
    margin: 0 8px 0 0;
  }
`);

export const cssModalCloseButton = styled('div', `
  align-self: flex-end;
  margin: -8px;
  padding: 4px;
  border-radius: 4px;
  cursor: pointer;
  --icon-color: ${theme.modalCloseButtonFg};

  &:hover {
    background-color: ${theme.hover};
  }
`);

const cssFadeIn = keyframes(`
  from {background-color: transparent}
`);

const cssFadeOut = keyframes(`
  from {background-color: ${theme.modalBackdrop}}
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
  z-index: ${vars.modalZIndex};
  background-color: ${theme.modalBackdrop};
  overflow-y: auto;
  animation-name: ${cssFadeIn};
  animation-duration: 0.4s;

  &-collapsing {
    animation-name: ${cssFadeOut};
    background-color: transparent;
  }
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

const cssFadeInFromTop = keyframes(`
  from {top: -250px; opacity: 0}
  to {top: 0; opacity: 1}
`);

export const cssAnimatedModal = styled('div', `
  animation-name: ${cssFadeInFromTop};
  animation-duration: 0.4s;
  position: relative;
`);

const cssDontShowAgainCheckbox = styled(labeledSquareCheckbox, `
  line-height: normal;
`);

const cssDontShowAgainCheckboxLabel = styled('span', `
  color: ${theme.lightText};
`);
