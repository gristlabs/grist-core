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

/**
 * Error-handling middleware that responds to errors in json. The status code is taken from
 * error.status property (for which ApiError is convenient), and defaults to 500.
 */
export const jsonErrorHandler: express.ErrorRequestHandler = (err, req, res, next) => {
  const mreq = req as RequestWithLogin;
  log.warn("Error during api call to %s: (%s) user %d params %s body %s", req.path, err.message,
           mreq.userId,
           JSON.stringify(req.params), JSON.stringify(req.body));
  res.status(err.status || 500).json({error: err.message || 'internal error',
                                      details: err.details});
};

/**
 * Middleware that responds with a 404 status and a json error object.
 */
export const jsonNotFoundHandler: express.RequestHandler = (req, res, next) => {
  res.status(404).json({error: `not found: ${req.url}`});
};
