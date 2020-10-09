/**
 * Note that it assumes the presence of cssVars.cssRootVars on <body>.
 */
import {resizeFlexVHandle} from 'app/client/ui/resizeHandle';
import {transition} from 'app/client/ui/transitions';
import {colors} from 'app/client/ui2018/cssVars';
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
}

export function pagePanels(page: PageContents) {
  const testId = page.testId || noTestId;
  const left = page.leftPanel;
  const right = page.rightPanel;
  const onResize = page.onResize || (() => null);

  return cssPageContainer(
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
      dom.show(left.panelOpen)),

    // Show plain border when the resize handle is hidden.
    cssResizeDisabledBorder(dom.hide(left.panelOpen)),

    cssMainPane(
      cssTopHeader(
        testId('top-header'),
        (left.hideOpener ? null :
          cssPanelOpener('PanelRight', cssPanelOpener.cls('-open', left.panelOpen),
            testId('left-opener'),
            dom.on('click', () => toggleObs(left.panelOpen)))
        ),

        page.headerMain,

        (!right || right.hideOpener ? null :
          cssPanelOpener('PanelLeft', cssPanelOpener.cls('-open', right.panelOpen),
            testId('right-opener'),
            dom.on('click', () => toggleObs(right.panelOpen)))
        ),
      ),
      page.contentMain,
    ),
    (right ? [
      // Resizer for the right pane.
      cssResizeFlexVHandle(
        {target: 'right', onSave: (val) => { right.panelWidth.set(val); onResize(); }},
        testId('right-resizer'),
        dom.show(right.panelOpen)),

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
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  min-width: 600px;
  background-color: ${colors.lightGrey};
`);
export const cssLeftPane = styled(cssVBox, `
  position: relative;
  background-color: ${colors.lightGrey};
  width: 48px;
  margin-right: 0px;
  overflow: hidden;
  transition: margin-right 0.4s;
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
