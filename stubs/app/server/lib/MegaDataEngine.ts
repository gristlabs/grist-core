import {MinimalWebSocket} from 'app/common/MinimalWebSocket';
import {ProcessedActionBundle} from 'app/common/AlternateActions';
import {UserAction} from 'app/common/DocActions';
import {DocData} from 'app/common/DocData';
import {OptDocSession} from 'app/server/lib/DocSession';

export abstract class MegaDataEngine {
  public static maybeCreate(dbPath: string, docData: DocData): MegaDataEngine|null { return null; }
  public static maybeMakeChannel(socket: MinimalWebSocket): MegaDataEngine.Channel|null { return null; }
  public abstract applyUserActions(docSession: OptDocSession|null, actions: UserAction[]): Promise<ProcessedActionBundle>;
  public abstract serve(channel: MegaDataEngine.Channel): void;
}

export namespace MegaDataEngine {
  declare const channel: unique symbol;
  export type Channel = typeof channel;
}
