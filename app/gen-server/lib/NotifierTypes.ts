/**
 *
 * Grist email notifications are currently emitted using SendGrid.
 * The types here are compatible with SendGrid, but no longer tied
 * to it.
 *
 * TODO: change "SendGrid" name to something more neutral (not
 * done yet only to not introduce a ton of noise hiding real changes).
 *
 */

import { FullUser } from "app/common/LoginSessionAPI";
import { StringUnion } from "app/common/StringUnion";
import { INotifier } from "app/server/lib/INotifier";

/**
 * Structure of email requests. Each request contains a list of
 * people to send an email to. The "personalizations"
 * field (this is SendGrid terminology) contains variables which,
 * when combined with an email template, give a complete message.
 * The email template is not included, but can be looked up using
 * a "type" code.
 *
 * There is some cruft related to unsubscription. This is
 * pure SendGrid stuff, only relevant when used with SendGrid
 * for the Grist Labs SaaS.
 */
export interface SendGridMail {
  personalizations: SendGridPersonalization[];
  from: SendGridAddress;
  reply_to: SendGridAddress;
  asm?: {  // unsubscribe settings
    group_id: number;
  };
  mail_settings?: {
    bypass_list_management?: {
      enable: boolean;
    }
  };
}

export interface SendGridAddress {
  email: string;
  name: string;
}
export interface DynamicTemplateData {
  [key: string]: any
}
export interface SendGridPersonalization {
  to: SendGridAddress[];
  dynamic_template_data: DynamicTemplateData;
}

/**
 * Structure of sendgrid invite template.  This is entirely under our control, it
 * is the information we choose to send to an email template for invites.
 */
export interface SendGridInviteTemplate {
  type: "invite" | "billingManagerInvite";
  user: FullUser;
  host: FullUser;
  resource: SendGridInviteResource;
  access: SendGridInviteAccess;
}

export interface SendGridInviteResource {
  kind: SendGridInviteResourceKind;
  kindUpperFirst: string;
  name: string;
  url: string;
}

export type SendGridInviteResourceKind = "team site" | "workspace" | "document";

export interface SendGridInviteAccess {
  role: string;
  canEditAccess?: boolean;
  canEdit?: boolean;
  canView?: boolean;
  canManageBilling?: boolean;
}

// Common parameters included in emails to active billing managers.
export interface SendGridBillingTemplate {
  type: "billing" | "memberChange",
  org: { id: number, name: string };
  orgUrl: string;
  billingUrl: string;
}

export interface SendGridMemberChangeTemplate extends SendGridBillingTemplate {
  type: "memberChange";
  initiatingUser: FullUser;
  added: FullUser[];
  removed: FullUser[];
  org: { id: number, name: string };
  countBefore: number;
  countAfter: number;
  orgUrl: string;
  billingUrl: string;
  paidPlan: boolean;
}

export interface SendGridConfig {
  address: {
    from: SendGridAddress;
    docNotificationsFrom: SendGridAddress;
    docNotificationsReplyTo: SendGridAddress;
  };
  template: { [templateName in TemplateName]?: string },
  list: {
    singleUserOnboarding?: string;
    appSumoSignUps?: string;
    trial?: string;
  },
  unsubscribeGroup: {
    invites?: number;
    billingManagers?: number;
  },
  field?: {
    callScheduled?: string;
    userRef?: string;
  },
}

export const TwoFactorEvents = StringUnion(
  "twoFactorMethodAdded",
  "twoFactorMethodRemoved",
  "twoFactorPhoneNumberChanged",
  "twoFactorEnabled",
  "twoFactorDisabled",
);

export type TwoFactorEvent = typeof TwoFactorEvents.type;

export const DocNotificationEvents = StringUnion(
  "docChanges",
  "comments",
  "suggestions",
);
export type DocNotificationEvent = typeof DocNotificationEvents.type;

export interface DocNotificationTemplateBase {
  // senderAuthorName may be set when there is a single author, to use in the email's "From" field.
  senderAuthorName: string | null;
}

export const TemplateName = StringUnion(
  "billingManagerInvite",
  "invite",
  "memberChange",
  "trialPeriodEndingSoon",
  ...TwoFactorEvents.values,
  ...DocNotificationEvents.values,
);
export type TemplateName = typeof TemplateName.type;

export interface SendGridMailWithTemplateId extends SendGridMail {
  template_id: string;
}

export type NotifierEventName = keyof INotifier;
