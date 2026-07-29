import { dom } from "grainjs";

/**
 * Most cells get an overflow ellipsis from the -webkit-line-clamp trick in viewCommon.css, but
 * Markdown cells opt out of it: their lines aren't of a uniform height, which makes the clamp
 * misplace them. So when a max row height is set, a Markdown cell is cut off with nothing to say
 * that there's more to it. Measure them instead, and set an "overflowing" class that
 * viewCommon.css turns into a visible cue.
 */

// Rounding in the height calculations can hide a fraction of a pixel in cells that aren't really
// cut off, so require more than that before showing the cue.
const OVERFLOW_TOLERANCE_PX = 1;

/** Measures every cell before setting any class, so a batch costs one layout rather than one each. */
function updateOverflow(clips: HTMLElement[]) {
  const measured = clips.map(clip => ({
    clip,
    isOverflowing: clip.scrollHeight - clip.clientHeight > OVERFLOW_TOLERANCE_PX,
  }));
  for (const { clip, isOverflowing } of measured) {
    clip.classList.toggle("overflowing", isOverflowing);
  }
}

/**
 * Marks the Markdown cells under `root` that are being cut off. Needed for printing, where rows are
 * built detached and serialized to HTML (see renderAllRows), so the cells that get printed are
 * copies that the observer below never saw.
 */
export function markOverflowingMarkdownCells(root: Element) {
  updateOverflow(Array.from(root.querySelectorAll<HTMLElement>(".field_clip.markdown")));
}

/**
 * The measurement can't happen while building the dom, since the height isn't known until the
 * Markdown has been laid out; nor in renderCellMarkdown's onMarkedResolved callback, which only
 * fires while the Markdown extensions are still loading. Hence a ResizeObserver.
 */
let _overflowObserver: ResizeObserver | undefined;

function getOverflowObserver(): ResizeObserver {
  return _overflowObserver ||= new ResizeObserver((entries) => {
    const clips = new Set<HTMLElement>();
    for (const entry of entries) {
      // Entries are cells and the content wrappers within them; either way, measure the cell.
      const clip = (entry.target as HTMLElement).closest<HTMLElement>(".field_clip");
      if (clip) { clips.add(clip); }
    }
    updateOverflow(Array.from(clips));
  });
}

/**
 * Keeps the "overflowing" class on a Markdown cell up to date for as long as the element lives.
 * Applied both to the cell, whose size changes when the max row height does, and to the content
 * wrapper inside it, whose size changes when the value or the column width does.
 */
export function watchForOverflow(elem: HTMLElement) {
  const observer = getOverflowObserver();
  observer.observe(elem);
  dom.onDisposeElem(elem, () => observer.unobserve(elem));
}
