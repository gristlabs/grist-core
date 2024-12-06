import { normalizeEmail } from "app/common/emails";
import { UserProfile } from "app/common/LoginSessionAPI";
import { User } from "app/gen-server/entity/User.js";
import SCIMMY from "scimmy";
import log from 'app/server/lib/log';

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
