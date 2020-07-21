import {tbind} from 'app/common/tbind';
import {NextFunction, Request, RequestHandler, Response} from 'express';

export type RequestWithTag = Request & {tag: string|null};

/**
 *
 * Middleware to handle a /v/TAG/ prefix on urls.
 *
 */
export class TagChecker {

  // Use app.use(tagChecker.inspectTag) to strip /v/TAG/ from urls (if it is present).
  // If the tag is present and matches what is expected, then `tag` is set on the request.
  // If the tag is present but does not match what is expected, a 400 response is returned.
  // If the tag is absent, `tag` is not set on the request.
  public readonly inspectTag: RequestHandler = tbind(this._inspectTag, this);

  // Use app.get('/path', tagChecker.requireTag, ...) to serve something only if the tag was
  // present in the url.  If the tag was not present, the route will not match and express will
  // look further.
  public readonly requireTag: RequestHandler = tbind(this._requireTag, this);

  // pass in the tag to expect.
  public constructor(public tag: string) {
  }

  // Like requireTag but for use wrapping other handlers in app.use().
  // Whatever it wraps will be skipped if that tag was not set.
  // See https://github.com/expressjs/express/issues/2591
  public withTag(handler: RequestHandler) {
    return function fn(req: Request, resp: Response, next: NextFunction) {
      if (!(req as RequestWithTag).tag) { return next(); }
      return handler(req, resp, next);
    };
  }

  // Removes tag from url if present.
  // Returns [remainder, tagInUrl, isMatch]
  private _removeTag(url: string): [string, string|null, boolean] {
    if (url.startsWith('/v/')) {
      const taggedUrl = url.match(/^\/v\/([a-zA-Z0-9.\-_]+)(\/.*)/);
      if (taggedUrl) {
        const tag = taggedUrl[1];
        // Turn off tag matching as we transition to serving
        // static resources from CDN.  We don't have version-sensitive
        // routing, so under ordinary operation landing page html served
        // by one home server could have its assets served by another home server.
        // Once the CDN is active, those asset requests won't reach the home
        // servers.  TODO: turn tag matching back on when tag mismatches
        // imply a bug.
        return [taggedUrl[2], tag, true /* tag === this.tag */];
      }
    }
    return [url, null, true];
  }

  private async _inspectTag(req: Request, resp: Response, next: NextFunction) {
    const [newUrl, urlTag, isOk] = this._removeTag(req.url);
    if (!isOk) {
      return resp.status(400).send({error: "Tag mismatch",
                                    expected: this.tag,
                                    received: urlTag});
    }
    req.url = newUrl;
    (req as RequestWithTag).tag = urlTag;
    return next();
  }

  private async _requireTag(req: Request, resp: Response, next: NextFunction) {
    if ((req as RequestWithTag).tag) { return next(); }
    return next('route');
  }
}
