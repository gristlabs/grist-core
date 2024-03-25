import {ActionSummary} from 'app/common/ActionSummary';
import {ApplyUAResult, ForkResult, PermissionDataWithExtraUsers, QueryFilters} from 'app/common/ActiveDocAPI';
import {AssistanceRequest, AssistanceResponse} from 'app/common/AssistancePrompts';
import {BaseAPI, IOptions} from 'app/common/BaseAPI';
import {BillingAPI, BillingAPIImpl} from 'app/common/BillingAPI';
import {BrowserSettings} from 'app/common/BrowserSettings';
import {ICustomWidget} from 'app/common/CustomWidget';
import {BulkColValues, TableColValues, TableRecordValue, TableRecordValues, UserAction} from 'app/common/DocActions';
import {DocCreationInfo, OpenDocMode} from 'app/common/DocListAPI';
import {OrgUsageSummary} from 'app/common/DocUsage';
import {Product} from 'app/common/Features';
import {isClient} from 'app/common/gristUrls';
import {encodeQueryParams} from 'app/common/gutil';
import {FullUser, UserProfile} from 'app/common/LoginSessionAPI';
import {OrgPrefs, UserOrgPrefs, UserPrefs} from 'app/common/Prefs';
import * as roles from 'app/common/roles';
import {
  WebhookFields,
  WebhookSubscribe,
  WebhookSummaryCollection,
  WebhookUpdate
} from 'app/common/Triggers';
import {addCurrentOrgToPath, getGristConfig} from 'app/common/urlUtils';
import omitBy from 'lodash/omitBy';


export type {FullUser, UserProfile};

// Nominal email address of the anonymous user.
export const ANONYMOUS_USER_EMAIL = 'anon@getgrist.com';

// Nominal email address of a user who, if you share with them, everyone gets access.
export const EVERYONE_EMAIL = 'everyone@getgrist.com';

// A special 'docId' that means to create a new document.
export const NEW_DOCUMENT_CODE = 'new';

// Properties shared by org, workspace, and doc resources.
export interface CommonProperties {
  name: string;
  createdAt: string;  // ISO date string
  updatedAt: string;  // ISO date string
  removedAt?: string; // ISO date string - only can appear on docs and workspaces currently
  public?: boolean;   // If set, resource is available to the public
}
export const commonPropertyKeys = ['createdAt', 'name', 'updatedAt'];

export interface OrganizationProperties extends CommonProperties {
  domain: string|null;
  // Organization includes preferences relevant to interacting with its content.
  userOrgPrefs?: UserOrgPrefs;  // Preferences specific to user and org
  orgPrefs?: OrgPrefs;          // Preferences specific to org (but not a particular user)
  userPrefs?: UserPrefs;        // Preferences specific to user (but not a particular org)
}
export const organizationPropertyKeys = [...commonPropertyKeys, 'domain',
                                         'orgPrefs', 'userOrgPrefs', 'userPrefs'];

// Basic information about an organization, excluding the user's access level
export interface OrganizationWithoutAccessInfo extends OrganizationProperties {
  id: number;
  owner: FullUser|null;
  billingAccount?: BillingAccount;
  host: string|null;  // if set, org's preferred domain (e.g. www.thing.com)
}

// Organization information plus the user's access level
export interface Organization extends OrganizationWithoutAccessInfo {
  access: roles.Role;
}

// Basic information about a billing account associated with an org or orgs.
export interface BillingAccount {
  id: number;
  individual: boolean;
  product: Product;
  isManager: boolean;
  inGoodStanding: boolean;
  externalOptions?: {
    invoiceId?: string;
  };
}

// The upload types vary based on which fetch implementation is in use.  This is
// an incomplete list.  For example, node streaming types are supported by node-fetch.
export type UploadType = string | Blob | Buffer;

/**
 * Returns a user-friendly org name, which is either org.name, or "@User Name" for personal orgs.
 */
export function getOrgName(org: Organization): string {
  return org.owner ? `@` + org.owner.name : org.name;
}

/**
 * Returns whether the given org is the templates org, which contains the public
 * templates and tutorials.
 */
export function isTemplatesOrg(org: {domain: Organization['domain']}|null): boolean {
  if (!org) { return false; }

  const {templateOrg} = getGristConfig();
  return org.domain === templateOrg;
}

export type WorkspaceProperties = CommonProperties;
export const workspacePropertyKeys = ['createdAt', 'name', 'updatedAt'];

export interface Workspace extends WorkspaceProperties {
  id: number;
  docs: Document[];
  org: Organization;
  orgDomain?: string;
  access: roles.Role;
  owner?: FullUser;  // Set when workspaces are in the "docs" pseudo-organization,
                     // assembled from multiple personal organizations.
                     // Not set when workspaces are all from the same organization.

  // Set when the workspace belongs to support@getgrist.com. We expect only one such workspace
  // ("Examples & Templates"), containing sample documents.
  isSupportWorkspace?: boolean;
}

export type DocumentType = 'tutorial'|'template';

// Non-core options for a document.
// "Non-core" means bundled into a single options column in the database.
// TODO: consider smoothing over this distinction in the API.
export interface DocumentOptions {
  description?: string|null;
  icon?: string|null;
  openMode?: OpenDocMode|null;
  externalId?: string|null;  // A slot for storing an externally maintained id.
                             // Not used in grist-core, but handy for Electron app.
  tutorial?: TutorialMetadata|null;
}

