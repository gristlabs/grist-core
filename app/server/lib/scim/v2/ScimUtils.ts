import { normalizeEmail } from "app/common/emails";
import { UserProfile } from "app/common/LoginSessionAPI";
import { User } from "app/gen-server/entity/User";
import { Group } from "app/gen-server/entity/Group";
import SCIMMY from "scimmy";
import log from 'app/server/lib/log';

const SCIM_API_BASE_PATH = '/api/scim/v2';

/**
 * Converts a user from your database to a SCIMMY user
 */
export function toSCIMMYUser(user: User) {
  if (!user.logins) {
    throw new Error("User must have at least one login");
  }
  const locale = user.options?.locale ?? "en";
  return new SCIMMY.Schemas.User({
    id: String(user.id),
    userName: user.loginEmail,
    displayName: user.name,
    name: {
      formatted: user.name,
    },
    locale,
    preferredLanguage: locale, // Assume preferredLanguage is the same as locale
    photos: user.picture ? [{
      value: user.picture,
      type: "photo",
      primary: true
    }] : undefined,
    emails: [{
      value: user.logins[0].displayEmail,
      primary: true,
    }],
  });
}

export function toUserProfile(scimUser: any, existingUser?: User): UserProfile {
  const emailValue = scimUser.emails?.[0]?.value;
  if (emailValue && normalizeEmail(emailValue) !== normalizeEmail(scimUser.userName)) {
    log.warn(`userName "${scimUser.userName}" differ from passed primary email "${emailValue}".` +
      'That should be OK, but be aware that the userName will be ignored in favor of the email to identify the user.');
  }
  return {
    name: scimUser.displayName ?? existingUser?.name,
    picture: scimUser.photos?.[0]?.value,
    locale: scimUser.locale,
    email: emailValue ?? scimUser.userName ?? existingUser?.loginEmail,
  };
}

export function toSCIMMYGroup(group: Group) {
  return new SCIMMY.Schemas.Group({
    id: String(group.id),
    displayName: group.name,
    members: [
      ...group.memberUsers.map((member: any) => ({
        value: String(member.id),
        display: member.name,
        $ref: `${SCIM_API_BASE_PATH}/Users/${member.id}`,
        type: 'User',
      })),
      // As of 2025-01-12, we don't support nested groups, so it should always be empty
      ...group.memberGroups.map((member: any) => ({
        value: String(member.id),
        display: member.name,
        $ref: `${SCIM_API_BASE_PATH}/Groups/${member.id}`,
        type: 'Group',
      })),
    ],
  });
}
