import {
  checkMinIOBucket,
  checkMinIOExternalStorage,
  configureMinIOExternalStorage,
} from "app/server/lib/configureMinIOExternalStorage";
import { configureOpenAIAssistantV1 } from "app/server/lib/configureOpenAIAssistantV1";
import { BaseCreate, ICreateStorageOptions } from "app/server/lib/ICreate";
import { Telemetry } from "app/server/lib/Telemetry";
import { HomeDBManager } from "app/gen-server/lib/homedb/HomeDBManager";
import { GristServer } from "app/server/lib/GristServer";

export class CoreCreate extends BaseCreate {
  constructor() {
    const storage: ICreateStorageOptions[] = [
      {
        name: "minio",
        check: () => checkMinIOExternalStorage() !== undefined,
        checkBackend: () => checkMinIOBucket(),
        create: configureMinIOExternalStorage,
      },
    ];
    super("core", storage);
  }

  public override Telemetry(dbManager: HomeDBManager, gristServer: GristServer) {
    return new Telemetry(dbManager, gristServer);
  }

  public override Assistant() {
    return configureOpenAIAssistantV1();
  }
}
