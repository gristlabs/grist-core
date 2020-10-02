import {reportError} from 'app/client/models/errors';
import {DomContents, onDisposeElem, replaceContent} from 'grainjs';
// grainjs annoyingly doesn't export browserGlobals tools, useful for testing in a simulated environment.
import {G} from 'grainjs/dist/cjs/lib/browserGlobals';

/**
 * Insert DOM contents produced by a Promise. Until the Promise is fulfilled, nothing shows up.
 * TODO: This would be a handy place to support options to show a loading spinner (perhaps
 * showing up if the promise takes more than a bit to show).
 */
export function domAsync(promiseForDomContents: Promise<DomContents>, onError = reportError): DomContents {
  const markerPre = G.document.createComment('a');
  const markerPost = G.document.createComment('b');

  // Function is added after the markers, to run once they have been attached to elem (the parent).
  return [markerPre, markerPost, (elem: Node) => {
    let disposed = false;
    promiseForDomContents
      .then((contents) => disposed || replaceContent(markerPre, markerPost, contents))
      .catch(onError);

    // If markerPost is disposed before the promise resolves, set insertContent to noop.
    onDisposeElem(markerPost, () => { disposed = true; });
  }];
}
