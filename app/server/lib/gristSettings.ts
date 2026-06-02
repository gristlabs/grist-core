/**
 * Utilities for reading Grist settings from {@link appSettings}.
 *
 * As of this writing, the vast majority of Grist settings are only read from the environment, either
 * via direct access to `process.env`, or via the read/require methods of {@link appSettings}, without
 * using any of the exported code below to do so. As such, modifications to their values is normally
 * only possible by restarting the server process with new environment variables.
 *
 * A small, growing list of settings are read from the database, in addition to the environment. This
 * is handled automatically by the read/require methods of {@link appSettings}, which first checks the
 * environment before falling back to the database. Since setting values in the database may be modified
 * after a server process starts, code relying on the value of a particular setting needs to make a
 * determination on whether it should always use the live value of a setting, or the value that was
 * read on startup, requiring a restart for changes to take effect. This module is an early attempt at
 * formalizing this behavior so that callers are made aware of when modifications to particular
 * settings go into effect.
 *
 * Settings that require a server restart before database modifications go into effect are enumerated in
 * {@link RestartRequiredSettingEnvVar}, and settings that immediately go into effect upon modification
 * are enumerated in {@link ReloadableSettingEnvVar}. Accessor functions for both are cached using
 * `lodash/memoize`, but only the latter is invalidated whenever DB values change (see `PATCH /install/prefs`).
 * In the future, `AppSettings` could be extended to handle caching/freezing and reloading of setting
 * values.
 */

import { StringUnion } from "app/common/StringUnion";
import { AppSettings, appSettings, AppSettingSource } from "app/server/lib/AppSettings";

import { MemoizedFunction } from "lodash";
import memoize from "lodash/memoize";

/**
 * A value read from {@link appSettings} with its source.
 */
export interface ValueWithSource<T> {
  value: T;
  source: AppSettingSource | undefined;
}

/**
 * The environment variable for a restart required setting that may be persisted in the database.
 *
 * Restart required settings are NOT updated dynamically whenever their value in the database is modified,
 * and require a server process restart to go into effect.
 */
export const RestartRequiredSettingEnvVar = StringUnion(
  "APP_HOME_URL",
  "GRIST_FORCE_LOGIN",
  "GRIST_GETGRISTCOM_SECRET",
  "GRIST_LOGIN_SYSTEM_TYPE",
  "GRIST_ORG_CREATION_ANYONE",
  "GRIST_PERSONAL_ORGS",
  "GRIST_SANDBOX_FLAVOR",
);
export type RestartRequiredSettingEnvVar = typeof RestartRequiredSettingEnvVar.values;

/**
 * The environment variable for a reloadable setting that may be persisted in the database.
 *
 * Reloadable settings are updated dynamically whenever their value in the database is modified,
 * and don't require a server process restart to go into effect.
 */
export const ReloadableSettingEnvVar = StringUnion(
  "GRIST_ADMIN_EMAIL",
  "GRIST_ANON_PLAYGROUND",
  "GRIST_BOOT_KEY",
  "GRIST_IN_SERVICE",
);
export type ReloadableSettingEnvVar = typeof ReloadableSettingEnvVar.type;

/**
 * Restart required settings: settings whose underlying values remain the same for the life of the
 * server process.
 *
 * Changes made to the database for all of the settings below are only reflected on server restart.
 */

/**
 * Returns the value of `APP_HOME_URL` from {@link appSettings}.
 *
 * NOTE: This value is memoized for the life of the server process; changes to the DB
 * are not reflected until server restart.
 */
export const getHomeUrl = memoize(() =>
  appSettings.flag("homeUrl").readString({
    envVar: "APP_HOME_URL",
  }),
);

/**
 * Returns the value of `GRIST_ANON_PLAYGROUND` from {@link appSettings}.
 *
 * NOTE: This value is memoized for the life of the server process; changes to the DB
 * are not reflected until server restart.
 */
export const getAnonPlaygroundEnabled = memoize(() =>
  appSettings.section("orgs").flag("enableAnonPlayground").readBool({
    envVar: "GRIST_ANON_PLAYGROUND",
    defaultValue: getCanAnyoneCreateOrgs(),
  }),
);

/** Returns where the `GRIST_ANON_PLAYGROUND` value came from ("env" or "db"), or undefined if using the default. */
export function getAnonPlaygroundEnabledSource(): AppSettingSource | undefined {
  getAnonPlaygroundEnabled(); // ensure the flag is read/initialized
  return appSettings.section("orgs").flag("enableAnonPlayground").describe().source;
}

