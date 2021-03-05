/**
 * This module implements tooltips of two kinds:
 * - to be shown on hover, similar to the native "title" attribute (popweasel meant to provide
 *   that, but its machinery isn't really needed). TODO these aren't yet implemented.
 * - to be shown briefly, as a transient notification next to some action element.
 */

import {prepareForTransition} from 'app/client/ui/transitions';
import {testId} from 'app/client/ui2018/cssVars';
import {dom, DomContents, styled} from 'grainjs';
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

export interface ITooltipControl {
  close(): void;
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
  refElem: Element, tipContent: (ctl: ITooltipControl) => DomContents, options: ITipOptions = {}
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
  const ctl: ITooltipControl = {close};

  // Add the content element.
  const content = cssTooltip({role: 'tooltip'}, tipContent(ctl), testId(`transient-tooltip`));
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


const cssTooltip = styled('div', `
  position: absolute;
  z-index: 5000;      /* should be higher than a modal */
  background-color: black;
  border-radius: 3px;
  box-shadow: 0 0 2px rgba(0,0,0,0.5);
  text-align: center;
  color: white;
  width: auto;
  font-family: sans-serif;
  font-size: 10pt;
  padding: 8px 16px;
  margin: 4px;
  opacity: 0.75;
  transition: opacity 0.2s;
`);
