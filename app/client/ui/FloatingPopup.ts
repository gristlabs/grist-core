import {makeT} from 'app/client/lib/localization';
import {documentCursor} from 'app/client/lib/popupUtils';
import {hoverTooltip} from 'app/client/ui/tooltips';
import {isNarrowScreen, isNarrowScreenObs, theme, vars} from 'app/client/ui2018/cssVars';
import {IconName} from 'app/client/ui2018/IconList';
import {icon} from 'app/client/ui2018/icons';
import {Disposable, dom, DomContents, DomElementArg,
        IDisposable, makeTestId, Observable, styled} from 'grainjs';

const POPUP_INITIAL_PADDING_PX = 16;
const POPUP_DEFAULT_MIN_HEIGHT = 300;
const POPUP_MAX_HEIGHT = 711;
const POPUP_HEADER_HEIGHT = 30;

const t = makeT('FloatingPopup');

const testId = makeTestId('test-floating-popup-');

export const FLOATING_POPUP_TOOLTIP_KEY = 'floatingPopupTooltip';

export interface PopupOptions {
  title?: () => DomContents;
  content?: () => DomContents;
  onClose?: () => void;
  closeButton?: boolean;
  closeButtonIcon?: IconName;
  closeButtonHover?: () => DomContents;
  minimizable?: boolean;
  autoHeight?: boolean;
  /** Minimum height in pixels. */
  minHeight?: number;
  /** Defaults to false. */
  stopClickPropagationOnMove?: boolean;
  initialPosition?: [left: number, top: number];
  args?: DomElementArg[];
}

export class FloatingPopup extends Disposable {
  protected _isMinimized = Observable.create(this, false);
  private _closable = this._options.closeButton ?? false;
  private _minimizable = this._options.minimizable ?? false;
  private _minHeight = this._options.minHeight ?? POPUP_DEFAULT_MIN_HEIGHT;
  private _isFinishingMove = false;
  private _popupElement: HTMLElement | null = null;
  private _popupMinimizeButtonElement: HTMLElement | null = null;

  private _startX: number;
  private _startY: number;
  private _initialTop: number;
  private _initialBottom: number;
  private _initialLeft: number;
  private _resize = false;
  private _cursorGrab: IDisposable|null = null;

  constructor(protected _options: PopupOptions = {}) {
    super();

    if (_options.stopClickPropagationOnMove){
      // weasel.js registers a 'click' listener that closes any open popups that
      // are outside the click target. We capture the click event here, stopping
      // propagation in a few scenarios where closing popups is undesirable.
      window.addEventListener('click', (ev) => {
        if (this._isFinishingMove) {
          ev.stopPropagation();
          this._isFinishingMove = false;
          return;
        }

        if (this._popupMinimizeButtonElement?.contains(ev.target as Node)) {
          ev.stopPropagation();
          this._minimizeOrMaximize();
          return;
        }
      }, {capture: true});
    }

    this._handleMouseDown = this._handleMouseDown.bind(this);
    this._handleMouseMove = this._handleMouseMove.bind(this);
    this._handleMouseUp = this._handleMouseUp.bind(this);
    this._handleTouchStart = this._handleTouchStart.bind(this);
    this._handleTouchMove = this._handleTouchMove.bind(this);
    this._handleTouchEnd = this._handleTouchEnd.bind(this);
    this._handleWindowResize = this._handleWindowResize.bind(this);

    this.autoDispose(isNarrowScreenObs().addListener(() => this._repositionPopup()));

    this.onDispose(() => {
      this._disposePopup();
      this._cursorGrab?.dispose();
    });
  }

  public showPopup() {
    this._popupElement = this._buildPopup();
    document.body.appendChild(this._popupElement);

    const {initialPosition} = this._options;
    if (initialPosition) {
      this._setPosition(initialPosition);
      this._repositionPopup();
    } else {
      const left = document.body.offsetWidth - this._popupElement.offsetWidth - POPUP_INITIAL_PADDING_PX;
      const top = document.body.offsetHeight - this._popupElement.offsetHeight - getTopPopupPaddingPx();
      this._setPosition([left, top]);
    }
  }

