import { findLinks } from 'app/client/lib/textUtils';
import { sameDocumentUrlState, urlState } from 'app/client/models/gristUrlState';
import { hideInPrintView, testId, theme } from 'app/client/ui2018/cssVars';
import { cssIconSpanBackground, iconSpan } from 'app/client/ui2018/icons';
import { useBindable } from 'app/common/gutil';
import { BindableValue, dom, DomArg, IDomArgs, styled } from 'grainjs';

/**
 * Styling for a simple <A HREF> link.
 */

const linkStyles = `
  color: ${theme.link};
  --icon-color: ${theme.link};
  text-decoration: none;
`;

const linkHoverStyles = `
  color: ${theme.linkHover};
  --icon-color: ${theme.linkHover};
  text-decoration: underline;
`;

export const cssLink = styled('a', `
  ${linkStyles}
  &:hover, &:focus {
    ${linkHoverStyles}
  }
`);

/**
 * This helps us apply link styles when we can't directly use `cssLink`,
 * for example when styling generated markdown.
 */
export const cssNestedLinks = styled('div', `
  & a {
    ${linkStyles}
  }
  & a:hover, & a:focus {
    ${linkHoverStyles}
  }
`);

export function gristLink(href: BindableValue<string>, ...args: IDomArgs<HTMLElement>) {
  return dom("a",
    dom.attr("href", use => withAclAsUserParam(useBindable(use, href))),
    dom.attr("target", "_blank"),
    dom.on("click", handleGristLinkClick),
    // stop propagation to prevent the grist custom context menu to show up and let the default one
    // to show up instead.
    dom.on("contextmenu", ev => ev.stopPropagation()),
    // As per Google and Mozilla recommendations to prevent opened links
    // from running on the same process as Grist:
    // https://developers.google.com/web/tools/lighthouse/audits/noopener
    dom.attr("rel", "noopener noreferrer"),
    hideInPrintView(),
    args,
  );
}

export function gristIconLink(href: string, label = href) {
  return cssMaybeWrap(
    gristLink(href,
      cssIconSpanBackground(
        iconSpan("FieldLink", testId('tb-link-icon')),
        dom.cls(cssHoverInText.className),
      ),
    ),
    linkColor(label),
    testId("text-link"),
  );
}

/**
 * If possible (i.e. if `url` points to somewhere in the current document)
 * use pushUrl to navigate without reloading or opening a new tab
 */
export function handleGristLinkClick(ev: MouseEvent, elem: HTMLAnchorElement) {
  // Only override plain-vanilla clicks.
  if (ev.shiftKey || ev.metaKey || ev.ctrlKey || ev.altKey) { return; }

  const newUrlState = sameDocumentUrlState(elem.href);
  if (!newUrlState) { return; }

  ev.preventDefault();
  urlState().pushUrl(newUrlState).catch(reportError);
}

/**
 * Generates dom contents out of a text with clickable links.
 */
export function makeLinks(text: string) {
  try {
    const domElements: DomArg[] = [];
    for (const { value, isLink } of findLinks(text)) {
      if (isLink) {
        domElements.push(gristIconLink(value));
      }
      else {
        domElements.push(value);
      }
    }
    return domElements;
  }
  catch(ex) {
    // In case when something went wrong, simply log and return original text, as showing
    // links is not that important.
    console.warn("makeLinks failed", ex);
    return text;
  }
}

/**
 * Returns a modified version of `href` with the value of `aclAsUser_` from
 * the current URL, if present.
 *
 * Only works for same document URLs (i.e. URLs that can be navigated to
 * without reloading the page).
 */
function withAclAsUserParam(href: string) {
  const state = urlState().state.get();
  const aclAsUser = state.params?.linkParameters?.aclAsUser;
  if (!aclAsUser) {
    return href;
  }

  let hrefWithParams: string;
  try {
    const url = new URL(href);
    if (!url.searchParams.has("aclAsUser_")) {
      url.searchParams.set("aclAsUser_", aclAsUser);
    }
    hrefWithParams = url.href;
  }
  catch {
    return href;
  }

  return sameDocumentUrlState(hrefWithParams) ? hrefWithParams : href;
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
