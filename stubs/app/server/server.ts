/**
 * Main entrypoint for grist-core server.
 *
 * By default, starts up on port 8484.
 */

import {updateDb} from 'app/server/lib/dbUtils';
import {main as mergedServerMain} from 'app/server/mergedServerMain';
import * as fse from 'fs-extra';

const G = {
  port: parseInt(process.env.PORT!, 10) || 8484,
};

// Set a default for an environment variable.
function setDefaultEnv(name: string, value: string) {
  if (process.env[name] === undefined) {
    process.env[name] = value;
  }
}

export async function main() {
  // Use a distinct cookie.
  setDefaultEnv('GRIST_SESSION_COOKIE', 'grist_core');
  // There's no login system released yet, so set a default email address.
  setDefaultEnv('GRIST_DEFAULT_EMAIL', 'support@getgrist.com');
  // Set directory for uploaded documents.
  setDefaultEnv('GRIST_DATA_DIR', 'data');
  await fse.mkdirp(process.env.GRIST_DATA_DIR!);
  // Make a blank db if needed.
  await updateDb();
  // Launch single-port, self-contained version of Grist.
  await mergedServerMain(G.port, ["home", "docs", "static"]);
}

if (require.main === module) {
  // tslint:disable-next-line:no-console
  main().catch((err) => console.error(err));
}
