import {Disposable, dom, Listener, Observable, styled} from 'grainjs';
import {mod} from 'app/common/gutil';
import {SpecialDocPage} from 'app/common/gristUrls';
import isEqual from 'lodash/isEqual';
import {makeT} from 'app/client/lib/localization';
import * as commands from 'app/client/components/commands';
import {triggerFocusGrab} from 'app/client/components/Clipboard';
import {App} from 'app/client/ui/App';
import {GristDoc} from 'app/client/components/GristDoc';
import {theme} from 'app/client/ui2018/cssVars';
import BaseView from 'app/client/components/BaseView';

const t = makeT('RegionFocusSwitcher');

type Panel = 'left' | 'top' | 'right' | 'main';
interface PanelRegion {
  type: 'panel',
  id: Panel // this matches a dom element id
}
interface SectionRegion {
  type: 'section',
  id: any // this matches a grist document view section id
}
type Region = PanelRegion | SectionRegion;
type StateUpdateInitiator = {type: 'cycle'} | {type: 'mouse', event?: MouseEvent};
interface State {
  region?: Region;
  initiator?: StateUpdateInitiator;
}

/**
 * RegionFocusSwitcher enables keyboard navigation between app panels and doc widgets.
 *
 * It also follow mouse clicks to focus panels accordingly.
 */
export class RegionFocusSwitcher extends Disposable {
  // State with currently focused region
  private readonly _state: Observable<State>;

  private _gristDocObs: Observable<GristDoc | null>;
  // Previously focused elements for each panel (not used for view section ids)
  private _prevFocusedElements: Record<Panel, Element | null> = {
    left: null,
    top: null,
    right: null,
    main: null,
  };

  private _initiated: Observable<boolean>;
  private _initListener?: Listener;

  constructor(private _app: App) {
    super();
    this._state = Observable.create(this, {
      region: undefined,
      initiator: undefined,
    });
    this._initiated = Observable.create(this, false);
  }

  public init(pageContainer: HTMLElement) {
    if (this._initiated.get()) {
      if (this._initListener && !this._initListener.isDisposed()) {
        this._initListener.dispose();
      }
      return;
    }

    if (this._app.pageModel?.gristDoc) {
      this._gristDocObs = this._app.pageModel.gristDoc;
    }

    // if we have a grist doc, wait for it to be ready before doing anything
    if (this._gristDocObs && this._gristDocObs.get() === null) {
      this._initListener = this._gristDocObs.addListener((doc, prevDoc) => {
        if (doc && prevDoc === null) {
          doc.regionFocusSwitcher = this;
          this.init(pageContainer);
        }
      });
      return;
    }

    this.autoDispose(commands.createGroup({
      nextRegion: () => this._cycle('next'),
      prevRegion: () => this._cycle('prev'),
      creatorPanel: () => this._toggleCreatorPanel(),
      cancel: this._onEscapeKeypress.bind(this),
    }, this, true));

    this.autoDispose(this._state.addListener(this._onStateChange.bind(this)));

    const focusActiveSection = () => this.focusActiveSection();
    this._app.on('clipboard_focus', focusActiveSection);
    this.onDispose(() => this._app.off('clipboard_focus', focusActiveSection));

    if (this._gristDocObs) {
      const onClick = this._onClick.bind(this);
      pageContainer.addEventListener('mouseup', onClick);
      this.onDispose(() => pageContainer.removeEventListener('mouseup', onClick));
    }

    this._initiated.set(true);
  }

  public focusRegion(
    region: Region | undefined,
    options: {initiator?: StateUpdateInitiator} = {}
  ) {
    if (region?.type === 'panel' && !getPanelElement(region.id)) {
      return;
    }

    const gristDoc = this._getGristDoc();
    if (gristDoc && region?.type === 'panel' && region?.id === 'main') {
      throw new Error('main panel is not supported when a view layout is rendered');
    }
    if (!gristDoc && region?.type === 'section') {
      throw new Error('view section id is not supported when no view layout is rendered');
    }

    this._state.set({region, initiator: options.initiator});
  }

  public focusActiveSection() {
    const gristDoc = this._getGristDoc();
    if (gristDoc) {
      this.focusRegion({type: 'section', id: gristDoc.viewModel.activeSectionId()});
    }
  }

  public reset() {
    this.focusRegion(undefined);
  }

