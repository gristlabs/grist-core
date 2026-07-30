import { HomeDBManager } from "app/gen-server/lib/homedb/HomeDBManager";
import { getFilesystemStorageOption } from "app/server/lib/configureFilesystemExternalStorage";
import { getMinIOStorageOption } from "app/server/lib/configureMinIOExternalStorage";
import { configureOpenAIAssistantV1 } from "app/server/lib/configureOpenAIAssistantV1";
import { GristServer } from "app/server/lib/GristServer";
import { BaseCreate, ICreateStorageOptions } from "app/server/lib/ICreate";
import { Telemetry } from "app/server/lib/Telemetry";

export function createCoreStorageOptions(): ICreateStorageOptions[] {
  return [
    getMinIOStorageOption(),
    // filesystem is last so a real backend takes precedence if both are configured.
    getFilesystemStorageOption(),
  ];
}

export class CoreCreate extends BaseCreate {
  constructor() {
    super("core", createCoreStorageOptions());
  }

  public override Telemetry(dbManager: HomeDBManager, gristServer: GristServer) {
    return new Telemetry(dbManager, gristServer);
  }

  public override Assistant() {
    return configureOpenAIAssistantV1();
  }
}
