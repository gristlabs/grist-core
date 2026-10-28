/**
 * Helpers for code that measures or positions things along the horizontal (inline) axis.
 *
 * Layout code should not know whether it is running left-to-right or right-to-left: it works in
 * "inline" coordinates, measured from the start edge (left in LTR, right in RTL), and lets the
 * browser mirror the rest through the `dir` attribute and logical CSS properties. These helpers
 * translate between inline coordinates and the physical values the DOM exposes (scrollLeft,
 * pageX, bounding rects).
 *
 * Direction is always read from the DOM (the computed `direction` of an element), never from a
 * setting, so that setting `dir` on any ancestor is enough to flip a component.
 */

/** Whether elem is laid out right-to-left. */
export function isRtl(elem: Element): boolean {
  return getComputedStyle(elem).direction === "rtl";
}

/**
 * Horizontal scroll offset of a scroll container, measured from its start edge: 0 when scrolled
 * to the start, growing as content scrolls away from it. (Browsers report scrollLeft as 0 at
 * the right edge and negative values going left for RTL containers; this hides that.)
 */
export function getInlineScroll(pane: Element): number {
  return Math.abs(pane.scrollLeft);
}

/** Scrolls a container to the given offset from its start edge (see getInlineScroll). */
export function setInlineScroll(pane: Element, offset: number): void {
  pane.scrollLeft = isRtl(pane) ? -offset : offset;
}

/**
 * Distance from the start edge of rect to the page x-coordinate x, growing toward the end edge.
 * Negative when x is before the start edge.
 */
export function inlineOffset(rect: DOMRect, x: number, rtl: boolean): number {
  return rtl ? rect.right - x : x - rect.left;
}

/** +1 when moving the mouse toward the end edge increases pageX (LTR), -1 when it decreases (RTL). */
export function inlineSign(rtl: boolean): 1 | -1 {
  return rtl ? -1 : 1;
}
