import { localStorageJsonObs } from "app/client/lib/localStorageObs";
import { getGristConfig } from "app/common/urlUtils";

import { Observable } from "grainjs";

let _PERMITTED_CUSTOM_WIDGETS: Observable<string[]> | undefined;

export function PERMITTED_CUSTOM_WIDGETS(): Observable<string[]> {
  if (!_PERMITTED_CUSTOM_WIDGETS) {
    _PERMITTED_CUSTOM_WIDGETS =
      localStorageJsonObs("PERMITTED_CUSTOM_WIDGETS", getGristConfig().permittedCustomWidgets || []);
  }
  return _PERMITTED_CUSTOM_WIDGETS;
}
