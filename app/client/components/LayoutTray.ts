import BaseView from 'app/client/components/BaseView';
import {buildCollapsedSectionDom, buildViewSectionDom} from 'app/client/components/buildViewSectionDom';
import * as commands from 'app/client/components/commands';
import {ContentBox} from 'app/client/components/Layout';
import type {ViewLayout} from 'app/client/components/ViewLayout';
import {get as getBrowserGlobals} from 'app/client/lib/browserGlobals';
import {detachNode} from 'app/client/lib/dom';
import {Signal} from 'app/client/lib/Signal';
import {urlState} from 'app/client/models/gristUrlState';
import {TransitionWatcher} from 'app/client/ui/transitions';
import {theme} from 'app/client/ui2018/cssVars';
import {DisposableWithEvents} from 'app/common/DisposableWithEvents';
import {isNonNullish} from 'app/common/gutil';
import {Computed, Disposable, dom, IDisposable, IDisposableOwner,
        makeTestId, obsArray, Observable, styled} from 'grainjs';
import isEqual from 'lodash/isEqual';

const testId = makeTestId('test-layoutTray-');

const G = getBrowserGlobals('document', 'window', '$');


/**
 * Adds a tray for minimizing and restoring sections. It is built as a plugin for the ViewLayout component.
 */
export class LayoutTray extends DisposableWithEvents {
  // We and LayoutEditor will emit this event with the box that is being dragged. When the
  // drag is over there will be another event with null.
  public drag = Signal.create<Dropped|null>(this, null);
  // Event for dropping, contains a dropped element.
  public drop = Signal.create<Dropped|null>(this, null);
  // Monitor if the cursor is over the our tray.
  public hovering = Signal.create(this, false);
  // If the drag is active and the mouse is over the tray make a signal..
  public over = Signal.compute(this, on => Boolean(on(this.drag) && on(this.hovering)));
  // Mouse events during dragging (without a state).
  public dragging = Signal.create<MouseEvent|null>(this, null);
  // Create a layout to actually render the collapsed sections.
  public layout = CollapsedLayout.create(this, this);
  // Whether we are active (have a dotted border, that indicates we are ready to receive a drop)
  public active = Signal.create(this, false);

  private _rootElement: HTMLElement;

  constructor(public viewLayout: ViewLayout) {
    super();
    // Create a proxy for the LayoutEditor. It will mimic the same interface as CollapsedLeaf.
    const externalLeaf = ExternalLeaf.create(this, this);

    // Build layout using saved settings.
    this.layout.buildLayout(this.viewLayout.viewModel.collapsedSections.peek());

    this._registerCommands();

    // Override the drop event, to detect if we are dropped on the tray, and no one else
    // gets the value.
    this.drop.before((value, emit) => {
      // Emit the value, if someone else will handle it, he should grab the state from it.
      emit(value);
      // See if the state is still there.
      if (value && this.drop.state.get()) {
        // No one took it, so we should handle it if we are over the tray.
        if (this.over.state.get()) {
          const leafId = value.leafId();
          // Add it as a last element.
          this.layout.addBox(leafId);
          // Ask it to remove itself from the target.
          value.removeFromLayout();
        }
      }
      // Clear the state, any other listener will get null.
      this.drop.state.set(null);
    });

    // Now wire up active state.

    // When a drag is started, get the top point of the tray, over which we will activate.
    let topPoint = 48; // By default it is 48 pixels.
    this.autoDispose(externalLeaf.drag.listen(d => {
      if (!d) { return; }
      topPoint = (this._rootElement.parentElement?.getBoundingClientRect().top ?? 61) - 13;
    }));

    // First we can be activated when a drag has started and we have some boxes.
    this.drag.map(drag => drag && this.layout.count.get() > 0)
             .flag() // Map to a boolean, and emit only when the value changes.
             .filter(Boolean) // Only emit when it is set to true
             .pipe(this.active);

    // Second, we can be activated when the drag has started by the main layout, and we don't have any boxes yet, but
    // mouse pointer is relatively high on the screen.
    Signal.compute(this, on => {
      const drag = on(externalLeaf.drag);
      if (!drag) { return false; }
      const mouseEvent = on(externalLeaf.dragMove);
      const over = mouseEvent && mouseEvent.clientY < topPoint;
      return !!over;
    }).flag().filter(Boolean).pipe(this.active);

    // If a drag has ended, we should deactivate.
    this.drag.flag().filter(d => !d).pipe(this.active);
  }

  public replaceLayout() {
    const savedSections = this.viewLayout.viewModel.collapsedSections.peek();
    this.viewLayout.viewModel.activeCollapsedSections(savedSections);
    const boxes = this.layout.buildLayout(savedSections);
    return {
      dispose() {
        boxes.forEach(box => box.dispose());
        boxes.length = 0;
      }
    };
  }

  /**
   * Builds a popup for a maximized section.
   */
  public buildPopup(owner: IDisposableOwner, selected: Observable<number|null>, close: () => void) {
    const section = Observable.create<number|null>(owner, null);
    owner.autoDispose(selected.addListener((cur, prev) => {
      if (prev) {
        this.layout.getBox(prev)?.attach();
      }
      if (cur) {
        this.layout.getBox(cur)?.detach();
      }
      section.set(cur);
    }));
    return dom.domComputed(section, (id) => {
      if (!id) { return null; }
      return dom.update(
        buildViewSectionDom({
          gristDoc: this.viewLayout.gristDoc,
          sectionRowId: id,
          draggable: false,
          focusable: false,
        })
      );
    });
  }