export interface TutorialMetadata {
  lastSlideIndex?: number;
  numSlides?: number;
}

export interface DocumentProperties extends CommonProperties {
  isPinned: boolean;
  urlId: string|null;
  trunkId: string|null;
  type: DocumentType|null;
  options: DocumentOptions|null;
}

export const documentPropertyKeys = [...commonPropertyKeys, 'isPinned', 'urlId', 'options', 'type'];

export interface Document extends DocumentProperties {
  id: string;
  workspace: Workspace;
  access: roles.Role;
  trunkAccess?: roles.Role|null;
  forks?: Fork[];
}

export interface Fork {
  id: string;
  trunkId: string;
  updatedAt: string;  // ISO date string
  options: DocumentOptions|null;
}

// Non-core options for a user.
export interface UserOptions {
  // Whether signing in with Google is allowed. Defaults to true if unset.
  allowGoogleLogin?: boolean;
  // The "sub" (subject) from the JWT issued by the password-based authentication provider.
  authSubject?: string;
  // Whether user is a consultant. Consultant users can be added to sites
  // without being counted for billing. Defaults to false if unset.
  isConsultant?: boolean;
  // Locale selected by the user. Defaults to 'en' if unset.
  locale?: string;
}

export interface PermissionDelta {
  maxInheritedRole?: roles.BasicRole|null;
  users?: {
    // Maps from email to group name, or null to inherit.
    [email: string]: roles.NonGuestRole|null
  };
}

export interface PermissionData {
  // True if permission data is restricted to current user.
  personal?: true;
  // True if current user is a public member.
  public?: boolean;
  maxInheritedRole?: roles.BasicRole|null;
  users: UserAccessData[];
}

// A structure for modifying managers of a billing account.
export interface ManagerDelta {
  users: {
    // To add a manager, link their email to 'managers'.
    // To remove a manager, link their email to null.
    // This format is used to rhyme with the ACL PermissionDelta format.
    [email: string]: 'managers'|null
  };
}

// Information about a user and their access to an unspecified resource of interest.
export interface UserAccessData {
  id: number;
  name: string;
  email: string;
  ref?: string|null;
  picture?: string|null; // When present, a url to a public image of unspecified dimensions.
  // Represents the user's direct access to the resource of interest. Lack of access to a resource
  // is represented by a null value.
  access: roles.Role|null;
  // A user's parentAccess represent their effective inheritable access to the direct parent of the resource
  // of interest. The user's effective access to the resource of interest can be determined based
  // on the user's parentAccess, the maxInheritedRole setting of the resource and the user's direct
  // access to the resource. Lack of access to the parent resource is represented by a null value.
  // If parent has non-inheritable access, this should be null.
  parentAccess?: roles.BasicRole|null;
  orgAccess?: roles.BasicRole|null;
  anonymous?: boolean;    // If set to true, the user is the anonymous user.
  isMember?: boolean;
}

/**
 * Combines access, parentAccess, and maxInheritedRole info into the resulting access role.
 */
export function getRealAccess(user: UserAccessData, permissionData: PermissionData): roles.Role|null {
  const inheritedAccess = roles.getWeakestRole(user.parentAccess || null, permissionData.maxInheritedRole || null);
  return roles.getStrongestRole(user.access, inheritedAccess);
}

const roleNames: {[role: string]: string} = {
  [roles.OWNER]: 'Owner',
  [roles.EDITOR]: 'Editor',
  [roles.VIEWER]: 'Viewer',
};

export function getUserRoleText(user: UserAccessData) {
  return roleNames[user.access!] || user.access || 'no access';
}

export interface ActiveSessionInfo {
  user: FullUser & {helpScoutSignature?: string};
  org: Organization|null;
  orgError?: OrgError;
}

export interface OrgError {
  error: string;
  status: number;
}

/**
 * Options to control the source of a document being replaced.  For
 * example, a document could be initialized from another document
 * (e.g. a fork) or from a snapshot.
 */
export interface DocReplacementOptions {
  /**
   * The docId to copy from.
   */
  sourceDocId?: string;
  /**
   * The s3 version ID.
   */
  snapshotId?: string;
  /**
   * True if tutorial metadata should be reset.
   *
   * Metadata that's reset includes the doc (i.e. tutorial) name, and the
   * properties under options.tutorial (e.g. lastSlideIndex).
   */
  resetTutorialMetadata?: boolean;
}

/**
 * Information about a single document snapshot/backup.
 */
export interface DocSnapshot {
  lastModified: string;  // when the snapshot was made
  snapshotId: string;    // the id of the snapshot in the underlying store
  docId: string;         // an id for accessing the snapshot as a Grist document
}

/**
 * A list of document snapshots.
 */
export interface DocSnapshots {
  snapshots: DocSnapshot[];  // snapshots, freshest first.
}

/**
 * Information about a single document state.
 */
export interface DocState {
  n: number;  // a sequential identifier
  h: string;  // a hash identifier
}

/**
 * A list of document states.  Most recent is first.
 */
export interface DocStates {
  states: DocState[];
}

/**
 * A comparison between two documents, called "left" and "right".
 * The comparison is based on the action histories in the documents.
 * If those histories have been truncated, the comparison may report
 * two documents as being unrelated even if they do in fact have some
 * shared history.
 */
