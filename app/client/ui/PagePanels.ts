/**
 * Note that it assumes the presence of cssVars.cssRootVars on <body>.
 */
import {makeT} from 'app/client/lib/localization';
import * as commands from 'app/client/components/commands';
import {watchElementForBlur} from 'app/client/lib/FocusLayer';
import {urlState} from "app/client/models/gristUrlState";
import {resizeFlexVHandle} from 'app/client/ui/resizeHandle';
import {hoverTooltip} from 'app/client/ui/tooltips';
import {transition, TransitionWatcher} from 'app/client/ui/transitions';
import {cssHideForNarrowScreen, isScreenResizing, mediaNotSmall, mediaSmall, theme} from 'app/client/ui2018/cssVars';
import {isNarrowScreenObs} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {
  dom, DomElementArg, DomElementMethod, MultiHolder, noTestId, Observable, styled, subscribe, TestId
} from "grainjs";
import noop from 'lodash/noop';
import once from 'lodash/once';
import {SessionObs} from 'app/client/lib/sessionObs';
import debounce from 'lodash/debounce';

const t = makeT('PagePanels');

const AUTO_EXPAND_TIMEOUT_MS = 400;

// delay must be greater than the time needed for transientInput to update focus (ie: 10ms);
const DELAY_BEFORE_TESTING_FOCUS_CHANGE_MS = 12;

export interface PageSidePanel {
  // Note that widths need to start out with a correct default in JS (having them in CSS is not
  // enough), needed for open/close transitions.
  panelWidth: Observable<number>;
  panelOpen: Observable<boolean>;
  hideOpener?: boolean;           // If true, don't show the opener handle.
  header: DomElementArg;
  content: DomElementArg;
}

export interface PageContents {
  leftPanel: PageSidePanel;
  rightPanel?: PageSidePanel;     // If omitted, the right panel isn't shown at all.

  headerMain: DomElementArg;
  contentMain: DomElementArg;
  banner?: DomElementArg;

  onResize?: () => void;          // Callback for when either pane is opened, closed, or resized.
  testId?: TestId;
  contentTop?: DomElementArg;
  contentBottom?: DomElementArg;
}

