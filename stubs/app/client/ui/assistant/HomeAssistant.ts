import { HomeModel } from "app/client/models/HomeModel";

import { DomContents, IDisposableOwner } from "grainjs";

export function hasHomeAssistantComposer(): boolean {
  return false;
}

export function buildHomeAssistantComposer(
  _owner: IDisposableOwner,
  _opts: { homeModel: HomeModel; showIntro: boolean },
): DomContents {
  return null;
}