export interface DocStateComparison {
  left: DocState;         // left / local document
  right: DocState;        // right / remote document
  parent: DocState|null;  // most recent common ancestor of left and right
  // summary of the relationship between the two documents.
  //        same: documents have the same most recent state
  //        left: the left document has actions not yet in the right
  //       right: the right document has actions not yet in the left
  //        both: both documents have changes (possible divergence)
  //   unrelated: no common history found
  summary: 'same' | 'left' | 'right' | 'both' | 'unrelated';
  // optionally, details of what changed may be included.
  details?: DocStateComparisonDetails;
}

/**
 * Detailed comparison between document versions.  For now, this
 * is provided as a pair of ActionSummary objects, relative to
 * the most recent common ancestor.
 */
export interface DocStateComparisonDetails {
  leftChanges: ActionSummary;
  rightChanges: ActionSummary;
}

export interface CopyDocOptions {
  documentName: string;
  asTemplate?: boolean;
}

export interface UserAPI {
  getSessionActive(): Promise<ActiveSessionInfo>;
  setSessionActive(email: string, org?: string): Promise<void>;
  getSessionAll(): Promise<{users: FullUser[], orgs: Organization[]}>;
  getOrgs(merged?: boolean): Promise<Organization[]>;
  getWorkspace(workspaceId: number): Promise<Workspace>;
  getOrg(orgId: number|string): Promise<Organization>;
  getOrgWorkspaces(orgId: number|string, includeSupport?: boolean): Promise<Workspace[]>;
  getOrgUsageSummary(orgId: number|string): Promise<OrgUsageSummary>;
  getTemplates(onlyFeatured?: boolean): Promise<Workspace[]>;
  getDoc(docId: string): Promise<Document>;
  newOrg(props: Partial<OrganizationProperties>): Promise<number>;
  newWorkspace(props: Partial<WorkspaceProperties>, orgId: number|string): Promise<number>;
  newDoc(props: Partial<DocumentProperties>, workspaceId: number): Promise<string>;
  newUnsavedDoc(options?: {timezone?: string}): Promise<string>;
  copyDoc(sourceDocumentId: string, workspaceId: number, options: CopyDocOptions): Promise<string>;
  renameOrg(orgId: number|string, name: string): Promise<void>;
  renameWorkspace(workspaceId: number, name: string): Promise<void>;
  renameDoc(docId: string, name: string): Promise<void>;
  updateOrg(orgId: number|string, props: Partial<OrganizationProperties>): Promise<void>;
  updateDoc(docId: string, props: Partial<DocumentProperties>): Promise<void>;
  deleteOrg(orgId: number|string): Promise<void>;
  deleteWorkspace(workspaceId: number): Promise<void>;     // delete workspace permanently
  softDeleteWorkspace(workspaceId: number): Promise<void>; // soft-delete workspace
  undeleteWorkspace(workspaceId: number): Promise<void>;   // recover soft-deleted workspace
  deleteDoc(docId: string): Promise<void>;      // delete doc permanently
  softDeleteDoc(docId: string): Promise<void>;  // soft-delete doc
  undeleteDoc(docId: string): Promise<void>;    // recover soft-deleted doc
  updateOrgPermissions(orgId: number|string, delta: PermissionDelta): Promise<void>;
  updateWorkspacePermissions(workspaceId: number, delta: PermissionDelta): Promise<void>;
  updateDocPermissions(docId: string, delta: PermissionDelta): Promise<void>;
  getOrgAccess(orgId: number|string): Promise<PermissionData>;
  getWorkspaceAccess(workspaceId: number): Promise<PermissionData>;
  getDocAccess(docId: string): Promise<PermissionData>;
  pinDoc(docId: string): Promise<void>;
  unpinDoc(docId: string): Promise<void>;
  moveDoc(docId: string, workspaceId: number): Promise<void>;
  getUserProfile(): Promise<FullUser>;
  updateUserName(name: string): Promise<void>;
  updateUserLocale(locale: string|null): Promise<void>;
  updateAllowGoogleLogin(allowGoogleLogin: boolean): Promise<void>;
  updateIsConsultant(userId: number, isConsultant: boolean): Promise<void>;
  getWorker(key: string): Promise<string>;
  getWorkerAPI(key: string): Promise<DocWorkerAPI>;
  getBillingAPI(): BillingAPI;
  getDocAPI(docId: string): DocAPI;
  fetchApiKey(): Promise<string>;
  createApiKey(): Promise<string>;
  deleteApiKey(): Promise<void>;
  getTable(docId: string, tableName: string): Promise<TableColValues>;
  applyUserActions(docId: string, actions: UserAction[]): Promise<ApplyUAResult>;
  importUnsavedDoc(material: UploadType, options?: {
    filename?: string,
    timezone?: string,
    onUploadProgress?: (ev: ProgressEvent) => void,
  }): Promise<string>;
  deleteUser(userId: number, name: string): Promise<void>;
  getBaseUrl(): string;  // Get the prefix for all the endpoints this object wraps.
  forRemoved(): UserAPI; // Get a version of the API that works on removed resources.
  getWidgets(): Promise<ICustomWidget[]>;
  /**
   * Deletes account and personal org with all documents. Note: deleteUser doesn't clear documents, and this method
   * is specific to Grist installation, and might not be supported. Pass current user's id so that we can verify
   * that the user is deleting their own account. This is just to prevent accidental deletion from multiple tabs.
   *
   * @returns true if the account was deleted, false if there was a mismatch with the current user's id, and the
   * account was probably already deleted.
   */
  closeAccount(userId: number): Promise<boolean>;
  /**
   * Deletes current non personal org with all documents. Note: deleteOrg doesn't clear documents, and this method
   * is specific to Grist installation, and might not be supported.
   */
  closeOrg(): Promise<void>;
}

