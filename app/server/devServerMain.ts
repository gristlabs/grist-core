/**
 *
 * Run a home server, doc worker, and static server as a single process for regular
 * development work.
 *
 *   PORT         -- this sets the main web server port (defaults to 8080)
 *   HOME_PORT    -- this sets the main home server port (defaults to 9000)
 *   STATIC_PORT  -- port for the static resource server (defaults to 9001)
 *   DOC_PORT     -- comma separated ports for doc workers (defaults to 9002)
 *   TEST_CLEAN_DATABASE -- reset the database(s) before starting
 *   GRIST_SINGLE_PORT -- if set, just a single combined server on HOME_PORT
 *   DOC_WORKER_COUNT  -- if set, makes sure there are at least this number of
 *                        doc workers.  Will add ports incrementally after the last
 *                        worker added with DOC_PORT.
 *
 * If you run more than one doc worker, you'll need to have a redis server running
 * and REDIS_URL set (e.g. to redis://localhost).
 *
 */

import {updateDb} from 'app/server/lib/dbUtils';
import {FlexServer} from 'app/server/lib/FlexServer';
import log from 'app/server/lib/log';
import {main as mergedServerMain} from 'app/server/mergedServerMain';
import {promisifyAll} from 'bluebird';
import * as fse from 'fs-extra';
import * as path from 'path';
import {createClient, RedisClient} from 'redis';

promisifyAll(RedisClient.prototype);

function getPort(envVarName: string, fallbackPort: number): number {
  const val = process.env[envVarName];
  return val ? parseInt(val, 10) : fallbackPort;
}

export async function main() {
  log.info("==========================================================================");
  log.info("== devServer");
  log.info("devServer starting.  Please do not set any ports in environment :-)");
  log.info("Server will be available at http://localhost:8080");

  process.env.GRIST_HOSTED = "true";
  if (!process.env.GRIST_ADAPT_DOMAIN) {
    process.env.GRIST_ADAPT_DOMAIN = "true";
  }

  // Experimental plugins are enabled by default for devs
  if (!process.env.GRIST_EXPERIMENTAL_PLUGINS) {
    process.env.GRIST_EXPERIMENTAL_PLUGINS = "1";
  }

  // Experimental plugins are enabled by default for devs
  if (!process.env.GRIST_ENABLE_REQUEST_FUNCTION) {
    process.env.GRIST_ENABLE_REQUEST_FUNCTION = "1";
  }

  // For tests, it is useful to start with the database in a known state.
  // If TEST_CLEAN_DATABASE is set, we reset the database before starting.
  if (process.env.TEST_CLEAN_DATABASE) {
    const {createInitialDb} = require('test/gen-server/seed');
    await createInitialDb();
    if (process.env.REDIS_URL) {
      await createClient(process.env.REDIS_URL).flushdbAsync();
    }
  } else {
    await updateDb();
  }

  // In V1, we no longer create a config.json file automatically if it is missing.
  // It is convenient to do that in the dev and test environment.
  const appRoot = path.dirname(path.dirname(__dirname));
  const instDir = process.env.GRIST_INST_DIR || appRoot;
  if (process.env.GRIST_INST_DIR) {
    const fileName = path.join(instDir, 'config.json');
    if (!(await fse.pathExists(fileName))) {
      const config = {
        untrustedContentOrigin: 'notset',
      };
      await fse.writeFile(fileName, JSON.stringify(config, null, 2));
    }
  }

  if (!process.env.GOOGLE_CLIENT_ID) {
    log.warn('GOOGLE_CLIENT_ID is not defined, Google Drive Plugin will not work.');
  }

  if (!process.env.GOOGLE_API_KEY) {
    log.warn('GOOGLE_API_KEY is not defined, Url plugin will not be able to access public files.');
  }

  if (process.env.GRIST_SINGLE_PORT) {
    log.info("==========================================================================");
    log.info("== mergedServer");
    const port = getPort("HOME_PORT", 8080);
    if (!process.env.APP_HOME_URL) {
      process.env.APP_HOME_URL = `http://localhost:${port}`;
    }
    const server = await mergedServerMain(port, ["home", "docs", "static"]);
    await server.addTestingHooks();
    return;
  }

  // The home server and web server(s) are effectively identical in Grist deployments
  // now, but remain distinct in some test setups.
  const homeServerPort = getPort("HOME_PORT", 9000);
  const webServerPort = getPort("PORT", 8080);
  if (!process.env.APP_HOME_URL) {
    // All servers need to know a "main" URL for Grist.  This is generally
    // that of the web server.  In some test setups, the web server port is left
    // at 0 to be auto-allocated, but for those tests it suffices to use the home
    // server port.
    process.env.APP_HOME_URL = `http://localhost:${webServerPort || homeServerPort}`;
  }

  // Bring up the static resource server
  log.info("==========================================================================");
  log.info("== staticServer");
  const staticPort = getPort("STATIC_PORT", 9001);
  process.env.APP_STATIC_URL = `http://localhost:${staticPort}`;
  await mergedServerMain(staticPort, ["static"]);

  // Bring up a home server
  log.info("==========================================================================");
  log.info("== homeServer");
  const home = await mergedServerMain(homeServerPort, ["home"]);

  // If a distinct webServerPort is specified, we listen also on that port, though serving
  // exactly the same content.  This is handy for testing CORS issues.
  if (webServerPort !== 0 && webServerPort !== homeServerPort) {
    await home.startCopy('webServer', webServerPort);
  }

  // Bring up the docWorker(s)
  log.info("==========================================================================");
  log.info("== docWorker");
  const ports = (process.env.DOC_PORT || '9002').split(',').map(port => parseInt(port, 10));
  if (process.env.DOC_WORKER_COUNT) {
    const n = parseInt(process.env.DOC_WORKER_COUNT, 10);
    while (ports.length < n) {
      ports.push(ports[ports.length - 1] + 1);
    }
  }
  log.info(`== ports ${ports.join(',')}`);
  if (ports.length > 1 && !process.env.REDIS_URL) {
    throw new Error('Need REDIS_URL=redis://localhost or similar for multiple doc workers');
  }
  const workers = new Array<FlexServer>();
  for (const port of ports) {
    workers.push(await mergedServerMain(port, ["docs"]));
  }

  await home.addTestingHooks(workers);
}


if (require.main === module) {
  main().catch((e) => {
    log.error("devServer failed to start %s", e);
    process.exit(1);
  });
}
