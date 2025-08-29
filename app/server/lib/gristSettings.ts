import {appSettings} from 'app/server/lib/AppSettings';

export function getTemplateOrg() {
  let org = appSettings.section('templates').flag('org').readString({
    envVar: 'GRIST_TEMPLATE_ORG',
  });
  if (!org) { return null; }

  if (process.env.GRIST_ID_PREFIX) {
    org += `-${process.env.GRIST_ID_PREFIX}`;
  }
  return org;
}

const userPresenceMaxUsersDefaultValue = 99;
export function getUserPresenceMaxUsers(): number {
  return appSettings.section('userPresence').flag('maxUsers').readInt({
    envVar: 'GRIST_USER_PRESENCE_MAX_USERS',
    defaultValue: userPresenceMaxUsersDefaultValue,
    minValue: 0,
    maxValue: 99,
  }) ?? userPresenceMaxUsersDefaultValue;
}

export function getOnboardingTutorialDocId() {
  return appSettings.section('tutorials').flag('onboardingTutorialDocId').readString({
    envVar: 'GRIST_ONBOARDING_TUTORIAL_DOC_ID',
  });
}
