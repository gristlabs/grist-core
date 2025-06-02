import {Disposable, dom, Observable, styled, UseCBOwner} from 'grainjs';
import {mod} from 'app/common/gutil';
import {SpecialDocPage} from 'app/common/gristUrls';
import isEqual from 'lodash/isEqual';
import {makeT} from 'app/client/lib/localization';
import {FocusLayer} from 'app/client/lib/FocusLayer';
import {trapTabKey} from 'app/client/lib/trapTabKey';
import * as commands from 'app/client/components/commands';
import {App} from 'app/client/ui/App';
import {GristDoc} from 'app/client/components/GristDoc';
import BaseView from 'app/client/components/BaseView';
import {components} from 'app/common/ThemePrefs';

const t = makeT('RegionFocusSwitcher');

type Panel = 'left' | 'top' | 'right' | 'main';
interface PanelRegion {
  type: 'panel',
  id: Panel // this matches a dom element id
}
interface SectionRegion {
  type: 'section',
  id: number // this matches a grist document view section id
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
  private get _gristDocObs() { return this._app?.pageModel?.gristDoc; }
  // Previously focused elements for each panel (not used for view section ids)
  private _prevFocusedElements: Record<Panel, Element | null> = {
    left: null,
    top: null,
    right: null,
    main: null,
  };
  // Command history exclusively here to warn the user about the creator panel shortcut if needed
  private _commandsHistory: {
    name: 'nextRegion' | 'prevRegion' | 'creatorPanel',
    timestamp: number
  }[] = [];
  private _warnedAboutCreatorPanel = false;

  constructor(private _app?: App) {
    super();
    this._state = Observable.create(this, {
      region: undefined,
      initiator: undefined,
    });

    this.autoDispose(commands.createGroup({
      nextRegion: () => {
        this._logCommand('nextRegion');
        this._maybeNotifyAboutCreatorPanel();
        return this._cycle('next');
      },
      prevRegion: () => {
        this._logCommand('prevRegion');
        this._maybeNotifyAboutCreatorPanel();
        return this._cycle('prev');
      },
      creatorPanel: () => {
        this._logCommand('creatorPanel');
        return this._toggleCreatorPanel();
      },
      cancel: this._onEscapeKeypress.bind(this),
    }, this, true));

    this.autoDispose(this._state.addListener(this._onStateChange.bind(this)));

    const focusActiveSection = () => this.focusActiveSection();
    this._app?.on('clipboard_focus', focusActiveSection);
    this.onDispose(() => {
      this._app?.off('clipboard_focus', focusActiveSection);
      this.reset();
    });
  }

