import * as express from 'express';
import {ActiveDoc} from 'app/server/lib/ActiveDoc';
import {DownloadOptions} from 'app/server/lib/Export';

export async function downloadTableSchema(
  activeDoc: ActiveDoc,
  req: express.Request,
  res: express.Response,
  options: DownloadOptions
) {
  res.send({ hello: "World" });
}