  public buildDom() {
    return this._rootElement = cssCollapsedTray(
      testId('editor'),
      // When drag is active we should show a dotted border around the tray.
      cssCollapsedTray.cls('-is-active', this.active.state),
      // If element is over the tray, we should indicate that we are ready by changing a color.
      cssCollapsedTray.cls('-is-target', this.over.state),
      // Synchronize the hovering state with the event.
      syncHover(this.hovering),
      // Create a drop zone (below actual sections)
      dom.create(CollapsedDropZone, this),
      // Build the layout.
      this.layout.buildDom(),
      // But show only if there are any sections in the tray (even if those are empty or drop target sections)
      // or we can accept a drop.
      dom.show(use => use(this.layout.count) > 0 || use(this.active.state)),
    );
  }

  public buildContentDom(id: string|number) {
    return buildCollapsedSectionDom({
      gristDoc: this.viewLayout.gristDoc,
      sectionRowId: id,
    });
  }



  private _registerCommands() {
    const viewLayout = this.viewLayout;
    // Add custom commands for options in the menu.
    const commandGroup = {
      // Collapse visible section.
      collapseSection: () => {
        const leafId = viewLayout.viewModel.activeSectionId();
        if (!leafId) { return; }

        // Find the box for this section in the layout.
        const box = viewLayout.layoutEditor.getBox(leafId);
        if (!box) { return; }

        // Change the active section now. This is important as this will destroy the view before we
        // remove the box from the dom. Charts are very sensitive for this.
        viewLayout.viewModel.activeSectionId(
          // We can't collapse last section, so the main layout will always have at least one section.
          viewLayout.layoutEditor.layout.getAllLeafIds().filter(x => x !== leafId)[0]
        );

        // Add the box to our collapsed editor (it will transfer the viewInstance).
        this.layout.addBox(leafId);

        // Remove it from the main layout.
        box.dispose();

        // And ask the viewLayout to save the specs.
        viewLayout.saveLayoutSpec();
      },
      restoreSection: () => {
        // Get the section that is collapsed and clicked (we are setting this value).
        const leafId = viewLayout.viewModel.activeCollapsedSectionId();
        if (!leafId) { return; }
        viewLayout.viewModel.activeCollapsedSectionId(0);
        viewLayout.viewModel.activeCollapsedSections(
          viewLayout.viewModel.activeCollapsedSections.peek().filter(x => x !== leafId)
        );
        viewLayout.viewModel.activeSectionId(leafId);
        viewLayout.saveLayoutSpec();
      },
      // Delete collapsed section.
      deleteCollapsedSection: () => {
        // This section is still in the view (but not in the layout). So we can just remove it.
        const leafId = viewLayout.viewModel.activeCollapsedSectionId();
        if (!leafId) { return; }
        this.viewLayout.removeViewSection(leafId);
        // We need to manually update the layout. Main layout editor doesn't care about missing sections.
        // but we can't afford that. Without removing it, user can add another section that will be collapsed
        // from the start, as the id will be the same as the one we just removed.
        const currentSpec = viewLayout.viewModel.layoutSpecObj();
        const validSections = new Set(viewLayout.viewModel.viewSections.peek().peek().map(vs => vs.id.peek()));
        validSections.delete(leafId);
        currentSpec.collapsed = currentSpec.collapsed
          ?.filter(x => typeof x.leaf === 'number' && validSections.has(x.leaf));
        viewLayout.saveLayoutSpec(currentSpec);
      }
    };
    this.autoDispose(commands.createGroup(commandGroup, this, true));
  }
}

/**
 * Main component that detects where the section should be dropped.
 */
class CollapsedDropZone extends Disposable {
  private _rootElement: HTMLElement;
  // Some operations will be blocked when we are waiting for an animation to finish.
  private _animation = Observable.create(this, 0);
  private _lastTarget: TargetLeaf | undefined;
  private _lastIndex = -1;

  constructor(protected model: LayoutTray) {
    super();
    // When the drag has started or has finished we will add an empty leaf that can accept
    // dragged section. Event is fire only once, and it will be fired with a null when the draggable
    // has finished.
    let pushedLeaf: EmptyLeaf | undefined;
    const layout = model.layout;

    this.autoDispose(model.active.distinct().listen(ok => {
      if (ok) {
        pushedLeaf = EmptyLeaf.create(null, this.model);
        layout.addBox(pushedLeaf);
      } else if (pushedLeaf) {
        layout.destroy(pushedLeaf);
      }
    }));
  }