/**
 * Parameters for the download CSV and XLSX endpoint (/download/table-schema & /download/csv & /download/csv).
 */
 export interface DownloadDocParams {
  tableId: string;
  viewSection?: number;
  activeSortSpec?: string;
  filters?: string;
}

interface GetRowsParams {
  filters?: QueryFilters;
  immediate?: boolean;
}

/**
 * Collect endpoints related to the content of a single document that we've been thinking
 * of as the (restful) "Doc API".  A few endpoints that could be here are not, for historical
 * reasons, such as downloads.
 */
export interface DocAPI {
  // Immediate flag is a currently not-advertised feature, allowing a query to proceed without
  // waiting for a document to be initialized. This is useful if the calculations done when
  // opening a document are irrelevant.
  getRows(tableId: string, options?: GetRowsParams): Promise<TableColValues>;
  getRecords(tableId: string, options?: GetRowsParams): Promise<TableRecordValue[]>;
  updateRows(tableId: string, changes: TableColValues): Promise<number[]>;
  addRows(tableId: string, additions: BulkColValues): Promise<number[]>;
  removeRows(tableId: string, removals: number[]): Promise<number[]>;
  fork(): Promise<ForkResult>;
  replace(source: DocReplacementOptions): Promise<void>;
  // Get list of document versions (specify raw to bypass caching, which should only make
  // a difference if snapshots have "leaked")
  getSnapshots(raw?: boolean): Promise<DocSnapshots>;
  // remove selected snapshots, or all snapshots that have "leaked" from inventory (should
  // be empty), or all but the current snapshot.
  removeSnapshots(snapshotIds: string[] | 'unlisted' | 'past'): Promise<{snapshotIds: string[]}>;
  forceReload(): Promise<void>;
  recover(recoveryMode: boolean): Promise<void>;
  // Compare two documents, optionally including details of the changes.
  compareDoc(remoteDocId: string, options?: { detail: boolean }): Promise<DocStateComparison>;
  // Compare two versions within a document, including details of the changes.
  // Versions are identified by action hashes, or aliases understood by HashUtil.
  // Currently, leftHash is expected to be an ancestor of rightHash.  If rightHash
  // is HEAD, the result will contain a copy of any rows added or updated.
  compareVersion(leftHash: string, rightHash: string): Promise<DocStateComparison>;
  getDownloadUrl(options: {template: boolean, removeHistory: boolean}): string;
  getDownloadXlsxUrl(params?: DownloadDocParams): string;
  getDownloadCsvUrl(params: DownloadDocParams): string;
  getDownloadTsvUrl(params: DownloadDocParams): string;
  getDownloadDsvUrl(params: DownloadDocParams): string;
  getDownloadTableSchemaUrl(params: DownloadDocParams): string;
  /**
   * Exports current document to the Google Drive as a spreadsheet file. To invoke this method, first
   * acquire "code" via Google Auth Endpoint (see ShareMenu.ts for an example).
   * @param code Authorization code returned from Google (requested via Grist's Google Auth Endpoint)
   * @param title Name of the spreadsheet that will be created (should use a Grist document's title)
   */
  sendToDrive(code: string, title: string): Promise<{url: string}>;
  // Upload a single attachment and return the resulting metadata row ID.
  // The arguments are passed to FormData.append.
  uploadAttachment(value: string | Blob, filename?: string): Promise<number>;

  // Get users that are worth proposing to "View As" for access control purposes.
  getUsersForViewAs(): Promise<PermissionDataWithExtraUsers>;

  getWebhooks(): Promise<WebhookSummaryCollection>;
  addWebhook(webhook: WebhookFields): Promise<{webhookId: string}>;
  removeWebhook(webhookId: string, tableId: string): Promise<void>;
  // Update webhook
  updateWebhook(webhook: WebhookUpdate): Promise<void>;
  flushWebhooks(): Promise<void>;
  flushWebhook(webhookId: string): Promise<void>;

  getAssistance(params: AssistanceRequest): Promise<AssistanceResponse>;
}

// Operations that are supported by a doc worker.
export interface DocWorkerAPI {
  readonly url: string;
  importDocToWorkspace(uploadId: number, workspaceId: number, settings?: BrowserSettings): Promise<DocCreationInfo>;
  upload(material: UploadType, filename?: string): Promise<number>;
  downloadDoc(docId: string, template?: boolean): Promise<Response>;
  copyDoc(docId: string, template?: boolean, name?: string): Promise<number>;
}

export class UserAPIImpl extends BaseAPI implements UserAPI {
  constructor(private _homeUrl: string, private _options: IOptions = {}) {
    super(_options);
  }

  public forRemoved(): UserAPI {
    const extraParameters = new Map<string, string>([['showRemoved', '1']]);
    return new UserAPIImpl(this._homeUrl, {...this._options, extraParameters});
  }

  public async getSessionActive(): Promise<ActiveSessionInfo> {
    return this.requestJson(`${this._url}/api/session/access/active`, {method: 'GET'});
  }

  public async setSessionActive(email: string, org?: string): Promise<void> {
    const body = JSON.stringify({ email, org });
    return this.requestJson(`${this._url}/api/session/access/active`, {method: 'POST', body});
  }

