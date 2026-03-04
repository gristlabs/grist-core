import { createAppPage } from "app/client/ui/createAppPage";
import { createErrPage } from "app/client/ui/errorPages";
import { getGristConfig } from "app/common/urlUtils";

// When the setup gate is active, all API calls return 503, so skip them.
const useApi = getGristConfig().errPage !== "setup";
createAppPage(appModel => createErrPage(appModel), { useApi });
