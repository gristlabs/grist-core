/**
 * Main entrypoint for grist-core server.
 *
 * By default, starts up on port 8484.
 */

import { normalizeEmail } from "app/common/emails";
import { commonUrls } from "app/common/gristUrls";
import { isAffirmative } from "app/common/gutil";
import { ActivationsManager } from "app/gen-server/lib/ActivationsManager";
import { HomeDBManager } from "app/gen-server/lib/homedb/HomeDBManager";
import { AppSettings } from "app/server/lib/AppSettings";
import { updateDb } from "app/server/lib/dbUtils";
import { getAdminOrDefaultEmail } from "app/server/lib/InstallAdmin";
import log from "app/server/lib/log";
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

/**
 * Creates the database if needed and applies pending migrations.
 *
 * Returns an instance of {@link HomeDBManager} connected to the database.
 */
async function createOrUpdateDb() {
  // Make a blank db if needed.
  if (process.env.TEST_CLEAN_DATABASE) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createInitialDb } = require("test/gen-server/seed");
    await createInitialDb();
  } else {
    await updateDb();
  }
  const db = new HomeDBManager();
  await db.connect();
  await db.initializeSpecialIds({ skipWorkspaces: true });
  return db;
}

/**
 * Sets `GRIST_ADMIN_EMAIL` if `onRestartSetDefaultEmail` or `onRestartReplaceEmailWithAdmin`
 * are found in the `prefs` column of the `activations` table.
 *
 * This function is only intended for self-managed flavors of Grist (grist-core, grist-ee).
 * In the version of Grist hosted on getgrist.com, we use a different server entrypoint
 * and this file is unused. This is intentional, as we currently only want the preferences
 * above to take effect in self-managed flavors of Grist.
 */
async function setUpAdminEmail(db: HomeDBManager) {
  try {
    await db.runInTransaction(undefined, async (manager) => {
      const activations = new ActivationsManager(db);
      const { onRestartSetAdminEmail, onRestartReplaceEmailWithAdmin } = await activations.deletePrefs(
        ["onRestartSetAdminEmail", "onRestartReplaceEmailWithAdmin"],
        { transaction: manager },
      );

      const settings = new AppSettings("grist");
      const envVars = (await activations.current(manager)).prefs?.envVars || {};
      settings.setEnvVars(envVars);

      if (onRestartSetAdminEmail) {
        log.info(`Setting GRIST_ADMIN_EMAIL to "${onRestartSetAdminEmail}".`);
        const newEnvVars = { ...envVars, GRIST_ADMIN_EMAIL: onRestartSetAdminEmail };
        await activations.updateAppEnvFile(newEnvVars, manager);
        settings.setEnvVars(newEnvVars);
        log.info(`Successfully set GRIST_ADMIN_EMAIL to "${onRestartSetAdminEmail}".`);
      }

      if (onRestartReplaceEmailWithAdmin) {
        const adminEmail = getAdminOrDefaultEmail(settings);
        if (!adminEmail) {
          // We can reach this if GRIST_DEFAULT_EMAIL is set to "". The `setDefaultEnv`
          // call that sets "you@example.com" as the default value for GRIST_DEFAULT_EMAIL
          // is one place that lets such a value through. We can and probably should tighten
          // things up to treat empty string as undefined, but need to check expectations
          // elsewhere in code (e.g. an`AdminPanel` browser test sets it to "").
          //
          // TODO: Check implications of defaulting "" to "you@example.com".
          throw new Error("GRIST_ADMIN_EMAIL and GRIST_DEFAULT_EMAIL are not set");
        }

        if (normalizeEmail(onRestartReplaceEmailWithAdmin) === normalizeEmail(adminEmail)) {
          return;
        }

        log.info(`Replacing "${onRestartReplaceEmailWithAdmin}" with GRIST_ADMIN_EMAIL ("${adminEmail}").`);
        const user = await db.getExistingUserByLogin(onRestartReplaceEmailWithAdmin, manager);
        if (!user) {
          throw new Error(`user with email "${onRestartReplaceEmailWithAdmin}" not found`);
        }

        // If a user with `adminEmail` exists, we can't assign it to another user
        // without violating the uniqueness constraint on the `email` column in the
        // `logins` table. For now, just inform the user.
        if (await db.getExistingUserByLogin(adminEmail, manager)) {
          throw new Error(`cannot replace "${onRestartReplaceEmailWithAdmin}" with "${adminEmail}" ` +
            "because a user with that email already exists");
        }

        const login = user.logins[0];
        login.email = normalizeEmail(adminEmail);
        login.displayEmail = adminEmail;
        user.name = "";
        await manager.save([login, user]);
        log.info(`Successfully replaced "${onRestartReplaceEmailWithAdmin}" with GRIST_ADMIN_EMAIL ("${adminEmail}").`);
      }
    });
  } catch (err) {
    // Don't re-throw so we don't disrupt the rest of the startup process.
    log.error("Failed to set up admin email:", err);
  }
}

/**
 * If `GRIST_SINGLE_ORG` is set to a value other than `"docs"`, checks that the org
 * exists and creates it if needed (with `getAdminOrDefaultEmail()` as the owner).
 */
async function setUpSingleOrg(db: HomeDBManager) {
  // If a team/organization is specified, make sure it exists.
  const org = process.env.GRIST_SINGLE_ORG;
  if (org && org !== "docs") {
    try {
      db.unwrapQueryResult(await db.getOrg({
        userId: db.getPreviewerUserId(),
        includeSupport: false,
      }, org));
    } catch (e) {
      if (!String(e).match(/organization not found/)) {
        throw e;
      }
      const activations = new ActivationsManager(db);
      const settings = new AppSettings("grist");
      settings.setEnvVars((await activations.current()).prefs?.envVars || {});
      const email = getAdminOrDefaultEmail(settings);
      if (!email) {
        throw new Error("need GRIST_ADMIN_EMAIL or GRIST_DEFAULT_EMAIL to create site");
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

  // If auth is not configured, there's no login system, so provide a default email address.
  setDefaultEnv("GRIST_DEFAULT_EMAIL", "you@example.com");
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
    log.info("Setting up database...");
    const db = await createOrUpdateDb();
    await setUpAdminEmail(db);
    await setUpSingleOrg(db);
    log.info("Database setup complete.");
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
    log.error(err);
  });
}