  public async getSessionAll(): Promise<{users: FullUser[], orgs: Organization[]}> {
    return this.requestJson(`${this._url}/api/session/access/all`, {method: 'GET'});
  }

  public async getOrgs(merged: boolean = false): Promise<Organization[]> {
    return this.requestJson(`${this._url}/api/orgs?merged=${merged ? 1 : 0}`, { method: 'GET' });
  }

  public async getWorkspace(workspaceId: number): Promise<Workspace> {
    return this.requestJson(`${this._url}/api/workspaces/${workspaceId}`, { method: 'GET' });
  }

  public async getOrg(orgId: number|string): Promise<Organization> {
    return this.requestJson(`${this._url}/api/orgs/${orgId}`, { method: 'GET' });
  }

  public async getOrgWorkspaces(orgId: number|string, includeSupport = true): Promise<Workspace[]> {
    return this.requestJson(`${this._url}/api/orgs/${orgId}/workspaces?includeSupport=${includeSupport ? 1 : 0}`,
      { method: 'GET' });
  }

  public async getOrgUsageSummary(orgId: number|string): Promise<OrgUsageSummary> {
    return this.requestJson(`${this._url}/api/orgs/${orgId}/usage`, { method: 'GET' });
  }

  public async getTemplates(onlyFeatured: boolean = false): Promise<Workspace[]> {
    return this.requestJson(`${this._url}/api/templates?onlyFeatured=${onlyFeatured ? 1 : 0}`, { method: 'GET' });
  }

  public async getWidgets(): Promise<ICustomWidget[]> {
    return await this.requestJson(`${this._url}/api/widgets`, { method: 'GET' });
  }

  public async getDoc(docId: string): Promise<Document> {
    return this.requestJson(`${this._url}/api/docs/${docId}`, { method: 'GET' });
  }

  public async newOrg(props: Partial<OrganizationProperties>): Promise<number> {
    return this.requestJson(`${this._url}/api/orgs`, {
      method: 'POST',
      body: JSON.stringify(props)
    });
  }

  public async newWorkspace(props: Partial<WorkspaceProperties>, orgId: number|string): Promise<number> {
    return this.requestJson(`${this._url}/api/orgs/${orgId}/workspaces`, {
      method: 'POST',
      body: JSON.stringify(props)
    });
  }

  public async newDoc(props: Partial<DocumentProperties>, workspaceId: number): Promise<string> {
    return this.requestJson(`${this._url}/api/workspaces/${workspaceId}/docs`, {
      method: 'POST',
      body: JSON.stringify(props)
    });
  }

