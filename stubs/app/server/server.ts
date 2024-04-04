/**
 * Main entrypoint for grist-core server.
 *
 * By default, starts up on port 8484.
 */

import {commonUrls} from 'app/common/gristUrls';
import {isAffirmative} from 'app/common/gutil';
import {HomeDBManager} from 'app/gen-server/lib/HomeDBManager';
import {TEAM_FREE_PLAN} from 'app/common/Features';

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

if (!process.env.GRIST_SINGLE_ORG) {
  // org identifiers in domains are fiddly to configure right, so by
  // default don't do that.
  setDefaultEnv('GRIST_ORG_IN_PATH', 'true');
}

setDefaultEnv('GRIST_UI_FEATURES',
  'helpCenter,billing,templates,multiSite,multiAccounts,sendToDrive,createSite,supportGrist');
setDefaultEnv('GRIST_WIDGET_LIST_URL', commonUrls.gristLabsWidgetRepository);
import {updateDb} from 'app/server/lib/dbUtils';
import {main as mergedServerMain, parseServerTypes} from 'app/server/mergedServerMain';
import * as fse from 'fs-extra';
import {runPrometheusExporter} from './prometheus-exporter';

const G = {
  port: parseInt(process.env.PORT!, 10) || 8484,
};

// Set a default for an environment variable.
function setDefaultEnv(name: string, value: string) {
  if (process.env[name] === undefined) {
    process.env[name] = value;
  }
}

async function setupDb() {
  // Make a blank db if needed.
  if (process.env.TEST_CLEAN_DATABASE) {
    const {createInitialDb} = require('test/gen-server/seed');
    await createInitialDb();
  } else {
    await updateDb();
  }
  const db = new HomeDBManager();
  await db.connect();
  await db.initializeSpecialIds({skipWorkspaces: true});

  // If a team/organization is specified, make sure it exists.
  const org = process.env.GRIST_SINGLE_ORG;
  if (org && org !== 'docs') {
    try {
      db.unwrapQueryResult(await db.getOrg({
        userId: db.getPreviewerUserId(),
        includeSupport: false,
      }, org));
    } catch(e) {
      if (!String(e).match(/organization not found/)) {
        throw e;
      }
      const email = process.env.GRIST_DEFAULT_EMAIL;
      if (!email) {
        throw new Error('need GRIST_DEFAULT_EMAIL to create site');
      }
      const profile = {email, name: email};
      const user = await db.getUserByLogin(email, {profile});
      if (!user) {
        // This should not happen.
        throw new Error('failed to create GRIST_DEFAULT_EMAIL user');
      }
      db.unwrapQueryResult(await db.addOrg(user, {
        name: org,
        domain: org,
      }, {
        setUserAsOwner: false,
        useNewPlan: true,
        planType: TEAM_FREE_PLAN
      }));
    }
  }
}

// tslint:disable:no-console
export async function main() {
  console.log('Welcome to Grist.');
  if (!debugging) {
    console.log(`In quiet mode, see http://localhost:${G.port} to use.`);
    console.log('For full logs, re-run with DEBUG=1');
  }

  if (process.env.GRIST_PROMCLIENT_PORT) {
    runPrometheusExporter(parseInt(process.env.GRIST_PROMCLIENT_PORT, 10));
  }

  // If SAML is not configured, there's no login system, so provide a default email address.
  setDefaultEnv('GRIST_DEFAULT_EMAIL', 'you@example.com');
  // Set directory for uploaded documents.
  setDefaultEnv('GRIST_DATA_DIR', 'docs');
  setDefaultEnv('GRIST_SERVERS', 'home,docs,static');
  if (process.env.GRIST_SERVERS?.includes('home')) {
    // By default, we will now start an untrusted port alongside a
    // home server, for bundled custom widgets.
    // Suppress with GRIST_UNTRUSTED_PORT=''
    setDefaultEnv('GRIST_UNTRUSTED_PORT', '0');
  }
  const serverTypes = parseServerTypes(process.env.GRIST_SERVERS);

  await fse.mkdirp(process.env.GRIST_DATA_DIR!);

  if (serverTypes.includes("home")) {
    console.log('Setting up database...');
    await setupDb();
    console.log('Database setup complete.');
  }

  // Launch single-port, self-contained version of Grist.
  const server = await mergedServerMain(G.port, serverTypes);
  if (process.env.GRIST_TESTING_SOCKET) {
    await server.addTestingHooks();
  }
  if (process.env.GRIST_SERVE_PLUGINS_PORT) {
    await server.startCopy('pluginServer', parseInt(process.env.GRIST_SERVE_PLUGINS_PORT, 10));
  }
  return server;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
  });
}