  protected _closePopup() {
    if (!this._closable) { return; }

    this._disposePopup();
  }

  protected _buildTitle(): DomContents {
    return this._options.title?.() ?? null;
  }

  protected _buildContent(): DomContents {
    return this._options.content?.() ?? null;
  }

  protected _buildArgs(): any {
    return this._options.args ?? [];
  }

  private _disposePopup() {
    if (!this._popupElement) { return; }

    document.body.removeChild(this._popupElement);
    dom.domDispose(this._popupElement);
    this._popupElement = null;
  }

  private _setPosition([left, top]: [left: number, top: number]) {
    if (!this._popupElement) { return; }

    this._popupElement.style.left = `${left}px`;
    this._popupElement.style.top = `${top}px`;
  }

  private _rememberPosition() {
    this._initialLeft = this._popupElement!.offsetLeft;
    this._initialTop = this._popupElement!.offsetTop;
    this._initialBottom = this._popupElement!.offsetTop + this._popupElement!.offsetHeight;
  }

  private _handleMouseDown(ev: MouseEvent) {
    if (ev.button !== 0) { return; } // Only handle left-click.
    this._startX = ev.clientX;
    this._startY = ev.clientY;
    this._rememberPosition();
    document.addEventListener('mousemove', this._handleMouseMove);
    document.addEventListener('mouseup', this._handleMouseUp);
    this._forceCursor();
  }

  private _handleTouchStart(ev: TouchEvent) {
    this._startX = ev.touches[0].clientX;
    this._startY = ev.touches[0].clientY;
    this._rememberPosition();
    document.addEventListener('touchmove', this._handleTouchMove);
    document.addEventListener('touchend', this._handleTouchEnd);

    this._resize = false;
    this._forceCursor();
  }

  private _handleTouchMove({touches}: TouchEvent) {
    this._handleMouseMove(touches[0]);
  }

  private _handleMouseMove({clientX, clientY}: MouseEvent | Touch) {
    if (this._resize) {
      this._handleResize(clientY);
    } else {
      this._handleMove(clientX, clientY);
    }
  }

  private _handleResize(clientY: number) {
    const deltaY = clientY - this._startY;
    if (this._resize && !isNarrowScreen()) {
      // First calculate the boundaries for the new top.

      // First just how much we can resize the popup.
      let minTop = this._initialBottom - POPUP_MAX_HEIGHT;
      let maxTop = this._initialBottom - this._minHeight;

      // Now how far we can move top (leave at least some padding for mobile).
      minTop = Math.max(minTop, getTopPopupPaddingPx());
      // And bottom (we want the header to be visible)
      maxTop = Math.min(document.body.offsetHeight - POPUP_HEADER_HEIGHT - 2, maxTop);

      // Now get new top from those boundaries.
      const newTop = Math.max(minTop, Math.min(maxTop, this._initialTop + deltaY));
      // And calculate the new height.
      const newHeight = this._initialBottom - newTop;
      this._popupElement!.style.top = `${newTop}px`;
      this._popupElement!.style.setProperty('--height', `${newHeight}px`);
      return;
    }
  }

