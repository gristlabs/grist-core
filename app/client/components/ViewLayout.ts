import * as BaseView from 'app/client/components/BaseView';
import {ChartView} from 'app/client/components/ChartView';
import * as commands from 'app/client/components/commands';
import {CustomView} from 'app/client/components/CustomView';
import * as DetailView from 'app/client/components/DetailView';
import * as GridView from 'app/client/components/GridView';
import {GristDoc} from 'app/client/components/GristDoc';
import {Layout} from 'app/client/components/Layout';
import {LayoutEditor} from 'app/client/components/LayoutEditor';
import {printViewSection} from 'app/client/components/Printing';
import {Delay} from 'app/client/lib/Delay';
import {createObsArray} from 'app/client/lib/koArrayWrap';
import {ViewRec, ViewSectionRec} from 'app/client/models/DocModel';
import {reportError} from 'app/client/models/errors';
import {filterBar} from 'app/client/ui/FilterBar';
import {viewSectionMenu} from 'app/client/ui/ViewSectionMenu';
import {buildWidgetTitle} from 'app/client/ui/WidgetTitle';
import {colors, mediaSmall, testId} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {DisposableWithEvents} from 'app/common/DisposableWithEvents';
import {mod} from 'app/common/gutil';
import {Observable} from 'grainjs';
import * as ko from 'knockout';
import * as _ from 'underscore';
import {computedArray, Disposable, dom, fromKo, Holder, IDomComponent, styled, subscribe} from 'grainjs';

// tslint:disable:no-console

const viewSectionTypes: {[key: string]: any} = {
  record: GridView,
  detail: DetailView,
  chart: ChartView,
  single: DetailView,
  custom: CustomView,
};

function getInstanceConstructor(parentKey: string) {
  const Cons = viewSectionTypes[parentKey];
  if (!Cons) {
    console.error('ViewLayout error: requested an unsupported section type:', parentKey);
  }
  // Default to GridView if no valid constructor
  return Cons || viewSectionTypes.record;
}

export class ViewSectionHelper extends Disposable {
  private _instance = Holder.create<BaseView>(this);

  constructor(gristDoc: GristDoc, vs: ViewSectionRec) {
    super();
    this.onDispose(() => vs.viewInstance(null));

    this.autoDispose(subscribe((use) => {
      // Rebuild the section when its type changes or its underlying table.
      const table = use(vs.table);
      const Cons = getInstanceConstructor(use(vs.parentKey));
      this._instance.clear();
      if (table.getRowId()) {
        this._instance.autoDispose(Cons.create(gristDoc, vs));
      }
      vs.viewInstance(this._instance.get());
    }));
  }
}

/**
 * ViewLayout - Handles layout for a single page.
 */
export class ViewLayout extends DisposableWithEvents implements IDomComponent {
  public docModel = this.gristDoc.docModel;
  public viewModel: ViewRec;
  public layoutSpec: ko.Computed<object>;

  private _freeze = false;
  private _layout: any;
  private _sectionIds: number[];
  private _isResizing = Observable.create(this, false);

