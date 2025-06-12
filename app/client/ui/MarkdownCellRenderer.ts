import {domAsync } from 'app/client/lib/domAsync';
import {constructUrl} from 'app/client/models/gristUrlState';
import {buildCodeHighlighter} from 'app/client/ui/CodeHighlight';
import {sanitizeHTMLIntoDOM} from 'app/client/ui/sanitizeHTML';
import {gristIconLink} from 'app/client/ui2018/links';
import {AsyncCreate} from 'app/common/AsyncCreate';
import {DomContents} from 'grainjs';
import escape from 'lodash/escape';
import {marked, Marked} from 'marked';
import {markedHighlight} from 'marked-highlight';
import markedLinkifyIt from 'marked-linkify-it';

export const renderer = new marked.Renderer();

renderer.link = ({href, text}) => gristIconLink(constructUrl(href), text).outerHTML;

// Disable Markdown features that we aren't ready to support yet.
renderer.hr = ({raw}) => raw;
renderer.html = ({raw}) => escape(raw);
renderer.image = ({raw}) => raw;


// Creator for a Marked instance that includes some extra features.
const markedAsync = new AsyncCreate<Marked>(async () => {
  const highlight = await buildCodeHighlighter({ maxLines: 60 });
  return new Marked(
    markedHighlight({
      highlight: (code) => highlight(code),
    }),
    markedLinkifyIt()
  );
});

// Call render() synchronously if possible, or asynchronously otherwise. Aside from the first
// batch of renders, this will always be synchronous. This matters for printing, where we
// prepare a view in "beforeprint" callback, and async renders take place too late.
let markedResolved: Marked|undefined;
function domAsyncOrDirect(render: (markedObj: Marked) => DomContents) {
  return markedResolved ?
    render(markedResolved) :
    domAsync(markedAsync.get().then(markedObj => {
      markedResolved = markedObj;
      return render(markedResolved);
    }));
}

/**
 * Parses and renders the given markdownValue, sanitizing the result.
 *
 * This does not support HTML or images in the markdown value, and renders those as text.
 *
 * The actual rendering will happen asynchronously on first use, while the markdown loads some
 * extensions (specifically, the code highlighter).
 */
export function renderCellMarkdown(markdownValue: string): DomContents {
  return domAsyncOrDirect((markedObj: Marked) => {
    const source = markedObj.parse(markdownValue, {
      async: false,
      gfm: false,
      renderer,
    });
    return sanitizeHTMLIntoDOM(source);
  });
}
