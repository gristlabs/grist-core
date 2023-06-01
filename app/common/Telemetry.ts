export const TelemetryTemplateSignupCookieName = 'gr_template_signup_trk';

export const TelemetryEventNames = [
  'apiUsage',
  'beaconOpen',
  'beaconArticleViewed',
  'beaconEmailSent',
  'beaconSearch',
  'documentForked',
  'documentOpened',
  'documentUsage',
  'processMonitor',
  'sendingWebhooks',
  'signupVerified',
  'siteMembership',
  'siteUsage',
  'tutorialProgressChanged',
  'tutorialRestarted',
  'watchedVideoTour',
] as const;

export type TelemetryEventName = typeof TelemetryEventNames[number];