  private _handleMove(clientX: number, clientY: number) {
    // Last change in position (from last move).
    const deltaX = clientX - this._startX;
    const deltaY = clientY - this._startY;

    // Available space where we can put the popup (anchored at top left corner).
    const viewPort = {
      right: document.body.offsetWidth,
      bottom: document.body.offsetHeight,
      top: getTopPopupPaddingPx(),
      left: 0,
    };

    // Allow some extra space, where we can still move the popup outside the viewport.
    viewPort.right += this._popupElement!.offsetWidth - (POPUP_HEADER_HEIGHT + 2) * 4;
    viewPort.left -= this._popupElement!.offsetWidth - (POPUP_HEADER_HEIGHT + 2) * 4;
    viewPort.bottom += this._popupElement!.offsetHeight - POPUP_HEADER_HEIGHT - 2; // 2px border top

    let newLeft = this._initialLeft + deltaX;
    let newTop = this._initialTop + deltaY;
    const newRight = (val?: number) => {
      if (val !== undefined) { newLeft = val - this._popupElement!.offsetWidth; }
      return newLeft + this._popupElement!.offsetWidth;
    };
    const newBottom = (val?: number) => {
      if (val !== undefined) { newTop = val - this._popupElement!.offsetHeight; }
      return newTop + this._popupElement!.offsetHeight;
    };

    // Calculate new position in the padding area.
    if (newLeft < viewPort.left) { newLeft = viewPort.left; }
    if (newRight() > viewPort.right) { newRight(viewPort.right); }
    if (newTop  < viewPort.top) { newTop = viewPort.top; }
    if (newBottom() > viewPort.bottom) { newBottom(viewPort.bottom); }

    this._popupElement!.style.left = `${newLeft}px`;
    this._popupElement!.style.top = `${newTop}px`;
  }

  private _handleMouseUp() {
    this._isFinishingMove = true;
    document.removeEventListener('mousemove', this._handleMouseMove);
    document.removeEventListener('mouseup', this._handleMouseUp);
    document.body.removeEventListener('mouseleave', this._handleMouseUp);
    this._handleMouseEnd();
  }

  private _handleTouchEnd() {
    document.removeEventListener('touchmove', this._handleTouchMove);
    document.removeEventListener('touchend', this._handleTouchEnd);
    document.body.removeEventListener('touchcancel', this._handleTouchEnd);
    this._handleMouseEnd();
  }

  private _handleMouseEnd() {
    this._resize = false;
    this._cursorGrab?.dispose();
  }

  private _handleWindowResize() {
    this._repositionPopup();
  }

  private _repositionPopup() {
    let newLeft = this._popupElement!.offsetLeft;
    let newTop = this._popupElement!.offsetTop;

    const topPaddingPx = getTopPopupPaddingPx();
    if (newLeft - POPUP_INITIAL_PADDING_PX < 0) { newLeft = POPUP_INITIAL_PADDING_PX; }
    if (newTop - topPaddingPx < 0) { newTop = topPaddingPx; }
    if (newLeft + POPUP_INITIAL_PADDING_PX > document.body.offsetWidth - this._popupElement!.offsetWidth) {
      newLeft = document.body.offsetWidth - this._popupElement!.offsetWidth - POPUP_INITIAL_PADDING_PX;
    }
    if (newTop + topPaddingPx > document.body.offsetHeight - this._popupElement!.offsetHeight) {
      newTop = document.body.offsetHeight - this._popupElement!.offsetHeight - topPaddingPx;
    }

    this._popupElement!.style.left = `${newLeft}px`;
    this._popupElement!.style.top = `${newTop}px`;
  }

  private _minimizeOrMaximize() {
    if (!this._minimizable) { return; }

    this._isMinimized.set(!this._isMinimized.get());
    this._repositionPopup();
  }