/**
 * Returns the value of `GRIST_FORCE_LOGIN` from {@link appSettings}.
 *
 * NOTE: This value is memoized for the life of the server process; changes to the DB
 * are not reflected until server restart.
 */
export const getForceLogin = memoize(() =>
  appSettings.section("login").flag("forced").requireBool({
    envVar: "GRIST_FORCE_LOGIN",
    defaultValue: false,
  }),
);

/** Returns where the `GRIST_FORCE_LOGIN` value came from ("env" or "db"), or undefined if using the default. */
export function getForceLoginSource(): AppSettingSource | undefined {
  getForceLogin(); // ensure the flag is read/initialized
  return appSettings.section("login").flag("forced").describe().source;
}

/**
 * Returns the value of `GRIST_ONBOARDING_TUTORIAL_DOC_ID` from {@link appSettings}.
 *
 * NOTE: This value is memoized for the life of the server process; changes to the DB
 * are not reflected until server restart.
 */
export const getOnboardingTutorialDocId = memoize(() =>
  appSettings.section("tutorials").flag("onboardingTutorialDocId").readString({
    envVar: "GRIST_ONBOARDING_TUTORIAL_DOC_ID",
  }),
);

/**
 * Returns the value of `GRIST_ORG_CREATION_ANYONE` from {@link appSettings}.
 *
 * NOTE: This value is memoized for the life of the server process; changes to the DB
 * are not reflected until server restart.
 */
export const getCanAnyoneCreateOrgs = memoize(() =>
  appSettings.section("orgs").flag("canAnyoneCreateOrgs").readBool({
    envVar: "GRIST_ORG_CREATION_ANYONE",
    defaultValue: true,
  }),
);

/** Returns where the `GRIST_ORG_CREATION_ANYONE` value came from ("env" or "db"), or undefined if using the default. */
export function getCanAnyoneCreateOrgsSource(): AppSettingSource | undefined {
  getCanAnyoneCreateOrgs(); // ensure the flag is read/initialized
  return appSettings.section("orgs").flag("canAnyoneCreateOrgs").describe().source;
}

/**
 * Returns the value of `GRIST_PERSONAL_ORGS` from {@link appSettings}.
 *
 * NOTE: This value is memoized for the life of the server process; changes to the DB
 * are not reflected until server restart.
 */
export const getPersonalOrgsEnabled = memoize(() =>
  appSettings.section("orgs").flag("enablePersonalOrgs").readBool({
    envVar: "GRIST_PERSONAL_ORGS",
    defaultValue: getCanAnyoneCreateOrgs(),
  }),
);

/** Returns where the `GRIST_PERSONAL_ORGS` value came from ("env" or "db"), or undefined if using the default. */
export function getPersonalOrgsEnabledSource(): AppSettingSource | undefined {
  getPersonalOrgsEnabled(); // ensure the flag is read/initialized
  return appSettings.section("orgs").flag("enablePersonalOrgs").describe().source;
}

/**
 * Returns the value of `GRIST_SANDBOX_FLAVOR` from {@link appSettings}.
 *
 * NOTE: This value is memoized for the life of the server process; changes to the DB
 * are not reflected until server restart.
 */
export const getSandboxFlavor = memoize(readSandboxFlavor.bind(null, appSettings));

/**
 * Returns the value of `GRIST_SANDBOX_FLAVOR` from the provided `settings`.
 */
export function readSandboxFlavor(settings: AppSettings): string | undefined {
  return settings.section("sandbox").flag("flavor").readString({
    envVar: "GRIST_SANDBOX_FLAVOR",
  });
}

/**
 * Returns the source of `GRIST_SANDBOX_FLAVOR` from {@link appSettings}.
 *
 * NOTE: This value is memoized for the life of the server process; changes to the DB
 * are not reflected until server restart.
 */
export const getSandboxFlavorSource = memoize(readSandboxFlavorSource.bind(null, appSettings));

/**
 * Returns the source of `GRIST_SANDBOX_FLAVOR` from the provided `settings`.
 */
export function readSandboxFlavorSource(settings: AppSettings) {
  return settings.section("sandbox").flag("flavor").read({
    envVar: "GRIST_SANDBOX_FLAVOR",
  }).describe().source;
}

/**
 * Returns the value of `GRIST_TEMPLATE_ORG` from {@link appSettings}.
 *
 * Appends `GRIST_ID_PREFIX` to the returned value, if set.
 *
 * NOTE: This value is memoized for the life of the server process; changes to the DB
 * are not reflected until server restart.
 */
