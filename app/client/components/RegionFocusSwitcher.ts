import {Disposable, dom, Observable, styled} from 'grainjs';
import {mod} from 'app/common/gutil';
import isEqual from 'lodash/isEqual';
import {makeT} from 'app/client/lib/localization';
import * as commands from 'app/client/components/commands';
import {triggerFocusGrab} from 'app/client/components/Clipboard';
import {GristDoc} from 'app/client/components/GristDoc';
import {theme} from 'app/client/ui2018/cssVars';

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

/** @TODO: remove this when I'm done with the PR */
const enableLog = true;
let batchLog: any[] = [];
const prepareBatchLog = () => {
  batchLog = [];
};
const bLog = (key: string, value?: any) => {
  batchLog.push({key, value});
};
const outputBatchLog = (label: string) => {
  if (!enableLog) {
    return;
  }
  console.log('rfs', label, batchLog.reduce((acc, {key, value}, i) => {
    acc[`${i}. ${key}`] = value;
    return acc;
  }, {} as Record<string, any>));
  batchLog = [];
};
const log = (...args: any[]) => {
  if (!enableLog) {
    return;
  }
  console.log('rfs', ...args);
};


/**
 * RegionFocusSwitcher enables keyboard navigation between app panels and doc widgets.
 *
 * It also follow mouse clicks to focus panels accordingly.
 */
export class RegionFocusSwitcher extends Disposable {
  // Currently focused region
  public readonly current: Observable<Region | undefined>;
  private _currentUpdateInitiator: 'keyboard' | MouseEvent = 'keyboard';
  // Previously focused elements for each panel (not used for view section ids)
  private _prevFocusedElements: Record<Panel, Element | null> = {
    left: null,
    top: null,
    right: null,
    main: null,
  };

  constructor(private readonly _gristDocObs?: Observable<GristDoc | null>) {
    super();
    this.current = Observable.create(this, undefined);
  }

  public init() {
    this.autoDispose(commands.createGroup({
      nextRegion: () => this._cycle('next'),
      prevRegion: () => this._cycle('prev'),
      creatorPanel: () => this._toggleCreatorPanel(),
      cancel: this._onEscapeKeypress.bind(this),
    }, this, true));

    this.autoDispose(this.current.addListener(this._onCurrentUpdate.bind(this)));

    if (this._gristDocObs) {
      const onClick = this._onClick.bind(this);
      document.addEventListener('mouseup', onClick);
      this.onDispose(() => document.removeEventListener('mouseup', onClick));
      this._dirtyClassesFix();
    }
  }

  public focusRegion(region: Region | undefined, options: {initiator?: MouseEvent} = {}) {
    if (region?.type === 'panel' && !getPanelElement(region.id)) {
      console.log('RegionFocusSwitcher: skipping update (panel element not found)');
      return;
    }

    const gristDoc = this._getGristDoc();
    if (gristDoc && region?.type === 'panel' && region?.id === 'main') {
      throw new Error('main panel is not supported when a view layout is rendered');
    }
    if (!gristDoc && region?.type === 'section') {
      throw new Error('view section id is not supported when no view layout is rendered');
    }

    this._currentUpdateInitiator = options.initiator || 'keyboard';
    this.current.set(region);
  }

  public reset() {
    log('reset');
    this.focusRegion(undefined);
    if (this._gristDocObs) {
      this._dirtyClassesFix();
    }
  }

  public panelAttrs(id: Panel, ariaLabel: string) {
    return [
      dom.cls('clipboard_group_focus'),
      dom.attr('tabindex', '-1'),
      dom.attr('role', 'region'),
      dom.attr('aria-label', ariaLabel),
      dom.attr(ATTRS.regionId, id),
      dom.cls(`${cssFocusedPanel.className}-focused`, use => {
        const current = use(this.current);
        return this._currentUpdateInitiator === 'keyboard' && current?.type === 'panel' && current.id === id;
      }),
    ];
  }

  private _cycle(direction: 'next' | 'prev') {
    const gristDoc = this._getGristDoc();
    const cycleRegions = getCycleRegions(gristDoc);
    this.focusRegion(getSibling(
      this.current.get(),
      cycleRegions,
      direction,
      gristDoc
    ));
    if (gristDoc) {
      maybeNotifyAboutCreatorPanel(gristDoc, cycleRegions);
    }
  }