  public buildDom() {
    const obsRects = Observable.create(this, [] as Array<VRect|null>);
    return (this._rootElement = cssVirtualZone(
      // We are only rendered when mouse is over the tray and it has some dragged leaf with it.
      dom.maybeOwned(this.model.over.state, (owner) => {
        // Get the bounding rect of the rootElement, virtual rects are relative, so we will be
        // adjusting coordinates.
        const root = this._rootElement.getBoundingClientRect();
        // We store rects in an observable, that might be used to visualize the zones.
        // Create the mouseMove listener.
        const listener = async (e: MouseEvent) => {
          if (owner.isDisposed() || this._isAnimating()) {
            return;
          }
           // If there are some previous rects (from previous calculation), test if we are still in one of them.
          if (this._lastTarget) {
            const stillThere = obsRects.get()[this._lastIndex]?.contains(e);
            if (stillThere) {
              return;
            }
          }
          // Calculate the virtual zones.
          obsRects.set(this._calculate(root));
          // Find the one under the mouse.
          const underMouse = obsRects.get().findIndex((x) => x?.contains(e));
          // If it is still the same, do nothing.
          if (underMouse === this._lastIndex) { return; }
          // If we found something, insert a drop target.
          if (underMouse !== -1) {
            this._insertDropTarget(underMouse)
              .catch((err) => console.error(`Failed to insert zone:`, err)); // This should not happen.
            return;
          }
          // We haven't found anything, remove the last drop target.
          this._removeDropZone().catch((err) => console.error(`Failed to remove zone:`, err));// This should not happen.
        };
        G.window.addEventListener('mousemove', listener);
        // When mouse leaves, we need to remove the last drop target.
        owner.onDispose(() => {
          this._removeDropZone().catch((err) => console.error(`Failed to remove zone:`, err));// This should not happen.
        });
        owner.onDispose(() => G.window.removeEventListener('mousemove', listener));
        // For debugging, we can show the virtual zones.
        const show = false;
        return !show ? null : dom.domComputed(
          obsRects,
          rects => rects.filter(isNonNullish).map((rect: VRect) => cssVirtualPart(
            {style: `left: ${rect.left}px; width: ${rect.width}px; top: ${rect.top}px; height: ${rect.height}px;`}
        )));
      })
    ));
  }

  private _start() {
    this._animation.set(this._animation.get() + 1);
  }
  private _stop() {
    this._animation.set(this._animation.get() - 1);
  }
  private _isAnimating() {
    return this._animation.get() > 0;
  }
  private _calculate(parentRect: DOMRect) {
    const boxes = this.model.layout.all();
    const rects: Array<VRect|null> = [];
    // Boxes can be wrapped, we will detect the line offset.
    let lineOffset = 12;
    // We will always have at least one box, so we can use it to get the height.
    const height = boxes[0]?.rootElement.getBoundingClientRect().height;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      const prev = boxes[i - 1];
      const next = boxes[i + 1];

      // First handle edge cases (don't add targets for first elements in next lines), it will mess up the wrapping.
      if (prev && prev?.rootElement.offsetTop !== box.rootElement.offsetTop) {
        rects.push(null);
        continue;
      }

      // Now handle normal cases.
      const root = box.rootElement;
      lineOffset = root.offsetTop;

      if (i === 0 && box instanceof CollapsedLeaf) {
        // For the first one, we have very little rectangle, from the left + 50px past the left border.
        const left = 0;
        const right = root.offsetLeft + 50;
        rects.push(new VRect(parentRect, { left, top: lineOffset, right, height }));
      } else if (box instanceof CollapsedLeaf && i === boxes.length - 1) {
        // Last one is very similar, little rectangle on the left part.
        const left = root.offsetLeft + root.offsetWidth - 30;
        const right = root.offsetLeft + root.offsetWidth + 30;
        rects.push(new VRect(parentRect, { left, top: lineOffset, right, height }));
      } else if (box instanceof CollapsedLeaf && prev instanceof CollapsedLeaf) {
        // In between, we have a rectangle from the left border to the right border.
        const leftRoot = prev.rootElement;
        const rightRoot = root;
        const left = leftRoot.offsetLeft + leftRoot.offsetWidth - 30;
        const right = rightRoot.offsetLeft + 30;
        rects.push(new VRect(parentRect, { left, top: lineOffset, right, height }));
      } else if (next && box instanceof TargetLeaf && i === 0) {
        // If this is a first box and it is a target, the first rectangle will be much larger, it should cover
        // the TargetLeaf width.
        const left = 0;
        const right = next.rootElement.offsetLeft;
        rects.push(new VRect(parentRect, { left, top: lineOffset, right, height }));
      } else if (box instanceof TargetLeaf && prev instanceof CollapsedLeaf && next instanceof CollapsedLeaf) {
        // If this box is target between two collapsed boxes, we will have a rectangle from the prev to next
        // covering the whole target leaf.
        const left = prev.rootElement.offsetLeft + prev.rootElement.offsetWidth - 30;
        const right = next.rootElement.offsetLeft + 30;
        rects.push(new VRect(parentRect, { left, top: lineOffset, right, height }));
      }
    }
    return rects;
  }
  private async _insertDropTarget(index: number) {
    this._start();
    try {
      await this._lastTarget?.remove();
      this._lastTarget = TargetLeaf.create(null, this.model);
      await this._lastTarget.insert(index);
      this._lastIndex = index;
    } finally {
      this._stop();
    }
  }
  private async _removeDropZone() {
    if (!this._lastTarget) { return; }
    this._start();
    try {
      await this._lastTarget?.remove();
      this._lastTarget = undefined;
      this._lastIndex = -1;
    } finally {
      this._stop();
    }
  }
}


/**
 * UI component that renders and owns all the collapsed leaves.
 */
class CollapsedLayout extends Disposable {
  public rootElement: HTMLElement;
  /**
   * Leaves owner. Adding or removing leaves will not dispose them automatically, as they are released and
   * return to the caller. Only those leaves that were not removed will be disposed with the layout.
   */
  public holder = ArrayHolder.create(this);
  /**
   * Number of leaves in the layout.
   */
  public count: Computed<number>;

