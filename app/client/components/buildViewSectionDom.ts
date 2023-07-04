import BaseView from 'app/client/components/BaseView';
import {GristDoc} from 'app/client/components/GristDoc';
import {ViewFieldRec, ViewRec, ViewSectionRec} from 'app/client/models/DocModel';
import {filterBar} from 'app/client/ui/FilterBar';
import {cssIcon} from 'app/client/ui/RightPanelStyles';
import {makeCollapsedLayoutMenu} from 'app/client/ui/ViewLayoutMenu';
import {cssDotsIconWrapper, cssMenu, viewSectionMenu} from 'app/client/ui/ViewSectionMenu';
import {buildWidgetTitle} from 'app/client/ui/WidgetTitle';
import {getWidgetTypes} from 'app/client/ui/widgetTypes';
import {colors, isNarrowScreenObs, mediaSmall, testId, theme, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {menu} from 'app/client/ui2018/menus';
import {Computed, dom, DomElementArg, Observable, styled} from 'grainjs';
import {defaultMenuOptions} from 'popweasel';
import assert from 'assert';
import {isFullReferencingType} from "../../common/gristTypes";
import {ReferenceUtils} from "../lib/ReferenceUtils";
import {IconName} from "../ui2018/IconList";
import {isSummaryTable} from "../../common/isHiddenTable";
import {isSummaryOf} from "./LinkingState";
import {
    descriptionInfoTooltip,
    IHoverTipOptions,
    ITipOptions,
    ITooltipContent,
    setClickTooltip,
    setHoverTooltip
} from "../ui/tooltips";
import {MEMBER} from "../../common/roles";


// some unicode characters
const BLACK_CIRCLE = '\u2022';
const SIGMA = '\u03a3';
const NBSP = '\u0020'; //blank space, &nbsp; gets escaped out
const ELEMENTOF = '\u2208'; //220A for small elementof

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
        const lstate = use(tgtSec.linkingState)
        if(lstate == null) {
            return null;
        }
        //assert(lstate != null, "LinkStateIndicator should only be constructed for sections with incoming links");

        const srcSec = use(tgtSec.linkSrcSection); //might be the empty section
        const srcColId = use(use(tgtSec.linkSrcCol).colId); // might be the empty column
        const tgtColId = use(use(tgtSec.linkTargetCol).colId);
        //can use .getRowId(), 0 means empty
        //can do use(srcCol.colId) == undefined for empty


        // ========== Old debug description: just list out the stuff=================
        const lfilter = use(tgtSec.linkingFilter)


        // Pretty print filter info
        let filterValsFormatted: {[colId:string]:any[]} = {};
        let filterTypes: {[colId:string]:string} = {};
        const defaultRefFormat = (rowId: number|string, refTableId:string) => `${refTableId}[${rowId}]`;

        try{
            //filters is a map {column: [vals...]}
            if(lfilter != null) {
                for (let colId in lfilter.filters) {
                    const rawVals = lfilter.filters[colId];
                    let fmtVals: string[];

                    if (colId == "id") {
                        fmtVals = rawVals.map(rv => defaultRefFormat(rv, use(tgtSec.tableId)));

                        filterTypes[colId] = "id";
                    } else { // Not ID, can lookup field
                        const fields: ViewFieldRec[] = use(use(tgtSec.viewFields)).filter((field: ViewFieldRec) => use(field.colId) == colId);
                        if(fields.length != 1) {
                            console.warn("Should have exactly 1 field matching colId '" + colId + "': " + JSON.stringify(fields));
                            continue;
                        }
                        const field = fields[0];
                        //TODO: bug? how to correctly use() koArray
                        //TODO: is there a better way to get field by colId?

                        const col = use(field.column);
                        const type = use(col.type);
                        const vColFormatter = use(field.visibleColFormatter);
                        const formatter = use(field.formatter);
                        //fmtVals = rawVals.map(rv => vColFormatter.formatAny(rv));

                        filterTypes[colId] = type;

                        //Format each of the values
                        let formatFunc: (a:any) => string;
                        if (isFullReferencingType(type)) {
                            const RU = new ReferenceUtils(field!, gristDoc.docData); //TODO: disposal?
                            if(!RU.tableData.isLoaded) {
                              formatFunc = (rv) => `${use(use(use(field.column).refTable)!.tableId)}[${rv}] (NL)`;
                            } else {
                              formatFunc = (rv) => `${RU.idToText(rv)}`;
                            }
                        } else { // //normal vals just get formatted (needed for dates and currencies and things)
                            formatFunc = (rv) => formatter.formatAny(rv)
                        }

                        fmtVals = rawVals.map(rv => (rv == null || isFullReferencingType(type) && rv == 0) ? "" : formatFunc(rv)); //show blanks if empty value
                    }


                    filterValsFormatted[colId] = fmtVals;

                    //if
                }
            }

        } catch (e) {
            filterValsFormatted = {};
            console.warn("Error in creating linkstate tooltip:\n" + e.toString())
        }


        // crunch filterVals into compact string for display in bubble (not tooltip),
        // eg "USA", "USA;2022", "(USA +3 others)"
        // only for filter linking and summary-filter-linking

        //filters is a map {column: [vals...]}
        //  if multiple filters, join each with ";"
        //    each filter can have multiple vals (if reflist), show as "(SomeValue +3 others)",
        const filterValsShortLabel: string[] = Object.keys(filterValsFormatted).map(colId => {
            const vals = filterValsFormatted[colId]
            const dispVal = vals[0] || '- blank -';
            return vals.length == 1 ? dispVal: `(${dispVal} +${vals.length - 1} others)`;
        }).join("; ");

        //oops wait we don't handle cursor linking here, let's just blank it out
        //if(lfilter.filters.hasOwnProperty("id")) {
        //    filterValsLabel = "";
        //}

        //Figure out link type:
        const srcTable = use(srcSec.table);
        const tgtTable = use(tgtSec.table);
        let bubbleContent:DomElementArg[] = ["Linkstate (ERROR: UNSET)"];
        let toolTipContent:DomElementArg[] = ["Link State Tooltip (ERROR: UNSET)"];
        const toolTipOptions:IHoverTipOptions = { key: "linkstate-bubble", openOnClick: true, placement:"bottom",};


        const srcSecTitle = use(srcSec.titleDef);
        let srcStringWithColumn = srcSecTitle;
        if(srcColId) {
            srcStringWithColumn += ` ${BLACK_CIRCLE} ${use(use(tgtSec.linkSrcCol).label)}`;
        }

        let numFilters = Object.keys(filterValsFormatted).length - (filterValsFormatted.hasOwnProperty("id") ? 1 : 0);
        let filtersTable = dom("table",
            dom.style("margin-left","8px"),
            Object.keys(filterValsFormatted).map(
                (colId) => {
                    const vals = filterValsFormatted[colId];
                    let operationSymbol = "=";
                    //if filter (reflist) <- ref, op="intersects", symbol = "??"
                    //if filter (ref) <- reflist, op="in", vals.length>1
                    if (lfilter.operations[colId] == "intersects") { operationSymbol = ":"; } //TODO temp, find intersect symbol? ?contains?
                    else if (vals.length > 1) { operationSymbol = ELEMENTOF;}

                    if(colId == "id") {
                        return dom("div", `ERROR: ID FILTER: ${colId}[${vals}]`)
                    } else {
                        return dom("tr",
                            dom("td", cssLinkstateFilterIconInline("FilterSimple"),
                                `${colId}`),
                            dom("td", operationSymbol, dom.style('padding', '0 2px 0 2px')), //add some spacing around the =
                            dom("td",
                              isFullReferencingType(filterTypes[colId]) ? cssLinkstateFilterIconInline("FieldReference"): null,
                              `${vals}`),
                        )
                    }
            })
        )



        if(!srcColId && !tgtColId && !isSummaryOf(srcTable, tgtTable) ) { // === Cursor Linking (same-record)
            bubbleContent = [ cssLinkstateFilterIcon("FieldSpinner")] //TODO need better icon for cursor linking

            toolTipContent = [`Cursor Linked from "${srcStringWithColumn}"`];

        } else if (srcColId && !tgtColId) { // === Ref-Lookup Linking
            //(window as any).JV.tmp=filterValsFormatted;
          const displayValues = filterValsFormatted["id"];
          const numRecords = displayValues ? displayValues.length : 0;
          //console.log("!!! DEBUG: ", displayValues);//TODO JV TEMP
          //These might be ref display vals like ["USA", ...], or if not they might be like ["Countries[1]", ...]
          //if they're

          bubbleContent = [cssLinkstateFilterIcon("FieldReference")];
          toolTipContent = [
                cssLinkTooltipRow(`Showing Referenced Record${numRecords > 1?"s":""}:`),
                cssLinkTooltipRow(dom.style('border','1px solid white'), dom.style('padding', '2px 4px 2px 4px'), dom.style('align-self','center'),
                  cssLinkstateFilterIconInline("FieldReference"),
                  `${filterValsFormatted["id"]}`),
                cssLinkTooltipRow(`from "${srcStringWithColumn}"`)];

        } else if(tgtColId) { // === Standard Filter Linking (row->col || col->col)
            bubbleContent = [
              dom("div",dom.style('width', '2px'), dom.style('display','inline-block')), //spacer for text
              filterValsShortLabel,
            ];
            toolTipContent = [
                cssLinkTooltipRow(`Linked Filter${numFilters>1?"s":""}:`),
                filtersTable,
                cssLinkTooltipRow(`from "${srcStringWithColumn}"`)
            ];

        } else if(!srcColId && !tgtColId && isSummaryOf(srcTable, tgtTable)) { // === Filter Linking (from a summary table)
            bubbleContent = [
              //cssLinkstateFilterIcon("PivotLight", dom.style('margin','0 6px 0 2px')),
              dom("div",dom.style('width', '2px'), dom.style('display','inline-block')), //spacer for text
              filterValsShortLabel,
            ];
            toolTipContent = [
                cssLinkTooltipRow(`Linked Filter${numFilters>1?"s":""}:`),
                filtersTable,
                cssLinkTooltipRow([`from `, cssLinkstateFilterIcon("PivotLight", dom.style('margin','0 4px 0 2px')), `${srcStringWithColumn}"`]),
            ];
        }
        //TODO: these cases are hacked together, need to do them properly
        //TODO: now they aren't used at all because we just use a single icon anyway!


        //Div wrapping dom?
        let toolTipDom = cssLinkTooltip(...toolTipContent)

        return [
            linkStateBubble(
                customIcon(
                    dom.style("background-color", theme.filterBarButtonSavedFg + ""), //TODO: make this a for-realsies icon
                    //dom.style("margin-right", bubbleContent.length ? "4px" : "0")), //text bunches up too tight, but if empty then no margin so bubble stays square
                ),
                bubbleContent,
                (elem) => setHoverTooltip(elem, toolTipDom, toolTipOptions),
                dom.onDispose(() => dom.domDispose(toolTipDom)),
                ...domArgs,
            ),

        ];

    })

}