export const getTemplateOrg = memoize(() => {
  let org = appSettings.section("templates").flag("org").readString({
    envVar: "GRIST_TEMPLATE_ORG",
  });
  if (!org) { return null; }

  if (process.env.GRIST_ID_PREFIX) {
    org += `-${process.env.GRIST_ID_PREFIX}`;
  }
  return org;
});

/**
 * Returns the value of `GRIST_USER_PRESENCE_MAX_USERS` from {@link appSettings}.
 *
 * NOTE: This value is memoized for the life of the server process; changes to the DB
 * are not reflected until server restart.
 */
export const getUserPresenceMaxUsers = memoize(() =>
  appSettings.section("userPresence").flag("maxUsers").requireInt({
    envVar: "GRIST_USER_PRESENCE_MAX_USERS",
    defaultValue: 99,
    minValue: 0,
    maxValue: 99,
  }),
);

/**
 * Reloadable settings: settings whose underlying values update dynamically for the life of the
 * server process.
 *
 * Changes made to the database for all of the settings below are reflected immediately in the
 * server process.
 */

/**
 * Returns the value of `GRIST_ADMIN_EMAIL` from {@link appSettings}.
 */
export const getAdminEmail = memoize(() =>
  appSettings.section("access").flag("installAdminEmail").readString({
    envVar: "GRIST_ADMIN_EMAIL",
  }),
);

/**
 * Returns the value of `GRIST_BOOT_KEY` from {@link appSettings} with its source.
 */
export const getBootKey = memoize((): ValueWithSource<string | undefined> => {
  const setting = appSettings.section("boot").flag("key");
  const value = setting.readString({
    envVar: "GRIST_BOOT_KEY",
  });
  const { source } = setting.describe();
  return { value, source };
});

/**
 * Returns the value of `GRIST_IN_SERVICE` from {@link appSettings} with its source.
 *
 * When out of service, functionality is limited to administrative operations like
 * modifying installation settings.
 *
 * Used by `FlexServer.addSetupGate` to limit access to fresh installations until an operator
 * with access to server logs provides a boot key.
 */
export const getInService = memoize((): ValueWithSource<boolean> => {
  const setting = appSettings.flag("inService");
  const value = setting.requireBool({
    envVar: "GRIST_IN_SERVICE",
    defaultValue: true,
  });
  const { source } = setting.describe();
  return { value, source };
});

/**
 * The environment variable for a setting that may be persisted in the database.
 *
 * Union of the values of {@link RestartRequiredSettingEnvVar} and {@link ReloadableSettingEnvVar}.
 */
export const SettingEnvVar = StringUnion(
  ...RestartRequiredSettingEnvVar.values,
  ...ReloadableSettingEnvVar.values,
);
export type SettingEnvVar = typeof SettingEnvVar.type;

// Accessors for login system and getgrist.com auth secret are exported from loginSystemHelpers.ts.
// They are not memoized because they don't always read from the global appSettings instance.
type SettingKey = Exclude<SettingEnvVar, "GRIST_LOGIN_SYSTEM_TYPE" | "GRIST_GETGRISTCOM_SECRET">;

/**
 * Map of {@link ReloadableSettingEnvVar} to its memoized accessor function.
 */
const settingsByEnvVar: Record<SettingKey, MemoizedFunction> = {
  APP_HOME_URL: getHomeUrl,
  GRIST_ANON_PLAYGROUND: getAnonPlaygroundEnabled,
  GRIST_FORCE_LOGIN: getForceLogin,
  GRIST_ORG_CREATION_ANYONE: getCanAnyoneCreateOrgs,
  GRIST_PERSONAL_ORGS: getPersonalOrgsEnabled,
  GRIST_SANDBOX_FLAVOR: getSandboxFlavor,
  GRIST_ADMIN_EMAIL: getAdminEmail,
  GRIST_BOOT_KEY: getBootKey,
  GRIST_IN_SERVICE: getInService,
};

/**
 * Clears the memoized function caches for the accessor functions of the specified `envVars`
 * if they are for settings that are reloadable.
 */
export function invalidateReloadableSettings(...envVars: string[]) {
  for (const envVar of envVars) {
    if (!ReloadableSettingEnvVar.guard(envVar)) { continue; }

    settingsByEnvVar[envVar].cache.clear();
  }
}

export function invalidateAllReloadableSettings() {
  for (const envVar of ReloadableSettingEnvVar.values) {
    settingsByEnvVar[envVar].cache.clear();
  }
}
