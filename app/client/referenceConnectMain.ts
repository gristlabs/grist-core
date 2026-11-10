import { setupLocale } from "app/client/lib/localization";
import { createPage } from "app/client/ui/createPage";
import { ReferenceConnectionPage } from "app/client/ui/ReferenceConnectionPage";

import { dom } from "grainjs";

void setupLocale().then(() => createPage(() => dom.create(ReferenceConnectionPage),
  { disableTheme: true, localeReady: true }));
