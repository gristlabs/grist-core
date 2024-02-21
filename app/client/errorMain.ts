import {createAppPage} from 'app/client/ui/createAppPage';
import {createErrPage} from 'app/client/ui/errorPages';

createAppPage((appModel) => createErrPage(appModel));