  public onPageDomLoaded(el: HTMLElement) {
    if (this._gristDocObs) {
      const onClick = this._onClick.bind(this);
      el.addEventListener('mouseup', onClick);
      this.onDispose(() => el.removeEventListener('mouseup', onClick));
    }
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
        // highlight focused elements everywhere except in the grist doc views
        return id !== 'main'
          ? true
          : this._canTabThroughMainRegion(use);
      }),
      dom.cls('clipboard_group_focus', use => {
        const gristDoc = this._gristDocObs ? use(this._gristDocObs) : null;
        // if we are not on a grist doc, whole page is always focusable
        if (!gristDoc) {
          return true;
        }
        // on a grist doc, panel content is focusable only if it's the current region
        const current = use(this._state).region;
        if (current?.type === 'panel' && current.id === id) {
          return true;
        }
        // on a grist doc, main panel is focusable only if we are not the actual document view
        if (id === "main") {
          return this._canTabThroughMainRegion(use);
        }
        return false;
      }),
      cssFocusedPanel.cls('-focused', use => {
        const current = use(this._state);
        return current.initiator?.type === 'cycle' && current.region?.type === 'panel' && current.region.id === id;
      }),
    ];
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
    this._commandsHistory = [];
    const closestRegion = (event.target as HTMLElement)?.closest(`[${ATTRS.regionId}]`);
    if (!closestRegion) {
      return;
    }
    const targetRegionId = closestRegion.getAttribute(ATTRS.regionId);
    const targetsMain = targetRegionId === 'main';
    const current = this._state.get().region;
    const currentlyInSection = current?.type === 'section';

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

  /**
   * This is registered as a `cancel` command when the RegionFocusSwitcher is created.
   *
   * That means this is called when pressing Escape in no particular setting.
   * Any `cancel` command registered by other code after loading the page will take precedence over this one.
   * So, this doesn't get called when in a modal, a popup menu, etc., as those have their own cancel callback.
   */
  private _onEscapeKeypress() {
    const {region: current, initiator} = this._state.get();
    // Do nothing if we are not focused on a panel
    if (current?.type !== 'panel') {
      return;
    }
    const comesFromKeyboard = initiator?.type === 'cycle';
    const panelElement = getPanelElement(current.id);
    if (!panelElement) {
      return;
    }

    // …Reset region focus switch if already on the panel itself
    if (document.activeElement === panelElement) {
      this.reset();
      return;
    }

    const activeElement = document.activeElement;
    const activeElementIsInPanel = containsActiveElement(panelElement);

    if (
      // Focus back the panel element itself if currently focused element is a child
      activeElementIsInPanel
      // Specific case: when we escape inputs from panels, this isn't called, and focus switches back to body.
      // If user presses escape again, we also want to focus the panel.
      || (activeElement === document.body)
    ) {
      if (comesFromKeyboard) {
        focusPanelElement(panelElement);
        if (activeElementIsInPanel) {
          this._prevFocusedElements[current.id] = null;
        }
      } else {
        this.reset();
      }
      return;
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
    const isChildOfPanel = containsActiveElement(prevPanelElement);
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

    disableFocusLock();
    removeFocusRings();
    removeTabIndexes();
    if (!mouseEvent) {
      this._savePrevElementState(prev?.region);
      if (prev?.region?.type === 'panel') {
        blurPanelChild(prev.region);
      }
    }

    const isPanel = current?.region?.type === 'panel';
    const panelElement = isPanel && current.region?.id && getPanelElement((current.region as PanelRegion).id);

    // if kb-focusing a panel: actually focus panel element
    if (!mouseEvent && isPanel && panelElement && current.region) {
      focusPanel(
        current.region as PanelRegion,
        this._prevFocusedElements[current.region.id as Panel] as HTMLElement | null,
        gristDoc
      );

    // if clicking on a panel: just make sure view layout commands are disabled
    } else if (mouseEvent && isPanel && panelElement && gristDoc) {
      escapeViewLayout(gristDoc, !!(mouseEvent.target as Element)?.closest(`[${ATTRS.regionId}="right"]`));

    // if clicking or kb-focusing a section: focus the section
    } else if (current?.region?.type === 'section' && gristDoc) {
      focusSection(current.region, gristDoc);
    }

    // if we reset the focus switch, clean all necessary state
    if (current === undefined) {
      if (gristDoc) {
        focusViewLayout(gristDoc);
      }
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

  private _canTabThroughMainRegion(use: UseCBOwner) {
    const gristDoc = this._gristDocObs ? use(this._gristDocObs) : null;
    if (!gristDoc) {
      return true;
    }
    if (gristDoc) {
      use(gristDoc.activeViewId);
    }
    return isSpecialPage(gristDoc);
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

  private _logCommand(name: 'nextRegion' | 'prevRegion' | 'creatorPanel') {
    if (this._commandsHistory.length > 20) {
      this._commandsHistory.shift();
    }
    this._commandsHistory.push({name, timestamp: Date.now()});
  }

  /**
   * As a user, it's not obvious that the creator panel needs a different shortcut than the other regions.
   *
   * So the user might try to use the next/prevRegion shortcut to access the creator panel.
   * We show a warning letting him now about the specific creator panel shortcut when we think he is "searching" for it.
   */
  private _maybeNotifyAboutCreatorPanel() {
    if (this._warnedAboutCreatorPanel) {
      return;
    }
    const usedCreatorPanelCommand = this._commandsHistory.some(cmd => cmd.name === 'creatorPanel');
    if (usedCreatorPanelCommand) {
      return;
    }
    const gristDoc = this._getGristDoc();
    if (!gristDoc) {
      return;
    }
    const now = Date.now();
    const commandsInLast20Secs = this._commandsHistory.filter(cmd => cmd.timestamp > now - (1000 * 20));
    const cycleRegions = getCycleRegions(gristDoc);
    // the logic is: if in the last 20 seconds, the user pressed the same cycle shortcut enough times
    // to do 2 full cycles through the regions, we assume he is trying to access the creator panel.
    const warn = commandsInLast20Secs.length > ((cycleRegions.length * 2) - 1)
      && (
        commandsInLast20Secs.every(cmd => cmd.name === 'nextRegion')
        || commandsInLast20Secs.every(cmd => cmd.name === 'prevRegion')
      );
    if (warn) {
      this._app?.topAppModel.notifier.createUserMessage(
        t(
          'Trying to access the creator panel? Use {{key}}.',
          {key: commands.allCommands.creatorPanel.humanKeys}
        ),
        {
          level: 'info',
          key: 'rfs-cp-warn',
        }
      );
      this._warnedAboutCreatorPanel = true;
    }
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
  enableFocusLock(panelElement);

  // Child element found: focus it
  if (child && child !== panelElement && child.isConnected) {
    // Visually highlight the element with similar styles than panel focus,
    // only for this time. This is here just to help the user better see the visual change when he switches panels.
    child.setAttribute(ATTRS.focusedElement, 'true');
    child.addEventListener('blur', () => {
      child.removeAttribute(ATTRS.focusedElement);
    }, {once: true});
    child.focus?.();
  } else {
    // No child to focus found: just focus the panel
    focusPanelElement(panelElement);
  }

  if (gristDoc) {
    // Creator panel is a special case "related to the view"
    escapeViewLayout(gristDoc, panel.id === 'right');
  }
};

const focusPanelElement = (panelElement: HTMLElement) => {
  // tabindex is set here and removed later with removeTabIndexes(), instead of
  // directly set on the element on creation, for a reason:
  // if we happen to just click on a non-focusable element inside a panel,
  // browser default behavior is to make document.activeElement the closest focusable parent (the panel).
  // We don't want this behavior, so we add/remove the tabindex attribute as needed.
  panelElement.setAttribute('tabindex', '-1');
  panelElement.focus();
};

const focusViewLayout = (gristDoc: GristDoc) => {
  FocusLayer.grabFocus();
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
  if (containsActiveElement(panelElement)) {
    (document.activeElement as HTMLElement).blur();
  }
};

let _focusLocked: {el: HTMLElement | null, cb: ((event: KeyboardEvent) => void) | null} = {el: null, cb: null};

const disableFocusLock = () => {
  const {el, cb} = _focusLocked;
  if (el && cb) {
    el.removeEventListener('keydown', cb);
    _focusLocked = {el: null, cb: null};
  }
};

const enableFocusLock = (panelElement: HTMLElement) => {
  disableFocusLock();
  const focusTrap = (event: KeyboardEvent) => {
    if (event.key === 'Tab') {
      trapTabKey(panelElement, event);
    }
  };
  panelElement.addEventListener('keydown', focusTrap);
  _focusLocked = {
    el: panelElement,
    cb: focusTrap
  };
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
 * Check if the document.activeElement is a child of the given element.
 */
const containsActiveElement = (el: HTMLElement | null): boolean => {
  return el?.contains(document.activeElement) && document.activeElement !== el || false;
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

const cssFocusedPanel = styled('div', `
  &-focused:focus {
    outline: 3px solid ${components.kbFocusHighlight} !important;
    outline-offset: -3px !important;
  }

  &-focused [${ATTRS.focusedElement}]:focus {
    outline: 3px solid ${components.kbFocusHighlight} !important;
  }
`);
