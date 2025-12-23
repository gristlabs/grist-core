import { attachCssRootVars } from "app/client/ui2018/cssVars";
import { attachDefaultLightTheme } from "app/client/ui2018/theme";

export function initGristStyles() {
  attachCssRootVars("grist");
  attachDefaultLightTheme();
}
