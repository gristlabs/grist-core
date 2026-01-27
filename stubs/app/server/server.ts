/**
 * Main entrypoint for grist-core server.
 *
 * By default, starts up on port 8484.
 */

import { normalizeEmail } from "app/common/emails";
import { commonUrls } from "app/common/gristUrls";
import { isAffirmative, isEmail } from "app/common/gutil";
import { ActivationsManager } from "app/gen-server/lib/ActivationsManager";
import { HomeDBManager } from "app/gen-server/lib/homedb/HomeDBManager";
import { AppSettings } from "app/server/lib/AppSettings";
import { updateDb } from "app/server/lib/dbUtils";
import { getDefaultEmail, GRIST_CORE_DEFAULT_EMAIL } from "app/server/lib/InstallAdmin";
import { runPrometheusExporter } from "app/server/prometheus-exporter";

import * as fse from "fs-extra";

const debugging = isAffirmative(process.env.DEBUG) || isAffirmative(process.env.VERBOSE);

// Set log levels before importing anything.
if (!debugging) {
  // Be a lot less noisy by default.
  setDefaultEnv("GRIST_LOG_LEVEL", "error");
}

// Use a distinct cookie.  Bump version to 2.
setDefaultEnv("GRIST_SESSION_COOKIE", "grist_core2");

setDefaultEnv("GRIST_SERVE_SAME_ORIGIN", "true");
if (!process.env.DOC_WORKER_COUNT) {
  setDefaultEnv("GRIST_SINGLE_PORT", "true");
}
setDefaultEnv("GRIST_DEFAULT_PRODUCT", "Free");

if (!process.env.GRIST_SINGLE_ORG) {
  // org identifiers in domains are fiddly to configure right, so by
  // default don't do that.
  setDefaultEnv("GRIST_ORG_IN_PATH", "true");
}

setDefaultEnv("GRIST_UI_FEATURES",
  "helpCenter,billing,templates,multiSite,multiAccounts,sendToDrive,createSite,supportGrist,themes");
setDefaultEnv("GRIST_WIDGET_LIST_URL", commonUrls.gristLabsWidgetRepository);

// It's important that this comes after the setDefaultEnv calls above. MergedServer reads
// some env vars at import time, including GRIST_WIDGET_LIST_URL.
// TODO: Fix this reliance on side effects during import.
// eslint-disable-next-line @import-x/order
import { MergedServer, parseServerTypes } from "app/server/MergedServer";

const G = {
  port: parseInt(process.env.PORT!, 10) || 8484,
};

// Set a default for an environment variable.
function setDefaultEnv(name: string, value: string) {
  if (process.env[name] === undefined) {
    process.env[name] = value;
  }
}

async function createOrUpdateDb() {
  // Make a blank db if needed.
  if (process.env.TEST_CLEAN_DATABASE) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createInitialDb } = require("test/gen-server/seed");
    await createInitialDb();
  }
  else {
    await updateDb();
  }
  const db = new HomeDBManager();
  await db.connect();
  await db.initializeSpecialIds({ skipWorkspaces: true });
  return db;
}

