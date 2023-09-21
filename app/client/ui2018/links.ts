import {findLinks} from 'app/client/lib/textUtils';
import { sameDocumentUrlState, urlState } from 'app/client/models/gristUrlState';
import { hideInPrintView, testId, theme } from 'app/client/ui2018/cssVars';
import {cssIconBackground, icon} from 'app/client/ui2018/icons';
import { CellValue } from 'app/plugin/GristData';
import { dom, DomArg, IDomArgs, Observable, styled } from 'grainjs';

/**
 * Styling for a simple <A HREF> link.
 */

export const cssLink = styled('a', `
  color: ${theme.link};
  --icon-color: ${theme.link};
  text-decoration: none;
  &:hover, &:focus {
    color: ${theme.linkHover};
    --icon-color: ${theme.linkHover};
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
    hideInPrintView(),
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

/**
 * Generates dom contents out of a text with clickable links.
 */
export function makeLinks(text: string) {
  try {
    const domElements: DomArg[] = [];
    for (const {value, isLink} of findLinks(text)) {
      if (isLink) {
        // Wrap link with a span to provide hover on and to override wrapping.
        domElements.push(cssMaybeWrap(
          gristLink(value,
            cssIconBackground(
              icon("FieldLink", testId('tb-link-icon')),
              dom.cls(cssHoverInText.className),
            ),
          ),
          linkColor(value),
          testId("text-link")
        ));
      } else {
        domElements.push(value);
      }
    }
    return domElements;
  } catch(ex) {
    // In case when something went wrong, simply log and return original text, as showing
    // links is not that important.
    console.warn("makeLinks failed", ex);
    return text;
  }
}

// For links we want to break all the parts, not only words.
const cssMaybeWrap = styled('span', `
  white-space: inherit;
  .text_wrapping & {
    word-break: break-all;
    white-space: pre-wrap;
  }
`);

// A gentle transition effect on hover in, and the same effect on hover out with a little delay.
export const cssHoverIn = (parentClass: string) => styled('span', `
  --icon-color: var(--grist-actual-cell-color, ${theme.link});
  margin: -1px 2px 2px 0;
  border-radius: 3px;
  transition-property: background-color;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  transition-duration: 150ms;
  transition-delay: 90ms;
  .${parentClass}:hover & {
    --icon-background: ${theme.link};
    --icon-color: white;
    transition-duration: 80ms;
    transition-delay: 0ms;
  }
`);

const cssHoverInText = cssHoverIn(cssMaybeWrap.className);

const linkColor = styled('span', `
  color: var(--grist-actual-cell-color, ${theme.link});
`);