  // @TODO: fix this. This is dirty code to see if what I want to do works.
  // My issue is when starting the regionFocusSwitcher, the gristDoc is not yet ready.
  // I need to see how to correctly wait for this and be sure there are view layout sections or not.
  private _dirtyClassesFix(tries = 0): any {
    if (tries > 20) {
      return;
    }
    const main = document.querySelector(`[${ATTRS.regionId}="main"]`);
    if (!main) {
      return setTimeout(() => this._dirtyClassesFix(tries + 1), 100);
    }
    const hasGristDoc = !!this._gristDocObs;
    const gristDoc = this._getGristDoc();
    if (hasGristDoc && !gristDoc) {
      return setTimeout(() => this._dirtyClassesFix(tries + 1), 100);
    }
    if (hasGristDoc) {
      main?.classList.remove('clipboard_group_focus');
      main?.classList.add('clipboard_forbid_focus');
    } else {
      main?.classList.remove('clipboard_forbid_focus');
      main?.classList.add('clipboard_group_focus');
    }
    log('dirtyClassesFix, main classes:', main?.className);
  }

  /**
   * When clicking on a grist doc page:
   *   - if necessary, make it easier to tab through things inside panels by "unfocusing" the view section,
   *   - make sure the internal current region info is set when user clicks on the view layout.
   */
  private _onClick(event: MouseEvent) {
    const current = this.current.get();
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
    const currentlyInSection = current?.type === 'section';

    if (targetsMain && !currentlyInSection) {
      log('onClick: enable active section');
      this.focusRegion({ type: 'section', id: gristDoc.viewModel.activeSectionId() }, { initiator: event });
      return;
    }

    // When not targeting the main panel, we don't always want to focus the given region _on click_.
    // We only do it if clicking an empty area in the panel, or a focusable element like an input.
    // Otherwise, we assume clicks are on elements like buttons or links,
    // and we don't want to lose focus of current section in this case.
    // For example I don't want to focus out current table if just click the "undo" button in the header.
    if (!targetsMain
      && (
        !currentlyInSection
        || (isFocusableElement(event.target) || getPanelElement(targetRegionId as Panel) === event.target)
      )
    ) {
      log('onClick: disable active section');
      this.focusRegion({ type: 'panel', id: targetRegionId as Panel }, { initiator: event });
      return;
    }
  }

  private _onEscapeKeypress() {
    log('Esc: pressed');
    const current = this.current.get();
    if (current?.type !== 'panel') {
      log('Esc: not a panel, exiting', current);
      return;
    }
    const panelElement = getPanelElement(current.id);
    // Focus back the panel element itself if currently focused element is a child
    if (
      (panelElement?.contains(document.activeElement) && document.activeElement !== panelElement)
      // Specific case: when we escape inputs from panels, this isn't called and focus switches back to body.
      // If user presses escape again, we also want to focus the panel.
      || (document.activeElement === document.body && panelElement)
    ) {
      log('Esc: focus panel', panelElement?.className);
      panelElement?.focus();
      return;
    }
    // …Reset region focus switch if already on the panel itself
    if (document.activeElement === panelElement) {
      log('Esc: reset');
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
      log('save prevFocusedElement: skip');
      return;
    }
    log('save prevFocusedElement', prev.id, document.activeElement?.className);
    this._prevFocusedElements[prev.id] = document.activeElement;
  }