  private _boxes = this.autoDispose(obsArray<Leaf>());

  constructor(protected model: LayoutTray) {
    super();

    // Whenever we add or remove box, update the model. This is used to test if the section is collapsed or not.
    this._boxes.addListener(l => model.viewLayout.viewModel.activeCollapsedSections(this.leafIds()));

    this.count = Computed.create(this, use => use(this._boxes).length);
  }

  public all() {
    return this._boxes.get();
  }

  public buildLayout(leafs: number[]) {
    if (isEqual(leafs, this._boxes.get().map((box) => box.id.get()))) { return []; }
    const removed = this._boxes.splice(0, this._boxes.get().length,
      ...leafs.map((id) => CollapsedLeaf.create(this.holder, this.model, id)));
    removed.forEach((box) => this.holder.release(box));
    return removed;
  }

  public addBox(id: number|Leaf, index?: number) {
    index ??= -1;
    const box = typeof id === 'number' ? CollapsedLeaf.create(this.holder, this.model, id): id;
    if (typeof id !== 'number') {
      this.holder.autoDispose(box);
    }
    return this.insert(index, box);
  }

  public indexOf(box: Leaf) {
    return this._boxes.get().indexOf(box);
  }

  public insert(index: number, leaf: Leaf) {
    this.holder.autoDispose(leaf);
    if (index < 0) {
      this._boxes.push(leaf);
    } else {
      this._boxes.splice(index, 0, leaf);
    }
    return leaf;
  }

  /**
   * Removes the leaf from the list but doesn't dispose it.
   */
  public remove(leaf: Leaf) {
    const index = this._boxes.get().indexOf(leaf);
    if (index >= 0) {
      const removed = this._boxes.splice(index, 1)[0];
      if (removed) {
        this.holder.release(removed);
      }
      return removed || null;
    }
    return null;
  }

  /**
   * Removes and dispose the leaf from the list.
   */
  public destroy(leaf: Leaf) {
    this.remove(leaf)?.dispose();
  }

  public leafIds() {
    return this._boxes.get().map(l => l.id.get()).filter(x => x && typeof x === 'number');
  }

  public getBox(leaf: number): CollapsedLeaf|undefined {
    return this._boxes.get().find(l => l.id.get() === leaf) as CollapsedLeaf|undefined;
  }

  public buildDom() {
    return (this.rootElement = cssLayout(
      testId('layout'),
      useDragging(),
      dom.hide(use => use(this._boxes).length === 0),
      dom.forEach(this._boxes, line => line.buildDom())
    ));
  }
}

interface Draggable {
  dragStart?: (ev: DragEvent, floater: MiniFloater) => Draggable|null;
  dragEnd?: (ev: DragEvent, floater: MiniFloater) => void;
  drag?: (ev: DragEvent, floater: MiniFloater) => void;
  drop?: (ev: DragEvent, floater: MiniFloater) => void;
}

interface Dropped {
  removeFromLayout(): void;
  leafId(): number;
}

/**
 * Base class for all the leaves in the layout tray.
 */
abstract class Leaf extends Disposable {
  public id = Observable.create(this, 0);
  public rootElement: HTMLElement;
  public buildDom(): HTMLElement|null {
    return null;
  }
}

/**
 * Empty leaf that is used to represent the empty space in the collapsed layout. Can be used to drop boxes.
 */
class EmptyLeaf extends Leaf {
  public name = Observable.create(this, 'empty');

  // If we are hovering over the empty leaf.
  private _onHover = Signal.create(this, false);

  constructor(protected model: LayoutTray) {
    super();
    this.monitorDrop();
  }

  public monitorDrop() {
    this.autoDispose(
      this.model.drop.listen((box) => {
        // If some box was dropped, and the cursor is over this leaf, we will add the box to the layout.
        if (!box || !this._onHover.state.get()) {
          return;
        }
        this.model.drop.state.set(null);
        // Replace the empty leaf with the dropped box.
        const myIndex = this.model.layout.indexOf(this);
        const leafId = box.leafId();
        this.model.layout.addBox(leafId, myIndex);
        box.removeFromLayout();
      })
    );
  }

  public buildDom() {
    return (this.rootElement = cssEmptyBox(
      cssEmptyBox.cls('-can-accept', this._onHover.state),
      syncHover(this._onHover),
      testId('empty-box'),
    ));
  }
}

/**
 * This is an empty leaf that supports animation when added to the list.
 */
class TargetLeaf extends EmptyLeaf {
  public buildDom() {
    this.name.set('target');
    const element = super.buildDom();
    dom.update(element,
      testId('target-box'),
      dom.cls(cssProbe.className),
      { style: 'width: 2px;' }
    );
    return element;
  }

  public insert(index: number) {
    // First insert the drop target leaf.
    this.model.layout.insert(index, this);
    // Force the reflow, so that we can start the animation.
    this.rootElement.getBoundingClientRect();
    // Start and wait for the animation to finish.
    return new Promise((resolve) => {
      const watcher = new TransitionWatcher(this.rootElement);
      watcher.onDispose(() => {
        resolve(undefined);
      });
      this.rootElement.style.width = '';
    });
  }

