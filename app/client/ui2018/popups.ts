import {cssButton} from 'app/client/ui2018/buttons';
import {mediaSmall, testId, theme, vars} from 'app/client/ui2018/cssVars';
import {Disposable, dom, DomElementArg, styled} from 'grainjs';

interface IPopupController extends Disposable {
  /** Close the popup. */
  close(): void;
}

/**
 * A controller for an open popup.
 *
 * Callers are responsible for providing a suitable close callback (`_doClose`).
 * Typically, this callback should remove the popup from the DOM and run any of
 * its disposers.
 *
 * Used by popup DOM creator functions to close popups on certain interactions,
 * like clicking a dismiss button from the body of the popup.
 */
class PopupController extends Disposable implements IPopupController {
  constructor(
    private _doClose: () => void,
  ) {
    super();
  }

  public close(): void {
    this._doClose();
  }
}

/**
 * A simple card popup that's shown in the bottom-right corner of the screen.
 *
 * Disposed whenever the `trigger` element is disposed.
 */
export function cardPopup(
  triggerElement: Element,
  createFn: (ctl: PopupController) => DomElementArg,
): void {
  // Closes this popup, removing it from the DOM.
  const closePopup = () => {
    document.body.removeChild(popupDom);
    // Ensure we run the disposers for the DOM contained in the popup.
    dom.domDispose(popupDom);
  };

  const popupDom = cssPopupCard(
    dom.create((owner) => {
      // Create a controller for this popup. We'll pass it into `createFn` so that
      // the body of the popup can close this popup, if needed.
      const ctl = PopupController.create(owner, closePopup);
      return dom('div',
        createFn(ctl),
        testId('popup-card-content'),
      );
    }),
    testId('popup-card'),
  );

  // Show the popup by appending it to the DOM.
  document.body.appendChild(popupDom);

  // If the trigger element is disposed, close this popup.
  dom.onDisposeElem(triggerElement, closePopup);
}

const cssPopupCard = styled('div', `
  position: absolute;
  right: 16px;
  bottom: 16px;
  margin-left: 16px;
  max-width: 428px;
  padding: 32px;
  background-color: ${theme.popupBg};
  box-shadow: 0 2px 18px 0 ${theme.popupInnerShadow}, 0 0 1px 0 ${theme.popupOuterShadow};
  outline: none;

  @media ${mediaSmall} {
    & {
      padding: 24px;
    }
  }
`);

export const cssPopupTitle = styled('div', `
  font-size: ${vars.xxxlargeFontSize};
  font-weight: ${vars.headerControlTextWeight};
  color: ${theme.text};
  margin: 0 0 16px 0;
  line-height: 32px;
  overflow-wrap: break-word;
`);

export const cssPopupBody = styled('div', `
  color: ${theme.text};
`);

export const cssPopupButtons = styled('div', `
  margin: 24px 0 0 0;

  & > button,
  & > .${cssButton.className} {
    margin: 0 8px 0 0;
  }
`);

export const cssPopupCloseButton = styled('div', `
  align-self: flex-end;
  border-radius: 4px;
  cursor: pointer;
  padding: 4px;
  --icon-color: ${theme.popupCloseButtonFg};

  &:hover {
    background-color: ${theme.hover};
  }
`);
