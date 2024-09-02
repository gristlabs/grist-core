import { User } from "app/gen-server/entity/User.js";
import { SCIMMY } from "scimmy-routers";

/**
 * Converts a user from your database to a SCIMMY user
 */
export function toSCIMMYUser(user: User) {
  if (!user.logins) {
    throw new Error("User must have at least one login");
  }
  const preferredLanguage = user.options?.locale ?? "en";
  return new SCIMMY.Schemas.User({
    id: String(user.id),
    userName: user.loginEmail,
    displayName: user.name,
    name: {
      formatted: user.name,
    },
    preferredLanguage,
    locale: preferredLanguage, // Assume locale is the same as preferredLanguage
    photos: user.picture ? [{
      value: user.picture,
      type: "photo",
      primary: true
    }] : undefined,
    emails: [{
      value: user.loginEmail,
      primary: true,
    }],
  });
}
