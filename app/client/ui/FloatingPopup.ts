import {hoverTooltip} from 'app/client/ui/tooltips';
import {isNarrowScreen, isNarrowScreenObs, theme} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {Disposable, dom, DomArg, DomContents, makeTestId, Observable, styled} from 'grainjs';

const POPUP_PADDING_PX = 16;

const testId = makeTestId('test-floating-popup-');

export interface PopupOptions {
  title?: () => DomContents;
  content?: () => DomContents;
  onClose?: () => void;
  closeButton?: boolean;
  autoHeight?: boolean;
}

export class FloatingPopup extends Disposable {
  protected _isMinimized = Observable.create(this, false);
  private _popupElement: HTMLElement | null = null;

  private _clientX: number;
  private _clientY: number;

  constructor(protected _options: PopupOptions = {}, private _args: DomArg[] = []) {
    super();

    this._handleMouseDown = this._handleMouseDown.bind(this);
    this._handleMouseMove = this._handleMouseMove.bind(this);
    this._handleMouseUp = this._handleMouseUp.bind(this);
    this._handleTouchStart = this._handleTouchStart.bind(this);
    this._handleTouchMove = this._handleTouchMove.bind(this);
    this._handleTouchEnd = this._handleTouchEnd.bind(this);
    this._handleWindowResize = this._handleWindowResize.bind(this);

    this.autoDispose(isNarrowScreenObs().addListener(() => this._repositionPopup()));

    this.onDispose(() => {
      this._closePopup();
    });
  }

  public showPopup() {
    this._popupElement = this._buildPopup();
    document.body.appendChild(this._popupElement);
    const topPaddingPx = getTopPopupPaddingPx();
    const initialLeft = document.body.offsetWidth - this._popupElement.offsetWidth - POPUP_PADDING_PX;
    const initialTop = document.body.offsetHeight - this._popupElement.offsetHeight - topPaddingPx;
    this._popupElement.style.left = `${initialLeft}px`;
    this._popupElement.style.top = `${initialTop}px`;
  }

  protected _closePopup() {
    if (!this._popupElement) { return; }
    document.body.removeChild(this._popupElement);
    dom.domDispose(this._popupElement);
    this._popupElement = null;
  }

  protected _buildTitle(): DomContents {
    return this._options.title?.() ?? null;
  }

  protected _buildContent(): DomContents {
    return this._options.content?.() ?? null;
  }

  protected _buildArgs(): any {
    return this._args;
  }

  private _handleMouseDown(ev: MouseEvent) {
    if (ev.button !== 0) { return; } // Only handle left-click.
    this._clientX = ev.clientX;
    this._clientY = ev.clientY;
    document.addEventListener('mousemove', this._handleMouseMove);
    document.addEventListener('mouseup', this._handleMouseUp);
  }

  private _handleTouchStart(ev: TouchEvent) {
    this._clientX = ev.touches[0].clientX;
    this._clientY = ev.touches[0].clientY;
    document.addEventListener('touchmove', this._handleTouchMove);
    document.addEventListener('touchend', this._handleTouchEnd);
  }

  private _handleMouseMove({clientX, clientY}: MouseEvent) {
    this._handleMove(clientX, clientY);
  }

  private _handleTouchMove({touches}: TouchEvent) {
    this._handleMove(touches[0].clientX, touches[0].clientY);
  }

  private _handleMove(clientX: number, clientY: number) {
    const deltaX = clientX - this._clientX;
    const deltaY = clientY - this._clientY;
    let newLeft = this._popupElement!.offsetLeft + deltaX;
    let newTop = this._popupElement!.offsetTop + deltaY;

    const topPaddingPx = getTopPopupPaddingPx();
    if (newLeft - POPUP_PADDING_PX < 0) { newLeft = POPUP_PADDING_PX; }
    if (newTop - topPaddingPx < 0) { newTop = topPaddingPx; }
    if (newLeft + POPUP_PADDING_PX > document.body.offsetWidth - this._popupElement!.offsetWidth) {
      newLeft = document.body.offsetWidth - this._popupElement!.offsetWidth - POPUP_PADDING_PX;
    }
    if (newTop + topPaddingPx > document.body.offsetHeight - this._popupElement!.offsetHeight) {
      newTop = document.body.offsetHeight - this._popupElement!.offsetHeight - topPaddingPx;
    }

    this._popupElement!.style.left = `${newLeft}px`;
    this._popupElement!.style.top = `${newTop}px`;
    this._clientX = clientX;
    this._clientY = clientY;
  }

  private _handleMouseUp() {
    document.removeEventListener('mousemove', this._handleMouseMove);
    document.removeEventListener('mouseup', this._handleMouseUp);
    document.body.removeEventListener('mouseleave', this._handleMouseUp);
  }

  private _handleTouchEnd() {
    document.removeEventListener('touchmove', this._handleTouchMove);
    document.removeEventListener('touchend', this._handleTouchEnd);
    document.body.removeEventListener('touchcancel', this._handleTouchEnd);
  }

  private _handleWindowResize() {
    this._repositionPopup();
  }

  private _repositionPopup() {
    let newLeft = this._popupElement!.offsetLeft;
    let newTop = this._popupElement!.offsetTop;

    const topPaddingPx = getTopPopupPaddingPx();
    if (newLeft - POPUP_PADDING_PX < 0) { newLeft = POPUP_PADDING_PX; }
    if (newTop - topPaddingPx < 0) { newTop = topPaddingPx; }
    if (newLeft + POPUP_PADDING_PX > document.body.offsetWidth - this._popupElement!.offsetWidth) {
      newLeft = document.body.offsetWidth - this._popupElement!.offsetWidth - POPUP_PADDING_PX;
    }
    if (newTop + topPaddingPx > document.body.offsetHeight - this._popupElement!.offsetHeight) {
      newTop = document.body.offsetHeight - this._popupElement!.offsetHeight - topPaddingPx;
    }

    this._popupElement!.style.left = `${newLeft}px`;
    this._popupElement!.style.top = `${newTop}px`;
  }

