import BaseView from "app/client/components/BaseView";
import { GristDoc } from "app/client/components/GristDoc";
import { followInterface } from "app/client/lib/direction";
import { makeT } from "app/client/lib/localization";
import { ViewRec, ViewSectionRec } from "app/client/models/DocModel";
import { filterBar } from "app/client/ui/FilterBar";
import { maybeShowNewRecordExperiment } from "app/client/ui/NewRecordButton";
import { cssIcon } from "app/client/ui/RightPanelStyles";
import { makeCollapsedLayoutMenu } from "app/client/ui/ViewLayoutMenu";
import { cssDotsIconWrapper, cssMenu, viewSectionMenu } from "app/client/ui/ViewSectionMenu";
import { buildWidgetTitle } from "app/client/ui/WidgetTitle";
import { getWidgetTypes } from "app/client/ui/widgetTypesMap";
import { isNarrowScreenObs, mediaSmall, testId, theme } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { menu } from "app/client/ui2018/menus";
import { undef } from "app/common/gutil";
import { languageDirection } from "app/common/languageDirection";

import { Computed, dom, DomElementArg, Observable, styled } from "grainjs";
import { defaultMenuOptions } from "popweasel";

const t = makeT("buildViewSectionDom");

export function buildCollapsedSectionDom(options: {
  gristDoc: GristDoc,
  sectionRowId: number | string,
}, ...domArgs: DomElementArg[]) {
  const { gristDoc, sectionRowId } = options;
  if (typeof sectionRowId === "string") {
    return cssMiniSection(
      dom("span.viewsection_title_font",
        "Empty",
      ),
    );
  }
  const vs: ViewSectionRec = gristDoc.docModel.viewSections.getRowModel(sectionRowId);
  const typeComputed = Computed.create(null, use => getWidgetTypes(use(vs.effectiveWidgetType)).icon);
  return cssMiniSection(
    testId(`collapsed-section-${sectionRowId}`),
    testId(`collapsed-section`),
    cssDragHandle(
      dom.domComputed(typeComputed, type => icon(type)),
      dom("div", { style: "margin-right: 16px;" }),
      dom.maybe(use => use(use(vs.table).summarySourceTable), () => cssSigmaIcon("Pivot", testId("sigma"))),
      dom("span.viewsection_title_font", testId("collapsed-section-title"),
        dom.text(vs.titleDef),
      ),
    ),
    cssMenu(
      testId("section-menu-viewLayout"),
      cssDotsIconWrapper(cssIcon("Dots")),
      menu(_ctl => makeCollapsedLayoutMenu(vs, gristDoc), {
        ...defaultMenuOptions,
        placement: "bottom-end",
      }),
    ),
    ...domArgs,
  );
}