const tempIconSVGString= `url('data:image/svg+xml;utf8,<svg width="16px" height="16px" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"> <ellipse style="stroke: rgb(0, 0, 0);" cx="2.426" cy="13.913" rx="1.361" ry="1.361"/> <ellipse style="stroke: rgb(0, 0, 0);" cx="13.827" cy="3.039" rx="1.222" ry="1.222"/> <path style="stroke: rgb(0, 0, 0); fill: none;" d="M 2.396 12.802 C 2.363 7.985 6.014 2.893 11.895 3.027"/> <path style="stroke: rgb(0, 0, 0); fill: none;" d="M 8.49 1.047 L 12.265 2.871 L 8.986 5.874"/> </svg>')`;

//TODO JV TEMP: Shamelessly copied from icon.ts
const customIcon = styled('div',`
  mask-image: ${tempIconSVGString};
  position: relative;
  display: inline-block;
  vertical-align: middle;
  -webkit-mask-repeat: no-repeat;
  -webkit-mask-position: center;
  -webkit-mask-size: contain;
  width: 16px;
  height: 16px;
  background-color: var(--icon-color, var(--grist-theme-text, black));

`)

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



//Tooltip is a column
//Tooltip > table shows linked filters
//Tooltip > table > td:nth-child(3) is RHS of filters, show val, should look like a cell containing a value

