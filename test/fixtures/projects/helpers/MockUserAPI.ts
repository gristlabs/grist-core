import {urlState} from 'app/client/models/gristUrlState';
import {ApplyUAResult} from 'app/common/ActiveDocAPI';
import {ApiError} from 'app/common/ApiError';
import {BillingAPI} from 'app/common/BillingAPI';
import {ICustomWidget} from 'app/common/CustomWidget';
import {TableColValues, UserAction} from 'app/common/DocActions';
import {DocCreationInfo} from 'app/common/DocListAPI';
import {createEmptyOrgUsageSummary, OrgUsageSummary} from 'app/common/DocUsage';
import {arrayRemove} from 'app/common/gutil';
import {FullUser} from 'app/common/LoginSessionAPI';
import {NonGuestRole} from 'app/common/roles';
import {ActiveSessionInfo, DocAPI, Document, DocumentOptions, DocumentProperties, DocWorkerAPI,
        Organization, OrganizationProperties, PermissionData, PermissionDelta,
        RenameDocOptions, UserAPI, Workspace} from 'app/common/UserAPI';

const createdAt = '2007-04-05T14:30Z';
const updatedAt = '2007-04-05T14:30Z';

const TEMPLATES_ORG_ID = 5;

interface OrgEntry {
  id: number;
  name: string;
  domain: string | null;
  owner?: any;
  workspaces: number[];
  access: NonGuestRole;
}

function orgEntryToOrg({ id, name, domain, owner, access }: OrgEntry): Organization {
  return { id, name, domain, owner, access, createdAt, updatedAt, host: null };
}

interface OrgStore {
  [key: string]: OrgEntry;
}

interface WorkspaceEntry {
  id: number;
  name: string;
  org: number;
  docs: number[];
  access: NonGuestRole;
}

interface WorkspaceStore {
  [key: string]: WorkspaceEntry;
}

interface DocEntry {
  id: number;
  name: string;
  workspace: number;
  access: NonGuestRole;
  isPinned: boolean;
  age?: number;         // age in seconds
  options?: DocumentOptions|null;
}

interface DocStore {
  [key: string]: DocEntry;
}

// needed to mock `createApiKey()`
let keyIndex = 0;

/**
 * Mock implementation of UserAPI and DocWorkerAPI.
 *
 * Used by other tests that need to mock API calls, such as DocMenu and MFAConfig tests.
 */
export class MockUserAPI implements UserAPI, DocWorkerAPI {
  public readonly url: string = 'http://localhost:0';
  public activeUser: string = 'santa';    // Can be changed to pretend to be a different user

  private _nextOrgId = 4;
  private _nextWorkspaceId = 10;
  private _nextDocId = 32;

  private _orgs: OrgStore = {
    1: { id: 1, domain: null, name: 'Personal', workspaces: [1, 2, 3], access: 'owners' },
    2: { id: 2, domain: 'nike', name: 'Nike', workspaces: [4, 5], access: 'viewers' },
    3: { id: 3, domain: 'chase', name: 'Chase', workspaces: [6], access: 'owners' },
    4: { id: 4, domain: 'ms', name: 'Microsoft', workspaces: [7], access: 'owners' },
    [TEMPLATES_ORG_ID]: {
      id: TEMPLATES_ORG_ID, domain: 'templates', name: 'Grist Templates', workspaces: [8, 9], access: 'viewers'
    }
  };

