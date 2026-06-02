import { AsyncRequestHandler } from "app/server/lib/expressWrap";

import { RequestHandler } from "express";

/**
 * Wrapper for async express handlers to catch errors (like expressWrap) and set response headers
 * to more restrictive values suitable for sensitive pages (like login pages):
 * - Disallow embedding in iframes.
 * - Isolate from cross-origin openers.
 *
 * This is currently only used in ext code, but included in core in case this handling may be
 * appropriate for more purposes in the future.
 */
export function expressLoginWrap(callback: AsyncRequestHandler): RequestHandler {
  return async (req, res, next) => {
    // Disallow embedding login pages in iframes.
    res.header("X-Frame-Options", "DENY");

    // Isolate login pages in their own browsing context group, breaking any window.opener link
    // with a possibly-malicious parent window. This is to protect against OAuth flow
    // interception. An example attack is a parent window intercepting user's attempt to "Sign
    // in with Google", and replacing the google URL with one to sign into a different Google
    // OAuth client, tricking the user into granting their credentials to the attacker.
    res.header("Cross-Origin-Opener-Policy", "same-origin");

    try {
      await callback(req, res, next);
    } catch (err) {
      next(err);
    }
  };
}
