import {FocusLayer} from 'app/client/lib/FocusLayer';
import * as Mousetrap from 'app/client/lib/Mousetrap';
import {reportError} from 'app/client/models/errors';
import {bigBasicButton, bigPrimaryButton, cssButton} from 'app/client/ui2018/buttons';
import {colors, testId, vars} from 'app/client/ui2018/cssVars';
import {loadingSpinner} from 'app/client/ui2018/loaders';
import {Computed, dom, DomElementArg, MultiHolder, Observable, styled} from 'grainjs';

export interface IModalControl {
  close(): void;
  focus(): void;
}

export interface IModalOptions {
  noEscapeKey?: boolean;      // If set, escape key does not close the dialog
  noClickAway?: boolean;      // If set, clicking into background does not close dialog.
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
export function modal(createFn: (ctl: IModalControl, owner: MultiHolder) => DomElementArg,
                      options: IModalOptions = {}): void {
  function close() {
    document.body.removeChild(modalDom);
    // Ensure we run the disposers for the DOM contained in the modal.
    dom.domDispose(modalDom);
  }

  const modalDom = cssModalBacker(
    dom.create((owner) => {
      // Pause mousetrap keyboard shortcuts while the modal is shown. Without this, arrow keys
      // will navigate in a grid underneath the modal, and Enter may open a cell there.
      Mousetrap.setPaused(true);
      owner.onDispose(() => Mousetrap.setPaused(false));

      const focus = () => dialog.focus();
      const dialog = cssModalDialog(
        createFn({ close, focus }, owner),
        dom.on('click', (ev) => ev.stopPropagation()),
        options.noEscapeKey ? null : dom.onKeyDown({ Escape: close }),
        testId('modal-dialog')
      );
      FocusLayer.create(owner, {
        defaultFocusElem: dialog,
        allowFocus: (elem) => (elem !== document.body),
      });
      return dialog;
    }),
    options.noClickAway ? null : dom.on('click', close),
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

    const isSaving = Observable.create(owner, false);
    const isSaveDisabled = Computed.create(owner, (use) =>
      use(isSaving) || (options.saveDisabled ? use(options.saveDisabled) : false));

    // We mark isSaving() observable to disable the save button while saveFunc() is pending.
    // (I decided against a waitWithObsSet() helper for this, since it's too specific to this case
    // when saveFunc() is prevented from being called multiple times in parallel.)
    async function save() {
      isSaving.set(true);
      try {
        await options.saveFunc();
        ctl.close();      // Close on success.
      } catch (err) {
        // Report errors. If saveFunc() reports its own error and wants the dialog to stay open,
        // it should throw StayOpen().
        if (!(err instanceof StayOpen)) {
          reportError(err);
        }
        isSaving.set(false);
      }
    }

    return [
      cssModalTitle(options.title, testId('modal-title')),
      cssModalBody(options.body),
      cssModalButtons(
        bigPrimaryButton(options.saveLabel || 'Save',
          dom.boolAttr('disabled', isSaveDisabled),
          dom.on('click', save),
          testId('modal-confirm'),
        ),
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
  {hideCancel}: {hideCancel?: boolean} = {},
): void {
  return saveModal((ctl, owner): ISaveModalOptions => ({
    title,
    body: explanation || null,
    saveLabel: btnText,
    saveFunc: onConfirm,
    hideCancel,
    width: 'normal',
  }));
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
      cssModalTitle(title),
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
`);

export const cssModalTitle = styled('div', `
  font-size: ${vars.xxxlargeFontSize};
  font-weight: ${vars.headerControlTextWeight};
  color: ${colors.dark};
  margin: 0 0 16px 0;
  line-height: 32px;
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

// For centering, we use 'margin: auto' on the flex item instead of 'justify-content: center' on
// the flex container, to ensure the full item can be scrolled in case of overflow.
// See https://stackoverflow.com/a/33455342/328565
const cssModalBacker = styled('div', `
  position: fixed;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  top: 0;
  left: 0;
  z-index: 999;
  background-color: ${colors.backdrop};
  overflow-y: auto;
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