  public remove() {
    return new Promise((resolve) => {
      const watcher = new TransitionWatcher(this.rootElement);
      watcher.onDispose(() => {
        this.model.layout.destroy(this);
        resolve(undefined);
      });
      this.rootElement.style.width = '0px';
    });
  }
}

/**
 * This is the collapsed widget that is shown in the collapsed layout. It can be dragged and dropped.
 */
class CollapsedLeaf extends Leaf implements Draggable, Dropped {
  // The content of the leaf that is rendered. Stored in an observable so that we can update it when the
  // content changes or put it in the floater.
  private _content: Observable<HTMLElement|null> = Observable.create(this, null);

  // Computed to get the view instance from the viewSection.
  private _viewInstance: Computed<BaseView|null>;

  // An observable for the dom that holds the viewInstance and displays it in a hidden element.
  // This is owned by this leaf and is disposed separately from the dom that is returned by buildDom. Like a
  // singleton, this element will be moved from one "instance" (a result of buildDom) to another.
  // When a leaf is removed from the dom (e.g. when we remove the collapsed section or move it to the main area)
  // the dom of this element is disposed, but the hidden element stays with this instance and can be disposed
  // later on, giving anyone a chance to grab the viewInstance and display it somewhere else.
  private _hiddenViewInstance: Observable<HTMLElement|null> = Observable.create(this, null);

  // Helper to keeping track of the index of the leaf in the layout.
  private _indexWhenDragged = 0;

  // A helper variable that indicates that this section is in a popup, and we should
  // make any attempt to grab it and attach to our dom. Note: this is not a computed variable.
  private _detached = false;

  constructor(protected model: LayoutTray, id: number) {
    super();
    this.id.set(id);
    this._viewInstance = Computed.create(this, use => {
      const sections = use(use(this.model.viewLayout.viewModel.viewSections).getObservable());
      const view = sections.find(s => use(s.id) === use(this.id));
      if (!view) { return null; }
      const instance = use(view.viewInstance);
      return instance;
    });
    this._buildHidden();
    this.onDispose(() => {
      const instance = this._hiddenViewInstance.get();
      instance && dom.domDispose(instance);
    });
  }

  public detach() {
    this._detached = true;
  }

  public attach() {
    this._detached = false;
    const previous = this._hiddenViewInstance.get();
    this._buildHidden();
    previous && dom.domDispose(previous);
  }

  public buildDom() {
    this._content.set(this.model.buildContentDom(this.id.get()));
    return this.rootElement = cssBox(
      testId('leaf-box'),
      dom.domComputed(this._content, c => c),
      // Add draggable interface.
      asDraggable(this),
      dom.on('click', (e) => {
        this.model.viewLayout.viewModel.activeCollapsedSectionId(this.id.get());
        // Sanity (and type) check.
        if (!(e.target instanceof HTMLElement)) {
          return;
        }
        // If the click not landed in a draggable-handle ignore it. Might be a click to open the menu.
        if (!e.target.closest('.draggable-handle')) {
          return;
        }
        // Apparently the click was to open the section in the popup. Use the anchor link to do that.
        // Show my section on a popup using anchor link. We can't use maximize section for it, as we
        // would need to rebuild the layout (as this is not a part of it).
        urlState().pushUrl({
          hash: {
            sectionId: this.id.get(),
            popup: true
          }
        }).catch(() => {});
        e.preventDefault();
        e.stopPropagation();
      }),
      detachedNode(this._hiddenViewInstance),
    );
  }

  // Implement the drag interface. All those methods are called by the draggable helper.

  public dragStart(ev: DragEvent, floater: MiniFloater) {
    // Get the element.
    const myElement = this._content.get();
    this._content.set(null);
    floater.content.set(myElement);
    // Create a clone.
    const clone = CollapsedLeaf.create(floater, this.model, this.id.get());
    clone._indexWhenDragged = this.model.layout.indexOf(this);
    this.model.drag.emit(clone);

    // Remove self from the layout (it will dispose this instance, but the viewInstance was moved to the floater)
    this.model.layout.destroy(this);
    return clone;
  }

  public dragEnd(ev: DragEvent) {
    this.model.drag.emit(null);
  }

  public drag(ev: DragEvent) {
    this.model.dragging.emit(ev);
  }

  public drop(ev: DragEvent, floater: MiniFloater) {
    // Take back the element.
    const element = floater.content.get();
    floater.content.set(null);
    this._content.set(element);
    this.model.drop.emit(this);
    // If I wasn't moved somewhere else, read myself back.
    if (this.id.get() !== 0) {
      this.model.layout.addBox(this.id.get(), this._indexWhenDragged);
    }
  }

  public removeFromLayout() {
    // Set the id to 0 so that the layout doesn't try to read me back.
    this.id.set(0);
    this.model.layout.destroy(this);
  }

  public leafId() {
    return this.id.get();
  }

  private _buildHidden() {
    this._hiddenViewInstance.set(cssHidden(dom.maybe(this._viewInstance, view => {
      return this._detached ? null : view.viewPane;
    })));
  }
}

/**
 * This is analogous component to the main Floater in the LayoutEditor. It holds the little preview of a widget,
 * while it is dragged.
 */
class MiniFloater extends Disposable {
  public content: Observable<HTMLElement|null> = Observable.create(this, null);
  public rootElement: HTMLElement;
  constructor() {
    super();
    this.rootElement = this.buildDom();
    G.document.body.appendChild(this.rootElement);
    this.onDispose(() => {
      this.rootElement.remove();
      dom.domDispose(this.rootElement);
    });
  }

