import { DocAction } from 'app/common/DocActions';
import { DocData } from 'app/common/DocData';
import { SchemaTypes } from 'app/common/schema';
import { FlexServer } from 'app/server/lib/FlexServer';
import axios from 'axios';
import pick = require('lodash/pick');
import {GristClientSocket} from 'app/client/components/GristClientSocket';

interface GristRequest {
  reqId: number;
  method: string;
  args: any[];
}

interface GristResponse {
  reqId: number;
  error?: string;
  errorCode?: string;
  data?: any;
}

interface GristMessage {
  type: 'clientConnect' | 'docUserAction';
  docFD: number;
  data: any;
}

export class GristClient {
  public messages: GristMessage[] = [];

  private _requestId: number = 0;
  private _pending: Array<GristResponse|GristMessage> = [];
  private _docData?: DocData;  // accumulate tabular info like a real client.
  private _consumer: () => void;
  private _ignoreTrivialActions: boolean = false;

  constructor(public ws: GristClientSocket) {
    ws.onmessage = (data: string) => {
      const msg = pick(JSON.parse(data),
                       ['reqId', 'error', 'errorCode', 'data', 'type', 'docFD']);
      if (this._ignoreTrivialActions && msg.type === 'docUserAction' &&
          msg.data?.actionGroup?.internal === true &&
          msg.data?.docActions?.length === 0) {
        return;
      }
      this._pending.push(msg);
      if (msg.data?.doc) {
        this._docData = new DocData(() => {
          throw new Error('no fetches');
        }, msg.data.doc);
      }
      if (this._docData && msg.type === 'docUserAction') {
        const docActions = msg.data?.docActions || [];
        for (const docAction of docActions) {
          this._docData.receiveAction(docAction);
        }
      }
      if (this._consumer) { this._consumer(); }
    };
  }

  // After a document is opened, the sandbox recomputes its formulas and sends any changes.
  // The client will receive an update even if there are no changes. This may be useful in
  // the future to know that the document is up to date. But for testing, this asynchronous
  // message can be awkward. Call this method to ignore it.
  public ignoreTrivialActions() {
    this._ignoreTrivialActions = true;
  }

  public flush() {
    this._pending = [];
  }

  public shift() {
    return this._pending.shift();
  }

  public count() {
    return this._pending.length;
  }

  public get docData() {
    if (!this._docData) { throw new Error('no DocData'); }
    return this._docData;
  }

  public getMetaRecords(tableId: keyof SchemaTypes) {
    return this.docData.getMetaTable(tableId).getRecords();
  }

  public async read(): Promise<any> {
    for (;;) {
      if (this._pending.length) {
        return this._pending.shift();
      }
      await new Promise<void>(resolve => this._consumer = resolve);
    }
  }

  public async readMessage(): Promise<GristMessage> {
    const result = await this.read();
    if (!result.type) {
      throw new Error(`message looks wrong: ${JSON.stringify(result)}`);
    }
    return result;
  }

  public async readResponse(): Promise<GristResponse> {
    this.messages = [];
    for (;;) {
      const result = await this.read();
      if (result.reqId === undefined) {
        this.messages.push(result);
        continue;
      }
      if (result.reqId !== this._requestId) {
        throw new Error("unexpected request id");
      }
      return result;
    }
  }

  public waitForServer() {
    // send an arbitrary failing message and wait for response.
    return this.send('ping');
  }

  // Helper to read the next docUserAction ignoring anything else (e.g. a duplicate clientConnect).
  public async readDocUserAction(): Promise<DocAction[]> {
    while (true) {    // eslint-disable-line no-constant-condition
      const msg = await this.readMessage();
      if (msg.type === 'docUserAction') {
        return msg.data.docActions;
      }
    }
  }

  public async send(method: string, ...args: any[]): Promise<GristResponse> {
    const p = this.readResponse();
    this._requestId++;
    const req: GristRequest = {
      reqId: this._requestId,
      method,
      args
    };
    this.ws.send(JSON.stringify(req));
    const result = await p;
    return result;
  }

  public async close() {
    this.ws.close();
  }

  public async openDocOnConnect(docId: string) {
    const msg = await this.readMessage();
    if (msg.type !== 'clientConnect') { throw new Error('expected clientConnect'); }
    const openDoc = await this.send('openDoc', docId);
    if (openDoc.error) { throw new Error('error in openDocOnConnect'); }
    return openDoc;
  }
}

export async function openClient(server: FlexServer, email: string, org: string,
                                 emailHeader?: string): Promise<GristClient> {
  const headers: Record<string, string> = {};
  if (!emailHeader) {
    const resp = await axios.get(`${server.getOwnUrl()}/test/session`);
    const cookie = resp.headers['set-cookie'][0];
    if (email !== 'anon@getgrist.com') {
      const cid = decodeURIComponent(cookie.split('=')[1].split(';')[0]);
      const comm = server.getComm();
      const sessionId = comm.getSessionIdFromCookie(cid)!;
      const scopedSession = comm.getOrCreateSession(sessionId, {org});
      const profile = { email, email_verified: true, name: "Someone" };
      await scopedSession.updateUserProfile({} as any, profile);
    }
    headers.Cookie = cookie;
  } else {
    headers[emailHeader] = email;
  }
  const ws = new GristClientSocket('ws://localhost:' + server.getOwnPort() + `/o/${org}`, {
    headers
  });
  const client = new GristClient(ws);
  await new Promise(function(resolve, reject) {
    ws.onopen = function() {
      ws.onerror = null;
      resolve(ws);
    };
    ws.onerror = function(err: Error) {
      ws.onopen = null;
      reject(err);
    };
  });
  return client;
}
