import {createErrPage} from 'app/client/ui/errorPages';
import {setupPage} from 'app/client/ui/setupPage';

setupPage((appModel) => createErrPage(appModel));
