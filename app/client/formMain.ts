import { holdLtr } from "app/client/lib/direction";
import { createPage } from "app/client/ui/createPage";
import { FormPage } from "app/client/ui/FormPage";

import { dom } from "grainjs";

createPage(() => {
  document.documentElement.setAttribute("data-grist-form", "");
  // A published form stands outside the frame of the app, and cannot yet be laid out either way.
  dom.update(document.body, holdLtr());
  return dom.create(FormPage);
}, { disableTheme: true });
