import {GristDeploymentType} from 'app/common/gristUrls';
import {getCoreLoginSystem} from 'app/server/lib/coreLogins';
import {getThemeBackgroundSnippet} from 'app/common/Themes';
import {Document} from 'app/gen-server/entity/Document';
import {HomeDBManager} from 'app/gen-server/lib/homedb/HomeDBManager';
import {IAttachmentStore} from 'app/server/lib/AttachmentStore';
import {DocStorageManager} from 'app/server/lib/DocStorageManager';
import {ExternalStorage, ExternalStorageCreator} from 'app/server/lib/ExternalStorage';
import {createDummyTelemetry, GristLoginSystem, GristServer} from 'app/server/lib/GristServer';
import {HostedStorageManager} from 'app/server/lib/HostedStorageManager';
import {createNullAuditLogger, IAuditLogger} from 'app/server/lib/IAuditLogger';
import {EmptyBilling, IBilling} from 'app/server/lib/IBilling';
import {IDocStorageManager} from 'app/server/lib/IDocStorageManager';
import {EmptyNotifier, INotifier} from 'app/server/lib/INotifier';
import {InstallAdmin, SimpleInstallAdmin} from 'app/server/lib/InstallAdmin';
import {ISandbox, ISandboxCreationOptions} from 'app/server/lib/ISandbox';
import {createSandbox, SpawnFn} from 'app/server/lib/NSandbox';
import {SqliteVariant} from 'app/server/lib/SqliteCommon';
import {ITelemetry} from 'app/server/lib/Telemetry';
import {Express} from 'express';

// In the past, the session secret was used as an additional
// protection passed on to expressjs-session for security when
// generating session IDs, in order to make them less guessable.
// Quoting the upstream documentation,
//
//     Using a secret that cannot be guessed will reduce the ability
//     to hijack a session to only guessing the session ID (as
//     determined by the genid option).
//
//   https://expressjs.com/en/resources/middleware/session.html
//
// However, since this change,
//
//   https://github.com/gristlabs/grist-core/commit/24ce54b586e20a260376a9e3d5b6774e3fa2b8b8#diff-d34f5357f09d96e1c2ba63495da16aad7bc4c01e7925ab1e96946eacd1edb094R121-R124
//
// session IDs are now completely randomly generated in a cryptographically
// secure way, so there is no danger of session IDs being guessable.
// This makes the value of the session secret less important. The only
// concern is that changing the secret will invalidate existing
// sessions and force users to log in again.
export const DEFAULT_SESSION_SECRET =
  'Phoo2ag1jaiz6Moo2Iese2xoaphahbai3oNg7diemohlah0ohtae9iengafieS2Hae7quungoCi9iaPh';

export interface ICreate {
  // Create a space to store files externally, for storing either:
  //  - documents. This store should be versioned, and can be eventually consistent.
  //  - meta. This store need not be versioned, and can be eventually consistent.
  // For test purposes an extra prefix may be supplied.  Stores with different prefixes
  // should not interfere with each other.
  ExternalStorage: ExternalStorageCreator;

  // Creates a IDocStorageManager for storing documents on the local machine.
  createLocalDocStorageManager(
    ...args: ConstructorParameters<typeof DocStorageManager>
  ): Promise<IDocStorageManager>;

  // Creates a IDocStorageManager for storing documents on an external storage (e.g S3)
  createHostedDocStorageManager(
    ...args: ConstructorParameters<typeof HostedStorageManager>
  ): Promise<IDocStorageManager>;

  Billing(dbManager: HomeDBManager, gristConfig: GristServer): IBilling;
  Notifier(dbManager: HomeDBManager, gristConfig: GristServer): INotifier;
  AuditLogger(dbManager: HomeDBManager, gristConfig: GristServer): IAuditLogger;
  Telemetry(dbManager: HomeDBManager, gristConfig: GristServer): ITelemetry;

  NSandbox(options: ISandboxCreationOptions): ISandbox;

  // Create the logic to determine which users are authorized to manage this Grist installation.
  createInstallAdmin(dbManager: HomeDBManager): Promise<InstallAdmin>;