  constructor(public readonly gristDoc: GristDoc, viewId: number) {
    super();
    this.viewModel = this.docModel.views.getRowModel(viewId);

    // A Map from viewSection RowModels to corresponding View class instances.
    // TODO add a test that creating / deleting a section creates/destroys one instance, and
    // switching pages destroys all instances.
    const viewSectionObs = createObsArray(this, this.viewModel.viewSections());
    this.autoDispose(computedArray(viewSectionObs, (vs, i, compArr) =>
      ViewSectionHelper.create(compArr, gristDoc, vs)));

    // Update the stored layoutSpecObj with any missing fields that are present in viewFields.
    this.layoutSpec = this.autoDispose(ko.computed(
      () => this._updateLayoutSpecWithSections(this.viewModel.layoutSpecObj()))
      .extend({rateLimit: 0}));

    this._layout = this.autoDispose(Layout.create(this.layoutSpec(),
                                                 this._buildLeafContent.bind(this), true));
    this._sectionIds = this._layout.getAllLeafIds();

    // When the layoutSpec changes by some means other than the layout editor, rebuild.
    // This includes adding/removing sections and undo/redo.
    this.autoDispose(this.layoutSpec.subscribe((spec) => this._freeze || this._rebuildLayout(spec)));

    const layoutSaveDelay = this.autoDispose(new Delay());

    this.listenTo(this._layout, 'layoutUserEditStop', () => {
      this._isResizing.set(false);
      layoutSaveDelay.schedule(1000, () => {
        if (!this._layout) { return; }

        // Only save layout changes when the document isn't read-only.
        if (!this.gristDoc.isReadonly.get()) {
          (this.viewModel.layoutSpecObj as any).setAndSave(this._layout.getLayoutSpec());
        }
        this._onResize();
      });
    });

    // Do not save if the user has started editing again.
    this.listenTo(this._layout, 'layoutUserEditStart', () => {
      layoutSaveDelay.cancel();
      this._isResizing.set(true);
    });

    this.autoDispose(LayoutEditor.create(this._layout));

    // Add disposal of this._layout after layoutEditor, so that it gets disposed first, and
    // layoutEditor doesn't attempt to update it in its own disposal logic.
    this.onDispose(() => this._layout.dispose());

    this.autoDispose(this.gristDoc.resizeEmitter.addListener(this._onResize, this));

    // It's hard to detect a click or mousedown on a third-party iframe
    // (See https://stackoverflow.com/questions/2381336/detect-click-into-iframe-using-javascript).
    this.listenTo(this.gristDoc.app, 'clipboard_blur', this._maybeFocusInSection);

    const classActive = cssLayoutBox.className + '-active';
    const classInactive = cssLayoutBox.className + '-inactive';
    this.autoDispose(subscribe(fromKo(this.viewModel.activeSection), (use, section) => {
      const id = section.getRowId();
      this._layout.forEachBox((box: {dom: Element}) => {
        box.dom.classList.add(classInactive);
        box.dom.classList.remove(classActive);
      });
      let elem: Element|null = this._layout.getLeafBox(id)?.dom;
      while (elem?.matches('.layout_box')) {
        elem.classList.remove(classInactive);
        elem.classList.add(classActive);
        elem = elem.parentElement;
      }
      section.viewInstance.peek()?.onResize();
    }));

    const commandGroup = {
      deleteSection: () => { this._removeViewSection(this.viewModel.activeSectionId()); },
      nextSection: () => { this._otherSection(+1); },
      prevSection: () => { this._otherSection(-1); },
      printSection: () => { printViewSection(this._layout, this.viewModel.activeSection()).catch(reportError); },
    };
    this.autoDispose(commands.createGroup(commandGroup, this, true));
  }

  public buildDom() {
    return this._layout.rootElem;
  }

  // Freezes the layout until the passed in promise resolves. This is useful to achieve a single
  // layout rebuild when multiple user actions needs to apply, simply pass in a promise that resolves
  // when all user actions have resolved.
  public async freezeUntil<T>(promise: Promise<T>): Promise<T> {
    this._freeze = true;
    try {
      return await promise;
    } finally {
      this._freeze = false;
      this._rebuildLayout(this.layoutSpec.peek());
    }
  }

  // Removes a view section from the current view. Should only be called if there is
  // more than one viewsection in the view.
  private _removeViewSection(viewSectionRowId: number) {
    this.gristDoc.docData.sendAction(['RemoveViewSection', viewSectionRowId]).catch(reportError);
  }

  private _buildLeafContent(sectionRowId: number) {
    return buildViewSectionDom({
       gristDoc: this.gristDoc,
       sectionRowId,
       isResizing: this._isResizing,
       viewModel: this.viewModel
    });
  }

  /**
   * If there is no layout saved, we can create a default layout just from the list of fields for
   * this view section. By default we just arrange them into a list of rows, two fields per row.
   */
  private _updateLayoutSpecWithSections(spec: object) {
    // We use tmpLayout as a way to manipulate the layout before we get a final spec from it.
    const tmpLayout = Layout.create(spec, (leafId: number) => dom('div'), true);

    const specFieldIds = tmpLayout.getAllLeafIds();
    const viewSectionIds = this.viewModel.viewSections().all().map(function(f) { return f.getRowId(); });

    function addToSpec(leafId: number) {
      const newBox = tmpLayout.buildLayoutBox({ leaf: leafId });
      const rows = tmpLayout.rootBox().childBoxes.peek();
      const lastRow = rows[rows.length - 1];
      if (rows.length >= 1 && lastRow.isLeaf()) {
        // Add a new child to the last row.
        lastRow.addChild(newBox, true);
      } else {
        // Add a new row.
        tmpLayout.rootBox().addChild(newBox, true);
      }
      return newBox;
    }

    // For any stale fields (no longer among viewFields), remove them from tmpLayout.
    _.difference(specFieldIds, viewSectionIds).forEach(function(leafId) {
      tmpLayout.getLeafBox(leafId).dispose();
    });

    // For all fields that should be in the spec but aren't, add them to tmpLayout. We maintain a
    // two-column layout, so add a new row, or a second box to the last row if it's a leaf.
    _.difference(viewSectionIds, specFieldIds).forEach(function(leafId) {
      // Only add the builder box if it hasn`t already been created
      addToSpec(leafId);
    });

    spec = tmpLayout.getLayoutSpec();
    tmpLayout.dispose();
    return spec;
  }

