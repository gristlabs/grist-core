import type { AppModel } from "app/client/models/AppModel";
import type { DomContents, IDisposableOwner } from "grainjs";

export class OAuthAppsUI {
  public static authorizedAppsPageContent(owner: IDisposableOwner, appModel: AppModel): DomContents { return null; }
  public static oauthAppsSection(owner: IDisposableOwner, appModel: AppModel): DomContents { return null; }
  public static developerPageOverride(
    owner: IDisposableOwner, appModel: AppModel, orig: () => DomContents,
  ): DomContents { return orig(); }
}
