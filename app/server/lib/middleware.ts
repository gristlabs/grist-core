import { NextFunction, Request, Response } from "express";

/**
 * Sets Cache-Control response header to "no-cache".
 */
export function disableCache(_req: Request, res: Response, next: NextFunction) {
  res.header("Cache-Control", "no-cache");

  next();
}
