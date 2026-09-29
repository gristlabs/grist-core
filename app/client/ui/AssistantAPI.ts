import { DeveloperPromptVersion } from "app/common/Assistance";
import { BaseAPI, IOptions } from "app/common/BaseAPI";
import { addCurrentOrgToPath } from "app/common/urlUtils";

interface AssistantStartRequest {
  prompt: string;
  srcDocId?: string;
  workspaceId?: number;
  developerPromptVersion?: DeveloperPromptVersion;
}

interface AssistantStartResponse {
  redirectUrl: string;
}

export class AssistantAPIImpl extends BaseAPI {
  constructor(private _homeUrl: string, options: IOptions = {}) {
    super(options);
  }

  public start(body: AssistantStartRequest): Promise<AssistantStartResponse> {
    return this.requestJson(`${this._url}/api/assistant/start`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  private get _url(): string {
    return addCurrentOrgToPath(this._homeUrl);
  }
}