  public buildDom() {
    return cssMiniFloater(
      dom.show(use => Boolean(use(this.content))),
      // dom.cls('layout_editor_floater'),
      dom.domComputed(this.content, c => c)
    );
  }

  public onMove(ev: MouseEvent) {
    if (this.content.get()) {
      this.rootElement.style.left = `${ev.clientX}px`;
      this.rootElement.style.top = `${ev.clientY}px`;
    }
  }
}

/**
 * ExternalLeaf pretends that it is a collapsed leaf and acts as a proxy between collapsed tray and the
 * ViewLayout.
 */
class ExternalLeaf extends Disposable implements Dropped {
  // If external element is in drag mode
  public drag: Signal<Dropped>;
  // Event when external leaf is being dragged.
  public dragMove: Signal<MouseEvent>;

  // Event when external leaf is dropped.
  private _drop: Signal<ContentBox>;

  constructor(protected model: LayoutTray) {
    super();
    // Wire up external events to mimic that we are a part.

    // First we will replace all events, so that they won't emit anything if we are the only leaf
    // in the layout.
    const multipleLeaves = () => this.model.viewLayout.layout.getAllLeafIds().length > 1;

    this.drag = Signal.fromEvents(this, this.model.viewLayout.layoutEditor, 'dragStart', 'dragEnd')
                      .filter(multipleLeaves);

    this._drop = Signal.fromEvents(this, this.model.viewLayout.layoutEditor, 'dragDrop')
                      .filter(multipleLeaves);

    this.dragMove = Signal.fromEvents(this, this.model.viewLayout.layoutEditor, 'dragMove')
                          .filter(multipleLeaves);

    // Now bubble up those events to the model.

    // For dragging we just need to know that it is on or off.
    this.drag.map(box => {
      // We are tricking the model, we report that we are dragged, not the external leaf.
      return box ? this as Dropped : null;
    }).distinct().pipe(this.model.drag);


    // When the external box is dropped, we will pretend that we were dropped.
    this._drop.map(x => this as Dropped|null).pipe(this.model.drop);

    // Listen to the inDrag state in the model, if the dragged element is not us, update
    // target hits. Otherwise target hits will be updated by the viewLayout.
    this.autoDispose(model.dragging.listen(ev => {
      // If the dragged box is not us, we need to update the targets.
      if (ev && model.drag.state.get() !== this) {
        this.model.viewLayout.layoutEditor.updateTargets(ev);
      }
    }));

    // When drag is started by tray, we need to fire up user edit event. This is only needed
    // because the viewLayout has a different UI when user is editing.
    const miniDrag = Signal.compute(this, on => on(model.drag) && !on(this.drag)).map(Boolean).distinct();
    this.autoDispose(miniDrag.listen(box => {
      if (box) {
        this.model.viewLayout.layoutEditor.triggerUserEditStart();
      } else {
        const dropTargeter = this.model.viewLayout.layoutEditor.dropTargeter;
        dropTargeter.removeTargetHints();
        // Save the layout immediately after the drop. Otherwise we would wait a bit,
        // and the section won't be created on time.
        this.model.viewLayout.layoutEditor.triggerUserEditStop();
        // Manually save the layout.
        this.model.viewLayout.saveLayoutSpec();
      }
    }));


    // We are responsible for saving the layout, when section is collapsed or expanded.

    // Also we need to monitor when mini leaf is dropped, it will trigger a drop event,
    // but non-one will listen to it.
    this.autoDispose(
      model.drop.listen(dropped => {
        if (!dropped) {
          return;
        }
        // If I was dropped (collapsed) over the tray, we don't need to do anything here.
        // Our leaf was removed already and the layout will be saved by the miniDrag event.

        // If I was dropped anywhere else, we don't need to do anything either, viewLayout will
        // take care of it.
        if (dropped === this) {
          return;
        }
        // We only care when collapsed widget was dropped over the main area.
        const externalEditor = this.model.viewLayout.layoutEditor;
        const dropTargeter = this.model.viewLayout.layoutEditor.dropTargeter;
        // Check that it was dropped over the main area.
        if (dropTargeter?.activeTarget && !dropTargeter?.activeTarget?.box.isDisposed()) {
          // Remove the widget from the tray, and at new leaf to the layout.
          const part = dropTargeter.activeTarget;
          dropTargeter.removeTargetHints();
          const leaf = dropped.leafId();
          const box = externalEditor.layout.buildLayoutBox({leaf});
          dropped.removeFromLayout();
          if (part.isChild) {
            part.box.addChild(box, part.isAfter);
          } else {
            part.box.addSibling(box, part.isAfter);
          }
          this.model.viewLayout.viewModel.activeSectionId(leaf);
          this.model.drop.state.set(null);
        }
      })
    );
    this._replaceFloater();
  }

  /**
   * Dropped interface implementation, it is called only when a section in the main area is collapsed (dragged
   * onto the valid target in the tray).
   */
  public removeFromLayout() {
    const droppedBox = this._drop.state.get();
    if (!droppedBox) { return; }
    const leafId = this.leafId();
    const otherSection = this.model.viewLayout.layoutEditor
      .layout.getAllLeafIds().find(x => typeof x === 'number' && x !== leafId);
    this.model.viewLayout.viewModel.activeSectionId(otherSection);
    // We can safely remove the box, because we should be called after viewInstance is grabbed by
    // the tray.
    this.model.viewLayout.layoutEditor.doRemoveBox(droppedBox);
  }

