import { normalizeEmail } from "app/common/emails";
import { UserProfile } from "app/common/LoginSessionAPI";
import { AclRuleDoc, AclRuleOrg, AclRuleWs } from "app/gen-server/entity/AclRule";
import { Group } from "app/gen-server/entity/Group";
import { User } from "app/gen-server/entity/User";
import { GroupWithMembersDescriptor } from "app/gen-server/lib/homedb/Interfaces";
import log from "app/server/lib/log";
import { SCIMMYRoleSchema } from "app/server/lib/scim/v2/roles/SCIMMYRoleSchema";

import SCIMMY from "scimmy";

const SCIM_API_BASE_PATH = "/api/scim/v2";
const SCIMMY_USER_TYPE = "User";
const SCIMMY_GROUP_TYPE = "Group";
const SCIMMY_ROLE_TYPE = "Role";

/**
 * Converts a user from your database to a SCIMMY user
 */
export function toSCIMMYUser(user: User): SCIMMY.Schemas.User {
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
      primary: true,
    }] : undefined,
    emails: [{
      value: user.logins[0].displayEmail,
      primary: true,
    }],
  });
}

export function toUserProfile(scimUser: SCIMMY.Schemas.User): UserProfile {
  const emailValue = scimUser.emails?.[0]?.value;
  if (emailValue && normalizeEmail(emailValue) !== normalizeEmail(scimUser.userName)) {
    log.warn(`userName "${scimUser.userName}" differ from passed primary email "${emailValue}".` +
      "That should be OK, but be aware that the userName will be ignored in favor of the email to identify the user.");
  }
  return {
    name: scimUser.displayName ?? "", // The empty string will be transformed to a named deduced from the
    // email by the HomeDBManager
    picture: scimUser.photos?.[0]?.value,
    locale: scimUser.locale,
    email: emailValue ?? scimUser.userName,
  };
}

function toSCIMMYMembers(group: Group): SCIMMY.Schemas.Group["members"] {
  return [
    ...group.memberUsers.map((member: User) => ({
      value: String(member.id),
      display: member.name,
      $ref: `${SCIM_API_BASE_PATH}/Users/${member.id}`,
      type: SCIMMY_USER_TYPE,
    })),
    ...group.memberGroups
      .filter((member: Group) => member.type === Group.TEAM_TYPE)
      .map((member: Group) => ({
        value: String(member.id),
        display: member.name,
        $ref: `${SCIM_API_BASE_PATH}/Groups/${member.id}`,
        type: SCIMMY_GROUP_TYPE,
      })),
    ...group.memberGroups
      .filter((member: Group) => member.type === Group.ROLE_TYPE)
      .map((member: Group) => ({
        value: String(member.id),
        display: member.name,
        $ref: `${SCIM_API_BASE_PATH}/Roles/${member.id}`,
        type: SCIMMY_ROLE_TYPE,
      })),
  ];
}

export function toSCIMMYGroup(group: Group): SCIMMY.Schemas.Group {
  return new SCIMMY.Schemas.Group({
    id: String(group.id),
    displayName: group.name,
    members: toSCIMMYMembers(group),
  });
}

export function toSCIMMYRole(role: Group): SCIMMYRoleSchema {
  const { aclRule } = role;
  return new SCIMMYRoleSchema({
    id: String(role.id),
    displayName: role.name,
    docId: aclRule instanceof AclRuleDoc ? aclRule.docId : undefined,
    workspaceId: aclRule instanceof AclRuleWs ? aclRule.workspaceId : undefined,
    orgId: aclRule instanceof AclRuleOrg ? aclRule.orgId : undefined,
    members: toSCIMMYMembers(role),
  });
}

function parseId(id: string, type: typeof SCIMMY_USER_TYPE | typeof SCIMMY_GROUP_TYPE): number {
  const parsedId = parseInt(id, 10);
  if (Number.isNaN(parsedId)) {
    throw new SCIMMY.Types.Error(400, "invalidValue", `Invalid ${type} member ID: ${id}`);
  }
  return parsedId;
}

function membersDescriptors(
  members: NonNullable<SCIMMY.Schemas.Group["members"]>,
): Pick<GroupWithMembersDescriptor, "memberUsers" | "memberGroups"> {
  return {
    memberUsers: members
      .filter(member => member.type === SCIMMY_USER_TYPE)
      .map(member => parseId(member.value, SCIMMY_USER_TYPE)),
    memberGroups: members
      .filter(member => member.type === SCIMMY_GROUP_TYPE)
      .map(member => parseId(member.value, SCIMMY_GROUP_TYPE)),
  };
}

export function toGroupDescriptor(scimGroup: SCIMMY.Schemas.Group): GroupWithMembersDescriptor {
  const members = scimGroup.members ?? [];
  return {
    name: scimGroup.displayName,
    type: Group.TEAM_TYPE,
    ...membersDescriptors(members),
  };
}

export function toRoleDescriptor(scimRole: SCIMMYRoleSchema): GroupWithMembersDescriptor {
  const members = scimRole.members ?? [];
  return {
    name: scimRole.displayName,
    type: Group.ROLE_TYPE,
    ...membersDescriptors(members),
  };
}
