import {MinimalWebSocket} from 'app/common/MinimalWebSocket';
import {ProcessedActionBundle} from 'app/common/AlternateActions';
import {UserAction} from 'app/common/DocActions';
import {DocData} from 'app/common/DocData';

export abstract class MegaDataEngine {
  public static maybeCreate(dbPath: string, docData: DocData): MegaDataEngine|null { return null; }
  public abstract applyUserActions(actions: UserAction[]): Promise<ProcessedActionBundle>;
  public abstract serve(socket: MinimalWebSocket): void;
}
