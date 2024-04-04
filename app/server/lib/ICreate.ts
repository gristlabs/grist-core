import {GristDeploymentType} from 'app/common/gristUrls';
import {getThemeBackgroundSnippet} from 'app/common/Themes';
import {Document} from 'app/gen-server/entity/Document';
import {HomeDBManager} from 'app/gen-server/lib/HomeDBManager';
import {ExternalStorage} from 'app/server/lib/ExternalStorage';
import {createDummyTelemetry, GristServer} from 'app/server/lib/GristServer';
import {IBilling} from 'app/server/lib/IBilling';
import {INotifier} from 'app/server/lib/INotifier';
import {InstallAdmin, SimpleInstallAdmin} from 'app/server/lib/InstallAdmin';
import {ISandbox, ISandboxCreationOptions} from 'app/server/lib/ISandbox';
import {IShell} from 'app/server/lib/IShell';
import {createSandbox, SpawnFn} from 'app/server/lib/NSandbox';
import {SqliteVariant} from 'app/server/lib/SqliteCommon';
import {ITelemetry} from 'app/server/lib/Telemetry';

export interface ICreate {

  Billing(dbManager: HomeDBManager, gristConfig: GristServer): IBilling;
  Notifier(dbManager: HomeDBManager, gristConfig: GristServer): INotifier;
  Telemetry(dbManager: HomeDBManager, gristConfig: GristServer): ITelemetry;
  Shell?(): IShell;  // relevant to electron version of Grist only.

  // Create a space to store files externally, for storing either:
  //  - documents. This store should be versioned, and can be eventually consistent.
  //  - meta. This store need not be versioned, and can be eventually consistent.
  // For test purposes an extra prefix may be supplied.  Stores with different prefixes
  // should not interfere with each other.
  ExternalStorage(purpose: 'doc' | 'meta', testExtraPrefix: string): ExternalStorage | undefined;

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
  getSqliteVariant?(): SqliteVariant;
  getSandboxVariants?(): Record<string, SpawnFn>;
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
  create(purpose: 'doc'|'meta', extraPrefix: string): ExternalStorage|undefined;
}

export interface ICreateNotifierOptions {
  create(dbManager: HomeDBManager, gristConfig: GristServer): INotifier|undefined;
}

export interface ICreateBillingOptions {
  create(dbManager: HomeDBManager, gristConfig: GristServer): IBilling|undefined;
}

export interface ICreateTelemetryOptions {
  create(dbManager: HomeDBManager, gristConfig: GristServer): ITelemetry|undefined;
}

export function makeSimpleCreator(opts: {
  deploymentType: GristDeploymentType,
  sessionSecret?: string,
  storage?: ICreateStorageOptions[],
  billing?: ICreateBillingOptions,
  notifier?: ICreateNotifierOptions,
  telemetry?: ICreateTelemetryOptions,
  sandboxFlavor?: string,
  shell?: IShell,
  getExtraHeadHtml?: () => string,
  getSqliteVariant?: () => SqliteVariant,
  getSandboxVariants?: () => Record<string, SpawnFn>,
  createInstallAdmin?: (dbManager: HomeDBManager) => Promise<InstallAdmin>,
}): ICreate {
  const {deploymentType, sessionSecret, storage, notifier, billing, telemetry} = opts;
  return {
    deploymentType() { return deploymentType; },
    Billing(dbManager, gristConfig) {
      return billing?.create(dbManager, gristConfig) ?? {
        addEndpoints() { /* do nothing */ },
        addEventHandlers() { /* do nothing */ },
        addWebhooks() { /* do nothing */ },
        async addMiddleware() { /* do nothing */ },
        addPages() { /* do nothing */ },
      };
    },
    Notifier(dbManager, gristConfig) {
      return notifier?.create(dbManager, gristConfig) ?? {
        get testPending() { return false; },
        async deleteUser()      { /* do nothing */ },
        testSetSendMessageCallback() { return undefined; },
      };
    },
    ExternalStorage(purpose, extraPrefix) {
      for (const s of storage || []) {
        if (s.check()) {
          return s.create(purpose, extraPrefix);
        }
      }
      return undefined;
    },
    Telemetry(dbManager, gristConfig) {
      return telemetry?.create(dbManager, gristConfig) ?? createDummyTelemetry();
    },
    NSandbox(options) {
      return createSandbox(opts.sandboxFlavor || 'unsandboxed', options);
    },
    sessionSecret() {
      const secret = process.env.GRIST_SESSION_SECRET || sessionSecret;
      if (!secret) {
        throw new Error('need GRIST_SESSION_SECRET');
      }
      return secret;
    },
    async configure() {
      for (const s of storage || []) {
        if (s.check()) {
          break;
        }
      }
    },
    async checkBackend() {
      for (const s of storage || []) {
        if (s.check()) {
          await s.checkBackend?.();
          break;
        }
      }
    },
    ...(opts.shell && {
      Shell() {
        return opts.shell as IShell;
      },
    }),
    getExtraHeadHtml() {
      if (opts.getExtraHeadHtml) {
        return opts.getExtraHeadHtml();
      }
      const elements: string[] = [];
      if (process.env.APP_STATIC_INCLUDE_CUSTOM_CSS === 'true') {
        elements.push('<link rel="stylesheet" href="custom.css">');
      }
      elements.push(getThemeBackgroundSnippet());
      return elements.join('\n');
    },
    getStorageOptions(name: string) {
      return storage?.find(s => s.name === name);
    },
    getSqliteVariant: opts.getSqliteVariant,
    getSandboxVariants: opts.getSandboxVariants,
    createInstallAdmin: opts.createInstallAdmin || (async () => new SimpleInstallAdmin()),
  };
}
