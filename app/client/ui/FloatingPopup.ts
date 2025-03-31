import {makeT} from 'app/client/lib/localization';
import {documentCursor} from 'app/client/lib/popupUtils';
import {hoverTooltip} from 'app/client/ui/tooltips';
import {isNarrowScreen, isNarrowScreenObs, theme, vars} from 'app/client/ui2018/cssVars';
import {IconName} from 'app/client/ui2018/IconList';
import {icon} from 'app/client/ui2018/icons';
import {clamp} from 'app/common/gutil';
import {
  Disposable,
  dom,
  DomContents,
  DomElementArg,
  IDisposable,
  makeTestId,
  Observable,
  styled,
  subscribeElem,
} from 'grainjs';
import $ from 'jquery';

const POPUP_GAP_PX = 16;

const POPUP_HEADER_HEIGHT_PX = 30;

const t = makeT('FloatingPopup');

const testId = makeTestId('test-floating-popup-');

export const FLOATING_POPUP_TOOLTIP_KEY = 'floatingPopupTooltip';

export interface PopupOptions {
  /** Width in pixels. */
  width: number;
  /** Height in pixels. */
  height: number;
  title?: () => DomContents;
  content?: () => DomContents;
  onClose?: () => void;
  onMoveEnd?: (position: PopupPosition) => void;
  onResizeEnd?: (size: PopupSize) => void;
  closeButton?: boolean;
  closeButtonIcon?: IconName;
  closeButtonHover?: () => DomContents;
  minimizable?: boolean;
  /** Minimum width in pixels. */
  minWidth?: number;
  /** Minimum height in pixels. */
  minHeight?: number;
  /** Maximum width in pixels. */
  maxWidth?: number;
  /** Maximum height in pixels. */
  maxHeight?: number;
  /** Defaults to false. */
  stopClickPropagationOnMove?: boolean;
  position?: PopupPosition;
  args?: DomElementArg[];
}

export interface PopupPosition {
  left: number;
  top: number;
}

interface PopupSize extends PopupPosition {
  width: number;
  height: number;
}

export class FloatingPopup extends Disposable {
  private _width = Observable.create(this, this._options.width);
  private _height = Observable.create(this, this._options.height);
  private _position = Observable.create(this, this._options.position);
  private _closable = this._options.closeButton ?? false;
  private _minimizable = this._options.minimizable ?? false;
  private _isMinimized = Observable.create(this, false);
  private _minWidth = this._options.minWidth ?? 0;
  private _minHeight = this._options.minHeight ?? 0;
  private _maxWidth = this._options.maxWidth ?? Infinity;
  private _maxHeight = this._options.maxHeight ?? Infinity;
  private _isFinishingMove = false;
  private _popupElement: HTMLElement | null = null;
  private _popupMinimizeButtonElement: HTMLElement | null = null;

  private _startX: number;
  private _startY: number;
  private _startLeft: number;
  private _startTop: number;
  private _cursorGrab: IDisposable|null = null;

