/**
 * Note that it assumes the presence of cssVars.cssRootVars on <body>.
 */
import {resizeFlexVHandle} from 'app/client/ui/resizeHandle';
import {transition} from 'app/client/ui/transitions';
import {colors, cssHideForNarrowScreen, mediaNotSmall, mediaSmall} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {dom, DomArg, noTestId, Observable, styled, TestId} from "grainjs";

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
  optimizeNarrowScreen?: boolean;  // If true, show an optimized layout when screen is narrow.
  contentBottom?: DomArg;
}

export function pagePanels(page: PageContents) {
  const testId = page.testId || noTestId;
  const left = page.leftPanel;
  const right = page.rightPanel;
  const onResize = page.onResize || (() => null);
  const optimizeNarrowScreen = Boolean(page.optimizeNarrowScreen);

  return [cssPageContainer(
    cssPageContainer.cls('-optimizeNarrowScreen', optimizeNarrowScreen),
    cssLeftPane(
      testId('left-panel'),
      cssTopHeader(left.header),
      left.content,

      dom.style('width', (use) => use(left.panelOpen) ? use(left.panelWidth) + 'px' : ''),

      // Opening/closing the left pane, with transitions.
      cssLeftPane.cls('-open', left.panelOpen),
      transition(left.panelOpen, {
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
      cssHideForNarrowScreen.cls('', optimizeNarrowScreen)),

    // Show plain border when the resize handle is hidden.
    cssResizeDisabledBorder(
      dom.hide(left.panelOpen),
      cssHideForNarrowScreen.cls('', optimizeNarrowScreen)),

    cssMainPane(
      cssTopHeader(
        testId('top-header'),
        (left.hideOpener ? null :
          cssPanelOpener('PanelRight', cssPanelOpener.cls('-open', left.panelOpen),
            testId('left-opener'),
            dom.on('click', () => toggleObs(left.panelOpen)),
            cssHideForNarrowScreen.cls('', optimizeNarrowScreen))
        ),

        page.headerMain,

        (!right || right.hideOpener ? null :
          cssPanelOpener('PanelLeft', cssPanelOpener.cls('-open', right.panelOpen),
            testId('right-opener'),
            dom.on('click', () => toggleObs(right.panelOpen)),
            cssHideForNarrowScreen.cls('', optimizeNarrowScreen))
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
        cssHideForNarrowScreen.cls('', optimizeNarrowScreen)),

      cssRightPane(
        testId('right-panel'),
        cssTopHeader(right.header),
        right.content,

        dom.style('width', (use) => use(right.panelOpen) ? use(right.panelWidth) + 'px' : ''),

        // Opening/closing the right pane, with transitions.
        cssRightPane.cls('-open', right.panelOpen),
        transition(right.panelOpen, {
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
  ), (
    !optimizeNarrowScreen ? null :
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
  )];
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
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  min-width: 600px;
  background-color: ${colors.lightGrey};

  @media ${mediaSmall} {
    &-optimizeNarrowScreen {
      bottom: 48px;
      min-width: 240px;
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
    .${cssPageContainer.className}-optimizeNarrowScreen & {
      width: 0px;
      position: absolute;
      z-index: 10;
      top: 0;
      bottom: 0;
      left: 0;
      box-shadow: 10px 0 5px rgba(0, 0, 0, 0.2);
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
    .${cssPageContainer.className}-optimizeNarrowScreen & {
      position: absolute;
      z-index: 10;
      top: 0;
      bottom: 0;
      right: 0;
      box-shadow: -10px 0 5px rgba(0, 0, 0, 0.2);
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
    .${cssPageContainer.className}-optimizeNarrowScreen & {
      display: unset;
    }
  }
`);
