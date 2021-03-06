/**
 * Main entrypoint for grist-core server.
 *
 * By default, starts up on port 8484.
 */

// Set log levels before importing anything.
if (!process.env.DEBUG) {
  // Be a lot less noisy by default.
  setDefaultEnv('GRIST_LOG_LEVEL', 'error');
  setDefaultEnv('GRIST_LOG_SKIP_HTTP', 'true');
}

// Use a distinct cookie.
setDefaultEnv('GRIST_SESSION_COOKIE', 'grist_core');

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

// tslint:disable:no-console
export async function main() {
  console.log('Welcome to Grist.');
  if (!process.env.DEBUG) {
    console.log(`In quiet mode, see http://localhost:${G.port} to use.`);
    console.log('For full logs, re-run with DEBUG=1');
  }

  // There's no login system released yet, so set a default email address.
  setDefaultEnv('GRIST_DEFAULT_EMAIL', 'you@example.com');
  // Set directory for uploaded documents.
  setDefaultEnv('GRIST_DATA_DIR', 'docs');
  await fse.mkdirp(process.env.GRIST_DATA_DIR!);
  // Make a blank db if needed.
  await updateDb();
  // Launch single-port, self-contained version of Grist.
  await mergedServerMain(G.port, ["home", "docs", "static"]);
}

if (require.main === module) {
  main().catch((err) => console.error(err));
}