async function setUpDefaulEmail(db: HomeDBManager) {
  try {
    await db.runInTransaction(undefined, async (manager) => {
      const activations = new ActivationsManager(db);
      const settings = new AppSettings("grist");
      settings.setEnvVars((await activations.current(manager)).prefs?.envVars || {});
      const { onRestartSetDefaultEmail, onRestartReplaceEmailWithAdmin } = await activations.deletePrefs(
        ["onRestartSetDefaultEmail", "onRestartReplaceEmailWithAdmin"],
        { transaction: manager },
      );
      if (!onRestartSetDefaultEmail) {
        return;
      }
      if (!isEmail(onRestartSetDefaultEmail)) {
        throw new Error(`Invalid email: "${onRestartSetDefaultEmail}"`);
      }

      const currentEmail = getDefaultEmail({ settings }) ?? GRIST_CORE_DEFAULT_EMAIL;
      console.log(`Setting "${onRestartSetDefaultEmail}" as the default email (current value: "${currentEmail}")`);
      await activations.updateAppEnvFile({ GRIST_DEFAULT_EMAIL: onRestartSetDefaultEmail }, manager);

      if (onRestartReplaceEmailWithAdmin) {
        if (!isEmail(onRestartReplaceEmailWithAdmin)) {
          throw new Error(`Invalid email: "${onRestartReplaceEmailWithAdmin}"`);
        }

        const user = await db.getExistingUserByLogin(onRestartReplaceEmailWithAdmin, manager);
        if (!user) {
          throw new Error(`User with email "${onRestartReplaceEmailWithAdmin}" not found`);
        }

        const login = user.logins[0];
        login.email = normalizeEmail(onRestartSetDefaultEmail);
        login.displayEmail = onRestartSetDefaultEmail;
        await manager.save(login);
      }

      console.log(`Successfully set "${onRestartSetDefaultEmail}" as the default email.`);
    });
  }
  catch (err) {
    console.error("Failed to set default email:", err);
  }
}

async function setUpSingleOrg(db: HomeDBManager) {
  // If a team/organization is specified, make sure it exists.
  const org = process.env.GRIST_SINGLE_ORG;
  if (org && org !== "docs") {
    try {
      db.unwrapQueryResult(await db.getOrg({
        userId: db.getPreviewerUserId(),
        includeSupport: false,
      }, org));
    }
    catch (e) {
      if (!String(e).match(/organization not found/)) {
        throw e;
      }
      const activations = new ActivationsManager(db);
      const settings = new AppSettings("grist");
      settings.setEnvVars((await activations.current()).prefs?.envVars || {});
      const email = getDefaultEmail({ settings }) ?? GRIST_CORE_DEFAULT_EMAIL;
      if (!email) {
        throw new Error("need GRIST_DEFAULT_EMAIL to create site");
      }
      const profile = { email, name: email };
      const user = await db.getUserByLogin(email, { profile });
      db.unwrapQueryResult(await db.addOrg(user, {
        name: org,
        domain: org,
      }, {
        setUserAsOwner: false,
        useNewPlan: true,
      }));
    }
  }
}

export async function main() {
  console.log("Welcome to Grist.");
  if (!debugging) {
    console.log(`In quiet mode, see http://localhost:${G.port} to use.`);
    console.log("For full logs, re-run with DEBUG=1");
  }

  if (process.env.GRIST_PROMCLIENT_PORT) {
    runPrometheusExporter(parseInt(process.env.GRIST_PROMCLIENT_PORT, 10));
  }

  // Set directory for uploaded documents.
  setDefaultEnv("GRIST_DATA_DIR", "docs");
  setDefaultEnv("GRIST_SERVERS", "home,docs,static");
  if (process.env.GRIST_SERVERS?.includes("home")) {
    // By default, we will now start an untrusted port alongside a
    // home server, for bundled custom widgets.
    // Suppress with GRIST_UNTRUSTED_PORT=''
    setDefaultEnv("GRIST_UNTRUSTED_PORT", "0");
  }
  const serverTypes = parseServerTypes(process.env.GRIST_SERVERS);

  await fse.mkdirp(process.env.GRIST_DATA_DIR!);

  if (serverTypes.includes("home")) {
    console.log("Setting up database...");
    const db = await createOrUpdateDb();
    await setUpDefaulEmail(db);
    await setUpSingleOrg(db);
    console.log("Database setup complete.");
  }

  // Launch single-port, self-contained version of Grist.
  const mergedServer = await MergedServer.create(G.port, serverTypes);
  await mergedServer.run();
  if (process.env.GRIST_TESTING_SOCKET) {
    await mergedServer.flexServer.addTestingHooks();
  }
  if (process.env.GRIST_SERVE_PLUGINS_PORT) {
    await mergedServer.flexServer.startCopy("pluginServer", parseInt(process.env.GRIST_SERVE_PLUGINS_PORT, 10));
  }

  return mergedServer.flexServer;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
  });
}