  private _rebuildLayout(layoutSpec: object) {
    this._layout.buildLayout(layoutSpec, true);
    this._onResize();
    this._sectionIds = this._layout.getAllLeafIds();
  }

  // Resizes the scrolly windows of all viewSection classes with a 'scrolly' property.
  private _onResize() {
    this.viewModel.viewSections().all().forEach(vs => {
      const inst = vs.viewInstance.peek();
      if (inst) {
        inst.onResize();
      }
    });
  }

  // Select another section in cyclic ordering of sections. Order is counter-clockwise if given a
  // positive `delta`, clockwise otherwise.
  private _otherSection(delta: number) {
    const sectionId = this.viewModel.activeSectionId.peek();
    const currentIndex = this._sectionIds.indexOf(sectionId);
    const index = mod(currentIndex + delta, this._sectionIds.length);

    // update the active section id
    this.viewModel.activeSectionId(this._sectionIds[index]);
  }

  private _maybeFocusInSection()  {
    // If the focused element is inside a view section, make that section active.
    const layoutBox = this._layout.getContainingBox(document.activeElement);
    if (layoutBox && layoutBox.leafId) {
      this.gristDoc.viewModel.activeSectionId(layoutBox.leafId.peek());
    }
  }
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
      dom('span.viewsection_drag_indicator.glyphicon.glyphicon-option-vertical',
        // Makes element grabbable only if grist is not readonly.
        dom.cls('layout_grabbable', (use) => !use(gristDoc.isReadonlyKo)),
        !draggable ? dom.style("visibility", "hidden") : null
      ),
      dom.maybe((use) => use(use(viewInstance.viewSection.table).summarySourceTable), () =>
        cssSigmaIcon('Pivot', testId('sigma'))),
      buildWidgetTitle(vs, options, testId('viewsection-title'), cssTestClick(testId("viewsection-blank"))),
      viewInstance.buildTitleControls(),
      dom('span.viewsection_buttons',
        dom.create(viewSectionMenu, gristDoc.docModel, vs, gristDoc.isReadonly)
      )
     )),
    dom.maybe((use) => use(vs.activeFilterBar) || use(vs.isRaw) && use(vs.activeFilters).length,
      () => dom.create(filterBar, vs)),
    dom.maybe<BaseView|null>(vs.viewInstance, (viewInstance) =>
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
      )
    ),
    dom.on('mousedown', () => { viewModel?.activeSectionId(sectionRowId); }),
  );
}

// With new widgetPopup it is hard to click on viewSection without a activating it, hence we
// add a little blank space to use in test.
const cssTestClick = styled(`div`, `
  min-width: 1px;
`);

const cssSigmaIcon = styled(icon, `
  bottom: 1px;
  margin-right: 5px;
  background-color: ${colors.slate}
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
        ${colors.mediumGreyOpaque},
        ${colors.mediumGreyOpaque} 10px,
        ${colors.lightGrey} 10px,
        ${colors.lightGrey} 20px
      );
      border: 1px solid ${colors.darkGrey};
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

const cssLayoutBox = styled('div', `
  @media screen and ${mediaSmall} {
    &-active, &-inactive {
      transition: flex-grow 0.4s;
    }
    &-active > &-inactive,
    &-active > &-inactive.layout_hbox .layout_hbox,
    &-active > &-inactive.layout_vbox .layout_vbox {
      flex: none !important;
    }

    &-active > &-inactive.layout_hbox.layout_leaf,
    &-active > &-inactive.layout_hbox .layout_hbox.layout_leaf {
      height: 40px;
    }

    &-active > &-inactive.layout_vbox.layout_leaf,
    &-active > &-inactive.layout_vbox .layout_vbox.layout_leaf {
      width: 40px;
    }

    &-inactive.layout_leaf {
      min-height: 40px;
      min-width: 40px;
    }
  }
`);

// This class is added while sections are being resized (or otherwise edited), to ensure that the
// content of the section (such as an iframe) doesn't interfere with mouse drag-related events.
// (It assumes that contained elements do not set pointer-events to another value; if that were
// important then we'd need to use an overlay element during dragging.)
const cssResizing = styled('div', `
  pointer-events: none;
`);
