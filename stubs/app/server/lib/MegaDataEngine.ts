import {MinimalWebSocket} from 'app/common/MinimalWebSocket';
import {DocData} from 'app/common/DocData';

export class MegaDataEngine {
  public static maybeCreate(dbPath: string, docData: DocData): MegaDataEngine|null { return null; }

  public serve(socket: MinimalWebSocket): void {}
}