export function buildViewSectionDom(options: {
  gristDoc: GristDoc,
  sectionRowId: number,
  isResizing?: Observable<boolean>
  viewModel?: ViewRec,
  // Should show drag anchor.
  draggable?: boolean, /* defaults to true */
  // Should show green bar on the left (but preserves active-section class).
  focusable?: boolean, /* defaults to true */
  headerVisible?: boolean, /* defaults to true, if title and filters are visible at all */
  tableNameHidden?: boolean,
  widgetNameHidden?: boolean,
  renamable?: boolean,
  hideTitleControls?: boolean,
}) {
  const isResizing = options.isResizing ?? Observable.create(null, false);
  const {
    gristDoc,
    sectionRowId,
    viewModel,
    draggable = true,
    focusable = true,
    hideTitleControls = false,
    tableNameHidden,
    widgetNameHidden,
  } = options;

  // Creating normal section dom
  const vs: ViewSectionRec = gristDoc.docModel.viewSections.getRowModel(sectionRowId);
  const renamable = undef(vs.canRename.peek(), options.renamable, true);

  const selectedBySectionTitle = Computed.create(null, (use) => {
    if (!use(vs.linkSrcSectionRef)) { return null; }
    return use(use(vs.linkSrcSection).titleDef);
  });

  const regionFocusSwitcher = gristDoc.regionFocusSwitcher;
  return dom("div.view_leaf.viewsection_content.flexvbox.flexauto",
    // The frame of a widget (its title bar, its menu, its filter bar) is part of the interface,
    // whatever holds the arrangement of widgets around it; what the widget shows states its own
    // direction below.
    followInterface(),
    testId(`viewlayout-section-${sectionRowId}`),
    dom.autoDispose(selectedBySectionTitle),
    !options.isResizing ? dom.autoDispose(isResizing) : null,
    cssViewLeaf.cls(""),
    cssViewLeafInactive.cls("", use => !vs.isDisposed() && !use(vs.hasVisibleFocus)),
    dom.cls("active_section", vs.hasFocus),
    dom.cls("active_section--no-focus", use => !vs.isDisposed() && use(vs.hasFocus) && !use(vs.hasRegionFocus)),
    dom.cls("active_section--no-indicator", use => !focusable || (!vs.isDisposed() && !use(vs.hasVisibleFocus))),
    dom.maybe<BaseView | null>(use => use(vs.viewInstance), viewInstance => dom("div.viewsection_title.flexhbox",
      regionFocusSwitcher?.panelAttrs(`section-header-${sectionRowId}`, ""),
      dom.attr("aria-label", use => t(`{{title}} widget header`, { title: use(vs.titleDef) })),
      cssDragIcon("DragDrop",
        dom.cls("viewsection_drag_indicator"),
        // Makes element grabbable only if grist is not readonly.
        dom.cls("layout_grabbable", use => !use(gristDoc.isReadonlyKo)),
        !draggable ? dom.style("visibility", "hidden") : null,
      ),
      dom.maybe(use => use(use(viewInstance.viewSection.table).summarySourceTable), () =>
        cssSigmaIcon("Pivot", testId("sigma"))),
      buildWidgetTitle(
        vs,
        { tableNameHidden, widgetNameHidden, disabled: !renamable },
        testId("viewsection-title"),
        cssTestClick(testId("viewsection-blank")),
      ),
      viewInstance.buildTitleControls(),
      hideTitleControls === true ? null :
        dom("div.viewsection_buttons",
          dom.create(viewSectionMenu, gristDoc, vs),
        ),
    )),
    hideTitleControls === true ? null : dom.create(filterBar, gristDoc, vs),
    dom.maybe<BaseView | null>(vs.viewInstance, viewInstance => [
      dom("div.view_data_pane_container.flexvbox",
        cssResizing.cls("", isResizing),
        // What a widget shows is the document's, not the interface's: it is in the document's
        // language, and it is laid out in a direction that is stated here, so that it is the same
        // for everyone and never taken from the page around it. That direction is the document
        // language's, for the kinds of widget that can be laid out either way.
        // A table that is not a document's (the timing results, the list of webhooks) has no
        // language of its own to state: it is part of the interface, and is laid out with it.
        gristDoc.docInfo?.documentSettingsJson ? [
          dom.attr("lang", use => use(gristDoc.docInfo.documentSettingsJson).locale || null),
          dom.attr("dir", use => !vs.isDisposed() && DIRECTION_NEUTRAL_WIDGETS.has(use(vs.parentKey)) ?
            languageDirection(use(gristDoc.docInfo.documentSettingsJson).locale) : "ltr"),
        ] : null,
        dom.maybe(viewInstance.disableEditing, () =>
          dom("div.disable_viewpane.flexvbox",
            dom.domComputed(selectedBySectionTitle, title => title ?
              t(`No row selected in {{title}}`, { title }) :
              t("No data")),
          ),
        ),
        dom.maybe(viewInstance.isTruncated, () =>
          dom("div.viewsection_truncated", t("Not all data is shown")),
        ),
        dom.cls(use => "viewsection_type_" + use(vs.parentKey)),
        viewInstance.viewPane,
        maybeShowNewRecordExperiment(viewInstance),
      ),
      dom.maybe(use => !use(isNarrowScreenObs()), () => viewInstance.selectionSummary?.buildDom()),
    ]),
    dom.on("mousedown", () => { viewModel?.activeSectionId(sectionRowId); }),
  );
}

// The kinds of widget that lay out correctly in either direction. The others are kept
// left-to-right until they do.
const DIRECTION_NEUTRAL_WIDGETS = new Set(["record", "single", "detail"]);

// With new widgetPopup it is hard to click on viewSection without a activating it, hence we
// add a little blank space to use in test.
const cssTestClick = styled(`div`, `
  min-width: 2px;
`);

const cssSigmaIcon = styled(icon, `
  margin-inline-end: 5px;
  background-color: ${theme.lightText}
`);

const cssViewLeaf = styled("div", `
  @media ${mediaSmall} {
    & {
      margin: 4px;
    }
  }
`);

const cssViewLeafInactive = styled("div", `
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
      inset-inline-start: 0;
      inset-inline-end: 0;
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
const cssResizing = styled("div", `
  pointer-events: none;
`);

const cssMiniSection = styled("div.mini_section_container", `
  --icon-color: ${theme.accentIcon};
  display: flex;
  align-items: center;
  padding-inline-end: 8px;
`);

const cssDragHandle = styled("div.draggable-handle", `
  display: flex;
  padding: 8px;
  flex: 1;
  padding-inline-end: 16px;
`);