  public panelAttrs(id: Panel, ariaLabel: string) {
    return [
      dom.attr('role', 'region'),
      dom.attr('aria-label', ariaLabel),
      dom.attr(ATTRS.regionId, id),
      dom.cls('kb-focus-highlighter-group', use => {
        const initiated = use(this._initiated);
        if (!initiated) {
          return false;
        }

        // highlight focused elements everywhere except in the grist doc views
        if (id !== 'main') {
          return true;
        }
        const gristDoc = this._gristDocObs ? use(this._gristDocObs) : null;
        if (!gristDoc) {
          return true;
        }
        if (gristDoc) {
          use(gristDoc.activeViewId);
        }
        return isSpecialPage(gristDoc);
      }),
      dom.cls(use => {
        const initiated = use(this._initiated);
        if (!initiated) {
          return '';
        }

        const gristDoc = this._gristDocObs ? use(this._gristDocObs) : null;
        // if we are not on a grist doc, whole page is always focusable
        if (!gristDoc) {
          return 'clipboard_group_focus';
        }

        // on a grist doc, panel content is focusable only if it's the current region
        const current = use(this._state).region;
        if (current?.type === 'panel' && current.id === id) {
          return 'clipboard_group_focus';
        }
        if (gristDoc) {
          use(gristDoc.activeViewId);
        }
        // on a grist doc, main panel is focusable only if we are not the actual document view
        if (id === "main") {
          return isSpecialPage(gristDoc)
            ? 'clipboard_group_focus'
            : 'clipboard_forbid_focus';
        }
        return '';
      }),
      dom.cls(`${cssFocusedPanel.className}-focused`, use => {
        const initiated = use(this._initiated);
        if (!initiated) {
          return false;
        }

        const current = use(this._state);
        return current.initiator?.type === 'cycle' && current.region?.type === 'panel' && current.region.id === id;
      }),
    ];
  }

  /**
   * this is smelly code that is just here because I don't initialize the region focus switcher correctly…
   */
  public onAppPageModelUpdate() {
    if (this._app.pageModel?.gristDoc) {
      this._gristDocObs = this._app.pageModel.gristDoc;
    }
  }

  private _cycle(direction: 'next' | 'prev') {
    const gristDoc = this._getGristDoc();
    const cycleRegions = getCycleRegions(gristDoc);
    this.focusRegion(getSibling(
      this._state.get().region,
      cycleRegions,
      direction,
      gristDoc
    ), {initiator: {type: 'cycle'}});
    if (gristDoc) {
      maybeNotifyAboutCreatorPanel(gristDoc, cycleRegions);
    }
  }

  /**
   * When clicking on a grist doc page:
   *   - if necessary, make it easier to tab through things inside panels by "unfocusing" the view section,
   *   - make sure the internal current region info is set when user clicks on the view layout.
   */
  private _onClick(event: MouseEvent) {
    const gristDoc = this._getGristDoc();
    if (!gristDoc) {
      return;
    }
    const closestRegion = (event.target as HTMLElement)?.closest(`[${ATTRS.regionId}]`);
    if (!closestRegion) {
      return;
    }
    const targetRegionId = closestRegion.getAttribute(ATTRS.regionId);
    const targetsMain = targetRegionId === 'main';
    const current = this._state.get().region;
    const currentlyInSection = current?.type === 'section';

    console.log('mhl onClick', {event, closestRegion, targetRegionId, current, currentlyInSection});

    if (targetsMain && !currentlyInSection) {
      this.focusRegion(
        {type: 'section', id: gristDoc.viewModel.activeSectionId()},
        {initiator: {type: 'mouse', event}}
      );
      return;
    }

    const focusPanel = () => {
      this.focusRegion(
        {type: 'panel', id: targetRegionId as Panel},
        {initiator: {type: 'mouse', event}}
      );
    };

    // When not targeting the main panel, we don't always want to focus the given region _on click_.
    // We only do it if clicking an empty area in the panel, or a focusable element like an input.
    // Otherwise, we assume clicks are on elements like buttons or links,
    // and we don't want to lose focus of current section in this case.
    // For example I don't want to focus out current table if just click the "undo" button in the header.
    if (!targetsMain && isFocusableElement(event.target)) {
      focusPanel();
    }

    if (!targetsMain && getPanelElement(targetRegionId as Panel) === event.target) {
      focusPanel();
    }
  }

