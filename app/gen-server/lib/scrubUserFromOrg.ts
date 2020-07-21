import {EntityManager} from "typeorm";
import * as roles from 'app/common/roles';
import {Document} from "app/gen-server/entity/Document";
import {Group} from "app/gen-server/entity/Group";
import {Organization} from "app/gen-server/entity/Organization";
import {Workspace} from "app/gen-server/entity/Workspace";
import pick = require('lodash/pick');

/**
 *
 * Remove the given user from the given org and every resource inside the org.
 * If the user being removed is an owner of any resources in the org, the caller replaces
 * them as the owner. This is to prevent complete loss of access to any resource.
 *
 * This method transforms ownership without regard to permissions.  We all talked this
 * over and decided this is what we wanted, but there's no denying it is funky and could
 * be surprising.
 * TODO: revisit user scrubbing when we can.
 *
 */
export async function scrubUserFromOrg(
  orgId: number,
  removeUserId: number,
  callerUserId: number,
  manager: EntityManager
): Promise<void> {
  await addMissingGuestMemberships(callerUserId, orgId, manager);

  // This will be a list of all mentions of removeUser and callerUser in any resource
  // within the org.
  const mentions: Mention[] = [];

  // Base query for all group_users related to these two users and this org.
  const q = manager.createQueryBuilder()
    .select('group_users.group_id, group_users.user_id')
    .from('group_users', 'group_users')
    .leftJoin(Group, 'groups', 'group_users.group_id = groups.id')
    .addSelect('groups.name as name')
    .leftJoin('groups.aclRule', 'acl_rules')
    .where('(group_users.user_id = :removeUserId or group_users.user_id = :callerUserId)',
           {removeUserId, callerUserId})
    .andWhere('orgs.id = :orgId', {orgId});

  // Pick out group_users related specifically to the org resource, in 'mentions' format
  // (including resource id, a tag for the kind of resource, the group name, the user
  // id, and the group id).
  const orgs = q.clone()
    .addSelect(`'org' as kind, orgs.id`)
    .innerJoin(Organization, 'orgs', 'orgs.id = acl_rules.org_id');
  mentions.push(...await orgs.getRawMany());

  // Pick out mentions related to any workspace within the org.
  const wss = q.clone()
    .innerJoin(Workspace, 'workspaces', 'workspaces.id = acl_rules.workspace_id')
    .addSelect(`'ws' as kind, workspaces.id`)
    .innerJoin('workspaces.org', 'orgs');
  mentions.push(...await wss.getRawMany());

  // Pick out mentions related to any doc within the org.
  const docs = q.clone()
    .innerJoin(Document, 'docs', 'docs.id = acl_rules.doc_id')
    .addSelect(`'doc' as kind, docs.id`)
    .innerJoin('docs.workspace', 'workspaces')
    .innerJoin('workspaces.org', 'orgs');
  mentions.push(...await docs.getRawMany());

  // Prepare to add and delete group_users.
  const toDelete: Mention[] = [];
  const toAdd: Mention[] = [];

  // Now index the mentions by whether they are for the removeUser or the callerUser,
  // and the resource they apply to.
  const removeUserMentions = new Map<MentionKey, Mention>();
  const callerUserMentions = new Map<MentionKey, Mention>();
  for (const mention of mentions) {
    const isGuest = mention.name === roles.GUEST;
    if (mention.user_id === removeUserId) {
      // We can safely remove any guest roles for the removeUser without any
      // further inspection.
      if (isGuest) { toDelete.push(mention); continue; }
      removeUserMentions.set(getMentionKey(mention), mention);
    } else {
      if (isGuest) { continue; }
      callerUserMentions.set(getMentionKey(mention), mention);
    }
  }
  // Now iterate across the mentions of removeUser, and see what we need to do
  // for each of them.
  for (const [key, removeUserMention] of removeUserMentions) {
    toDelete.push(removeUserMention);
    if (removeUserMention.name !== roles.OWNER) {
      // Nothing fancy needed for cases where the removeUser is not the owner.
      // Just discard those.
      continue;
    }
    // The removeUser was a direct owner on this resource, but the callerUser was
    // not.  We set the callerUser as a direct owner on this resource, to preserve
    // access to it.
    // TODO: the callerUser might inherit sufficient access, in which case this
    // step is unnecessary and could be skipped.  I believe it does no harm though.
    const callerUserMention = callerUserMentions.get(key);
    if (callerUserMention && callerUserMention.name === roles.OWNER) { continue; }
    if (callerUserMention) { toDelete.push(callerUserMention); }
    toAdd.push({...removeUserMention, user_id: callerUserId});
  }
  if (toDelete.length > 0) {
    await manager.createQueryBuilder()
      .delete()
      .from('group_users')
      .whereInIds(toDelete.map(m => pick(m, ['user_id', 'group_id'])))
      .execute();
  }
  if (toAdd.length > 0) {
    await manager.createQueryBuilder()
      .insert()
      .into('group_users')
      .values(toAdd.map(m => pick(m, ['user_id', 'group_id'])))
      .execute();
  }

  // TODO: At this point, we've removed removeUserId from every mention in group_users.
  // The user may still be mentioned in billing_account_managers.  If the billing_account
  // is linked to just this single organization, perhaps it would make sense to remove
  // the user there, if the callerUser is themselves a billing account manager?

  await addMissingGuestMemberships(callerUserId, orgId, manager);
}

