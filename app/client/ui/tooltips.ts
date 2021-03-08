/**
 * This module implements tooltips of two kinds:
 * - to be shown on hover, similar to the native "title" attribute (popweasel meant to provide
 *   that, but its machinery isn't really needed). TODO these aren't yet implemented.
 * - to be shown briefly, as a transient notification next to some action element.
 */

import {prepareForTransition} from 'app/client/ui/transitions';
import {testId} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {dom, DomContents, DomElementMethod, styled} from 'grainjs';
import Popper from 'popper.js';

export interface ITipOptions {
  // Where to place the tooltip relative to the reference element. Defaults to 'top'.
  // See https://popper.js.org/docs/v1/#popperplacements--codeenumcode
  placement?: Popper.Placement;

  // When set, a tooltip will replace any previous tooltip with the same key.
  key?: string;
}

export interface ITransientTipOptions extends ITipOptions {
  // When to remove the transient tooltip. Defaults to 2000ms.
  timeoutMs?: number;
}

export interface IHoverTipOptions extends ITransientTipOptions {
  // How soon after mouseenter to show it. Defaults to 100 ms.
  openDelay?: number;

  // If set and non-zero, remove the tip automatically after this time.
  timeoutMs?: number;

  // How soon after mouseleave to hide it. Defaults to 400 ms. It also gives the pointer some time
  // to be outside of the trigger and the tooltip content if the user moves the pointer from one
  // to the other.
  closeDelay?: number;

  // Also show the tip on clicking the element it's attached to.
  openOnClick?: boolean;
}

export type ITooltipContentFunc = (ctl: ITooltipControl) => DomContents;

export interface ITooltipControl {
  close(): void;
  getDom(): HTMLElement;       // The tooltip DOM.
}

// Map of open tooltips, mapping the key (from ITipOptions) to ITooltipControl that allows
// removing the tooltip.
const openTooltips = new Map<string, ITooltipControl>();

/**
 * Show tipContent briefly (2s by default), in a tooltip next to refElem (on top of it, by default).
 * See also ITipOptions.
 */
export function showTransientTooltip(refElem: Element, tipContent: DomContents, options: ITransientTipOptions = {}) {
  const ctl = showTooltip(refElem, () => tipContent, options);
  const origClose = ctl.close;
  ctl.close = () => { clearTimeout(timer); origClose(); };

  const timer = setTimeout(ctl.close, options.timeoutMs || 2000);
}

/**
 * Show the return value of tipContent(ctl) in a tooltip next to refElem (on top of it, by default).
 * Returns ctl. In both places, ctl is an object with a close() method, which closes the tooltip.
 * See also ITipOptions.
 */
export function showTooltip(
  refElem: Element, tipContent: ITooltipContentFunc, options: ITipOptions = {}
): ITooltipControl {
  const placement: Popper.Placement = options.placement || 'top';
  const key = options.key;

  // If we had a previous tooltip with the same key, clean it up.
  if (key) { openTooltips.get(key)?.close(); }

  // Cleanup involves destroying the Popper instance, removing the element, etc.
  function close() {
    popper.destroy();
    dom.domDispose(content);
    content.remove();
    if (key) { openTooltips.delete(key); }
  }
  const ctl: ITooltipControl = {close, getDom: () => content};

  // Add the content element.
  const content = cssTooltip({role: 'tooltip'}, tipContent(ctl), testId(`tooltip`));
  document.body.appendChild(content);

  // Create a popper for positioning the tooltip content relative to refElem.
  const popperOptions: Popper.PopperOptions = {
    modifiers: {preventOverflow: {boundariesElement: 'viewport'}},
    placement,
  };
  const popper = new Popper(refElem, content, popperOptions);

  // Fade in the content using transitions.
  prepareForTransition(content, () => { content.style.opacity = '0'; });
  content.style.opacity = '';

  if (key) { openTooltips.set(key, ctl); }
  return ctl;
}

/**
 * Render a tooltip on hover. Suitable for use during dom construction, e.g.
 *    dom('div', 'Trigger', hoverTooltip(() => 'Hello!'))
 */
export function hoverTooltip(tipContent: ITooltipContentFunc, options?: IHoverTipOptions): DomElementMethod {
  return (elem) => setHoverTooltip(elem, tipContent, options);
}

/**
 * Attach a tooltip to the given element, to be rendered on hover.
 */
export function setHoverTooltip(refElem: Element, tipContent: ITooltipContentFunc, options: IHoverTipOptions = {}) {
  const {openDelay = 100, timeoutMs, closeDelay = 400} = options;

  // Controller for closing the tooltip, if one is open.
  let tipControl: ITooltipControl|undefined;

  // Timer to open or close the tooltip, depending on whether tipControl is set.
  let timer: ReturnType<typeof setTimeout>|undefined;

  function clearTimer() {
    if (timer) { clearTimeout(timer); timer = undefined; }
  }
  function resetTimer(func: () => void, delay: number) {
    clearTimer();
    timer = setTimeout(func, delay);
  }
  function scheduleCloseIfOpen() {
    clearTimer();
    if (tipControl) { resetTimer(close, closeDelay); }
  }
  function open() {
    clearTimer();
    tipControl = showTooltip(refElem, ctl => tipContent({...ctl, close}), options);
    dom.onElem(tipControl.getDom(), 'mouseenter', clearTimer);
    dom.onElem(tipControl.getDom(), 'mouseleave', scheduleCloseIfOpen);
    if (timeoutMs) { resetTimer(close, timeoutMs); }
  }
  function close() {
    clearTimer();
    tipControl?.close();
    tipControl = undefined;
  }

  // We simulate hover effect by handling mouseenter/mouseleave.
  dom.onElem(refElem, 'mouseenter', () => {
    if (!tipControl && !timer) {
      resetTimer(open, openDelay);
    } else if (tipControl) {
      // Already shown, reset to newly-shown state.
      clearTimer();
      if (timeoutMs) { resetTimer(close, timeoutMs); }
    }
  });

  dom.onElem(refElem, 'mouseleave', scheduleCloseIfOpen);

  if (options.openOnClick) {
    // If request, re-open on click.
    dom.onElem(refElem, 'click', () => { close(); open(); });
  }
}

/**
 * Build a handy button for closing a tooltip.
 */
export function tooltipCloseButton(ctl: ITooltipControl): HTMLElement {
  return cssTooltipCloseButton(icon('CrossSmall'),
    dom.on('click', () => ctl.close()),
    testId('tooltip-close'),
  );
}

const cssTooltip = styled('div', `
  position: absolute;
  z-index: 5000;      /* should be higher than a modal */
  background-color: rgba(0, 0, 0, 0.75);
  border-radius: 3px;
  box-shadow: 0 0 2px rgba(0,0,0,0.5);
  text-align: center;
  color: white;
  width: auto;
  font-family: sans-serif;
  font-size: 10pt;
  padding: 8px 16px;
  margin: 4px;
  transition: opacity 0.2s;
`);

const cssTooltipCloseButton = styled('div', `
  cursor: pointer;
  user-select: none;
  width: 16px;
  height: 16px;
  line-height: 16px;
  text-align: center;
  margin: -4px -4px -4px 8px;
  --icon-color: white;
  border-radius: 16px;

  &:hover {
    background-color: white;
    --icon-color: black;
  }
`);