  public async newUnsavedDoc(options: {timezone?: string} = {}): Promise<string> {
    return this.requestJson(`${this._url}/api/docs`, {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  public async copyDoc(
    sourceDocumentId: string,
    workspaceId: number,
    options: CopyDocOptions
  ): Promise<string> {
    return this.requestJson(`${this._url}/api/docs`, {
      method: 'POST',
      body: JSON.stringify({
        sourceDocumentId,
        workspaceId,
        ...options,
      }),
    });
  }

  public async renameOrg(orgId: number|string, name: string): Promise<void> {
    await this.request(`${this._url}/api/orgs/${orgId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name })
    });
  }

  public async renameWorkspace(workspaceId: number, name: string): Promise<void> {
    await this.request(`${this._url}/api/workspaces/${workspaceId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name })
    });
  }

  public async renameDoc(docId: string, name: string): Promise<void> {
    return this.updateDoc(docId, {name});
  }

  public async updateOrg(orgId: number|string, props: Partial<OrganizationProperties>): Promise<void> {
    await this.request(`${this._url}/api/orgs/${orgId}`, {
      method: 'PATCH',
      body: JSON.stringify(props)
    });
  }

  public async updateDoc(docId: string, props: Partial<DocumentProperties>): Promise<void> {
    await this.request(`${this._url}/api/docs/${docId}`, {
      method: 'PATCH',
      body: JSON.stringify(props)
    });
  }

  public async deleteOrg(orgId: number|string): Promise<void> {
    await this.request(`${this._url}/api/orgs/${orgId}`, { method: 'DELETE' });
  }

  public async deleteWorkspace(workspaceId: number): Promise<void> {
    await this.request(`${this._url}/api/workspaces/${workspaceId}`, { method: 'DELETE' });
  }

  public async softDeleteWorkspace(workspaceId: number): Promise<void> {
    await this.request(`${this._url}/api/workspaces/${workspaceId}/remove`, { method: 'POST' });
  }

  public async undeleteWorkspace(workspaceId: number): Promise<void> {
    await this.request(`${this._url}/api/workspaces/${workspaceId}/unremove`, { method: 'POST' });
  }

  public async deleteDoc(docId: string): Promise<void> {
    await this.request(`${this._url}/api/docs/${docId}`, { method: 'DELETE' });
  }

  public async softDeleteDoc(docId: string): Promise<void> {
    await this.request(`${this._url}/api/docs/${docId}/remove`, { method: 'POST' });
  }

  public async undeleteDoc(docId: string): Promise<void> {
    await this.request(`${this._url}/api/docs/${docId}/unremove`, { method: 'POST' });
  }

  public async updateOrgPermissions(orgId: number|string, delta: PermissionDelta): Promise<void> {
    await this.request(`${this._url}/api/orgs/${orgId}/access`, {
      method: 'PATCH',
      body: JSON.stringify({ delta })
    });
  }

  public async updateWorkspacePermissions(workspaceId: number, delta: PermissionDelta): Promise<void> {
    await this.request(`${this._url}/api/workspaces/${workspaceId}/access`, {
      method: 'PATCH',
      body: JSON.stringify({ delta })
    });
  }

  public async updateDocPermissions(docId: string, delta: PermissionDelta): Promise<void> {
    await this.request(`${this._url}/api/docs/${docId}/access`, {
      method: 'PATCH',
      body: JSON.stringify({ delta })
    });
  }

  public async getOrgAccess(orgId: number|string): Promise<PermissionData> {
    return this.requestJson(`${this._url}/api/orgs/${orgId}/access`, { method: 'GET' });
  }

  public async getWorkspaceAccess(workspaceId: number): Promise<PermissionData> {
    return this.requestJson(`${this._url}/api/workspaces/${workspaceId}/access`, { method: 'GET' });
  }

  public async getDocAccess(docId: string): Promise<PermissionData> {
    return this.requestJson(`${this._url}/api/docs/${docId}/access`, { method: 'GET' });
  }

  public async pinDoc(docId: string): Promise<void> {
    await this.request(`${this._url}/api/docs/${docId}/pin`, {
      method: 'PATCH'
    });
  }

  public async unpinDoc(docId: string): Promise<void> {
    await this.request(`${this._url}/api/docs/${docId}/unpin`, {
      method: 'PATCH'
    });
  }

  public async moveDoc(docId: string, workspaceId: number): Promise<void> {
    await this.request(`${this._url}/api/docs/${docId}/move`, {
      method: 'PATCH',
      body: JSON.stringify({ workspace: workspaceId })
    });
  }

  public async getUserProfile(): Promise<FullUser> {
    return this.requestJson(`${this._url}/api/profile/user`);
  }

  public async updateUserName(name: string): Promise<void> {
    await this.request(`${this._url}/api/profile/user/name`, {
      method: 'POST',
      body: JSON.stringify({name})
    });
  }

  public async updateUserLocale(locale: string|null): Promise<void> {
    await this.request(`${this._url}/api/profile/user/locale`, {
      method: 'POST',
      body: JSON.stringify({locale})
    });
  }

  public async updateAllowGoogleLogin(allowGoogleLogin: boolean): Promise<void> {
    await this.request(`${this._url}/api/profile/allowGoogleLogin`, {
      method: 'POST',
      body: JSON.stringify({allowGoogleLogin})
    });
  }

  public async updateIsConsultant(userId: number, isConsultant: boolean): Promise<void> {
    await this.request(`${this._url}/api/profile/isConsultant`, {
      method: 'POST',
      body: JSON.stringify({userId, isConsultant})
    });
  }

  public async getWorker(key: string): Promise<string> {
    const json = await this.requestJson(`${this._url}/api/worker/${key}`, {
      method: 'GET',
      credentials: 'include'
    });
    return getDocWorkerUrl(this._homeUrl, json);
  }

  public async getWorkerAPI(key: string): Promise<DocWorkerAPI> {
    const docUrl = this._urlWithOrg(await this.getWorker(key));
    return new DocWorkerAPIImpl(docUrl, this._options);
  }

  public getBillingAPI(): BillingAPI {
    return new BillingAPIImpl(this._url, this._options);
  }

  public getDocAPI(docId: string): DocAPI {
    return new DocAPIImpl(this._url, docId, this._options);
  }

  public async fetchApiKey(): Promise<string> {
    const resp = await this.request(`${this._url}/api/profile/apiKey`);
    return await resp.text();
  }

  public async createApiKey(): Promise<string> {
    const res = await this.request(`${this._url}/api/profile/apiKey`, {
      method: 'POST'
    });
    return await res.text();
  }

  public async deleteApiKey(): Promise<void> {
    await this.request(`${this._url}/api/profile/apiKey`, {
      method: 'DELETE'
    });
  }

  // This method is not strictly needed anymore, but is widely used by
  // tests so supporting as a handy shortcut for getDocAPI(docId).getRows(tableName)
  public async getTable(docId: string, tableName: string): Promise<TableColValues> {
    return this.getDocAPI(docId).getRows(tableName);
  }

  public async applyUserActions(docId: string, actions: UserAction[]): Promise<ApplyUAResult> {
    return this.requestJson(`${this._url}/api/docs/${docId}/apply`, {
      method: 'POST',
      body: JSON.stringify(actions)
    });
  }

  public async importUnsavedDoc(material: UploadType, options?: {
    filename?: string,
    timezone?: string,
    onUploadProgress?: (ev: ProgressEvent) => void,
  }): Promise<string> {
    options = options || {};
    const formData = this.newFormData();
    formData.append('upload', material as any, options.filename);
    if (options.timezone) { formData.append('timezone', options.timezone); }
    const resp = await this.requestAxios(`${this._url}/api/docs`, {
      method: 'POST',
      data: formData,
      onUploadProgress: options.onUploadProgress,
      // On browser, it is important not to set Content-Type so that the browser takes care
      // of setting HTTP headers appropriately.  Outside browser, requestAxios has logic
      // for setting the HTTP headers.
      headers: {...this.defaultHeadersWithoutContentType()},
    });
    return resp.data;
  }

  public async deleteUser(userId: number, name: string) {
    await this.request(`${this._url}/api/users/${userId}`,
                       {method: 'DELETE',
                        body: JSON.stringify({name})});
  }

  public async closeAccount(userId: number): Promise<boolean> {
    return await this.requestJson(`${this._url}/api/doom/account?userid=` + userId, {method: 'DELETE'});
  }

  public async closeOrg() {
    await this.request(`${this._url}/api/doom/org`, {method: 'DELETE'});
  }

  public getBaseUrl(): string { return this._url; }

  // Recomputes the URL on every call to pick up changes in the URL when switching orgs.
  // (Feels inefficient, but probably doesn't matter, and it's simpler than the alternatives.)
  private get _url(): string {
    return this._urlWithOrg(this._homeUrl);
  }

  private _urlWithOrg(base: string): string {
    return isClient() ? addCurrentOrgToPath(base) : base.replace(/\/$/, '');
  }
}

export class DocWorkerAPIImpl extends BaseAPI implements DocWorkerAPI {
  constructor(public readonly url: string, _options: IOptions = {}) {
    super(_options);
  }