/**
 * Adds specified user to any guest groups for the resources of an org where the
 * user needs to be and is not already.
 */
export async function addMissingGuestMemberships(userId: number, orgId: number,
                                                 manager: EntityManager) {
  // For workspaces:
  // User should be in guest group if mentioned in a doc within that workspace.
  let groupUsers = await manager.createQueryBuilder()
    .select('workspace_groups.id as group_id, cast(:userId as int) as user_id')
    .setParameter('userId', userId)
    .from(Workspace, 'workspaces')
    .where('workspaces.org_id = :orgId', {orgId})
    .innerJoin('workspaces.docs', 'docs')
    .innerJoin('docs.aclRules', 'doc_acl_rules')
    .innerJoin('doc_acl_rules.group', 'doc_groups')
    .innerJoin('doc_groups.memberUsers', 'doc_group_users')
    .andWhere('doc_group_users.id = :userId', {userId})
    .leftJoin('workspaces.aclRules', 'workspace_acl_rules')
    .leftJoin('workspace_acl_rules.group', 'workspace_groups')
    .leftJoin('group_users', 'workspace_group_users',
              'workspace_group_users.group_id = workspace_groups.id and ' +
              'workspace_group_users.user_id = :userId')
    .andWhere('workspace_groups.name = :guestName', {guestName: roles.GUEST})
    .groupBy('workspaces.id, workspace_groups.id, workspace_group_users.user_id')
    .having('workspace_group_users.user_id is null')
    .getRawMany();
  if (groupUsers.length > 0) {
    await manager.createQueryBuilder()
      .insert()
      .into('group_users')
      .values(groupUsers)
      .execute();
  }

  // For org:
  // User should be in guest group if mentioned in a workspace within that org.
  groupUsers = await manager.createQueryBuilder()
    .select('org_groups.id as group_id, cast(:userId as int) as user_id')
    .setParameter('userId', userId)
    .from(Organization, 'orgs')
    .where('orgs.id = :orgId', {orgId})
    .innerJoin('orgs.workspaces', 'workspaces')
    .innerJoin('workspaces.aclRules', 'workspaces_acl_rules')
    .innerJoin('workspaces_acl_rules.group', 'workspace_groups')
    .innerJoin('workspace_groups.memberUsers', 'workspace_group_users')
    .andWhere('workspace_group_users.id = :userId', {userId})
    .leftJoin('orgs.aclRules', 'org_acl_rules')
    .leftJoin('org_acl_rules.group', 'org_groups')
    .leftJoin('group_users', 'org_group_users',
              'org_group_users.group_id = org_groups.id and ' +
              'org_group_users.user_id = :userId')
    .andWhere('org_groups.name = :guestName', {guestName: roles.GUEST})
    .groupBy('org_groups.id, org_group_users.user_id')
    .having('org_group_users.user_id is null')
    .getRawMany();
  if (groupUsers.length > 0) {
    await manager.createQueryBuilder()
      .insert()
      .into('group_users')
      .values(groupUsers)
      .execute();
  }

  // For doc:
  // Guest groups are not used.
}

interface Mention {
  id: string|number;       // id of resource
  kind: 'org'|'ws'|'doc';  // type of resource
  user_id: number;         // id of user in group
  group_id: number;        // id of group
  name: string;            // name of group
}

type MentionKey = string;

function getMentionKey(mention: Mention): MentionKey {
  return `${mention.kind} ${mention.id}`;
}
