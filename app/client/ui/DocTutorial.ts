import {GristDoc} from 'app/client/components/GristDoc';
import {urlState} from 'app/client/models/gristUrlState';
import {renderer} from 'app/client/ui/DocTutorialRenderer';
import {sanitizeHTML} from 'app/client/ui/sanitizeHTML';
import {hoverTooltip} from 'app/client/ui/tooltips';
import {basicButton, primaryButton} from 'app/client/ui2018/buttons';
import {isNarrowScreen, isNarrowScreenObs, mediaXSmall, theme} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {loadingSpinner} from 'app/client/ui2018/loaders';
import {confirmModal, modal} from 'app/client/ui2018/modals';
import {parseUrlId} from 'app/common/gristUrls';
import {Disposable, dom, makeTestId, Observable, styled} from 'grainjs';
import {marked} from 'marked';
import debounce = require('lodash/debounce');
import range = require('lodash/range');
import sortBy = require('lodash/sortBy');

const POPUP_PADDING_PX = 16;

interface DocTutorialSlide {
  slideContent: string;
  boxContent?: string;
  slideTitle?: string;
  imageUrls: string[];
}

const testId = makeTestId('test-doc-tutorial-');

export class DocTutorial extends Disposable {
  private _appModel = this._gristDoc.docPageModel.appModel;
  private _currentDoc = this._gristDoc.docPageModel.currentDoc.get();
  private _docComm = this._gristDoc.docComm;
  private _docData = this._gristDoc.docData;
  private _docId = this._gristDoc.docId();
  private _popupElement: HTMLElement | null = null;
  private _slides: Observable<DocTutorialSlide[] | null> = Observable.create(this, null);
  private _currentSlideIndex = Observable.create(this,
    this._currentDoc?.forks?.[0]?.options?.tutorial?.lastSlideIndex ?? 0);
  private _isMinimized = Observable.create(this, false);

  private _clientX: number;
  private _clientY: number;

  private _saveCurrentSlidePositionDebounced = debounce(this._saveCurrentSlidePosition, 1000, {
    // Save new position immediately if at least 1 second has passed since the last change.
    leading: true,
    // Otherwise, wait for the new position to settle for 1 second before saving it.
    trailing: true
  });

