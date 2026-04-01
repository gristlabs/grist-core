import { getMainOrgUrl } from "app/client/models/gristUrlState";
import { BaseAPI } from "app/common/BaseAPI";
import { VerifyBootKeyResponse } from "app/common/BootAPI";

export class BootAPI extends BaseAPI {
  private _baseUrl = getMainOrgUrl().replace(/\/$/, "") + "/boot";

  public verifyBootKey(bootKey: string): Promise<VerifyBootKeyResponse> {
    return this.requestJson(`${this._baseUrl}/verify-boot-key`, {
      method: "POST",
      body: JSON.stringify({
        bootKey,
      }),
    });
  }

  public async logIn(bootKey: string, adminEmail?: string): Promise<void> {
    await this.request(`${this._baseUrl}/login`, {
      method: "POST",
      body: JSON.stringify({
        bootKey,
        adminEmail,
      }),
    });
  }
}
