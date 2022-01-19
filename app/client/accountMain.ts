import {AccountPage} from 'app/client/ui/AccountPage';
import {setupPage} from 'app/client/ui/setupPage';
import {dom} from 'grainjs';

setupPage((appModel) => dom.create(AccountPage, appModel));
