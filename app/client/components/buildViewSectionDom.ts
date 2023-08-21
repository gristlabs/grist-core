import BaseView from 'app/client/components/BaseView';
import {allCommands} from "app/client/components/commands";
import {GristDoc} from 'app/client/components/GristDoc';
import {makeT} from 'app/client/lib/localization';
import {ViewRec, ViewSectionRec} from 'app/client/models/DocModel';
import {filterBar} from 'app/client/ui/FilterBar';
import {cssIcon} from 'app/client/ui/RightPanelStyles';
import {makeCollapsedLayoutMenu} from 'app/client/ui/ViewLayoutMenu';
import {cssDotsIconWrapper, cssMenu, viewSectionMenu} from 'app/client/ui/ViewSectionMenu';
import {buildWidgetTitle} from 'app/client/ui/WidgetTitle';
import {isNarrowScreenObs, mediaSmall, testId, theme} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {menu} from 'app/client/ui2018/menus';
import {getWidgetTypes} from "app/client/ui/widgetTypesMap";
import {Computed, dom, DomElementArg, Observable, styled} from 'grainjs';
import {defaultMenuOptions} from 'popweasel';
import {EmptyFilterState} from "./LinkingState";

const t = makeT('ViewSection');

export function buildCollapsedSectionDom(options: {
  gristDoc: GristDoc,
  sectionRowId: number|string,
}, ...domArgs: DomElementArg[]) {
  const {gristDoc, sectionRowId} = options;
  if (typeof sectionRowId === 'string') {
    return cssMiniSection(
      dom('span.viewsection_title_font',
        'Empty'
      )
    );
  }
  const vs: ViewSectionRec = gristDoc.docModel.viewSections.getRowModel(sectionRowId);
  const typeComputed = Computed.create(null, use => getWidgetTypes(use(vs.parentKey) as any).icon);
  return cssMiniSection(
    testId(`collapsed-section-${sectionRowId}`),
    testId(`collapsed-section`),
    cssDragHandle(
      dom.domComputed(typeComputed, (type) => icon(type)),
      dom('div', {style: 'margin-right: 16px;'}),
      dom.maybe((use) => use(use(vs.table).summarySourceTable), () => cssSigmaIcon('Pivot', testId('sigma'))),
      dom('span.viewsection_title_font', testId('collapsed-section-title'),
        dom.text(vs.titleDef),
      ),
    ),
    cssMenu(
      testId('section-menu-viewLayout'),
      cssDotsIconWrapper(cssIcon('Dots')),
      menu(_ctl => makeCollapsedLayoutMenu(vs, gristDoc), {
        ...defaultMenuOptions,
        placement: 'bottom-end',
      })
    ),
    ...domArgs
  );
}


function buildLinkStateIndicatorDom(options: {
  gristDoc: GristDoc,
  sectionRowId: number,
}, ...domArgs: DomElementArg[]) {
  const {gristDoc, sectionRowId} = options;
  const tgtSec = gristDoc.docModel.viewSections.getRowModel(sectionRowId);

  return dom.domComputed((use) => {
    //makes an observable for the passed-in section
    const lstate = use(tgtSec.linkingState);
    if(lstate == null) { return null; }

    // Default to empty for ease of coding, will be set in cases where it's relevant
    const lfilter = lstate.filterState ? use(lstate.filterState): EmptyFilterState;

    // crunch filterVals into compact string for display in bubble (not tooltip),
    // eg "USA", "USA;2022", "(USA +3 others)"
    // only for filter linking and summary-filter-linking

    //filters is a map {column: [vals...]}
    //  if multiple filters, join each with ";"
    //   each filter can have multiple vals (if reflist), show as "(SomeValue +3 others)",

    const filterValsShortLabel = Object.keys(lfilter.filterLabels).map(colId => {
      const vals = lfilter.filterLabels[colId];
      //selector can be an empty reflist (filterLabels[colId] = [])
      if(vals.length == 0)
      { return '- blank -'; }

      // Even if vals != [], selector might be a null/empty cell value.
      //  - if a null reference: filter[colId] = [0], but filterLabels would be ['']
      //  - if an empty string/choice filter = [''], label = ['']
      //  - if an empty number/date/etc: filter[colId] = [null], but filterLabel will be ['']
      //Note: numeric 0 won't become blank, since filterLabel will be "0", which is truthy
      const dispVal = vals[0] || '- blank -';

      //If 2 or more vals, abbreviate it
      return vals.length <= 1 ? dispVal: `(${dispVal} +${vals.length - 1} others)`;
      //TODO: could show multiple vals if short, and/or let css overflow ellipsis handle it?
    }).join("; ");

    let bubbleContent: DomElementArg[];
    switch (use(lstate.linkTypeDescription)) {
      case "Filter:Summary-Group":
      case "Filter:Col->Col":
      case "Filter:Row->Col":
      case "Summary":
        bubbleContent = [
          dom("div", dom.style('width', '2px'), dom.style('display', 'inline-block')), //spacer for text
          filterValsShortLabel,
        ];
        break;
      case "Show-Referenced-Records":
        bubbleContent = [];
        break;
      case "Cursor:Same-Table":
      case "Cursor:Reference":
        bubbleContent = [];
        break;
      case "Error:Invalid":
      default:
        bubbleContent = ["Error"];
        break;
    }

    return linkStateBubble(
        customIcon(dom.style("background-color", theme.filterBarButtonSavedFg + "")),
        bubbleContent,
        dom.on("click", () => allCommands.dataSelectionTabOpen.run()),
        ...domArgs,
    );

  });

}

