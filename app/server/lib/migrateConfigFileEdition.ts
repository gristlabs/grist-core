import { COMMUNITY_EDITION, FULL_EDITION, GristEdition } from "app/common/gristUrls";
import { Activation } from "app/gen-server/entity/Activation";
import { ActivationsManager } from "app/gen-server/lib/ActivationsManager";
import log from "app/server/lib/log";
import { getInstanceRoot } from "app/server/lib/places";

import * as fs from "fs";
import * as path from "path";

export const Deps = {
  readFileSync: fs.readFileSync,
};

/**
 * Copies the edition from the legacy config.json file to `GRIST_SERVER_EDITION` in the
 * `prefs.envVars` JSON value in the {@link activation} record, if `GRIST_SERVER_EDITION`
 * is not already set.
 *
 * Returns the updated activation record if the edition was copied, and the original record
 * otherwise.
 *
 * Older versions of Grist persisted the edition in the `edition` key of the config.json file
 * in the instance root (e.g. `/persist/config.json`), which was written by the Admin Panel's
 * edition toggle. The edition now lives in the `GRIST_SERVER_EDITION` setting, read from the
 * environment or from `prefs.envVars` of the activation record (see `app/server/lib/gristSettings.ts`).
 */
export async function migrateConfigFileEdition(
  activations: ActivationsManager,
  activation: Activation,
): Promise<Activation> {
  if (activation.prefs?.envVars?.GRIST_SERVER_EDITION !== undefined) { return activation; }

  const edition = readConfigFileEdition();
  if (edition === undefined) { return activation; }

  await activations.updateEnvVars({ GRIST_SERVER_EDITION: edition });

  log.info("migrateConfigFileEdition: migrated the edition in %s to GRIST_SERVER_EDITION=%s in the " +
    "home database", getConfigFilePath(), edition);

  return await activations.current();
}

function getConfigFilePath(): string {
  return path.join(getInstanceRoot(), "config.json");
}

/**
 * Returns the Grist edition from the legacy config.json file, which older versions of Grist
 * wrote before `GRIST_SERVER_EDITION` was added, or undefined if a value was not able to
 * be read (e.g. file doesn't exist, file contents are invalid).
 */
function readConfigFileEdition(): GristEdition | undefined {
  const configPath = getConfigFilePath();
  let value: unknown;
  try {
    value = JSON.parse(Deps.readFileSync(configPath, "utf8"))?.edition;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      log.warn("migrateConfigFileEdition: ignoring invalid config file (%s) %s", configPath, e);
    }
    return undefined;
  }

  switch (value) {
    case "enterprise": return FULL_EDITION;
    case "core": return COMMUNITY_EDITION;
    default: return undefined;
  }
}