//height on a td acts as min-height;  22px matches real field size, +2 for borders
//font-size is set larger by tooltip CSS, reset it to root font size to match field css
const cssLinkTooltip = styled('div',`
  display: flex;
  flex-flow: column;
  align-items: start;
  text-align: left;

  font-size: 1rem;
  font-family: ${vars.fontFamily};

& table {
    margin: 2px 0 2px 0;
    border-spacing: 2px;
    border-collapse: separate;
    align-self: center;
}

& table td:nth-child(3) {
    border: 1px solid white;
    padding: 3px 3px 0px 3px;
    min-width: 60px;
    height: 24px;
}
`);

// rows withing the linkstate-bubble tooltip
const cssLinkTooltipRow = styled('div',`


`)


//If inline with text, icons look better shifted up slightly
//since icons are position:relative, bottom:2 should shift it without affecting layout
const cssLinkstateFilterIconInline = styled(icon, `
  bottom: 2px;
  margin-right: 2px;
  background-color: ${theme.filterBarButtonSavedFg};
`);
const cssLinkstateFilterIcon = styled(icon, `
  background-color: ${theme.filterBarButtonSavedFg};
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
  return dom('div.view_leaf.viewsection_content.flexvbox.flexauto',
    testId(`viewlayout-section-${sectionRowId}`),
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
      dom("div",dom.style("flex","1 0 0px")), //spacer, 0 size by default, grows to take up remaining space
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
          dom('div.disable_viewpane.flexvbox', 'No data')
        ),
        dom.maybe(viewInstance.isTruncated, () =>
          dom('div.viewsection_truncated', 'Not all data is shown')
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
  bottom: 1px;
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
  --icon-color: ${colors.slate};
  top: -1px;
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
  --icon-color: ${colors.lightGreen};
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