  private _onEscapeKeypress() {
    const {region: current, initiator} = this._state.get();
    // Do nothing if we are not focused on a panel
    if (current?.type !== 'panel') {
      return;
    }
    const comesFromKeyboard = initiator?.type === 'cycle';
    const panelElement = getPanelElement(current.id);
    const activeElement = document.activeElement;
    const activeElementIsInPanel = panelElement?.contains(activeElement) && activeElement !== panelElement;

    if (
      // Focus back the panel element itself if currently focused element is a child
      activeElementIsInPanel
      // Specific case: when we escape inputs from panels, this isn't called, and focus switches back to body.
      // If user presses escape again, we also want to focus the panel.
      || (activeElement === document.body && panelElement)
    ) {
      if (comesFromKeyboard) {
        panelElement?.setAttribute('tabindex', '-1');
        panelElement?.focus();
        if (activeElementIsInPanel) {
          this._prevFocusedElements[current.id] = null;
        }
      } else {
        this.reset();
      }
      return;
    }

    // …Reset region focus switch if already on the panel itself
    if (document.activeElement === panelElement) {
      this.reset();
    }
  }

  /**
   * Save previous panel's focused element for later. Not necessary for view sections
   */
  private _savePrevElementState(prev: Region | undefined) {
    const prevIsPanel = prev?.type === 'panel';
    if (!prevIsPanel) {
      return;
    }
    const prevPanelElement = getPanelElement(prev.id);
    const isChildOfPanel = prevPanelElement?.contains(document.activeElement)
      && document.activeElement !== prevPanelElement;
    if (!isChildOfPanel) {
      return;
    }
    this._prevFocusedElements[prev.id] = document.activeElement;
  }

  private _onStateChange(current: State | undefined, prev: State | undefined) {
    if (isEqual(current, prev)) {
      return;
    }

    const gristDoc = this._getGristDoc();
    const mouseEvent = current?.initiator?.type === 'mouse'
      ? current.initiator.event
      : undefined;

    removeFocusRings();
    removeTabIndexes();
    if (!mouseEvent) {
      this._savePrevElementState(prev?.region);
      if (prev?.region?.type === 'panel') {
        blurPanelChild(prev.region);
      }
    }

    const isPanel = current?.region?.type === 'panel';
    const panelElement = isPanel && current.region?.id && getPanelElement(current.region.id);

    // actually focus panel element if using keyboard
    if (!mouseEvent && isPanel && panelElement && current.region) {
      focusPanel(
        current.region as PanelRegion,
        this._prevFocusedElements[current.region.id as Panel] as HTMLElement | null,
        gristDoc
      );
    }

    // just make sure view layout commands are disabled if we click on a panel
    if (mouseEvent && isPanel && panelElement && gristDoc) {
      escapeViewLayout(gristDoc, !!(mouseEvent.target as Element)?.closest(`[${ATTRS.regionId}="right"]`));
    }

    if (current?.region?.type === 'section' && gristDoc) {
      focusSection(current.region, gristDoc);
    }

    if (current === undefined && gristDoc) {
      focusViewLayout(gristDoc);
    }

    // if we reset the focus switch, clean all necessary state
    if (current === undefined) {
      this._prevFocusedElements = {
        left: null,
        top: null,
        right: null,
        main: null,
      };
    }
  }

  private _toggleCreatorPanel() {
    const current = this._state.get().region;
    const gristDoc = this._getGristDoc();
    if (current?.type === 'panel' && current.id === 'right') {
      return this.focusRegion(gristDoc
        ? {type: 'section', id: gristDoc.viewModel.activeSectionId()}
        : {type: 'panel', id: 'main'},
        {initiator: {type: 'cycle'}}
      );
    }
    commands.allCommands.rightPanelOpen.run();
    return this.focusRegion({type: 'panel', id: 'right'}, {initiator: {type: 'cycle'}});
  }

  /**
   * Returns the grist doc only if its has a view layout, meaning it has view sections.
   *
   * If there is a grist doc but no view sections, it certainly means we are on a grist-doc special page and
   * we want to handle kb focus like non-docs pages.
   */
  private _getGristDoc() {
    const doc = !!this._gristDocObs && !this._gristDocObs.isDisposed()
      ? this._gristDocObs.get()
      : null;
    if (!isSpecialPage(doc)) {
      return doc;
    }
    return null;
  }
}

/**
 * Helper to declare view commands that should also focus current view.
 *
 * Used by a view when registering command groups.
 */
export const viewCommands = (commandsObject: Record<string, Function>, context: BaseView) => {
  return Object.keys(commandsObject).reduce<Record<string, Function>>((acc, key) => {
    const originalCommand = commandsObject[key];
    acc[key] = function(...args: any[]) {
      context.gristDoc.regionFocusSwitcher?.focusActiveSection();
      return originalCommand.apply(context, args);
    };
    return acc;
  }, {});
};

