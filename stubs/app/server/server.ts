/**
 * Main entrypoint for grist-core server.
 *
 * By default, starts up on port 8484.
 */

import {isAffirmative} from 'app/common/gutil';

const debugging = isAffirmative(process.env.DEBUG) || isAffirmative(process.env.VERBOSE);

// Set log levels before importing anything.
if (!debugging) {
  // Be a lot less noisy by default.
  setDefaultEnv('GRIST_LOG_LEVEL', 'error');
  setDefaultEnv('GRIST_LOG_SKIP_HTTP', 'true');
}

// Use a distinct cookie.  Bump version to 2.
setDefaultEnv('GRIST_SESSION_COOKIE', 'grist_core2');

setDefaultEnv('GRIST_SERVE_SAME_ORIGIN', 'true');
setDefaultEnv('GRIST_SINGLE_PORT', 'true');
setDefaultEnv('GRIST_DEFAULT_PRODUCT', 'Free');

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
  if (!debugging) {
    console.log(`In quiet mode, see http://localhost:${G.port} to use.`);
    console.log('For full logs, re-run with DEBUG=1');
  }

  // If SAML is not configured, there's no login system, so provide a default email address.
  if (!process.env.GRIST_SAML_SP_HOST && !process.env.GRIST_TEST_LOGIN) {
    setDefaultEnv('GRIST_DEFAULT_EMAIL', 'you@example.com');
  }
  // Set directory for uploaded documents.
  setDefaultEnv('GRIST_DATA_DIR', 'docs');
  await fse.mkdirp(process.env.GRIST_DATA_DIR!);
  // Make a blank db if needed.
  await updateDb();
  // Launch single-port, self-contained version of Grist.
  const server = await mergedServerMain(G.port, ["home", "docs", "static"]);
  if (process.env.GRIST_TESTING_SOCKET) {
    await server.addTestingHooks();
  }
}

if (require.main === module) {
  main().catch((err) => console.error(err));
}
