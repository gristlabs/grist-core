export interface SnapshotWindow {
  count: number;
  unit: 'days' | 'month' | 'year';
}

// Information about the product associated with an org or orgs.
export interface Product {
  name: string;
  features: Features;
}


// A product is essentially a list of flags and limits that we may enforce/support.
export interface Features {
  vanityDomain?: boolean;   // are user-selected domains allowed (unenforced) (default: true)

  workspaces?: boolean;     // are workspaces shown in web interface (default: true)
                            // (this was intended as something we can turn off to shut down
                            // web access to content while leaving access to billing)

  /**
   * Some optional limits.  Since orgs can change plans, limits will typically be checked
   * at the point of creation.  E.g. adding someone new to a document, or creating a
   * new document.  If, after an operation, the limit would be exceeded, that operation
   * is denied.  That means it is possible to exceed limits if the limits were not in
   * place when shares/docs were originally being added.  The action that would need
   * to be taken when infringement is pre-existing is not so obvious.
   */

  maxSharesPerDoc?: number; // Maximum number of users that can be granted access to a
                            // particular doc.  Doesn't count users granted access at
                            // workspace or organization level.  Doesn't count billable
                            // users if applicable (default: unlimited)

  maxSharesPerDocPerRole?: {[role: string]: number};  // As maxSharesPerDoc, but
                            // for specific roles.  Roles are named as in app/common/roles.
                            // Applied independently to maxSharesPerDoc.
                            // (default: unlimited)
  maxSharesPerWorkspace?: number;  // Maximum number of users that can be granted access to
                            // a particular workspace.  Doesn't count users granted access
                            // at organizational level, or billable users (default: unlimited)

  maxDocsPerOrg?: number;   // Maximum number of documents allowed per org.
                            // (default: unlimited)
  maxWorkspacesPerOrg?: number;   // Maximum number of workspaces allowed per org.
                            // (default: unlimited)

  readOnlyDocs?: boolean;   // if set, docs can only be read, not written.

  snapshotWindow?: SnapshotWindow;  // if set, controls how far back snapshots are kept.

  baseMaxRowsPerDocument?: number;  // If set, establishes a default maximum on the
                                 // number of rows (total) in a single document.
                                 // Actual max for a document may be higher.
  baseMaxApiUnitsPerDocumentPerDay?: number;  // Similar for api calls.
  baseMaxDataSizePerDocument?: number;  // Similar maximum for number of bytes of 'normal' data in a document
  baseMaxAttachmentsBytesPerDocument?: number;  // Similar maximum for total number of bytes used
                                                // for attached files in a document

  gracePeriodDays?: number;  // Duration of the grace period in days, before entering delete-only mode

  baseMaxAssistantCalls?: number; // Maximum number of AI assistant calls. Defaults to 0 if not set, use -1 to indicate
                                  // unbound limit. This is total limit, not per month or per day, it is used as a seed
                                  // value for the limits table. To create a per-month limit, there must be a separate
                                  // task that resets the usage in the limits table.
}

// Check whether it is possible to add members at the org level.  There's no flag
// for this right now, it isn't enforced at the API level, it is just a bluff.
// For now, when maxWorkspacesPerOrg is 1, we should assume members can't be added
// to org (even though this is not enforced).
export function canAddOrgMembers(features: Features): boolean {
  return features.maxWorkspacesPerOrg !== 1;
}


export const PERSONAL_LEGACY_PLAN = 'starter';
export const PERSONAL_FREE_PLAN = 'personalFree';
export const TEAM_FREE_PLAN = 'teamFree';
export const TEAM_PLAN = 'team';

export const displayPlanName: { [key: string]: string } = {
  [PERSONAL_LEGACY_PLAN]: 'Free Personal (Legacy)',
  [PERSONAL_FREE_PLAN]: 'Free Personal',
  [TEAM_FREE_PLAN]: 'Team Free',
  [TEAM_PLAN]: 'Pro'
} as const;

// Returns true if `planName` is for a personal product.
export function isPersonalPlan(planName: string): boolean {
  return isFreePersonalPlan(planName);
}

// Returns true if `planName` is for a free personal product.
export function isFreePersonalPlan(planName: string): boolean {
  return [PERSONAL_LEGACY_PLAN, PERSONAL_FREE_PLAN].includes(planName);
}

// Returns true if `planName` is for a legacy product.
export function isLegacyPlan(planName: string): boolean {
  return isFreeLegacyPlan(planName);
}

// Returns true if `planName` is for a free legacy product.
export function isFreeLegacyPlan(planName: string): boolean {
  return [PERSONAL_LEGACY_PLAN].includes(planName);
}

// Returns true if `planName` is for a team product.
export function isTeamPlan(planName: string): boolean {
  return !isPersonalPlan(planName);
}

// Returns true if `planName` is for a free team product.
export function isFreeTeamPlan(planName: string): boolean {
  return [TEAM_FREE_PLAN].includes(planName);
}

// Returns true if `planName` is for a free product.
export function isFreePlan(planName: string): boolean {
  return (
    isFreePersonalPlan(planName) ||
    isFreeTeamPlan(planName) ||
    isFreeLegacyPlan(planName) ||
    planName === 'Free'
  );
}