  public leafId() {
    return this._drop.state.get()?.leafId.peek() || 0;
  }

  /**
   * Monitors the external floater element, and if it is on top of the collapsed tray, replaces its content.
   */
  private _replaceFloater() {
    const model = this.model;
    // We will replace floater just after it starts till it is about to be dropped.
    const period = Signal.fromEvents(model, model.viewLayout.layoutEditor, 'dragStart', 'dragStop');
    const overEditor = Signal.compute(model, on => Boolean(on(period) && on(model.over))).distinct();
    let lastContent: HTMLElement|null = null;
    let lastTransform: string|null = null;
    let lastX: number|null = null;
    let lastY: number|null = null;
    // When the external box is on top of the tray, we need to replace the content to be much smaller.
    model.autoDispose(
      overEditor.listen(over => {
        if (over) {
          const floater = model.viewLayout.layoutEditor.floater;
          const leafId = floater.leafId.peek();
          if (typeof leafId !== 'number') {
            return;
          }
          const content = floater.leafContent.peek() as HTMLElement;
          if (content) {
            lastContent = content;
            // Hide this element.
            content.style.display = 'none';
            // Create another element to show in the floater.
            const newContent = cssFloaterWrapper(content, buildCollapsedSectionDom({
              gristDoc: model.viewLayout.gristDoc,
              sectionRowId: leafId,
            }));
            floater.leafContent(newContent);
            lastTransform = floater.dom.style.transform;
            lastX = floater.mouseOffsetX;
            lastY = floater.mouseOffsetY;
            floater.dom.style.transform = 'none';
            floater.mouseOffsetX = 0;
            floater.mouseOffsetY = 0;
          }
        } else if (lastContent) {
          lastContent.style.display = '';
          const floater = model.viewLayout.layoutEditor.floater;
          const currentContent = floater.leafContent.peek() as HTMLElement;
          floater.leafContent(lastContent);
          if (currentContent) {
            dom.domDispose(currentContent);
          }
          lastContent = null;
          floater.dom.style.transform = lastTransform!;
          floater.mouseOffsetX = lastX!;
          floater.mouseOffsetY = lastY!;
        }
      })
    );
  }
}

/**
 * A class that holds an array of IDisposable objects, and disposes them all when it is disposed.
 * The difference from a MultipleHolder is that it can release individual disposables from the array.
 */
class ArrayHolder extends Disposable {
  private _array: IDisposable[] = [];

  constructor() {
    super();
    this.onDispose(() => {
      const seen = new Set();
      for (const obj of this._array) {
        if (!seen.has(obj)) {
          seen.add(obj);
          obj.dispose();
        }
      }
      this._array = [];
    });
  }

  public autoDispose<T extends IDisposable>(obj: T): T {
    this._array.push(obj);
    return obj;
  }

  public release(obj: IDisposable) {
    const index = this._array.indexOf(obj);
    if (index >= 0) {
      return this._array.splice(index, 1);
    }
    return null;
  }
}

function syncHover(obs: Signal) {
  return [dom.on('mouseenter', () => obs.emit(true)), dom.on('mouseleave', () => obs.emit(false))];
}

/**
 * Helper function that renders an element from an observable, but prevents it from being disposed.
 * Used to keep viewInstance from being disposed when it is added as a child in various containers.
 */
function detachedNode(node: Observable<HTMLElement|null>) {
  return [
    dom.maybe(node, n => n),
    dom.onDispose(() => node.get() && detachNode(node.get()))
  ];
}

/**
 * Finds element that is marked as draggable from the mouse event.
 */
function findDraggable(ev: EventTarget|null) {
  if (ev instanceof HTMLElement) {
    const target = ev.closest(".draggable-handle")?.closest(".draggable");
    return !target ? null : dom.getData(target, 'draggable') as Draggable;
  }
  return null;
}

/**
 * Marks a dom element as draggable. It sets a class and a data attribute that is looked up by the useDragging helper.
 */
function asDraggable(item: Draggable) {
  return [
    dom.cls('draggable'),
    dom.data('draggable', item)
  ];
}

/**
 * Attaches a mouse events for dragging to a parent container. This way we have a single mouse event listener
 * for all draggable elements. All events are then delegated to the draggable elements.
 *
 * When a drag is started a MiniFloater is created, and the draggable element can be moved to the floater.
 */
