import {MinimalWebSocket} from 'app/common/MinimalWebSocket';

export class MegaDataEngine {
  public static maybeCreate(dbPath: string, engine?: string): MegaDataEngine|null { return null; }

  public serve(socket: MinimalWebSocket): void {}
}