  public async importDocToWorkspace(uploadId: number, workspaceId: number, browserSettings?: BrowserSettings):
      Promise<DocCreationInfo> {
    return this.requestJson(`${this.url}/api/workspaces/${workspaceId}/import`, {
      method: 'POST',
      body: JSON.stringify({ uploadId, browserSettings })
    });
  }

  public async upload(material: UploadType, filename?: string): Promise<number> {
    const formData = this.newFormData();
    formData.append('upload', material as any, filename);
    const json = await this.requestJson(`${this.url}/uploads`, {
      // On browser, it is important not to set Content-Type so that the browser takes care
      // of setting HTTP headers appropriately.  Outside of browser, node-fetch also appears
      // to take care of this - https://github.github.io/fetch/#request-body
      headers: {...this.defaultHeadersWithoutContentType()},
      method: 'POST',
      body: formData
    });
    return json.uploadId;
  }

  public async downloadDoc(docId: string, template: boolean = false): Promise<Response> {
    const extra = template ? '?template=1' : '';
    const result = await this.request(`${this.url}/api/docs/${docId}/download${extra}`, {
      method: 'GET',
    });
    if (!result.ok) { throw new Error(await result.text()); }
    return result;
  }

  public async copyDoc(docId: string, template: boolean = false, name?: string): Promise<number> {
    const url = new URL(`${this.url}/copy?doc=${docId}`);
    if (template) {
      url.searchParams.append('template', '1');
    }
    if (name) {
      url.searchParams.append('name', name);
    }
    const json = await this.requestJson(url.href, {
      method: 'POST',
    });
    return json.uploadId;
  }
}

export class DocAPIImpl extends BaseAPI implements DocAPI {
  private _url: string;

  constructor(url: string, public readonly docId: string, options: IOptions = {}) {
    super(options);
    this._url = `${url}/api/docs/${docId}`;
  }

  public getBaseUrl(): string { return this._url; }

  public async getRows(tableId: string, options?: GetRowsParams): Promise<TableColValues> {
    return this._getRecords(tableId, 'data', options);
  }

  public async getRecords(tableId: string, options?: GetRowsParams): Promise<TableRecordValue[]> {
    const response: TableRecordValues = await this._getRecords(tableId, 'records', options);
    return response.records;
  }

  public async updateRows(tableId: string, changes: TableColValues): Promise<number[]> {
    return this.requestJson(`${this._url}/tables/${tableId}/data`, {
      body: JSON.stringify(changes),
      method: 'PATCH'
    });
  }

  public async addRows(tableId: string, additions: BulkColValues): Promise<number[]> {
    return this.requestJson(`${this._url}/tables/${tableId}/data`, {
      body: JSON.stringify(additions),
      method: 'POST'
    });
  }

  public async removeRows(tableId: string, removals: number[]): Promise<number[]> {
    return this.requestJson(`${this._url}/tables/${tableId}/data/delete`, {
      body: JSON.stringify(removals),
      method: 'POST'
    });
  }

  public async fork(): Promise<ForkResult> {
    return this.requestJson(`${this._url}/fork`, {
      method: 'POST'
    });
  }

  public async replace(source: DocReplacementOptions): Promise<void> {
    return this.requestJson(`${this._url}/replace`, {
      body: JSON.stringify(source),
      method: 'POST'
    });
  }

  public async getSnapshots(raw?: boolean): Promise<DocSnapshots> {
    return this.requestJson(`${this._url}/snapshots?raw=${raw}`);
  }

  public async removeSnapshots(snapshotIds: string[] | 'unlisted' | 'past') {
    const body = typeof snapshotIds === 'string' ? { select: snapshotIds } : { snapshotIds };
    return await this.requestJson(`${this._url}/snapshots/remove`, {
      method: 'POST',
      body: JSON.stringify(body)
    });
  }

  public async getUsersForViewAs(): Promise<PermissionDataWithExtraUsers> {
    return this.requestJson(`${this._url}/usersForViewAs`);
  }

  public async getWebhooks(): Promise<WebhookSummaryCollection> {
    return this.requestJson(`${this._url}/webhooks`);
  }

  public async addWebhook(webhook: WebhookSubscribe & {tableId: string}): Promise<{webhookId: string}> {
    const {tableId} = webhook;
    return this.requestJson(`${this._url}/tables/${tableId}/_subscribe`, {
      method: 'POST',
      body: JSON.stringify(
        omitBy(webhook, (val, key) => key === 'tableId' || val === null)),
    });
  }

  public async updateWebhook(webhook: WebhookUpdate): Promise<void> {
    return this.requestJson(`${this._url}/webhooks/${webhook.id}`, {
      method: 'PATCH',
      body: JSON.stringify(webhook.fields),
    });
  }