function useDragging() {
  return (el: HTMLElement) => {
    // Implement them by hand, using mouseenter, mouseleave, and mousemove events.
    // This is a inspired by LayoutEditor.ts.
    let justStarted = false;
    let isDragging = false;
    let dragged: Draggable|null = null;
    let floater: MiniFloater|null = null;
    let downX: number|null = null;
    let downY: number|null = null;
    const listener = (ev: MouseEvent) => {
      switch (ev.type) {
        case 'mousedown':
          // Only handle left button.
          if (ev.button !== 0) {
            return;
          }
          // If we haven't found a draggable element, return.
          dragged = findDraggable(ev.target);
          if (!dragged) {
            return;
          }
          // If we had floater, dispose it.
          floater?.dispose();
          floater = new MiniFloater();
          // Start drag and attach mousemove and mouseup listeners.
          justStarted = true;
          G.$(G.window).on('mousemove', mouseMoveListener);
          G.$(G.window).on('mouseup', mouseUpListener);
          downX = ev.clientX;
          downY = ev.clientY;
          return false;
        case 'mouseup':
          if (!dragged) {
            return;
          }
          justStarted = false;
          G.$(G.window).off('mousemove', mouseMoveListener);
          G.$(G.window).off('mouseup', mouseUpListener);

          if (isDragging) {
            isDragging = false;
            if (dragged?.drop) {
              dragged.drop(ev as DragEvent, floater!);
            }
            if (dragged?.dragEnd) {
              dragged.dragEnd(ev as DragEvent, floater!);
            }
          }
          dragged = null;
          floater?.dispose();
          floater = null;
          return false;
        case 'mousemove':
          if (justStarted) {
            const slightMove = downX && downY &&
              (Math.abs(ev.clientX - downX) > 3 || Math.abs(ev.clientY - downY) > 3);
            if (slightMove) {
              justStarted = false;
              if (dragged?.dragStart) {
                // Drag element has an opportunity to return a new draggable object.
                dragged = dragged.dragStart(ev as DragEvent, floater!);
                if (!dragged) {
                  return;
                }
              }
              // Now we are dragging.
              isDragging = true;
            }
          }
          if (!isDragging) {
            return;
          }
          if (dragged?.drag) {
            dragged.drag(ev as DragEvent, floater!);
          }
          floater!.onMove(ev);
          return false;
      }
    };
    const mouseMoveListener = (ev: MouseEvent) => listener(ev);
    const mouseUpListener = (ev: MouseEvent) => listener(ev);
    dom.autoDisposeElem(el, dom.onElem(G.window, 'mousedown', (e) => listener(e)));
    dom.onDisposeElem(el, () => (floater?.dispose(), floater = null));
  };
}

/**
 * A virtual rectangle that is relative to a DOMRect.
 */
class VRect {
  public left: number;
  public width: number;
  public top: number;
  public right: number;
  public height: number;
  constructor(offset: DOMRect, params: Partial<VRect>) {
    Object.assign(this, params);
    this.left += offset.left;
    this.right += offset.left;
    this.top += offset.top;
    this.width = this.right - this.left;
  }
  public contains(ev: MouseEvent) {
    return ev.clientX >= this.left && ev.clientX <= this.right &&
      ev.clientY >= this.top && ev.clientY <= this.top + this.height;
  }
}

const cssVirtualZone = styled('div', `
  position: absolute;
  inset: 0;
`);


const cssFloaterWrapper = styled('div', `
  height: 40px;
  width: 140px;
  max-width: 140px;
  background: ${theme.tableBodyBg};
  border: 1px solid ${theme.widgetBorder};
  border-radius: 4px;
  -webkit-transform: rotate(5deg) scale(0.8) translate(-10px, 0px);
  transform: rotate(5deg) scale(0.8) translate(-10px, 0px);
  & .mini_section_container {
    overflow: hidden;
    white-space: nowrap;
  }
`);

const cssCollapsedTray = styled('div.collapsed_layout', `
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: height 0.2s;
  position: relative;
  margin: calc(-1 * var(--view-content-page-padding, 12px));
  margin-bottom: 0;
  user-select: none;
  background-color: ${theme.pageBg};
  border-bottom: 1px solid ${theme.pagePanelsBorder};
  outline-offset: -1px;

  &-is-active {
    outline: 2px dashed ${theme.widgetBorder};
  }
  &-is-target {
    outline: 2px dashed #7B8CEA;
    background: rgba(123, 140, 234, 0.1);
  }
`
);

const cssRow = styled('div', `display: flex`);
const cssLayout = styled(cssRow, `
  padding: 8px 24px;
  column-gap: 16px;
  row-gap: 8px;
  flex-wrap: wrap;
  position: relative;
`);

const cssBox = styled('div', `
  border: 1px solid ${theme.widgetBorder};
  border-radius: 3px;
  background: ${theme.widgetBg};
  min-width: 120px;
  min-height: 34px;
  cursor: pointer;
`);

const cssEmptyBox = styled('div', `
  text-align: center;
  text-transform: uppercase;
  color: ${theme.widgetBorder};
  font-weight: bold;
  letter-spacing: 1px;
  border: 2px dashed ${theme.widgetBorder};
  border-radius: 3px;
  padding: 8px;
  width: 120px;
  min-height: 34px;
  &-can-accept {
    border: 2px dashed #7B8CEA;
    background: rgba(123, 140, 234, 0.1);
  }
`);

const cssProbe = styled('div', `
  min-width: 0px;
  padding: 0px;
  transition: width 0.2s ease-out;
`);

const cssMiniFloater = styled(cssBox, `
  pointer-events: none;
  position: absolute;
  overflow: hidden;
  pointer-events: none;
  z-index: 10;
  -webkit-transform: rotate(5deg) scale(0.8);
  transform: rotate(5deg) scale(0.8);
  transform-origin: top left;
`);

const cssVirtualPart = styled('div', `
  outline: 1px solid blue;
  position: absolute;
  z-index: 10;
  background: rgba(0, 0, 0, 0.1);
`);

const cssHidden = styled('div', `display: none;`);
