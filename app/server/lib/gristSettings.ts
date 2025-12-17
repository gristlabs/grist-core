import {AppSettings, appSettings} from 'app/server/lib/AppSettings';

/**
 * Get the selected login system type from app settings.
 * This checks the GRIST_LOGIN_SYSTEM_TYPE environment variable.
 * Returns undefined if not explicitly set.
 */
export function getSelectedLoginSystemType(settings: AppSettings): string | undefined {
  return settings.section('login').section('system').flag('type').readString({
    envVar: 'GRIST_LOGIN_SYSTEM_TYPE',
  });
}

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

export function getUserPresenceMaxUsers(): number {
  return appSettings.section('userPresence').flag('maxUsers').requireInt({
    envVar: 'GRIST_USER_PRESENCE_MAX_USERS',
    defaultValue: 99,
    minValue: 0,
    maxValue: 99,
  });
}

export function getOnboardingTutorialDocId() {
  return appSettings.section('tutorials').flag('onboardingTutorialDocId').readString({
    envVar: 'GRIST_ONBOARDING_TUTORIAL_DOC_ID',
  });
}
