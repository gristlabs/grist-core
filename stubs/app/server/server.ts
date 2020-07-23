/**
 * Main entrypoint for grist-core server.
 */

import {updateDb} from 'app/server/lib/dbUtils';
import {main as mergedServerMain} from 'app/server/mergedServerMain';
import * as fse from 'fs-extra';

const G = {
  port: parseInt(process.env.PORT!, 10) || 8484,
};

export async function main() {
  // Use a distinct cookie.
  if (!process.env.GRIST_SESSION_COOKIE) {
    process.env.GRIST_SESSION_COOKIE = 'grist_core';
  }
  // This is where documents are placed, for historic reasons.
  await fse.mkdirp('samples');
  // Make a blank db if needed.
  await updateDb();
  // Launch single-port, self-contained version of Grist.
  // You probably want to have GRIST_DEFAULT_EMAIL set since there's no login system yet.
  await mergedServerMain(G.port, ["home", "docs", "static"]);
}

if (require.main === module) {
  main().catch((err) => console.error(err));
}