  private _buildPopup() {
    const body = cssPopup(
      {tabIndex: '-1'},
      cssPopup.cls('-auto', this._options.autoHeight ?? false),
      cssPopupHeader(
        dom.domComputed(this._isMinimized, isMinimized => {
          return [
            // Copy buttons on the left side of the header, to automatically
            // center the title.
            cssPopupButtons(
              !this._options.closeButton ? null : cssPopupHeaderButton(
                icon('CrossSmall'),
              ),
              cssPopupHeaderButton(
                icon('Maximize')
              ),
              dom.style('visibility', 'hidden'),
            ),
            cssPopupTitle(
              cssPopupTitleText(this._buildTitle()),
              testId('title'),
            ),
            cssPopupButtons(
              !this._options.closeButton ? null : cssPopupHeaderButton(
                icon('CrossSmall'),
                dom.on('click', () => {
                  this._options.onClose?.() ?? this._closePopup();
                }),
                testId('close'),
              ),
              cssPopupHeaderButton(
                isMinimized ? icon('Maximize'): icon('Minimize'),
                hoverTooltip(isMinimized ? 'Maximize' : 'Minimize', {key: 'docTutorialTooltip'}),
                dom.on('click', () => {
                  this._isMinimized.set(!this._isMinimized.get());
                  this._repositionPopup();
                }),
                testId('minimize-maximize'),
              ),
            )
          ];
        }),
        dom.on('mousedown', this._handleMouseDown),
        dom.on('touchstart', this._handleTouchStart),
        testId('header'),
      ),
      dom.maybe(use => !use(this._isMinimized), () => this._buildContent()),
      () => { window.addEventListener('resize', this._handleWindowResize); },
      dom.onDispose(() => {
        document.removeEventListener('mousemove', this._handleMouseMove);
        document.removeEventListener('mouseup', this._handleMouseUp);
        document.removeEventListener('touchmove', this._handleTouchMove);
        document.removeEventListener('touchend', this._handleTouchEnd);
        window.removeEventListener('resize', this._handleWindowResize);
      }),
      cssPopup.cls('-minimized', this._isMinimized),
      cssPopup.cls('-mobile', isNarrowScreenObs()),
      testId('window'),
      this._buildArgs()
    );

    // For auto-height popups, we need to reposition the popup when the content changes.
    // It is important for auto-grow and to prevent popup from going off-screen.
    if (this._options.autoHeight) {
      const observer = new MutationObserver(() => {
        this._repositionPopup();
      });
      observer.observe(body, {childList: true, subtree: true});
      dom.update(body,
        dom.onDispose(() => observer.disconnect())
      );
    }

    return body;
  }
}

function getTopPopupPaddingPx(): number {
  // On mobile, we need additional padding to avoid blocking the top and bottom bars.
  return POPUP_PADDING_PX + (isNarrowScreen() ? 50 : 0);
}

const POPUP_HEIGHT = `min(711px, calc(100% - (2 * ${POPUP_PADDING_PX}px)))`;
const POPUP_HEIGHT_MOBILE = `min(711px, calc(100% - (2 * ${POPUP_PADDING_PX}px) - (2 * 50px)))`;
const POPUP_WIDTH = `min(436px, calc(100% - (2 * ${POPUP_PADDING_PX}px)))`;

const cssPopup = styled('div', `
  position: absolute;
  display: flex;
  flex-direction: column;
  border: 2px solid ${theme.accentBorder};
  border-radius: 5px;
  z-index: 999;
  height: ${POPUP_HEIGHT};
  width: ${POPUP_WIDTH};
  background-color: ${theme.popupBg};
  box-shadow: 0 2px 18px 0 ${theme.popupInnerShadow}, 0 0 1px 0 ${theme.popupOuterShadow};
  outline: unset;

  &-mobile {
    height: ${POPUP_HEIGHT_MOBILE};
  }

  &-minimized {
    max-width: 225px;
    height: unset;
  }

  &-minimized:not(&-mobile) {
    max-height: ${POPUP_HEIGHT};
  }

  &-minimized&-mobile {
    max-height: ${POPUP_HEIGHT_MOBILE};
  }

  &-auto {
    height: auto;
    max-height: ${POPUP_HEIGHT};
  }

  &-auto&-mobile {
    max-height: ${POPUP_HEIGHT_MOBILE};
  }
`);

const cssPopupHeader = styled('div', `
  color: ${theme.tutorialsPopupHeaderFg};
  --icon-color: ${theme.tutorialsPopupHeaderFg};
  background-color: ${theme.accentBorder};
  align-items: center;
  flex-shrink: 0;
  cursor: grab;
  padding-left: 4px;
  padding-right: 4px;
  height: 30px;
  user-select: none;
  display: flex;
  justify-content: space-between;
  position: relative;
  &:active {
    cursor: grabbing;
  }
`);

const cssPopupButtons = styled('div', `
  display: flex;
  column-gap: 8px;
  align-items: center;
`);

const cssPopupTitle = styled('div', `
  display: flex;
  justify-content: center;
  align-items: center;
  font-weight: 600;
  overflow: hidden;
`);

const cssPopupTitleText = styled('div', `
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
`);

export const cssPopupBody = styled('div', `
  flex-grow: 1;
  padding: 24px;
  overflow: auto;
`);

const cssPopupHeaderButton = styled('div', `
  padding: 4px;
  border-radius: 4px;
  cursor: pointer;

  &:hover {
    background-color: ${theme.hover};
  }
`);
