/**
 *
 * Returns a popup control allowing to open/close a popup using as content the element returned by
 * the given func. Note that the `trigger` option is ignored by this function and that the default
 * of the `attach` option is `body` instead of `null`.
 *
 * It allows you to bind the creation of the popup to a menu item as follow:
 *   const ctl = popupControl(triggerElem, (ctl) => buildDom(ctl));
 *   ...
 *   menuItem(elem => ctl.open(), 'do stuff...')
 */

import { domDispose } from "grainjs";
import { IOpenController, IPopupDomCreator, IPopupOptions, PopupControl } from "popweasel";

export function popupControl(reference: Element, domCreator: IPopupDomCreator, options: IPopupOptions): PopupControl {

  function openFunc(openCtl: IOpenController) {
    const content = domCreator(openCtl);
    function dispose() { domDispose(content); }
    return {content, dispose};
  }

  const ctl = PopupControl.create(null);

  ctl.attachElem(reference, openFunc, {
    attach: 'body',
    boundaries: 'viewport',
    ...options,
    trigger: undefined
  });

  return ctl;
}