  constructor(protected _options: PopupOptions) {
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
    this._repositionPopup();
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

  private _getDefaultPosition(): PopupPosition {
    const top = Math.max(
      document.body.offsetHeight - this._height.get(),
      getPopupTopBottomGapPx()
    );
    const left = Math.max(
      document.body.offsetWidth - this._width.get(),
      POPUP_GAP_PX
    );
    return {
      top,
      left,
    };
  }

  private _handleMouseDown(ev: MouseEvent) {
    if (ev.button !== 0) { return; } // Only handle left-click.
    this._startX = ev.clientX;
    this._startY = ev.clientY;
    this._setStartPosition();
    document.addEventListener('mousemove', this._handleMouseMove);
    document.addEventListener('mouseup', this._handleMouseUp);
    this._forceCursor();
  }

  private _handleTouchStart(ev: TouchEvent) {
    this._startX = ev.touches[0].clientX;
    this._startY = ev.touches[0].clientY;
    this._setStartPosition();
    document.addEventListener('touchmove', this._handleTouchMove);
    document.addEventListener('touchend', this._handleTouchEnd);
    this._forceCursor();
  }

  private _setStartPosition() {
    this._startTop = this._popupElement!.offsetTop;
    this._startLeft = this._popupElement!.offsetLeft;
  }

  private _handleTouchMove({touches}: TouchEvent) {
    this._handleMouseMove(touches[0]);
  }

  private _handleMouseMove({clientX, clientY}: MouseEvent | Touch) {
    // Last change in position (from last move).
    const deltaX = clientX - this._startX;
    const deltaY = clientY - this._startY;

    // Available space where we can put the popup (anchored at top left corner).
    const viewPort = {
      right: document.body.offsetWidth,
      bottom: document.body.offsetHeight,
      top: getPopupTopBottomGapPx(),
      left: 0,
    };

    // Allow some extra space, where we can still move the popup outside the viewport.
    viewPort.right += this._popupElement!.offsetWidth - (POPUP_HEADER_HEIGHT_PX * 4);
    viewPort.left -= this._popupElement!.offsetWidth - (POPUP_HEADER_HEIGHT_PX * 4);
    viewPort.bottom += this._popupElement!.offsetHeight - POPUP_HEADER_HEIGHT_PX;

    let newLeft = this._startLeft + deltaX;
    let newTop = this._startTop + deltaY;
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
    this._handleMoveEnd();
  }

  private _handleTouchEnd() {
    document.removeEventListener('touchmove', this._handleTouchMove);
    document.removeEventListener('touchend', this._handleTouchEnd);
    document.body.removeEventListener('touchcancel', this._handleTouchEnd);
    this._handleMoveEnd();
  }

  private _handleMoveEnd() {
    this._cursorGrab?.dispose();
    this._updatePosition();
    this._options.onMoveEnd?.(this._position.get()!);
  }

  private _updatePosition() {
    this._position.set({
      left: this._popupElement!.offsetLeft,
      top: this._popupElement!.offsetTop,
    });
  }

  private _updateSize() {
    this._width.set(this._popupElement!.offsetWidth);
    this._height.set(this._popupElement!.offsetHeight);
  }

  private _handleWindowResize() {
    this._repositionPopup();
  }

  private _repositionPopup() {
    const newWidth = clamp(
      this._width.get(),
      this._minWidth,
      document.body.offsetWidth - (2 * POPUP_GAP_PX)
    );
    const newHeight = clamp(
      this._height.get(),
      this._minHeight,
      document.body.offsetHeight - (2 * getPopupTopBottomGapPx())
    );
    this._popupElement!.style.width = `${newWidth}px`;
    this._popupElement!.style.height = `${newHeight}px`;

    const topGapPx = getPopupTopBottomGapPx();
    let {left: newLeft, top: newTop} = this._position.get() ?? this._getDefaultPosition();
    if (newLeft - POPUP_GAP_PX < 0) { newLeft = POPUP_GAP_PX; }
    if (newTop - topGapPx < 0) { newTop = topGapPx; }
    if (newLeft + POPUP_GAP_PX > document.body.offsetWidth - this._popupElement!.offsetWidth) {
      newLeft = document.body.offsetWidth - this._popupElement!.offsetWidth - POPUP_GAP_PX;
    }
    if (newTop + topGapPx > document.body.offsetHeight - this._popupElement!.offsetHeight) {
      newTop = document.body.offsetHeight - this._popupElement!.offsetHeight - topGapPx;
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
    const popup = cssPopupWrap(
      {tabIndex: '-1'},
      dom.style('min-height', use => use(this._isMinimized) ? 'unset' : `${this._minHeight}px`),
      cssPopup(
        cssPopupHeader(
          cssBottomHandle(testId('move-handle')),
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
      ),
      this._resizable.bind(this),
      () => { window.addEventListener('resize', this._handleWindowResize); },
      dom.onDispose(() => {
        document.removeEventListener('mousemove', this._handleMouseMove);
        document.removeEventListener('mouseup', this._handleMouseUp);
        document.removeEventListener('touchmove', this._handleTouchMove);
        document.removeEventListener('touchend', this._handleTouchEnd);
        window.removeEventListener('resize', this._handleWindowResize);
      }),
      cssPopupWrap.cls('-minimized', this._isMinimized),
      testId('window'),
      this._buildArgs()
    );

    return popup;
  }

  private _resizable() {
    return (elem: HTMLElement) =>
      subscribeElem(elem, this._isMinimized, (minimized) => {
        if (minimized) {
          ($(elem)).resizable({
            disabled: true,
          });
        } else {
          ($(elem)).resizable({
            disabled: false,
            handles: 'all',
            minWidth: this._minWidth,
            minHeight: this._minHeight,
            maxWidth: this._maxWidth,
            maxHeight: this._maxHeight,
            resize: this._handleResize.bind(this),
            stop: this._handleResizeStop.bind(this),
          });
        }
      });
  }

  private _handleResize(
    _event: Event,
    {position, originalPosition, size, originalSize}: JQueryUI
  ) {
    // Constrain resizing to the portion of the viewport that the popup is
    // allowed to be positioned.
    //
    // While jQuery can optionally take a container to constrain resizing to,
    // it's a bit incompatible with our current model of positioning; if a
    // popup is partially off-screen and a container is set, jQuery will
    // reposition the popup on resize start, which isn't what we want. Instead,
    // we manually clamp the position and dimensions of the popup to match
    // the constraints we've settled on for re-positioning.
    if (position.top !== originalPosition.top) {
      position.top = clamp(
        position.top,
        getPopupTopBottomGapPx(),
        document.body.offsetHeight - POPUP_HEADER_HEIGHT_PX
      );
      size.height = originalPosition.top + originalSize.height - position.top;
    }
    if (position.left !== originalPosition.left) {
      position.left = clamp(
        position.left,
        POPUP_GAP_PX,
        document.body.offsetWidth - (POPUP_HEADER_HEIGHT_PX * 4)
      );
      size.width = originalPosition.left + originalSize.width - position.left;
    }
    if (
      position.top === originalPosition.top &&
      size.height !== originalSize.height
    ) {
      size.height = clamp(
        size.height,
        this._minHeight,
        document.body.offsetHeight - position.top - POPUP_GAP_PX
      );
    }
    if (
      position.left === originalPosition.left &&
      size.width !== originalSize.width
    ) {
      size.width = clamp(
        size.width,
        Math.max(this._minWidth, position.left < 0 ? -position.left + (POPUP_HEADER_HEIGHT_PX * 4) : 0),
        document.body.offsetWidth - position.left - POPUP_GAP_PX
      );
    }
  }

  private _handleResizeStop() {
    this._updatePosition();
    this._updateSize();
    this._options.onResizeEnd?.({
      ...this._position.get()!,
      width: this._width.get(),
      height: this._height.get(),
    });
  }

  private _forceCursor() {
    this._cursorGrab?.dispose();
    this._cursorGrab = documentCursor('grabbing');
  }
}

function getPopupTopBottomGapPx(): number {
  // On mobile, we need additional margin to avoid blocking the top and bottom bars.
  return POPUP_GAP_PX + (isNarrowScreen() ? 50 : 0);
}

const cssPopupWrap = styled('div.floating-popup', `
  position: fixed;
  outline: 2px solid ${theme.accentBorder};
  border-radius: 5px;
  z-index: ${vars.floatingPopupZIndex};
  background-color: ${theme.popupBg};
  box-shadow: 0 2px 18px 0 ${theme.popupInnerShadow}, 0 0 1px 0 ${theme.popupOuterShadow};

  &-minimized {
    max-width: 225px;
    height: unset !important;
    min-height: unset;
  }

  & > .ui-resizable-e,
  & > .ui-resizable-w {
    cursor: ew-resize;
  }

  & > .ui-resizable-n,
  & > .ui-resizable-s {
    cursor: ns-resize;
  }

  & > .ui-resizable-ne,
  & > .ui-resizable-sw {
    cursor: nesw-resize;
  }

  & > .ui-resizable-nw,
  & > .ui-resizable-se {
    cursor: nwse-resize;
  }

  & > .ui-resizable-se {
    background-image: none;
    width: 9px;
    height: 9px;
    right: -5px;
    bottom: -5px;
  }
`);

const cssPopup = styled('div', `
  display: flex;
  flex-direction: column;
  overflow: hidden;
  height: 100%;
  border-radius: 5px;
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
  height: ${POPUP_HEADER_HEIGHT_PX}px;
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
  left: 8px;
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