  private _buildPopup() {
    const body = cssPopup(
      {tabIndex: '-1'},
      cssPopup.cls('-auto', this._options.autoHeight ?? false),
      dom.style('min-height', use => use(this._isMinimized) ? 'unset' : `${this._minHeight}px`),
      cssPopupHeader(
        cssBottomHandle(testId('move-handle')),
        dom.maybe(use => !use(this._isMinimized), () => {
          return cssResizeTopLayer(
            cssTopHandle(testId('resize-handle')),
            dom.on('mousedown', () => this._resize = true),
            dom.on('dblclick', (e) => {
              e.stopImmediatePropagation();
              this._popupElement?.style.setProperty('--height', `${POPUP_MAX_HEIGHT}px`);
              this._repositionPopup();
            })
          );
        }),
        dom.domComputed(this._isMinimized, isMinimized => {
          return [
            // Copy buttons on the left side of the header, to automatically
            // center the title.
            cssPopupButtons(
              cssPopupHeaderButton(
                icon('Maximize'),
                dom.show(this._minimizable),
              ),
              cssPopupHeaderButton(
                icon('CrossBig'),
                dom.show(this._closable),
              ),
              dom.style('visibility', 'hidden'),
            ),
            cssPopupTitle(
              cssPopupTitleText(this._buildTitle()),
              testId('title'),
            ),
            cssPopupButtons(
              this._popupMinimizeButtonElement = cssPopupHeaderButton(
                isMinimized ? icon('Maximize'): icon('Minimize'),
                hoverTooltip(isMinimized ? t('Maximize') : t('Minimize'), {
                  key: FLOATING_POPUP_TOOLTIP_KEY,
                }),
                dom.on('click', () => this._minimizeOrMaximize()),
                dom.show(this._minimizable),
                testId('minimize-maximize'),
              ),
              cssPopupHeaderButton(
                icon(this._options.closeButtonIcon ?? 'CrossBig'),
                this._options.closeButtonHover && hoverTooltip(this._options.closeButtonHover(), {
                  key: FLOATING_POPUP_TOOLTIP_KEY,
                }),
                dom.on('click', () => {
                  this._options.onClose?.() ?? this._closePopup();
                }),
                dom.show(this._closable),
                testId('close'),
              ),
              // Disable dragging when a button in the header is clicked.
              dom.on('mousedown', ev => ev.stopPropagation()),
              dom.on('touchstart', ev => ev.stopPropagation()),
            )
          ];
        }),
        dom.on('mousedown', this._handleMouseDown),
        dom.on('touchstart', this._handleTouchStart),
        dom.on('dblclick', () => this._minimizeOrMaximize()),
        testId('header'),
      ),
      cssPopupContent(
        this._buildContent(),
        cssPopupContent.cls('-minimized', this._isMinimized),
      ),
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

  private _forceCursor() {
    this._cursorGrab?.dispose();
    const type = this._resize ? 'ns-resize' : 'grabbing';
    this._cursorGrab = documentCursor(type);
  }
}


function getTopPopupPaddingPx(): number {
  // On mobile, we need additional padding to avoid blocking the top and bottom bars.
  return POPUP_INITIAL_PADDING_PX + (isNarrowScreen() ? 50 : 0);
}

const POPUP_HEIGHT = `min(var(--height), calc(100% - (2 * ${POPUP_INITIAL_PADDING_PX}px)))`;
const POPUP_HEIGHT_MOBILE = `min(var(--height), calc(100% - (2 * ${POPUP_INITIAL_PADDING_PX}px) - (2 * 50px)))`;

export const FLOATING_POPUP_MAX_WIDTH_PX = 436;
const POPUP_WIDTH = `min(${FLOATING_POPUP_MAX_WIDTH_PX}px, calc(100% - (2 * ${POPUP_INITIAL_PADDING_PX}px)))`;

const cssPopup = styled('div.floating-popup', `
  position: fixed;
  display: flex;
  flex-direction: column;
  border: 2px solid ${theme.accentBorder};
  border-radius: 5px;
  z-index: ${vars.floatingPopupZIndex};
  --height: ${POPUP_MAX_HEIGHT}px;
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
    min-height: unset;
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
    min-height: unset;
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
  height: ${POPUP_HEADER_HEIGHT}px;
  user-select: none;
  display: flex;
  justify-content: space-between;
  position: relative;
  isolation: isolate;
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
  z-index: 1000;

  &:hover {
    background-color: ${theme.hover};
  }
`);

const cssResizeTopLayer = styled('div', `
  position: absolute;
  top: -6px;
  left: 0;
  right: 0;
  bottom: 28px;
  z-index: 500;
  cursor: ns-resize;
`);

const cssTopHandle = styled('div', `
  position: absolute;
  top: 0;
  left: 0;
  width: 1px;
  height: 1px;
  pointer-events: none;
  user-select: none;
  visibility: hidden;
`);

const cssBottomHandle = styled(cssTopHandle, `
  top: unset;
  bottom: 0;
  left: 0;
`);

const cssPopupContent = styled('div', `
  display: flex;
  flex-direction: column;
  flex-grow: 1;
  overflow: hidden;

  &-minimized {
    display: none;
  }
`);