// eslint-disable-next-line
const tempIconSVGString= `url('data:image/svg+xml;utf8,<svg width="16px" height="16px" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"> <ellipse style="stroke: rgb(0, 0, 0);" cx="2.426" cy="13.913" rx="1.361" ry="1.361"/> <ellipse style="stroke: rgb(0, 0, 0);" cx="13.827" cy="3.039" rx="1.222" ry="1.222"/> <path style="stroke: rgb(0, 0, 0); fill: none;" d="M 2.396 12.802 C 2.363 7.985 6.014 2.893 11.895 3.027"/> <path style="stroke: rgb(0, 0, 0); fill: none;" d="M 8.49 1.047 L 12.265 2.871 L 8.986 5.874"/> </svg>')`;

//TODO JV TEMP: Shamelessly copied from icon.ts
const customIcon = styled('div', `
  -webkit-mask-image: ${tempIconSVGString};
  position: relative;
  display: inline-block;
  vertical-align: middle;
  -webkit-mask-repeat: no-repeat;
  -webkit-mask-position: center;
  -webkit-mask-size: contain;
  width: 16px;
  height: 16px;
  background-color: var(--icon-color, var(--grist-theme-text, black));

`);

const linkStateBubble = styled('div', `
  cursor: pointer;
  overflow: hidden;
  border-radius: 3px;
  padding: 3px;
  text-overflow: ellipsis;
  align-self: start;
  height: 21px;
  margin-top: -4px;
  margin-left: 4px;
  color: ${theme.filterBarButtonSavedFg};
  background-color: ${theme.filterBarButtonSavedBg};
  &:hover {
    background-color: ${theme.filterBarButtonSavedHoverBg};
  }
`);