export function pagePanels(page: PageContents) {
  const testId = page.testId || noTestId;
  const left = page.leftPanel;
  const right = page.rightPanel;
  const onResize = page.onResize || (() => null);
  const leftOverlap = Observable.create(null, false);
  const dragResizer = Observable.create(null, false);
  const bannerHeight = Observable.create(null, 0);
  const isScreenResizingObs = isScreenResizing();

  let lastLeftOpen = left.panelOpen.get();
  let lastRightOpen = right?.panelOpen.get() || false;
  let leftPaneDom: HTMLElement;
  let rightPaneDom: HTMLElement;
  let mainHeaderDom: HTMLElement;
  let contentTopDom: HTMLElement;
  let onLeftTransitionFinish = noop;

  // When switching to mobile mode, close panels; when switching to desktop, restore the
  // last desktop state.
  const sub1 = subscribe(isNarrowScreenObs(), (use, narrow) => {
    if (narrow) {
      lastLeftOpen = leftOverlap.get() ? false : left.panelOpen.get();
      lastRightOpen = right?.panelOpen.get() || false;
    }
    left.panelOpen.set(narrow ? false : lastLeftOpen);
    right?.panelOpen.set(narrow ? false : lastRightOpen);

    // overlap should always be OFF when switching screen mode
    leftOverlap.set(false);
  });

  // When url changes, we must have navigated; close the left panel since if it were open, it was
  // the likely cause of the navigation (e.g. switch to another page or workspace).
  const sub2 = subscribe(isNarrowScreenObs(), urlState().state, (use, narrow, state) => {
    if (narrow) {
      left.panelOpen.set(false);
    }
  });

  const pauseSavingLeft = (yesNo: boolean) => {
    (left.panelOpen as SessionObs<boolean>)?.pauseSaving?.(yesNo);
  };

  const commandsGroup = commands.createGroup({
    leftPanelOpen: () => new Promise((resolve) => {
      const watcher = new TransitionWatcher(leftPaneDom);
      watcher.onDispose(() => resolve(undefined));
      left.panelOpen.set(true);
    }),
    rightPanelOpen: () => new Promise((resolve, reject) => {
      if (!right) {
        reject(new Error('PagePanels rightPanelOpen called while right panel is undefined'));
        return;
      }

      const watcher = new TransitionWatcher(rightPaneDom);
      watcher.onDispose(() => resolve(undefined));
      right.panelOpen.set(true);

    }),
  }, null, true);
  let contentWrapper: HTMLElement;
  return cssPageContainer(
    dom.autoDispose(sub1),
    dom.autoDispose(sub2),
    dom.autoDispose(commandsGroup),
    dom.autoDispose(leftOverlap),
    dom('div', page.contentTop, elem => { contentTopDom = elem; }),
    dom.maybe(page.banner, () => {
      let elem: HTMLElement;
      const updateTop = () => {
        const height = mainHeaderDom.getBoundingClientRect().bottom;
        elem.style.top = height + 'px';
      };
      setTimeout(() => watchHeightElem(contentTopDom, updateTop));
      const lis = isScreenResizingObs.addListener(val => val || updateTop());
      return elem = cssBannerContainer(
        page.banner,
        watchHeight(h => bannerHeight.set(h)),
        dom.autoDispose(lis),
      );
    }),
    cssContentMain(
      leftPaneDom = cssLeftPane(
        testId('left-panel'),
        cssOverflowContainer(
          contentWrapper = cssLeftPanelContainer(
            cssLeftPaneHeader(
              left.header,
              dom.style('margin-bottom', use => use(bannerHeight) + 'px')
            ),
            left.content,
          ),
        ),

        // Show plain border when the resize handle is hidden.
        cssResizeDisabledBorder(
          dom.hide((use) => use(left.panelOpen) && !use(leftOverlap)),
          cssHideForNarrowScreen.cls(''),
          testId('left-disabled-resizer'),
        ),

        dom.style('width', (use) => use(left.panelOpen) ? use(left.panelWidth) + 'px' : ''),

        // Opening/closing the left pane, with transitions.
        cssLeftPane.cls('-open', left.panelOpen),
        transition(use => (use(isNarrowScreenObs()) ? false : use(left.panelOpen)), {
          prepare(elem, open) {
            elem.style.width = (open ? 48 : left.panelWidth.get()) + 'px';
          },
          run(elem, open) {
            elem.style.width = contentWrapper.style.width = (open ? left.panelWidth.get() : 48) + 'px';
          },
          finish() {
            onResize();
            contentWrapper.style.width = '';
            onLeftTransitionFinish();
          },
        }),

        // opening left panel on hover
        dom.on('mouseenter', (evt1, elem) => {


          if (left.panelOpen.get()

            // when no opener should not auto-expand
            || left.hideOpener

            // if user is resizing the window, don't expand.
            || isScreenResizingObs.get()) { return; }



          let isMouseInsideLeftPane = true;
          let isFocusInsideLeftPane = false;
          let isMouseDragging = false;

          const owner = new MultiHolder();
          const startExpansion = () => {
            leftOverlap.set(true);
            pauseSavingLeft(true); // prevents from updating state in the window storage
            left.panelOpen.set(true);
            onLeftTransitionFinish = noop;
            watchBlur();
          };
          const startCollapse = () => {
            left.panelOpen.set(false);
            pauseSavingLeft(false);
            // turns overlap off only when the transition finishes
            onLeftTransitionFinish = once(() => leftOverlap.set(false));
            clear();
          };
          const clear = () => {
            if (owner.isDisposed()) { return; }
            clearTimeout(timeoutId);
            owner.dispose();
          };
          dom.onDisposeElem(elem, clear);

          // updates isFocusInsideLeftPane and starts watch for blur on activeElement.
          const watchBlur = debounce(() => {
            if (owner.isDisposed()) { return; }
            isFocusInsideLeftPane = Boolean(leftPaneDom.contains(document.activeElement) ||
              document.activeElement?.closest('.grist-floating-menu'));
            maybeStartCollapse();
            if (document.activeElement) {
              maybePatchDomAndChangeFocus(); // This is to support projects test environment
              watchElementForBlur(document.activeElement, watchBlur);
            }
          }, DELAY_BEFORE_TESTING_FOCUS_CHANGE_MS);

          // starts collapsed only if neither mouse nor focus are inside the left pane. Return true
          // if started collapsed, false otherwise.
          const maybeStartCollapse = () => {
            if (!isMouseInsideLeftPane && !isFocusInsideLeftPane && !isMouseDragging) {
              startCollapse();
            }
          };

          // mouse events
          const onMouseEvt = (evt: MouseEvent) => {
            const rect = leftPaneDom.getBoundingClientRect();
            isMouseInsideLeftPane = evt.clientX <= rect.right;
            isMouseDragging = evt.buttons !== 0;
            maybeStartCollapse();
          };
          owner.autoDispose(dom.onElem(document, 'mousemove', onMouseEvt));
          owner.autoDispose(dom.onElem(document, 'mouseup', onMouseEvt));

          // Enables collapsing when the cursor leaves the window. This comes handy in a split
          // screen setup, especially when Grist is on the right side: moving the cursor back and
          // forth between the 2 windows, the cursor is likely to hover the left pane and expand it
          // inadvertendly. This line collapses it back.
          const onMouseLeave = () => {
            isMouseInsideLeftPane = false;
            maybeStartCollapse();
          };
          owner.autoDispose(dom.onElem(document.body, 'mouseleave', onMouseLeave));

          // schedule start of expansion
          const timeoutId = setTimeout(startExpansion, AUTO_EXPAND_TIMEOUT_MS);
        }),
        cssLeftPane.cls('-overlap', leftOverlap),
        cssLeftPane.cls('-dragging', dragResizer),
      ),

      // Resizer for the left pane.
      // TODO: resizing to small size should collapse. possibly should allow expanding too
      cssResizeFlexVHandle(
        {target: 'left', onSave: (val) => { left.panelWidth.set(val); onResize();
                                            leftPaneDom.style['width'] = val + 'px';
                                            setTimeout(() => dragResizer.set(false), 0); },
         onDrag: (val) => { dragResizer.set(true); }},
        testId('left-resizer'),
        dom.show((use) => use(left.panelOpen) && !use(leftOverlap)),
        cssHideForNarrowScreen.cls('')),

      cssMainPane(
        mainHeaderDom = cssTopHeader(
          testId('top-header'),
          (left.hideOpener ? null :
            cssPanelOpener('PanelRight', cssPanelOpener.cls('-open', left.panelOpen),
              testId('left-opener'),
              dom.on('click', () => toggleObs(left.panelOpen)),
              cssHideForNarrowScreen.cls(''))
          ),

          page.headerMain,

          (!right || right.hideOpener ? null :
            cssPanelOpener('PanelLeft', cssPanelOpener.cls('-open', right.panelOpen),
              testId('right-opener'),
              dom.cls('tour-creator-panel'),
              hoverTooltip(() => (right.panelOpen.get() ? t('Close Creator Panel') : t('Open Creator Panel')),
                {key: 'topBarBtnTooltip'}),
              dom.on('click', () => toggleObs(right.panelOpen)),
              cssHideForNarrowScreen.cls(''))
          ),
          dom.style('margin-bottom', use => use(bannerHeight) + 'px'),
        ),
        page.contentMain,
        cssMainPane.cls('-left-overlap', leftOverlap),
        testId('main-pane'),
      ),
      (right ? [
        // Resizer for the right pane.
        cssResizeFlexVHandle(
          {target: 'right', onSave: (val) => { right.panelWidth.set(val); onResize(); }},
          testId('right-resizer'),
          dom.show(right.panelOpen),
          cssHideForNarrowScreen.cls('')),

        rightPaneDom = cssRightPane(
          testId('right-panel'),
          cssRightPaneHeader(
            right.header,
            dom.style('margin-bottom', use => use(bannerHeight) + 'px')
          ),
          right.content,

          dom.style('width', (use) => use(right.panelOpen) ? use(right.panelWidth) + 'px' : ''),

          // Opening/closing the right pane, with transitions.
          cssRightPane.cls('-open', right.panelOpen),
          transition(use => (use(isNarrowScreenObs()) ? false : use(right.panelOpen)), {
            prepare(elem, open) { elem.style.marginLeft = (open ? -1 : 1) * right.panelWidth.get() + 'px'; },
            run(elem, open) { elem.style.marginLeft = ''; },
            finish: onResize,
          }),
        )] : null
      ),
      cssContentOverlay(
        dom.show((use) => use(left.panelOpen) || Boolean(right && use(right.panelOpen))),
        dom.on('click', () => {
          left.panelOpen.set(false);
          if (right) { right.panelOpen.set(false); }
        }),
        testId('overlay')
      ),
      dom.maybe(isNarrowScreenObs(), () =>
        cssBottomFooter(
          testId('bottom-footer'),
          cssPanelOpenerNarrowScreenBtn(
            cssPanelOpenerNarrowScreen(
              'FieldTextbox',
              dom.on('click', () => {
                right?.panelOpen.set(false);
                toggleObs(left.panelOpen);
              }),
              testId('left-opener-ns')
            ),
            cssPanelOpenerNarrowScreenBtn.cls('-open', left.panelOpen)
          ),
          page.contentBottom,
          (!right ? null :
            cssPanelOpenerNarrowScreenBtn(
              cssPanelOpenerNarrowScreen(
                'Settings',
                dom.on('click', () => {
                  left.panelOpen.set(false);
                  toggleObs(right.panelOpen);
                }),
                testId('right-opener-ns')
              ),
              cssPanelOpenerNarrowScreenBtn.cls('-open', right.panelOpen),
            )
          ),
        )
      ),
    ),
  );
}