const ATTRS = {
  regionId: 'data-grist-region-id',
  focusedElement: 'data-grist-region-focused-el',
};

/**
 * Focus the given panel (or the given element inside it, if any), and let the grist doc view know about it.
 */
const focusPanel = (panel: PanelRegion, child: HTMLElement | null, gristDoc: GristDoc | null) => {
  const panelElement = getPanelElement(panel.id);
  if (!panelElement) {
    return;
  }
  // No child to focus found: just focus the panel
  if (!child || child === panelElement || !child.isConnected) {
    // tabindex is dynamically set instead of always there for a reason:
    // if we happen to just click on a non-focusable element inside the panel,
    // browser default behavior is to make document.activeElement the closest focusable parent (the panel).
    // We don't want this behavior, so we add/remove the tabindex attribute as needed.
    panelElement.setAttribute('tabindex', '-1');
    panelElement.focus();
  }

  // Child element found: focus it
  if (child && child !== panelElement && child.isConnected) {
    // Visually highlight the element with similar styles than panel focus,
    // only for this time. This is here just to help the user better see the visual change when he switches panels.
    child.setAttribute(ATTRS.focusedElement, 'true');
    child.addEventListener('blur', () => {
      child.removeAttribute(ATTRS.focusedElement);
    }, {once: true});
    child.focus?.();
  }

  if (gristDoc) {
    // Creator panel is a special case "related to the view"
    escapeViewLayout(gristDoc, panel.id === 'right');
  }
};

const focusViewLayout = (gristDoc: GristDoc) => {
  triggerFocusGrab();
  gristDoc.viewModel.focusedRegionState('in');
};

// When going out of the view layout, default view state is 'out' to remove active session
// borders and disable the view kb commands.
// You can specific a special case 'related' to the view. It still disable commands, but keeps
// the active session borders, so that user understands what session the current panel is related to.
const escapeViewLayout = (gristDoc: GristDoc, isRelated = false) => {
  gristDoc.viewModel.focusedRegionState(isRelated ? 'related' : 'out');
};

/**
 * Focus the given doc view section id
 */
const focusSection = (section: SectionRegion, gristDoc: GristDoc) => {
  focusViewLayout(gristDoc);
  gristDoc.viewModel.activeSectionId(section.id);
};

/**
 * Get all regions we can currently cycle through.
 *
 * Depending on whether a view layout is currently rendered, it returns only panels, or panels and sections.
 */
const getCycleRegions = (gristDoc: GristDoc | null): Region[] => {
  const commonPanels = [
    getPanelElement('left') ? {type: 'panel', id: 'left'} as PanelRegion : null,
    getPanelElement('top') ? {type: 'panel', id: 'top'} as PanelRegion : null,
  ].filter((x): x is PanelRegion => Boolean(x));

  // If there is no doc with layout, just cycle through panels
  if (!gristDoc) {
    return [
      ...commonPanels,
      getPanelElement('main') ? {type: 'panel', id: 'main'} as PanelRegion : null,
    ].filter((x): x is PanelRegion => Boolean(x));
  }

  // If there is a doc, also cycle through section ids
  return [
    ...gristDoc.viewLayout?.layout.getAllLeafIds().map(id => ({type: 'section', id} as SectionRegion)) ?? [],
    ...commonPanels,
  ];
};

/**
 * Get the sibling region to focus in the regions given, compared to the current region and the direction.
 *
 * Exceptions:
 *   - If we happen to be on the creator panel, focus back to the view layout active section,
 *   - If we don't find anything, focus the first region in the cycle.
 */
const getSibling = (
  current: Region | undefined,
  regions: Region[],
  direction: 'next' | 'prev',
  gristDoc: GristDoc | null
): Region | undefined => {
  const isCreatorPanel = current?.type === 'panel' && current.id === 'right';

  // First normally try to get current region in the cycle
  let currentIndexInCycle = findRegionIndex(regions, current);

  // If it's not found, it certainly means there is no current region set yet.
  // In case of a grist doc, we can use the active section id as the "current index"
  if ((currentIndexInCycle === -1 || isCreatorPanel) && gristDoc) {
    currentIndexInCycle = findRegionIndex(regions, {type: 'section', id: gristDoc.viewModel.activeSectionId()});
  }
  // If we still don't find anything, it means we never set the current region before on a non-doc page,
  // or we didn't find any current doc section. Return the first region as default.
  if (currentIndexInCycle === -1) {
    return regions[0];
  }

  // Normal case: just return the next or previous region in the cycle, wrapping around
  const sibling = regions[mod(currentIndexInCycle + (direction === 'next' ? 1 : -1), regions.length)];
  return sibling;
};