export function buildViewSectionDom(options: {
  gristDoc: GristDoc,
  sectionRowId: number,
  isResizing?: Observable<boolean>
  viewModel?: ViewRec,
  // Should show drag anchor.
  draggable?: boolean, /* defaults to true */
  // Should show green bar on the left (but preserves active-section class).
  focusable?: boolean, /* defaults to true */
  tableNameHidden?: boolean,
  widgetNameHidden?: boolean,
}) {
  const isResizing = options.isResizing ?? Observable.create(null, false);
  const {gristDoc, sectionRowId, viewModel, draggable = true, focusable = true} = options;

  // Creating normal section dom
  const vs: ViewSectionRec = gristDoc.docModel.viewSections.getRowModel(sectionRowId);
  const selectedBySectionTitle = Computed.create(null, (use) => {
    if (!use(vs.linkSrcSectionRef)) { return null; }
    return use(use(vs.linkSrcSection).titleDef);
  });
  return dom('div.view_leaf.viewsection_content.flexvbox.flexauto',
    testId(`viewlayout-section-${sectionRowId}`),
    dom.autoDispose(selectedBySectionTitle),
    !options.isResizing ? dom.autoDispose(isResizing) : null,
    cssViewLeaf.cls(''),
    cssViewLeafInactive.cls('', (use) => !vs.isDisposed() && !use(vs.hasFocus)),
    dom.cls('active_section', vs.hasFocus),
    dom.cls('active_section--no-indicator', !focusable),
    dom.maybe<BaseView|null>((use) => use(vs.viewInstance), (viewInstance) => dom('div.viewsection_title.flexhbox',
      cssDragIcon('DragDrop',
        dom.cls("viewsection_drag_indicator"),
        // Makes element grabbable only if grist is not readonly.
        dom.cls('layout_grabbable', (use) => !use(gristDoc.isReadonlyKo)),
        !draggable ? dom.style("visibility", "hidden") : null
      ),
      dom.maybe((use) => use(use(viewInstance.viewSection.table).summarySourceTable), () =>
        cssSigmaIcon('Pivot', testId('sigma'))),
      buildWidgetTitle(vs, options, testId('viewsection-title'), cssTestClick(testId("viewsection-blank"))),
      dom.maybe((use) => use(vs.linkSrcSectionRef) != 0, () =>
          buildLinkStateIndicatorDom({gristDoc, sectionRowId}, testId("viewsection-linkstate"))),
      dom("div", dom.style("flex", "1 0 0px")), //spacer, 0 size by default, grows to take up remaining space
      viewInstance.buildTitleControls(),
      dom('div.viewsection_buttons',
        dom.create(viewSectionMenu, gristDoc, vs)
      )
     )),
    dom.create(filterBar, gristDoc, vs),
    dom.maybe<BaseView|null>(vs.viewInstance, (viewInstance) => [
      dom('div.view_data_pane_container.flexvbox',
        cssResizing.cls('', isResizing),
        dom.maybe(viewInstance.disableEditing, () =>
          dom('div.disable_viewpane.flexvbox',
            dom.domComputed(selectedBySectionTitle, (title) => title
              ? t(`No row selected in {{title}}`, {title})
              : t('No data')),
          )
        ),
        dom.maybe(viewInstance.isTruncated, () =>
          dom('div.viewsection_truncated', t('Not all data is shown'))
        ),
        dom.cls((use) => 'viewsection_type_' + use(vs.parentKey)),
        viewInstance.viewPane
      ),
      dom.maybe(use => !use(isNarrowScreenObs()), () => viewInstance.selectionSummary?.buildDom()),
    ]),
    dom.on('mousedown', () => { viewModel?.activeSectionId(sectionRowId); }),
  );
}

// With new widgetPopup it is hard to click on viewSection without a activating it, hence we
// add a little blank space to use in test.
const cssTestClick = styled(`div`, `
  min-width: 2px;
`);

const cssSigmaIcon = styled(icon, `
  margin-right: 5px;
  background-color: ${theme.lightText}
`);

const cssViewLeaf = styled('div', `
  @media ${mediaSmall} {
    & {
      margin: 4px;
    }
  }
`);

const cssViewLeafInactive = styled('div', `
  @media screen and ${mediaSmall} {
    & {
      overflow: hidden;
      background: repeating-linear-gradient(
        -45deg,
        ${theme.widgetInactiveStripesDark},
        ${theme.widgetInactiveStripesDark} 10px,
        ${theme.widgetInactiveStripesLight} 10px,
        ${theme.widgetInactiveStripesLight} 20px
      );
      border: 1px solid ${theme.widgetBorder};
      border-radius: 4px;
      padding: 0 2px;
    }
    &::after {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
    }
    &.layout_vbox {
      max-width: 32px;
    }
    &.layout_hbox {
      max-height: 32px;
    }
    & > .viewsection_title.flexhbox {
      position: absolute;
    }
    & > .view_data_pane_container,
    & .viewsection_buttons,
    & .grist-single-record__menu,
    & > .filter_bar {
      display: none;
    }
  }
`);


// z-index ensure it's above the resizer line, since it's hard to grab otherwise
const cssDragIcon = styled(icon, `
  visibility: hidden;
  --icon-color: ${theme.lightText};
  z-index: 100;

  .viewsection_title:hover &.layout_grabbable {
    visibility: visible;
  }
`);

// This class is added while sections are being resized (or otherwise edited), to ensure that the
// content of the section (such as an iframe) doesn't interfere with mouse drag-related events.
// (It assumes that contained elements do not set pointer-events to another value; if that were
// important then we'd need to use an overlay element during dragging.)
const cssResizing = styled('div', `
  pointer-events: none;
`);

const cssMiniSection = styled('div.mini_section_container', `
  --icon-color: ${theme.accentIcon};
  display: flex;
  align-items: center;
  padding-right: 8px;
`);

const cssDragHandle = styled('div.draggable-handle', `
  display: flex;
  padding: 8px;
  flex: 1;
  padding-right: 16px;
`);
