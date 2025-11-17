export interface ICommonUrls {
  // Link to the help center.
  help: string;

  // Various links to support pages:
  helpAccessRules: string;
  helpAssistant: string;
  helpAssistantDataUse: string;
  helpFormulaAssistantDataUse: string;
  helpColRefs: string;
  helpConditionalFormatting: string;
  helpFilterButtons: string;
  helpLinkingWidgets: string;
  helpRawData: string;
  helpSuggestions: string;
  helpUnderstandingReferenceColumns: string;
  helpTriggerFormulas: string;
  helpTryingOutChanges: string;
  helpWidgets: string;
  helpCustomWidgets: string;
  helpInstallAuditLogs: string;
  helpTeamAuditLogs: string;
  helpTelemetryLimited: string;
  helpEnterpriseOptIn: string;
  helpCalendarWidget: string;
  helpLinkKeys: string;
  helpFilteringReferenceChoices: string;
  helpSandboxing: string;
  helpSharing: string;
  helpStateStore: string;
  helpAPI: string;
  helpSummaryFormulas: string;
  helpAdminControls: string;
  helpFiddleMode: string;
  helpFormUrlValues: string;

  freeCoachingCall: string; // Link to the human help (example: email adress or meeting scheduling tool)
  contactSupport: string; // Link to contact support on error pages (example: email adress or online form).
  termsOfService: string | undefined; // Link to the terms of service (if set, adds a button to the bottom-left corner).
  onboardingTutorialVideoId: string; // URL to the Youtube video to onboard users.
  plans: string; // Link to the plans.
  contact: string; // Link to the contact page.
  templates: string; // Link to the templates store.
  webinars: string; // Link to the webinars
  community: string; // Link to the forum.
  functions: string; // Support doc for the functions.
  formulaSheet: string; // URL to the formula cheat sheet.
  formulas: string; // Support doc for formulas.
  forms: string; // Footer link to show how to create own's form.

  // URL of the preview image when sharing the link on websites like social medias or chat applications.
  openGraphPreviewImage: string;

  gristLabsCustomWidgets: string; // Repo of the Grist Labs custom widget
  gristLabsWidgetRepository: string; // Url pointing to a widget manifest
  githubGristCore: string; // Link to the grist-core project repository on Github.
  githubSponsorGristLabs: string; // Link to the Grist Labs sponsor page.

  versionCheck: string; // API to check the instance has the latest version and otherwise show a banner.
  attachmentStorage: string; // Support doc for attachment storage.
}