/**
 * Blur the currently focused element in the given panel, if any.
 */
const blurPanelChild = (panel: PanelRegion) => {
  const panelElement = getPanelElement(panel.id);
  if (panelElement?.contains(document.activeElement) && document.activeElement !== panelElement) {
    (document.activeElement as HTMLElement).blur();
  }
};

const getPanelElement = (id: Panel): HTMLElement | null => {
  return document.querySelector(getPanelElementId(id));
};

const getPanelElementId = (id: Panel): string => {
  return `[${ATTRS.regionId}="${id}"]`;
};

const isFocusableElement = (el: EventTarget | null): boolean => {
  if (!el) {
    return false;
  }
  if (el instanceof HTMLElement && ['input', 'textarea', 'select', 'iframe'].includes(el.tagName.toLocaleLowerCase())) {
    return true;
  }
  if (el instanceof HTMLElement && el.getAttribute('tabindex') === "0") {
    return true;
  }
  return false;
};

/**
 * Remove the visual highlight on elements that are styled as focused elements of panels.
 */
const removeFocusRings = () => {
  document.querySelectorAll(`[${ATTRS.focusedElement}]`).forEach(el => {
    el.removeAttribute(ATTRS.focusedElement);
  });
};

const removeTabIndexes = () => {
  document.querySelectorAll(`[${ATTRS.regionId}]`).forEach(el => {
    el.removeAttribute('tabindex');
  });
};

const findRegionIndex = (regions: Region[], region: Region | undefined) => {
  if (!region) {
    return -1;
  }
  return regions.findIndex(r => isEqual(r, region));
};

const isSpecialPage = (doc: GristDoc | null) => {
  if (!doc) {
    return false;
  }
  const activeViewId = doc.activeViewId.get();
  if (typeof activeViewId === 'string' && SpecialDocPage.guard(activeViewId)) {
    return true;
  }
  return false;
};


const maybeNotifyAboutCreatorPanel = (gristDoc: GristDoc, cycleRegions: Region[]) => {
  // @TODO: have a better way to track if we already warned about the creator panel?
  // Currently showing the warning every 15 days or until we showed it 3 times.
  // Feels a bit convoluted…
  const localStoreKey = 'grist-rfs-cp-warn';
  const lastWarning = localStorage.getItem(localStoreKey);
  const lastWarningData = lastWarning ? JSON.parse(lastWarning) : { lastTime: 0, count: 0 };
  const toDay = (ms: number) => ms / 1000 / 60 / 60 / 24;
  if (lastWarningData.count >= 3 || toDay(Date.now()) - toDay(lastWarningData.lastTime) < 15) {
    return;
  }

  // We warn the user about creator panel shortcut existing if
  // all the commands he pressed in the last 10 seconds are only nextRegion and prevRegion,
  // and they did a full cycle through the regions at least once.
  const commandsHistory = commands.getCommandsHistory(Date.now() - (1000 * 10));
  const uniqueCommands = [...new Set(commandsHistory)];
  const regionsCount = cycleRegions.length > 10 ? 10 : cycleRegions.length;

  const warn = commandsHistory.length > regionsCount
    && uniqueCommands.length <= 2
    && uniqueCommands.every(cmd => cmd === 'nextRegion' || cmd === 'prevRegion');

  if (!warn) {
    return;
  }
  gristDoc.appModel.notifier.createUserMessage(
    t(
      'Trying to access the creator panel? Use {{key}}.',
      {key: commands.allCommands.creatorPanel.humanKeys}
    ),
    {
      level: 'info',
      key: localStoreKey,
    }
  );
  // save warning info for next time
  localStorage.setItem(localStoreKey, JSON.stringify({
    lastTime: Date.now(),
    count: lastWarningData.count + 1,
  }));
};

const cssFocusedPanel = styled('div', `
  &-focused:focus-within {
    outline: 1px solid ${theme.widgetActiveBorder} !important;
    outline-offset: -1px !important;
  }

  &-focused:focus {
    outline: 3px solid ${theme.widgetActiveBorder} !important;
    outline-offset: -3px !important;
  }

  /* the selector is intentionally heavy to apply more css weight than KeyboardFocusHighlighter styling…
   * ideally we would not need KeyboardFocusHighlighter, but for now it's a good enough fallback */
  &-focused [${ATTRS.focusedElement}][${ATTRS.focusedElement}]:focus {
    outline-width: 3px !important;
  }
`);
