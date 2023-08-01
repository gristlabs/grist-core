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