  deploymentType(): GristDeploymentType;
  sessionSecret(): string;
  // Check configuration of the app early enough to show on startup.
  configure?(): Promise<void>;
  // Optionally perform sanity checks on the configured storage, throwing a fatal error if it is not functional
  checkBackend?(): Promise<void>;
  // Return a string containing 1 or more HTML tags to insert into the head element of every
  // static page.
  getExtraHeadHtml?(): string;
  getStorageOptions?(name: string): ICreateStorageOptions|undefined;
  getAttachmentStoreOptions(): {[key: string]: ICreateAttachmentStoreOptions | undefined};
  getSqliteVariant?(): SqliteVariant;
  getSandboxVariants?(): Record<string, SpawnFn>;

  getLoginSystem(): Promise<GristLoginSystem>;

  addExtraHomeEndpoints(gristServer: GristServer, app: Express): void;
}

export interface ICreateActiveDocOptions {
  safeMode?: boolean;
  docUrl?: string;
  docApiUrl?: string;
  doc?: Document;
}

export interface ICreateStorageOptions {
  name: string;
  check(): boolean;
  checkBackend?(): Promise<void>;
  create(purpose: 'doc'|'meta'|'attachments', extraPrefix: string): ExternalStorage|undefined;
}

export interface ICreateAttachmentStoreOptions {
  name: string;
  isAvailable(): Promise<boolean>;
  create(storeId: string): Promise<IAttachmentStore>;
}

/**
 * This class provides a `create` object that defines various core
 * aspects of a Grist installation, such as what kind of billing or
 * sandbox to use, if any.
 *
 * The intended use of this class is to initialise Grist with
 * different settings and providers, to facilitate different editions
 * such as standard, enterprise or cloud-hosted.
 */
export class BaseCreate implements ICreate {
  constructor(
    private readonly _deploymentType: GristDeploymentType,
    private _storage: ICreateStorageOptions[] = []
  ) {}

  public deploymentType(): GristDeploymentType { return this._deploymentType; }
  public Billing(dbManager: HomeDBManager, gristConfig: GristServer): IBilling {
    return new EmptyBilling();
  }
  public Notifier(dbManager: HomeDBManager, gristConfig: GristServer): INotifier {
    return EmptyNotifier;
  }
  public ExternalStorage(...[purpose, extraPrefix]: Parameters<ExternalStorageCreator>): ExternalStorage|undefined {
    for (const s of this._storage) {
      if (s.check()) {
        return s.create(purpose, extraPrefix);
      }
    }
    return undefined;
  }
  public AuditLogger(dbManager: HomeDBManager, gristConfig: GristServer) {
    return createNullAuditLogger();
  }
  public Telemetry(dbManager: HomeDBManager, gristConfig: GristServer): ITelemetry {
    return createDummyTelemetry();
  }
  public NSandbox(options: ISandboxCreationOptions): ISandbox {
    return createSandbox('unsandboxed', options);
  }
  public sessionSecret(): string {
    return process.env.GRIST_SESSION_SECRET || DEFAULT_SESSION_SECRET;
  }
  public async configure() {
    for (const s of this._storage) {
      if (s.check()) {
        break;
      }
    }
  }
  public async checkBackend() {
    for (const s of this._storage) {
      if (s.check()) {
        await s.checkBackend?.();
        break;
      }
    }
  }
  public getExtraHeadHtml() {
    const elements: string[] = [];
    if (process.env.APP_STATIC_INCLUDE_CUSTOM_CSS === 'true') {
      elements.push('<link rel="stylesheet" href="custom.css">');
    }
    elements.push(getThemeBackgroundSnippet());
    return elements.join('\n');
  }
  public getStorageOptions(name: string) {
    return this._storage.find(s => s.name === name);
  }
  public getAttachmentStoreOptions() {
    return {};
  }
  public async createInstallAdmin(dbManager: HomeDBManager): Promise<InstallAdmin> {
    return new SimpleInstallAdmin(dbManager);
  }
  public getLoginSystem(): Promise<GristLoginSystem> {
    return getCoreLoginSystem();
  }
  public async createLocalDocStorageManager(...args: ConstructorParameters<typeof DocStorageManager>) {
    return new DocStorageManager(...args);
  }
  public async createHostedDocStorageManager(...args: ConstructorParameters<typeof HostedStorageManager>) {
    return new HostedStorageManager(...args);
  }
  public addExtraHomeEndpoints(gristServer: GristServer, app: Express) {}
}
