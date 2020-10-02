import {get as getBrowserGlobals} from 'app/client/lib/browserGlobals';

const G = getBrowserGlobals('document', 'window');

/**
 * Copy some text to the clipboard, by hook or by crook.
 */
export async function copyToClipboard(txt: string) {
  // If present and we have permission to use it, the navigator.clipboard interface
  // is convenient.  This method works in non-headless tests, and regular chrome
  // and firefox.
  if (G.window.navigator && G.window.navigator.clipboard && G.window.navigator.clipboard.writeText) {
    try {
      await G.window.navigator.clipboard.writeText(txt);
      return;
    } catch (e) {
      // no joy, try another way.
    }
  }
  // Otherwise fall back on document.execCommand('copy'), which requires text in
  // the dom to be selected.  Implementation here based on:
  //   https://hackernoon.com/copying-text-to-clipboard-with-javascript-df4d4988697f
  // This fallback takes effect at least in headless tests, and in Safari.
  const stash = G.document.createElement('textarea');
  stash.value = txt;
  stash.setAttribute('readonly', '');
  stash.style.position = 'absolute';
  stash.style.left = '-10000px';
  G.document.body.appendChild(stash);
  const selection = G.document.getSelection().rangeCount > 0 && G.document.getSelection().getRangeAt(0);
  stash.select();
  G.document.execCommand('copy');
  G.document.body.removeChild(stash);
  if (selection) {
    G.document.getSelection().removeAllRanges();
    G.document.getSelection().addRange(selection);
  }
}
