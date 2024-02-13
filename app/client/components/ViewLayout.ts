import BaseView from 'app/client/components/BaseView';
import {buildViewSectionDom} from 'app/client/components/buildViewSectionDom';
import {ChartView} from 'app/client/components/ChartView';
import * as commands from 'app/client/components/commands';
import {CustomCalendarView} from "app/client/components/CustomCalendarView";
import {CustomView} from 'app/client/components/CustomView';
import * as DetailView from 'app/client/components/DetailView';
import {FormView} from 'app/client/components/Forms/FormView';
import * as GridView from 'app/client/components/GridView';
import {GristDoc} from 'app/client/components/GristDoc';
import {BoxSpec, Layout} from 'app/client/components/Layout';
import {LayoutEditor} from 'app/client/components/LayoutEditor';
import {LayoutTray} from 'app/client/components/LayoutTray';
import {printViewSection} from 'app/client/components/Printing';
import {Delay} from 'app/client/lib/Delay';
import {createObsArray} from 'app/client/lib/koArrayWrap';
import {logTelemetryEvent} from 'app/client/lib/telemetry';
import {ViewRec, ViewSectionRec} from 'app/client/models/DocModel';
import {reportError} from 'app/client/models/errors';
import {getTelemetryWidgetTypeFromVS} from 'app/client/ui/widgetTypesMap';
import {isNarrowScreen, mediaSmall, testId, theme} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {DisposableWithEvents} from 'app/common/DisposableWithEvents';
import {mod} from 'app/common/gutil';
import {
  Computed,
  computedArray,
  Disposable,
  dom,
  fromKo,
  Holder,
  IDomComponent,
  MultiHolder,
  Observable,
  styled,
  subscribe
} from 'grainjs';
import * as ko from 'knockout';
import debounce from 'lodash/debounce';
import * as _ from 'underscore';

// tslint:disable:no-console

