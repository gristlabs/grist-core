/**
 * Note that it assumes the presence of cssVars.cssRootVars on <body>.
 */
import {urlState} from "app/client/models/gristUrlState";
import {resizeFlexVHandle} from 'app/client/ui/resizeHandle';
import {transition} from 'app/client/ui/transitions';
import {colors, cssHideForNarrowScreen, mediaNotSmall, mediaSmall} from 'app/client/ui2018/cssVars';
import {isNarrowScreenObs} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {dom, DomArg, noTestId, Observable, styled, subscribe, TestId} from "grainjs";

export interface PageSidePanel {
  // Note that widths need to start out with a correct default in JS (having them in CSS is not
  // enough), needed for open/close transitions.
  panelWidth: Observable<number>;
  panelOpen: Observable<boolean>;
  hideOpener?: boolean;           // If true, don't show the opener handle.
  header: DomArg;
  content: DomArg;
}

export interface PageContents {
  leftPanel: PageSidePanel;
  rightPanel?: PageSidePanel;     // If omitted, the right panel isn't shown at all.

  headerMain: DomArg;
  contentMain: DomArg;

  onResize?: () => void;          // Callback for when either pane is opened, closed, or resized.
  testId?: TestId;
  contentBottom?: DomArg;
}

export function pagePanels(page: PageContents) {
  const testId = page.testId || noTestId;
  const left = page.leftPanel;
  const right = page.rightPanel;
  const onResize = page.onResize || (() => null);

  let lastLeftOpen = left.panelOpen.get();
  let lastRightOpen = right?.panelOpen.get() || false;

  // When switching to mobile mode, close panels; when switching to desktop, restore the
  // last desktop state.
  const sub1 = subscribe(isNarrowScreenObs(), (use, narrow) => {
    if (narrow) {
      lastLeftOpen = left.panelOpen.get();
      lastRightOpen = right?.panelOpen.get() || false;
    }
    left.panelOpen.set(narrow ? false : lastLeftOpen);
    right?.panelOpen.set(narrow ? false : lastRightOpen);
  });

  // When url changes, we must have navigated; close the left panel since if it were open, it was
  // the likely cause of the navigation (e.g. switch to another page or workspace).
  const sub2 = subscribe(isNarrowScreenObs(), urlState().state, (use, narrow, state) => {
    if (narrow) {
      left.panelOpen.set(false);
    }
  });

  return cssPageContainer(
    dom.autoDispose(sub1),
    dom.autoDispose(sub2),
    cssLeftPane(
      testId('left-panel'),
      cssTopHeader(left.header),
      left.content,

      dom.style('width', (use) => use(left.panelOpen) ? use(left.panelWidth) + 'px' : ''),

      // Opening/closing the left pane, with transitions.
      cssLeftPane.cls('-open', left.panelOpen),
      transition(use => (use(isNarrowScreenObs()) ? false : use(left.panelOpen)), {
        prepare(elem, open) { elem.style.marginRight = (open ? -1 : 1) * (left.panelWidth.get() - 48) + 'px'; },
        run(elem, open) { elem.style.marginRight = ''; },
        finish: onResize,
      }),
    ),

    // Resizer for the left pane.
    // TODO: resizing to small size should collapse. possibly should allow expanding too
    cssResizeFlexVHandle(
      {target: 'left', onSave: (val) => { left.panelWidth.set(val); onResize(); }},
      testId('left-resizer'),
      dom.show(left.panelOpen),
      cssHideForNarrowScreen.cls('')),

    // Show plain border when the resize handle is hidden.
    cssResizeDisabledBorder(
      dom.hide(left.panelOpen),
      cssHideForNarrowScreen.cls('')),

    cssMainPane(
      cssTopHeader(
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
            dom.on('click', () => toggleObs(right.panelOpen)),
            cssHideForNarrowScreen.cls(''))
        ),
      ),
      page.contentMain,
      testId('main-pane'),
    ),
    (right ? [
      // Resizer for the right pane.
      cssResizeFlexVHandle(
        {target: 'right', onSave: (val) => { right.panelWidth.set(val); onResize(); }},
        testId('right-resizer'),
        dom.show(right.panelOpen),
        cssHideForNarrowScreen.cls('')),

      cssRightPane(
        testId('right-panel'),
        cssTopHeader(right.header),
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
  );
}

function toggleObs(boolObs: Observable<boolean>) {
  boolObs.set(!boolObs.get());
}

const cssVBox = styled('div', `
  display: flex;
  flex-direction: column;
`);
const cssHBox = styled('div', `
  display: flex;
`);
const cssPageContainer = styled(cssHBox, `
  position: absolute;
  isolation: isolate; /* Create a new stacking context */
  z-index: 0; /* As of March 2019, isolation does not have Edge support, so force one with z-index */
  overflow: hidden;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  min-width: 600px;
  background-color: ${colors.lightGrey};

  @media ${mediaSmall} {
    & {
      padding-bottom: 48px;
      min-width: 240px;
    }
    .interface-light & {
      padding-bottom: 0;
    }
  }
`);

export const cssLeftPane = styled(cssVBox, `
  position: relative;
  background-color: ${colors.lightGrey};
  width: 48px;
  margin-right: 0px;
  overflow: hidden;
  transition: margin-right 0.4s;
  @media ${mediaSmall} {
    & {
      width: 240px;
      position: fixed;
      z-index: 10;
      top: 0;
      bottom: 0;
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
    min-width: 160px;
    max-width: 320px;
  }
  @media print {
    & {
      display: none;
    }
  }
  .interface-light & {
    display: none;
  }
`);
const cssMainPane = styled(cssVBox, `
  position: relative;
  flex: 1 1 0px;
  min-width: 0px;
  background-color: white;
  z-index: 1;
`);
const cssRightPane = styled(cssVBox, `
  position: relative;
  background-color: ${colors.lightGrey};
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
      bottom: 0;
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
  .interface-light & {
    display: none;
  }
`);
const cssTopHeader = styled('div', `
  height: 48px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid ${colors.mediumGrey};

  @media print {
    & {
      display: none;
    }
  }

  .interface-light & {
    display: none;
  }
`);
const cssBottomFooter = styled ('div', `
  height: 48px;
  background-color: white;
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
  border-top: 1px solid ${colors.mediumGrey};
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
  .interface-light & {
    display: none;
  }
`);
const cssResizeFlexVHandle = styled(resizeFlexVHandle, `
  --resize-handle-color: ${colors.mediumGrey};
  --resize-handle-highlight: ${colors.lightGreen};

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
  background-color: ${colors.mediumGrey};
`);
const cssPanelOpener = styled(icon, `
  flex: none;
  width: 32px;
  height: 32px;
  padding: 8px 8px;
  cursor: pointer;
  -webkit-mask-size: 16px 16px;
  background-color: ${colors.lightGreen};
  transition: transform 0.4s;
  &:hover { background-color: ${colors.darkGreen}; }
  &-open { transform: rotateY(180deg); }
`);
const cssPanelOpenerNarrowScreenBtn = styled('div', `
  width: 32px;
  height: 32px;
  --icon-color: ${colors.slate};
  cursor: pointer;
  border-radius: 4px;
  &-open {
    background-color: ${colors.lightGreen};
    --icon-color: white;
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
  background-color: grey;
  opacity: 0.5;
  display: none;
  z-index: 9;
  @media ${mediaSmall} {
    & {
      display: unset;
    }
  }
`);
