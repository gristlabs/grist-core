import { buildMainBillingPage } from "app/client/ui/BillingPage";
import { createAppPage } from "app/client/ui/createAppPage";

createAppPage(appModel => buildMainBillingPage(appModel));
