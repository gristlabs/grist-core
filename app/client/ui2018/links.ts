import { sameDocumentUrlState, urlState } from 'app/client/models/gristUrlState';
import { colors } from 'app/client/ui2018/cssVars';
import { CellValue } from 'app/plugin/GristData';
import { dom, IDomArgs, Observable, styled } from 'grainjs';

/**
 * Styling for a simple green <A HREF> link.
 */

// Match the font-weight of buttons.
export const cssLink = styled('a', `
  color: ${colors.lightGreen};
  --icon-color: ${colors.lightGreen};
  text-decoration: none;
  &:hover, &:focus {
    color: ${colors.lightGreen};
    --icon-color: ${colors.lightGreen};
    text-decoration: underline;
  }
`);

export function gristLink(href: string|Observable<string>, ...args: IDomArgs<HTMLElement>) {
  return dom("a",
    dom.attr("href", href),
    dom.attr("target", "_blank"),
    dom.on("click", ev => onClickHyperLink(ev, typeof href === 'string' ? href : href.get())),
    // stop propagation to prevent the grist custom context menu to show up and let the default one
    // to show up instead.
    dom.on("contextmenu", ev => ev.stopPropagation()),
    // As per Google and Mozilla recommendations to prevent opened links
    // from running on the same process as Grist:
    // https://developers.google.com/web/tools/lighthouse/audits/noopener
    dom.attr("rel", "noopener noreferrer"),
    args
  );
}

/**
 * If possible (i.e. if `url` points to somewhere in the current document)
 * use pushUrl to navigate without reloading or opening a new tab
 */
export async function onClickHyperLink(ev: MouseEvent, url: CellValue) {
  // Only override plain-vanilla clicks.
  if (ev.shiftKey || ev.metaKey || ev.ctrlKey || ev.altKey) { return; }

  const newUrlState = sameDocumentUrlState(url);
  if (!newUrlState) { return; }

  ev.preventDefault();
  await urlState().pushUrl(newUrlState);
}
