import {GristDoc} from 'app/client/components/GristDoc';
import {logTelemetryEvent} from 'app/client/lib/telemetry';
import {getWelcomeHomeUrl, urlState} from 'app/client/models/gristUrlState';
import {renderer} from 'app/client/ui/DocTutorialRenderer';
import {cssPopupBody, FLOATING_POPUP_TOOLTIP_KEY, FloatingPopup} from 'app/client/ui/FloatingPopup';
import {sanitizeHTML} from 'app/client/ui/sanitizeHTML';
import {hoverTooltip, setHoverTooltip} from 'app/client/ui/tooltips';
import {basicButton, primaryButton} from 'app/client/ui2018/buttons';
import {mediaXSmall, theme, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {loadingSpinner} from 'app/client/ui2018/loaders';
import {confirmModal, modal} from 'app/client/ui2018/modals';
import {parseUrlId} from 'app/common/gristUrls';
import {dom, makeTestId, Observable, styled} from 'grainjs';
import {marked} from 'marked';
import debounce = require('lodash/debounce');
import range = require('lodash/range');
import sortBy = require('lodash/sortBy');

interface DocTutorialSlide {
  slideContent: string;
  boxContent?: string;
  slideTitle?: string;
  imageUrls: string[];
}

const testId = makeTestId('test-doc-tutorial-');

export class DocTutorial extends FloatingPopup {
  private _appModel = this._gristDoc.docPageModel.appModel;
  private _currentDoc = this._gristDoc.docPageModel.currentDoc.get();
  private _currentFork = this._currentDoc?.forks?.[0];
  private _docComm = this._gristDoc.docComm;
  private _docData = this._gristDoc.docData;
  private _docId = this._gristDoc.docId();
  private _slides: Observable<DocTutorialSlide[] | null> = Observable.create(this, null);
  private _currentSlideIndex = Observable.create(this, this._currentFork?.options?.tutorial?.lastSlideIndex ?? 0);


  private _saveCurrentSlidePositionDebounced = debounce(this._saveCurrentSlidePosition, 1000, {
    // Save new position immediately if at least 1 second has passed since the last change.
    leading: true,
    // Otherwise, wait for the new position to settle for 1 second before saving it.
    trailing: true
  });

  constructor(private _gristDoc: GristDoc) {
    super({
      minimizable: true,
      stopClickPropagationOnMove: true,
    });
  }

  public async start() {
    this.showPopup();
    await this._loadSlides();

    const tableData = this._docData.getTable('GristDocTutorial');
    if (tableData) {
      this.autoDispose(tableData.tableActionEmitter.addListener(() => this._reloadSlides()));
    }

    this._logTelemetryEvent('tutorialOpened');
  }

  protected _buildTitle() {
    return dom('span', dom.text(this._gristDoc.docPageModel.currentDocTitle), testId('popup-header'));
  }

  protected _buildContent() {
    return [
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
            this._initializeImages(),
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
                hoverTooltip('Restart Tutorial', {key: FLOATING_POPUP_TOOLTIP_KEY}),
                dom.on('click', () => this._restartTutorial()),
                testId('popup-restart'),
              ),
            ),
            cssProgressBar(
              range(slides.length).map((i) => cssProgressBarDot(
                hoverTooltip(slides[i].slideTitle, {
                  closeOnClick: false,
                  key: FLOATING_POPUP_TOOLTIP_KEY,
                }),
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
    ];
  }

  protected _buildArgs() {
    return [
      dom.cls('doc-tutorial-popup'),
      testId('popup'),
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
    ];
  }

  private _logTelemetryEvent(event: 'tutorialOpened' | 'tutorialProgressChanged') {
    const currentSlideIndex = this._currentSlideIndex.get();
    const numSlides = this._slides.get()?.length;
    let percentComplete: number | undefined = undefined;
    if (numSlides !== undefined && numSlides > 0) {
      percentComplete = Math.floor(((currentSlideIndex + 1) / numSlides) * 100);
    }
    logTelemetryEvent(event, {
      full: {
        tutorialForkIdDigest: this._currentFork?.id,
        tutorialTrunkIdDigest: this._currentFork?.trunkId,
        lastSlideIndex: currentSlideIndex,
        numSlides,
        percentComplete,
      },
    });
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

  private async _reloadSlides() {
    await this._loadSlides();
    const slides = this._slides.get();
    if (!slides) { return; }

    if (this._currentSlideIndex.get() > slides.length - 1) {
      this._currentSlideIndex.set(slides.length - 1);
    }
  }

  private async _saveCurrentSlidePosition() {
    const currentOptions = this._currentDoc?.options ?? {};
    const currentSlideIndex = this._currentSlideIndex.get();
    await this._appModel.api.updateDoc(this._docId, {
      options: {
        ...currentOptions,
        tutorial: {
          lastSlideIndex: currentSlideIndex,
        }
      }
    });
    this._logTelemetryEvent('tutorialProgressChanged');
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
    const lastVisitedOrg = this._appModel.lastVisitedOrgDomain.get();
    if (lastVisitedOrg) {
      await urlState().pushUrl({org: lastVisitedOrg});
    } else {
      window.location.assign(getWelcomeHomeUrl());
    }
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
      doRestart,
      {
        modalOptions: {
          backerDomArgs: [
            // Stack modal above the tutorial popup.
            dom.style('z-index', vars.tutorialModalZIndex.toString()),
          ],
        },
      }
    );
  }

  private _initializeImages() {
    return (element: HTMLElement) => {
      setTimeout(() => {
        const imgs = element.querySelectorAll('img');
        for (const img of imgs) {
          // Re-assigning src to itself is a neat way to restart a GIF.
          // eslint-disable-next-line no-self-assign
          img.src = img.src;

          setHoverTooltip(img, 'Click to expand', {
            key: FLOATING_POPUP_TOOLTIP_KEY,
            modifiers: {
              flip: {
                boundariesElement: 'scrollParent',
              },
            },
            placement: 'bottom',
          });
        }
      }, 0);
    };
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
    }, {
      backerDomArgs: [
        // Stack modal above the tutorial popup.
        dom.style('z-index', vars.tutorialModalZIndex.toString()),
      ],
    });
  }
}


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
