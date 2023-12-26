/**
 *
 * Grist notifications are currently half-baked.
 * There is a sendgrid based implementation for Grist Lab's SaaS, but
 * nothing self-hostable yet.
 *
 */

import {FullUser} from 'app/common/LoginSessionAPI';
import {StringUnion} from 'app/common/StringUnion';

/**
 * Structure of sendgrid email requests.  Each request references a template
 * (stored on sendgrid site) and a list of people to send a copy of that template
 * to, along with the relevant values to use for template variables.
 */
export interface SendGridMail {
  personalizations: SendGridPersonalization[];
  from: SendGridAddress;
  reply_to: SendGridAddress;
  template_id: string;
  asm?: {  // unsubscribe settings
    group_id: number;
  };
  mail_settings?: {
    bypass_list_management?: {
      enable: boolean;
    }
  };
}

export interface SendGridContact {
  contacts: [{
    email: string;
    first_name: string;
    last_name: string;
    custom_fields?: Record<string, any>;
  }],
  list_ids?: string[];
}

export interface SendGridAddress {
  email: string;
  name: string;
}

export interface SendGridPersonalization {
  to: SendGridAddress[];
  dynamic_template_data: {[key: string]: any};
}

/**
 * Structure of sendgrid invite template.  This is entirely under our control, it
 * is the information we choose to send to an email template for invites.
 */

export interface SendGridInviteTemplate {
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

export type SendGridInviteResourceKind = 'team site' | 'workspace' | 'document';

export interface SendGridInviteAccess {
  role: string;
  canEditAccess?: boolean;
  canEdit?: boolean;
  canView?: boolean;
  canManageBilling?: boolean;
}

// Common parameters included in emails to active billing managers.
export interface SendGridBillingTemplate {
  org: {id: number, name: string};
  orgUrl: string;
  billingUrl: string;
}

export interface SendGridMemberChangeTemplate extends SendGridBillingTemplate {
  initiatingUser: FullUser;
  added: FullUser[];
  removed: FullUser[];
  org: {id: number, name: string};
  countBefore: number;
  countAfter: number;
  orgUrl: string;
  billingUrl: string;
  paidPlan: boolean;
}

/**
 * Format of sendgrid responses when looking up a user by email address using
 * SENDGRID.search
 */
export interface SendGridSearchResult {
  contact_count: number;
  result: SendGridSearchHit[];
}

export interface SendGridSearchHit {
  id: string;
  email: string;
  list_ids: string[];
}

/**
 * Alternative format of sendgrid responses when looking up a user by email
 * address using SENDGRID.searchByEmail
 *   https://docs.sendgrid.com/api-reference/contacts/get-contacts-by-emails
 */
export interface SendGridSearchResultVariant {
  result: Record<string, SendGridSearchPossibleHit>;
}

/**
 * Documentation is contradictory on format of results when contacts not found, but if
 * something is found there should be a contact field.
 */
export interface SendGridSearchPossibleHit {
  contact?: SendGridSearchHit;
}

export interface SendGridConfig {
  address: {
    from: {
      email: string;
      name: string;
    }
  },
  template: {
    invite?: string;
    billingManagerInvite?: string;
    memberChange?: string;
    trialPeriodEndingSoon?: string;
    twoFactorMethodAdded?: string;
    twoFactorMethodRemoved?: string;
    twoFactorPhoneNumberChanged?: string;
    twoFactorEnabled?: string;
    twoFactorDisabled?: string;
  },
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
  'twoFactorMethodAdded',
  'twoFactorMethodRemoved',
  'twoFactorPhoneNumberChanged',
  'twoFactorEnabled',
  'twoFactorDisabled',
);

export type TwoFactorEvent = typeof TwoFactorEvents.type;
