import { appSettings } from "app/server/lib/AppSettings";

export function getTemplateOrg() {
  let org = appSettings.section("templates").flag("org").readString({
    envVar: "GRIST_TEMPLATE_ORG",
  });
  if (!org) { return null; }

  if (process.env.GRIST_ID_PREFIX) {
    org += `-${process.env.GRIST_ID_PREFIX}`;
  }
  return org;
}

export function getUserPresenceMaxUsers(): number {
  return appSettings.section("userPresence").flag("maxUsers").requireInt({
    envVar: "GRIST_USER_PRESENCE_MAX_USERS",
    defaultValue: 99,
    minValue: 0,
    maxValue: 99,
  });
}

export function getOnboardingTutorialDocId() {
  return appSettings.section("tutorials").flag("onboardingTutorialDocId").readString({
    envVar: "GRIST_ONBOARDING_TUTORIAL_DOC_ID",
  });
}

export function getCanAnyoneCreateOrgs() {
  return appSettings.section("orgs").flag("canAnyoneCreateOrgs").readBool({
    envVar: "GRIST_ORG_CREATION_ANYONE",
    defaultValue: true,
  });
}

export function getPersonalOrgsEnabled() {
  return appSettings.section("orgs").flag("enablePersonalOrgs").readBool({
    envVar: "GRIST_PERSONAL_ORGS",
    defaultValue: true,
  });
}