const viewSectionTypes: {[key: string]: any} = {
  record: GridView,
  detail: DetailView,
  chart: ChartView,
  single: DetailView,
  custom: CustomView,
  form: FormView,
  'custom.calendar': CustomCalendarView,
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
  public layoutSpec: ko.Computed<BoxSpec>;
  public maximized: Observable<number|null>;
  public isResizing = Observable.create(this, false);
  public layout: Layout;
  public layoutEditor: LayoutEditor;
  public layoutTray: LayoutTray;
  public layoutSaveDelay = this.autoDispose(new Delay());

  private _freeze = false;
  // Exposed for test to indicate that save has not yet been called.
  private _savePending = Observable.create(this, false);
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

    this.layout = this.autoDispose(Layout.create(this.layoutSpec(),
                                                 this._buildLeafContent.bind(this), true));


    // When the layoutSpec changes by some means other than the layout editor, rebuild.
    // This includes adding/removing sections and undo/redo.
    this.autoDispose(this.layoutSpec.subscribe((spec) => this._freeze || this.rebuildLayout(spec)));

    this.listenTo(this.layout, 'layoutUserEditStop', () => {
      this.isResizing.set(false);
      this.layoutSaveDelay.schedule(1000, () => {
        this.saveLayoutSpec();
      });
    });

    // Do not save if the user has started editing again.
    this.listenTo(this.layout, 'layoutUserEditStart', () => {
      this.layoutSaveDelay.cancel();
      this._savePending.set(true);
      this.isResizing.set(true);
    });

    this.layoutEditor = this.autoDispose(LayoutEditor.create(this.layout));
    this.layoutTray = LayoutTray.create(this, this);

    // Add disposal of this._layout after layoutEditor, so that it gets disposed first, and
    // layoutEditor doesn't attempt to update it in its own disposal logic.
    this.onDispose(() => this.layout.dispose());

    this.autoDispose(this.gristDoc.resizeEmitter.addListener(this._onResize, this));

    // It's hard to detect a click or mousedown on a third-party iframe
    // (See https://stackoverflow.com/questions/2381336/detect-click-into-iframe-using-javascript).
    this.listenTo(this.gristDoc.app, 'clipboard_blur', this._maybeFocusInSection);

    // On narrow screens (e.g. mobile), we need to resize the section after a transition.
    // There will two transition events (one from section one from row), so we debounce them after a tick.
    const handler = debounce((e: TransitionEvent) => {
      // We work only on the transition of the flex-grow property, and only on narrow screens.
      if (e.propertyName !== 'flex-grow' || !isNarrowScreen()) { return; }
      // Make sure the view is still active.
      if (this.viewModel.isDisposed() || !this.viewModel.activeSection) { return; }
      const section = this.viewModel.activeSection.peek();
      if (!section || section.isDisposed()) { return; }
      const view = section.viewInstance.peek();
      if (!view || view.isDisposed()) { return; }
      // Make resize.
      view.onResize();
    }, 0);
    this.layout.rootElem.addEventListener('transitionend', handler);
    // Don't need to dispose the listener, as the rootElem is disposed with the layout.

    const classActive = cssLayoutBox.className + '-active';
    const classInactive = cssLayoutBox.className + '-inactive';
    this.autoDispose(subscribe(fromKo(this.viewModel.activeSection), (use, section) => {
      const id = section.getRowId();
      this.layout.forEachBox(box => {
        box.dom!.classList.add(classInactive);
        box.dom!.classList.remove(classActive);
        box.dom!.classList.remove("transition");
      });
      let elem: Element|null = this.layout.getLeafBox(id)?.dom || null;
      while (elem?.matches('.layout_box')) {
        elem.classList.remove(classInactive);
        elem.classList.add(classActive);
        elem = elem.parentElement;
      }
      if (!isNarrowScreen()) {
        section.viewInstance.peek()?.onResize();
      }
    }));

    const commandGroup = {
      deleteSection: () => { this.removeViewSection(this.viewModel.activeSectionId()); },
      nextSection: () => { this._otherSection(+1); },
      prevSection: () => { this._otherSection(-1); },
      printSection: () => { printViewSection(this.layout, this.viewModel.activeSection()).catch(reportError); },
      sortFilterMenuOpen: (sectionId?: number) => { this._openSortFilterMenu(sectionId); },
      expandSection: () => { this._expandSection(); },
      cancel: () => {
        if (this.maximized.get()) {
          this.maximized.set(null);
        }
      }
    };
    this.autoDispose(commands.createGroup(commandGroup, this, true));

    this.maximized = fromKo(this.layout.maximizedLeaf) as any;
    this.autoDispose(this.maximized.addListener((sectionId, prev) => {
      // If we are closing popup, resize all sections.
      if (!sectionId) {
        this._onResize();
      } else {
        // Otherwise resize only active one (the one in popup).
        const section = this.viewModel.activeSection.peek();
        if (!section.isDisposed() && section.id.peek()) {
          section?.viewInstance.peek()?.onResize();
        }
      }
    }));
  }

  public buildDom() {
    const owner = MultiHolder.create(null);
    const close = () => this.maximized.set(null);
    const mainBoxInPopup = Computed.create(owner, use => this.layout.getAllLeafIds().includes(use(this.maximized)));
    const miniBoxInPopup = Computed.create(owner, use => use(mainBoxInPopup) ? null : use(this.maximized));
    return cssOverlay(
      dom.autoDispose(owner),
      cssOverlay.cls('-active', use => !!use(this.maximized)),
      testId('viewLayout-overlay'),
      cssVFull(
        this.layoutTray.buildDom(),
        cssLayoutWrapper(
          cssLayoutWrapper.cls('-active', use => Boolean(use(this.maximized))),
          dom.update(
            this.layout.rootElem,
            dom.hide(use => Boolean(use(miniBoxInPopup))),
          ),
          this.layoutTray.buildPopup(owner, miniBoxInPopup, close),
        ),
      ),
      dom.maybe(use => !!use(this.maximized), () =>
        cssCloseButton('CrossBig',
          testId('close-button'),
          dom.on('click', () => close())
        )
      ),
      // Close the lightbox when user clicks exactly on the overlay.
      dom.on('click', (ev, elem) => void (ev.target === elem && this.maximized.get() ? close() : null)),
      dom.cls('test-viewLayout-save-pending', this._savePending)
    );
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
      this.rebuildLayout(this.layoutSpec.peek());
    }
  }

  public saveLayoutSpec(specs?: BoxSpec) {
    this._savePending.set(false);
    // Cancel the automatic delay.
    this.layoutSaveDelay.cancel();
    if (!this.layout) { return; }
    // Only save layout changes when the document isn't read-only.
    if (!this.gristDoc.isReadonly.get()) {
      if (!specs) {
        specs = this.layout.getLayoutSpec();
        specs.collapsed = this.viewModel.activeCollapsedSections.peek().map((leaf)=> ({leaf}));
      }
      this.viewModel.layoutSpecObj.setAndSave(specs).catch(reportError);
    }
    this._onResize();
  }

  // Removes a view section from the current view. Should only be called if there is
  // more than one viewsection in the view.
  public removeViewSection(viewSectionRowId: number) {
    this.maximized.set(null);
    const viewSection = this.viewModel.viewSections().all().find(s => s.getRowId() === viewSectionRowId);
    if (!viewSection) {
      throw new Error(`Section not found: ${viewSectionRowId}`);
    }

    const widgetType = getTelemetryWidgetTypeFromVS(viewSection);
    logTelemetryEvent('deletedWidget', {full: {docIdDigest: this.gristDoc.docId(), widgetType}});

    this.gristDoc.docData.sendAction(['RemoveViewSection', viewSectionRowId]).catch(reportError);
  }

  public rebuildLayout(layoutSpec: BoxSpec) {
    // Rebuild the collapsed section layout. In return we will get all leaves that were
    // removed from collapsed dom. Some of them will hold a view instance dom.
    const oldTray = this.layoutTray.replaceLayout();
    // Build the normal layout. While building, some leaves will grab the view instance dom
    // and attach it to their dom (and detach them from the old layout in the process).
    this.layout.buildLayout(layoutSpec, true);
    this._onResize();
    // Dispose the old layout. This will dispose the view instances that were not reused.
    oldTray.dispose();
  }

  private _expandSection() {
    const activeSection = this.viewModel.activeSection();
    const activeSectionId = activeSection.getRowId();
    const activeSectionBox = this.layout.getLeafBox(activeSectionId);
    if (!activeSectionBox) { return; }
    activeSectionBox.maximize();
  }

  private _buildLeafContent(sectionRowId: number) {
    return buildViewSectionDom({
       gristDoc: this.gristDoc,
       sectionRowId,
       isResizing: this.isResizing,
       viewModel: this.viewModel
    });
  }

  /**
   * If there is no layout saved, we can create a default layout just from the list of fields for
   * this view section. By default we just arrange them into a list of rows, two fields per row.
   */
  private _updateLayoutSpecWithSections(spec: BoxSpec) {
    // We use tmpLayout as a way to manipulate the layout before we get a final spec from it.
    const tmpLayout = Layout.create(spec, () => dom('div'), true);

    const specFieldIds = tmpLayout.getAllLeafIds();
    const viewSectionIds = this.viewModel.viewSections().all().map(function(f) { return f.getRowId(); });

    function addToSpec(leafId: number) {
      const newBox = tmpLayout.buildLayoutBox({ leaf: leafId });
      const rows = tmpLayout.rootBox()!.childBoxes.peek();
      const lastRow = rows[rows.length - 1];
      if (rows.length >= 1 && lastRow.isLeaf()) {
        // Add a new child to the last row.
        lastRow.addChild(newBox, true);
      } else {
        // Add a new row.
        tmpLayout.rootBox()!.addChild(newBox, true);
      }
      return newBox;
    }

    // For any stale fields (no longer among viewFields), remove them from tmpLayout.
    _.difference(specFieldIds, viewSectionIds).forEach(function(leafId: string|number) {
      tmpLayout.getLeafBox(leafId)?.dispose();
    });

    // For all fields that should be in the spec but aren't, add them to tmpLayout. We maintain a
    // two-column layout, so add a new row, or a second box to the last row if it's a leaf.
    const missingLeafs = _.difference(viewSectionIds, specFieldIds);
    const collapsedLeafs = new Set((spec.collapsed || []).map(c => c.leaf));
    missingLeafs.forEach(function(leafId: any) {
      if (!collapsedLeafs.has(leafId)) {
        addToSpec(leafId);
      }
    });

    spec = tmpLayout.getLayoutSpec();
    tmpLayout.dispose();
    return spec;
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
    const sectionIds = this.layout.getAllLeafIds();
    const sectionId = this.viewModel.activeSectionId.peek();
    const currentIndex = sectionIds.indexOf(sectionId);
    const index = mod(currentIndex + delta, sectionIds.length);
    // update the active section id
    this.viewModel.activeSectionId(sectionIds[index]);
  }

  private _maybeFocusInSection()  {
    // If the focused element is inside a view section, make that section active.
    const layoutBox = this.layout.getContainingBox(document.activeElement);
    if (layoutBox && layoutBox.leafId) {
      this.gristDoc.viewModel.activeSectionId(layoutBox.leafId.peek());
    }
  }

  /**
   * Opens the sort and filter menu of the active view section.
   *
   * Optionally accepts a `sectionId` for opening a specific section's menu.
   */
  private _openSortFilterMenu(sectionId?: number)  {
    const id = sectionId ?? this.viewModel.activeSectionId();
    const leafBoxDom = this.layout.getLeafBox(id)?.dom;
    if (!leafBoxDom) { return; }

    const menu: HTMLElement | null = leafBoxDom.querySelector('.test-section-menu-sortAndFilter');
    menu?.click();
  }
}

