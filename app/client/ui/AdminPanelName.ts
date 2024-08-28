// Separated out into its own file because this is used in several modules, but we'd like to avoid
// pulling in the full AdminPanel into their bundle.

import {makeT} from 'app/client/lib/localization';

const t = makeT('AdminPanel');

// Translated "Admin Panel" name, made available to other modules.
export function getAdminPanelName() {
  return t("Admin Panel");
}