  public removeWebhook(webhookId: string, tableId: string) {
    // unsubscribeKey is not required for owners
    const unsubscribeKey = '';
    return this.requestJson(`${this._url}/tables/${tableId}/_unsubscribe`, {
      method: 'POST',
      body: JSON.stringify({webhookId, unsubscribeKey}),
    });
  }

  public async flushWebhooks(): Promise<void> {
    await this.request(`${this._url}/webhooks/queue`, {
      method: 'DELETE'
    });
  }

  public async flushWebhook(id: string): Promise<void> {
    await this.request(`${this._url}/webhooks/queue/${id}`, {
      method: 'DELETE'
    });
  }

  public async forceReload(): Promise<void> {
    await this.request(`${this._url}/force-reload`, {
      method: 'POST'
    });
  }

  public async recover(recoveryMode: boolean): Promise<void> {
    await this.request(`${this._url}/recover`, {
      body: JSON.stringify({recoveryMode}),
      method: 'POST'
    });
  }

  public async compareDoc(remoteDocId: string, options: {
    detail?: boolean
  } = {}): Promise<DocStateComparison> {
     const q = options.detail ? '?detail=true' : '';
     return this.requestJson(`${this._url}/compare/${remoteDocId}${q}`);
  }

  public async copyDoc(workspaceId: number, options: CopyDocOptions): Promise<string> {
    const {documentName, asTemplate} = options;
    return this.requestJson(`${this._url}/copy`, {
      body: JSON.stringify({workspaceId, documentName, asTemplate}),
      method: 'POST'
     });
  }

  public async compareVersion(leftHash: string, rightHash: string): Promise<DocStateComparison> {
    const url = new URL(`${this._url}/compare`);
    url.searchParams.append('left', leftHash);
    url.searchParams.append('right', rightHash);
    return this.requestJson(url.href);
  }

  public getDownloadUrl({template, removeHistory}: {template: boolean, removeHistory: boolean}): string {
    return this._url + `/download?template=${template}&nohistory=${removeHistory}`;
  }

  public getDownloadXlsxUrl(params: DownloadDocParams) {
    return this._url + '/download/xlsx?' + encodeQueryParams({...params});
  }

  public getDownloadCsvUrl(params: DownloadDocParams) {
    // We spread `params` to work around TypeScript being overly cautious.
    return this._url + '/download/csv?' + encodeQueryParams({...params});
  }

  public getDownloadTsvUrl(params: DownloadDocParams) {
    return this._url + '/download/tsv?' + encodeQueryParams({...params});
  }

  public getDownloadDsvUrl(params: DownloadDocParams) {
    return this._url + '/download/dsv?' + encodeQueryParams({...params});
  }

  public getDownloadTableSchemaUrl(params: DownloadDocParams) {
    // We spread `params` to work around TypeScript being overly cautious.
    return this._url + '/download/table-schema?' + encodeQueryParams({...params});
  }

  public async sendToDrive(code: string, title: string): Promise<{url: string}> {
    const url = new URL(`${this._url}/send-to-drive`);
    url.searchParams.append('title', title);
    url.searchParams.append('code', code);
    return this.requestJson(url.href);
  }

  public async uploadAttachment(value: string | Blob, filename?: string): Promise<number> {
    const formData = this.newFormData();
    formData.append('upload', value as Blob, filename);
    const response = await this.requestAxios(`${this._url}/attachments`, {
      method: 'POST',
      data: formData,
      // On browser, it is important not to set Content-Type so that the browser takes care
      // of setting HTTP headers appropriately.  Outside browser, requestAxios has logic
      // for setting the HTTP headers.
      headers: {...this.defaultHeadersWithoutContentType()},
    });
    return response.data[0];
  }

  public async getAssistance(params: AssistanceRequest): Promise<AssistanceResponse> {
    return await this.requestJson(`${this._url}/assistant`, {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  private _getRecords(tableId: string, endpoint: 'data' | 'records', options?: GetRowsParams): Promise<any> {
    const url = new URL(`${this._url}/tables/${tableId}/${endpoint}`);
    if (options?.filters) {
      url.searchParams.append('filter', JSON.stringify(options.filters));
    }
    if (options?.immediate) {
      url.searchParams.append('immediate', 'true');
    }
    return this.requestJson(url.href);
  }
}

/**
 * Get a docWorkerUrl from information returned from backend. When the backend
 * is fully configured, and there is a pool of workers, this is straightforward,
 * just return the docWorkerUrl reported by the backend. For single-instance
 * installs, the backend returns a null docWorkerUrl, and a client can simply
 * use the homeUrl of the backend, with extra path prefix information
 * given by selfPrefix. At the time of writing, the selfPrefix contains a
 * doc-worker id, and a tag for the codebase (used in consistency checks).
 */
export function getDocWorkerUrl(homeUrl: string, docWorkerInfo: {
  docWorkerUrl: string|null,
  selfPrefix?: string,
}): string {
  if (!docWorkerInfo.docWorkerUrl) {
    if (!docWorkerInfo.selfPrefix) {
      // This should never happen.
      throw new Error('missing selfPrefix for docWorkerUrl');
    }
    const url = new URL(homeUrl);
    url.pathname = docWorkerInfo.selfPrefix + url.pathname;
    return url.href;
  }
  return docWorkerInfo.docWorkerUrl;
}
