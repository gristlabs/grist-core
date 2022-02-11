import {RequestWithLogin} from 'app/server/lib/Authorizer';
import * as log from 'app/server/lib/log';
import * as express from 'express';

/**
 * Wrapper for async express endpoints to catch errors and forward them to the error handler.
 */
export function expressWrap(callback: express.RequestHandler): express.RequestHandler {
  return async (req, res, next) => {
    try {
      await callback(req, res, next);
    } catch (err) {
      next(err);
    }
  };
}

interface JsonErrorHandlerOptions {
  shouldLogBody?: boolean;
  shouldLogParams?: boolean;
}

/**
 * Returns a custom error-handling middleware that responds to errors in json.
 *
 * Currently allows for toggling of logging request bodies and params.
 */
const buildJsonErrorHandler = (options: JsonErrorHandlerOptions = {}): express.ErrorRequestHandler => {
  return (err, req, res, _next) => {
    const mreq = req as RequestWithLogin;
    log.warn(
      "Error during api call to %s: (%s)%s%s%s",
      req.path, err.message, mreq.userId !== undefined ? ` user ${mreq.userId}` : '',
      options.shouldLogParams !== false ? ` params ${JSON.stringify(req.params)}` : '',
      options.shouldLogBody !== false ? ` body ${JSON.stringify(req.body)}` : '',
    );
    let details = err.details && {...err.details};
    const status = details?.status || err.status || 500;
    if (details) {
      // Remove some details exposed for websocket API only.
      delete details.accessMode;
      delete details.status;  // TODO: reconcile err.status and details.status, no need for both.
      if (Object.keys(details).length === 0) { details = undefined; }
    }
    res.status(status).json({error: err.message || 'internal error', details});
  };
};

/**
 * Error-handling middleware that responds to errors in json. The status code is taken from
 * error.status property (for which ApiError is convenient), and defaults to 500.
 */
export const jsonErrorHandler: express.ErrorRequestHandler = buildJsonErrorHandler();

/**
 * Variant of `jsonErrorHandler` that skips logging request bodies and params.
 *
 * Should be used for sensitive routes, such as those under '/api/auth/'.
 */
export const secureJsonErrorHandler: express.ErrorRequestHandler = buildJsonErrorHandler({
  shouldLogBody: false,
  shouldLogParams: false,
});

/**
 * Middleware that responds with a 404 status and a json error object.
 */
export const jsonNotFoundHandler: express.RequestHandler = (req, res, next) => {
  res.status(404).json({error: `not found: ${req.url}`});
};
