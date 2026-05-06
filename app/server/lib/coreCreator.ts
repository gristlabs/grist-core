import { HomeDBManager } from "app/gen-server/lib/homedb/HomeDBManager";
import {
  checkFilesystemExternalStorage,
  configureFilesystemExternalStorage,
} from "app/server/lib/configureFilesystemExternalStorage";
import {
  checkMinIOBucket,
  checkMinIOExternalStorage,
  configureMinIOExternalStorage,
} from "app/server/lib/configureMinIOExternalStorage";
import { configureOpenAIAssistantV1 } from "app/server/lib/configureOpenAIAssistantV1";
import { GristServer } from "app/server/lib/GristServer";
import { BaseCreate, ICreateStorageOptions } from "app/server/lib/ICreate";
import { Telemetry } from "app/server/lib/Telemetry";

export class CoreCreate extends BaseCreate {
  constructor() {
    const storage: ICreateStorageOptions[] = [
      {
        name: "minio",
        check: () => checkMinIOExternalStorage() !== undefined,
        checkBackend: () => checkMinIOBucket(),
        create: configureMinIOExternalStorage,
      },
      // filesystem is last so a real backend takes precedence if both are configured.
      {
        name: "filesystem",
        check: () => checkFilesystemExternalStorage() !== undefined,
        create: configureFilesystemExternalStorage,
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
