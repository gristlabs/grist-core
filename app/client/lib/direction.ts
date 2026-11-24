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

import { dom, DomElementArg, IDisposableOwner, Observable } from "grainjs";

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

/**
 * A side named relative to the direction of reading ("start" is where a line begins), and a side
 * named as it is seen on screen. Code and stored settings speak of inline sides; people are told,
 * and shown, physical ones. The two functions below are the only place the two meet in script;
 * in stylesheets the same translation is the pair of custom properties --inline-start-side and
 * --inline-end-side (see viewCommon.css).
 */
export type InlineSide = "start" | "end";
export type PhysicalSide = "left" | "right";

/** The side of the screen on which an inline side is seen. */
export function toPhysicalSide(side: InlineSide, rtl: boolean): PhysicalSide {
  return (side === "start") === rtl ? "right" : "left";
}

/** The inline side that is seen on the given side of the screen. */
export function toInlineSide(side: PhysicalSide, rtl: boolean): InlineSide {
  return (side === "right") === rtl ? "start" : "end";
}

/**
 * The horizontal alignment option of a column ("left", "center" or "right") dates from before
 * sheets had an orientation, and "left" is also what a column is given when it has no alignment
 * of its own. It is read as an inline side: "left" is the side the sheet starts from, "right" the
 * side it ends at. Returns the inline side, or "center".
 */
export function alignmentSide(alignment: string | undefined): InlineSide | "center" {
  return alignment === "right" ? "end" : alignment === "center" ? "center" : "start";
}

/**
 * Value for `text-align` that puts text on the side the alignment option names. It is a physical
 * side resolved from the direction of the element's surroundings, not `start` or `end`: cells
 * order their characters by their own content (`unicode-bidi: plaintext`), and for such an element
 * `start` would follow the content too, giving a column of mixed languages a ragged edge.
 */
export function alignmentToTextAlign(alignment: string | undefined): string {
  const side = alignmentSide(alignment);
  return side === "center" ? "center" : `var(--inline-${side}-side)`;
}

/** Value for `justify-content` that packs items on the side the alignment option names. */
export function alignmentToJustify(alignment: string | undefined): string {
  const side = alignmentSide(alignment);
  return side === "center" ? "center" : `flex-${side}`;
}

/**
 * An observable of whether an element is laid out right-to-left, for script that has to show a
 * person a physical side and keep it true when the direction changes. The element is looked up
 * each time, so it may not exist yet, or be replaced; without one the answer is left-to-right.
 * Direction changes only through `dir` attributes, so those are what is watched.
 */
export function observeRtl(
  owner: IDisposableOwner | null, getElem: () => Element | null | undefined,
): Observable<boolean> {
  const read = () => {
    const elem = getElem();
    return Boolean(elem && isRtl(elem));
  };
  const obs = Observable.create(owner, read());
  const watcher = new MutationObserver(() => obs.set(read()));
  watcher.observe(document.documentElement, { attributes: true, attributeFilter: ["dir"], subtree: true });
  owner?.autoDispose({ dispose: () => watcher.disconnect() });
  return obs;
}

/**
 * The mark of a part of the interface that is held left-to-right because it cannot yet be laid
 * out either way. The page takes its direction from the language of the interface; converting a
 * part means removing its hold, and putting one on whatever inside it is still waiting. A search
 * for this name lists what is left.
 */
export const DIRECTION_HOLD = "data-direction-hold";

/** Holds an element, and what is inside it, left-to-right. See DIRECTION_HOLD. */
export function holdLtr(): DomElementArg {
  return [dom.attr("dir", "ltr"), dom.attr(DIRECTION_HOLD, "")];
}

let _interfaceRtl: Observable<boolean> | undefined;

/** Whether the interface is laid out right-to-left: the direction the page itself states. */
export function interfaceRtl(): Observable<boolean> {
  return _interfaceRtl ??= observeRtl(null, () => document.documentElement);
}

/**
 * Lets a part of the interface that can be laid out either way take the direction of the
 * interface again, from under a hold (see DIRECTION_HOLD). What is inside it and still waiting
 * gets a hold of its own.
 */
export function followInterface(): DomElementArg {
  return dom.attr("dir", use => use(interfaceRtl()) ? "rtl" : "ltr");
}

/** Value for `transform` that turns a downward arrow to point where a collapsed section continues. */
export const COLLAPSED_ARROW = "rotate(calc(-90deg * var(--inline-sign)))";