  private _onCurrentUpdate(current: Region | undefined, prev: Region | undefined) {
    if (isEqual(current, prev)) {
      console.log('RegionFocusSwitcher: skipping update (no change)');
      return;
    }

    prepareBatchLog();
    const gristDoc = this._getGristDoc();
    const mouseEvent = this._currentUpdateInitiator instanceof MouseEvent ? this._currentUpdateInitiator : undefined;

    removeFocusRings();
    if (!mouseEvent) {
      this._savePrevElementState(prev);
      if (prev?.type === 'panel') {
        blurPanelChild(prev);
      }
    }

    const isPanel = current?.type === 'panel';
    const panelElement = isPanel && getPanelElement(current.id);

    // actually focus panel element if using keyboard
    if (!mouseEvent && isPanel && panelElement) {
      focusPanel(current, this._prevFocusedElements[current.id] as HTMLElement | null, gristDoc);
    }

    // just make sure view layout commands are disabled if we click on a panel
    if (mouseEvent && isPanel && panelElement && gristDoc) {
      escapeViewLayout(gristDoc, !!(mouseEvent.target as Element)?.closest(`[${ATTRS.regionId}="right"]`));
    }

    if (current?.type === 'section' && gristDoc) {
      focusSection(current, gristDoc);
    }

    if (current === undefined && gristDoc) {
      focusViewLayout(gristDoc);
    }

    // if we reset the focus switch, clean all necessary state
    if (current === undefined) {
      bLog('reset, clear prevFocusedElements');
      this._prevFocusedElements = {
        left: null,
        top: null,
        right: null,
        main: null,
      };
    }
    bLog('activeElement', document.activeElement);
    outputBatchLog('currentUpdate');
  }

  private _toggleCreatorPanel() {
    const current = this.current.get();
    const gristDoc = this._getGristDoc();
    if (current?.type === 'panel' && current.id === 'right') {
      return this.focusRegion(gristDoc
        ? {type: 'section', id: gristDoc.viewModel.activeSectionId()}
        : {type: 'panel', id: 'main'}
      );
    }
    commands.allCommands.rightPanelOpen.run();
    return this.focusRegion({type: 'panel', id: 'right'});
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
    if (hasViewLayout(doc)) {
      return doc;
    }
    return null;
  }
}


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
    bLog('focusPanel', panelElement.className);
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
    bLog('focusPanel child', child.className);
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
  bLog('focusViewLayout focusedRegionState', 'in');
};

// When going out of the view layout, default view state is 'out' to remove active session
// borders and disable the view kb commands.
// You can specific a special case 'related' to the view. It still disable commands, but keeps
// the active session borders, so that user understands what session the current panel is related to.
const escapeViewLayout = (gristDoc: GristDoc, isRelated = false) => {
  gristDoc.viewModel.focusedRegionState(isRelated ? 'related' : 'out');
  bLog('escapeViewLayout focusedRegionState', isRelated ? 'related' : 'out');
};

/**
 * Focus the given doc view section id
 */
const focusSection = (section: SectionRegion, gristDoc: GristDoc) => {
  focusViewLayout(gristDoc);
  gristDoc.viewModel.activeSectionId(section.id);
  bLog('focusSection activeSectionId', section.id);
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
    ...gristDoc.viewLayout?.layout.getAllLeafIds().map(id => ({ type: 'section', id } as SectionRegion)) ?? [],
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
    bLog('sibling', regions[0]);
    return regions[0];
  }

  // Normal case: just return the next or previous region in the cycle, wrapping around
  const sibling = regions[mod(currentIndexInCycle + (direction === 'next' ? 1 : -1), regions.length)];
  bLog('sibling', sibling);
  return sibling;
};

/**
 * Blur the currently focused element in the given panel, if any.
 */
const blurPanelChild = (panel: PanelRegion) => {
  const panelElement = getPanelElement(panel.id);
  if (panelElement?.contains(document.activeElement) && document.activeElement !== panelElement) {
    bLog('isPanel clear focus', {
      activeElement: document.activeElement?.className,
      panelElement: panelElement.className,
    });
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
    bLog(`remove ${ATTRS.focusedElement}`, el);
    el.removeAttribute(ATTRS.focusedElement);
  });
};

const findRegionIndex = (regions: Region[], region: Region | undefined) => {
  if (!region) {
    return -1;
  }
  return regions.findIndex(r => isEqual(r, region));
};

/**
 * Whether the given grist doc has a view layout.
 *
 * This can be false if we are on a grist-doc special page, or if the grist doc is not yet ready.
 */
const hasViewLayout = (doc: GristDoc | null) => {
  return doc
    && !doc.viewModel.isDisposed()
    && doc.viewLayout
    && !doc.viewLayout.isDisposed()
    && doc.viewLayout.layout;
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
