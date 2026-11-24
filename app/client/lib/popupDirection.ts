/**
 * Popups (menus, dropdown lists, tooltips) belong to the interface, wherever they are opened
 * from, and open on the side that suits its direction: one that opens to the right, or lines up
 * with the left edge of what it is attached to, does the opposite in a right-to-left interface.
 *
 * Callers go on naming the side as it is in a left-to-right interface. The translation is made
 * in one place: for popups placed by popper.js (all of those made through popweasel) in the
 * library's own update step, installed here; the few placed with @popperjs/core call
 * mirrorPlacement() themselves.
 */
import { interfaceRtl } from "app/client/lib/direction";

import Popper from "popper.js";

/**
 * The placement to use, in an interface of the given direction, for a placement written for a
 * left-to-right one. To the side of the reference, "left" and "right" swap; above or below it,
 * the alignments "start" (left edges together) and "end" swap.
 */
export function mirrorPlacement<T extends string>(placement: T, rtl: boolean): T {
  if (!rtl) { return placement; }
  const [base, variation] = placement.split("-");
  if (base === "left" || base === "right") {
    return [base === "left" ? "right" : "left", ...(variation ? [variation] : [])].join("-") as T;
  }
  if ((base === "top" || base === "bottom") && (variation === "start" || variation === "end")) {
    return `${base}-${variation === "start" ? "end" : "start"}` as T;
  }
  return placement;
}

let installed = false;

/**
 * Makes every popper.js popup take its placement through mirrorPlacement(), by the direction of
 * the interface at the time it is placed. Safe to call more than once.
 */
export function installPopupDirection() {
  if (installed) { return; }
  installed = true;
  // Each instance binds this method when it is constructed, after which it places itself.
  const proto = Popper.prototype as any;
  const update = proto.update;
  proto.update = function(this: any) {
    this._placementAsWritten ??= this.options.placement;
    this.options.placement = mirrorPlacement(this._placementAsWritten, interfaceRtl().get());
    return update.call(this);
  };
}
