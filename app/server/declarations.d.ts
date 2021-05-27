declare module "app/server/lib/ActionLog";
declare module "app/server/lib/sandboxUtil";
declare module "app/server/lib/User";

declare module "app/server/lib/Comm" {
  import {Client, ClientMethod} from "app/server/lib/Client";
  import {LoginSession} from "app/server/lib/LoginSession";
  import * as http from "http";

  class Comm {
    constructor(server: http.Server, options: any);
    public broadcastMessage(type: string, messageData: any): void;
    public destroyAllClients(): void;
    public setServerVersion(serverVersion: string|null): void;
    public setServerActivation(active: boolean): void;
    public getSessionIdFromCookie(gristSidCookie: string): string;
    public getOrCreateSession(sessionId: string, req: any): LoginSession;
    public registerMethods(methods: {[name: string]: ClientMethod}): void;
    public getClient(clientId: string): Client;
    public testServerShutdown(): Promise<void>;
    public testServerRestart(): Promise<void>;
    public testSetClientPersistence(ttlMs: number): void;
  }
  namespace Comm {
    function sendDocMessage(client: Client, docFD: number, type: string, mesageData: any, fromSelf: boolean): void;
  }
  export = Comm;
}

declare module "app/server/lib/shutdown" {
  export function addCleanupHandler<T>(context: T, method: (this: T) => void, timeout?: number, name?: string): void;
  export function removeCleanupHandlers<T>(context: T): void;
  export function cleanupOnSignals(...signalNames: string[]): void;
  export function exit(optExitCode?: number): void;
}

// There is a @types/bluebird, but it's not great, and breaks for some of our usages.
declare module "bluebird";

// Redlock types refer to bluebird.Disposer.
declare module "bluebird" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  class Disposer<T> {}
}

// TODO This is a module by Grist Labs; we should add index.d.ts to it.
declare module "@gristlabs/basket-api" {
  interface Item { [colId: string]: any; }
  interface ColValues { [colId: string]: any[]; }
  interface AuthToken { [authProvider: string]: string; }

  class Basket {
    public static addBasket(login: AuthToken): Promise<string>;
    public static getBaskets(login: AuthToken): Promise<string[]>;

    public basketId: Readonly<string>;
    public apiKey: Readonly<string|undefined>;

    constructor(basketId: string, apiKey?: string);
    public addTable(optTableId: string): Promise<string>;
    public getTable(tableId: string): Promise<Item[]>;
    public renameTable(oldTableId: string, newTableId: string): Promise<void>;
    public replaceTableData(tableId: string, columnValues: ColValues): Promise<void>;
    public deleteTable(tableId: string): Promise<void>;
    public getTables(): Promise<string[]>;
    public uploadAttachment(attachmentId: string, attachment: Buffer): Promise<void>;
    public delete(login: AuthToken): Promise<void>;
  }
  namespace Basket {}
  export = Basket;
}

// Used in one place, and the typings are almost entirely unhelpful.
declare module "multiparty";

// Used in one place, for one call.
declare module "chokidar";

// Used in one place
declare module "mime-types";

// Used in one place
declare module "morgan";
declare module "cookie";
declare module "cookie-parser";
declare module "@gristlabs/express-session";

// Used for command line path tweaks.
declare module "app-module-path" {
  export function addPath(path: string): void;
}

// Used in tests
declare module "ws";

// version of pidusage that has correct ctime on linux
declare module '@gristlabs/pidusage' {
  import * as pidusage from 'pidusage';
  export = pidusage;
}

declare module "csv";