  constructor(private _gristDoc: GristDoc) {
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

  public async start() {
    this._showPopup();
    await this._loadSlides();
  }

  private async _loadSlides() {
    const tableId = 'GristDocTutorial';
    if (!this._docData.getTable(tableId)) {
      throw new Error('DocTutorial failed to find table GristDocTutorial');
    }

    await this._docComm.waitForInitialization();
    if (this.isDisposed()) { return; }

    await this._docData.fetchTable(tableId);
    if (this.isDisposed()) { return; }

    const tableData = this._docData.getTable(tableId)!;
    const slides = (await Promise.all(
      sortBy(tableData.getRowIds(), tableData.getRowPropFunc('manualSort') as any)
      .map(async rowId => {
        let slideTitle: string | undefined;
        const imageUrls: string[] = [];

        const getValue = (colId: string): string | undefined => {
          const value = tableData.getValue(rowId, colId);
          return value ? String(value) : undefined;
        };

        const walkTokens = (token: marked.Token) => {
          if (token.type === 'image') {
            imageUrls.push(token.href);
          }

          if (!slideTitle && token.type === 'heading' && token.depth === 1) {
            slideTitle = token.text;
          }
        };

        let slideContent = getValue('slide_content');
        if (!slideContent) { return null; }
        slideContent = sanitizeHTML(await marked.parse(slideContent, {
          async: true, renderer, walkTokens
        }));

        let boxContent = getValue('box_content');
        if (boxContent) {
          boxContent = sanitizeHTML(await marked.parse(boxContent, {
            async: true, renderer, walkTokens
          }));
        }
        return {
          slideContent,
          boxContent,
          slideTitle,
          imageUrls,
        };
      })
    )).filter(slide => slide !== null) as DocTutorialSlide[];
    if (this.isDisposed()) { return; }

    if (slides.length === 0) {
      throw new Error('DocTutorial failed to find slides in table GristDocTutorial');
    }

    this._slides.set(slides);
  }

  private _showPopup() {
    this._popupElement = this._buildPopup();
    document.body.appendChild(this._popupElement);

    const topPaddingPx = getTopPopupPaddingPx();
    const initialLeft = document.body.offsetWidth - this._popupElement.offsetWidth - POPUP_PADDING_PX;
    const initialTop = document.body.offsetHeight - this._popupElement.offsetHeight - topPaddingPx;
    this._popupElement.style.left = `${initialLeft}px`;
    this._popupElement.style.top = `${initialTop}px`;
  }

  private _closePopup() {
    if (!this._popupElement) { return; }

    document.body.removeChild(this._popupElement);
    dom.domDispose(this._popupElement);
    this._popupElement = null;
  }

  private _handleMouseDown(ev: MouseEvent) {
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

  private async _saveCurrentSlidePosition() {
    const currentOptions = this._currentDoc?.options ?? {};
    await this._appModel.api.updateDoc(this._docId, {
      options: {
        ...currentOptions,
        tutorial: {
          lastSlideIndex: this._currentSlideIndex.get(),
        }
      }
    });
  }

  private async _changeSlide(slideIndex: number) {
    this._currentSlideIndex.set(slideIndex);
    await this._saveCurrentSlidePositionDebounced();
  }

  private async _previousSlide() {
    await this._changeSlide(this._currentSlideIndex.get() - 1);
  }

  private async _nextSlide() {
    await this._changeSlide(this._currentSlideIndex.get() + 1);
  }

  private async _finishTutorial() {
    this._saveCurrentSlidePositionDebounced.cancel();
    await this._saveCurrentSlidePosition();
    await urlState().pushUrl({});
  }

  private async _restartTutorial() {
    const doRestart = async () => {
      const urlId = this._currentDoc!.id;
      const {trunkId} = parseUrlId(urlId);
      const docApi = this._appModel.api.getDocAPI(urlId);
      await docApi.replace({sourceDocId: trunkId, resetTutorialMetadata: true});
    };

    confirmModal(
      'Do you want to restart the tutorial? All progress will be lost.',
      'Restart',
      doRestart
    );
  }

  private _restartGIFs() {
    return (element: HTMLElement) => {
      setTimeout(() => {
        const imgs = element.querySelectorAll('img');
        for (const img of imgs) {
          // Re-assigning src to itself is a neat way to restart a GIF.
          // eslint-disable-next-line no-self-assign
          img.src = img.src;
        }
      }, 0);
    };
  }

  private _buildPopup() {
    return cssPopup(
      {tabIndex: '-1'},
      cssPopupHeader(
        dom.domComputed(this._isMinimized, isMinimized => {
          return [
            cssPopupHeaderSpacer(),
            cssPopupTitle(
              cssPopupTitleText(dom.text(this._gristDoc.docPageModel.currentDocTitle)),
              testId('popup-title'),
            ),
            cssPopupHeaderButton(
              isMinimized ? icon('Maximize'): icon('Minimize'),
              hoverTooltip(isMinimized ? 'Maximize' : 'Minimize', {key: 'docTutorialTooltip'}),
              dom.on('click', () => {
                this._isMinimized.set(!this._isMinimized.get());
                this._repositionPopup();
              }),
              testId('popup-minimize-maximize'),
            ),
          ];
        }),
        dom.on('mousedown', this._handleMouseDown),
        dom.on('touchstart', this._handleTouchStart),
        testId('popup-header'),
      ),
      dom.maybe(use => !use(this._isMinimized), () => [
        dom.domComputed(use => {
          const slides = use(this._slides);
          const slideIndex = use(this._currentSlideIndex);
          const slide = slides?.[slideIndex];
          return cssPopupBody(
            !slide ? cssSpinner(loadingSpinner()) : [
              dom('div', elem => {
                elem.innerHTML = slide.slideContent;
              }),
              !slide.boxContent ? null : cssTryItOutBox(
                dom('div', elem => { elem.innerHTML = slide.boxContent!; }),
              ),
              dom.on('click', (ev) => {
                if((ev.target as HTMLElement).tagName !== 'IMG') {
                  return;
                }

                this._openLightbox((ev.target as HTMLImageElement).src);
              }),
              this._restartGIFs(),
            ],
            testId('popup-body'),
          );
        }),
        cssPopupFooter(
          dom.domComputed(use => {
            const slides = use(this._slides);
            if (!slides) { return null; }

            const slideIndex = use(this._currentSlideIndex);
            const numSlides = slides.length;
            const isFirstSlide = slideIndex === 0;
            const isLastSlide = slideIndex === numSlides - 1;
            return [
                cssFooterButtonsLeft(
                cssPopupFooterButton(icon('Undo'),
                  hoverTooltip('Restart Tutorial', {key: 'docTutorialTooltip'}),
                  dom.on('click', () => this._restartTutorial()),
                  testId('popup-restart'),
                ),
              ),
              cssProgressBar(
                range(slides.length).map((i) => cssProgressBarDot(
                  {title: slides[i].slideTitle},
                  cssProgressBarDot.cls('-current', i === slideIndex),
                  i === slideIndex ? null : dom.on('click', () => this._changeSlide(i)),
                  testId(`popup-slide-${i + 1}`),
                )),
              ),
              cssFooterButtonsRight(
                basicButton('Previous',
                  dom.on('click', async () => {
                    await this._previousSlide();
                  }),
                  {style: `visibility: ${isFirstSlide ? 'hidden' : 'visible'}`},
                  testId('popup-previous'),
                ),
                primaryButton(isLastSlide ? 'Finish': 'Next',
                  isLastSlide
                    ? dom.on('click', async () => await this._finishTutorial())
                    : dom.on('click', async () => await this._nextSlide()),
                  testId('popup-next'),
                ),
              ),
            ];
          }),
          testId('popup-footer'),
        ),
      ]),
      // Pre-fetch images from all slides and store them in a hidden div.
      dom.maybe(this._slides, slides =>
        dom('div',
          {style: 'display: none;'},
          dom.forEach(slides, slide => {
            if (slide.imageUrls.length === 0) { return null; }

            return dom('div', slide.imageUrls.map(src => dom('img', {src})));
          }),
        ),
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
      dom.cls('doc-tutorial-popup'),
      testId('popup'),
    );
  }

  private _openLightbox(src: string) {
    modal((ctl) => {
      this.onDispose(ctl.close);
      return [
        cssFullScreenModal.cls(''),
        cssModalCloseButton('CrossBig',
          dom.on('click', () => ctl.close()),
          testId('lightbox-close'),
        ),
        cssModalContent(cssModalImage({src}, testId('lightbox-image'))),
        dom.on('click', (ev, elem) => void (ev.target === elem ? ctl.close() : null)),
        testId('lightbox'),
      ];
    });
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
`);

const cssPopupHeader = styled('div', `
  display: flex;
  color: ${theme.tutorialsPopupHeaderFg};
  --icon-color: ${theme.tutorialsPopupHeaderFg};
  background-color: ${theme.accentBorder};
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  cursor: grab;
  padding-left: 4px;
  padding-right: 4px;
  height: 30px;
  user-select: none;
  column-gap: 8px;

  &:active {
    cursor: grabbing;
  }
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

const cssPopupBody = styled('div', `
  flex-grow: 1;
  padding: 24px;
  overflow: auto;
`);

const cssPopupFooter = styled('div', `
  display: flex;
  column-gap: 24px;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  padding: 24px 16px 24px 16px;
  border-top: 1px solid ${theme.tutorialsPopupBorder};
`);

const cssTryItOutBox = styled('div', `
  margin-top: 16px;
  padding: 24px;
  border-radius: 4px;
  background-color: ${theme.tutorialsPopupBoxBg};
`);

const cssPopupHeaderButton = styled('div', `
  padding: 4px;
  border-radius: 4px;
  cursor: pointer;

  &:hover {
    background-color: ${theme.hover};
  }
`);

const cssPopupHeaderSpacer = styled('div', `
  width: 24px;
  height: 24px;
`);

const cssPopupFooterButton = styled('div', `
  --icon-color: ${theme.controlSecondaryFg};
  padding: 4px;
  border-radius: 4px;
  cursor: pointer;

  &:hover {
    background-color: ${theme.hover};
  }
`);

const cssProgressBar = styled('div', `
  display: flex;
  gap: 8px;
  flex-grow: 1;
  flex-wrap: wrap;
`);

const cssProgressBarDot = styled('div', `
  width: 10px;
  height: 10px;
  border-radius: 5px;
  align-self: center;
  cursor: pointer;
  background-color: ${theme.progressBarBg};

  &-current {
    cursor: default;
    background-color: ${theme.progressBarFg};
  }
`);

const cssFooterButtonsLeft = styled('div', `
  flex-shrink: 0;
`);

const cssFooterButtonsRight = styled('div', `
  display: flex;
  justify-content: flex-end;
  column-gap: 8px;
  flex-shrink: 0;
  min-width: 140px;

  @media ${mediaXSmall} {
    & {
      flex-direction: column;
      row-gap: 8px;
      column-gap: 0px;
      min-width: 0px;
    }
  }
`);

const cssFullScreenModal = styled('div', `
  display: flex;
  flex-direction: column;
  row-gap: 8px;
  background-color: initial;
  width: 100%;
  height: 100%;
  border: none;
  border-radius: 0px;
  box-shadow: none;
  padding: 0px;
`);

const cssModalCloseButton = styled(icon, `
  align-self: flex-end;
  flex-shrink: 0;
  height: 24px;
  width: 24px;
  cursor: pointer;
  --icon-color: ${theme.modalBackdropCloseButtonFg};
  &:hover {
    --icon-color: ${theme.modalBackdropCloseButtonHoverFg};
  }
`);

const cssModalContent = styled('div', `
  align-self: center;
  min-height: 0;
  margin-top: auto;
  margin-bottom: auto;
`);

const cssModalImage = styled('img', `
  height: 100%;
  max-width: min(100%, 1200px);
`);

const cssSpinner = styled('div', `
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
`);