function toggleObs(boolObs: Observable<boolean>) {
  boolObs.set(!boolObs.get());
}

const bottomFooterHeightPx = 48;
const cssVBox = styled('div', `
  display: flex;
  flex-direction: column;
`);
const cssHBox = styled('div', `
  display: flex;
`);
const cssPageContainer = styled(cssVBox, `
  position: absolute;
  isolation: isolate; /* Create a new stacking context */
  z-index: 0; /* As of March 2019, isolation does not have Edge support, so force one with z-index */
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  min-width: 600px;
  background-color: ${theme.pageBg};

  @media ${mediaSmall} {
    & {
      padding-bottom: ${bottomFooterHeightPx}px;
      min-width: 240px;
    }
    .interface-singlePage & {
      padding-bottom: 0;
    }
  }
`);
const cssContentMain = styled(cssHBox, `
  flex: 1 1 0px;
  overflow: hidden;
`);
export const cssLeftPane = styled(cssVBox, `
  position: relative;
  background-color: ${theme.leftPanelBg};
  width: 48px;
  margin-right: 0px;
  transition: width 0.4s;
  will-change: width;
  @media ${mediaSmall} {
    & {
      width: 240px;
      position: fixed;
      z-index: 10;
      top: 0;
      bottom: ${bottomFooterHeightPx}px;
      left: -${240 + 15}px; /* adds an extra 15 pixels to also hide the box shadow */
      visibility: hidden;
      box-shadow: 10px 0 5px rgba(0, 0, 0, 0.2);
      transition: left 0.4s, visibility 0.4s;
      will-change: left;
    }
    &-open {
      left: 0;
      visibility: visible;
    }
  }
  &-open {
    width: 240px;
  }
  @media print {
    & {
      display: none;
    }
  }
  .interface-singlePage & {
    display: none;
  }
  &-overlap {
    position: fixed;
    z-index: 10;
    top: 0;
    bottom: 0;
    left: 0;
    min-width: unset;
  }
  &-dragging {
    transition: unset;
    min-width: 160px;
    max-width: 320px;
  }
`);
const cssOverflowContainer = styled(cssVBox, `
  overflow: hidden;
  flex: 1 1 0px;
`);
const cssMainPane = styled(cssVBox, `
  position: relative;
  flex: 1 1 0px;
  min-width: 0px;
  background-color: ${theme.mainPanelBg};
  z-index: 1;
  &-left-overlap {
    margin-left: 48px;
  }
`);
const cssRightPane = styled(cssVBox, `
  position: relative;
  background-color: ${theme.rightPanelBg};
  width: 0px;
  margin-left: 0px;
  overflow: hidden;
  transition: margin-left 0.4s;
  z-index: 0;
  @media ${mediaSmall} {
    & {
      width: 240px;
      position: fixed;
      z-index: 10;
      top: 0;
      bottom: ${bottomFooterHeightPx}px;
      right: -${240 + 15}px; /* adds an extra 15 pixels to also hide the box shadow */
      box-shadow: -10px 0 5px rgba(0, 0, 0, 0.2);
      visibility: hidden;
      transition: right 0.4s, visibility 0.4s;
      will-change: right;
    }
    &-open {
      right: 0;
      visibility: visible;
    }
  }
  &-open {
    width: 240px;
    min-width: 240px;
    max-width: 320px;
  }
  @media print {
    & {
      display: none;
    }
  }
  .interface-singlePage & {
    display: none;
  }
`);
const cssHeader = styled('div', `
  height: 49px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid ${theme.pagePanelsBorder};

  @media print {
    & {
      display: none;
    }
  }

  .interface-singlePage & {
    display: none;
  }
`);
const cssTopHeader = styled(cssHeader, `
  background-color: ${theme.topHeaderBg};
`);
const cssLeftPaneHeader = styled(cssHeader, `
  background-color: ${theme.leftPanelBg};
`);
const cssRightPaneHeader = styled(cssHeader, `
  background-color: ${theme.rightPanelBg};
`);
const cssBottomFooter = styled ('div', `
  height: ${bottomFooterHeightPx}px;
  background-color: ${theme.bottomFooterBg};
  z-index: 20;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  border-top: 1px solid ${theme.pagePanelsBorder};
  @media ${mediaNotSmall} {
    & {
      display: none;
    }
  }
  @media print {
    & {
      display: none;
    }
  }
  .interface-singlePage & {
    display: none;
  }
`);
const cssResizeFlexVHandle = styled(resizeFlexVHandle, `
  --resize-handle-color: ${theme.pagePanelsBorder};
  --resize-handle-highlight: ${theme.pagePanelsBorderResizing};

  @media print {
    & {
      display: none;
    }
  }
`);
const cssResizeDisabledBorder = styled('div', `
  flex: none;
  width: 1px;
  height: 100%;
  background-color: ${theme.pagePanelsBorder};
  position: absolute;
  top: 0;
  bottom: 0;
  right: -1px;
  z-index: 2;
`);
const cssPanelOpener = styled(icon, `
  flex: none;
  width: 32px;
  height: 32px;
  padding: 8px 8px;
  cursor: pointer;
  -webkit-mask-size: 16px 16px;
  background-color: ${theme.controlFg};
  transition: transform 0.4s;
  &:hover { background-color: ${theme.controlHoverFg}; }
  &-open { transform: rotateY(180deg); }
`);
const cssPanelOpenerNarrowScreenBtn = styled('div', `
  width: 32px;
  height: 32px;
  --icon-color: ${theme.sidePanelOpenerFg};
  cursor: pointer;
  border-radius: 4px;
  &-open {
    background-color: ${theme.sidePanelOpenerActiveBg};
    --icon-color: ${theme.sidePanelOpenerActiveFg};
  }
`);
const cssPanelOpenerNarrowScreen = styled(icon, `
  width: 24px;
  height: 24px;
  margin: 4px;
`);
const cssContentOverlay = styled('div', `
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  right: 0;
  background-color: ${theme.pageBackdrop};
  opacity: 0.5;
  display: none;
  z-index: 9;
  @media ${mediaSmall} {
    & {
      display: unset;
    }
  }
`);
const cssLeftPanelContainer = styled('div', `
  flex: 1 1 0px;
  display: flex;
  flex-direction: column;
`);
const cssHiddenInput = styled('input', `
  position: absolute;
  top: -100px;
  left: 0;
  width: 10px;
  height: 10px;
  font-size: 1;
  z-index: -1;
`);
const cssBannerContainer = styled('div', `
  position: absolute;
  z-index: 11;
  width: 100%;
`);
// watchElementForBlur does not work if focus is on body. Which never happens when running in Grist
// because focus is constantly given to the copypasteField. But it does happen when running inside a
// projects test. For that latter case we had a hidden <input> field to the dom and give it focus.
function maybePatchDomAndChangeFocus() {
  if (document.activeElement?.matches('body')) {
    const hiddenInput = cssHiddenInput();
    document.body.appendChild(hiddenInput);
    hiddenInput.focus();
  }
}
// Watch for changes in dom subtree and call callback with element height;
function watchHeight(callback: (height: number) => void): DomElementMethod {
  return elem => watchHeightElem(elem, callback);
}

function watchHeightElem(elem: HTMLElement, callback: (height: number) => void) {
  const onChange = () => callback(elem.getBoundingClientRect().height);
  const observer = new MutationObserver(onChange);
  observer.observe(elem, {childList: true, subtree: true, attributes: true});
  dom.onDisposeElem(elem, () => observer.disconnect());
  onChange();
}