const cssLayoutBox = styled('div', `
  @media screen and ${mediaSmall} {
    &-active, &-inactive {
      transition: flex-grow var(--grist-layout-animation-duration, 0.4s); // Exposed for tests
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

const cssLayoutWrapper = styled('div', `
  display: flex;
  flex-direction: column;
  position: relative;
  flex-grow: 1;
  @media not print {
    &-active {
      background: ${theme.mainPanelBg};
      height: 100%;
      width: 100%;
      border-radius: 5px;
      border-bottom-left-radius: 0px;
      border-bottom-right-radius: 0px;
      position: relative;
    }
    &-active .viewsection_content {
      margin: 0px;
      margin-top: 8px;
    }
    &-active .viewsection_title {
      padding: 0px 12px;
    }
    &-active .filter_bar {
      margin-left: 6px;
    }
  }
`);

const cssOverlay = styled('div', `
  height: 100%;
  @media screen {
    &-active {
      background-color: ${theme.modalBackdrop};
      inset: 0px;
      height: 100%;
      width: 100%;
      padding: 20px 56px 20px 56px;
      position: absolute;
    }
    &-active .collapsed_layout {
      display: none !important;
    }
  }
  @media screen and ${mediaSmall} {
    &-active {
      padding: 22px;
      padding-top: 30px;
    }
  }
`);

const cssCloseButton = styled(icon, `
  position: absolute;
  top: 16px;
  right: 16px;
  height: 24px;
  width: 24px;
  cursor: pointer;
  --icon-color: ${theme.modalBackdropCloseButtonFg};
  &:hover {
    --icon-color: ${theme.modalBackdropCloseButtonHoverFg};
  }
  @media ${mediaSmall} {
    & {
      top: 6px;
      right: 6px;
    }
  }
`);

const cssVFull = styled('div', `
  height: 100%;
  display: flex;
  flex-direction: column;
`);