  private _workspaces: WorkspaceStore = {
    1: { id: 1, name: 'Real estate', org: 1, docs: [1, 2, 3, 4, 5, 6, 7, 8, 9], access: 'viewers' },
    2: {
      id: 2, name: 'Personal', org: 1,
      docs: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21], access: 'owners'
    },
    3: { id: 3, name: 'August', org: 1, docs: [22, 23], access: 'owners' },
    4: { id: 4, name: 'Hosted', org: 2, docs: [24, 25, 26], access: 'owners' },
    5: { id: 5, name: 'Management', org: 2, docs: [27], access: 'owners' },
    6: { id: 6, name: 'New project', org: 3, docs: [28, 29, 30], access: 'owners' },
    7: { id: 7, name: 'September', org: 4, docs: [31], access: 'owners' },
    8: { id: 8, name: 'Invoice', org: TEMPLATES_ORG_ID, docs: [], access: 'viewers' },
    9: { id: 9, name: 'CRM', org: TEMPLATES_ORG_ID, docs: [], access: 'viewers' }
  };

  private _docs: DocStore = {
    1: { id: 1, name: 'Doc01', workspace: 1, access: 'owners', isPinned: false },
    2: { id: 2, name: 'Doc02', workspace: 1, access: 'owners', isPinned: false },
    3: { id: 3, name: 'Doc03', workspace: 1, access: 'owners', isPinned: false },
    4: { id: 4, name: 'Doc04', workspace: 1, access: 'owners', isPinned: false },
    5: { id: 5, name: 'Doc05', workspace: 1, access: 'owners', isPinned: false },
    6: { id: 6, name: 'Doc06', workspace: 1, access: 'owners', isPinned: false },
    7: { id: 7, name: 'Doc07', workspace: 1, access: 'owners', isPinned: false },
    8: { id: 8, name: 'Doc08', workspace: 1, access: 'owners', isPinned: false },
    9: { id: 9, name: 'Doc09', workspace: 1, access: 'viewers', isPinned: false },
    10: { id: 10, name: 'Doc10', workspace: 2, access: 'owners', isPinned: false, age: 600 },
    11: { id: 11, name: 'Doc11', workspace: 2, access: 'owners', isPinned: false, age: 10 },
    12: { id: 12, name: 'Doc12', workspace: 2, access: 'owners', isPinned: false, age: 100000 },
    13: { id: 13, name: 'Doc13', workspace: 2, access: 'owners', isPinned: true, age: 5400 },
    14: { id: 14, name: 'Doc14', workspace: 2, access: 'owners', isPinned: false, age: 60000000 },
    15: { id: 15, name: 'Doc15', workspace: 2, access: 'owners', isPinned: false },
    16: { id: 16, name: 'Doc16', workspace: 2, access: 'owners', isPinned: false },
    17: {
      id: 17, name: 'One doc to rule them all with a long name and a strong fist',
      workspace: 2, access: 'owners', isPinned: true
    },
    18: { id: 18, name: 'Doc18', workspace: 2, access: 'owners', isPinned: false },
    19: { id: 19, name: 'Doc19', workspace: 2, access: 'owners', isPinned: false },
    20: { id: 20, name: 'Doc20', workspace: 2, access: 'owners', isPinned: false },
    21: { id: 21, name: 'Doc21', workspace: 2, access: 'owners', isPinned: false },
    22: { id: 22, name: 'Doc22', workspace: 3, access: 'owners', isPinned: true },
    23: { id: 23, name: 'Doc23', workspace: 3, access: 'owners', isPinned: false },
    24: { id: 24, name: 'Plans', workspace: 4, access: 'owners', isPinned: false },
    25: { id: 25, name: 'Progress', workspace: 4, access: 'owners', isPinned: false },
    26: { id: 26, name: 'Ideas', workspace: 4, access: 'owners', isPinned: false },
    27: { id: 27, name: 'Clients', workspace: 5, access: 'owners', isPinned: false },
    28: { id: 28, name: 'Banking', workspace: 6, access: 'owners', isPinned: false },
    29: { id: 29, name: 'Marketing', workspace: 6, access: 'owners', isPinned: false },
    30: { id: 30, name: 'Money', workspace: 6, access: 'owners', isPinned: false },
    31: { id: 31, name: 'Payroll', workspace: 7, access: 'owners', isPinned: false },
    32: { id: 32, name: 'Timesheet', workspace: 8, access: 'viewers', isPinned: false },
    33: { id: 33, name: 'Expense Report', workspace: 8, access: 'viewers', isPinned: false },
    34: { id: 34, name: 'Lightweight CRM', workspace: 9, access: 'viewers', isPinned: true }
  };

  private _users = new Map<string, FullUser | null>([
    ['santa', { id: 1, email: 'santa@getgrist.com', name: 'Santa' }],
    ['anon', { id: 17, email: 'anon@getgrist.com', name: 'Anonymous', anonymous: true }],
    ['null', null],
  ]);

  public async getSessionActive(): Promise<ActiveSessionInfo> {
    const u = this._users.get(this.activeUser);
    if (!u) { throw new ApiError("No such user", 403); }
    const domain = urlState().state.get().org;
    const orgIndex = domain ? Object.keys(this._orgs).find((i) => this._orgs[i].domain === domain) : 1;
    return {
      user: u, org: orgIndex ? orgEntryToOrg(this._orgs[orgIndex]) : null,
      orgError: orgIndex ? undefined : { error: "inaccessible org", status: 403 }
    };
  }

  public async setSessionActive(email: string): Promise<void> {
    // This is not an accurate simulation, in that it doesn't keep org-to-user mapping.
    this.activeUser = email.split(/@/)[0];
  }

  public async getSessionAll(): Promise<{ users: FullUser[], orgs: Organization[] }> {
    return { users: [this._users.get('santa')!], orgs: await this.getOrgs() };
  }

  public async getOrgs(): Promise<Organization[]> {
    return Object.keys(this._orgs).map(key => orgEntryToOrg(this._orgs[key]));
  }

  public async getWorkspace(workspaceId: number): Promise<Workspace> {
    const entry = this._workspaces[workspaceId];
    const org = await this.getOrg(entry.org);
    const workspace: Workspace = {
      id: entry.id,
      name: entry.name,
      org,
      orgDomain: org.domain ?? undefined,
      docs: [],
      access: entry.access,
      createdAt,
      updatedAt,
    };
    workspace.docs = entry.docs.map((docId: number) => ({
      id: String(docId),
      name: this._docs[docId].name,
      workspace,
      access: this._docs[docId].access,
      isPinned: this._docs[docId].isPinned,
      options: this._docs[docId].options,
      updatedAt: this._docs[docId].age && new Date(Date.now() - this._docs[docId].age! * 1000).toUTCString(),
    } as Partial<Document> as any));
    return workspace;
  }

  public async getOrg(orgId: number): Promise<Organization> {
    return orgEntryToOrg(this._orgs[orgId]);
  }

  public async getOrgWorkspaces(orgId: number): Promise<Workspace[]> {
    const entry = this._orgs[orgId];
    if (!entry) {
      throw new Error(`Mock getOrgWorkspaces(${orgId}) failed with 404: not found`);
    }
    return Promise.all(entry.workspaces.map(key => this.getWorkspace(key)));
  }

  public async getOrgUsageSummary(): Promise<OrgUsageSummary> {
    return createEmptyOrgUsageSummary();
  }

  public async getTemplates(): Promise<Workspace[]> {
    return this.getOrgWorkspaces(TEMPLATES_ORG_ID);
  }

  public async getTemplate(docId: string): Promise<Document> {
    throw new Error('not implemented');
  }

  public async getDoc(docId: string): Promise<Document> {
    return this._docs[docId] as any;
  }

  public async newOrg(props: any): Promise<number> {
    const { domain, name } = props;
    const id = this._nextOrgId;
    this._orgs[id] = { id, name, domain: domain || null, workspaces: [], access: 'owners' };
    this._nextOrgId += 1;
    return id;
  }

  public async newWorkspace(props: any, orgId: number): Promise<number> {
    const { name } = props;
    const id = this._nextWorkspaceId;
    this._workspaces[id] = {
      id,
      name,
      org: orgId,
      docs: [],
      access: 'owners'
    };
    this._orgs[orgId].workspaces.push(id);
    this._nextWorkspaceId += 1;
    return id;
  }

  public async newDoc(props: any, workspaceId: number): Promise<string> {
    const { name } = props;
    const id = this._nextDocId;
    this._docs[id] = { id, name, workspace: workspaceId, access: 'owners', isPinned: false };
    this._workspaces[workspaceId].docs.push(id);
    this._nextDocId += 1;
    return String(id);
  }

  public async newUnsavedDoc(): Promise<string> {
    return 'new~doc';
  }

  public async importUnsavedDoc(material: any, options?: any): Promise<string> {
    return 'new~doc';
  }

  public async importDocToWorkspace(uploadId: number, workspaceId: number): Promise<DocCreationInfo> {
    throw new Error("Mock of importDocToWorkspace not yet implemented");
  }

  public async renameOrg(orgId: number, name: string): Promise<void> {
    this._orgs[orgId].name = name;
  }

  public async renameWorkspace(workspaceId: number, name: string): Promise<void> {
    this._workspaces[workspaceId].name = name;
  }

  public async renameDoc(docId: string, name: string, options?: RenameDocOptions): Promise<void> {
    this._docs[docId].name = name;
    if (options) {
      this._docs[docId].options = {appearance: options};
    }
  }

  public async updateDoc(docId: string, props: Partial<DocumentProperties>): Promise<void> {
    if (props.name) { this._docs[docId].name = props.name; }
  }

  public async updateOrg(ordId: any, props: Partial<OrganizationProperties>): Promise<void> {
    return Promise.resolve();
  }

  public async deleteOrg(orgId: number): Promise<void> {
    for (const workspaceId of this._orgs[orgId].workspaces) {
      await this.deleteWorkspace(workspaceId);
    }
    delete this._orgs[orgId];
  }

  public async deleteWorkspace(workspaceId: number): Promise<void> {
    const entry = this._workspaces[workspaceId];
    for (const docId of entry.docs) {
      await this.deleteDoc(String(docId));
    }
    arrayRemove(this._orgs[entry.org].workspaces, workspaceId);
    delete this._workspaces[workspaceId];
  }

  public async softDeleteWorkspace(workspaceId: number): Promise<void> {
    return this.deleteWorkspace(workspaceId);
  }

  public async undeleteWorkspace(workspaceId: number): Promise<void> {
    throw new Error('not implemented');
  }

  public async deleteDoc(docId: string): Promise<void> {
    arrayRemove(this._workspaces[this._docs[docId].workspace].docs, parseInt(docId, 10));
    delete this._docs[docId];
  }

  public async softDeleteDoc(docId: string): Promise<void> {
    return this.deleteDoc(docId);
  }

  public async undeleteDoc(docId: string): Promise<void> {
    throw new Error('not implemented');
  }

  public async disableDoc(docId: string): Promise<void> {
    return this.deleteDoc(docId);
  }

  public async enableDoc(docId: string): Promise<void> {
    throw new Error('not implemented');
  }

  public async updateOrgPermissions(orgId: number, delta: PermissionDelta): Promise<void> {
    // TODO: Implement as mock
  }

  public async updateWorkspacePermissions(workspaceId: number, delta: PermissionDelta): Promise<void> {
    // TODO: Implement as mock
  }

  public async updateDocPermissions(docId: string, delta: PermissionDelta): Promise<void> {
    // TODO: Implement as mock
  }

  public async getOrgAccess(orgId: number): Promise<PermissionData> {
    // TODO: Implement as mock
    return {
      users: []
    };
  }

  public async getWorkspaceAccess(workspaceId: number): Promise<PermissionData> {
    // TODO: Implement as mock
    return {
      maxInheritedRole: null,
      users: []
    };
  }


  public async getDocAccess(docId: string): Promise<PermissionData> {
    // TODO: Implement as mock
    return {
      maxInheritedRole: null,
      users: []
    };
  }

  public async pinDoc(docId: string): Promise<void> {
    this._docs[docId].isPinned = true;
  }

  public async unpinDoc(docId: string): Promise<void> {
    this._docs[docId].isPinned = false;
  }

  public async moveDoc(docId: string, workspaceId: number): Promise<void> {
    const docIdNum = parseInt(docId, 10);
    const doc = this._docs[docId];
    const startWorkspaceDocs = this._workspaces[doc.workspace].docs;
    const index = startWorkspaceDocs.findIndex(_docId => _docId === docIdNum);
    startWorkspaceDocs.splice(index, 1);
    this._workspaces[workspaceId].docs.push(docIdNum);
  }

  public async getUserProfile(): Promise<FullUser> {
    const u = this._users.get(this.activeUser);
    if (!u) { throw new ApiError("No such user", 403); }
    return u;
  }

  public async login(): Promise<void> {
    window.location.href = window.location.origin;
  }

  public async logout(): Promise<void> {
    window.location.href = window.location.origin;
  }

  public async getWorker(): Promise<string> {
    return "/";
  }

  public async getWorkerFull() {
    return {
      selfPrefix: '/',
      docWorkerUrl: null,
      docWorkerId: null,
    };
  }

  public async getWorkerAPI(key: string): Promise<DocWorkerAPI> {
    return this;
  }

  public getBillingAPI(): BillingAPI {
    throw new Error('billing api not implemented');
  }

  public getDocAPI(): DocAPI {
    // Return a mock implementation of DocAPI, just adding
    // methods as needed.
    const api: Partial<DocAPI> = {
      async getAttachmentTransferStatus() {
        return {
          status: {
            pendingTransferCount: 0,
            isRunning: false,
            failures: 0,
            successes: 0,
          },
          locationSummary: 'internal',
        };
      },
      getDownloadUrl() {
        return '/mock/download/url';
      },
    };
    return api as DocAPI;
  }

  public fetchApiKey(): Promise<string> {
    return Promise.resolve('');
  }

  public createApiKey(): Promise<string> {
    const apiKeys = [
      '9204c0f1ea5928b31e4e21e55cf975e874281d8e',
      'e03ab513535137a7ec60978b40c9a896db6d8706'];
    return Promise.resolve(apiKeys[++keyIndex % 2]);
  }

  public deleteApiKey(): Promise<void> {
    return Promise.resolve();
  }

  public getTable(docId: string, tableName: string): Promise<TableColValues> {
    // TODO implements as mock
    return Promise.resolve({ id: [] });
  }

  public applyUserActions(docId: string, actions: UserAction[]): Promise<ApplyUAResult> {
    return Promise.resolve({ id: [] }) as any;
  }

  public async upload(material: any, filename?: string): Promise<number> {
    return 0;
  }

  public async downloadDoc(docId: string): Promise<any> {
    return null;
  }

  public async copyDoc(docId: string): Promise<any> {
    return null;
  }

  public async updateUserName(name: string): Promise<void> {
    // do nothing
  }

  public async updateUserLocale(locale: string): Promise<void> {
    // do nothing
  }

  public async updateAllowGoogleLogin(allowGoogleLogin: boolean): Promise<void> {
    // do nothing
  }

  public async updateIsConsultant(): Promise<void> {
    // do nothing
  }

  public async disableUser(userId: number): Promise<void> {
    // do nothing
  }

  public async enableUser(userId: number): Promise<void> {
    // do nothing
  }

  public async deleteUser(userId: number, name: string): Promise<void> {
    // do nothing
  }

  public getBaseUrl() {
    return 'http://localhost';
  }

  public forRemoved(): UserAPI {
    throw new Error('not implemented');
  }

  public getGoogleAuthEndpoint(scope?: string | undefined): string {
    throw new Error("not implemented");
  }

  public async getWidgets(): Promise<ICustomWidget[]> {
    return [];
  }

  public async closeAccount(userId: number): Promise<boolean> {
    throw new Error('Method not implemented.');
  }

  public async closeOrg(): Promise<void> {
    throw new Error('Method not implemented.');
  }

  public formUrl(): string {
    return "";
  }
}
