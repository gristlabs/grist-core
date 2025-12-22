import { createPage } from "app/client/ui/createPage";
import { FormPage } from "app/client/ui/FormPage";

import { dom } from "grainjs";

createPage(() => {
  document.documentElement.setAttribute("data-grist-form", "");
  return dom.create(FormPage);
}, { disableTheme: true });
