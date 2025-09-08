import { ICommonUrls } from "app/common/ICommonUrls";

import * as t from "ts-interface-checker";

import ICommonUrlsTI from 'app/common/ICommonUrls-ti';

const { ICommonUrls: ICommonUrlsChecker } = t.createCheckers(ICommonUrlsTI);

function withAdminDefinedUrls(defaultUrls: ICommonUrls): ICommonUrls {
  const adminDefinedUrlsStr = process.env.GRIST_CUSTOM_COMMON_URLS;
  if (!adminDefinedUrlsStr) {
    return defaultUrls;
  }

  let adminDefinedUrls;
  try {
    adminDefinedUrls = JSON.parse(adminDefinedUrlsStr);
  } catch(e) {
    throw new Error("The JSON passed to GRIST_CUSTOM_COMMON_URLS is malformed");
  }

  const merged = {
    ...defaultUrls,
    ...(adminDefinedUrls)
  };
  ICommonUrlsChecker.strictCheck(merged);
  return merged;
}

export const getCommonUrls = () => withAdminDefinedUrls({
  help: process.env.GRIST_HELP_CENTER || 'https://support.getgrist.com',
  helpAccessRules: "https://support.getgrist.com/access-rules",
  helpAssistant: "https://support.getgrist.com/assistant",
  helpAssistantDataUse: "https://support.getgrist.com/assistant/#data-use-policy",
  helpFormulaAssistantDataUse: "https://support.getgrist.com/ai-assistant/#data-use-policy",
  helpColRefs: "https://support.getgrist.com/col-refs",
  helpConditionalFormatting: "https://support.getgrist.com/conditional-formatting",
  helpFilterButtons: "https://support.getgrist.com/search-sort-filter/#filter-buttons",
  helpLinkingWidgets: "https://support.getgrist.com/linking-widgets",
  helpRawData: "https://support.getgrist.com/raw-data",
  helpUnderstandingReferenceColumns: "https://support.getgrist.com/col-refs/#understanding-reference-columns",
  helpTriggerFormulas: "https://support.getgrist.com/formulas/#trigger-formulas",
  helpTryingOutChanges: "https://support.getgrist.com/copying-docs/#trying-out-changes",
  helpCustomWidgets: "https://support.getgrist.com/widget-custom",
  helpInstallAuditLogs: "https://support.getgrist.com/install/audit-logs",
  helpTeamAuditLogs: "https://support.getgrist.com/teams/audit-logs",
  helpTelemetryLimited: "https://support.getgrist.com/telemetry-limited",
  helpEnterpriseOptIn: "https://support.getgrist.com/self-managed/#how-do-i-activate-grist-enterprise",
  helpCalendarWidget: "https://support.getgrist.com/widget-calendar",
  helpLinkKeys: "https://support.getgrist.com/examples/2021-04-link-keys",
  helpFilteringReferenceChoices: "https://support.getgrist.com/col-refs/#filtering-reference-choices-in-dropdown",
  helpSandboxing: "https://support.getgrist.com/self-managed/#how-do-i-sandbox-documents",
  helpAPI: 'https://support.getgrist.com/api',
  helpSummaryFormulas: 'https://support.getgrist.com/summary-tables/#summary-formulas',
  helpAdminControls: "https://support.getgrist.com/admin-controls",
  helpFiddleMode: 'https://support.getgrist.com/glossary/#fiddle-mode',
  helpSharing: 'https://support.getgrist.com/sharing',
  helpComments: 'https://support.getgrist.com/sharing/#comments',
  freeCoachingCall: process.env.FREE_COACHING_CALL_URL || 'https://calendly.com/grist-team/grist-free-coaching-call',
  contactSupport: process.env.GRIST_CONTACT_SUPPORT_URL || 'https://www.getgrist.com/contact',
  termsOfService: process.env.GRIST_TERMS_OF_SERVICE_URL || undefined,
  onboardingTutorialVideoId: process.env.GRIST_ONBOARDING_VIDEO_ID || '56AieR9rpww',
  plans: "https://www.getgrist.com/pricing",
  contact: "https://www.getgrist.com/contact",
  templates: 'https://www.getgrist.com/templates',
  webinars: process.env.GRIST_WEBINARS_URL || 'https://www.getgrist.com/webinars',
  community: 'https://community.getgrist.com',
  functions: 'https://support.getgrist.com/functions',
  formulaSheet: 'https://support.getgrist.com/formula-cheat-sheet',
  formulas: 'https://support.getgrist.com/formulas',
  forms: 'https://www.getgrist.com/forms/?utm_source=grist-forms&utm_medium=grist-forms&utm_campaign=forms-footer',
  openGraphPreviewImage: 'https://grist-static.com/icons/opengraph-preview-image.png',
  gristLabsCustomWidgets: 'https://gristlabs.github.io/grist-widget/',
  gristLabsWidgetRepository: 'https://github.com/gristlabs/grist-widget/releases/download/latest/manifest.json',
  githubGristCore: 'https://github.com/gristlabs/grist-core',
  githubSponsorGristLabs: 'https://github.com/sponsors/gristlabs',
  versionCheck: 'https://api.getgrist.com/api/version',
  attachmentStorage: 'https://support.getgrist.com/document-settings/#external-attachments',
});

export const commonUrls = getCommonUrls();
