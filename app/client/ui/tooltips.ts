/**
 * This module implements tooltips of two kinds:
 * - to be shown on hover, similar to the native "title" attribute (popweasel meant to provide
 *   that, but its machinery isn't really needed). TODO these aren't yet implemented.
 * - to be shown briefly, as a transient notification next to some action element.
 */

import {logTelemetryEvent} from 'app/client/lib/telemetry';
import {GristTooltips, Tooltip} from 'app/client/ui/GristTooltips';
import {prepareForTransition} from 'app/client/ui/transitions';
import {testId, theme, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {makeLinks} from 'app/client/ui2018/links';
import {menuCssClass} from 'app/client/ui2018/menus';
import {dom, DomContents, DomElementArg, DomElementMethod, styled} from 'grainjs';
import Popper from 'popper.js';
import {cssMenu, cssMenuItem, defaultMenuOptions, IPopupOptions, setPopupToCreateDom} from 'popweasel';
import merge = require('lodash/merge');

export interface ITipOptions {
  /**
   * Where to place the tooltip relative to the reference element.
   *
   * Defaults to 'top'.
   *
   * See https://popper.js.org/docs/v1/#popperplacements--codeenumcode.
   */
  placement?: Popper.Placement;

  /** When set, a tooltip will replace any previous tooltip with the same key. */
  key?: string;

  /**
   * Optionally, popper modifiers (e.g. {offset: {offset: 8}}),
   * See https://popper.js.org/docs/v1/#modifiers.
   */
  modifiers?: Popper.Modifiers;
}

export interface ITransientTipOptions extends ITipOptions {
  /** When to remove the transient tooltip. Defaults to 2000ms. */
  timeoutMs?: number;
}

export interface IHoverTipOptions extends ITransientTipOptions {
  /** How soon after mouseenter to show it. Defaults to 200 ms. */
  openDelay?: number;

  /** If set and non-zero, remove the tip automatically after this time. */
  timeoutMs?: number;

  /**
   * How soon after mouseleave to hide it.
   *
   * Defaults to 100 ms.
   *
   * A non-zero delay gives the pointer some time to be outside of the trigger
   * and the tooltip content if the user moves the pointer from one to the other.
   */
  closeDelay?: number;

  /**
   * Also show the tip on clicking the element it's attached to.
   *
   * Defaults to false.
   *
   * Should only be set to true if `closeOnClick` is false.
   */
  openOnClick?: boolean;

  /**
   * Hide the tip on clicking the element it's attached to.
   *
   * Defaults to true.
   *
   * Should only be set to true if `openOnClick` is false.
   */
  closeOnClick?: boolean;

  /** Whether to show the tooltip only when the ref element overflows horizontally. */
  overflowOnly?: boolean;
}

export type ITooltipContent = ITooltipContentFunc | DomContents;

export type ITooltipContentFunc = (ctl: ITooltipControl) => DomContents;

export interface ITooltipControl {
  close(): void;
  getDom(): HTMLElement;       // The tooltip DOM.
}

/**
 * Map of open tooltips, mapping the key (from ITipOptions) to ITooltipControl that allows removing
 * the tooltip.
 */
const openTooltips = new Map<string, ITooltipControl>();

/**
 * Show tipContent briefly (2s by default), in a tooltip next to refElem (on top of it, by default).
 * See also ITipOptions.
 */
export function showTransientTooltip(
  refElem: Element,
  tipContent: ITooltipContent,
  options: ITransientTipOptions = {}) {
  const ctl = showTooltip(refElem, typeof tipContent == 'function' ? tipContent : () => tipContent, options);
  const origClose = ctl.close;
  ctl.close = () => { clearTimeout(timer); origClose(); };

  const timer = setTimeout(ctl.close, options.timeoutMs || 2000);
  return ctl;
}

/**
 * Show the return value of tipContent(ctl) in a tooltip next to refElem (on top of it, by default).
 * Returns ctl. In both places, ctl is an object with a close() method, which closes the tooltip.
 * See also ITipOptions.
 */
export function showTooltip(
  refElem: Element, tipContent: ITooltipContentFunc, options: ITipOptions = {}
): ITooltipControl {
  const placement: Popper.Placement = options.placement ?? 'top';
  const key = options.key;
  const hasKey = key && openTooltips.has(key);
  let closed = false;

  // If we had a previous tooltip with the same key, clean it up.
  if (key) { openTooltips.get(key)?.close(); }

  // Cleanup involves destroying the Popper instance, removing the element, etc.
  function close() {
    if (closed) { return; }
    closed = true;
    popper.destroy();
    dom.domDispose(content);
    content.remove();
    if (key) { openTooltips.delete(key); }
  }
  const ctl: ITooltipControl = {close, getDom: () => content};

  // Add the content element.
  const content = cssTooltip({role: 'tooltip'}, tipContent(ctl), testId(`tooltip`));
  // Prepending instead of appending allows better text selection, as this element is on top.
  document.body.prepend(content);

  // Create a popper for positioning the tooltip content relative to refElem.
  const popperOptions: Popper.PopperOptions = {
    modifiers: merge(
      { preventOverflow: {boundariesElement: 'viewport'} },
      options.modifiers
    ),
    placement,
  };

  const popper = new Popper(refElem, content, popperOptions);

  // If refElem is disposed we close the tooltip.
  dom.onDisposeElem(refElem, close);

  // If we're not replacing the tooltip, fade in the content using transitions.
  if (!hasKey) {
    prepareForTransition(content, () => { content.style.opacity = '0'; });
    content.style.opacity = '';
  }

  if (key) { openTooltips.set(key, ctl); }
  return ctl;
}

/**
 * Render a tooltip on hover. Suitable for use during dom construction, e.g.
 *    dom('div', 'Trigger', hoverTooltip('Hello!')
 */
export function hoverTooltip(tipContent: ITooltipContent, options?: IHoverTipOptions): DomElementMethod {
  const defaultOptions: IHoverTipOptions = {placement: 'bottom'};
  return (elem) => setHoverTooltip(elem, tipContent, {...defaultOptions, ...options});
}

/**
 * On hover, show the full text of this element when it overflows horizontally. It is intended
 * mainly for styled with "text-overflow: ellipsis".
 * E.g. dom('label', 'Long text...', overflowTooltip()).
 */
export function overflowTooltip(options?: IHoverTipOptions): DomElementMethod {
  const defaultOptions: IHoverTipOptions = {
    placement: 'bottom-start',
    overflowOnly: true,
    modifiers: {offset: {offset: '40, 0'}},
  };
  return (elem) => setHoverTooltip(elem, () => elem.textContent,  {...defaultOptions, ...options});
}

/**
 * Attach a tooltip to the given element, to be rendered on hover.
 */
export function setHoverTooltip(
  refElem: Element,
  tipContent: ITooltipContent,
  options: IHoverTipOptions = {}
) {
  const {key, openDelay = 200, timeoutMs, closeDelay = 100, openOnClick, closeOnClick = true,
    overflowOnly = false} = options;

  const tipContentFunc = typeof tipContent === 'function' ? tipContent : () => tipContent;

  // Controller for closing the tooltip, if one is open.
  let tipControl: ITooltipControl|undefined;

  // A marker, that the tooltip should be closed, but we are waiting for the mouseup event.
  const POSTPONED = Symbol();

  // Timer to open or close the tooltip, depending on whether tipControl is set.
  let timer: ReturnType<typeof setTimeout>|undefined|typeof POSTPONED;

  // To allow user select text, we will monitor if the selection has started in the tooltip (by listening
  // to the mousedown event). If it has and mouse goes outside, we will mark that the tooltip should be closed.
  // When the selection is over (by listening to mouseup on window), a new close is scheduled with 1.4s, to allow
  // user to press Ctrl+C (but only if the marker - POSTPONED - is still set).
  let mouseGrabbed = false;
  function grabMouse(tip: Element) {
    mouseGrabbed = true;
    const listener = dom.onElem(window, 'mouseup', () => {
      mouseGrabbed = false;
      if (timer === POSTPONED) {
        scheduleCloseIfOpen(1400);
      }
    });
    dom.autoDisposeElem(tip, listener);

    // Disable text selection in any other element except this one. This class sets user-select: none to all
    // elements except the tooltip. This helps to avoid accidental selection of text in other elements, once
    // the mouse leaves the tooltip.
    document.body.classList.add(cssDisableSelectOnAll.className);
    dom.onDisposeElem(tip, () => document.body.classList.remove(cssDisableSelectOnAll.className));
  }

  function clearTimer() {
    if (timer !== POSTPONED) { clearTimeout(timer); }
    timer = undefined;
  }
  function resetTimer(func: () => void, delay: number|typeof POSTPONED) {
    clearTimer();
    timer = delay === POSTPONED ? POSTPONED : setTimeout(func, delay);
  }
  function scheduleCloseIfOpen(timeout = closeDelay) {
    clearTimer();
    if (tipControl) {
      resetTimer(close, mouseGrabbed ? POSTPONED : timeout);
    }
  }
  function open() {
    clearTimer();
    tipControl = showTooltip(refElem, ctl => tipContentFunc({...ctl, close}), options);
    const tipDom = tipControl.getDom();
    dom.onElem(tipDom, 'mouseenter', clearTimer);
    dom.onElem(tipDom, 'mouseleave', () => scheduleCloseIfOpen());
    dom.onElem(tipDom, 'mousedown', grabMouse.bind(null, tipDom));
    dom.onDisposeElem(tipDom, () => close());
    if (timeoutMs) { resetTimer(close, timeoutMs); }
  }
  function close() {
    clearTimer();
    tipControl?.close();
    tipControl = undefined;
  }

  // We simulate hover effect by handling mouseenter/mouseleave.
  dom.onElem(refElem, 'mouseenter', () => {
    if (overflowOnly && (refElem as HTMLElement).offsetWidth >= refElem.scrollWidth) {
      return;
    }
    if (!tipControl && !timer) {
      // If we're replacing a tooltip, open without delay.
      const delay = key && openTooltips.has(key) ? 0 : openDelay;
      resetTimer(open, delay);
    } else if (tipControl) {
      // Already shown, reset to newly-shown state.
      clearTimer();
      if (timeoutMs) { resetTimer(close, timeoutMs); }
    }
  });

  dom.onElem(refElem, 'mouseleave', () => scheduleCloseIfOpen());

  if (openOnClick) {
    // If requested, re-open on click.
    dom.onElem(refElem, 'click', () => { close(); open(); });
  } else if (closeOnClick) {
    // If requested, close on click.
    dom.onElem(refElem, 'click', () => { close(); });
  }

  // Close tooltip if refElem is disposed.
  dom.onDisposeElem(refElem, close);
}

/**
 * Build a handy button for closing a tooltip.
 */
export function tooltipCloseButton(ctl: ITooltipControl): HTMLElement {
  return cssTooltipCloseButton(icon('CrossSmall'),
    dom.on('mousedown', (ev) =>{
      ev.stopPropagation();
      ev.preventDefault();
      ctl.close();
    }),
    testId('tooltip-close'),
  );
}

export interface InfoTooltipOptions {
  /** Defaults to `click`. */
  variant?: InfoTooltipVariant;
  /** Only applicable to the `click` variant. */
  popupOptions?: IPopupOptions;
  /** Only applicable to the `click` variant. */
  onOpen?: () => void;
}

export type InfoTooltipVariant = 'click' | 'hover';

/**
 * Renders an info icon that shows a tooltip with the specified `content`.
 */
export function infoTooltip(
  tooltip: Tooltip,
  options: InfoTooltipOptions = {},
  ...domArgs: DomElementArg[]
) {
  const {variant = 'click'} = options;
  const content = GristTooltips[tooltip]();
  const onOpen = () => logTelemetryEvent('viewedTip', {full: {tipName: tooltip}});
  switch (variant) {
    case 'click': {
      const {popupOptions} = options;
      return buildClickableInfoTooltip(content, {onOpen, popupOptions}, domArgs);
    }
    case 'hover': {
      return buildHoverableInfoTooltip(content, domArgs);
    }
  }
}

export interface ClickableInfoTooltipOptions {
  popupOptions?: IPopupOptions;
  onOpen?: () => void;
}

function buildClickableInfoTooltip(
  content: DomContents,
  options: ClickableInfoTooltipOptions = {},
  ...domArgs: DomElementArg[]
) {
  const {onOpen, popupOptions} = options;
  return cssInfoTooltipButton('?',
    (elem) => {
      setPopupToCreateDom(
        elem,
        (ctl) => {
          onOpen?.();

          return cssInfoTooltipPopup(
            cssInfoTooltipPopupCloseButton(
              icon('CrossSmall'),
              dom.on('click', () => ctl.close()),
              testId('info-tooltip-close'),
            ),
            cssInfoTooltipPopupBody(
              content,
              testId('info-tooltip-popup-body'),
            ),
            dom.cls(menuCssClass),
            dom.cls(cssMenu.className),
            dom.onKeyDown({
              Enter: () => ctl.close(),
              Escape: () => ctl.close(),
            }),
            (popup) => { setTimeout(() => popup.focus(), 0); },
            testId('info-tooltip-popup'),
          );
        },
        {...defaultMenuOptions, ...{placement: 'bottom-end'}, ...popupOptions},
      );
    },
    testId('info-tooltip'),
    ...domArgs,
  );
}

function buildHoverableInfoTooltip(content: DomContents, ...domArgs: DomElementArg[]) {
  return cssInfoTooltipIcon('?',
    hoverTooltip(() => cssInfoTooltipTransientPopup(
      content,
      cssTooltipCorner(testId('tooltip-origin')),
      {tabIndex: '-1'},
      testId('info-tooltip-popup'),
    ), {closeOnClick: false}),
    testId('info-tooltip'),
    ...domArgs,
  );
}

export interface WithInfoTooltipOptions {
  /** Defaults to `click`. */
  variant?: InfoTooltipVariant;
  domArgs?: DomElementArg[];
  iconDomArgs?: DomElementArg[];
  /** Only applicable to the `click` variant. */
  popupOptions?: IPopupOptions;
  onOpen?: () => void;
}

/**
 * Wraps `domContent` with a info tooltip icon that displays the specified
 * `tooltip` and returns the wrapped element. Tooltips are defined in
 * `app/client/ui/GristTooltips.ts`.
 *
 * The tooltip button is displayed to the right of `domContents`, and displays
 * a popup on click by default. The popup can be dismissed by clicking away from
 * it; clicking the close button in the top-right corner; or pressing Enter or Escape.
 *
 * You may optionally specify `options.variant`, which controls whether the tooltip
 * is shown on hover or on click.
 *
 * Arguments can be passed to both the top-level wrapped DOM element and the
 * tooltip icon element with `options.domArgs` and `options.tooltipIconDomArgs`
 * respectively.
 *
 * Usage:
 *
 *   withInfoTooltip(dom('div', 'Hello World!'), 'selectBy')
 */
export function withInfoTooltip(
  domContents: DomContents,
  tooltip: Tooltip,
  options: WithInfoTooltipOptions = {},
) {
  const {variant = 'click', domArgs, iconDomArgs, popupOptions} = options;
  return cssDomWithTooltip(
    domContents,
    infoTooltip(tooltip, {variant, popupOptions}, iconDomArgs),
    ...(domArgs ?? [])
  );
}

/**
 * Renders an description info icon that shows a tooltip with the specified `content` on click.
 */
export function descriptionInfoTooltip(
  content: string,
  testPrefix: string,
  ...domArgs: DomElementArg[]) {
  const body = makeLinks(content);
  const options = {
    closeDelay: 200,
    key: 'columnDescription',
    openOnClick: true,
  };
  const builder = () => cssInfoTooltipTransientPopup(
    body,
    // Used id test to find the origin of the tooltip regardless webdriver implementation (some of them start)
    cssTooltipCorner(testId('tooltip-origin')),
    testId(`${testPrefix}-info-tooltip-popup`),
    {tabIndex: '-1'}
  );
  return cssDescriptionInfoTooltipButton(
    icon('Info', dom.cls("info_toggle_icon")),
    testId(`${testPrefix}-info-tooltip`),
    dom.on('mousedown', (e) => e.stopPropagation()),
    dom.on('click', (e) => e.stopPropagation()),
    hoverTooltip(builder, options),
    dom.cls("info_toggle_icon_wrapper"),
    ...domArgs,
  );
}

const cssTooltipCorner = styled('div', `
  position: absolute;
  width: 0;
  height: 0;
  top: 0;
  left: 0;
  visibility: hidden;
`);

const cssInfoTooltipTransientPopup = styled('div', `
  position: relative;
  white-space: pre-wrap;
  text-align: left;
  text-overflow: ellipsis;
  overflow: hidden;
  line-height: 1.4;
  max-width: min(500px, calc(100vw - 80px)); /* can't use 100%, 500px and 80px are picked by hand */
`);

const cssDescriptionInfoTooltipButton = styled('div', `
  cursor: pointer;
  --icon-color: ${theme.infoButtonFg};
  border-radius: 50%;
  display: inline-block;
  padding-left: 5px;
  line-height: 0px;

  &:hover  {
    --icon-color: ${theme.infoButtonHoverFg};
  }
  &:active  {
    --icon-color: ${theme.infoButtonActiveFg};
  }
`);


const cssTooltip = styled('div', `
  position: absolute;
  z-index: ${vars.tooltipZIndex};      /* should be higher than a modal */
  background-color: ${theme.tooltipBg};
  border-radius: 3px;
  box-shadow: 0 0 2px rgba(0,0,0,0.5);
  text-align: center;
  color: ${theme.tooltipFg};
  width: auto;
  font-family: sans-serif;
  font-size: 10pt;
  padding: 8px 16px;
  margin: 4px;
  transition: opacity 0.2s;
  user-select: auto;
`);

const cssDisableSelectOnAll = styled('div', `
  & *:not(.${cssTooltip.className}, .${cssTooltip.className} *) {
    user-select: none;
  }
`);

const cssTooltipCloseButton = styled('div', `
  cursor: pointer;
  user-select: none;
  width: 16px;
  height: 16px;
  line-height: 16px;
  text-align: center;
  margin: -4px -4px -4px 8px;
  --icon-color: ${theme.tooltipCloseButtonFg};
  border-radius: 16px;

  &:hover {
    background-color: ${theme.tooltipCloseButtonHoverBg};
    --icon-color: ${theme.tooltipCloseButtonHoverFg};
  }
`);

const cssInfoTooltipIcon = styled('div', `
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  height: ${vars.largeFontSize};
  width: ${vars.largeFontSize};
  border: 1px solid ${theme.controlSecondaryFg};
  color: ${theme.controlSecondaryFg};
  border-radius: 50%;
  user-select: none;

  .${cssMenuItem.className}-sel & {
    color: ${theme.menuItemSelectedFg};
    border-color: ${theme.menuItemSelectedFg};
  }
`);

const cssInfoTooltipButton = styled(cssInfoTooltipIcon, `
  cursor: pointer;

  &:hover {
    border: 1px solid ${theme.controlSecondaryHoverFg};
    color: ${theme.controlSecondaryHoverFg};
  }
`);

const cssInfoTooltipPopup = styled('div', `
  display: flex;
  flex-direction: column;
  background-color: ${theme.popupBg};
  max-width: 200px;
  margin: 4px;
  padding: 0px;
`);

const cssInfoTooltipPopupBody = styled('div', `
  color: ${theme.text};
  text-align: left;
  padding: 0px 16px 16px 16px;
`);

const cssInfoTooltipPopupCloseButton = styled('div', `
  flex-shrink: 0;
  align-self: flex-end;
  cursor: pointer;
  --icon-color: ${theme.controlSecondaryFg};
  margin: 8px 8px 4px 0px;
  padding: 2px;
  border-radius: 4px;

  &:hover {
    background-color: ${theme.hover};
  }
`);

const cssDomWithTooltip = styled('div', `
  display: flex;
  align-items: center;
  column-gap: 8px;
`);
